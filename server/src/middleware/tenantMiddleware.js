const jwt = require('jsonwebtoken');
const db = require('../db');

const SAAS_ROLES = {
    SUPERADMIN: 'SUPERADMIN',
    COMPANY_ADMIN: 'COMPANY_ADMIN',
    PROJECT_MANAGER: 'PROJECT_MANAGER',
    EMPLOYEE: 'EMPLOYEE'
};

const getBearerToken = (req) => {
    const authHeader = String(req.headers?.authorization || '').trim();
    if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
    const token = authHeader.slice(7).trim();
    return token || null;
};

const attachCompanyContext = (req, res, next) => {
    try {
        if (req.user?.company_id) {
            req.companyId = req.user.company_id;
            return next();
        }

        const token = getBearerToken(req) || req.cookies?.token || null;
        if (!token) {
            return res.status(401).json({ error: 'Missing authentication token' });
        }

        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = payload;
        req.companyId = payload.company_id || null;

        if (!req.companyId && payload.role !== SAAS_ROLES.SUPERADMIN) {
            return res.status(403).json({ error: 'Missing company context in token' });
        }

        return next();
    } catch (_error) {
        return res.status(401).json({ error: 'Invalid authentication token' });
    }
};

const getRoleLimitField = (role) => {
    switch (role) {
        case SAAS_ROLES.COMPANY_ADMIN:
            return 'max_company_admins';
        case SAAS_ROLES.PROJECT_MANAGER:
            return 'max_project_managers';
        case SAAS_ROLES.EMPLOYEE:
            return 'max_employees';
        default:
            return null;
    }
};

const enforceLimits = (resolveRole) => {
    return async (req, res, next) => {
        try {
            const role = typeof resolveRole === 'function' ? resolveRole(req) : resolveRole;
            const limitField = getRoleLimitField(role);

            if (!limitField) {
                return res.status(400).json({ error: 'Unsupported role for plan limit enforcement' });
            }

            if (!req.companyId) {
                return res.status(400).json({ error: 'Company context is required' });
            }

            const planResult = await db.query(
                `SELECT t.unlimited_access, p.${limitField} AS role_limit
                 FROM tenants t
                 JOIN plans p ON p.id = t.plan_id
                 WHERE t.id = $1
                 LIMIT 1`,
                [req.companyId]
            );

            if (planResult.rows.length === 0) {
                return res.status(404).json({ error: 'Tenant or plan not found' });
            }

            const hasUnlimitedAccess = Boolean(planResult.rows[0].unlimited_access);
            if (hasUnlimitedAccess) {
                return next();
            }

            const roleLimit = Number(planResult.rows[0].role_limit || 0);

            const countResult = await db.query(
                `SELECT COUNT(*)::int AS total
                 FROM users
                 WHERE company_id = $1
                   AND role = $2
                   AND is_active = TRUE`,
                [req.companyId, role]
            );

            const currentCount = Number(countResult.rows[0]?.total || 0);

            if (currentCount >= roleLimit) {
                return res.status(409).json({
                    error: `Plan limit reached for ${role}`,
                    role,
                    limit: roleLimit,
                    current: currentCount
                });
            }

            return next();
        } catch (error) {
            console.error('enforceLimits error:', error);
            return res.status(500).json({ error: 'Failed to enforce plan limits' });
        }
    };
};

const requireSuperadmin = (req, res, next) => {
    if (req.user?.role !== SAAS_ROLES.SUPERADMIN) {
        return res.status(403).json({ error: 'SUPERADMIN access required' });
    }
    return next();
};

const requireCompanyAdminOrSuperadmin = (req, res, next) => {
    const role = req.user?.role;
    if (role !== SAAS_ROLES.COMPANY_ADMIN && role !== SAAS_ROLES.SUPERADMIN) {
        return res.status(403).json({ error: 'COMPANY_ADMIN access required' });
    }
    return next();
};

module.exports = {
    SAAS_ROLES,
    attachCompanyContext,
    enforceLimits,
    requireSuperadmin,
    requireCompanyAdminOrSuperadmin
};
