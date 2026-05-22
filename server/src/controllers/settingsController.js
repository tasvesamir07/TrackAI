const db = require('../db');

const getCompanySettings = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company not found' });
    }

    const { rows: settings } = await db.query(
      `SELECT key, value FROM settings WHERE company_id = $1`,
      [companyId]
    );

    const settingsObj = {};
    settings.forEach(s => {
      try {
        settingsObj[s.key] = JSON.parse(s.value);
      } catch {
        settingsObj[s.key] = s.value;
      }
    });

    const { rows: company } = await db.query(
      `SELECT id, name as company_name, address, timezone, industry, company_size, business_email, phone, logo_url
       FROM tenants WHERE id = $1`,
      [companyId]
    );

    const { rows: users } = await db.query(
      `SELECT COUNT(*) as count FROM users WHERE company_id = $1 AND status = 'active'`,
      [companyId]
    );

    return res.json({
      data: {
        ...company[0],
        ...settingsObj,
        employee_count: parseInt(users[0]?.count || 0),
      }
    });
  } catch (error) {
    console.error('Get company settings error:', error);
    return res.status(500).json({ error: 'Failed to get company settings' });
  }
};

const updateCompanySettings = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Company not found' });
    }

    const {
      company_name,
      address,
      timezone,
      industry,
      company_size,
      business_email,
      phone_number,
    } = req.body;

    if (company_name) {
      await db.query(
        `UPDATE tenants SET name = $1, updated_at = NOW() WHERE id = $2`,
        [company_name, companyId]
      );
    }

    const settingsToUpdate = {
      address,
      timezone,
      industry,
      company_size,
      business_email,
      phone_number,
    };

    for (const [key, value] of Object.entries(settingsToUpdate)) {
      if (value !== undefined) {
        await db.query(
          `INSERT INTO settings (key, value, company_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (company_id, key) DO UPDATE SET value = $2`,
          [key, JSON.stringify(value), companyId]
        );
      }
    }

    return res.json({ data: { success: true } });
  } catch (error) {
    console.error('Update company settings error:', error);
    return res.status(500).json({ error: 'Failed to update company settings' });
  }
};

const getDirectory = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { search, department, limit = 50 } = req.query;

    if (!companyId) {
      return res.status(400).json({ error: 'Company not found' });
    }

    let query = `
      SELECT u.id, u.full_name, u.username, u.email, u.role, u.profile_picture,
             d.name as department
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.company_id = $1 AND u.status = 'active'
    `;
    const params = [companyId];

    if (search) {
      query += ` AND (u.full_name ILIKE $2 OR u.email ILIKE $2 OR u.username ILIKE $2)`;
      params.push(`%${search}%`);
    }

    if (department && department !== 'all') {
      query += ` AND d.name = $${params.length + 1}`;
      params.push(department);
    }

    query += ` ORDER BY u.full_name LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const { rows: employees } = await db.query(query, params);

    const { rows: departments } = await db.query(
      `SELECT DISTINCT d.name
       FROM departments d
       JOIN users u ON u.department_id = d.id
       WHERE u.company_id = $1 AND u.status = 'active'
       ORDER BY d.name`,
      [companyId]
    );

    return res.json({
      data: {
        employees,
        departments: departments.map(d => d.name),
      }
    });
  } catch (error) {
    console.error('Get directory error:', error);
    return res.status(500).json({ error: 'Failed to get directory' });
  }
};

module.exports = {
  getCompanySettings,
  updateCompanySettings,
  getDirectory,
};