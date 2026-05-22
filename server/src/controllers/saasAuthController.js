const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');
const { SAAS_ROLES } = require('../middleware/tenantMiddleware');
const timeService = require('../utils/timeService');
const { evaluateTenantAccess } = require('../utils/subscriptionAccess');
const { sendTrialExpiredEmail } = require('../utils/emailService');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
let cachedPlansHasIsPopularColumn = null;

const normalizeSlug = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

const signToken = (user) => {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role,
            company_id: user.company_id
        },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
    );
};

const sendTrialExpiredNotificationIfNeeded = async (tenantId) => {
    if (!tenantId) return;
    const markerKey = 'trial_expired_email_sent_at';

    const markerRes = await db.query(
        `SELECT value
         FROM settings
         WHERE key = $1 AND company_id = $2::uuid
         LIMIT 1`,
        [markerKey, tenantId]
    );
    if (markerRes.rows.length > 0) return;

    const adminRes = await db.query(
        `SELECT t.name AS company_name, u.email
         FROM tenants t
         JOIN users u ON u.company_id = t.id
         WHERE t.id = $1
           AND u.deleted_at IS NULL
           AND u.is_active = TRUE
           AND u.role = 'COMPANY_ADMIN'
         ORDER BY u.created_at ASC
         LIMIT 1`,
        [tenantId]
    );

    const adminEmail = String(adminRes.rows[0]?.email || '').trim();
    const companyName = String(adminRes.rows[0]?.company_name || 'Your company').trim();
    if (adminEmail) {
        await sendTrialExpiredEmail(adminEmail, { companyName });
    }

    await db.query(
        `INSERT INTO settings (key, value, company_id)
         VALUES ($1, $2, $3::uuid)
         ON CONFLICT (company_id, key)
         WHERE company_id IS NOT NULL
         DO UPDATE SET value = EXCLUDED.value`,
        [markerKey, String(timeService.getNow().getTime()), tenantId]
    );
};

const signupTenantWithAdmin = async (req, res) => {
    const {
        companyName,
        companySlug,
        planCode = 'FREE',
        adminName,
        adminEmail,
        adminPassword
    } = req.body || {};

    if (!companyName || !adminEmail || !adminPassword) {
        return res.status(400).json({ error: 'companyName, adminEmail and adminPassword are required' });
    }

    const slug = normalizeSlug(companySlug || companyName);
    if (!slug) {
        return res.status(400).json({ error: 'Invalid company slug' });
    }

    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        const planResult = await client.query(
            `SELECT id, trial_days
             FROM plans
             WHERE code = UPPER($1)
               AND is_active = TRUE
             LIMIT 1`,
            [planCode]
        );

        if (planResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Selected plan is not available' });
        }

        const plan = planResult.rows[0];
        const trialEndsAt = Number(plan.trial_days) > 0
            ? new Date(Date.now() + Number(plan.trial_days) * 24 * 60 * 60 * 1000)
            : null;

        const tenantInsert = await client.query(
            `INSERT INTO tenants (name, slug, plan_id, subscription_status, trial_ends_at, is_active)
             VALUES ($1, $2, $3, $4, $5, TRUE)
             RETURNING id, name, slug, plan_id, subscription_status, trial_ends_at`,
            [companyName, slug, plan.id, trialEndsAt ? 'trialing' : 'active', trialEndsAt]
        );

        const bcryptRounds = Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
        const hashedPassword = await bcrypt.hash(String(adminPassword), bcryptRounds);

        const userInsert = await client.query(
            `INSERT INTO users (full_name, email, username, password_hash, role, company_id, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE)
             RETURNING id, full_name, email, role, company_id`,
            [
                adminName || 'Company Admin',
                String(adminEmail).toLowerCase(),
                String(adminEmail).toLowerCase(),
                hashedPassword,
                SAAS_ROLES.COMPANY_ADMIN,
                tenantInsert.rows[0].id
            ]
        );

        await client.query('COMMIT');

        const user = userInsert.rows[0];
        const token = signToken(user);

        return res.status(201).json({
            message: 'Tenant and company admin created',
            token,
            tenant: tenantInsert.rows[0],
            user
        });
    } catch (error) {
        await client.query('ROLLBACK');

        if (error.code === '23505') {
            return res.status(409).json({ error: 'Company slug or email already exists' });
        }

        console.error('signupTenantWithAdmin error:', error);
        return res.status(500).json({ error: 'Failed to create tenant' });
    } finally {
        client.release();
    }
};

const loginSaasUser = async (req, res) => {
    const { email, password } = req.body || {};

    if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
    }

    try {
        const userResult = await db.query(
            `SELECT u.id, u.full_name, u.email, u.password_hash, u.role, u.company_id, u.is_active,
                    t.is_active AS tenant_active, t.subscription_status, t.unlimited_access, t.trial_ends_at, t.current_period_ends_at
             FROM users u
             LEFT JOIN tenants t ON t.id = u.company_id
             WHERE LOWER(u.email) = LOWER($1)
             LIMIT 1`,
            [email]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = userResult.rows[0];

        const passwordOk = await bcrypt.compare(String(password), user.password_hash || '');
        if (!passwordOk) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!user.is_active) {
            return res.status(403).json({ error: 'User account is inactive' });
        }

        if (user.company_id) {
            const access = evaluateTenantAccess(user, timeService.getNow());
            if (!access.allowed) {
                if (access.reason === 'trial_expired') {
                    await sendTrialExpiredNotificationIfNeeded(user.company_id);
                }
                return res.status(403).json({ error: access.message || 'Tenant subscription is inactive' });
            }
        }

        const token = signToken(user);

        return res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                role: user.role,
                company_id: user.company_id
            }
        });
    } catch (error) {
        console.error('loginSaasUser error:', error);
        return res.status(500).json({ error: 'Failed to login user' });
    }
};

const getPlansIsPopularSelectExpression = async () => {
    if (cachedPlansHasIsPopularColumn === null) {
        const result = await db.query(
            `SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'plans'
                  AND column_name = 'is_popular'
            ) AS exists`
        );
        cachedPlansHasIsPopularColumn = Boolean(result.rows[0]?.exists);
    }

    return cachedPlansHasIsPopularColumn
        ? 'is_popular'
        : 'FALSE::boolean AS is_popular';
};

const getPublicPlans = async (_req, res) => {
    try {
        const plansIsPopularSelect = await getPlansIsPopularSelectExpression();
        const [plansResult, landingVideoResult, landingVideoEnabledResult] = await Promise.all([
            db.query(
                `SELECT
                    id,
                    code,
                    name,
                    monthly_price,
                    currency,
                    trial_days,
                    max_company_admins,
                    max_project_managers,
                    max_employees,
                    ${plansIsPopularSelect}
                 FROM plans
                 WHERE is_active = TRUE
                 ORDER BY monthly_price ASC, name ASC`
            ),
            db.query(
                `SELECT value
                 FROM settings
                 WHERE key = 'landing_hero_video_url'
                   AND company_id IS NULL
                 LIMIT 1`
            ),
            db.query(
                `SELECT value
                 FROM settings
                 WHERE key = 'landing_hero_video_enabled'
                   AND company_id IS NULL
                 LIMIT 1`
            )
        ]);

        const enabledRaw = String(landingVideoEnabledResult.rows[0]?.value || 'true').trim().toLowerCase();
        const landingVideoEnabled = enabledRaw === 'true' || enabledRaw === '1' || enabledRaw === 'yes' || enabledRaw === 'on';
        const landingVideoUrl = String(landingVideoResult.rows[0]?.value || '').trim();

        return res.json({
            plans: plansResult.rows,
            landing_video_url: landingVideoEnabled ? landingVideoUrl : '',
            landing_video_enabled: landingVideoEnabled
        });
    } catch (error) {
        console.error('getPublicPlans error:', error);
        return res.status(500).json({ error: 'Failed to load plans', details: error.message });
    }
};

const signupTenantWithGoogle = async (req, res) => {
    const { companyName, companySlug, idToken, accessToken, planCode = 'FREE' } = req.body || {};

    if (!companyName || (!idToken && !accessToken)) {
        return res.status(400).json({ error: 'companyName and idToken or accessToken are required' });
    }

    const slug = normalizeSlug(companySlug || companyName);
    if (!slug) {
        return res.status(400).json({ error: 'Invalid company name/slug' });
    }

    let payload;
    try {
        if (idToken) {
            const ticket = await googleClient.verifyIdToken({
                idToken,
                audience: process.env.GOOGLE_CLIENT_ID
            });
            payload = ticket.getPayload();
        } else if (accessToken) {
            const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            payload = await response.json();
        }
    } catch (error) {
        return res.status(401).json({ error: 'Invalid Google token' });
    }

    const googleEmail = String(payload?.email || '').trim().toLowerCase();
    const googleName = String(payload?.name || '').trim() || 'Company Admin';

    if (!googleEmail) {
        return res.status(400).json({ error: 'Google account email is required' });
    }

    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        const planResult = await client.query(
            `SELECT id, trial_days
             FROM plans
             WHERE code = UPPER($1)
               AND is_active = TRUE
             LIMIT 1`,
            [planCode]
        );

        if (planResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Selected plan is not available' });
        }

        const plan = planResult.rows[0];
        const trialEndsAt = Number(plan.trial_days) > 0
            ? new Date(Date.now() + Number(plan.trial_days) * 24 * 60 * 60 * 1000)
            : null;

        const tenantInsert = await client.query(
            `INSERT INTO tenants (name, slug, plan_id, subscription_status, trial_ends_at, is_active)
             VALUES ($1, $2, $3, $4, $5, TRUE)
             RETURNING id, name, slug, plan_id, subscription_status, trial_ends_at`,
            [companyName, slug, plan.id, trialEndsAt ? 'trialing' : 'active', trialEndsAt]
        );

        // users.password_hash is required. For Google-only signup, store random secret hash.
        const randomSecret = crypto.randomBytes(32).toString('hex');
        const bcryptRounds = Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
        const hashedPassword = await bcrypt.hash(randomSecret, bcryptRounds);

        const userInsert = await client.query(
            `INSERT INTO users (full_name, email, username, password_hash, role, company_id, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE)
             RETURNING id, full_name, email, role, company_id`,
            [
                googleName,
                googleEmail,
                googleEmail,
                hashedPassword,
                SAAS_ROLES.COMPANY_ADMIN,
                tenantInsert.rows[0].id
            ]
        );

        await client.query('COMMIT');

        const user = userInsert.rows[0];
        const token = signToken(user);

        return res.status(201).json({
            message: 'Tenant and company admin created with Google',
            token,
            tenant: tenantInsert.rows[0],
            user,
            requiresProfileCompletion: true
        });
    } catch (error) {
        await client.query('ROLLBACK');

        if (error.code === '23505') {
            return res.status(409).json({ error: 'Company or email already exists' });
        }

        console.error('signupTenantWithGoogle error:', error);
        return res.status(500).json({ error: 'Failed to create tenant with Google' });
    } finally {
        client.release();
    }
};

module.exports = {
    signupTenantWithAdmin,
    loginSaasUser,
    signupTenantWithGoogle,
    getPublicPlans
};
