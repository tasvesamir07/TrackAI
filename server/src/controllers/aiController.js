const db = require('../db');
const { openai } = require('../utils/aiService');

const MAX_QUERY_LENGTH = 1000;
const ALLOWED_CHARS = /^[a-zA-Z0-9\s\-_.,!?@#&()'"\/\\:;]+$/;

const naturalLanguageSearch = async (req, res) => {
  try {
    const { query } = req.body;
    const companyId = req.user?.company_id;

    if (!openai) {
      return res.status(503).json({ error: 'AI service not configured' });
    }

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query is required and must be a string' });
    }

    if (query.length > MAX_QUERY_LENGTH) {
      return res.status(400).json({ error: `Query too long (max ${MAX_QUERY_LENGTH} characters)` });
    }

    if (!ALLOWED_CHARS.test(query)) {
      return res.status(400).json({ error: 'Query contains invalid characters' });
    }

    const sanitizedQuery = query.replace(/[<>{}]/g, '').trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are a search assistant. Parse natural language queries and extract filters. 
          Return JSON with: searchTerm, filters (department, role, status, dateFrom, dateTo).
          Only return the JSON, no other text.`
        },
        {
          role: 'user',
          content: sanitizedQuery
        }
      ],
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    let sql = 'SELECT * FROM users WHERE company_id = $1 AND status = \'active\'';
    const params = [companyId];

    if (parsed.searchTerm) {
      sql += ` AND (full_name ILIKE $${params.length + 1} OR email ILIKE $${params.length + 1})`;
      params.push(`%${parsed.searchTerm}%`);
    }

    if (parsed.filters?.department) {
      sql += ` AND department = $${params.length + 1}`;
      params.push(parsed.filters.department);
    }

    sql += ' LIMIT 20';

    const { rows } = await db.query(sql, params);

    return res.json({ data: { results: rows, parsedQuery: parsed } });
  } catch (error) {
    console.error('Natural language search error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
};

const generateInsights = async (req, res) => {
  try {
    const companyId = req.user?.company_id;

    const { rows: attendance } = await db.query(
      `SELECT DATE(check_in) as date, COUNT(*) as total, 
              SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present
       FROM attendance
       WHERE company_id = $1 AND check_in >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY DATE(check_in) ORDER BY date`,
      [companyId]
    );

    const { rows: tasks } = await db.query(
      `SELECT status, COUNT(*) as count FROM tasks 
       WHERE company_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY status`,
      [companyId]
    );

    const { rows: leave } = await db.query(
      `SELECT status, COUNT(*) as count FROM leaves
       WHERE company_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY status`,
      [companyId]
    );

    if (!openai) {
      return res.json({ 
        data: { 
          attendance, 
          tasks, 
          leave,
          insight: 'Configure OpenAI API key for AI-powered insights'
        } 
      });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a business analytics assistant. Analyze the provided data and give 3-5 actionable insights. Keep it concise.'
        },
        {
          role: 'user',
          content: JSON.stringify({ attendance, tasks, leave })
        }
      ],
    });

    return res.json({ 
      data: { 
        attendance, 
        tasks, 
        leave,
        insight: completion.choices[0].message.content 
      } 
    });
  } catch (error) {
    console.error('Generate insights error:', error);
    return res.status(500).json({ error: 'Failed to generate insights' });
  }
};

const detectAnomalies = async (req, res) => {
  try {
    const companyId = req.user?.company_id;

    const { rows: leaves } = await db.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count 
       FROM leaves 
       WHERE company_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY DATE(created_at) ORDER BY date`,
      [companyId]
    );

    if (leaves.length < 7) {
      return res.json({ data: { anomalies: [], message: 'Insufficient data for analysis' } });
    }

    const counts = leaves.map(l => l.count);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const stdDev = Math.sqrt(counts.map(x => Math.pow(x - avg, 2)).reduce((a, b) => a + b) / counts.length);

    const anomalies = leaves.filter(l => Math.abs(l.count - avg) > 2 * stdDev);

    return res.json({ 
      data: { 
        anomalies,
        baseline: { average: avg.toFixed(2), stdDev: stdDev.toFixed(2) }
      } 
    });
  } catch (error) {
    console.error('Detect anomalies error:', error);
    return res.status(500).json({ error: 'Failed to detect anomalies' });
  }
};

const getRecommendations = async (req, res) => {
  try {
    const { type, context } = req.body;
    const companyId = req.user?.company_id;

    if (type === 'task_assignment') {
      const { rows: users } = await db.query(
        `SELECT u.id, u.full_name, 
                (SELECT COUNT(*) FROM tasks WHERE assignee_id = u.id AND status != 'completed') as task_count
         FROM users u
         WHERE u.company_id = $1 AND u.status = 'active'
         ORDER BY task_count ASC LIMIT 5`,
        [companyId]
      );

      return res.json({ 
        data: { 
          recommendations: users.map(u => ({
            userId: u.id,
            name: u.full_name,
            currentTasks: parseInt(u.task_count),
            reason: 'Has the least amount of active tasks'
          })) 
        } 
      });
    }

    if (type === 'schedule_meeting') {
      const { rows: users } = await db.query(
        `SELECT u.id, u.full_name,
                COUNT(DISTINCT DATE(leaves.start_date)) as leave_days
         FROM users u
         LEFT JOIN leaves l ON u.id = l.user_id AND l.status = 'approved' 
           AND l.start_date <= CURRENT_DATE + INTERVAL '7 days'
         WHERE u.company_id = $1 AND u.status = 'active'
         GROUP BY u.id
         ORDER BY leave_days ASC LIMIT 5`,
        [companyId]
      );

      return res.json({ 
        data: { 
          recommendations: users.map(u => ({
            userId: u.id,
            name: u.full_name,
            upcomingLeaves: parseInt(u.leave_days),
            reason: 'Least days off in the next 7 days'
          })) 
        } 
      });
    }

    return res.json({ data: { recommendations: [] } });
  } catch (error) {
    console.error('Get recommendations error:', error);
    return res.status(500).json({ error: 'Failed to get recommendations' });
  }
};

module.exports = {
  naturalLanguageSearch,
  generateInsights,
  detectAnomalies,
  getRecommendations,
};