const express = require('express');
const { updatePlanBySuperadmin, createPlanBySuperadmin } = require('../controllers/superadminPlanController');
const {
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
} = require('../controllers/superadminController');
const { verifyToken } = require('../middleware/authMiddleware');
const { attachCompanyContext, requireSuperadmin } = require('../middleware/tenantMiddleware');
const upload = require('../middleware/uploadMiddleware');
const multer = require('multer');
const permissionService = require('../utils/permissionService');
const db = require('../db');

const router = express.Router();

router.use(verifyToken, requireSuperadmin);

router.get('/dashboard', getSuperadminDashboard);
router.get('/metrics/server', getServerMetrics);
router.get('/metrics/users', getLiveUsers);
router.get('/analytics/geo', getGeoAnalytics);
router.patch('/companies/:companyId/plan', updateTenantPlanBySuperadmin);
router.patch('/companies/:companyId/status', updateTenantStatusBySuperadmin);
router.patch('/companies/:companyId/unlimited-access', updateTenantUnlimitedAccessBySuperadmin);
router.delete('/companies/:companyId', deleteCompanyBySuperadmin);
router.patch('/landing-video', updateLandingVideoBySuperadmin);
router.patch('/landing-video/visibility', updateLandingVideoVisibilityBySuperadmin);
router.post('/landing-video/upload', (req, res, next) => {
    upload.single('video')(req, res, (err) => {
        if (!err) return next();
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'Video too large. Maximum allowed size is 250MB.' });
        }
        return res.status(400).json({ error: err?.message || 'Invalid video upload payload' });
    });
}, uploadLandingVideoFileBySuperadmin);

router.patch('/plans/:planId', attachCompanyContext, requireSuperadmin, updatePlanBySuperadmin);
router.post('/plans', attachCompanyContext, requireSuperadmin, createPlanBySuperadmin);
router.get('/time-travel', getTimeTravelBySuperadmin);
router.post('/time-travel', setTimeTravelBySuperadmin);

// Permission Management Routes
router.get('/permissions/global', verifyToken, requireSuperadmin, async (req, res) => {
    try {
        const modules = await permissionService.getAllModulesWithActions();
        
        const globalPermissions = {};
        const roles = ['admin', 'moderator', 'employee'];
        
        for (const role of roles) {
            globalPermissions[role] = {};
            const perms = await db.query(`
                SELECT pm.name as module, pa.name as action, rpmg.is_enabled
                FROM role_permissions_global rpmg
                JOIN permission_modules pm ON rpmg.module_id = pm.id
                JOIN permission_actions pa ON rpmg.action_id = pa.id
                WHERE rpmg.role = $1 AND pm.is_active = TRUE AND pa.is_active = TRUE
            `, [role]);
            
            for (const row of perms.rows) {
                if (!globalPermissions[role][row.module]) {
                    globalPermissions[role][row.module] = {};
                }
                globalPermissions[role][row.module][row.action] = row.is_enabled;
            }
        }
        
        res.json({ modules, globalPermissions });
    } catch (err) {
        console.error('Error getting global permissions:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/permissions/global', verifyToken, requireSuperadmin, async (req, res) => {
    try {
        const { role, module, action, is_enabled } = req.body;
        
        if (!role || !module || !action || is_enabled === undefined) {
            return res.status(400).json({ error: 'role, module, action, and is_enabled are required' });
        }
        
        const success = await permissionService.setGlobalPermission(role, module, action, is_enabled);
        
        if (success) {
            res.json({ message: 'Global permission updated successfully' });
        } else {
            res.status(500).json({ error: 'Failed to update permission' });
        }
    } catch (err) {
        console.error('Error updating global permission:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/permissions/companies', verifyToken, requireSuperadmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT id, name, slug FROM tenants WHERE is_active = TRUE ORDER BY name
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error getting companies:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/permissions/companies/:companyId/overrides', verifyToken, requireSuperadmin, async (req, res) => {
    try {
        const { companyId } = req.params;
        const overrides = await permissionService.getCompanyOverrides(companyId);
        res.json({ overrides });
    } catch (err) {
        console.error('Error getting company overrides:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/permissions/companies/:companyId/overrides', verifyToken, requireSuperadmin, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { role, module, action, is_enabled } = req.body;
        
        if (!role || !module || !action || is_enabled === undefined) {
            return res.status(400).json({ error: 'role, module, action, and is_enabled are required' });
        }
        
        const success = await permissionService.setCompanyPermission(role, module, action, companyId, is_enabled);
        
        if (success) {
            res.json({ message: 'Company override updated successfully' });
        } else {
            res.status(500).json({ error: 'Failed to update permission' });
        }
    } catch (err) {
        console.error('Error updating company override:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/permissions/companies/:companyId/overrides', verifyToken, requireSuperadmin, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { role, module, action } = req.query;
        
        if (role && module && action) {
            await permissionService.deleteCompanyPermission(role, module, action, companyId);
        } else {
            await permissionService.resetCompanyPermissions(companyId);
        }
        
        res.json({ message: 'Company overrides reset successfully' });
    } catch (err) {
        console.error('Error resetting company overrides:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/permissions/seed', verifyToken, requireSuperadmin, async (req, res) => {
    try {
        await permissionService.seedDefaultPermissions();
        res.json({ message: 'Permissions seeded successfully' });
    } catch (err) {
        console.error('Error seeding permissions:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
