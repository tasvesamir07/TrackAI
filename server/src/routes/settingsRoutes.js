const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { getCompanySettings, updateCompanySettings, getDirectory } = require('../controllers/settingsController');

router.get('/company', verifyToken, requirePermission('settings', 'read'), getCompanySettings);
router.patch('/company', verifyToken, requirePermission('settings', 'update'), updateCompanySettings);

router.get('/directory', verifyToken, getDirectory);

module.exports = router;