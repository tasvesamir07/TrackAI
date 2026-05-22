const db = require('../db');
const geoip = require('geoip-lite');

const isSchemaAvailabilityError = (error) => {
  const code = String(error?.code || '');
  return code === '42P01' || code === '42703' || code === '3F000';
};

const trackClick = async (req, res) => {
  try {
    const { page_url, element_selector, element_text, x_position, y_position, session_id } = req.body;
    const companyId = req.user?.company_id;
    const userId = req.user?.id;

    const { rows } = await db.query(
      `INSERT INTO click_events (company_id, user_id, page_url, element_selector, element_text, x_position, y_position, session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [companyId, userId, page_url, element_selector, element_text, x_position, y_position, session_id]
    );

    await db.query(
      `INSERT INTO page_heatmaps (page_url, x, y, click_count, unique_clicks)
       VALUES ($1, $2, $3, 1, 1)
       ON CONFLICT (page_url, x, y) 
       DO UPDATE SET click_count = page_heatmaps.click_count + 1, unique_clicks = page_heatmaps.unique_clicks + 1, updated_at = NOW()`,
      [page_url, Math.floor(x_position / 50) * 50, Math.floor(y_position / 50) * 50]
    );

    return res.json({ success: true, id: rows[0].id });
  } catch (error) {
    if (isSchemaAvailabilityError(error)) {
      return res.json({ success: true, skipped: true, reason: 'tracking_schema_unavailable' });
    }
    console.error('Track click error:', error);
    return res.status(500).json({ error: 'Failed to track click' });
  }
};

const trackClickBatch = async (req, res) => {
  try {
    const { clicks } = req.body;
    const companyId = req.user?.company_id;
    const userId = req.user?.id;

    if (!Array.isArray(clicks) || clicks.length === 0) {
      return res.status(400).json({ error: 'No clicks provided' });
    }

    for (const click of clicks) {
      await db.query(
        `INSERT INTO click_events (company_id, user_id, page_url, element_selector, element_text, x_position, y_position, session_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [companyId, userId, click.page_url, click.element_selector, click.element_text, click.x_position, click.y_position, click.session_id]
      );

      await db.query(
        `INSERT INTO page_heatmaps (page_url, x, y, click_count, unique_clicks)
         VALUES ($1, $2, $3, 1, 1)
         ON CONFLICT (page_url, x, y)
         DO UPDATE SET click_count = page_heatmaps.click_count + 1, unique_clicks = page_heatmaps.unique_clicks + 1, updated_at = NOW()`,
        [
          click.page_url,
          Math.floor(Number(click.x_position || 0) / 50) * 50,
          Math.floor(Number(click.y_position || 0) / 50) * 50
        ]
      );
    }

    return res.json({ success: true, count: clicks.length });
  } catch (error) {
    if (isSchemaAvailabilityError(error)) {
      return res.json({ success: true, count: Array.isArray(req.body?.clicks) ? req.body.clicks.length : 0, skipped: true, reason: 'tracking_schema_unavailable' });
    }
    console.error('Track click batch error:', error);
    return res.status(500).json({ error: 'Failed to track clicks' });
  }
};

const getClickAnalytics = async (req, res) => {
  try {
    const { page_url, start_date, end_date, limit = 100, bucket = 'day' } = req.query;
    const companyId = req.user?.company_id;

    let query = `
      SELECT page_url, element_selector, element_text, 
             COUNT(*) as click_count, 
             COUNT(DISTINCT user_id) as unique_users
      FROM click_events
      WHERE company_id = $1
    `;
    const params = [companyId];

    if (page_url) {
      query += ` AND page_url = $${params.length + 1}`;
      params.push(page_url);
    }

    if (start_date) {
      query += ` AND timestamp >= $${params.length + 1}`;
      params.push(start_date);
    }

    if (end_date) {
      query += ` AND timestamp <= $${params.length + 1}`;
      params.push(end_date);
    }

    query += ` GROUP BY page_url, element_selector, element_text ORDER BY click_count DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const { rows } = await db.query(query, params);

    const heatmapQuery = page_url 
      ? `SELECT x, y, click_count, unique_clicks FROM page_heatmaps WHERE page_url = $1 ORDER BY click_count DESC`
      : `SELECT page_url, x, y, click_count, unique_clicks FROM page_heatmaps ORDER BY click_count DESC LIMIT 100`;
    
    const heatmapParams = page_url ? [page_url] : [];
    const { rows: heatmap } = await db.query(heatmapQuery, heatmapParams);

    const trendBucket = String(bucket).toLowerCase() === 'hour' ? 'hour' : 'day';
    const trend = await db.query(
      `
      SELECT DATE_TRUNC($1, timestamp) AS bucket, COUNT(*)::int AS click_count
      FROM click_events
      WHERE company_id = $2
        AND ($3::text IS NULL OR page_url = $3)
        AND ($4::timestamptz IS NULL OR timestamp >= $4)
        AND ($5::timestamptz IS NULL OR timestamp <= $5)
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      [
        trendBucket,
        companyId,
        page_url || null,
        start_date || null,
        end_date || null,
      ]
    );

    return res.json({ data: { clicks: rows, heatmap, trend: trend.rows } });
  } catch (error) {
    if (isSchemaAvailabilityError(error)) {
      return res.json({ data: { clicks: [], heatmap: [], trend: [] }, warning: 'tracking_schema_unavailable' });
    }
    console.error('Get click analytics error:', error);
    return res.status(500).json({ error: 'Failed to get click analytics' });
  }
};

const logRequest = async (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', async () => {
    try {
      const companyId = req.user?.company_id;
      const userId = req.user?.id;
      const responseTime = Date.now() - start;
      const ipAddress = req.ip || req.connection?.remoteAddress || '';

      // Look up geo from IP
      let countryCode = null;
      let city = null;
      let lat = null;
      let lon = null;
      if (ipAddress && ipAddress !== '::1' && ipAddress !== '127.0.0.1' && ipAddress !== '::ffff:127.0.0.1') {
        const geo = geoip.lookup(ipAddress);
        if (geo) {
          countryCode = geo.country || null;
          city = geo.city || null;
          lat = geo.ll?.[0] || null;
          lon = geo.ll?.[1] || null;
        }
      }

      await db.query(
        `INSERT INTO request_logs (company_id, user_id, ip_address, method, path, query_params, status_code, response_time_ms, user_agent, country_code, city, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          companyId,
          userId,
          ipAddress,
          req.method,
          req.originalUrl,
          JSON.stringify(req.query),
          res.statusCode,
          responseTime,
          req.get('user-agent'),
          countryCode,
          city,
          lat,
          lon
        ]
      );
    } catch (error) {
      if (!isSchemaAvailabilityError(error)) {
        console.error('Log request error:', error);
      }
    }
  });

  next();
};

const getRequestAnalytics = async (req, res) => {
  try {
    const { start_date, end_date, path, company_id, limit = 100, bucket = 'day' } = req.query;

    let query = `
      SELECT path, method, 
             COUNT(*) as request_count,
             AVG(response_time_ms) as avg_response_time,
             PERCENTILE_CONT(0.95) WITHIN GROUP(ORDER BY response_time_ms) as p95_response_time,
             COUNT(DISTINCT company_id) as unique_companies,
             COUNT(DISTINCT user_id) as unique_users
      FROM request_logs
      WHERE 1=1
    `;
    const params = [];

    if (start_date) {
      query += ` AND created_at >= $${params.length + 1}`;
      params.push(start_date);
    }

    if (end_date) {
      query += ` AND created_at <= $${params.length + 1}`;
      params.push(end_date);
    }

    if (path) {
      query += ` AND path LIKE $${params.length + 1}`;
      params.push(`%${path}%`);
    }

    if (company_id) {
      query += ` AND company_id = $${params.length + 1}`;
      params.push(company_id);
    }

    query += ` GROUP BY path, method ORDER BY request_count DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const { rows } = await db.query(query, params);

    const trendBucket = String(bucket).toLowerCase() === 'hour' ? 'hour' : 'day';
    const { rows: trendRows } = await db.query(
      `
      SELECT DATE_TRUNC($1, created_at) AS bucket, COUNT(*)::int AS request_count
      FROM request_logs
      WHERE ($2::timestamptz IS NULL OR created_at >= $2)
        AND ($3::timestamptz IS NULL OR created_at <= $3)
        AND ($4::uuid IS NULL OR company_id = $4)
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      [trendBucket, start_date || null, end_date || null, company_id || null]
    );

    return res.json({ data: rows, trend: trendRows });
  } catch (error) {
    if (isSchemaAvailabilityError(error)) {
      return res.json({ data: [], trend: [], warning: 'tracking_schema_unavailable' });
    }
    console.error('Get request analytics error:', error);
    return res.status(500).json({ error: 'Failed to get request analytics' });
  }
};

const logBotDetection = async (req, res) => {
  try {
    const { ip_address, user_agent, score, blocked, reason } = req.body;

    await db.query(
      `INSERT INTO bot_logs (ip_address, user_agent, score, blocked, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [ip_address, user_agent, score, blocked, reason]
    );

    return res.json({ success: true });
  } catch (error) {
    if (isSchemaAvailabilityError(error)) {
      return res.json({ success: true, skipped: true, reason: 'tracking_schema_unavailable' });
    }
    console.error('Log bot detection error:', error);
    return res.status(500).json({ error: 'Failed to log bot detection' });
  }
};

const getBotAnalytics = async (req, res) => {
  try {
    const { start_date, end_date, limit = 100 } = req.query;

    let query = `
      SELECT ip_address, user_agent, score, blocked, reason, created_at
      FROM bot_logs
      WHERE 1=1
    `;
    const params = [];

    if (start_date) {
      query += ` AND created_at >= $${params.length + 1}`;
      params.push(start_date);
    }

    if (end_date) {
      query += ` AND created_at <= $${params.length + 1}`;
      params.push(end_date);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const { rows } = await db.query(query, params);

    const { rows: stats } = await db.query(
      `SELECT 
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE blocked = true) as blocked,
         AVG(score) as avg_score
       FROM bot_logs
       WHERE created_at >= COALESCE($1, NOW() - INTERVAL '30 days')`
    );

    return res.json({ data: { bots: rows, stats: stats[0] } });
  } catch (error) {
    if (isSchemaAvailabilityError(error)) {
      return res.json({
        data: {
          bots: [],
          stats: { total: 0, blocked: 0, avg_score: 0 }
        },
        warning: 'tracking_schema_unavailable'
      });
    }
    console.error('Get bot analytics error:', error);
    return res.status(500).json({ error: 'Failed to get bot analytics' });
  }
};

module.exports = {
  trackClick,
  trackClickBatch,
  getClickAnalytics,
  logRequest,
  getRequestAnalytics,
  logBotDetection,
  getBotAnalytics,
};
