const db = require('../db');

const saveStep1 = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { companyName, industry, companySize, timezone } = req.body;

    if (companyName) {
      await db.query(
        `UPDATE tenants SET name = $1, updated_at = NOW() WHERE id = $2`,
        [companyName, companyId]
      );
    }

    const settings = { industry, company_size: timezone };
    for (const [key, value] of Object.entries(settings)) {
      if (value) {
        await db.query(
          `INSERT INTO settings (key, value, company_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (company_id, key) DO UPDATE SET value = $2`,
          [key, JSON.stringify(value), companyId]
        );
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Onboarding step 1 error:', error);
    return res.status(500).json({ error: 'Failed to save company info' });
  }
};

const saveStep2 = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { startTime, endTime, breakDuration, workingDays } = req.body;

    const schedule = { start_time: startTime, end_time: endTime, break_duration: breakDuration, working_days: workingDays };
    await db.query(
      `INSERT INTO settings (key, value, company_id)
       VALUES ('work_schedule', $1, $2)
       ON CONFLICT (company_id, key) DO UPDATE SET value = $1`,
      [JSON.stringify(schedule), companyId]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('Onboarding step 2 error:', error);
    return res.status(500).json({ error: 'Failed to save schedule' });
  }
};

const saveStep3 = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { teamMembers } = req.body;

    if (Array.isArray(teamMembers)) {
      for (const member of teamMembers) {
        if (member.email) {
          const password = Math.random().toString(36).slice(-8);
          
          const { rows: existing } = await db.query(
            `SELECT id FROM users WHERE email = $1 AND company_id = $2`,
            [member.email, companyId]
          );

          if (existing.length === 0) {
            await db.query(
              `INSERT INTO users (company_id, email, full_name, role, password, status)
               VALUES ($1, $2, $3, $4, $5, 'pending')`,
              [companyId, member.email, member.name || member.email.split('@')[0], member.role?.toLowerCase() || 'employee', password]
            );
          }
        }
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Onboarding step 3 error:', error);
    return res.status(500).json({ error: 'Failed to add team members' });
  }
};

const saveStep4 = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { emailEnabled, whatsappNumber, telegramEnabled, pushEnabled } = req.body;

    const notifications = { email_enabled: emailEnabled, whatsapp_number: whatsappNumber, telegram_enabled: telegramEnabled, push_enabled: pushEnabled };
    await db.query(
      `INSERT INTO settings (key, value, company_id)
       VALUES ('notification_settings', $1, $2)
       ON CONFLICT (company_id, key) DO UPDATE SET value = $1`,
      [JSON.stringify(notifications), companyId]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('Onboarding step 4 error:', error);
    return res.status(500).json({ error: 'Failed to save notification settings' });
  }
};

const completeOnboarding = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;

    await db.query(
      `INSERT INTO settings (key, value, company_id)
       VALUES ('onboarding_completed', $1, $2)
       ON CONFLICT (company_id, key) DO UPDATE SET value = $1`,
      ['true', companyId]
    );

    return res.json({ success: true, message: 'Onboarding completed' });
  } catch (error) {
    console.error('Complete onboarding error:', error);
    return res.status(500).json({ error: 'Failed to complete onboarding' });
  }
};

module.exports = {
  saveStep1,
  saveStep2,
  saveStep3,
  saveStep4,
  completeOnboarding,
};