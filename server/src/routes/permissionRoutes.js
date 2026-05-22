const express = require('express');
const router = express.Router();
const permissionService = require('../utils/permissionService');
const { verifyToken } = require('../middleware/authMiddleware');

router.get('/my-role', verifyToken, async (req, res) => {
    try {
        const role = req.user.role;
        const companyId = req.user.company_id;
        
        const permissions = await permissionService.getRolePermissions(role, companyId);
        
        res.json({
            role,
            permissions,
            companyId
        });
    } catch (err) {
        console.error('Error getting user permissions:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/check', verifyToken, async (req, res) => {
    try {
        const { module, action } = req.query;
        const role = req.user.role;
        const companyId = req.user.company_id;
        
        if (!module || !action) {
            return res.status(400).json({ error: 'Module and action are required' });
        }
        
        const hasPermission = await permissionService.getPermission(role, module, action, companyId);
        
        res.json({ hasPermission });
    } catch (err) {
        console.error('Error checking permission:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;