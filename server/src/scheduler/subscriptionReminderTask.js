const db = require('../db');
const timeService = require('../utils/timeService');
const { sendTrialExpiringSoonEmail, sendSubscriptionExpiringSoonEmail } = require('../utils/emailService');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * ONE_DAY_MS;

const getCompanyAdminEmail = async (companyId) => {
    const result = await db.query(
        `SELECT email, COALESCE(NULLIF(TRIM(full_name), ''), username) AS admin_name
         FROM users
         WHERE company_id = $1
           AND deleted_at IS NULL
           AND is_active = TRUE
           AND role = 'COMPANY_ADMIN'
         ORDER BY created_at ASC
         LIMIT 1`,
        [companyId]
    );
    return result.rows[0] || null;
};

const hasReminderMarker = async (companyId, key) => {
    const result = await db.query(
        `SELECT value
         FROM settings
         WHERE company_id = $1
           AND key = $2
         LIMIT 1`,
        [companyId, key]
    );
    return result.rows.length > 0;
};

const setReminderMarker = async (companyId, key, value) => {
    await db.query(
        `INSERT INTO settings (key, value, company_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (company_id, key)
         WHERE company_id IS NOT NULL
         DO UPDATE SET value = EXCLUDED.value`,
        [key, String(value), companyId]
    );
};

const checkSubscriptionReminders = async () => {
    const now = timeService.getNow();
    const nowMs = now.getTime();

    const tenantsRes = await db.query(
        `SELECT id, name, subscription_status, unlimited_access, trial_ends_at, current_period_ends_at
         FROM tenants
         WHERE is_active = TRUE`
    );

    for (const tenant of tenantsRes.rows) {
        if (tenant.unlimited_access) continue;

        const companyId = tenant.id;
        const companyName = String(tenant.name || 'your company');
        const status = String(tenant.subscription_status || '').toLowerCase();
        const trialEndsAtMs = tenant.trial_ends_at ? new Date(tenant.trial_ends_at).getTime() : null;
        const periodEndsAtMs = tenant.current_period_ends_at ? new Date(tenant.current_period_ends_at).getTime() : null;

        const admin = await getCompanyAdminEmail(companyId);
        const adminEmail = String(admin?.email || '').trim();
        if (!adminEmail) continue;

        if (status === 'trialing' && trialEndsAtMs && trialEndsAtMs > nowMs) {
            const remaining = trialEndsAtMs - nowMs;
            if (remaining <= ONE_DAY_MS) {
                const markerKey = 'trial_expiry_reminder_1d_sent_at';
                const alreadySent = await hasReminderMarker(companyId, markerKey);
                if (!alreadySent) {
                    await sendTrialExpiringSoonEmail(adminEmail, {
                        companyName,
                        expiresAt: new Date(trialEndsAtMs)
                    });
                    await setReminderMarker(companyId, markerKey, nowMs);
                }
            }
        }

        if (status === 'active' && periodEndsAtMs && periodEndsAtMs > nowMs) {
            const remaining = periodEndsAtMs - nowMs;
            if (remaining <= THREE_DAYS_MS) {
                const markerKey = 'subscription_expiry_reminder_3d_sent_at';
                const alreadySent = await hasReminderMarker(companyId, markerKey);
                if (!alreadySent) {
                    await sendSubscriptionExpiringSoonEmail(adminEmail, {
                        companyName,
                        expiresAt: new Date(periodEndsAtMs)
                    });
                    await setReminderMarker(companyId, markerKey, nowMs);
                }
            }
        }
    }
};

module.exports = {
    checkSubscriptionReminders
};

