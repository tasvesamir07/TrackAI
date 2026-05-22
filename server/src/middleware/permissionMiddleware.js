const permissionService = require('../utils/permissionService');

const requirePermission = (module, action) => {
    return async (req, res, next) => {
        try {
            const userRole = req.user?.role;
            
            if (!userRole) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            
            const companyId = req.user?.company_id || null;
            
            const hasPermission = await permissionService.getPermission(userRole, module, action, companyId);
            
            if (!hasPermission) {
                return res.status(403).json({ 
                    error: 'Permission denied',
                    required: { module, action }
                });
            }
            
            next();
        } catch (err) {
            console.error('Permission check error:', err);
            res.status(500).json({ error: 'Permission check failed' });
        }
    };
};

const requireAnyPermission = (...permissions) => {
    return async (req, res, next) => {
        try {
            const userRole = req.user?.role;
            
            if (!userRole) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            
            const companyId = req.user?.company_id || null;
            
            for (const { module, action } of permissions) {
                const hasPermission = await permissionService.getPermission(userRole, module, action, companyId);
                if (hasPermission) {
                    return next();
                }
            }
            
            return res.status(403).json({ 
                error: 'Permission denied',
                required: permissions
            });
        } catch (err) {
            console.error('Permission check error:', err);
            res.status(500).json({ error: 'Permission check failed' });
        }
    };
};

const requireAllPermissions = (...permissions) => {
    return async (req, res, next) => {
        try {
            const userRole = req.user?.role;
            
            if (!userRole) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            
            const companyId = req.user?.company_id || null;
            
            for (const { module, action } of permissions) {
                const hasPermission = await permissionService.getPermission(userRole, module, action, companyId);
                if (!hasPermission) {
                    return res.status(403).json({ 
                        error: 'Permission denied',
                        required: { module, action }
                    });
                }
            }
            
            next();
        } catch (err) {
            console.error('Permission check error:', err);
            res.status(500).json({ error: 'Permission check failed' });
        }
    };
};

module.exports = {
    requirePermission,
    requireAnyPermission,
    requireAllPermissions
};