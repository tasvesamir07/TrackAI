const db = require('../db');

let cachedPlansHasIsPopularColumn = null;

const plansHasIsPopularColumn = async () => {
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

    return cachedPlansHasIsPopularColumn;
};

const pickUpdatableFields = (body = {}, options = {}) => {
    const { allowIsPopular = true } = options;
    const fields = [];
    const values = [];

    const addField = (column, value) => {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
    };

    if (body.monthly_price !== undefined) {
        const price = Number(body.monthly_price);
        if (!Number.isFinite(price) || price < 0) {
            throw new Error('monthly_price must be a non-negative number');
        }
        addField('monthly_price', price);
    }

    if (body.max_company_admins !== undefined) {
        const limit = Number(body.max_company_admins);
        if (!Number.isInteger(limit) || limit < 0) {
            throw new Error('max_company_admins must be a non-negative integer');
        }
        addField('max_company_admins', limit);
    }

    if (body.max_project_managers !== undefined) {
        const limit = Number(body.max_project_managers);
        if (!Number.isInteger(limit) || limit < 0) {
            throw new Error('max_project_managers must be a non-negative integer');
        }
        addField('max_project_managers', limit);
    }

    if (body.max_employees !== undefined) {
        const limit = Number(body.max_employees);
        if (!Number.isInteger(limit) || limit < 0) {
            throw new Error('max_employees must be a non-negative integer');
        }
        addField('max_employees', limit);
    }

    if (body.trial_days !== undefined) {
        const trialDays = Number(body.trial_days);
        if (!Number.isInteger(trialDays) || trialDays < 0) {
            throw new Error('trial_days must be a non-negative integer');
        }
        addField('trial_days', trialDays);
    }

    if (body.stripe_price_id !== undefined) {
        const priceId = body.stripe_price_id === null ? null : String(body.stripe_price_id).trim();
        addField('stripe_price_id', priceId || null);
    }

    if (body.is_active !== undefined) {
        addField('is_active', Boolean(body.is_active));
    }

    if (allowIsPopular && body.is_popular !== undefined) {
        addField('is_popular', Boolean(body.is_popular));
    }

    return { fields, values };
};

const updatePlanBySuperadmin = async (req, res) => {
    const rawPlanId = req.params.planId;
    const planIdentifier = String(rawPlanId || '').trim();

    if (!planIdentifier) {
        return res.status(400).json({ error: 'planId is required' });
    }

    let updateParts;
    try {
        const allowIsPopular = await plansHasIsPopularColumn();
        updateParts = pickUpdatableFields(req.body || {}, { allowIsPopular });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    if (updateParts.fields.length === 0) {
        return res.status(400).json({ error: 'No updatable fields provided' });
    }

    // Keep id and code comparisons as text-compatible expressions to avoid
    // uuid typing conflicts when the identifier is a UUID.
    updateParts.values.push(planIdentifier);
    updateParts.values.push(planIdentifier);
    const idMatcherIndex = updateParts.values.length - 1;
    const codeMatcherIndex = updateParts.values.length;

    const hasIsPopular = await plansHasIsPopularColumn();
    const returningIsPopular = hasIsPopular ? 'is_popular' : 'FALSE::boolean AS is_popular';
    const query = `
        UPDATE plans
        SET ${updateParts.fields.join(', ')}, updated_at = NOW()
        WHERE id::text = $${idMatcherIndex} OR code = UPPER($${codeMatcherIndex})
        RETURNING id, code, name, monthly_price, trial_days, max_company_admins, max_project_managers, max_employees, stripe_price_id, is_active, ${returningIsPopular}, updated_at
    `;

    try {
        const result = await db.query(query, updateParts.values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Plan not found' });
        }

        return res.json({
            message: 'Plan updated successfully',
            plan: result.rows[0]
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'stripe_price_id must be unique' });
        }

        console.error('updatePlanBySuperadmin error:', error);
        return res.status(500).json({ error: 'Failed to update plan' });
    }
};

const createPlanBySuperadmin = async (req, res) => {
    const {
        code,
        name,
        monthly_price,
        max_company_admins,
        max_project_managers,
        max_employees,
        trial_days = 0,
        stripe_price_id = null,
        is_active = true,
        is_popular = false
    } = req.body;

    if (!code || !name || monthly_price === undefined) {
        return res.status(400).json({ error: 'code, name, and monthly_price are required' });
    }

    try {
        const hasIsPopular = await plansHasIsPopularColumn();
        const returningIsPopular = hasIsPopular ? 'is_popular' : 'FALSE::boolean AS is_popular';
        const query = hasIsPopular
            ? `
                INSERT INTO plans (
                    code, name, monthly_price, max_company_admins, max_project_managers, max_employees,
                    trial_days, stripe_price_id, is_active, is_popular
                )
                VALUES (UPPER($1), $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING id, code, name, monthly_price, trial_days, max_company_admins, max_project_managers, max_employees, stripe_price_id, is_active, ${returningIsPopular}, created_at
            `
            : `
                INSERT INTO plans (
                    code, name, monthly_price, max_company_admins, max_project_managers, max_employees,
                    trial_days, stripe_price_id, is_active
                )
                VALUES (UPPER($1), $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id, code, name, monthly_price, trial_days, max_company_admins, max_project_managers, max_employees, stripe_price_id, is_active, ${returningIsPopular}, created_at
            `;

        const values = hasIsPopular
            ? [
                code,
                name,
                monthly_price,
                max_company_admins || 0,
                max_project_managers || 0,
                max_employees || 0,
                trial_days,
                stripe_price_id,
                is_active,
                is_popular
            ]
            : [
                code,
                name,
                monthly_price,
                max_company_admins || 0,
                max_project_managers || 0,
                max_employees || 0,
                trial_days,
                stripe_price_id,
                is_active
            ];

        const result = await db.query(query, values);
        return res.status(201).json({
            message: 'Plan created successfully',
            plan: result.rows[0]
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Plan code or stripe_price_id already exists' });
        }
        console.error('createPlanBySuperadmin error:', error);
        return res.status(500).json({ error: 'Failed to create plan' });
    }
};

module.exports = {
    updatePlanBySuperadmin,
    createPlanBySuperadmin
};
