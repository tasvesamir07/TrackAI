const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const db = require('../db');
const { logActivity } = require('./activityController');
const timeService = require('../utils/timeService');
const attendanceService = require('../utils/attendanceService');
const { uploadIncomingFile } = require('../utils/storageService');
const { assertEmailAllowedByPolicy, loadEmailDomainPolicy } = require('../utils/emailDomainPolicy');
const { evaluateTenantAccess } = require('../utils/subscriptionAccess');
const { sendTrialExpiredEmail } = require('../utils/emailService');
const { isWorkDay, processMissedDays } = attendanceService;
const whatsappService = require('../utils/whatsappService');
const scheduler = require('../scheduler');
const telegramService = require('../utils/telegramService');
const { runInBackground } = require('../utils/background');
const BCRYPT_ROUNDS = Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const WORK_ACTIVE_STATUSES = new Set(['active', 'break']);
const WORK_TRACKED_ROLES = new Set(['employee', 'EMPLOYEE']);
const isWorkTrackedRole = (role) => WORK_TRACKED_ROLES.has(String(role || ''));

const getUserCompanyId = async (userId) => {
    const res = await db.query('SELECT company_id FROM users WHERE deleted_at IS NULL AND id = $1 LIMIT 1', [userId]);
    return res.rows[0]?.company_id || null;
};

const getScopedSettingValue = async (key, companyId) => {
    const res = await db.query(
        `SELECT value
         FROM settings
         WHERE key = $1
           AND (company_id = $2::uuid OR company_id IS NULL)
         ORDER BY CASE WHEN company_id = $2::uuid THEN 0 ELSE 1 END
         LIMIT 1`,
        [key, companyId]
    );
    return res.rows[0]?.value ?? null;
};

const hasAnyNonEmptyValue = (value) => {
    if (!value) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'object') {
        return Object.values(value).some((item) => String(item || '').trim().length > 0);
    }
    return false;
};

const hasProfileSetForPasswordChange = (userRow) => {
    if (!userRow) return false;

    const bankDetailsRequired = isWorkTrackedRole(userRow.role);
    const email = String(userRow.email || '').trim();
    const contactNumber = String(userRow.contact_number || '').trim();

    let bankDetails = userRow.bank_details;
    if (typeof bankDetails === 'string') {
        const trimmed = bankDetails.trim();
        if (!trimmed) {
            bankDetails = '';
        } else {
            try {
                bankDetails = JSON.parse(trimmed);
            } catch (_) {
                bankDetails = trimmed;
            }
        }
    }

    return Boolean(email && contactNumber && (!bankDetailsRequired || hasAnyNonEmptyValue(bankDetails)));
};

const USERNAME_REGEX = /^[a-z]+$/;

const isStrictUsername = (value) => USERNAME_REGEX.test(String(value || '').trim());

const PLAN_CHANGE_ELIGIBLE_ROLES = new Set(['company_admin', 'admin']);
const normalizeRoleKey = (role) => {
    const normalized = String(role || '').trim().toLowerCase();
    if (normalized === 'superadmin' || normalized === 'super_admin') return 'super_admin';
    if (normalized === 'project_manager') return 'moderator';
    if (normalized === 'company_admin') return 'company_admin';
    return normalized;
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

const getConfiguredCookieSameSite = (req) => {
    const raw = String(process.env.COOKIE_SAMESITE || '').trim().toLowerCase();
    if (raw === 'strict' || raw === 'lax' || raw === 'none') return raw;

    // Default to lax for better stability across refresh/navigation while still being CSRF-aware.
    // For split frontend/backend deployments on different sites, set COOKIE_SAMESITE=none.
    return 'lax';
};

const getTokenCookieBaseOptions = (req) => {
    const sameSite = getConfiguredCookieSameSite(req);
    const cookieDomain = String(process.env.COOKIE_DOMAIN || '').trim();

    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || sameSite === 'none',
        sameSite,
        path: '/'
    };

    if (cookieDomain) {
        options.domain = cookieDomain;
    }

    return options;
};

const clearTokenCookieEverywhere = (req, res) => {
    const base = getTokenCookieBaseOptions(req);
    const candidates = [
        base,
        { ...base, domain: undefined },
        { ...base, sameSite: 'lax' },
        { ...base, sameSite: 'strict' },
        { ...base, sameSite: 'none', secure: true },
        { ...base, sameSite: 'none', secure: false },
    ];

    const seen = new Set();
    for (const option of candidates) {
        const key = JSON.stringify(option);
        if (seen.has(key)) continue;
        seen.add(key);
        res.clearCookie('token', option);
    }
};

const login = async (req, res) => {
    const identifier = String(req.body?.identifier || req.body?.username || req.body?.email || '').trim();
    const password = String(req.body?.password || '');

    if (!identifier || !password) {
        return res.status(400).json({ error: 'Username/email and password are required' });
    }

    try {
        if (req.user?.id) {
            const activeSessionRes = await db.query(
                'SELECT id, username, status, role FROM users WHERE deleted_at IS NULL AND id = $1 LIMIT 1',
                [req.user.id]
            );
            const activeSessionUser = activeSessionRes.rows[0];

            if (activeSessionUser && isWorkTrackedRole(activeSessionUser.role) && WORK_ACTIVE_STATUSES.has(activeSessionUser.status)) {
                return res.status(409).json({
                    error: `You are signed in for work as ${activeSessionUser.username}. Please sign out from work first.`,
                    requiresSignOut: true,
                    currentUser: {
                        id: activeSessionUser.id,
                        username: activeSessionUser.username,
                        status: activeSessionUser.status
                    }
                });
            }
        }

        // Check if user exists — email identifiers (containing @) only match the email
        // column to avoid false matches against email-shaped usernames.
        const isEmailIdentifier = identifier.includes('@');
        const whereClause = isEmailIdentifier
            ? 'LOWER(u.email) = LOWER($1)'
            : 'LOWER(u.username) = LOWER($1) OR LOWER(u.email) = LOWER($1)';
        const result = await db.query(
            `SELECT
                u.*,
                t.is_active AS tenant_is_active,
                t.subscription_status,
                t.unlimited_access,
                t.trial_ends_at,
                t.current_period_ends_at
             FROM users u
             LEFT JOIN tenants t ON t.id = u.company_id
             WHERE ${whereClause}
             ORDER BY u.id DESC
             LIMIT 1`,
            [identifier]
        );
        const user = result.rows[0];

        if (!user) {
            return res.status(400).json({ error: 'Invalid username/email or password' });
        }

        // Check password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid username/email or password' });
        }

        if (user.company_id) {
            const access = evaluateTenantAccess({
                tenant_active: user.tenant_is_active,
                subscription_status: user.subscription_status,
                unlimited_access: user.unlimited_access,
                trial_ends_at: user.trial_ends_at,
                current_period_ends_at: user.current_period_ends_at
            }, timeService.getNow());
            if (!access.allowed) {
                if (access.reason === 'trial_expired') {
                    await sendTrialExpiredNotificationIfNeeded(user.company_id);
                }
                return res.status(403).json({ error: access.message || 'Your company subscription is inactive. Please contact support.' });
            }
        }

        if (!isWorkTrackedRole(user.role) && WORK_ACTIVE_STATUSES.has(user.status)) {
            await db.query('UPDATE users SET status = $1 WHERE id = $2', ['inactive', user.id]);
        }

        // Generate Token
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, company_id: user.company_id || null },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        // Send session cookie (cross-origin aware for Railway split deployments).
        res.cookie('token', token, {
            ...getTokenCookieBaseOptions(req),
            maxAge: 24 * 60 * 60 * 1000 // 1 day
        });

        // REMOVED: checkOfflineGap logic that was auto-signing out users on login
        // Users now have full manual control over their work status.



        res.json({
            message: 'Login successful',
            role: user.role,
            user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const googleLogin = async (req, res) => {
    const { idToken } = req.body;

    if (!idToken) {
        return res.status(400).json({ error: 'Google ID token is required' });
    }

    try {
        let email;
        
        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        email = payload['email'];

        if (!email) {
            return res.status(400).json({ error: 'Could not retrieve email from Google account' });
        }

        // Find user by email
        const result = await db.query(
            `SELECT
                u.*,
                t.is_active AS tenant_is_active,
                t.subscription_status,
                t.unlimited_access,
                t.trial_ends_at,
                t.current_period_ends_at
             FROM users u
             LEFT JOIN tenants t ON t.id = u.company_id
             WHERE LOWER(u.email) = LOWER($1)
             LIMIT 1`,
            [email]
        );
        const user = result.rows[0];

        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        if (user.company_id) {
            const access = evaluateTenantAccess({
                tenant_active: user.tenant_is_active,
                subscription_status: user.subscription_status,
                unlimited_access: user.unlimited_access,
                trial_ends_at: user.trial_ends_at,
                current_period_ends_at: user.current_period_ends_at
            }, timeService.getNow());
            if (!access.allowed) {
                if (access.reason === 'trial_expired') {
                    await sendTrialExpiredNotificationIfNeeded(user.company_id);
                }
                return res.status(403).json({ error: access.message || 'Your company subscription is inactive. Please contact support.' });
            }
        }

        // Check if user is already signed in for work (similar to regular login)
        if (req.user?.id) {
             const activeSessionRes = await db.query(
                'SELECT id, username, status, role FROM users WHERE deleted_at IS NULL AND id = $1 LIMIT 1',
                [req.user.id]
            );
            const activeSessionUser = activeSessionRes.rows[0];

            if (activeSessionUser && isWorkTrackedRole(activeSessionUser.role) && WORK_ACTIVE_STATUSES.has(activeSessionUser.status) && activeSessionUser.id !== user.id) {
                return res.status(409).json({
                    error: `You are signed in for work as ${activeSessionUser.username}. Please sign out from work first.`,
                    requiresSignOut: true,
                    currentUser: {
                        id: activeSessionUser.id,
                        username: activeSessionUser.username,
                        status: activeSessionUser.status
                    }
                });
            }
        }

        // Generate Token
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, company_id: user.company_id || null },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        // Send session cookie
        res.cookie('token', token, {
            ...getTokenCookieBaseOptions(req),
            maxAge: 24 * 60 * 60 * 1000 // 1 day
        });

        res.json({
            message: 'Google login successful',
            role: user.role,
            user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role }
        });

    } catch (err) {
        console.error('Google Login Error:', err);
        res.status(401).json({ error: 'Invalid Google ID token or server error' });
    }
};

const logout = async (req, res) => {
    if (req.user?.id) {
        try {
            const activeSessionRes = await db.query(
                'SELECT id, username, status, role FROM users WHERE deleted_at IS NULL AND id = $1 LIMIT 1',
                [req.user.id]
            );
            const activeSessionUser = activeSessionRes.rows[0];

            if (activeSessionUser && isWorkTrackedRole(activeSessionUser.role) && WORK_ACTIVE_STATUSES.has(activeSessionUser.status)) {
                return res.status(409).json({
                    error: `You are signed in for work as ${activeSessionUser.username}. Please sign out from work first.`,
                    requiresSignOut: true,
                    currentUser: {
                        id: activeSessionUser.id,
                        username: activeSessionUser.username,
                        status: activeSessionUser.status
                    }
                });
            }
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'Server error' });
        }
    }

    clearTokenCookieEverywhere(req, res);
    res.json({ message: 'Logged out successfully' });
};

//// calculateHoursWorkedToday moved to attendanceService.js

const signOut = async (req, res) => {
    const { reason, coverLeaveId, coverLeaveIds, todaysTask } = req.body || {};
    const userId = req.user.id;

    try {
        const roleRes = await db.query('SELECT role, status FROM users WHERE deleted_at IS NULL AND id = $1', [userId]);
        const currentRole = roleRes.rows[0]?.role;
        const currentStatus = roleRes.rows[0]?.status;
        if (!isWorkTrackedRole(currentRole)) {
            const normalizedRes = currentStatus !== 'inactive'
                ? await db.query(
                    'UPDATE users SET status = $1 WHERE id = $2 RETURNING id, username, role, status, department',
                    ['inactive', userId]
                )
                : await db.query(
                    'SELECT id, username, role, status, department FROM users WHERE deleted_at IS NULL AND id = $1',
                    [userId]
                );
            return res.json({
                message: 'Work sign-out is not applicable for this role.',
                canSignOut: false,
                user: normalizedRes.rows[0] || null,
                hoursWorked: 0,
                currentSessionHours: 0,
                sessionStartTime: null,
                minutesBalance: null
            });
        }

        const attendanceService = require('../utils/attendanceService');
        const io = req.app.get('io');

        const signOutResult = await attendanceService.signOut(userId, {
            reason,
            coverLeaveIds: coverLeaveIds || (coverLeaveId ? [coverLeaveId] : []),
            todaysTask,
            forceTaskCheck: true
        }, io);

        res.json({
            message: signOutResult.isCoveringSpecificLeave ? 'Signed out and leave covered successfully' : 'Signed out successfully',
            canSignOut: true,
            user: signOutResult.user,
            hoursWorked: Math.round(signOutResult.totalHours * 100) / 100,
            currentSessionHours: Math.round(signOutResult.currentSessionHours * 100) / 100,
            sessionStartTime: signOutResult.sessionStartTime,
            minutesBalance: signOutResult.user.minutes_balance
        });
    } catch (err) {
        if (err.statusCode === 400) {
            return res.status(400).json({ error: err.message });
        }
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const refreshOvertimeAlert = async (userId) => {
    try {
        const companyId = await getUserCompanyId(userId);
        // 1. Get Settings
        const settingsRaw = await getScopedSettingValue('overtime_settings', companyId);
        if (!settingsRaw) return;
        const settings = JSON.parse(settingsRaw);
        if (!settings.enabled || !settings.threshold) {
            await scheduler.cancelOvertimeAlert(userId);
            return;
        }

        const thresholdHours = parseFloat(settings.threshold);

        // 2. Get Worked Hours
        const { currentSessionHours } = await attendanceService.calculateHoursWorkedToday(userId);

        // 3. Calculate Target Time
        const remainingHours = thresholdHours - currentSessionHours;

        if (remainingHours <= 0) {
            // Threshold already reached, schedule for immediate processing (now)
            await scheduler.scheduleOvertimeAlert(userId, timeService.getNow());
        } else {
            // Schedule for the future
            const now = timeService.getNow();
            const targetTime = new Date(now.getTime() + (remainingHours * 60 * 60 * 1000));
            await scheduler.scheduleOvertimeAlert(userId, targetTime);
        }
    } catch (err) {
        console.error(`[Auth] Failed to refresh overtime alert for ${userId}:`, err);
    }
};

const refreshDailyGoalAlert = async (userId) => {
    try {
        const companyId = await getUserCompanyId(userId);
        // 1. Get Settings
        const settingsRaw = await getScopedSettingValue('work_hours', companyId);
        const settings = settingsRaw ? JSON.parse(settingsRaw) : { standardHours: 4 };
        const standardHours = settings.standardHours || 4;

        // 2. Get Worked Hours
        const { totalHours } = await attendanceService.calculateHoursWorkedToday(userId);

        // 3. Calculate Target Time
        const remainingHours = standardHours - totalHours;

        if (remainingHours <= 0) {
            // Goal already reached, schedule for immediate processing (now)
            await scheduler.scheduleDailyGoalAlert(userId, timeService.getNow());
        } else {
            // Schedule for the future
            const now = timeService.getNow();
            const targetTime = new Date(now.getTime() + (remainingHours * 60 * 60 * 1000));
            await scheduler.scheduleDailyGoalAlert(userId, targetTime);
        }
    } catch (err) {
        console.error(`[Auth] Failed to refresh daily goal alert for ${userId}:`, err);
    }
};

const me = async (req, res) => {
    if (!req.user) {
        return res.json({ user: null });
    }
    try {
        // Non-critical background sync: never block /auth/me on this.
        try {
            await processMissedDays(req.user.id, req.app.get('io'));
        } catch (syncErr) {
            console.error('[Auth/me] processMissedDays failed:', syncErr.message || syncErr);
        }

        const enrichedUserQuery = `SELECT
                u.id,
                u.full_name,
                u.username,
                u.role,
                u.status,
                u.department,
                u.email,
                u.contact_number,
                u.bank_details,
                u.minutes_balance,
                u.paid_leave_balance,
                u.profile_picture,
                u.telegram_chat_id,
                u.created_at,
                t.subscription_status,
                t.trial_ends_at,
                t.current_period_ends_at,
                t.unlimited_access,
                p.name AS plan_name,
                p.code AS plan_code,
                p.max_company_admins,
                p.max_project_managers,
                p.max_employees,
                (
                    SELECT COUNT(*)::int
                    FROM users cu
                    WHERE cu.company_id = u.company_id
                      AND cu.role IN ('COMPANY_ADMIN', 'admin')
                ) AS used_company_admins,
                (
                    SELECT COUNT(*)::int
                    FROM users cu
                    WHERE cu.company_id = u.company_id
                      AND cu.role IN ('PROJECT_MANAGER', 'moderator')
                ) AS used_project_managers,
                (
                    SELECT COUNT(*)::int
                    FROM users cu
                    WHERE cu.company_id = u.company_id
                      AND cu.role IN ('EMPLOYEE', 'employee')
                ) AS used_employees
             FROM users u
             LEFT JOIN tenants t ON t.id = u.company_id
             LEFT JOIN plans p ON p.id = t.plan_id
             WHERE u.id = $1
             LIMIT 1`;

        const basicUserQuery = `SELECT
                u.id,
                u.full_name,
                u.username,
                u.role,
                u.status,
                u.department,
                u.email,
                u.contact_number,
                u.bank_details,
                u.minutes_balance,
                NULL::numeric AS paid_leave_balance,
                u.profile_picture,
                u.telegram_chat_id,
                u.created_at,
                NULL::text AS subscription_status,
                NULL::timestamp AS trial_ends_at,
                NULL::timestamp AS current_period_ends_at,
                NULL::boolean AS unlimited_access,
                NULL::text AS plan_name,
                NULL::text AS plan_code,
                NULL::int AS max_company_admins,
                NULL::int AS max_project_managers,
                NULL::int AS max_employees,
                0::int AS used_company_admins,
                0::int AS used_project_managers,
                0::int AS used_employees
             FROM users u
             WHERE u.id = $1
             LIMIT 1`;

        let result;
        try {
            result = await db.query(enrichedUserQuery, [req.user.id]);
        } catch (enrichedErr) {
            console.error('[Auth/me] Enriched user query failed, falling back to basic query:', enrichedErr.message || enrichedErr);
            result = await db.query(basicUserQuery, [req.user.id]);
        }

        // Calculate hours worked today (non-fatal for /auth/me).
        let totalHours = 0;
        let currentSessionHours = 0;
        let sessionStartTime = null;
        let coveredDate = null;
        try {
            const hours = await attendanceService.calculateHoursWorkedToday(req.user.id);
            totalHours = Number(hours?.totalHours || 0);
            currentSessionHours = Number(hours?.currentSessionHours || 0);
            sessionStartTime = hours?.sessionStartTime || null;
            coveredDate = hours?.coveredDate || null;
        } catch (hoursErr) {
            console.error('[Auth/me] calculateHoursWorkedToday failed:', hoursErr.message || hoursErr);
        }

        // Check if user has already signed out today (Virtual Time)
        const virtualNow = timeService.getNow();
        const virtualMidnight = new Date(virtualNow);
        virtualMidnight.setHours(0, 0, 0, 0);

        let hasSignedOutToday = false;
        try {
            const signOutCheck = await db.query(
                `SELECT id FROM activity_logs 
                 WHERE user_id = $1 
                 AND activity_type = 'sign_out' 
                 AND timestamp >= $2 
                 LIMIT 1`,
                [req.user.id, virtualMidnight]
            );
            hasSignedOutToday = signOutCheck.rows.length > 0;
        } catch (signOutErr) {
            console.error('[Auth/me] sign_out check failed:', signOutErr.message || signOutErr);
        }

        // Check for pending profile update request
        let hasPendingRequest = false;
        try {
            const pendingRequestCheck = await db.query(
                'SELECT id FROM profile_update_requests WHERE user_id = $1 AND status = \'pending\' LIMIT 1',
                [req.user.id]
            );
            hasPendingRequest = pendingRequestCheck.rows.length > 0;
        } catch (pendingErr) {
            console.error('[Auth/me] pending profile request check failed:', pendingErr.message || pendingErr);
        }

        // Check for handled but not yet notified request
        let latestHandledRequest = null;
        try {
            const handledRequestCheck = await db.query(
                'SELECT status, rejection_reason FROM profile_update_requests WHERE user_id = $1 AND status IN (\'approved\', \'rejected\') AND user_notified = false ORDER BY handled_at DESC LIMIT 1',
                [req.user.id]
            );
            latestHandledRequest = handledRequestCheck.rows[0] || null;
        } catch (handledErr) {
            console.error('[Auth/me] handled profile request check failed:', handledErr.message || handledErr);
        }

        let telegramBotUsername = null;
        try {
            telegramBotUsername = telegramService.getBotUsername();
        } catch (tgErr) {
            console.error('[Auth/me] telegram bot username fetch failed:', tgErr.message || tgErr);
        }

        const baseUser = result?.rows?.[0] || null;
        if (!baseUser) {
            return res.json({ user: null, hoursWorked: 0, currentSessionHours: 0, sessionStartTime: null, coveredDate: null, telegramBotUsername });
        }

        res.json({
            user: { ...baseUser, hasSignedOutToday, hasPendingRequest, latestHandledRequest, coveredDate },
            hoursWorked: totalHours,
            currentSessionHours,
            sessionStartTime,
            coveredDate,
            telegramBotUsername
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getPlanOptions = async (req, res) => {
    try {
        const userRes = await db.query(
            `SELECT company_id, role
             FROM users
             WHERE id = $1
               AND deleted_at IS NULL
             LIMIT 1`,
            [req.user.id]
        );
        const currentUser = userRes.rows[0];
        if (!currentUser?.company_id) {
            return res.status(400).json({ error: 'No company is linked to this account' });
        }
        if (!PLAN_CHANGE_ELIGIBLE_ROLES.has(normalizeRoleKey(currentUser.role))) {
            return res.status(403).json({ error: 'Only company admins can change plan' });
        }

        const currentPlanRes = await db.query(
            `SELECT p.id, p.code, p.name, p.monthly_price
             FROM tenants t
             JOIN plans p ON p.id = t.plan_id
             WHERE t.id = $1
             LIMIT 1`,
            [currentUser.company_id]
        );
        if (currentPlanRes.rows.length === 0) {
            return res.status(404).json({ error: 'Current plan not found' });
        }
        const currentPlan = currentPlanRes.rows[0];
        const currentPrice = Number(currentPlan.monthly_price || 0);

        const upgradePlansRes = await db.query(
            `SELECT id, code, name, monthly_price, currency, trial_days, max_company_admins, max_project_managers, max_employees
             FROM plans
             WHERE is_active = TRUE
               AND monthly_price > $1
             ORDER BY monthly_price ASC`,
            [currentPrice]
        );

        return res.json({
            current_plan: currentPlan,
            upgrade_options: upgradePlansRes.rows
        });
    } catch (error) {
        console.error('getPlanOptions error:', error);
        return res.status(500).json({ error: 'Failed to load plan options' });
    }
};

const upgradeMyCompanyPlan = async (req, res) => {
    const planIdentifier = String(req.body?.planId || req.body?.planCode || '').trim();
    if (!planIdentifier) {
        return res.status(400).json({ error: 'planId or planCode is required' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const userRes = await client.query(
            `SELECT company_id, role
             FROM users
             WHERE id = $1
               AND deleted_at IS NULL
             LIMIT 1`,
            [req.user.id]
        );
        const currentUser = userRes.rows[0];
        if (!currentUser?.company_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No company is linked to this account' });
        }
        if (!PLAN_CHANGE_ELIGIBLE_ROLES.has(normalizeRoleKey(currentUser.role))) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Only company admins can change plan' });
        }

        const tenantPlanRes = await client.query(
            `SELECT p.id, p.code, p.name, p.monthly_price
             FROM tenants t
             JOIN plans p ON p.id = t.plan_id
             WHERE t.id = $1
             LIMIT 1`,
            [currentUser.company_id]
        );
        const currentPlan = tenantPlanRes.rows[0];
        if (!currentPlan) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Current plan not found' });
        }

        const targetPlanRes = await client.query(
            `SELECT id, code, name, monthly_price
             FROM plans
             WHERE is_active = TRUE
               AND (id::text = $1 OR code = UPPER($1))
             LIMIT 1`,
            [planIdentifier]
        );
        const targetPlan = targetPlanRes.rows[0];
        if (!targetPlan) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Target plan not found' });
        }

        const currentPrice = Number(currentPlan.monthly_price || 0);
        const targetPrice = Number(targetPlan.monthly_price || 0);
        if (targetPrice <= currentPrice) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Downgrade or same-plan change is not allowed. Choose a higher plan.' });
        }

        const now = timeService.getNow();
        const nextPeriod = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));

        await client.query(
            `UPDATE tenants
             SET plan_id = $1,
                 subscription_status = 'active',
                 trial_ends_at = $2,
                 current_period_ends_at = $3,
                 last_payment_at = $2,
                 updated_at = NOW()
             WHERE id = $4`,
            [targetPlan.id, now, nextPeriod, currentUser.company_id]
        );

        await client.query('COMMIT');
        return res.json({
            message: 'Plan upgraded successfully',
            previous_plan: currentPlan,
            current_plan: targetPlan,
            upgraded_at_ms: now.getTime(),
            current_period_ends_at_ms: nextPeriod.getTime()
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('upgradeMyCompanyPlan error:', error);
        return res.status(500).json({ error: 'Failed to upgrade plan' });
    } finally {
        client.release();
    }
};

const signIn = async (req, res) => {
    const { plan, location } = req.body;
    const userId = req.user.id;
    const today = timeService.getDateStr(timeService.getNow());

    const { coveredDate } = req.body;

    try {
        const io = req.app.get('io');
        const statusRes = await db.query('SELECT status, role FROM users WHERE deleted_at IS NULL AND id = $1', [userId]);
        const currentStatus = statusRes.rows[0]?.status;
        const currentRole = statusRes.rows[0]?.role;

        if (!isWorkTrackedRole(currentRole)) {
            return res.status(403).json({ error: 'Work sign-in is only available for employee accounts.' });
        }

        // If covering a specific date, ensure we sign out of any current session first
        // to start a fresh timer for the coverage.
        if (coveredDate) {
            if (currentStatus !== 'inactive') {
                const { signOut } = require('../utils/attendanceService');
                await signOut(userId, { reason: 'Switching to Covering Leave', forceTaskCheck: false }, io);
            }
        } else if (currentStatus === 'active') {
            return res.status(409).json({ error: 'You are already signed in.' });
        } else if (currentStatus === 'break') {
            // Treat sign-in while on break as resume to avoid creating an extra session.
            const latestSignIn = await db.query(
                "SELECT covered_date FROM activity_logs WHERE user_id = $1 AND activity_type = 'sign_in' ORDER BY timestamp DESC LIMIT 1",
                [userId]
            );
            const resumedCoveredDate = latestSignIn.rows[0]?.covered_date || null;

            const resumedUser = await db.query(
                'UPDATE users SET status = $1 WHERE id = $2 RETURNING id, username, role, status, department',
                ['active', userId]
            );

            await logActivity(userId, 'break_end', io, null, resumedCoveredDate);
            await refreshOvertimeAlert(userId);
            await refreshDailyGoalAlert(userId);

            if (io) {
                io.emit('status_update', { userId, status: 'active' });
            }

            return res.json({
                message: 'Break ended successfully',
                user: resumedUser.rows[0]
            });
        }

        // 0. CHECK PROFILE COMPLETION
        const userProfile = await db.query(
            'SELECT email, contact_number, bank_details, role, full_name FROM users WHERE deleted_at IS NULL AND id = $1',
            [userId]
        );
        const userData = userProfile.rows[0];

        if (isWorkTrackedRole(userData.role)) {
            if (!userData.email?.trim() || !userData.contact_number?.trim() || !userData.bank_details?.trim()) {
                return res.status(400).json({
                    error: 'Please complete your profile (Email, Contact, Bank Details) before signing in.'
                });
            }
        }

        // 1. Update Status to 'active'
        const result = await db.query(
            'UPDATE users SET status = $1 WHERE id = $2 RETURNING id, username, role, status, department',
            ['active', userId]
        );

        // 2. Log Activity
        await logActivity(userId, 'sign_in', io, null, coveredDate);

        // 3. Catch up on missed workdays AFTER signing in
        // This ensures the current session's date is already logged or protected
        await processMissedDays(userId, io);
        // 4. Schedule Alerts
        await refreshOvertimeAlert(userId);
        await refreshDailyGoalAlert(userId);

        // 5. Notify
        if (io) {
            io.emit('status_update', { userId, status: 'active' });
        }

        // 6. Save location if shared (Don't notify admin right away)
        if (location && userData.role === 'employee') {
            await db.query(
                'UPDATE users SET last_latitude = $1, last_longitude = $2, last_location_update = CURRENT_TIMESTAMP WHERE id = $3',
                [location.latitude, location.longitude, userId]
            );
        }

        res.json({
            message: 'Signed in successfully',
            user: result.rows[0]
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const updateStatus = async (req, res) => {
    const { status, location } = req.body;
    const userId = req.user.id;

    if (!['active', 'break', 'inactive'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        const currentUser = await db.query('SELECT status, role FROM users WHERE deleted_at IS NULL AND id = $1', [userId]);
        const previousStatus = currentUser.rows[0]?.status;
        const currentRole = currentUser.rows[0]?.role;

        if (!isWorkTrackedRole(currentRole) && status !== 'inactive') {
            return res.status(403).json({ error: 'Work status updates are only available for employee accounts.' });
        }

        const result = await db.query(
            'UPDATE users SET status = $1 WHERE id = $2 RETURNING id, username, role, status, department',
            [status, userId]
        );

        const io = req.app.get('io');
        if (status === 'break' && previousStatus !== 'break') {
            await logActivity(userId, 'break_start', io);
            await scheduler.cancelOvertimeAlert(userId);
            await scheduler.cancelDailyGoalAlert(userId);
        } else if (status === 'active' && previousStatus === 'break') {
            await logActivity(userId, 'break_end', io);
            await refreshOvertimeAlert(userId);
            await refreshDailyGoalAlert(userId);
        } else if (status === 'inactive') {
            await scheduler.cancelOvertimeAlert(userId);
            await scheduler.cancelDailyGoalAlert(userId);
        }

        if (io) {
            io.emit('status_update', { userId, status: result.rows[0].status });
        }

        if (status === 'active' && location && result.rows[0].role === 'employee') {
            await db.query(
                'UPDATE users SET last_latitude = $1, last_longitude = $2, last_location_update = CURRENT_TIMESTAMP WHERE id = $3',
                [location.latitude, location.longitude, userId]
            );
        }

        res.json({ user: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getColleagues = async (req, res) => {
    try {
        // Employees can see manager contacts (admin + moderator); all other returned fields remain non-sensitive.
        const includeManagerContacts = req.user?.role === 'employee';
        const result = await db.query(`
            SELECT 
                u.id, u.full_name, u.username, u.role, u.status, u.department, u.profile_picture,
                CASE WHEN $1::boolean AND u.role = ANY($2::text[]) THEN u.email ELSE NULL END AS email,
                CASE WHEN $1::boolean AND u.role = ANY($2::text[]) THEN u.contact_number ELSE NULL END AS contact_number,
                (SELECT covered_date FROM activity_logs 
                 WHERE user_id = u.id AND activity_type = 'sign_in' 
                 ORDER BY timestamp DESC LIMIT 1) as covered_date
            FROM users u 
            WHERE u.role = ANY($3::text[])
              AND (
                  u.company_id IS NULL OR u.company_id = $4::uuid
              )
            ORDER BY username ASC
        `, [
            includeManagerContacts,
            ['admin', 'moderator'],
            includeManagerContacts ? ['employee', 'admin', 'moderator'] : ['employee'],
            req.user.company_id || null
        ]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const heartbeat = async (req, res) => {
    try {
        const { location } = req.body;
        const userId = req.user.id;

        // Update heartbeat timestamp
        const result = await db.query('UPDATE users SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = $1 RETURNING status, role', [userId]);
        const user = result.rows[0];

        // Update location ONLY if user is active
        if (user.status === 'active' && user.role === 'employee' && location && location.latitude && location.longitude) {
            await db.query(
                'UPDATE users SET last_latitude = $1, last_longitude = $2, last_location_update = CURRENT_TIMESTAMP WHERE id = $3',
                [location.latitude, location.longitude, userId]
            );
        }

        res.json({ status: 'ok' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const updateProfile = async (req, res) => {
    const body = req.body || {};
    const full_name = String(body.full_name || '').trim();
    const username = String(body.username || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const contact_number = String(body.contact_number || '').trim();
    const role = req.user?.role;
    const isBankDetailsRequired = role === 'employee' || role === 'EMPLOYEE';
    const parseBankDetails = (value) => {
        if (!value) return {};
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return {};
            try {
                const parsed = JSON.parse(trimmed);
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (_err) {
                return {};
            }
        }
        return typeof value === 'object' ? value : {};
    };
    const bankDetailsObject = parseBankDetails(body.bank_details);
    const bank_details = JSON.stringify(bankDetailsObject);
    const hasCompleteBankDetails = ['bank_name', 'account_holder_name', 'account_number', 'branch_name', 'routing_number']
        .every((key) => String(bankDetailsObject?.[key] || '').trim().length > 0);
    const userId = req.user.id;

    let profile_picture = null;

    if (!full_name || !username || !email || !contact_number) {
        return res.status(400).json({ error: 'Personal details are mandatory' });
    }
    if (isBankDetailsRequired && !hasCompleteBankDetails) {
        return res.status(400).json({ error: 'Bank details are mandatory' });
    }

    if (!isStrictUsername(username)) {
        return res.status(400).json({ error: 'Username must contain only lowercase letters (a-z)' });
    }

    try {
        const emailDomainPolicy = await loadEmailDomainPolicy(db, req.user?.company_id || null);
        assertEmailAllowedByPolicy(email, emailDomainPolicy, 'Email');

        if (req.file) {
            const uploadResult = await uploadIncomingFile(req.file, { folder: 'profiles' });
            profile_picture = uploadResult.url;
        }

        // Check if username is already taken by another user
        const existingUser = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2', [username, userId]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Username is already taken' });
        }

        // Check if email is already taken by another user
        const existingEmail = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2', [email, userId]);
        if (existingEmail.rows.length > 0) {
            return res.status(400).json({ error: 'Email address is already associated with another account' });
        }

        // Check if contact number is already taken by another user
        const existingContact = await db.query('SELECT id FROM users WHERE contact_number = $1 AND id != $2', [contact_number, userId]);
        if (existingContact.rows.length > 0) {
            return res.status(400).json({ error: 'Contact number is already associated with another account' });
        }

        // Check user role and current data
        const userRes = await db.query('SELECT role, full_name, username, email, contact_number, bank_details, profile_picture, timezone FROM users WHERE id = $1', [userId]);
        const currentUser = userRes.rows[0];
        const role = currentUser?.role;

        const timezone = String(body.timezone || currentUser.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone).trim();
        const removeProfilePicture = body.remove_profile_picture === 'true' || body.remove_profile_picture === true;

        // Check if there are any actual changes
        const isProfilePictureChanged = req.file || removeProfilePicture;
        const isDataChanged =
            full_name !== String(currentUser.full_name || '') ||
            username !== currentUser.username ||
            email !== currentUser.email ||
            contact_number !== currentUser.contact_number ||
            bank_details !== currentUser.bank_details ||
            timezone !== currentUser.timezone;

        if (!isDataChanged && !isProfilePictureChanged) {
            return res.json({ message: 'No changes detected' });
        }

        if (role !== 'employee') {
            // Admins and moderators can update directly
            const { deleteFile } = require('../utils/fileUtils');
            let query = '';
            let params = [];

            if (profile_picture) {
                if (currentUser.profile_picture) {
                    deleteFile(currentUser.profile_picture);
                }
                query = 'UPDATE users SET full_name = $1, username = $2, email = $3, contact_number = $4, bank_details = $5, timezone = $6, profile_picture = $7 WHERE id = $8 RETURNING id, full_name, username, role, status, department, email, contact_number, bank_details, profile_picture, timezone';
                params = [full_name, username, email, contact_number, bank_details, timezone, profile_picture, userId];
            } else if (removeProfilePicture) {
                if (currentUser.profile_picture) {
                    deleteFile(currentUser.profile_picture);
                }
                query = 'UPDATE users SET full_name = $1, username = $2, email = $3, contact_number = $4, bank_details = $5, timezone = $6, profile_picture = NULL WHERE id = $7 RETURNING id, full_name, username, role, status, department, email, contact_number, bank_details, profile_picture, timezone';
                params = [full_name, username, email, contact_number, bank_details, timezone, userId];
            } else {
                query = 'UPDATE users SET full_name = $1, username = $2, email = $3, contact_number = $4, bank_details = $5, timezone = $6 WHERE id = $7 RETURNING id, full_name, username, role, status, department, email, contact_number, bank_details, profile_picture, timezone';
                params = [full_name, username, email, contact_number, bank_details, timezone, userId];
            }

            const result = await db.query(query, params);
            return res.json({ user: result.rows[0], message: 'Profile updated successfully' });
        } else {




            // Employee needs approval
            // Check if there is already a pending request
            const pendingRequest = await db.query('SELECT id, requested_changes FROM profile_update_requests WHERE user_id = $1 AND status = \'pending\'', [userId]);

            const requestedChanges = {
                full_name,
                username,
                email,
                contact_number,
                bank_details,
                timezone,
                profile_picture: profile_picture || null,
                remove_profile_picture: removeProfilePicture
            };

            let requestId;
            let isNewRequest = false;

            if (pendingRequest.rows.length > 0) {
                // Delete previous file if it's different from the new one
                const oldRequest = pendingRequest.rows[0];
                requestId = oldRequest.id;
                let oldChanges = {};
                try { oldChanges = JSON.parse(oldRequest.requested_changes); } catch (e) {}
                if (oldChanges.profile_picture && oldChanges.profile_picture !== requestedChanges.profile_picture) {
                    const { deleteFile } = require('../utils/fileUtils');
                    deleteFile(oldChanges.profile_picture);
                }

                // Update existing pending request
                await db.query(
                    'UPDATE profile_update_requests SET requested_changes = $1, created_at = NOW() WHERE id = $2',
                    [JSON.stringify(requestedChanges), requestId]
                );
            } else {
                isNewRequest = true;
                // Clear any old handled notifications before submitting new request
                await db.query(
                    'UPDATE profile_update_requests SET user_notified = true WHERE user_id = $1 AND status IN (\'approved\', \'rejected\') AND user_notified = false',
                    [userId]
                );

                // Insert new request
                const insertRes = await db.query(
                    'INSERT INTO profile_update_requests (user_id, requested_changes) VALUES ($1, $2) RETURNING id',
                    [userId, JSON.stringify(requestedChanges)]
                );
                requestId = insertRes.rows[0].id;
            }

            // Notify Admins via Socket
            const io = req.app.get('io');
            if (io) {
                io.emit('profile_request_update', { type: isNewRequest ? 'new_request' : 'update_request', user_id: userId, requestId });
            }

            // --- Background Notifications ---
            runInBackground(async () => {
                try {
                    const { getAdminMessagingTargets } = require('../utils/notificationService');
                    const targets = await getAdminMessagingTargets({ forceEmailRecipients: true, companyId: req.user?.company_id });

                    const waRecipients = Array.isArray(targets.whatsappNumbers) ? targets.whatsappNumbers : [];
                    const rawTgRecipients = Array.isArray(targets.telegramChatIds) ? targets.telegramChatIds : [];
                    const emailRecipients = Array.isArray(targets.emailRecipients) ? targets.emailRecipients : [];

                    const formatBankDetails = (value) => {
                        if (!value) return {};
                        try {
                            return typeof value === 'string' ? JSON.parse(value) : value;
                        } catch (e) {
                            return {};
                        }
                    };

                    let changeSummary = `*Profile Update Request${isNewRequest ? '' : ' (Updated)'}*\n`;
                    changeSummary += `*Employee:* ${currentUser.username}\n\n`;
                    const changedFields = [];

                    if (full_name !== String(currentUser.full_name || '')) {
                        changedFields.push('Full Name');
                        changeSummary += `- Full Name: ${currentUser.full_name || 'Not set'} -> ${full_name}\n`;
                    }
                    if (username !== currentUser.username) {
                        changedFields.push('Username');
                        changeSummary += `- Username: ${currentUser.username} -> ${username}\n`;
                    }
                    if (email !== currentUser.email) {
                        changedFields.push('Email');
                        changeSummary += `- Email: ${currentUser.email} -> ${email}\n`;
                    }
                    if (contact_number !== currentUser.contact_number) {
                        changedFields.push('Phone');
                        changeSummary += `- Phone: ${currentUser.contact_number} -> ${contact_number}\n`;
                    }
                    if (bank_details !== currentUser.bank_details) {
                        const oldBank = formatBankDetails(currentUser.bank_details);
                        const newBank = formatBankDetails(bank_details);
                        const bankFields = [
                            { key: 'bank_name', label: 'Bank Name' },
                            { key: 'account_holder_name', label: 'Account Holder Name' },
                            { key: 'account_number', label: 'Account Number' },
                            { key: 'branch_name', label: 'Branch Name' },
                            { key: 'routing_number', label: 'Routing Number' }
                        ];
                        bankFields.forEach(field => {
                            const oldVal = (oldBank[field.key] || '').trim();
                            const newVal = (newBank[field.key] || '').trim();
                            if (newVal !== oldVal) {
                                changedFields.push(field.label);
                                changeSummary += `- ${field.label}: ${oldVal || 'Not set'} -> ${newVal || 'Not set'}\n`;
                            }
                        });
                    }
                    if (isProfilePictureChanged) {
                        changedFields.push('Profile Picture');
                        changeSummary += '- Picture: Updated\n';
                    }
                    if (timezone !== currentUser.timezone) {
                        changedFields.push('Timezone');
                        changeSummary += `- Timezone: ${currentUser.timezone} -> ${timezone}\n`;
                    }

                    const waButtons = [
                        { id: `profile_action_approve_${requestId}`, title: 'Accept' },
                        { id: `profile_action_reject_${requestId}`, title: 'Reject' }
                    ];

                    const tgInlineKeyboard = [
                        [{ text: 'Accept', callback_data: `tg_profile_approve_${requestId}` }, { text: 'Reject', callback_data: `tg_profile_reject_${requestId}` }]
                    ];

                    const promises = [];
                    for (const number of waRecipients) {
                        promises.push(whatsappService.sendInteractiveMessage(number, changeSummary, waButtons).catch(e => console.error(`Profile WA fail: ${e.message}`)));
                    }

                    if (rawTgRecipients.length > 0) {
                        const telegramService = require('../utils/telegramService');
                        for (const chatId of rawTgRecipients) {
                            promises.push(telegramService.sendInlineKeyboard(chatId, changeSummary, tgInlineKeyboard).catch(e => console.error(`Profile TG fail: ${e.message}`)));
                        }
                    }

                    if (emailRecipients.length > 0) {
                        const emailService = require('../utils/emailService');
                        for (const recipientEmail of emailRecipients) {
                            promises.push(emailService.sendProfileRequestNotificationEmail(recipientEmail, {
                                requestId,
                                employeeName: full_name || currentUser.full_name || currentUser.username,
                                changedFields,
                                submittedAt: new Date()
                            }, currentUser).catch(e => console.error(`Profile Email fail: ${e.message}`)));
                        }
                    }
                    await Promise.allSettled(promises);
                } catch (notifyErr) {
                    console.error('Error sending Profile Update notifications:', notifyErr);
                }
            });

            return res.json({ 
                message: isNewRequest 
                    ? 'Profile update request submitted and is pending admin approval' 
                    : 'Profile update request has been updated and is pending admin approval' 
            });
        }
    } catch (err) {
        console.error(err);
        if (err.statusCode) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        res.status(500).json({ error: 'Server error' });
    }
};

const changePassword = async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    const trimmedCurrentPassword = String(currentPassword || '');
    const trimmedNewPassword = String(newPassword || '');

    if (!trimmedCurrentPassword || !trimmedNewPassword) {
        return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (trimmedNewPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    try {
        const userRes = await db.query(
            'SELECT password_hash, email, contact_number, bank_details, role FROM users WHERE deleted_at IS NULL AND id = $1',
            [userId]
        );
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = userRes.rows[0];
        if (!hasProfileSetForPasswordChange(user)) {
            return res.status(400).json({
                error: 'Please complete your profile (Email, Contact, Bank Details) before changing password.'
            });
        }

        const validPassword = await bcrypt.compare(trimmedCurrentPassword, user.password_hash);
        if (!validPassword) {
            return res.status(400).json({ error: 'Incorrect current password' });
        }

        const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
        const hash = await bcrypt.hash(trimmedNewPassword, salt);

        await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);

        res.json({ message: 'Password changed successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

// Generate 6-digit OTP using cryptographically secure random
const generateOTP = () => {
    const crypto = require('crypto');
    return crypto.randomInt(100000, 999999).toString();
};

const OTP_PURPOSE = {
    PASSWORD_RESET: 'password_reset',
    USERNAME_RECOVERY: 'username_recovery'
};

let otpSchemaEnsured = false;
const ensurePasswordResetSchema = async () => {
    if (otpSchemaEnsured) return;

    await db.query(`
        CREATE TABLE IF NOT EXISTS password_resets (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          otp TEXT NOT NULL,
          purpose TEXT NOT NULL DEFAULT 'password_reset',
          used BOOLEAN DEFAULT FALSE,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await db.query(`
        ALTER TABLE password_resets
        ADD COLUMN IF NOT EXISTS purpose TEXT DEFAULT 'password_reset';
    `);

    await db.query(`
        UPDATE password_resets
        SET purpose = 'password_reset'
        WHERE purpose IS NULL OR TRIM(purpose) = '';
    `);

    await db.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'password_resets_purpose_check'
            ) THEN
                ALTER TABLE password_resets
                ADD CONSTRAINT password_resets_purpose_check
                CHECK (purpose IN ('password_reset', 'username_recovery'));
            END IF;
        END $$;
    `);

    otpSchemaEnsured = true;
};

const forgotPassword = async (req, res) => {
    const rawUsername = String(req.body?.username || '').trim();
    const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
    console.log(`[AUTH] Forgot password request received for: "${normalizedEmail}"`);

    if (!normalizedEmail) {
        return res.status(400).json({ error: 'Email is required' });
    }

    try {
        await ensurePasswordResetSchema();

        // Resolve account by email (case-insensitive). Username is treated as optional helper input.
        const userResult = await db.query(
            'SELECT id, username, email FROM users WHERE deleted_at IS NULL AND LOWER(email) = LOWER($1) ORDER BY id DESC LIMIT 1',
            [normalizedEmail]
        );

        if (userResult.rows.length === 0) {
            console.log(`[AUTH] Forgot password failed: No user found for email "${normalizedEmail}"`);
            return res.status(404).json({ error: 'No account found with this email' });
        }

        const user = userResult.rows[0];

        if (rawUsername && String(user.username || '').toLowerCase() !== rawUsername.toLowerCase()) {
            console.warn(`[ForgotPassword] Username mismatch for email ${normalizedEmail}. Provided=${rawUsername}, Account=${user.username}`);
        }

        // Generate 6-digit OTP
        const otp = generateOTP();

        // Set expiration to 15 minutes from now
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        // Invalidate any previous unused OTPs for this user
        await db.query(
            'UPDATE password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE AND purpose = $2',
            [user.id, OTP_PURPOSE.PASSWORD_RESET]
        );

        // Store OTP in database
        await db.query(
            'INSERT INTO password_resets (user_id, email, otp, expires_at, purpose) VALUES ($1, $2, $3, $4, $5)',
            [user.id, normalizedEmail, otp, expiresAt, OTP_PURPOSE.PASSWORD_RESET]
        );

        console.log(`[AUTH] Password reset OTP for ${normalizedEmail}: ${otp}`);

        console.log(`[AUTH] Password reset OTP for ${normalizedEmail}: ${otp}`);

        // Send OTP email
        runInBackground(async () => {
            const { sendOTPEmail } = require('../utils/emailService');
            try {
                await sendOTPEmail(normalizedEmail, otp, user.username);
            } catch (emailErr) {
                console.error('Failed to send OTP email:', emailErr.message);
            }
        });

        res.json({
            message: 'An OTP has been sent to your email.',
            email: normalizedEmail,
            username: user.username
        });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'Failed to process request. Please try again.' });
    }
};

const verifyOTP = async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ error: 'Email and OTP are required' });
    }

    try {
        await ensurePasswordResetSchema();

        // Find valid OTP
        const result = await db.query(
            `SELECT pr.*, u.username 
             FROM password_resets pr
             JOIN users u ON pr.user_id = u.id
             WHERE pr.email = $1 
             AND pr.otp = $2 
             AND pr.purpose = $3
             AND pr.used = FALSE 
             AND pr.expires_at > NOW()
             ORDER BY pr.created_at DESC
             LIMIT 1`,
            [email.toLowerCase(), otp, OTP_PURPOSE.PASSWORD_RESET]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        const resetRecord = result.rows[0];

        // Mark OTP as verified (but not used yet - will be used on password reset)
        // We'll keep it valid until password is actually reset

        res.json({
            message: 'OTP verified successfully',
            verified: true,
            email: resetRecord.email
        });
    } catch (err) {
        console.error('Verify OTP error:', err);
        res.status(500).json({ error: 'Failed to verify OTP' });
    }
};

const resetPassword = async (req, res) => {
    const { email, otp, newPassword } = req.body;

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedOtp = String(otp || '').trim();
    const sanitizedNewPassword = String(newPassword || '');

    if (!normalizedEmail || !normalizedOtp || !sanitizedNewPassword) {
        return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }

    if (sanitizedNewPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    try {
        await ensurePasswordResetSchema();

        // Verify OTP again — select only the columns we need to avoid duplicate-name ambiguity
        const result = await db.query(
            `SELECT pr.id AS otp_id, pr.user_id
             FROM password_resets pr
             JOIN users u ON pr.user_id = u.id
             WHERE pr.email = $1
             AND pr.otp = $2
             AND pr.purpose = $3
             AND pr.used = FALSE
             AND pr.expires_at > NOW()
             ORDER BY pr.created_at DESC
             LIMIT 1`,
            [normalizedEmail, normalizedOtp, OTP_PURPOSE.PASSWORD_RESET]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        const { otp_id: otpId, user_id: userId } = result.rows[0];

        // Hash new password
        const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
        const hash = await bcrypt.hash(sanitizedNewPassword, salt);

        // Update user password
        const updateResult = await db.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id',
            [hash, userId]
        );

        if (updateResult.rowCount === 0) {
            console.error(`[ResetPassword] UPDATE affected 0 rows for user_id=${userId}`);
            return res.status(500).json({ error: 'Failed to reset password. User not found.' });
        }

        // Mark OTP as used
        await db.query(
            'UPDATE password_resets SET used = TRUE WHERE id = $1',
            [otpId]
        );

        // Invalidate all other OTPs for this user
        await db.query(
            'UPDATE password_resets SET used = TRUE WHERE user_id = $1 AND id != $2',
            [userId, otpId]
        );

        res.json({ message: 'Password reset successfully. You can now login with your new password.' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Failed to reset password' });
    }
};

const forgotUsername = async (req, res) => {
    const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
    console.log(`[AUTH] Forgot username request received for: "${normalizedEmail}"`);

    if (!normalizedEmail) {
        return res.status(400).json({ error: 'Email is required' });
    }

    try {
        await ensurePasswordResetSchema();

        // Check if user exists with this email (case-insensitive)
        const userResult = await db.query(
            'SELECT id, username FROM users WHERE deleted_at IS NULL AND LOWER(email) = LOWER($1) ORDER BY id DESC LIMIT 1',
            [normalizedEmail]
        );

        if (userResult.rows.length === 0) {
            console.log(`[AUTH] Forgot username failed: No user found for email "${normalizedEmail}"`);
            return res.status(404).json({ error: 'No account found with this email' });
        }

        const user = userResult.rows[0];
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        await db.query(
            'UPDATE password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE AND purpose = $2',
            [user.id, OTP_PURPOSE.USERNAME_RECOVERY]
        );

        await db.query(
            'INSERT INTO password_resets (user_id, email, otp, expires_at, purpose) VALUES ($1, $2, $3, $4, $5)',
            [user.id, normalizedEmail, otp, expiresAt, OTP_PURPOSE.USERNAME_RECOVERY]
        );

        console.log(`[AUTH] Username recovery OTP for ${normalizedEmail}: ${otp}`);

        console.log(`[AUTH] Username recovery OTP for ${normalizedEmail}: ${otp}`);

        // Send Username OTP email
        runInBackground(async () => {
            const { sendUsernameOTPEmail } = require('../utils/emailService');
            try {
                await sendUsernameOTPEmail(normalizedEmail, otp, user.username);
            } catch (emailErr) {
                console.error('Failed to send username recovery email:', emailErr.message);
            }
        });

        res.json({
            message: 'A username recovery OTP has been sent to your email.',
            email: normalizedEmail
        });
    } catch (err) {
        console.error('Forgot username error:', err);
        res.status(500).json({ error: 'Failed to process request' });
    }
};

const verifyUsernameOTP = async (req, res) => {
    const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();

    if (!normalizedEmail || !otp) {
        return res.status(400).json({ error: 'Email and OTP are required' });
    }

    try {
        await ensurePasswordResetSchema();

        const result = await db.query(
            `SELECT pr.id, pr.email, u.username, u.full_name
             FROM password_resets pr
             JOIN users u ON pr.user_id = u.id
             WHERE LOWER(pr.email) = LOWER($1)
             AND pr.otp = $2
             AND pr.purpose = $3
             AND pr.used = FALSE
             AND pr.expires_at > NOW()
             ORDER BY pr.created_at DESC
             LIMIT 1`,
            [normalizedEmail, otp, OTP_PURPOSE.USERNAME_RECOVERY]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        const row = result.rows[0];
        await db.query('UPDATE password_resets SET used = TRUE WHERE id = $1', [row.id]);

        return res.json({
            message: 'OTP verified successfully',
            verified: true,
            email: row.email,
            username: row.username,
            full_name: row.full_name || null
        });
    } catch (err) {
        console.error('Verify username OTP error:', err);
        return res.status(500).json({ error: 'Failed to verify username OTP' });
    }
};

const acknowledgeProfileNotification = async (req, res) => {
    try {
        await db.query(
            'UPDATE profile_update_requests SET user_notified = true WHERE user_id = $1 AND status IN (\'approved\', \'rejected\') AND user_notified = false',
            [req.user.id]
        );
        res.json({ message: 'Profile notification acknowledged' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getSkippedDays = async (req, res) => {
    const userId = req.user.id;
    try {
        // Keep skipped-day data in sync even if the user stays on the dashboard.
        await processMissedDays(userId, req.app.get('io'));

        const deductions = await db.query(
            `WITH deduction_days AS (
                SELECT
                    MAX(id) AS id,
                    COALESCE(covered_date::date, timestamp::date) AS skipped_date,
                    MAX(ABS(COALESCE(balance_change, 0)))::int AS deducted_minutes
                FROM activity_logs
                WHERE user_id = $1
                  AND activity_type = 'absence_deduction'
                  AND COALESCE(balance_change, 0) <> 0
                GROUP BY COALESCE(covered_date::date, timestamp::date)
            )
            SELECT
                d.id,
                d.skipped_date::text AS date,
                d.deducted_minutes,
                EXISTS (
                    SELECT 1
                    FROM activity_logs s
                    WHERE s.user_id = $1
                      AND s.activity_type = 'sign_out'
                      AND s.covered_date = d.skipped_date
                ) AS is_covered
            FROM deduction_days d
            ORDER BY d.skipped_date DESC`,
            [userId]
        );

        res.json(deductions.rows.map((row) => ({
            id: row.id,
            date: row.date,
            deductedMinutes: Number(row.deducted_minutes || 0),
            isCovered: !!row.is_covered
        })));
    } catch (err) {
        console.error('Error fetching skipped days:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getTelegramLinkToken = async (req, res) => {
    const userId = req.user.id;
    try {
        const token = require('crypto').randomBytes(16).toString('hex');
        const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await db.query(
            'UPDATE users SET tg_link_token = $1, tg_link_expiry = $2 WHERE id = $3',
            [token, expiry, userId]
        );

        res.json({ token });
    } catch (err) {
        console.error('[Auth] Failed to generate TG link token:', err);
        res.status(500).json({ error: 'Failed to generate linking token' });
    }
};

module.exports = {
    login, logout, signIn, signOut, me, updateStatus,
    getColleagues, heartbeat, updateProfile, changePassword,
    forgotPassword, verifyOTP, resetPassword, forgotUsername, verifyUsernameOTP,
    acknowledgeProfileNotification, getSkippedDays,
    getPlanOptions, upgradeMyCompanyPlan,
    calculateHoursWorkedToday: (userId, pgClient, targetDate) => require('../utils/attendanceService').calculateHoursWorkedToday(userId, pgClient, targetDate),
    refreshOvertimeAlert,
    refreshDailyGoalAlert,
    getTelegramLinkToken,
    googleLogin
};
