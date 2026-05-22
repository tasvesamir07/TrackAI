const bcrypt = require('bcryptjs');
const db = require('../db');
const { SAAS_ROLES } = require('../middleware/tenantMiddleware');

const ALLOWED_COMPANY_ROLES = new Set([
    SAAS_ROLES.COMPANY_ADMIN,
    SAAS_ROLES.PROJECT_MANAGER,
    SAAS_ROLES.EMPLOYEE
]);

const createCompanyUser = async (req, res) => {
    const { fullName, email, password, role } = req.body || {};

    if (!req.companyId) {
        return res.status(400).json({ error: 'Missing company context' });
    }

    if (!fullName || !email || !password || !role) {
        return res.status(400).json({ error: 'fullName, email, password and role are required' });
    }

    if (!ALLOWED_COMPANY_ROLES.has(role)) {
        return res.status(400).json({ error: 'Invalid company role' });
    }

    try {
        const bcryptRounds = Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
        const hash = await bcrypt.hash(String(password), bcryptRounds);

        const result = await db.query(
            `INSERT INTO users (full_name, username, email, password_hash, role, company_id, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE)
             RETURNING id, full_name, email, role, company_id, created_at`,
            [
                fullName,
                String(email).toLowerCase(),
                String(email).toLowerCase(),
                hash,
                role,
                req.companyId
            ]
        );

        return res.status(201).json({ user: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'User email already exists in this company' });
        }

        console.error('createCompanyUser error:', error);
        return res.status(500).json({ error: 'Failed to create user' });
    }
};

module.exports = {
    createCompanyUser
};
