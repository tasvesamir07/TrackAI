const db = require('../db');
const crypto = require('crypto');
const timeService = require('../utils/timeService');
const { clearUserSubmissions } = require('../utils/submissionCleanupService');
const { getAdminMessagingTargets } = require('../utils/notificationService');
const whatsappService = require('../utils/whatsappService');
const {
    normalizeEmail,
    isValidEmail,
    buildEmailDomainPolicyFromConfig,
    normalizeEmailDomainMode,
    parseAllowedEmailDomains,
    assertEmailAllowedByPolicy,
    loadEmailDomainPolicy
} = require('../utils/emailDomainPolicy');

const normalizeDepartmentName = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const BASIC_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-z]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalizeRoleKey = (role) => {
    const normalized = String(role || '').trim().toLowerCase();
    if (normalized === 'superadmin' || normalized === 'super_admin') return 'super_admin';
    if (normalized === 'project_manager') return 'moderator';
    if (normalized === 'company_admin') return 'company_admin';
    return normalized;
};
const ROLE_VISIBILITY = {
    super_admin: ['super_admin', 'superadmin', 'company_admin', 'admin', 'moderator', 'project_manager', 'employee'],
    company_admin: ['company_admin', 'admin', 'moderator', 'project_manager', 'employee'],
    admin: ['admin', 'moderator', 'project_manager', 'employee'],
    moderator: ['admin', 'moderator', 'project_manager', 'employee'],
    employee: ['employee']
};
const ADMIN_LIKE_ROLES = new Set(['admin', 'company_admin', 'super_admin']);

const isAdminLikeRole = (role) => ADMIN_LIKE_ROLES.has(normalizeRoleKey(role));
const isSuperAdminRole = (role) => normalizeRoleKey(role) === 'super_admin';

const canViewUserRole = (viewerRole, targetRole) => {
    const allowed = ROLE_VISIBILITY[normalizeRoleKey(viewerRole)] || [];
    const normalizedTarget = normalizeRoleKey(targetRole);
    return allowed.includes(normalizedTarget);
};

const getVisibleRolesForViewer = (viewerRole) => ROLE_VISIBILITY[normalizeRoleKey(viewerRole)] || ['employee'];
const getDepartmentAlias = (department) => {
    const normalized = String(department || '').trim();
    return normalized || 'Admin';
};
const shouldMaskAdminIdentity = (viewerId, viewerRole, targetId, targetRole) => (
    !isAdminLikeRole(viewerRole)
    && ['admin', 'company_admin'].includes(normalizeRoleKey(targetRole))
    && Number(viewerId) !== Number(targetId)
);
const getVisibleNameForViewer = ({ viewerId, viewerRole, targetId, targetRole, targetUsername, targetDepartment }) => {
    if (shouldMaskAdminIdentity(viewerId, viewerRole, targetId, targetRole)) {
        return getDepartmentAlias(targetDepartment);
    }
    return targetUsername;
};
const getVisibleRoleLabelForViewer = ({ viewerId, viewerRole, targetId, targetRole, targetDepartment }) => {
    if (shouldMaskAdminIdentity(viewerId, viewerRole, targetId, targetRole)) {
        const normalized = String(targetDepartment || '').trim();
        return normalized || 'Department';
    }
    return targetRole;
};
const isStrictUsername = (value) => USERNAME_REGEX.test(String(value || '').trim());

const resolveRequesterCompanyId = async (userId, companyIdFromToken, queryClient = db) => {
    const normalizedTokenCompanyId = String(companyIdFromToken || '').trim();
    if (normalizedTokenCompanyId && UUID_REGEX.test(normalizedTokenCompanyId)) {
        return normalizedTokenCompanyId;
    }
    if (!userId) return null;

    const requesterRes = await queryClient.query(
        'SELECT company_id FROM users WHERE deleted_at IS NULL AND id = $1 LIMIT 1',
        [userId]
    );
    return requesterRes.rows[0]?.company_id || null;
};

const getScopedSettingValue = async (queryClient, key, companyId) => {
    const result = await queryClient.query(
        `SELECT value
         FROM settings
         WHERE key = $1
           AND (
                company_id = $2::uuid
                OR company_id IS NULL
           )
         ORDER BY CASE WHEN company_id = $2::uuid THEN 0 ELSE 1 END
         LIMIT 1`,
        [key, companyId]
    );
    return result.rows[0]?.value ?? null;
};

const upsertScopedSettingValue = async (queryClient, key, value, companyId) => {
    if (companyId) {
        await queryClient.query(
            `INSERT INTO settings (key, value, company_id)
             VALUES ($1, $2, $3::uuid)
             ON CONFLICT (company_id, key)
             WHERE company_id IS NOT NULL
             DO UPDATE SET value = EXCLUDED.value`,
            [key, value, companyId]
        );
        return;
    }

    await queryClient.query(
        `INSERT INTO settings (key, value, company_id)
         VALUES ($1, $2, NULL)
         ON CONFLICT (key)
         WHERE company_id IS NULL
         DO UPDATE SET value = EXCLUDED.value`,
        [key, value]
    );
};

const alphaSuffixFromIndex = (index) => {
    if (index <= 0) return '';
    let value = index;
    let suffix = '';
    while (value > 0) {
        value -= 1;
        suffix = String.fromCharCode(97 + (value % 26)) + suffix;
        value = Math.floor(value / 26);
    }
    return suffix;
};

const buildBaseUsernameFromEmail = (email) => {
    const localPart = String(email || '').split('@')[0] || '';
    const normalized = localPart.toLowerCase().replace(/[^a-z]/g, '');
    return (normalized || 'user').slice(0, 20);
};

const findAvailableUsernameForEmail = async (client, email) => {
    const base = buildBaseUsernameFromEmail(email);
    for (let index = 0; index < 5000; index += 1) {
        const candidate = `${base}${alphaSuffixFromIndex(index)}`;
        const exists = await client.query(
            'SELECT id FROM users WHERE deleted_at IS NULL AND LOWER(username) = LOWER($1) LIMIT 1',
            [candidate]
        );
        if (exists.rows.length === 0) {
            return candidate;
        }
    }
    throw new Error('Failed to generate unique username');
};

const generateTemporaryPassword = (length = 12) => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
    const bytes = crypto.randomBytes(length * 2);
    let password = '';
    let index = 0;

    while (password.length < length && index < bytes.length) {
        const value = bytes[index];
        index += 1;
        password += alphabet[value % alphabet.length];
    }

    return password;
};

const findDepartmentByName = async (name, companyId, queryClient = db) => {
    return queryClient.query(
        `SELECT id, name
         FROM departments
         WHERE LOWER(name) = LOWER($1)
           AND (
                ($2::uuid IS NULL AND company_id IS NULL)
                OR company_id = $2::uuid
           )
         LIMIT 1`,
        [name, companyId]
    );
};

const getPlanLimitFieldForRole = (role) => {
    const normalized = normalizeRoleKey(role);
    if (normalized === 'admin' || normalized === 'company_admin') return 'max_company_admins';
    if (normalized === 'moderator' || normalized === 'project_manager') return 'max_project_managers';
    if (normalized === 'employee') return 'max_employees';
    return null;
};

const getCompanyPlanUsage = async (companyId, queryClient = db) => {
    if (!companyId) return null;

    const planRes = await queryClient.query(
        `SELECT t.unlimited_access, p.max_company_admins, p.max_project_managers, p.max_employees
         FROM tenants t
         JOIN plans p ON p.id = t.plan_id
         WHERE t.id = $1
         LIMIT 1`,
        [companyId]
    );
    if (planRes.rows.length === 0) return null;

    const countRes = await queryClient.query(
        `SELECT
            COUNT(*) FILTER (
                WHERE deleted_at IS NULL
                  AND is_active = TRUE
                  AND LOWER(role) IN ('admin', 'company_admin')
            )::int AS company_admins_current,
            COUNT(*) FILTER (
                WHERE deleted_at IS NULL
                  AND is_active = TRUE
                  AND LOWER(role) IN ('moderator', 'project_manager')
            )::int AS project_managers_current,
            COUNT(*) FILTER (
                WHERE deleted_at IS NULL
                  AND is_active = TRUE
                  AND LOWER(role) = 'employee'
            )::int AS employees_current
         FROM users
         WHERE company_id = $1`,
        [companyId]
    );

    const plan = planRes.rows[0];
    const counts = countRes.rows[0] || {};
    return {
        unlimited_access: Boolean(plan.unlimited_access),
        company_admins: {
            current: Number(counts.company_admins_current || 0),
            limit: Number(plan.max_company_admins || 0)
        },
        project_managers: {
            current: Number(counts.project_managers_current || 0),
            limit: Number(plan.max_project_managers || 0)
        },
        employees: {
            current: Number(counts.employees_current || 0),
            limit: Number(plan.max_employees || 0)
        }
    };
};

const getDailyReports = async (req, res) => {
    const { date } = req.query;
    const targetDate = date ? String(date).trim() : timeService.getDateStr(timeService.getNow());

    if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    try {
        const viewerRole = req.user?.role;
        const viewerIsSuperAdmin = isSuperAdminRole(viewerRole);
        const visibleRoles = getVisibleRolesForViewer(viewerRole);
        const requesterCompanyId = viewerIsSuperAdmin
            ? null
            : await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);

        const query = `
      SELECT
        u.id as user_id, 
        u.username, 
        u.full_name,
        u.profile_picture,
        u.department, 
        t.id as task_id, 
        t.todays_task, 
        t.created_at, 
        t.updated_at,
        t.attachments,
        CASE WHEN t.id IS NOT NULL THEN true ELSE false END as submitted,
        COALESCE(ARRAY_AGG(DISTINCT c.name) FILTER(WHERE c.name IS NOT NULL), '{}') as categories,
        $1::text as report_date
      FROM users u
      LEFT JOIN LATERAL (
        SELECT id, todays_task, created_at, updated_at, attachments
        FROM tasks t
        WHERE t.user_id = u.id AND t.date = $1::date
        ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST
        LIMIT 1
      ) t ON true
      LEFT JOIN user_categories uc ON u.id = uc.user_id
      LEFT JOIN categories c ON uc.category_id = c.id
      WHERE LOWER(u.role) = ANY($2::text[])
        AND (
            $4::boolean = true
            OR (
                ($3::uuid IS NULL AND u.company_id IS NULL)
                OR u.company_id = $3::uuid
            )
        )
      GROUP BY u.id, u.username, u.full_name, u.profile_picture, u.department, t.id, t.todays_task, t.created_at, t.updated_at, t.attachments
      ORDER BY u.username ASC
    `;

        const result = await db.query(query, [targetDate, visibleRoles, requesterCompanyId, viewerIsSuperAdmin]);

        const viewerId = req.user?.id;
        const maskedRows = result.rows.map((row) => ({
            ...row,
            username: getVisibleNameForViewer({
                viewerId,
                viewerRole,
                targetId: row.user_id,
                targetRole: row.role,
                targetUsername: row.username,
                targetDepartment: row.department
            }),
            role: getVisibleRoleLabelForViewer({
                viewerId,
                viewerRole,
                targetId: row.user_id,
                targetRole: row.role,
                targetDepartment: row.department
            })
        }));

        res.json(maskedRows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getMonthlyReports = async (req, res) => {
    const { year, month } = req.query;

    if (!year || !month) {
        return res.status(400).json({ error: 'Year and month are required' });
    }

    const yearNum = parseInt(year);
    const monthNum = parseInt(month);

    if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return res.status(400).json({ error: 'Invalid year or month' });
    }

    try {
        const viewerRole = req.user?.role;
        const viewerIsSuperAdmin = isSuperAdminRole(viewerRole);
        const visibleRoles = getVisibleRolesForViewer(viewerRole);
        const requesterCompanyId = viewerIsSuperAdmin
            ? null
            : await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);

        const query = `
      SELECT 
        u.id as user_id,
        u.username,
        u.full_name,
        u.department,
        u.profile_picture,
        COUNT(t.id)::int as total_submissions,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'date', t.date,
            'todays_task', t.todays_task,
            'created_at', t.created_at,
            'attachments', t.attachments
          ) ORDER BY t.date DESC
        ) FILTER (WHERE t.id IS NOT NULL) as tasks
      FROM users u
      LEFT JOIN tasks t ON u.id = t.user_id 
        AND EXTRACT(YEAR FROM t.date) = $1 
        AND EXTRACT(MONTH FROM t.date) = $2
      WHERE LOWER(u.role) = ANY($3::text[])
        AND (
            $5::boolean = true
            OR (
                ($4::uuid IS NULL AND u.company_id IS NULL)
                OR u.company_id = $4::uuid
            )
        )
      GROUP BY u.id, u.username, u.full_name, u.department, u.profile_picture
      ORDER BY u.username ASC
    `;

        const result = await db.query(query, [yearNum, monthNum, visibleRoles, requesterCompanyId, viewerIsSuperAdmin]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getWeeklyReports = async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate) return res.status(400).json({ error: 'Start date is required' });

    try {
        const viewerRole = req.user?.role;
        const viewerIsSuperAdmin = isSuperAdminRole(viewerRole);
        const visibleRoles = getVisibleRolesForViewer(viewerRole);
        const requesterCompanyId = viewerIsSuperAdmin
            ? null
            : await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);

        const query = `
      SELECT 
        u.id as user_id,
        u.username,
        u.full_name,
        u.department,
        u.profile_picture,
        COUNT(t.id)::int as total_submissions,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'date', t.date,
            'todays_task', t.todays_task,
            'created_at', t.created_at,
            'attachments', t.attachments
          ) ORDER BY t.date DESC
        ) FILTER (WHERE t.id IS NOT NULL) as tasks
      FROM users u
      LEFT JOIN tasks t ON u.id = t.user_id 
        AND t.date >= $1::date 
        AND t.date <= $2::date
      WHERE LOWER(u.role) = ANY($3::text[])
        AND (
            $5::boolean = true
            OR (
                ($4::uuid IS NULL AND u.company_id IS NULL)
                OR u.company_id = $4::uuid
            )
        )
      GROUP BY u.id, u.username, u.full_name, u.department, u.profile_picture
      ORDER BY u.username ASC
    `;
        const fallbackEndDate = new Date(startDate);
        fallbackEndDate.setDate(fallbackEndDate.getDate() + 6);
        const resolvedEndDate = endDate || fallbackEndDate.toISOString().split('T')[0];

        const result = await db.query(query, [startDate, resolvedEndDate, visibleRoles, requesterCompanyId, viewerIsSuperAdmin]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getYearlyReports = async (req, res) => {
    const { year } = req.query;
    if (!year) return res.status(400).json({ error: 'Year is required' });

    try {
        const viewerRole = req.user?.role;
        const viewerIsSuperAdmin = isSuperAdminRole(viewerRole);
        const visibleRoles = getVisibleRolesForViewer(viewerRole);
        const requesterCompanyId = viewerIsSuperAdmin
            ? null
            : await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);

        const query = `
      SELECT 
        u.id as user_id,
        u.username,
        u.full_name,
        u.department,
        u.profile_picture,
        COUNT(t.id)::int as total_submissions,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'date', t.date,
            'todays_task', t.todays_task,
            'created_at', t.created_at,
            'attachments', t.attachments
          ) ORDER BY t.date DESC
        ) FILTER (WHERE t.id IS NOT NULL) as tasks
      FROM users u
      LEFT JOIN tasks t ON u.id = t.user_id 
        AND EXTRACT(YEAR FROM t.date) = $1
      WHERE LOWER(u.role) = ANY($2::text[])
        AND (
            $4::boolean = true
            OR (
                ($3::uuid IS NULL AND u.company_id IS NULL)
                OR u.company_id = $3::uuid
            )
        )
      GROUP BY u.id, u.username, u.full_name, u.department, u.profile_picture
      ORDER BY u.username ASC
    `;
        const result = await db.query(query, [parseInt(year), visibleRoles, requesterCompanyId, viewerIsSuperAdmin]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};


const deleteTask = async (req, res) => {
    const { id } = req.params;

    if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ error: 'Invalid task ID' });
    }

    try {
        const viewerRole = req.user?.role;
        const viewerIsSuperAdmin = isSuperAdminRole(viewerRole);
        const requesterCompanyId = viewerIsSuperAdmin
            ? null
            : await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);

        const taskCheckRes = await db.query(
            `SELECT t.attachments, u.company_id, t.user_id
             FROM tasks t
             JOIN users u ON t.user_id = u.id
             WHERE t.id = $1`,
            [id]
        );

        if (taskCheckRes.rows.length === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const taskOwner = taskCheckRes.rows[0];
        if (!viewerIsSuperAdmin && taskOwner.company_id !== requesterCompanyId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        let attachments = taskOwner.attachments || [];
        if (typeof attachments === 'string') {
            try { attachments = JSON.parse(attachments); } catch (e) { attachments = []; }
        }
        const { deleteFile } = require('../utils/fileUtils');
        attachments.forEach(att => deleteFile(att.url));

        await db.query('UPDATE tasks SET deleted_at = NOW() WHERE id = $1', [id]);

        const io = req.app.get('io');
        if (io) {
            io.emit('task_update', { type: 'deleted', taskId: parseInt(id), userId: taskOwner.user_id });
        }

        res.json({ message: 'Task deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const createUser = async (req, res) => {
    const { email, role, department } = req.body;
    const allowedRoles = ['admin', 'moderator', 'employee'];
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail || !role) {
        return res.status(400).json({ error: 'Email and role are required' });
    }

    if (!BASIC_EMAIL_REGEX.test(normalizedEmail)) {
        return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    if (!allowedRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }

    const trimmedDepartment = normalizeDepartmentName(department);
    if (role === 'employee' && !trimmedDepartment) {
        return res.status(400).json({ error: 'Department is required for employees' });
    }

    const client = await db.getClient();
    let transactionOpen = false;
    try {
        await client.query('BEGIN');
        transactionOpen = true;
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id, client);

        let canonicalDepartment = null;
        if (trimmedDepartment) {
            const departmentRes = await client.query(
                `SELECT id, name
                 FROM departments
                 WHERE LOWER(name) = LOWER($1)
                   AND (
                        ($2::uuid IS NULL AND company_id IS NULL)
                        OR company_id = $2::uuid
                   )
                 LIMIT 1`,
                [trimmedDepartment, requesterCompanyId]
            );
            if (departmentRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Invalid department. Create it in Settings first.' });
            }
            canonicalDepartment = departmentRes.rows[0].name;
        }

        const existingUserRes = await client.query(
            `SELECT id
             FROM users
             WHERE LOWER(email) = LOWER($1)
               AND (
                    ($2::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $2::uuid
               )
             LIMIT 1`,
            [normalizedEmail, requesterCompanyId]
        );
        if (existingUserRes.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'A user with this email already exists' });
        }

        const generatedUsername = await findAvailableUsernameForEmail(client, normalizedEmail);
        const roleKey = normalizeRoleKey(role);

        const roleLimitField = getPlanLimitFieldForRole(roleKey);
        if (roleLimitField && requesterCompanyId) {
            const usage = await getCompanyPlanUsage(requesterCompanyId, client);
            if (usage && !usage.unlimited_access) {
                const usageByField = {
                    max_company_admins: usage.company_admins,
                    max_project_managers: usage.project_managers,
                    max_employees: usage.employees
                };
                const selectedUsage = usageByField[roleLimitField];
                if (selectedUsage && selectedUsage.current >= selectedUsage.limit) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        error: `Plan limit reached for ${roleKey}`,
                        role: roleKey,
                        limit: selectedUsage.limit,
                        current: selectedUsage.current
                    });
                }
            }
        }

        const bcrypt = require('bcryptjs');
        const temporaryPassword = generateTemporaryPassword();
        const bcryptRounds = Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
        const hash = await bcrypt.hash(temporaryPassword, bcryptRounds);

        const paidLeaveRaw = await getScopedSettingValue(client, 'paid_leave_days', requesterCompanyId);
        const configuredPaidLeave = paidLeaveRaw !== null ? parseInt(paidLeaveRaw, 10) : 10;
        const paidLeaveDays = Number.isFinite(configuredPaidLeave) ? configuredPaidLeave : 10;

        await client.query(
            `INSERT INTO users (
                email, 
                username, 
                password_hash, 
                role, 
                department, 
                company_id, 
                paid_leave_balance,
                is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
            [
                normalizedEmail,
                generatedUsername,
                hash,
                roleKey,
                canonicalDepartment,
                requesterCompanyId,
                paidLeaveDays
            ]
        );

        await client.query('COMMIT');
        transactionOpen = false;

        const { runInBackground } = require('../utils/background');
        runInBackground(async () => {
            try {
                const { sendNewUserCredentialsEmail } = require('../utils/emailService');
                await sendNewUserCredentialsEmail(normalizedEmail, {
                    loginEmail: normalizedEmail,
                    temporaryPassword,
                    role,
                    department: canonicalDepartment
                }, req.user);
            } catch (emailErr) {
                console.error(`[AdminController] Failed to send credential email to ${normalizedEmail}:`, emailErr);
            }
        });

        return res.status(201).json({
            message: 'User created. Credentials will be sent by email shortly.',
            email_sent: true
        });
    } catch (err) {
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackErr) {
                console.error('Create User Rollback Error:', rollbackErr);
            }
        }

        console.error(err);
        if (err.code === '23505') { // Unique violation
            return res.status(400).json({ error: 'A user with this email already exists' });
        }
        if (String(err.message || '').includes('Failed to send credentials email')) {
            return res.status(500).json({ error: 'User could not be created because credential email delivery failed' });
        }
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
}


const getUsers = async (req, res) => {
    try {
        const today = timeService.getDateStr(timeService.getNow());
        const rawPage = Number.parseInt(String(req.query.page || '1'), 10);
        const rawLimit = Number.parseInt(String(req.query.limit || '25'), 10);
        const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 25;
        const offset = (page - 1) * limit;
        const search = String(req.query.search || '').trim();
        const departmentFilter = String(req.query.department || '').trim();
        const shouldPaginate = ['1', 'true', 'yes'].includes(String(req.query.paginate || '').toLowerCase());
        const activeOnly = ['1', 'true', 'yes'].includes(String(req.query.activeOnly || '').toLowerCase());

        const viewerRole = req.user?.role;
        const visibleRoles = getVisibleRolesForViewer(viewerRole);
        const viewerIsSuperAdmin = isSuperAdminRole(viewerRole);
        const requesterCompanyId = viewerIsSuperAdmin
            ? null
            : await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);

        if (activeOnly && !shouldPaginate && !search) {
            const params = [requesterCompanyId, viewerIsSuperAdmin];
            let departmentClause = '';
            if (departmentFilter && departmentFilter !== 'all') {
                params.push(departmentFilter);
                departmentClause = `AND u.department = $${params.length}`;
            }

            const activeUsersRes = await db.query(
                `SELECT
                    u.id,
                    u.full_name,
                    u.username,
                    u.role,
                    u.status,
                    u.department,
                    u.profile_picture
                 FROM users u
                 WHERE LOWER(u.role) = 'employee'
                   AND u.status = 'active'
                   AND (
                        $2::boolean = true
                        OR (
                            ($1::uuid IS NULL AND u.company_id IS NULL)
                            OR u.company_id = $1::uuid
                        )
                   )
                   ${departmentClause}
                 ORDER BY u.username ASC`,
                params
            );

            return res.json(activeUsersRes.rows);
        }

        const queryParams = [today, visibleRoles, requesterCompanyId, viewerIsSuperAdmin];
        const filters = [
            `LOWER(u.role) = ANY($2::text[])`,
            `u.deleted_at IS NULL`,
            `(
                $4::boolean = true
                OR (
                    ($3::uuid IS NULL AND u.company_id IS NULL)
                    OR u.company_id = $3::uuid
                )
            )`
        ];

        if (search) {
            queryParams.push(`%${search}%`);
            filters.push(`(
                u.username ILIKE $${queryParams.length}
                OR COALESCE(u.full_name, '') ILIKE $${queryParams.length}
                OR COALESCE(u.email, '') ILIKE $${queryParams.length}
                OR COALESCE(u.department, '') ILIKE $${queryParams.length}
            )`);
        }

        if (departmentFilter && departmentFilter !== 'all') {
            queryParams.push(departmentFilter);
            filters.push(`u.department = $${queryParams.length}`);
        }

        const whereClause = filters.join('\n              AND ');
        let totalCount = 0;

        if (shouldPaginate) {
            const countRes = await db.query(
                `SELECT COUNT(*)::int AS total
                 FROM users u
                 WHERE ${whereClause}`,
                queryParams
            );
            totalCount = countRes.rows[0]?.total || 0;
        }

        const paginatedParams = [...queryParams];
        let paginationClause = '';
        if (shouldPaginate) {
            paginatedParams.push(limit);
            paginatedParams.push(offset);
            paginationClause = `LIMIT $${paginatedParams.length - 1} OFFSET $${paginatedParams.length}`;
        }

        let result;
        try {
            result = await db.query(`
            SELECT
                u.id,
                u.full_name,
                u.username,
                u.role,
                u.status,
                u.department,
                u.minutes_balance,
                u.paid_leave_balance,
                u.profile_picture,
                (active_leave.start_date IS NOT NULL) AS is_on_leave,
                active_leave.start_date AS leave_start_date,
                active_leave.end_date AS leave_end_date,
                COALESCE(ARRAY_AGG(DISTINCT c.name) FILTER(WHERE c.name IS NOT NULL), '{}') as categories
            FROM users u
            LEFT JOIN LATERAL (
                SELECT
                    MIN(l.leave_date) AS start_date,
                    MAX(l.leave_date) AS end_date
                FROM leaves l
                WHERE l.user_id = u.id
                  AND l.status = 'approved'
                  AND l.request_id = (
                      SELECT l2.request_id
                      FROM leaves l2
                      WHERE l2.user_id = u.id
                        AND l2.status = 'approved'
                        AND l2.leave_date = $1::date
                      ORDER BY l2.leave_date ASC
                      LIMIT 1
                  )
            ) active_leave ON TRUE
            LEFT JOIN user_categories uc ON u.id = uc.user_id
            LEFT JOIN categories c ON uc.category_id = c.id
            WHERE ${whereClause}
            GROUP BY
                u.id,
                u.full_name,
                u.username,
                u.role,
                u.status,
                u.department,
                u.minutes_balance,
                u.paid_leave_balance,
                u.profile_picture,
                active_leave.start_date,
                active_leave.end_date
            ORDER BY u.id ASC
            ${paginationClause}
            `, paginatedParams);
        } catch (primaryErr) {
            console.error('[getUsers] Primary query failed, using fallback query:', primaryErr?.message || primaryErr);
            try {
                result = await db.query(`
                    SELECT
                        u.id,
                        u.full_name,
                        u.username,
                        u.role,
                        u.status,
                        u.department,
                        u.minutes_balance,
                        u.paid_leave_balance,
                        u.profile_picture,
                        EXISTS (
                            SELECT 1
                            FROM leaves l
                            WHERE l.user_id = u.id
                              AND l.status = 'approved'
                              AND l.leave_date = $1::date
                        ) AS is_on_leave,
                        CASE
                            WHEN EXISTS (
                                SELECT 1
                                FROM leaves l
                                WHERE l.user_id = u.id
                                  AND l.status = 'approved'
                                  AND l.leave_date = $1::date
                            ) THEN $1::date
                            ELSE NULL
                        END AS leave_start_date,
                        CASE
                            WHEN EXISTS (
                                SELECT 1
                                FROM leaves l
                                WHERE l.user_id = u.id
                                  AND l.status = 'approved'
                                  AND l.leave_date = $1::date
                            ) THEN $1::date
                            ELSE NULL
                        END AS leave_end_date,
                        COALESCE(ARRAY_AGG(DISTINCT c.name) FILTER(WHERE c.name IS NOT NULL), '{}') as categories
                    FROM users u
                    LEFT JOIN user_categories uc ON u.id = uc.user_id
                    LEFT JOIN categories c ON uc.category_id = c.id
                    WHERE ${whereClause}
                    GROUP BY
                        u.id,
                        u.full_name,
                        u.username,
                        u.role,
                        u.status,
                        u.department,
                        u.minutes_balance,
                        u.paid_leave_balance,
                        u.profile_picture
                    ORDER BY u.id ASC
                    ${paginationClause}
                `, paginatedParams);
            } catch (secondaryErr) {
                console.error('[getUsers] Secondary fallback failed, using minimal query:', secondaryErr?.message || secondaryErr);
                result = await db.query(`
                    SELECT
                        u.id,
                        u.full_name,
                        u.username,
                        u.role,
                        u.status,
                        u.department,
                        u.minutes_balance,
                        u.paid_leave_balance,
                        u.profile_picture,
                        false AS is_on_leave,
                        NULL::date AS leave_start_date,
                        NULL::date AS leave_end_date,
                        '{}'::text[] AS categories
                    FROM users u
                    WHERE ${whereClause}
                    ORDER BY u.id ASC
                    ${paginationClause}
                `, paginatedParams);
            }
        }
        const rows = result.rows.map((row) => {
            const normalizedTargetRole = normalizeRoleKey(row.role);
            if (!isAdminLikeRole(viewerRole) && (normalizedTargetRole === 'admin' || normalizedTargetRole === 'company_admin')) {
                const departmentLabel = String(row.department || '').trim() || 'Department';
                return {
                    ...row,
                    role: departmentLabel
                };
            }
            return row;
        });

        if (shouldPaginate) {
            const totalPages = Math.max(1, Math.ceil(totalCount / limit));
            const limits = !viewerIsSuperAdmin
                ? await getCompanyPlanUsage(requesterCompanyId)
                : null;
            return res.json({
                rows,
                limits,
                pagination: {
                    page,
                    limit,
                    total: totalCount,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrevious: page > 1
                }
            });
        }

        res.json(rows);
    } catch (err) {
        console.error(err);
        try {
            console.error('[getUsers] Scoped emergency fallback activated');
            const rawPage = Number.parseInt(String(req.query.page || '1'), 10);
            const rawLimit = Number.parseInt(String(req.query.limit || '25'), 10);
            const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
            const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 25;
            const offset = (page - 1) * limit;
            const shouldPaginate = ['1', 'true', 'yes'].includes(String(req.query.paginate || '').toLowerCase());
            const viewerRole = req.user?.role;
            const viewerIsSuperAdmin = isSuperAdminRole(viewerRole);
            const visibleRoles = getVisibleRolesForViewer(viewerRole);
            const requesterCompanyId = viewerIsSuperAdmin
                ? null
                : await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);

            const scopedParams = [visibleRoles];
            let companyScopeClause = '';
            if (!viewerIsSuperAdmin) {
                scopedParams.push(requesterCompanyId);
                companyScopeClause = `
                  AND (
                        ($2::uuid IS NULL AND u.company_id IS NULL)
                        OR u.company_id = $2::uuid
                  )`;
            }

            let totalCount = 0;
            if (shouldPaginate) {
                const countRes = await db.query(
                    `SELECT COUNT(*)::int AS total
                     FROM users u
                     WHERE LOWER(u.role) = ANY($1::text[])
                     ${companyScopeClause}`,
                    scopedParams
                );
                totalCount = countRes.rows[0]?.total || 0;
            }

            const emergencyParams = [...scopedParams];
            let paginationClause = 'LIMIT 100';
            if (shouldPaginate) {
                emergencyParams.push(limit);
                emergencyParams.push(offset);
                paginationClause = `LIMIT $${emergencyParams.length - 1} OFFSET $${emergencyParams.length}`;
            }

            const emergencyRowsRes = await db.query(
                `SELECT
                    u.id,
                    u.full_name,
                    u.username,
                    u.role,
                    u.status,
                    u.department,
                    u.minutes_balance,
                    u.paid_leave_balance,
                    u.profile_picture,
                    false AS is_on_leave,
                    NULL::date AS leave_start_date,
                    NULL::date AS leave_end_date,
                    '{}'::text[] AS categories
                 FROM users u
                 WHERE LOWER(u.role) = ANY($1::text[])
                 ${companyScopeClause}
                 ORDER BY u.id ASC
                 ${paginationClause}`,
                emergencyParams
            );

            const emergencyRows = emergencyRowsRes.rows || [];
            if (shouldPaginate) {
                const totalPages = Math.max(1, Math.ceil(totalCount / limit));
            const limits = !viewerIsSuperAdmin
                ? await getCompanyPlanUsage(requesterCompanyId)
                : null;
            return res.json({
                rows: emergencyRows,
                limits,
                pagination: {
                    page,
                    limit,
                        total: totalCount,
                        totalPages,
                        hasNext: page < totalPages,
                        hasPrevious: page > 1
                    },
                    fallback: true
                });
            }

            return res.json(emergencyRows);
        } catch (emergencyErr) {
            console.error('[getUsers] Scoped emergency fallback failed:', emergencyErr);
            res.status(500).json({ error: 'Server error' });
        }
    }
}

const deleteUser = async (req, res) => {
    const { id } = req.params;
    const client = await db.getClient();
    let profilePicturePath = null;

    try {
        const targetUserId = parseInt(id, 10);
        if (Number.isNaN(targetUserId)) {
            return res.status(400).json({ error: 'Invalid user id' });
        }

        if (req.user?.id === targetUserId) {
            return res.status(400).json({ error: 'You cannot delete your own account' });
        }

        const viewerRole = req.user?.role;
        const viewerIsSuperAdmin = isSuperAdminRole(viewerRole);
        const requesterCompanyId = viewerIsSuperAdmin
            ? null
            : await resolveRequesterCompanyId(req.user?.id, req.user?.company_id, client);

        await client.query('BEGIN');

        const userRes = await client.query(
            `SELECT profile_picture, company_id 
             FROM users 
             WHERE id = $1
               AND deleted_at IS NULL`, 
            [targetUserId]
        );
        
        if (userRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User not found' });
        }

        const targetUser = userRes.rows[0];
        if (!viewerIsSuperAdmin && targetUser.company_id !== requesterCompanyId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Access denied' });
        }

        profilePicturePath = targetUser.profile_picture || null;

        // Hard delete user. Related records are cleaned by FK ON DELETE rules.
        const deleteRes = await client.query(
            `DELETE FROM users
             WHERE id = $1
             RETURNING id`,
            [targetUserId]
        );
        if (deleteRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User not found' });
        }

        await client.query('COMMIT');

        if (profilePicturePath) {
            const { deleteFile } = require('../utils/fileUtils');
            deleteFile(profilePicturePath);
        }

        res.json({ message: 'User deleted successfully' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Delete User Error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
};

const updateUserPaidLeaveBalance = async (req, res) => {
    try {
        const { id } = req.params;
        const { balance } = req.body;

        if (balance === undefined || isNaN(balance)) {
            return res.status(400).json({ error: 'Valid balance is required' });
        }

        const result = await db.query(
            'UPDATE users SET paid_leave_balance = $1 WHERE id = $2 RETURNING id, username, paid_leave_balance',
            [balance, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        const io = req.app.get('io'); // Changed from 'socketio' to 'io' for consistency
        if (io) {
            io.emit('balance_update', {
                user_id: user.id,
                paid_leave_balance: user.paid_leave_balance,
                type: 'manual_adjustment'
            });
        }

        res.json({ message: 'User paid leave balance updated successfully', user });
    } catch (error) {
        console.error('Error updating user paid leave balance:', error);
        res.status(500).json({ error: 'Failed to update user paid leave balance' });
    }
};

const resetUserPaidLeaveBalance = async (req, res) => {
    try {
        const { id } = req.params;
        const viewerRole = req.user?.role;
        const viewerIsSuperAdmin = isSuperAdminRole(viewerRole);
        const requesterCompanyId = viewerIsSuperAdmin
            ? null
            : await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);

        const result = await db.query(
            `UPDATE users 
             SET paid_leave_balance = 0 
             WHERE id = $1 
               AND (
                 $2::boolean = true
                 OR (
                    ($3::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $3::uuid
                 )
               )
             RETURNING id, username, paid_leave_balance`,
            [id, viewerIsSuperAdmin, requesterCompanyId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found or access denied' });
        }

        const user = result.rows[0];
        const io = req.app.get('io');
        if (io) {
            io.emit('balance_update', {
                user_id: user.id,
                paid_leave_balance: 0,
                type: 'manual_paid_leave_reset'
            });
        }

        res.json({ message: `Paid leave cleared for ${user.username}`, user });
    } catch (error) {
        console.error('Error resetting user paid leave balance:', error);
        res.status(500).json({ error: 'Failed to clear paid leave balance' });
    }
};


const resetAllPaidLeaveBalances = async (req, res) => {
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const result = await db.query(
            `UPDATE users 
             SET paid_leave_balance = 0 
             WHERE COALESCE(paid_leave_balance, 0) <> 0
               AND (
                    ($1::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $1::uuid
               )
             RETURNING id, username`,
            [requesterCompanyId]
        );

        const io = req.app.get('io');
        if (io) {
            for (const user of result.rows) {
                io.emit('balance_update', {
                    user_id: user.id,
                    paid_leave_balance: 0,
                    type: 'manual_paid_leave_reset'
                });
            }
        }

        res.json({
            message: result.rows.length > 0
                ? `Cleared paid leave for ${result.rows.length} user${result.rows.length === 1 ? '' : 's'}`
                : 'All paid leave balances were already zero',
            count: result.rows.length
        });

        // Background socket notifications
        if (result.rows.length > 0) {
            const { runInBackground } = require('../utils/background');
            runInBackground(async () => {
                const io = req.app.get('io');
                if (io) {
                    for (const user of result.rows) {
                        io.emit('balance_update', {
                            user_id: user.id,
                            paid_leave_balance: 0,
                            type: 'manual_paid_leave_reset'
                        });
                    }
                }
            });
        }
    } catch (error) {
        console.error('Error resetting all paid leave balances:', error);
        res.status(500).json({ error: 'Failed to clear all paid leave balances' });
    }
};

const resetUserMinutesBalance = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            'UPDATE users SET minutes_balance = 0 WHERE id = $1 RETURNING id, username, minutes_balance',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        const io = req.app.get('io');
        if (io) {
            io.emit('balance_update', {
                user_id: user.id,
                minutes_balance: 0,
                type: 'manual_minutes_reset'
            });
        }

        res.json({ message: `Balance cleared for ${user.username}`, user });
    } catch (error) {
        console.error('Error resetting user minutes balance:', error);
        res.status(500).json({ error: 'Failed to clear user balance' });
    }
};

const resetAllMinutesBalances = async (req, res) => {
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const result = await db.query(
            `UPDATE users 
             SET minutes_balance = 0 
             WHERE COALESCE(minutes_balance, 0) <> 0
               AND (
                    ($1::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $1::uuid
               )
             RETURNING id, username`,
            [requesterCompanyId]
        );

        const io = req.app.get('io');
        if (io) {
            for (const user of result.rows) {
                io.emit('balance_update', {
                    user_id: user.id,
                    minutes_balance: 0,
                    type: 'manual_minutes_reset'
                });
            }
        }

        res.json({
            message: result.rows.length > 0
                ? `Cleared balances for ${result.rows.length} user${result.rows.length === 1 ? '' : 's'}`
                : 'All balances were already zero',
            count: result.rows.length
        });

        // Background socket notifications
        if (result.rows.length > 0) {
            const { runInBackground } = require('../utils/background');
            runInBackground(async () => {
                const io = req.app.get('io');
                if (io) {
                    for (const user of result.rows) {
                        io.emit('balance_update', {
                            user_id: user.id,
                            minutes_balance: 0,
                            type: 'manual_minutes_reset'
                        });
                    }
                }
            });
        }
    } catch (error) {
        console.error('Error resetting all minutes balances:', error);
        res.status(500).json({ error: 'Failed to clear all balances' });
    }
};

const clearAllSkippedDays = async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id, client);
        // Target all employees in the company
        const employeesRes = await client.query(
            `SELECT id, username FROM users 
             WHERE role = 'employee'
               AND (
                    ($1::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $1::uuid
               )
             FOR UPDATE`,
            [requesterCompanyId]
        );

        if (employeesRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ message: 'No employees found', count: 0 });
        }
        let totalSkippedCleared = 0;
        let totalMinutesRestored = 0;

        for (const employee of employeesRes.rows) {
            const id = employee.id;

            // Find all absence deductions that haven't been cleared (markers have balance_change = 0)
            const skippedDatesRes = await client.query(
                `SELECT
                    COALESCE(covered_date::date, timestamp::date) AS skipped_date
                 FROM activity_logs
                 WHERE user_id = $1
                   AND activity_type = 'absence_deduction'
                   AND COALESCE(balance_change, 0) <> 0
                 GROUP BY COALESCE(covered_date::date, timestamp::date)`,
                [id]
            );

            const skippedRes = await client.query(
                `SELECT
                    SUM(balance_change) AS total_change
                 FROM activity_logs
                 WHERE user_id = $1
                   AND activity_type = 'absence_deduction'
                   AND COALESCE(balance_change, 0) <> 0`,
                [id]
            );

            const skippedCount = skippedDatesRes.rows.length;
            const totalChange = Math.abs(parseInt(skippedRes.rows[0]?.total_change || 0));

            if (skippedCount > 0) {
                // Restore balance
                await client.query(
                    'UPDATE users SET minutes_balance = COALESCE(minutes_balance, 0) + $1 WHERE id = $2',
                    [totalChange, id]
                );

                // Delete the original penalized logs
                await client.query(
                    "DELETE FROM activity_logs WHERE user_id = $1 AND activity_type = 'absence_deduction' AND COALESCE(balance_change, 0) <> 0",
                    [id]
                );

                // Insert 0-change status markers for each date to show they are "cleared"
                for (const row of skippedDatesRes.rows) {
                    const skippedDate = timeService.getDateStr(row.skipped_date);
                    const markerTimestamp = `${skippedDate}T23:59:59Z`;
                    await client.query(
                        `INSERT INTO activity_logs (user_id, activity_type, timestamp, covered_date, balance_change)
                         VALUES ($1, 'absence_deduction', $2, $3, 0)`,
                        [id, markerTimestamp, skippedDate]
                    );
                }

                totalSkippedCleared += skippedCount;
                totalMinutesRestored += totalChange;

                // Notify individual users via socket if online
                const io = req.app.get('io');
                if (io) {
                    const balanceRes = await client.query('SELECT minutes_balance, paid_leave_balance FROM users WHERE deleted_at IS NULL AND id = $1', [id]);
                    io.to(id.toString()).emit('balance_update', {
                        user_id: id,
                        minutes_balance: balanceRes.rows[0].minutes_balance,
                        paid_leave_balance: balanceRes.rows[0].paid_leave_balance,
                        type: 'skipped_days_cleared'
                    });
                }
            }
        }

        await client.query('COMMIT');

        res.json({
            message: `Initiated clearing of skipped days across ${employeesRes.rows.length} employees. This will process in the background.`,
            count: employeesRes.rows.length
        });

        const { runInBackground } = require('../utils/background');
        runInBackground(async () => {
            const clientBg = await db.getClient();
            try {
                await clientBg.query('BEGIN');
                let totalSkippedCleared = 0;
                let totalMinutesRestored = 0;

                for (const employee of employeesRes.rows) {
                    const id = employee.id;

                    const skippedDatesRes = await clientBg.query(
                        `SELECT
                            COALESCE(covered_date::date, timestamp::date) AS skipped_date
                         FROM activity_logs
                         WHERE user_id = $1
                           AND activity_type = 'absence_deduction'
                           AND COALESCE(balance_change, 0) <> 0
                         GROUP BY COALESCE(covered_date::date, timestamp::date)`,
                        [id]
                    );

                    const skippedRes = await clientBg.query(
                        `SELECT
                            SUM(balance_change) AS total_change
                         FROM activity_logs
                         WHERE user_id = $1
                           AND activity_type = 'absence_deduction'
                           AND COALESCE(balance_change, 0) <> 0`,
                        [id]
                    );

                    const skippedCount = skippedDatesRes.rows.length;
                    const totalChange = Math.abs(parseInt(skippedRes.rows[0]?.total_change || 0));

                    if (skippedCount > 0) {
                        await clientBg.query(
                            'UPDATE users SET minutes_balance = COALESCE(minutes_balance, 0) + $1 WHERE id = $2',
                            [totalChange, id]
                        );

                        await clientBg.query(
                            "DELETE FROM activity_logs WHERE user_id = $1 AND activity_type = 'absence_deduction' AND COALESCE(balance_change, 0) <> 0",
                            [id]
                        );

                        for (const row of skippedDatesRes.rows) {
                            const skippedDate = timeService.getDateStr(row.skipped_date);
                            const markerTimestamp = `${skippedDate}T23:59:59Z`;
                            await clientBg.query(
                                `INSERT INTO activity_logs (user_id, activity_type, timestamp, covered_date, balance_change)
                                 VALUES ($1, 'absence_deduction', $2, $3, 0)`,
                                [id, markerTimestamp, skippedDate]
                            );
                        }

                        totalSkippedCleared += skippedCount;
                        totalMinutesRestored += totalChange;

                        const io = req.app.get('io');
                        if (io) {
                            const balanceRes = await clientBg.query('SELECT minutes_balance, paid_leave_balance FROM users WHERE deleted_at IS NULL AND id = $1', [id]);
                            io.to(id.toString()).emit('balance_update', {
                                user_id: id,
                                minutes_balance: balanceRes.rows[0].minutes_balance,
                                paid_leave_balance: balanceRes.rows[0].paid_leave_balance,
                                type: 'skipped_days_cleared'
                            });
                        }
                    }
                }
                await clientBg.query('COMMIT');
                console.log(`[Background] Cleared ${totalSkippedCleared} skipped days across ${employeesRes.rows.length} employees`);
            } catch (error) {
                await clientBg.query('ROLLBACK');
                console.error('[Background] Error clearing skipped days:', error);
            } finally {
                clientBg.release();
            }
        });
    } catch (error) {
        console.error('Error starting skipped days clearing:', error);
        res.status(500).json({ error: 'Failed to start skipped days clearing' });
    } finally {
        if (client) client.release();
    }
};

const clearUserLeaveHistory = async (req, res) => {
    const { id } = req.params;
    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        const userRes = await client.query(
            'SELECT id, username, minutes_balance, paid_leave_balance FROM users WHERE deleted_at IS NULL AND id = $1 FOR UPDATE',
            [id]
        );

        if (userRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User not found' });
        }

        const refundRes = await client.query(
            `SELECT COUNT(*)::int AS paid_days_to_refund
             FROM leaves
             WHERE user_id = $1 AND status = 'approved' AND is_paid = TRUE`,
            [id]
        );

        const paidDaysToRefund = refundRes.rows[0]?.paid_days_to_refund || 0;

        if (paidDaysToRefund > 0) {
            await client.query(
                'UPDATE users SET paid_leave_balance = COALESCE(paid_leave_balance, 0) + $1 WHERE id = $2',
                [paidDaysToRefund, id]
            );
        }

        const deleteLeavesRes = await client.query(
            'DELETE FROM leaves WHERE user_id = $1 RETURNING id',
            [id]
        );

        const balanceRes = await client.query(
            'SELECT paid_leave_balance, minutes_balance FROM users WHERE deleted_at IS NULL AND id = $1',
            [id]
        );

        await client.query('COMMIT');

        const deletedLeavesCount = deleteLeavesRes.rowCount || 0;
        const paidLeaveBalance = balanceRes.rows[0]?.paid_leave_balance ?? 0;
        const minutesBalance = balanceRes.rows[0]?.minutes_balance ?? 0;
        const user = userRes.rows[0];

        const io = req.app.get('io');
        if (io) {
            io.emit('leave_update', {
                type: 'deleted',
                user_id: Number(id),
                cleared: true,
                count: deletedLeavesCount,
                message: `Leave history cleared for ${user.username}`
            });

            io.emit('balance_update', {
                user_id: Number(id),
                minutes_balance: minutesBalance,
                paid_leave_balance: paidLeaveBalance,
                type: 'leave_history_cleared'
            });

            io.emit('activity_logged', {
                user_id: Number(id),
                activity_type: 'leave_history_cleared'
            });
        }

        res.json({
            message: deletedLeavesCount > 0
                ? `Cleared ${deletedLeavesCount} leave entr${deletedLeavesCount === 1 ? 'y' : 'ies'} for ${user.username}`
                : `${user.username} has no leave history to clear`,
            count: deletedLeavesCount,
            clearedLeaves: deletedLeavesCount,
            refundedPaidDays: paidDaysToRefund,
            paidLeaveBalance,
            minutesBalance
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error clearing user leave history:', error);
        res.status(500).json({ error: 'Failed to clear leave history' });
    } finally {
        client.release();
    }
};

const clearUserSkippedDays = async (req, res) => {
    const { id } = req.params;
    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        const userRes = await client.query(
            'SELECT id, username, minutes_balance, paid_leave_balance FROM users WHERE deleted_at IS NULL AND id = $1 FOR UPDATE',
            [id]
        );

        if (userRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User not found' });
        }

        const skippedDatesRes = await client.query(
            `SELECT
                COALESCE(covered_date::date, timestamp::date) AS skipped_date
             FROM activity_logs
             WHERE user_id = $1
               AND activity_type = 'absence_deduction'
               AND COALESCE(balance_change, 0) <> 0
             GROUP BY COALESCE(covered_date::date, timestamp::date)
             ORDER BY skipped_date ASC`,
            [id]
        );

        const skippedRes = await client.query(
            `SELECT
                COUNT(*)::int AS raw_skipped_count,
                COALESCE(SUM(balance_change), 0)::int AS skipped_balance_change
             FROM activity_logs
             WHERE user_id = $1
               AND activity_type = 'absence_deduction'
               AND COALESCE(balance_change, 0) <> 0`,
            [id]
        );

        const skippedCount = skippedDatesRes.rows.length;
        const skippedBalanceChange = skippedRes.rows[0]?.skipped_balance_change || 0;
        const skippedMinutesToRestore = Math.abs(skippedBalanceChange);

        if (skippedMinutesToRestore > 0) {
            await client.query(
                'UPDATE users SET minutes_balance = COALESCE(minutes_balance, 0) + $1 WHERE id = $2',
                [skippedMinutesToRestore, id]
            );
        }

        await client.query(
            `DELETE FROM activity_logs
             WHERE user_id = $1
               AND activity_type = 'absence_deduction'`,
            [id]
        );

        for (const row of skippedDatesRes.rows) {
            const skippedDate = timeService.getDateStr(row.skipped_date);
            const markerTimestamp = `${skippedDate}T23:59:59Z`;
            await client.query(
                `INSERT INTO activity_logs (user_id, activity_type, timestamp, covered_date, balance_change)
                 VALUES ($1, 'absence_deduction', $2, $3, 0)`,
                [id, markerTimestamp, skippedDate]
            );
        }

        const balanceRes = await client.query(
            'SELECT paid_leave_balance, minutes_balance FROM users WHERE deleted_at IS NULL AND id = $1',
            [id]
        );

        await client.query('COMMIT');

        const paidLeaveBalance = balanceRes.rows[0]?.paid_leave_balance ?? 0;
        const minutesBalance = balanceRes.rows[0]?.minutes_balance ?? 0;
        const user = userRes.rows[0];

        const io = req.app.get('io');
        if (io) {
            io.emit('leave_update', {
                type: 'deleted',
                user_id: Number(id),
                cleared: true,
                count: skippedCount,
                message: `Skipped days cleared for ${user.username}`
            });

            io.emit('balance_update', {
                user_id: Number(id),
                minutes_balance: minutesBalance,
                paid_leave_balance: paidLeaveBalance,
                type: 'skipped_days_cleared'
            });

            io.emit('activity_logged', {
                user_id: Number(id),
                activity_type: 'skipped_days_cleared'
            });
        }

        res.json({
            message: skippedCount > 0
                ? `Cleared ${skippedCount} skipped day entr${skippedCount === 1 ? 'y' : 'ies'} for ${user.username}`
                : `${user.username} has no skipped days to clear`,
            count: skippedCount,
            restoredMinutes: skippedMinutesToRestore,
            paidLeaveBalance,
            minutesBalance
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error clearing user skipped days:', error);
        res.status(500).json({ error: 'Failed to clear skipped days' });
    } finally {
        client.release();
    }
};

const updateUserRole = async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    if (!['admin', 'moderator', 'employee'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }

    const client = await db.getClient();
    let transactionOpen = false;
    try {
        await client.query('BEGIN');
        transactionOpen = true;
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id, client);
        const targetRoleKey = normalizeRoleKey(role);

        const targetUserRes = await client.query(
            `SELECT id, role, company_id
             FROM users
             WHERE id = $1
               AND deleted_at IS NULL
               AND (
                    ($2::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $2::uuid
               )
             LIMIT 1`,
            [id, requesterCompanyId]
        );
        if (targetUserRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User not found' });
        }

        const currentRoleKey = normalizeRoleKey(targetUserRes.rows[0].role);
        if (role === 'employee') {
            const deptResult = await client.query(
                `SELECT department
                 FROM users
                 WHERE id = $1
                   AND deleted_at IS NULL
                   AND (
                        ($2::uuid IS NULL AND company_id IS NULL)
                        OR company_id = $2::uuid
                   )`,
                [id, requesterCompanyId]
            );
            const existingDepartment = deptResult.rows[0]?.department;
            if (!existingDepartment) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Department is required for employees. Set department first.' });
            }

            const departmentRes = await findDepartmentByName(existingDepartment, requesterCompanyId, client);
            if (departmentRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Department is invalid. Assign a valid department first.' });
            }
        }

        const limitField = getPlanLimitFieldForRole(targetRoleKey);
        if (limitField && requesterCompanyId) {
            const usage = await getCompanyPlanUsage(requesterCompanyId, client);
            if (usage && !usage.unlimited_access) {
                const usageByField = {
                    max_company_admins: usage.company_admins,
                    max_project_managers: usage.project_managers,
                    max_employees: usage.employees
                };
                const selectedUsage = usageByField[limitField];
                const isSameLimitBucket = getPlanLimitFieldForRole(currentRoleKey) === limitField;
                const effectiveCurrent = isSameLimitBucket
                    ? Math.max(0, selectedUsage.current - 1)
                    : selectedUsage.current;
                if (effectiveCurrent >= selectedUsage.limit) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        error: `Plan limit reached for ${targetRoleKey}`,
                        role: targetRoleKey,
                        limit: selectedUsage.limit,
                        current: selectedUsage.current
                    });
                }
            }
        }

        await client.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
        await client.query('COMMIT');
        transactionOpen = false;
        res.json({ message: 'User role updated' });
    } catch (err) {
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackErr) {
                console.error('Update Role Rollback Error:', rollbackErr);
            }
        }
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
}

const updateUserDepartment = async (req, res) => {
    const { id } = req.params;
    const { department } = req.body;

    if (typeof department !== 'string') {
        return res.status(400).json({ error: 'Department must be a string' });
    }

    const trimmedDepartment = normalizeDepartmentName(department);

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const userRes = await db.query(
            `SELECT role
             FROM users
             WHERE id = $1
               AND (
                    ($2::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $2::uuid
               )`,
            [id, requesterCompanyId]
        );
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (userRes.rows[0].role === 'employee' && !trimmedDepartment) {
            return res.status(400).json({ error: 'Department is required for employees' });
        }

        let canonicalDepartment = null;
        if (trimmedDepartment) {
            const departmentRes = await findDepartmentByName(trimmedDepartment, requesterCompanyId);
            if (departmentRes.rows.length === 0) {
                return res.status(400).json({ error: 'Invalid department. Create it in Settings first.' });
            }
            canonicalDepartment = departmentRes.rows[0].name;
        }

        await db.query('UPDATE users SET department = $1 WHERE id = $2', [canonicalDepartment, id]);
        res.json({ message: 'User department updated' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

const getDepartments = async (req, res) => {
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const result = await db.query(
            `SELECT id, name, created_at
             FROM departments
             WHERE (
                    ($1::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $1::uuid
             )
             ORDER BY name ASC`,
            [requesterCompanyId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const createDepartment = async (req, res) => {
    const normalizedName = normalizeDepartmentName(req.body?.name);
    if (!normalizedName) {
        return res.status(400).json({ error: 'Department name is required' });
    }

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const existingRes = await findDepartmentByName(normalizedName, requesterCompanyId);
        if (existingRes.rows.length > 0) {
            return res.status(400).json({ error: 'Department already exists' });
        }

        const result = await db.query(
            `INSERT INTO departments (name, company_id)
             VALUES ($1, $2::uuid)
             RETURNING id, name, created_at`,
            [normalizedName, requesterCompanyId]
        );

        const io = req.app.get('io');
        if (io) {
            io.emit('settings_update', { type: 'department_created', department: result.rows[0] });
        }

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const updateDepartment = async (req, res) => {
    const { id } = req.params;
    const normalizedName = normalizeDepartmentName(req.body?.name);

    if (!normalizedName) {
        return res.status(400).json({ error: 'Department name is required' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id, client);

        const departmentRes = await client.query(
            `SELECT id, name
             FROM departments
             WHERE id = $1
               AND (
                    ($2::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $2::uuid
               )
             FOR UPDATE`,
            [id, requesterCompanyId]
        );

        if (departmentRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Department not found' });
        }

        const currentDepartment = departmentRes.rows[0];

        const duplicateRes = await client.query(
            `SELECT id
             FROM departments
             WHERE LOWER(name) = LOWER($1)
               AND id <> $2
               AND (
                    ($3::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $3::uuid
               )
             LIMIT 1`,
            [normalizedName, id, requesterCompanyId]
        );
        if (duplicateRes.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Department already exists' });
        }

        const updatedRes = await client.query(
            'UPDATE departments SET name = $1 WHERE id = $2 RETURNING id, name, created_at',
            [normalizedName, id]
        );

        const syncUsersRes = await client.query(
            'UPDATE users SET department = $1 WHERE LOWER(COALESCE(department, \'\')) = LOWER($2)',
            [normalizedName, currentDepartment.name]
        );

        await client.query('COMMIT');

        const io = req.app.get('io');
        if (io) {
            io.emit('settings_update', {
                type: 'department_updated',
                department: updatedRes.rows[0],
                affectedUsers: syncUsersRes.rowCount
            });
        }

        res.json({
            ...updatedRes.rows[0],
            affectedUsers: syncUsersRes.rowCount
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
};

const deleteDepartment = async (req, res) => {
    const { id } = req.params;
    const client = await db.getClient();

    try {
        await client.query('BEGIN');
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id, client);

        const departmentRes = await client.query(
            `SELECT id, name
             FROM departments
             WHERE id = $1
               AND (
                    ($2::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $2::uuid
               )
             FOR UPDATE`,
            [id, requesterCompanyId]
        );
        if (departmentRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Department not found' });
        }

        const department = departmentRes.rows[0];
        const usageRes = await client.query(
            'SELECT COUNT(*)::int AS count FROM users WHERE deleted_at IS NULL AND LOWER(COALESCE(department, \'\')) = LOWER($1)',
            [department.name]
        );
        const assignedUsers = usageRes.rows[0]?.count || 0;
        if (assignedUsers > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: `Cannot delete. Department is assigned to ${assignedUsers} user${assignedUsers === 1 ? '' : 's'}.`
            });
        }

        await client.query('DELETE FROM departments WHERE id = $1', [id]);
        await client.query('COMMIT');

        const io = req.app.get('io');
        if (io) {
            io.emit('settings_update', { type: 'department_deleted', departmentId: Number(id) });
        }

        res.json({ message: 'Department deleted' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
};

const getCategories = async (req, res) => {
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const result = await db.query(
            `SELECT id, name
             FROM categories
             WHERE (
                    ($1::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $1::uuid
             )
             ORDER BY name ASC`,
            [requesterCompanyId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

const createCategory = async (req, res) => {
    const { name } = req.body;
    if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Category name is required' });
    }

    const trimmedName = name.trim();

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const result = await db.query(
            `INSERT INTO categories (name, company_id)
             VALUES ($1, $2::uuid)
             RETURNING id, name`,
            [trimmedName, requesterCompanyId]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Category already exists' });
        }
        res.status(500).json({ error: 'Server error' });
    }
}

const deleteCategory = async (req, res) => {
    const { id } = req.params;
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        await db.query(
            `DELETE FROM categories
             WHERE id = $1
               AND (
                    ($2::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $2::uuid
               )`,
            [id, requesterCompanyId]
        );
        res.json({ message: 'Category deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

const updateUserCategories = async (req, res) => {
    const { id } = req.params;
    const { categoryIds } = req.body;

    if (!Array.isArray(categoryIds)) {
        return res.status(400).json({ error: 'categoryIds must be an array' });
    }

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        await db.query('BEGIN');
        const targetUserRes = await db.query(
            `SELECT id
             FROM users
             WHERE id = $1
               AND (
                    ($2::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $2::uuid
               )`,
            [id, requesterCompanyId]
        );
        if (targetUserRes.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'User not found' });
        }

        await db.query('DELETE FROM user_categories WHERE user_id = $1', [id]);

        const uniqueIds = Array.from(new Set(categoryIds)).filter((catId) => Number.isInteger(catId));
        for (const catId of uniqueIds) {
            const categoryRes = await db.query(
                `SELECT id
                 FROM categories
                 WHERE id = $1
                   AND (
                        ($2::uuid IS NULL AND company_id IS NULL)
                        OR company_id = $2::uuid
                   )`,
                [catId, requesterCompanyId]
            );
            if (categoryRes.rows.length === 0) continue;
            await db.query(
                'INSERT INTO user_categories (user_id, category_id) VALUES ($1, $2)',
                [id, catId]
            );
        }
        await db.query('COMMIT');
        res.json({ message: 'User categories updated' });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}



const updateHolidays = async (req, res) => {
    const { holidays } = req.body;

    if (!Array.isArray(holidays)) {
        return res.status(400).json({ error: 'Holidays must be an array' });
    }

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        await upsertScopedSettingValue(db, 'holidays', JSON.stringify(holidays), requesterCompanyId);
        res.json({ message: 'Holidays updated successfully' });

        // Emit socket event for real-time updates
        const io = req.app.get('io');
        if (io) {
            io.emit('settings_update', {
                type: 'holidays_updated',
                holidays
            });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

const getHolidays = async (req, res) => {
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const holidaysRaw = await getScopedSettingValue(db, 'holidays', requesterCompanyId);
        const holidays = holidaysRaw ? JSON.parse(holidaysRaw) : [];
        res.json(holidays);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

// Get work hours settings
const getWorkHours = async (req, res) => {
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const workHoursRaw = await getScopedSettingValue(db, 'work_hours', requesterCompanyId);
        const workHoursSettings = workHoursRaw
            ? JSON.parse(workHoursRaw)
            : { standardHours: 4, weekendDays: [5, 6] };

        // Get Dev Tools Settings
        const devToolsRaw = await getScopedSettingValue(db, 'dev_tools_settings', requesterCompanyId);
        const devToolsConfig = devToolsRaw
            ? JSON.parse(devToolsRaw)
            : { enabled: true };

        workHoursSettings.devToolsEnabled = devToolsConfig.enabled;

        res.json(workHoursSettings);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

// Get early leaves
const getEarlyLeaves = async (req, res) => {
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const result = await db.query(`
            SELECT el.id, u.username, el.reason, el.hours_worked, el.created_at 
            FROM early_leaves el 
            JOIN users u ON el.user_id = u.id 
            WHERE (
                ($1::uuid IS NULL AND u.company_id IS NULL)
                OR u.company_id = $1::uuid
            )
            ORDER BY el.created_at DESC
            `, [requesterCompanyId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

const updateWorkHours = async (req, res) => {
    const { standardHours, overtimeThreshold } = req.body;

    if (typeof standardHours !== 'number' || typeof overtimeThreshold !== 'number') {
        return res.status(400).json({ error: 'All fields must be numbers' });
    }

    if (standardHours < 0 || overtimeThreshold < 0) {
        return res.status(400).json({ error: 'Values cannot be negative' });
    }

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        // Get existing settings to preserve weekendDays
        const existingRaw = await getScopedSettingValue(db, 'work_hours', requesterCompanyId);
        const existingSettings = existingRaw
            ? JSON.parse(existingRaw)
            : { weekendDays: [5, 6] };

        const settings = {
            standardHours,
            overtimeThreshold,
            weekendDays: existingSettings.weekendDays || [5, 6]
        };
        await upsertScopedSettingValue(db, 'work_hours', JSON.stringify(settings), requesterCompanyId);
        res.json({ message: 'Work hours updated successfully', settings });

        // Emit socket event for real-time updates
        const io = req.app.get('io');
        if (io) {
            io.emit('settings_update', {
                type: 'work_hours_updated',
                settings
            });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

const updateWeekendDays = async (req, res) => {
    const { weekendDays } = req.body;

    if (!Array.isArray(weekendDays)) {
        return res.status(400).json({ error: 'Weekend days must be an array' });
    }

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        // Get existing settings to preserve work hours
        const existingRaw = await getScopedSettingValue(db, 'work_hours', requesterCompanyId);
        const existingSettings = existingRaw
            ? JSON.parse(existingRaw)
            : { standardHours: 4, overtimeThreshold: 6, workingDaysPerMonth: 20 };

        const settings = {
            standardHours: existingSettings.standardHours || 4,
            overtimeThreshold: existingSettings.overtimeThreshold || 6,
            weekendDays
        };
        await upsertScopedSettingValue(db, 'work_hours', JSON.stringify(settings), requesterCompanyId);
        res.json({ message: 'Weekdays off updated successfully', settings });

        // Emit socket event for real-time updates
        const io = req.app.get('io');
        if (io) {
            io.emit('settings_update', {
                type: 'work_hours_updated',
                settings
            });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

const getEmailSettings = async (req, res) => {
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const configRaw = await getScopedSettingValue(db, 'admin_notification_settings', requesterCompanyId);
        const rawConfig = configRaw
            ? JSON.parse(configRaw)
            : {
                enabled: false,
                emailEnabled: false,
                recipientEmails: [],
                whatsappNumbers: [],
                telegramChatIds: [],
                telegramChatIdLabels: {},
                scheduleTime: '18:00',
                smtpHost: process.env.SMTP_HOST || '',
                smtpPort: process.env.SMTP_PORT || '587',
                smtpUser: process.env.SMTP_USER || '',
                smtpPass: process.env.SMTP_PASS || '',
                emailDomainMode: 'all',
                allowedEmailDomains: []
            };

        const domainPolicy = buildEmailDomainPolicyFromConfig(rawConfig);
        const config = {
            ...rawConfig,
            emailDomainMode: domainPolicy.mode,
            allowedEmailDomains: domainPolicy.allowedDomains
        };

        const telegramChatIdLabels = { ...(config.telegramChatIdLabels || {}) };
        if (Array.isArray(config.telegramChatIds) && config.telegramChatIds.length > 0) {
            const telegramUsersRes = await db.query(
                `SELECT telegram_chat_id, contact_number
                 FROM users
                 WHERE telegram_chat_id IS NOT NULL
                   AND contact_number IS NOT NULL
                   AND (
                        ($1::uuid IS NULL AND company_id IS NULL)
                        OR company_id = $1::uuid
                   )`,
                [requesterCompanyId]
            );

            for (const row of telegramUsersRes.rows) {
                if (config.telegramChatIds.includes(row.telegram_chat_id) && !telegramChatIdLabels[row.telegram_chat_id]) {
                    telegramChatIdLabels[row.telegram_chat_id] = row.contact_number;
                }
            }
        }

        config.telegramChatIdLabels = telegramChatIdLabels;
        res.json(config);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const saveEmailSettings = async (req, res) => {
    const { 
        enabled, emailEnabled, recipientEmails, whatsappNumbers, telegramChatIds, telegramChatIdLabels, scheduleTime, 
        smtpHost, smtpPort, smtpUser, smtpPass, emailDomainMode, allowedEmailDomains
    } = req.body;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const normalizedMode = normalizeEmailDomainMode(emailDomainMode);
        const normalizedAllowedDomains = parseAllowedEmailDomains(allowedEmailDomains);
        const effectiveAllowedDomains = normalizedMode === 'allowlist' ? normalizedAllowedDomains : [];

        if (normalizedMode === 'allowlist' && effectiveAllowedDomains.length === 0) {
            return res.status(400).json({ error: 'At least one allowed email domain ending is required when restriction is enabled' });
        }

        const rawRecipientEmails = Array.isArray(recipientEmails)
            ? recipientEmails
            : String(recipientEmails || '').split(',');
        const normalizedRecipientEmails = Array.from(new Set(
            rawRecipientEmails
                .map((value) => normalizeEmail(value))
                .filter(Boolean)
        ));

        for (const email of normalizedRecipientEmails) {
            if (!isValidEmail(email)) {
                return res.status(400).json({ error: `Invalid recipient email: ${email}` });
            }
            try {
                assertEmailAllowedByPolicy(email, {
                    mode: normalizedMode,
                    allowedDomains: effectiveAllowedDomains
                }, 'Recipient email');
            } catch (policyErr) {
                return res.status(policyErr.statusCode || 400).json({ error: policyErr.message });
            }
        }

        const config = {
            enabled,
            emailEnabled,
            recipientEmails: normalizedRecipientEmails,
            whatsappNumbers,
            telegramChatIds,
            telegramChatIdLabels: telegramChatIdLabels || {},
            scheduleTime, // Should be in HH:mm format from frontend
            timezone: req.body.timezone || 'UTC',
            smtpHost,
            smtpPort,
            smtpUser,
            smtpPass,
            emailDomainMode: normalizedMode,
            allowedEmailDomains: effectiveAllowedDomains,
            lastSentDate: null // Reset to allow immediate re-triggering if schedule changes
        };

        await upsertScopedSettingValue(db, 'admin_notification_settings', JSON.stringify(config), requesterCompanyId);

        // Reload scheduler
        const scheduler = require('../scheduler');
        scheduler.reload();

        // Reconfigure email service
        const emailService = require('../utils/emailService');
        if (smtpHost && smtpPort && smtpUser && smtpPass) {
            emailService.configureTransporter({
                host: smtpHost,
                port: smtpPort,
                user: smtpUser,
                pass: smtpPass
            });
        }

        res.json({ message: 'Settings updated successfully' });

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.emit('settings_update', {
                type: 'admin_notification_settings_updated',
                config
            });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const sendReportEmail = async (req, res) => {
    const { email, reportText, date } = req.body;

    if (!email || !reportText) {
        return res.status(400).json({ error: 'Email and report text are required' });
    }

    try {
        const { runInBackground } = require('../utils/background');
        const timeService = require('../utils/timeService');
        const todayStr = timeService.getDateStr(timeService.getNow());
        
        // Fetch full user details to get SMTP settings before backgrounding (safety)
        const userRes = await db.query('SELECT id, full_name, username, email FROM users WHERE deleted_at IS NULL AND id = $1', [req.user.id]);
        const currentUser = userRes.rows[0];

        runInBackground(async () => {
            try {
                const { summarizeToBangla } = require('../utils/aiService');
                const { sendDailyReportEmail } = require('../utils/emailService');
                
                // Ensure manual emails are also summarized to Bangla with correct date
                const finalReportText = await summarizeToBangla(reportText, date || todayStr);
                await sendDailyReportEmail(email, finalReportText, date || todayStr, currentUser);
            } catch (bgErr) {
                console.error('[AdminController] sendReportEmail background error:', bgErr);
            }
        });

        res.json({ message: 'Report is being summarized and sent in Bangla' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to initiate email report' });
    }
};

const sendReportWhatsApp = async (req, res) => {
    const { phoneNumber, reportText, date } = req.body;

    if (!phoneNumber || !reportText) {
        return res.status(400).json({ error: 'Phone number and report text are required' });
    }

    try {
        const { runInBackground } = require('../utils/background');
        const timeService = require('../utils/timeService');
        const todayStr = timeService.getDateStr(timeService.getNow());

        runInBackground(async () => {
            try {
                const { summarizeToBangla } = require('../utils/aiService');
                const whatsappService = require('../utils/whatsappService');
                
                const finalReportText = await summarizeToBangla(reportText, date || todayStr);
                await whatsappService.sendText(phoneNumber, finalReportText);
            } catch (bgErr) {
                console.error('[AdminController] sendReportWhatsApp background error:', bgErr);
            }
        });

        res.json({ message: 'Report is being summarized and sent via WhatsApp in Bangla' });
    } catch (err) {
        console.error('Send WhatsApp Error:', err);
        res.status(500).json({ error: 'Failed to initiate WhatsApp report' });
    }
};

const sendReportTelegram = async (req, res) => {
    const { telegramId, reportText, date } = req.body;

    if (!telegramId || !reportText) {
        return res.status(400).json({ error: 'Telegram ID/Number and report text are required' });
    }

    try {
        const { runInBackground } = require('../utils/background');
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        
        runInBackground(async () => {
            try {
                const { sendManualTelegramReport } = require('../utils/notificationService');
                await sendManualTelegramReport(telegramId, reportText, date, requesterCompanyId);
            } catch (bgErr) {
                console.error('[AdminController] sendReportTelegram background error:', bgErr);
            }
        });

        res.json({ message: 'Report is being summarized and sent via Telegram in Bangla' });
    } catch (err) {
        console.error('Send Telegram Error:', err);
        res.status(500).json({ error: 'Failed to initiate Telegram report' });
    }
};

const summarizeReport = async (req, res) => {
    const { text, date } = req.body;
    if (!text || !date) {
        return res.status(400).json({ error: 'Text and date are required' });
    }

    res.json({ message: 'Report summarization started in the background. It will update automatically when ready.' });

    const { runInBackground } = require('../utils/background');
    runInBackground(async () => {
        try {
            const { summarizeToBangla } = require('../utils/aiService');
            const summarized = await summarizeToBangla(text, date);

            // Auto-save the summarized version
            await db.query(`
                INSERT INTO daily_summaries (date, content, updated_at)
                VALUES ($1, $2, CURRENT_TIMESTAMP)
                ON CONFLICT (date) DO UPDATE SET content = $2, updated_at = CURRENT_TIMESTAMP
            `, [date, summarized]);

            // Emit socket event for real-time updates
            const io = req.app.get('io');
            if (io) {
                io.emit('report_summary_update', {
                    date,
                    content: summarized,
                    updated_at: new Date().toISOString()
                });
            }
        } catch (err) {
            console.error('[Background] Failed to summarize:', err);
        }
    });
};

const getReportSummary = async (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'Date is required' });

    try {
        const result = await db.query(
            'SELECT content, date, updated_at FROM daily_summaries WHERE date = $1 LIMIT 1',
            [date]
        );
        res.json(result.rows[0] || null);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const saveReportSummary = async (req, res) => {
    const { date, content } = req.body;
    if (!date || content === undefined) {
        return res.status(400).json({ error: 'Date and content are required' });
    }

    try {
        await db.query(`
            INSERT INTO daily_summaries (date, content, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (date) DO UPDATE SET content = $2, updated_at = CURRENT_TIMESTAMP
        `, [date, content]);
        res.json({ message: 'Report saved successfully' });

        // Emit socket event for real-time updates
        const io = req.app.get('io');
        if (io) {
            io.emit('report_summary_update', {
                date,
                content,
                updated_at: new Date().toISOString()
            });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save report' });
    }
};

const getOvertimeSettings = async (req, res) => {
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const configRaw = await getScopedSettingValue(db, 'overtime_settings', requesterCompanyId);
        const config = configRaw
            ? JSON.parse(configRaw)
            : { enabled: false, threshold: 6 };
        res.json(config);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const saveOvertimeSettings = async (req, res) => {
    const { enabled, threshold } = req.body;

    if (threshold === undefined) {
        return res.status(400).json({ error: 'Threshold is required' });
    }

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const config = { enabled: !!enabled, threshold: parseFloat(threshold) };
        await upsertScopedSettingValue(db, 'overtime_settings', JSON.stringify(config), requesterCompanyId);
        res.json({ message: 'Overtime settings updated successfully' });

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.emit('settings_update', {
                type: 'overtime_settings_updated',
                config
            });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getDevToolsSettings = async (req, res) => {
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const configRaw = await getScopedSettingValue(db, 'dev_tools_settings', requesterCompanyId);
        const config = configRaw
            ? JSON.parse(configRaw)
            : { enabled: true };
        res.json(config);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const saveDevToolsSettings = async (req, res) => {
    const { enabled } = req.body;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const config = { enabled: !!enabled };
        await upsertScopedSettingValue(db, 'dev_tools_settings', JSON.stringify(config), requesterCompanyId);
        res.json({ message: 'Developer tools settings updated successfully' });

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.emit('settings_update', {
                type: 'dev_tools_settings_updated',
                config
            });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getPaidLeaveSettings = async (req, res) => {
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const daysRaw = await getScopedSettingValue(db, 'paid_leave_days', requesterCompanyId);
        const days = daysRaw !== null ? parseInt(daysRaw, 10) : 10;
        res.json({ days });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const savePaidLeaveSettings = async (req, res) => {
    try {
        const { days, syncAll } = req.body;
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        if (days === undefined) {
            return res.status(400).json({ error: 'Days is required' });
        }

        await upsertScopedSettingValue(db, 'paid_leave_days', days.toString(), requesterCompanyId);

        // If syncAll is true, update all users with the new balance
        if (syncAll) {
            await db.query(
                `UPDATE users
                 SET paid_leave_balance = $1
                 WHERE (
                        ($2::uuid IS NULL AND company_id IS NULL)
                        OR company_id = $2::uuid
                 )`,
                [days, requesterCompanyId]
            );
            
            // Notify all clients via socket
            const io = req.app.get('io');
            if (io) {
                io.emit('settings_update', { 
                    type: 'paid_leave_sync',
                    days: parseInt(days)
                });
                // Also trigger individual balance updates for all active clients
                io.emit('balance_update', {
                    type: 'global_sync',
                    paid_leave_balance: parseInt(days)
                });
            }
        } else {
            const io = req.app.get('io');
            if (io) {
                io.emit('settings_update', { 
                    type: 'paid_leave_updated', 
                    days: parseInt(days) 
                });
            }
        }

        res.json({ message: 'Paid leave settings saved successfully', days, synced: !!syncAll });
    } catch (err) {
        console.error('Error saving paid leave settings:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getUserDetails = async (req, res) => {
    const { id } = req.params;
    try {
        const viewerRole = req.user?.role;
        const viewerIsSuperAdmin = isSuperAdminRole(viewerRole);
        const requesterCompanyId = viewerIsSuperAdmin
            ? null
            : await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const result = await db.query(
            `SELECT id, full_name, username, email, contact_number, bank_details, role, status, department, minutes_balance, paid_leave_balance, profile_picture, created_at
             FROM users
             WHERE id = $1
               AND (
                    $3::boolean = true
                    OR (
                        ($2::uuid IS NULL AND company_id IS NULL)
                        OR company_id = $2::uuid
                    )
               )`,
            [id, requesterCompanyId, viewerIsSuperAdmin]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const user = result.rows[0];
        const normalizedViewerRole = normalizeRoleKey(viewerRole);
        const normalizedTargetRole = normalizeRoleKey(user.role);
        const moderatorCanViewAdminContactOnly = normalizedViewerRole === 'moderator' && normalizedTargetRole === 'admin';
        if (!canViewUserRole(viewerRole, user.role) && !moderatorCanViewAdminContactOnly) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (normalizedViewerRole === 'moderator') {
            return res.json({
                name: user.full_name || user.username,
                email: user.email,
                contact_number: user.contact_number,
                status: user.status,
                role: user.role,
                department: user.department
            });
        }

        if (user.created_at) {
            // Force ISO string with 'Z' suffix to ensure browser interprets as UTC
            user.created_at = new Date(user.created_at).toISOString();
        }
        
        res.json(user);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getProfileRequests = async (req, res) => {
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const result = await db.query(`
            SELECT 
                pr.id,
                pr.user_id,
                pr.requested_changes,
                pr.status,
                pr.created_at,
                u.full_name as current_full_name,
                u.username as current_username,
                u.email as current_email,
                u.contact_number as current_contact,
                u.bank_details as current_bank
            FROM profile_update_requests pr
            JOIN users u ON pr.user_id = u.id
            WHERE pr.status = 'pending'
              AND (
                    ($1::uuid IS NULL AND u.company_id IS NULL)
                    OR u.company_id = $1::uuid
              )
            ORDER BY pr.created_at DESC
        `, [requesterCompanyId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const handleProfileRequest = async (req, res) => {
    const { requestId } = req.params;
    const { status } = req.body; // 'approved' or 'rejected'
    const adminId = req.user?.id || null;
    let actingAdminName = String(req.user?.acting_admin_name || req.user?.username || 'An Admin').trim() || 'An Admin';
    let actingAdminEmail = String(req.user?.email || '').trim().toLowerCase();
    let actingAdminWhatsApp = whatsappService.cleanPhoneNumber(req.user?.contact_number || '');
    let actingAdminTelegram = String(req.user?.telegram_chat_id || '').trim();

    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const emailDomainPolicy = await loadEmailDomainPolicy(db, requesterCompanyId);

        if (adminId) {
            const actorRes = await db.query(
                'SELECT username, email, contact_number, telegram_chat_id FROM users WHERE deleted_at IS NULL AND id = $1',
                [adminId]
            );
            const actor = actorRes.rows[0];
            if (actor?.username && !req.user?.acting_admin_name) {
                actingAdminName = actor.username;
            }
            if (actor?.email && !actingAdminEmail) {
                actingAdminEmail = String(actor.email).trim().toLowerCase();
            }
            if (actor?.contact_number && !actingAdminWhatsApp) {
                actingAdminWhatsApp = whatsappService.cleanPhoneNumber(actor.contact_number);
            }
            if (actor?.telegram_chat_id && !actingAdminTelegram) {
                actingAdminTelegram = String(actor.telegram_chat_id).trim();
            }
        }

        const requestRes = await db.query(
            `SELECT
                p.*,
                u.username as employee_name,
                u.company_id as employee_company_id,
                handler.username as handled_by_username
             FROM profile_update_requests p
             JOIN users u ON p.user_id = u.id
             LEFT JOIN users handler ON handler.id = p.admin_id
             WHERE p.id = $1
               AND (
                    ($2::uuid IS NULL AND u.company_id IS NULL)
                    OR u.company_id = $2::uuid
               )`,
            [requestId, requesterCompanyId]
        );
        if (requestRes.rows.length === 0) {
            return res.status(404).json({ error: 'Request not found' });
        }

        const request = requestRes.rows[0];
        if (request.status !== 'pending') {
            const handledBy = request.handled_by_username || 'another admin';
            return res.status(409).json({ error: `Request has already been ${request.status} by ${handledBy}` });
        }

        if (status === 'approved') {
            const changes = request.requested_changes;
            const userId = request.user_id;

            const fullName = String(changes.full_name || request.employee_name || '').trim();
            const username = String(changes.username || '').trim();
            const email = String(changes.email || '').trim().toLowerCase();
            const contactNumber = String(changes.contact_number || '').trim();
            const bankDetails = typeof changes.bank_details === 'string'
                ? changes.bank_details.trim()
                : JSON.stringify(changes.bank_details || {});
            const timezone = String(changes.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone).trim();

            if (!fullName || !username || !email || !contactNumber || !bankDetails) {
                return res.status(400).json({ error: 'Requested profile data is incomplete' });
            }

            if (!isStrictUsername(username)) {
                return res.status(400).json({ error: 'Username must contain only lowercase letters (a-z)' });
            }

            assertEmailAllowedByPolicy(email, emailDomainPolicy, 'Requested email');

            // Check if username is already taken by another user
            const existingUser = await db.query(
                `SELECT id
                 FROM users
                 WHERE LOWER(username) = LOWER($1)
                   AND id != $2
                   AND (
                        ($3::uuid IS NULL AND company_id IS NULL)
                        OR company_id = $3::uuid
                   )`,
                [username, userId, requesterCompanyId]
            );
            if (existingUser.rows.length > 0) {
                return res.status(400).json({ error: 'Username is already taken by another user' });
            }

            // Check if email is already taken by another user
            const existingEmail = await db.query(
                `SELECT id
                 FROM users
                 WHERE LOWER(email) = LOWER($1)
                   AND id != $2
                   AND (
                        ($3::uuid IS NULL AND company_id IS NULL)
                        OR company_id = $3::uuid
                   )`,
                [email, userId, requesterCompanyId]
            );
            if (existingEmail.rows.length > 0) {
                return res.status(400).json({ error: 'Email address is already associated with another account' });
            }

            // Check if contact number is already taken by another user
            const existingContact = await db.query(
                `SELECT id
                 FROM users
                 WHERE contact_number = $1
                   AND id != $2
                   AND (
                        ($3::uuid IS NULL AND company_id IS NULL)
                        OR company_id = $3::uuid
                   )`,
                [contactNumber, userId, requesterCompanyId]
            );
            if (existingContact.rows.length > 0) {
                return res.status(400).json({ error: 'Contact number is already associated with another account' });
            }

            // Apply changes to users table
            let query = 'UPDATE users SET full_name = $1, username = $2, email = $3, contact_number = $4, bank_details = $5, timezone = $6';
            const params = [fullName, username, email, contactNumber, bankDetails, timezone, userId];

            if (changes.profile_picture || changes.remove_profile_picture) {
                const userRes = await db.query('SELECT profile_picture FROM users WHERE deleted_at IS NULL AND id = $1', [userId]);
                const oldPic = userRes.rows[0]?.profile_picture;
                const { deleteFile } = require('../utils/fileUtils');

                if (changes.profile_picture) {
                    if (oldPic && oldPic !== changes.profile_picture) {
                        deleteFile(oldPic);
                    }
                    query += ', profile_picture = $8';
                    params.push(changes.profile_picture);
                } else if (changes.remove_profile_picture) {
                    if (oldPic) {
                        deleteFile(oldPic);
                    }
                    query += ', profile_picture = NULL';
                }
            }

            query += ' WHERE id = $7';
            await db.query(query, params);
        }

        // Update request status
        await db.query(
            'UPDATE profile_update_requests SET status = $1, handled_at = NOW(), admin_id = $2 WHERE id = $3',
            [status, adminId, requestId]
        );

        // Notify clients
        const io = req.app.get('io');
        if (io) {
            // Include userId so the specific user knows it's their request
            io.emit('profile_request_update', { type: 'handled', requestId, status, userId: request.user_id });
            // Also emit status_update to refresh user list if approved
            if (status === 'approved') {
                io.emit('status_update', { type: 'profile_updated', userId: request.user_id });
            }
        }

        // Notify admins about the resolution (Telegram, WhatsApp, Email) - Moved to background
        const { runInBackground } = require('../utils/background');
        runInBackground(async () => {
            try {
                const targets = await getAdminMessagingTargets({ forceEmailRecipients: true, companyId: requesterCompanyId });
                const excludedTelegram = new Set();
                const excludedWhatsApp = new Set();
                if (actingAdminTelegram) excludedTelegram.add(actingAdminTelegram);
                if (actingAdminWhatsApp) excludedWhatsApp.add(actingAdminWhatsApp);

                const statusLabel = status === 'approved' ? 'Approved' : 'Rejected';
                const notifyTextMarkdown =
                    `*Profile Request Resolved*\n` +
                    `*Employee:* ${request.employee_name}\n` +
                    `*Status:* ${statusLabel}\n` +
                    `*Action by:* ${actingAdminName}`;
                const notifyTextPlain =
                    `Profile Request Resolved\n` +
                    `Employee: ${request.employee_name}\n` +
                    `Status: ${statusLabel}\n` +
                    `Action by: ${actingAdminName}`;

                const promises = [];

                if (targets.telegramChatIds && targets.telegramChatIds.length > 0) {
                    const telegramService = require('../utils/telegramService');
                    for (const chatId of targets.telegramChatIds) {
                        if (excludedTelegram.has(String(chatId))) continue;
                        promises.push(telegramService.sendText(chatId, notifyTextMarkdown).catch(e => console.error('TG notify fail:', e.message)));
                    }
                }

                if (targets.whatsappNumbers && targets.whatsappNumbers.length > 0) {
                    const whatsappService = require('../utils/whatsappService');
                    for (const number of targets.whatsappNumbers) {
                        if (excludedWhatsApp.has(number)) continue;
                        promises.push(whatsappService.sendText(number, notifyTextPlain).catch(e => console.error('WA notify fail:', e.message)));
                    }
                }

                if (targets.emailRecipients && targets.emailRecipients.length > 0) {
                    const emailService = require('../utils/emailService');
                    const filteredEmails = targets.emailRecipients.filter((email) => {
                        const normalized = String(email || '').trim().toLowerCase();
                        if (!normalized) return false;
                        if (!actingAdminEmail) return true;
                        return normalized !== actingAdminEmail;
                    });

                    for (const recipientEmail of filteredEmails) {
                        promises.push(emailService.sendProfileResolutionNotificationEmail(recipientEmail, {
                            requestId,
                            employeeName: request.employee_name,
                            status: statusLabel,
                            actorName: actingAdminName
                        }).catch(e => console.error('Email notify fail:', e.message)));
                    }
                }

                // Notify employee via Telegram - Also in background
                const empRes = await db.query('SELECT telegram_chat_id FROM users WHERE deleted_at IS NULL AND id = $1', [request.user_id]);
                const tgId = empRes.rows[0]?.telegram_chat_id;
                if (tgId) {
                    const telegramService = require('../utils/telegramService');
                    if (status === 'approved') {
                        promises.push(telegramService.sendText(tgId, '✅ Your profile update request has been approved.').catch(e => console.error('Emp TG notify fail:', e.message)));
                    } else {
                        promises.push(telegramService.sendText(tgId, '❌ Your profile update request has been rejected.').catch(e => console.error('Emp TG notify fail:', e.message)));
                    }
                }
                
                await Promise.allSettled(promises);
            } catch (bgErr) {
                console.error('[AdminController] Background notification error:', bgErr);
            }
        });

        res.json({ message: `Profile request ${status}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getAttachmentSettings = async (req, res) => {
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const configRaw = await getScopedSettingValue(db, 'attachment_config', requesterCompanyId);
        const config = configRaw
            ? JSON.parse(configRaw)
            : { retention_days: 30, cleanup_time: '04:00' };
        res.json(config);
    } catch (err) {
        console.error(err);
        if (err.statusCode) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        res.status(500).json({ error: 'Server error' });
    }
};

const saveAttachmentSettings = async (req, res) => {
    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const { retention_days, cleanup_time } = req.body;

        if (retention_days === undefined || retention_days === null) {
            return res.status(400).json({ error: 'Retention days is required' });
        }

        const config = {
            retention_days: parseInt(retention_days),
            cleanup_time: cleanup_time || '04:00'
        };

        if (isNaN(config.retention_days) || config.retention_days < 0) {
            return res.status(400).json({ error: 'Invalid retention days' });
        }

        await upsertScopedSettingValue(db, 'attachment_config', JSON.stringify(config), requesterCompanyId);

        // Reload scheduler
        const scheduler = require('../scheduler');
        scheduler.reload();

        // Notify
        const io = req.app.get('io');
        if (io) {
            io.emit('settings_update', { type: 'attachment_settings_updated', settings: config });
        }

        res.json({ success: true, ...config });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const clearManagedUserSubmissions = async (req, res) => {
    const { id } = req.params;
    const userId = Number.parseInt(String(id), 10);

    if (Number.isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID' });
    }

    try {
        const userRes = await db.query('SELECT id, username FROM users WHERE deleted_at IS NULL AND id = $1 LIMIT 1', [userId]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const result = await clearUserSubmissions(userId);

        const io = req.app.get('io');
        if (io) {
            io.emit('task_update', {
                type: 'cleared_user_submissions',
                userId,
                affectedDates: result.affectedDates,
                deletedCount: result.deletedTasks
            });
        }

        res.json({
            message: `Cleared ${result.deletedTasks} submission${result.deletedTasks === 1 ? '' : 's'} for ${userRes.rows[0].username} across all dates`,
            deletedTasks: result.deletedTasks,
            affectedDates: result.affectedDates
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getNotificationSettings = getEmailSettings;

const saveNotificationSettings = saveEmailSettings;

const resetLeaves = async (req, res) => {
    try {
        await db.query('TRUNCATE TABLE leaves RESTART IDENTITY CASCADE');
        
        // Notify clients
        const io = req.app.get('io');
        if (io) {
            io.emit('status_update', { type: 'leaves_reset' });
        }
        
        res.json({ message: 'All leaves cleared successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const requestEmployeeLocationByAdmin = async (userId, adminUser = {}) => {
    const userRes = await db.query(
        'SELECT id, full_name, username, status, last_latitude, last_longitude, last_location_update, telegram_chat_id FROM users WHERE deleted_at IS NULL AND id = $1',
        [userId]
    );

    if (userRes.rows.length === 0) {
        const error = new Error('User not found');
        error.statusCode = 404;
        throw error;
    }

    const user = userRes.rows[0];
    const { last_latitude, last_longitude, last_location_update, telegram_chat_id } = user;

    const { runInBackground } = require('../utils/background');

    if (telegram_chat_id) {
        const adminName = adminUser?.username || 'Admin';
        const requestText = `*Live Location Request*\n\nHello *${user.username}*,\nAdmin *${adminName}* has requested your live location for security/attendance verification.\n\nPlease tap the button below to share your current location.`;

        runInBackground(async () => {
            try {
                const telegramService = require('../utils/telegramService');
                await telegramService.sendLocationRequestKeyboard(telegram_chat_id, requestText);
            } catch (e) {
                console.error('Failed to send location request:', e.message);
            }
        });

        return {
            message: 'Live location request initiated via employee\'s Telegram.',
            requested_via: 'telegram',
            user: {
                id: user.id,
                username: user.username,
                status: user.status
            }
        };
    }

    if (!last_latitude || !last_longitude) {
        const error = new Error('No location data available and user is not linked to Telegram');
        error.statusCode = 400;
        throw error;
    }

    const location = { latitude: last_latitude, longitude: last_longitude };

    // Notify admins via Telegram with last known location in background
    runInBackground(async () => {
        try {
            const { sendEmployeeLocationNotification } = require('../utils/notificationService');
            await sendEmployeeLocationNotification(user, location);
        } catch (e) {
            console.error('Failed to send location notification:', e.message);
        }
    });

    return {
        message: 'Last known location notification initiated.',
        requested_via: 'last_known',
        user: {
            id: user.id,
            username: user.username,
            status: user.status
        },
        last_location: {
            latitude: last_latitude,
            longitude: last_longitude,
            updated_at: last_location_update
        }
    };
};

const requestEmployeeLocation = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await requestEmployeeLocationByAdmin(id, req.user || {});
        res.json(result);
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('Error requesting employee location:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {
    getDailyReports,
    getMonthlyReports,
    getWeeklyReports,
    getYearlyReports,
    deleteTask,
    createUser,
    getUsers,
    deleteUser,
    updateUserRole,
    updateUserDepartment,
    getDepartments,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    getCategories,
    createCategory,
    deleteCategory,
    updateUserCategories,
    getHolidays,
    updateHolidays,
    getWorkHours,
    updateWorkHours,
    updateWeekendDays,
    getEarlyLeaves,
    getEmailSettings,
    saveEmailSettings,
    getOvertimeSettings,
    saveOvertimeSettings,
    getAttachmentSettings,
    saveAttachmentSettings,
    getNotificationSettings,
    saveNotificationSettings,
    sendReportEmail,
    sendReportWhatsApp,
    sendReportTelegram,
    summarizeReport,
    getReportSummary,
    saveReportSummary,
    getUserDetails,
    getProfileRequests,
    handleProfileRequest,
    getDevToolsSettings,
    saveDevToolsSettings,
    getPaidLeaveSettings,
    savePaidLeaveSettings,
    updateUserPaidLeaveBalance,
    resetUserPaidLeaveBalance,
    resetAllPaidLeaveBalances,
    resetUserMinutesBalance,
    resetAllMinutesBalances,
    clearUserLeaveHistory,
    clearUserSkippedDays,
    clearAllSkippedDays,
    clearManagedUserSubmissions,
    resetLeaves,
    requestEmployeeLocationByAdmin,
    requestEmployeeLocation
};
