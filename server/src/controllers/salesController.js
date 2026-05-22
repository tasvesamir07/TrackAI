const db = require('../db');
const crypto = require('crypto');

const createLead = async (req, res) => {
  try {
    const { name, email, companyName, phone, message, source } = req.body;

    const { rows } = await db.query(
      `INSERT INTO leads (name, email, company_name, phone, message, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [name, email, companyName, phone, message, source || 'website']
    );

    return res.json({ data: { id: rows[0].id, success: true }, message: 'Thank you! We will contact you soon.' });
  } catch (error) {
    console.error('Create lead error:', error);
    return res.status(500).json({ error: 'Failed to submit inquiry' });
  }
};

const getLeads = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { status, limit = 50 } = req.query;

    let query = `SELECT * FROM leads WHERE 1=1`;
    const params = [];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const { rows } = await db.query(query, params);
    return res.json({ data: rows });
  } catch (error) {
    console.error('Get leads error:', error);
    return res.status(500).json({ error: 'Failed to get leads' });
  }
};

const generateApiKey = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { name } = req.body;
    const keyValue = `ta_${crypto.randomBytes(24).toString('hex')}`;

    const { rows } = await db.query(
      `INSERT INTO api_keys (company_id, key_value, name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [companyId, keyValue, name || 'Default']
    );

    return res.json({ data: { id: rows[0].id, apiKey: keyValue } });
  } catch (error) {
    console.error('Generate API key error:', error);
    return res.status(500).json({ error: 'Failed to generate API key' });
  }
};

const getApiKeys = async (req, res) => {
  try {
    const companyId = req.user?.company_id;

    const { rows } = await db.query(
      `SELECT id, name, is_active, last_used_at, created_at FROM api_keys WHERE company_id = $1`,
      [companyId]
    );

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get API keys error:', error);
    return res.status(500).json({ error: 'Failed to get API keys' });
  }
};

const revokeApiKey = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { id } = req.params;

    await db.query(
      `UPDATE api_keys SET is_active = false WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    return res.json({ success: true, message: 'API key revoked' });
  } catch (error) {
    console.error('Revoke API key error:', error);
    return res.status(500).json({ error: 'Failed to revoke API key' });
  }
};

const setupWebhook = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { url, events } = req.body;

    const { rows } = await db.query(
      `INSERT INTO company_webhooks (company_id, url, events)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [companyId, url, JSON.stringify(events || [])]
    );

    return res.json({ data: { id: rows[0].id, success: true } });
  } catch (error) {
    console.error('Setup webhook error:', error);
    return res.status(500).json({ error: 'Failed to setup webhook' });
  }
};

const getWebhooks = async (req, res) => {
  try {
    const companyId = req.user?.company_id;

    const { rows } = await db.query(
      `SELECT * FROM company_webhooks WHERE company_id = $1`,
      [companyId]
    );

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get webhooks error:', error);
    return res.status(500).json({ error: 'Failed to get webhooks' });
  }
};

module.exports = {
  createLead,
  getLeads,
  generateApiKey,
  getApiKeys,
  revokeApiKey,
  setupWebhook,
  getWebhooks,
};