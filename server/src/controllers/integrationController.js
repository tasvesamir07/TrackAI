const db = require('../db');

const setupSlackIntegration = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { webhookUrl, channel } = req.body;

    await db.query(
      `INSERT INTO company_integrations (company_id, provider, config, is_active)
       VALUES ($1, 'slack', $2, true)
       ON CONFLICT (company_id, provider) DO UPDATE SET config = $2, is_active = true`,
      [companyId, JSON.stringify({ webhookUrl, channel })]
    );

    return res.json({ success: true, message: 'Slack integration connected' });
  } catch (error) {
    console.error('Slack integration error:', error);
    return res.status(500).json({ error: 'Failed to setup Slack integration' });
  }
};

const setupGoogleCalendar = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { accessToken, refreshToken } = req.body;

    await db.query(
      `INSERT INTO company_integrations (company_id, provider, config, is_active)
       VALUES ($1, 'google_calendar', $2, true)
       ON CONFLICT (company_id, provider) DO UPDATE SET config = $2, is_active = true`,
      [companyId, JSON.stringify({ accessToken, refreshToken })]
    );

    return res.json({ success: true, message: 'Google Calendar connected' });
  } catch (error) {
    console.error('Google Calendar integration error:', error);
    return res.status(500).json({ error: 'Failed to setup Google Calendar' });
  }
};

const setupZapier = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { webhookUrl, events } = req.body;

    await db.query(
      `INSERT INTO company_integrations (company_id, provider, config, is_active)
       VALUES ($1, 'zapier', $2, true)
       ON CONFLICT (company_id, provider) DO UPDATE SET config = $2, is_active = true`,
      [companyId, JSON.stringify({ webhookUrl, events: events || [] })]
    );

    return res.json({ success: true, message: 'Zapier integration connected' });
  } catch (error) {
    console.error('Zapier integration error:', error);
    return res.status(500).json({ error: 'Failed to setup Zapier' });
  }
};

const getIntegrations = async (req, res) => {
  try {
    const companyId = req.user?.company_id;

    const { rows } = await db.query(
      `SELECT provider, is_active, created_at FROM company_integrations WHERE company_id = $1`,
      [companyId]
    );

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get integrations error:', error);
    return res.status(500).json({ error: 'Failed to get integrations' });
  }
};

const disconnectIntegration = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { provider } = req.params;

    await db.query(
      `UPDATE company_integrations SET is_active = false WHERE company_id = $1 AND provider = $2`,
      [companyId, provider]
    );

    return res.json({ success: true, message: 'Integration disconnected' });
  } catch (error) {
    console.error('Disconnect integration error:', error);
    return res.status(500).json({ error: 'Failed to disconnect integration' });
  }
};

const triggerWebhook = async (event, data) => {
  try {
    const { rows: integrations } = await db.query(
      `SELECT config FROM company_integrations WHERE provider = 'zapier' AND is_active = true`
    );

    for (const integration of integrations) {
      const { webhookUrl } = JSON.parse(integration.config);
      if (webhookUrl) {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event, data, timestamp: new Date().toISOString() }),
        }).catch(console.error);
      }
    }
  } catch (error) {
    console.error('Trigger webhook error:', error);
  }
};

const setupMicrosoftTeams = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { webhookUrl, tenantId } = req.body;

    await db.query(
      `INSERT INTO company_integrations (company_id, provider, config, is_active)
       VALUES ($1, 'microsoft_teams', $2, true)
       ON CONFLICT (company_id, provider) DO UPDATE SET config = $2, is_active = true`,
      [companyId, JSON.stringify({ webhookUrl, tenantId })]
    );

    return res.json({ success: true, message: 'Microsoft Teams integration connected' });
  } catch (error) {
    console.error('Microsoft Teams integration error:', error);
    return res.status(500).json({ error: 'Failed to setup Microsoft Teams' });
  }
};

module.exports = {
  setupSlackIntegration,
  setupGoogleCalendar,
  setupZapier,
  setupMicrosoftTeams,
  getIntegrations,
  disconnectIntegration,
  triggerWebhook,
};