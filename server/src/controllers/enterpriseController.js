const db = require('../db');

const setupSSO = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { provider, clientId, clientSecret, metadataUrl } = req.body;

    await db.query(
      `INSERT INTO sso_config (company_id, provider, client_id, client_secret, metadata_url, enabled)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (company_id) DO UPDATE SET
         provider = $2, client_id = $3, client_secret = $4, metadata_url = $5, enabled = true`,
      [companyId, provider, clientId, clientSecret, metadataUrl]
    );

    return res.json({ success: true, message: 'SSO configured successfully' });
  } catch (error) {
    console.error('Setup SSO error:', error);
    return res.status(500).json({ error: 'Failed to setup SSO' });
  }
};

const getSSOConfig = async (req, res) => {
  try {
    const companyId = req.user?.company_id;

    const { rows } = await db.query(
      `SELECT id, provider, client_id, metadata_url, enabled, created_at 
       FROM sso_config WHERE company_id = $1`,
      [companyId]
    );

    return res.json({ data: rows[0] || null });
  } catch (error) {
    console.error('Get SSO config error:', error);
    return res.status(500).json({ error: 'Failed to get SSO config' });
  }
};

const disableSSO = async (req, res) => {
  try {
    const companyId = req.user?.company_id;

    await db.query(
      `UPDATE sso_config SET enabled = false WHERE company_id = $1`,
      [companyId]
    );

    return res.json({ success: true, message: 'SSO disabled' });
  } catch (error) {
    console.error('Disable SSO error:', error);
    return res.status(500).json({ error: 'Failed to disable SSO' });
  }
};

const createAnnouncement = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { title, content, priority, targetRoles, isPinned, startsAt, endsAt } = req.body;

    const { rows } = await db.query(
      `INSERT INTO announcements (company_id, title, content, priority, target_roles, is_pinned, starts_at, ends_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [companyId, title, content, priority || 'normal', targetRoles || [], isPinned || false, startsAt, endsAt, req.user?.id]
    );

    return res.json({ data: rows[0] });
  } catch (error) {
    console.error('Create announcement error:', error);
    return res.status(500).json({ error: 'Failed to create announcement' });
  }
};

const getAnnouncements = async (req, res) => {
  try {
    const companyId = req.user?.company_id;

    const { rows } = await db.query(
      `SELECT * FROM announcements WHERE company_id = $1 
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (ends_at IS NULL OR ends_at >= NOW())
       ORDER BY is_pinned DESC, created_at DESC`,
      [companyId]
    );

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get announcements error:', error);
    return res.status(500).json({ error: 'Failed to get announcements' });
  }
};

const addBookmark = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { title, url, icon } = req.body;

    const { rows } = await db.query(
      `INSERT INTO user_bookmarks (user_id, title, url, icon)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, title, url, icon]
    );

    return res.json({ data: rows[0] });
  } catch (error) {
    console.error('Add bookmark error:', error);
    return res.status(500).json({ error: 'Failed to add bookmark' });
  }
};

const getBookmarks = async (req, res) => {
  try {
    const userId = req.user?.id;

    const { rows } = await db.query(
      `SELECT * FROM user_bookmarks WHERE user_id = $1 ORDER BY position`,
      [userId]
    );

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get bookmarks error:', error);
    return res.status(500).json({ error: 'Failed to get bookmarks' });
  }
};

const deleteBookmark = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    await db.query(
      `DELETE FROM user_bookmarks WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete bookmark error:', error);
    return res.status(500).json({ error: 'Failed to delete bookmark' });
  }
};

const createScheduledReport = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { name, reportType, frequency, recipients, filters } = req.body;

    const nextRunAt = new Date();
    if (frequency === 'daily') nextRunAt.setDate(nextRunAt.getDate() + 1);
    else if (frequency === 'weekly') nextRunAt.setDate(nextRunAt.getDate() + 7);
    else nextRunAt.setMonth(nextRunAt.getMonth() + 1);

    const { rows } = await db.query(
      `INSERT INTO scheduled_reports (company_id, name, report_type, frequency, recipients, filters, next_run_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [companyId, name, reportType, frequency, JSON.stringify(recipients), JSON.stringify(filters), nextRunAt, req.user?.id]
    );

    return res.json({ data: rows[0] });
  } catch (error) {
    console.error('Create scheduled report error:', error);
    return res.status(500).json({ error: 'Failed to create scheduled report' });
  }
};

const getScheduledReports = async (req, res) => {
  try {
    const companyId = req.user?.company_id;

    const { rows } = await db.query(
      `SELECT * FROM scheduled_reports WHERE company_id = $1 ORDER BY created_at DESC`,
      [companyId]
    );

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get scheduled reports error:', error);
    return res.status(500).json({ error: 'Failed to get scheduled reports' });
  }
};

module.exports = {
  setupSSO, getSSOConfig, disableSSO,
  createAnnouncement, getAnnouncements,
  addBookmark, getBookmarks, deleteBookmark,
  createScheduledReport, getScheduledReports
};