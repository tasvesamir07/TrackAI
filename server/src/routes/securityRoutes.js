const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { requireSuperadmin } = require('../middleware/tenantMiddleware');
const { 
  setup2FA, 
  verify2FA, 
  disable2FA,
  getSessions, 
  terminateSession, 
  terminateAllSessions,
  getAuditLogs,
  getIPWhitelist,
  addIPWhitelist,
  removeIPWhitelist,
  getBotStats,
  getBotLogs
} = require('../controllers/securityController');

router.post('/2fa/setup', verifyToken, setup2FA);
router.post('/2fa/verify', verifyToken, verify2FA);
router.post('/2fa/disable', verifyToken, disable2FA);

router.get('/sessions', verifyToken, getSessions);
router.delete('/sessions/:sessionId', verifyToken, terminateSession);
router.post('/sessions/terminate-all', verifyToken, terminateAllSessions);

router.get('/audit-logs', verifyToken, requirePermission('settings', 'read'), getAuditLogs);

router.get('/ip-whitelist', verifyToken, requirePermission('settings', 'read'), getIPWhitelist);
router.post('/ip-whitelist', verifyToken, requirePermission('settings', 'update'), addIPWhitelist);
router.delete('/ip-whitelist/:id', verifyToken, requirePermission('settings', 'delete'), removeIPWhitelist);

// Bot Protection Panel routes
router.get('/bot-stats', verifyToken, requireSuperadmin, getBotStats);
router.get('/bot-logs', verifyToken, requireSuperadmin, getBotLogs);

module.exports = router;