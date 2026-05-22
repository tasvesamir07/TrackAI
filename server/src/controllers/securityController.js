const db = require('../db');
const crypto = require('crypto');

const isSchemaAvailabilityError = (error) => {
  const code = String(error?.code || '');
  return code === '42P01' || code === '42703' || code === '3F000';
};

const generateSecret = () => {
  return crypto.randomBytes(20).toString('base32').toUpperCase();
};

const generateRecoveryCodes = () => {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }
  return codes;
};

const hashRecoveryCode = (code) => {
  return crypto.createHash('sha256').update(code).digest('hex');
};

const verifyTOTP = (secret, token, window = 1) => {
  const decodedSecret = Buffer.from(secret, 'base32');
  const tokenValue = String(token).replace(/\s/g, '');
  if (!/^\d{6}$/.test(tokenValue)) return false;

  const epoch = Math.floor(Date.now() / 1000);
  const timeStep = 30;

  for (let i = -window; i <= window; i++) {
    const time = epoch + (i * timeStep);
    const timeBuffer = Buffer.alloc(8);
    timeBuffer.writeBigUInt64BE(BigInt(Math.floor(time / timeStep)));

    const hmac = crypto.createHmac('sha1', decodedSecret);
    hmac.update(timeBuffer);
    const hmacResult = hmac.digest();

    const offset = hmacResult[hmacResult.length - 1] & 0x0f;
    const code = (
      ((hmacResult[offset] & 0x7f) << 24) |
      ((hmacResult[offset + 1] & 0xff) << 16) |
      ((hmacResult[offset + 2] & 0xff) << 8) |
      (hmacResult[offset + 3] & 0xff)
    ) % 1000000;

    const paddedCode = String(code).padStart(6, '0');
    if (paddedCode === tokenValue) return true;
  }
  return false;
};

const setup2FA = async (req, res) => {
  try {
    const userId = req.user?.id;
    const secretKey = generateSecret();
    const recoveryCodes = generateRecoveryCodes();
    const hashedRecoveryCodes = recoveryCodes.map(hashRecoveryCode);

    await db.query(
      `INSERT INTO user_2fa (user_id, secret_key, recovery_codes)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET 
         secret_key = $2,
         recovery_codes = $3,
         is_enabled = false`,
      [userId, secretKey, hashedRecoveryCodes]
    );

    const qrCodeUrl = `otpauth://totp/TrackAI:${req.user?.email}?secret=${secretKey}&issuer=TrackAI`;

    return res.json({
      data: {
        secret: secretKey,
        qrCodeUrl,
        recoveryCodes,
      }
    });
  } catch (error) {
    console.error('Setup 2FA error:', error);
    return res.status(500).json({ error: 'Failed to setup 2FA' });
  }
};

const verify2FA = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Verification code is required' });
    }

    const { rows } = await db.query(
      `SELECT secret_key, recovery_codes, is_enabled FROM user_2fa WHERE user_id = $1`,
      [userId]
    );

    if (!rows.length) {
      return res.status(400).json({ error: '2FA not configured' });
    }

    const { secret_key, recovery_codes, is_enabled } = rows[0];

    if (is_enabled) {
      return res.status(400).json({ error: '2FA is already enabled' });
    }

    const isValidTOTP = verifyTOTP(secret_key, code);

    if (isValidTOTP) {
      await db.query(
        `UPDATE user_2fa SET is_enabled = true, verified_at = NOW() WHERE user_id = $1`,
        [userId]
      );

      return res.json({ success: true, message: '2FA enabled successfully' });
    }

    return res.status(400).json({ error: 'Invalid verification code' });
  } catch (error) {
    console.error('Verify 2FA error:', error);
    return res.status(500).json({ error: 'Failed to verify 2FA' });
  }
};

const disable2FA = async (req, res) => {
  try {
    const userId = req.user?.id;

    await db.query(
      `UPDATE user_2fa SET is_enabled = false WHERE user_id = $1`,
      [userId]
    );

    return res.json({ success: true, message: '2FA disabled' });
  } catch (error) {
    console.error('Disable 2FA error:', error);
    return res.status(500).json({ error: 'Failed to disable 2FA' });
  }
};

const getSessions = async (req, res) => {
  try {
    const userId = req.user?.id;

    const { rows } = await db.query(
      `SELECT id, device_info, ip_address, location, user_agent, is_active, created_at, last_active_at
       FROM user_sessions
       WHERE user_id = $1
       ORDER BY last_active_at DESC
       LIMIT 20`,
      [userId]
    );

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get sessions error:', error);
    return res.status(500).json({ error: 'Failed to get sessions' });
  }
};

const terminateSession = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { sessionId } = req.params;

    await db.query(
      `UPDATE user_sessions SET is_active = false WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );

    return res.json({ success: true, message: 'Session terminated' });
  } catch (error) {
    console.error('Terminate session error:', error);
    return res.status(500).json({ error: 'Failed to terminate session' });
  }
};

const terminateAllSessions = async (req, res) => {
  try {
    const userId = req.user?.id;
    const currentSessionId = req.headers['x-session-id'];

    await db.query(
      `UPDATE user_sessions SET is_active = false 
       WHERE user_id = $1 AND id != $2`,
      [userId, currentSessionId]
    );

    return res.json({ success: true, message: 'All other sessions terminated' });
  } catch (error) {
    console.error('Terminate all sessions error:', error);
    return res.status(500).json({ error: 'Failed to terminate sessions' });
  }
};

const logAudit = async (companyId, userId, action, entityType, entityId, oldValues, newValues, req) => {
  try {
    await db.query(
      `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [companyId, userId, action, entityType, entityId, JSON.stringify(oldValues), JSON.stringify(newValues), req.ip, req.get('user-agent')]
    );
  } catch (error) {
    console.error('Failed to log audit:', error);
  }
};

const getAuditLogs = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { action, userId, startDate, endDate, limit = 100 } = req.query;

    let query = `
      SELECT al.*, u.full_name as user_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.company_id = $1
    `;
    const params = [companyId];

    if (action) {
      query += ` AND al.action = $${params.length + 1}`;
      params.push(action);
    }

    if (userId) {
      query += ` AND al.user_id = $${params.length + 1}`;
      params.push(userId);
    }

    if (startDate) {
      query += ` AND al.created_at >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND al.created_at <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += ` ORDER BY al.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const { rows } = await db.query(query, params);

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get audit logs error:', error);
    return res.status(500).json({ error: 'Failed to get audit logs' });
  }
};

const getIPWhitelist = async (req, res) => {
  try {
    const companyId = req.user?.company_id;

    const { rows } = await db.query(
      `SELECT * FROM company_ip_whitelist WHERE company_id = $1 AND is_active = true`,
      [companyId]
    );

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get IP whitelist error:', error);
    return res.status(500).json({ error: 'Failed to get IP whitelist' });
  }
};

const addIPWhitelist = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const { ipRange, description } = req.body;

    await db.query(
      `INSERT INTO company_ip_whitelist (company_id, ip_range, description, created_by)
       VALUES ($1, $2, $3, $4)`,
      [companyId, ipRange, description, userId]
    );

    return res.json({ success: true, message: 'IP added to whitelist' });
  } catch (error) {
    console.error('Add IP whitelist error:', error);
    return res.status(500).json({ error: 'Failed to add IP to whitelist' });
  }
};

const removeIPWhitelist = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { id } = req.params;

    await db.query(
      `UPDATE company_ip_whitelist SET is_active = false WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    return res.json({ success: true, message: 'IP removed from whitelist' });
  } catch (error) {
    console.error('Remove IP whitelist error:', error);
    return res.status(500).json({ error: 'Failed to remove IP from whitelist' });
  }
};

const getBotStats = async (req, res) => {
    try {
        const [stats, trend] = await Promise.all([
          db.query(`
            SELECT 
                COUNT(*) as total_requests,
                COUNT(*) FILTER (WHERE action = 'blocked') as blocked_requests,
                COUNT(DISTINCT ip_address) as suspicious_ips
            FROM bot_logs
            WHERE timestamp > NOW() - INTERVAL '24 hours'
          `),
          db.query(`
            SELECT
              TO_CHAR(DATE_TRUNC('hour', timestamp), 'HH24:MI') AS time,
              COUNT(*) FILTER (WHERE action = 'blocked')::int AS blocked
            FROM bot_logs
            WHERE timestamp > NOW() - INTERVAL '6 hours'
            GROUP BY DATE_TRUNC('hour', timestamp)
            ORDER BY DATE_TRUNC('hour', timestamp) ASC
          `)
        ]);

        const trendData = trend.rows.map((r) => ({
          time: r.time,
          blocked: Number(r.blocked) || 0
        }));

        res.json({
            totalRequests: parseInt(stats.rows[0]?.total_requests || '0', 10),
            blockedRequests: parseInt(stats.rows[0]?.blocked_requests || '0', 10),
            suspiciousIPs: parseInt(stats.rows[0]?.suspicious_ips || '0', 10),
            activeRules: 5,
            trendData
        });
    } catch (error) {
        if (isSchemaAvailabilityError(error)) {
            return res.json({
                totalRequests: 0,
                blockedRequests: 0,
                suspiciousIPs: 0,
                activeRules: 0,
                trendData: [],
                warning: 'bot_logs_schema_unavailable'
            });
        }
        console.error('Error fetching bot stats:', error);
        res.status(500).json({ error: 'Server error fetching bot stats' });
    }
};

const getBotLogs = async (req, res) => {
    try {
        const logs = await db.query(`
            SELECT id, ip_address as ip, action, reason, timestamp 
            FROM bot_logs 
            ORDER BY timestamp DESC 
            LIMIT 100
        `);

        res.json({ logs: logs.rows });
    } catch (error) {
        if (isSchemaAvailabilityError(error)) {
            return res.json({
                logs: [],
                warning: 'bot_logs_schema_unavailable'
            });
        }
        console.error('Error fetching bot logs:', error);
        res.status(500).json({ error: 'Server error fetching bot logs' });
    }
};

module.exports = {
  setup2FA,
  verify2FA,
  disable2FA,
  getSessions,
  terminateSession,
  terminateAllSessions,
  getAuditLogs,
  getIPWhitelist,
  addIPWhitelist,
  removeIPWhitelist,
  getBotStats,
  getBotLogs
};
