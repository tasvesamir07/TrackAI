const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { 
  createLead, 
  getLeads, 
  generateApiKey, 
  getApiKeys, 
  revokeApiKey, 
  setupWebhook, 
  getWebhooks 
} = require('../controllers/salesController');

router.post('/leads', createLead);
router.get('/leads', verifyToken, requirePermission('leads', 'read'), getLeads);

router.post('/api-keys', verifyToken, requirePermission('settings', 'create'), generateApiKey);
router.get('/api-keys', verifyToken, getApiKeys);
router.delete('/api-keys/:id', verifyToken, requirePermission('settings', 'delete'), revokeApiKey);

router.post('/webhooks', verifyToken, requirePermission('settings', 'create'), setupWebhook);
router.get('/webhooks', verifyToken, getWebhooks);

module.exports = router;