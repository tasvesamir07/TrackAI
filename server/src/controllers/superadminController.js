const db = require('../db');
const { uploadIncomingFile, deleteUploadedFile, getPublicUrlForRelativeUrl } = require('../utils/storageService');
const timeService = require('../utils/timeService');
const { evaluateTenantAccess } = require('../utils/subscriptionAccess');
const os = require('os');
const fs = require('fs');

const isSchemaAvailabilityError = (error) => {
    const code = String(error?.code || '');
    return code === '42P01' || code === '42703' || code === '3F000';
};

const getDiskUsage = () => {
    try {
        const rootPath = process.platform === 'win32' ? process.cwd().split(':')[0] + ':\\' : '/';
        const stats = fs.statfsSync(rootPath);
        const total = stats.blocks * stats.bsize;
        const free = stats.bfree * stats.bsize;
        const used = total - free;
        return {
            totalBytes: total,
            freeBytes: free,
            usedBytes: used,
            usagePercent: total > 0 ? Math.round((used / total) * 100) : 0
        };
    } catch {
        try {
            const projectStats = fs.statfsSync(process.cwd());
            const total = projectStats.blocks * projectStats.bsize;
            const free = projectStats.bfree * projectStats.bsize;
            const used = total - free;
            return {
                totalBytes: total,
                freeBytes: free,
                usedBytes: used,
                usagePercent: total > 0 ? Math.round((used / total) * 100) : 0
            };
        } catch {
            return { totalBytes: 0, freeBytes: 0, usedBytes: 0, usagePercent: 0 };
        }
    }
};

const getServerMetrics = async (req, res) => {
    try {
        const cpus = os.cpus();
        let idle = 0;
        let total = 0;
        if (cpus && cpus.length > 0) {
            for (const cpu of cpus) {
                for (const type in cpu.times) {
                    total += cpu.times[type];
                }
                idle += cpu.times.idle;
            }
        }
        const cpuUsage = total > 0 ? Math.round(100 - (100 * idle / total)) : 10;
        const memoryUsage = Math.round(100 * (os.totalmem() - os.freemem()) / (os.totalmem() || 1));
        const disk = getDiskUsage();

        // Real metrics from request_logs
        const sixtySecondsAgo = new Date(Date.now() - 60000).toISOString();
        const fiveMinutesAgo = new Date(Date.now() - 300000).toISOString();

        const [reqStatsResult, activeConnsResult] = await Promise.all([
            db.query(
                `SELECT
                    COUNT(*)::int AS request_count,
                    COALESCE(ROUND(AVG(response_time_ms)), 0)::int AS avg_response_time
                 FROM request_logs
                 WHERE created_at >= $1`,
                [sixtySecondsAgo]
            ),
            db.query(
                `SELECT COUNT(*)::int AS active_connections
                 FROM (
                    SELECT DISTINCT user_id
                    FROM request_logs
                    WHERE created_at >= $1 AND user_id IS NOT NULL
                 ) sub`,
                [fiveMinutesAgo]
            )
        ]);

        const reqStats = reqStatsResult.rows[0] || { request_count: 0, avg_response_time: 0 };
        const activeConns = activeConnsResult.rows[0] || { active_connections: 0 };

        return res.json({
            cpu: cpuUsage,
            memory: memoryUsage,
            disk: disk.usagePercent,
            diskDetails: {
                totalBytes: disk.totalBytes,
                freeBytes: disk.freeBytes,
                usedBytes: disk.usedBytes
            },
            uptime: os.uptime(),
            requestsPerSecond: Math.round(reqStats.request_count / 60),
            avgResponseTime: reqStats.avg_response_time,
            activeConnections: activeConns.active_connections
        });
    } catch (error) {
        if (isSchemaAvailabilityError(error)) {
            const disk = getDiskUsage();
            return res.json({
                cpu: 0,
                memory: 0,
                disk: disk.usagePercent,
                diskDetails: {
                    totalBytes: disk.totalBytes,
                    freeBytes: disk.freeBytes,
                    usedBytes: disk.usedBytes
                },
                uptime: os.uptime(),
                requestsPerSecond: 0,
                avgResponseTime: 0,
                activeConnections: 0,
                warning: 'tracking_schema_unavailable'
            });
        }
        console.error('getServerMetrics error:', error);
        return res.status(500).json({ error: 'Failed to get server metrics' });
    }
};

const getLiveUsers = async (req, res) => {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 300000).toISOString();

        const result = await db.query(`
            SELECT
                t.id as "companyId",
                t.name as "companyName",
                COUNT(DISTINCT u.id) as count
            FROM tenants t
            JOIN users u ON u.company_id = t.id
            LEFT JOIN request_logs rl ON rl.user_id = u.id AND rl.created_at >= $1
            WHERE t.is_active = TRUE
            GROUP BY t.id, t.name
            ORDER BY count DESC
            LIMIT 5
        `, [fiveMinutesAgo]);

        const companies = [];
        for (const row of result.rows) {
            const pagesResult = await db.query(`
                SELECT DISTINCT path
                FROM request_logs
                WHERE user_id IN (
                    SELECT id FROM users WHERE company_id = $1
                )
                AND created_at >= $2
                ORDER BY path
                LIMIT 5
            `, [row.companyId, fiveMinutesAgo]);

            companies.push({
                companyId: row.companyId,
                companyName: row.companyName,
                count: Number(row.count),
                activePages: pagesResult.rows.map(p => p.path)
            });
        }

        return res.json({ companies });
    } catch (error) {
        if (isSchemaAvailabilityError(error)) {
            return res.json({ companies: [], warning: 'tracking_schema_unavailable' });
        }
        console.error('getLiveUsers error:', error);
        return res.status(500).json({ error: 'Failed to get live users' });
    }
};

const SUBSCRIPTION_ACTIVE_STATUSES = new Set(['trialing', 'active', 'past_due', 'incomplete', 'unpaid']);
let cachedPlansHasIsPopularColumn = null;

const parseBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return null;
};

const getPlanByIdentifier = async (identifier) => {
    const normalized = String(identifier || '').trim();
    if (!normalized) return null;

    const result = await db.query(
        `SELECT id, code, name, monthly_price, currency, trial_days, max_company_admins, max_project_managers, max_employees, is_active
         FROM plans
         WHERE id::text = $1 OR code = UPPER($1)
         LIMIT 1`,
        [normalized]
    );

    return result.rows[0] || null;
};

const getGlobalLandingVideoUrl = async () => {
    const result = await db.query(
        `SELECT value
         FROM settings
         WHERE key = 'landing_hero_video_url'
           AND company_id IS NULL
         LIMIT 1`
    );
    return String(result.rows[0]?.value || '').trim();
};

const getGlobalLandingVideoEnabled = async () => {
    const result = await db.query(
        `SELECT value
         FROM settings
         WHERE key = 'landing_hero_video_enabled'
           AND company_id IS NULL
         LIMIT 1`
    );
    const raw = String(result.rows[0]?.value || 'true').trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
};

const getCompanyById = async (companyId) => {
    const result = await db.query(
        `SELECT
            t.id,
            t.name,
            t.slug,
            t.is_active,
            t.unlimited_access,
            t.subscription_status,
            t.trial_ends_at,
            t.current_period_ends_at,
            t.last_payment_at,
            t.created_at,
            p.id AS plan_id,
            p.code AS plan_code,
            p.name AS plan_name,
            p.monthly_price,
            p.currency,
            p.max_company_admins,
            p.max_project_managers,
            p.max_employees,
            stats.total_users,
            stats.total_company_admins,
            stats.total_project_managers,
            stats.total_employees,
            admin_users.first_admin_name AS admin_name,
            admin_users.first_admin_email AS admin_email,
            admin_users.admins AS admin_users
         FROM tenants t
         JOIN plans p ON p.id = t.plan_id
         LEFT JOIN (
            SELECT
                company_id,
                COUNT(*) FILTER (WHERE role IN ('COMPANY_ADMIN', 'PROJECT_MANAGER', 'EMPLOYEE'))::int AS total_users,
                COUNT(*) FILTER (WHERE role = 'COMPANY_ADMIN')::int AS total_company_admins,
                COUNT(*) FILTER (WHERE role = 'PROJECT_MANAGER')::int AS total_project_managers,
                COUNT(*) FILTER (WHERE role = 'EMPLOYEE')::int AS total_employees
            FROM users
            WHERE company_id IS NOT NULL
            GROUP BY company_id
         ) stats ON stats.company_id = t.id
         LEFT JOIN (
            SELECT
                company_id,
                COALESCE(
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'id', id,
                            'full_name', COALESCE(NULLIF(TRIM(full_name), ''), username),
                            'email', email,
                            'role', role
                        )
                        ORDER BY created_at ASC NULLS LAST, id ASC
                    ),
                    '[]'::json
                ) AS admins,
                (ARRAY_AGG(full_name ORDER BY created_at ASC NULLS LAST, id ASC))[1] AS first_admin_name,
                (ARRAY_AGG(email ORDER BY created_at ASC NULLS LAST, id ASC))[1] AS first_admin_email
            FROM users
            WHERE role = 'COMPANY_ADMIN'
              AND company_id IS NOT NULL
            GROUP BY company_id
         ) admin_users ON admin_users.company_id = t.id
         WHERE t.id = $1
         LIMIT 1`,
        [companyId]
    );

    return result.rows[0] || null;
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

const getSuperadminDashboard = async (req, res) => {
    const view = String(req.query?.view || '').trim().toLowerCase();
    const isCompactView = view === 'compact';

    try {
        const plansIsPopularSelect = await getPlansIsPopularSelectExpression();
        const landingVideoUrlPromise = getGlobalLandingVideoUrl();
        const landingVideoEnabledPromise = getGlobalLandingVideoEnabled();
        const companiesQuery = `
            SELECT
                t.id, t.name, t.slug, t.is_active, t.unlimited_access, t.subscription_status, t.trial_ends_at, t.current_period_ends_at, t.last_payment_at, t.created_at,
                p.id AS plan_id, p.code AS plan_code, p.name AS plan_name, p.monthly_price, p.currency, p.max_company_admins, p.max_project_managers, p.max_employees,
                (SELECT COUNT(*)::int FROM users u WHERE u.deleted_at IS NULL AND u.company_id = t.id AND UPPER(COALESCE(u.role, '')) IN ('COMPANY_ADMIN', 'PROJECT_MANAGER', 'MODERATOR', 'EMPLOYEE')) AS total_users,
                (SELECT COUNT(*)::int FROM users u WHERE u.deleted_at IS NULL AND u.company_id = t.id AND UPPER(COALESCE(u.role, '')) = 'COMPANY_ADMIN') AS total_company_admins,
                (SELECT COUNT(*)::int FROM users u WHERE u.deleted_at IS NULL AND u.company_id = t.id AND UPPER(COALESCE(u.role, '')) IN ('PROJECT_MANAGER', 'MODERATOR')) AS total_project_managers,
                (SELECT COUNT(*)::int FROM users u WHERE u.deleted_at IS NULL AND u.company_id = t.id AND UPPER(COALESCE(u.role, '')) = 'EMPLOYEE') AS total_employees,
                (SELECT COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) FROM users u WHERE u.deleted_at IS NULL AND u.company_id = t.id AND u.role = 'COMPANY_ADMIN' ORDER BY u.created_at ASC LIMIT 1) AS admin_name,
                (SELECT u.email FROM users u WHERE u.deleted_at IS NULL AND u.company_id = t.id AND u.role = 'COMPANY_ADMIN' ORDER BY u.created_at ASC LIMIT 1) AS admin_email
            FROM tenants t
            JOIN plans p ON p.id = t.plan_id
            ORDER BY t.created_at DESC
        `;
        console.log('[Dashboard] Fetching data (Compact:', isCompactView, ')');
        const [summaryResult, plansResult, companiesResult, legacySummaryResult, legacyUsersResult, landingVideoUrl, landingVideoEnabled] = await Promise.all([
            db.query(
                `SELECT
                    COUNT(*)::int AS total_companies,
                    COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_companies,
                    COUNT(*) FILTER (WHERE is_active = FALSE)::int AS blocked_companies,
                    COUNT(*) FILTER (WHERE subscription_status <> 'canceled')::int AS subscribed_companies
                 FROM tenants`
            ),
            db.query(
                `SELECT id, code, name, monthly_price, currency, trial_days, max_company_admins, max_project_managers, max_employees, is_active, ${plansIsPopularSelect}
                 FROM plans
                 ORDER BY monthly_price ASC, name ASC`
            ),
            db.query(companiesQuery),
            isCompactView
                ? Promise.resolve({ rows: [] })
                : db.query(
                    `SELECT
                        COUNT(*) FILTER (WHERE role IN ('admin', 'moderator', 'employee'))::int AS total_legacy_users,
                        COUNT(*) FILTER (WHERE role = 'admin')::int AS total_legacy_admins,
                        COUNT(*) FILTER (WHERE role = 'moderator')::int AS total_legacy_project_managers,
                        COUNT(*) FILTER (WHERE role = 'employee')::int AS total_legacy_employees
                     FROM users
                     WHERE company_id IS NULL`
                ),
            isCompactView
                ? Promise.resolve({ rows: [] })
                : db.query(
                    `SELECT
                        id,
                        COALESCE(NULLIF(TRIM(full_name), ''), username) AS full_name,
                        username,
                        email,
                        role,
                        status,
                        created_at
                     FROM users
                     WHERE company_id IS NULL
                       AND role IN ('admin', 'moderator', 'employee')
                     ORDER BY
                        CASE
                            WHEN role = 'admin' THEN 0
                            WHEN role = 'moderator' THEN 1
                            ELSE 2
                        END,
                        created_at ASC NULLS LAST,
                        id ASC`
                ),
            landingVideoUrlPromise,
            landingVideoEnabledPromise
        ]);

        console.log('[Dashboard] Queries completed successfully');

        const summary = summaryResult.rows[0] || {
            total_companies: 0,
            active_companies: 0,
            blocked_companies: 0,
            subscribed_companies: 0
        };
        const legacySummary = legacySummaryResult.rows[0] || {
            total_legacy_users: 0,
            total_legacy_admins: 0,
            total_legacy_project_managers: 0,
            total_legacy_employees: 0
        };

        const companies = companiesResult.rows.map((company) => {
            const hasUnlimitedAccess = Boolean(company.unlimited_access);
            const expiresAt = hasUnlimitedAccess
                ? null
                : (company.current_period_ends_at || company.trial_ends_at || null);
            const access = evaluateTenantAccess({
                is_active: company.is_active,
                subscription_status: company.subscription_status,
                unlimited_access: company.unlimited_access,
                trial_ends_at: company.trial_ends_at,
                current_period_ends_at: company.current_period_ends_at
            }, timeService.getNow());

            return {
                ...company,
                subscription_active: access.allowed,
                subscription_block_reason: access.reason,
                expires_at: expiresAt,
                trial_ends_at_ms: access.trialEndsAtMs,
                current_period_ends_at_ms: access.currentPeriodEndsAtMs,
                expires_at_ms: hasUnlimitedAccess ? null : (access.currentPeriodEndsAtMs || access.trialEndsAtMs || null)
            };
        });

        console.log('[Dashboard] Data processing complete, returning results');
        return res.json({
            summary,
            plans: plansResult.rows,
            companies,
            landing_video_url: landingVideoUrl,
            landing_video_enabled: landingVideoEnabled,
            clock: {
                virtual_time: timeService.getNow(),
                virtual_time_ms: timeService.getNow().getTime(),
                offset_ms: timeService.getOffset()
            },
            legacy_summary: isCompactView ? null : legacySummary,
            legacy_users: legacyUsersResult.rows
        });
    } catch (error) {
        console.error('[Dashboard] Error detected:', error);
        return res.status(500).json({ 
            error: 'Failed to load superadmin dashboard', 
            details: error.message,
            query: error.query 
        });
    }
};

const updateTenantPlanBySuperadmin = async (req, res) => {
    const { companyId } = req.params;
    const { planId, planCode } = req.body || {};

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    const planIdentifier = planId || planCode;
    if (!planIdentifier) {
        return res.status(400).json({ error: 'planId or planCode is required' });
    }

    try {
        const plan = await getPlanByIdentifier(planIdentifier);
        if (!plan) {
            return res.status(404).json({ error: 'Plan not found' });
        }

        if (!plan.is_active) {
            return res.status(400).json({ error: 'Selected plan is inactive' });
        }

        const trialDays = Number(plan.trial_days || 0);
        const now = timeService.getNow();
        const trialEndsAt = trialDays > 0
            ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000)
            : null;
        const periodEndsAt = trialDays > 0
            ? null
            : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const nextStatus = trialDays > 0 ? 'trialing' : 'active';

        const updateResult = await db.query(
            `UPDATE tenants
             SET plan_id = $1,
                 subscription_status = $2,
                 trial_ends_at = $3,
                 current_period_ends_at = $4,
                 updated_at = NOW()
             WHERE id = $5
             RETURNING id`,
            [plan.id, nextStatus, trialEndsAt, periodEndsAt, companyId]
        );

        if (updateResult.rows.length === 0) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const company = await getCompanyById(companyId);

        return res.json({
            message: 'Company plan updated successfully',
            company
        });
    } catch (error) {
        console.error('updateTenantPlanBySuperadmin error:', error);
        return res.status(500).json({ error: 'Failed to update company plan' });
    }
};

const updateTenantStatusBySuperadmin = async (req, res) => {
    const { companyId } = req.params;
    const parsedIsActive = parseBoolean(req.body?.is_active);

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    if (parsedIsActive === null) {
        return res.status(400).json({ error: 'is_active must be a boolean' });
    }

    try {
        const updateResult = await db.query(
            `UPDATE tenants
             SET is_active = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING id`,
            [parsedIsActive, companyId]
        );

        if (updateResult.rows.length === 0) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const company = await getCompanyById(companyId);

        return res.json({
            message: parsedIsActive ? 'Company unblocked successfully' : 'Company blocked successfully',
            company
        });
    } catch (error) {
        console.error('updateTenantStatusBySuperadmin error:', error);
        return res.status(500).json({ error: 'Failed to update company status' });
    }
};

const updateTenantUnlimitedAccessBySuperadmin = async (req, res) => {
    const { companyId } = req.params;
    const parsedUnlimitedAccess = parseBoolean(req.body?.unlimited_access);

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    if (parsedUnlimitedAccess === null) {
        return res.status(400).json({ error: 'unlimited_access must be a boolean' });
    }

    try {
        const updateResult = await db.query(
            `UPDATE tenants
             SET unlimited_access = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING id`,
            [parsedUnlimitedAccess, companyId]
        );

        if (updateResult.rows.length === 0) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const company = await getCompanyById(companyId);

        return res.json({
            message: parsedUnlimitedAccess
                ? 'Unlimited access enabled for company'
                : 'Unlimited access disabled for company',
            company
        });
    } catch (error) {
        console.error('updateTenantUnlimitedAccessBySuperadmin error:', error);
        return res.status(500).json({ error: 'Failed to update unlimited access' });
    }
};

const updateLandingVideoBySuperadmin = async (req, res) => {
    const rawUrl = String(req.body?.video_url || '').trim();
    const videoUrl = rawUrl.slice(0, 2000);

    if (videoUrl) {
        const isHttpUrl = /^https?:\/\//i.test(videoUrl);
        const isRootRelative = videoUrl.startsWith('/');
        if (!isHttpUrl && !isRootRelative) {
            return res.status(400).json({ error: 'video_url must be an absolute http(s) URL or a root-relative path' });
        }
    }

    try {
        const oldVideoUrl = await getGlobalLandingVideoUrl();
        
        // If the URL has changed, try to delete the old one if it was an internal upload
        if (oldVideoUrl && oldVideoUrl !== videoUrl) {
            await deleteUploadedFile(oldVideoUrl);
        }

        await db.query(
            `INSERT INTO settings (key, value, company_id)
             VALUES ('landing_hero_video_url', $1, NULL)
             ON CONFLICT (key) WHERE company_id IS NULL
             DO UPDATE SET value = EXCLUDED.value`,
            [videoUrl]
        );
        if (videoUrl) {
            await db.query(
                `INSERT INTO settings (key, value, company_id)
                 VALUES ('landing_hero_video_enabled', 'true', NULL)
                 ON CONFLICT (key) WHERE company_id IS NULL
                 DO UPDATE SET value = EXCLUDED.value`
            );
        }

        return res.json({
            message: videoUrl ? 'Landing video updated successfully' : 'Landing video removed successfully',
            video_url: videoUrl
        });
    } catch (error) {
        console.error('updateLandingVideoBySuperadmin error:', error);
        return res.status(500).json({ error: 'Failed to update landing video' });
    }
};

const uploadLandingVideoFileBySuperadmin = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file provided' });
    }

    try {
        // 1. Get old video URL from settings
        const oldVideoUrl = await getGlobalLandingVideoUrl();

        // 2. If old video was a local/supabase file (not an external URL), delete it
        if (oldVideoUrl) {
            await deleteUploadedFile(oldVideoUrl);
        }

        // 3. Upload new video
        const uploadResult = await uploadIncomingFile(req.file, { folder: 'landing-page-video' });

        // 4. Update settings table with the relative URL
        await db.query(
            `INSERT INTO settings (key, value, company_id)
             VALUES ('landing_hero_video_url', $1, NULL)
             ON CONFLICT (key) WHERE company_id IS NULL
             DO UPDATE SET value = EXCLUDED.value`,
            [uploadResult.url]
        );
        await db.query(
            `INSERT INTO settings (key, value, company_id)
             VALUES ('landing_hero_video_enabled', 'true', NULL)
             ON CONFLICT (key) WHERE company_id IS NULL
             DO UPDATE SET value = EXCLUDED.value`
        );

        // 5. Return the public URL for preview
        const publicUrl = getPublicUrlForRelativeUrl(uploadResult.url) || uploadResult.url;

        return res.json({
            message: 'Landing video uploaded successfully',
            video_url: uploadResult.url,
            public_url: publicUrl
        });
    } catch (error) {
        console.error('uploadLandingVideoFileBySuperadmin error:', error);
        return res.status(500).json({ error: 'Failed to upload landing video' });
    }
};

const updateLandingVideoVisibilityBySuperadmin = async (req, res) => {
    const parsedEnabled = parseBoolean(req.body?.enabled);
    if (parsedEnabled === null) {
        return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    try {
        await db.query(
            `INSERT INTO settings (key, value, company_id)
             VALUES ('landing_hero_video_enabled', $1, NULL)
             ON CONFLICT (key) WHERE company_id IS NULL
             DO UPDATE SET value = EXCLUDED.value`,
            [parsedEnabled ? 'true' : 'false']
        );
        return res.json({
            message: parsedEnabled ? 'Landing video enabled' : 'Landing video disabled',
            landing_video_enabled: parsedEnabled
        });
    } catch (error) {
        console.error('updateLandingVideoVisibilityBySuperadmin error:', error);
        return res.status(500).json({ error: 'Failed to update landing video visibility' });
    }
};

const getTimeTravelBySuperadmin = async (_req, res) => {
    try {
        return res.json({
            offset_ms: timeService.getOffset(),
            virtual_time: timeService.getNow(),
            virtual_time_ms: timeService.getNow().getTime(),
            system_time: new Date(),
            system_time_ms: Date.now()
        });
    } catch (error) {
        console.error('getTimeTravelBySuperadmin error:', error);
        return res.status(500).json({ error: 'Failed to load virtual time' });
    }
};

const setTimeTravelBySuperadmin = async (req, res) => {
    try {
        const { offset_ms, add_ms, reset } = req.body || {};

        if (reset) {
            await timeService.reset();
        } else if (add_ms !== undefined) {
            await timeService.addOffset(Number.parseInt(String(add_ms), 10));
        } else if (offset_ms !== undefined) {
            await timeService.setOffset(Number.parseInt(String(offset_ms), 10));
        } else {
            return res.status(400).json({ error: 'offset_ms, add_ms, or reset is required' });
        }

        return res.json({
            success: true,
            offset_ms: timeService.getOffset(),
            virtual_time: timeService.getNow(),
            virtual_time_ms: timeService.getNow().getTime()
        });
    } catch (error) {
        console.error('setTimeTravelBySuperadmin error:', error);
        return res.status(500).json({ error: 'Failed to update virtual time' });
    }
};

const quoteIdent = (value) => `"${String(value).replace(/"/g, '""')}"`;

const deleteCompanyBySuperadmin = async (req, res) => {
    const { companyId } = req.params;
    const confirm = Boolean(req.body?.confirm);

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const companyRes = await client.query(
            `SELECT id, name, slug
             FROM tenants
             WHERE id = $1
             LIMIT 1`,
            [companyId]
        );
        if (companyRes.rows.length === 0) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Compute impact defensively to support older schemas where some tables/columns may differ.
        let usersCount = 0;
        let projectsCount = 0;
        let tasksCount = 0;

        try {
            const usersCountRes = await client.query(
                `SELECT COUNT(*)::int AS c FROM users WHERE company_id = $1`,
                [companyId]
            );
            usersCount = Number(usersCountRes.rows[0]?.c || 0);
        } catch (_e) {
            usersCount = 0;
        }

        try {
            const projectsCountRes = await client.query(
                `SELECT COUNT(*)::int AS c FROM projects WHERE company_id = $1`,
                [companyId]
            );
            projectsCount = Number(projectsCountRes.rows[0]?.c || 0);
        } catch (_e) {
            projectsCount = 0;
        }

        try {
            const tasksCountRes = await client.query(
                `SELECT COUNT(*)::int AS c
                 FROM tasks t
                 JOIN users u ON u.id = t.user_id
                 WHERE u.company_id = $1`,
                [companyId]
            );
            tasksCount = Number(tasksCountRes.rows[0]?.c || 0);
        } catch (_e) {
            // Ignore when tasks table/columns are different in older deployments.
            tasksCount = 0;
        }

        const impact = { users_count: usersCount, projects_count: projectsCount, tasks_count: tasksCount };
        if (!confirm) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'Confirmation required',
                warning: 'Deleting this company will permanently delete its users, projects, and related data.',
                impact
            });
        }

        // Normalize any non-cascading FKs to users before deleting company users.
        // This is schema-driven so older/variant deployments are handled safely.
        const userRefRes = await client.query(
            `SELECT
                n.nspname AS schema_name,
                c.relname AS table_name,
                a.attname AS column_name,
                col.is_nullable AS is_nullable,
                con.confdeltype AS delete_action
             FROM pg_constraint con
             JOIN pg_class c ON c.oid = con.conrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_class parent ON parent.oid = con.confrelid
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = con.conkey[1]
             LEFT JOIN information_schema.columns col
               ON col.table_schema = n.nspname
              AND col.table_name = c.relname
              AND col.column_name = a.attname
             WHERE con.contype = 'f'
               AND parent.relname = 'users'
               AND array_length(con.conkey, 1) = 1
               AND n.nspname = 'public'
               AND c.relname <> 'users'`
        );

        for (const row of userRefRes.rows) {
            const table = `${quoteIdent(row.schema_name)}.${quoteIdent(row.table_name)}`;
            const column = quoteIdent(row.column_name);
            const deleteAction = String(row.delete_action || '');
            const isNullable = String(row.is_nullable || '').toUpperCase() === 'YES';

            // Cascading is handled by DB rules.
            // SET NULL still needs fallback handling when schema is inconsistent (NOT NULL column).
            if (deleteAction === 'c' || (deleteAction === 'n' && isNullable) || deleteAction === 'd') {
                continue;
            }

            if (isNullable) {
                await client.query(
                    `UPDATE ${table}
                     SET ${column} = NULL
                     WHERE ${column} IN (SELECT id FROM users WHERE company_id = $1)`,
                    [companyId]
                );
            } else {
                await client.query(
                    `DELETE FROM ${table}
                     WHERE ${column} IN (SELECT id FROM users WHERE company_id = $1)`,
                    [companyId]
                );
            }
        }

        // Normalize non-cascading FKs to tenants for legacy/variant schemas where
        // company linkage might not be through a plain `company_id` column.
        const tenantRefRes = await client.query(
            `SELECT
                n.nspname AS schema_name,
                c.relname AS table_name,
                a.attname AS column_name,
                col.is_nullable AS is_nullable,
                con.confdeltype AS delete_action
             FROM pg_constraint con
             JOIN pg_class c ON c.oid = con.conrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_class parent ON parent.oid = con.confrelid
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = con.conkey[1]
             LEFT JOIN information_schema.columns col
               ON col.table_schema = n.nspname
              AND col.table_name = c.relname
              AND col.column_name = a.attname
             WHERE con.contype = 'f'
               AND parent.relname = 'tenants'
               AND array_length(con.conkey, 1) = 1
               AND n.nspname = 'public'
               AND c.relname <> 'tenants'`
        );

        for (const row of tenantRefRes.rows) {
            const table = `${quoteIdent(row.schema_name)}.${quoteIdent(row.table_name)}`;
            const column = quoteIdent(row.column_name);
            const deleteAction = String(row.delete_action || '');
            const isNullable = String(row.is_nullable || '').toUpperCase() === 'YES';

            // Cascade and valid SET NULL/SET DEFAULT paths can rely on DB behavior.
            if (deleteAction === 'c' || (deleteAction === 'n' && isNullable) || deleteAction === 'd') {
                continue;
            }

            if (isNullable) {
                await client.query(
                    `UPDATE ${table}
                     SET ${column} = NULL
                     WHERE ${column} = $1`,
                    [companyId]
                );
            } else {
                await client.query(
                    `DELETE FROM ${table}
                     WHERE ${column} = $1`,
                    [companyId]
                );
            }
        }

        // Delete every row scoped by company_id across all tables, then delete tenant itself.
        const companyTablesRes = await client.query(
            `SELECT table_schema, table_name
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND column_name = 'company_id'
               AND table_name <> 'tenants'
             GROUP BY table_schema, table_name
             ORDER BY CASE WHEN table_name = 'users' THEN 0 ELSE 1 END, table_name`
        );

        for (const row of companyTablesRes.rows) {
            const table = `${quoteIdent(row.table_schema)}.${quoteIdent(row.table_name)}`;
            await client.query(`DELETE FROM ${table} WHERE company_id = $1`, [companyId]);
        }

        await client.query('DELETE FROM tenants WHERE id = $1', [companyId]);

        await client.query('COMMIT');
        return res.json({
            message: 'Company deleted successfully',
            deleted_company: companyRes.rows[0],
            impact
        });
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (_rollbackError) {
            // ignore rollback error, original error is more relevant
        }
        console.error('deleteCompanyBySuperadmin error:', error);
        return res.status(500).json({ error: `Failed to delete company: ${error.message}` });
    } finally {
        client.release();
    }
};

const getGeoAnalytics = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const endDate = end_date || new Date().toISOString();

        const result = await db.query(`
            SELECT
                COALESCE(country_code, 'Unknown') AS country,
                COUNT(*)::int AS requests,
                COUNT(DISTINCT ip_address)::int AS "uniqueIPs"
            FROM request_logs
            WHERE created_at >= $1 AND created_at <= $2
            GROUP BY country_code
            ORDER BY requests DESC
            LIMIT 50
        `, [startDate, endDate]);

        const geoData = result.rows.map(row => ({
            country: row.country === 'Unknown' ? 'Unknown' : row.country,
            countryCode: row.country === 'Unknown' ? 'XX' : row.country,
            requests: row.requests,
            uniqueIPs: row.uniqueIPs,
            cities: []
        }));

        for (const item of geoData) {
            if (item.countryCode === 'XX') continue;
            const citiesResult = await db.query(`
                SELECT
                    COALESCE(city, 'Unknown') AS name,
                    COUNT(*)::int AS count
                FROM request_logs
                WHERE country_code = $1
                  AND created_at >= $2 AND created_at <= $3
                  AND city IS NOT NULL
                GROUP BY city
                ORDER BY count DESC
                LIMIT 10
            `, [item.countryCode, startDate, endDate]);
            item.cities = citiesResult.rows;
        }

        return res.json({ data: geoData });
    } catch (error) {
        if (isSchemaAvailabilityError(error)) {
            return res.json({ data: [], warning: 'tracking_schema_unavailable' });
        }
        console.error('getGeoAnalytics error:', error);
        return res.status(500).json({ error: 'Failed to get geo analytics' });
    }
};

module.exports = {
    getSuperadminDashboard,
    updateTenantPlanBySuperadmin,
    updateTenantStatusBySuperadmin,
    updateTenantUnlimitedAccessBySuperadmin,
    updateLandingVideoBySuperadmin,
    updateLandingVideoVisibilityBySuperadmin,
    uploadLandingVideoFileBySuperadmin,
    getTimeTravelBySuperadmin,
    setTimeTravelBySuperadmin,
    deleteCompanyBySuperadmin,
    getServerMetrics,
    getLiveUsers,
    getGeoAnalytics
};
