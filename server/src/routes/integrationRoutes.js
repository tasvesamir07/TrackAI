const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { 
  setupSlackIntegration, 
  setupGoogleCalendar, 
  setupZapier,
  setupMicrosoftTeams,
  getIntegrations, 
  disconnectIntegration 
} = require('../controllers/integrationController');

router.post('/slack', verifyToken, requirePermission('settings', 'update'), setupSlackIntegration);
router.post('/google-calendar', verifyToken, requirePermission('settings', 'update'), setupGoogleCalendar);
router.post('/zapier', verifyToken, requirePermission('settings', 'update'), setupZapier);
router.post('/microsoft-teams', verifyToken, requirePermission('settings', 'update'), setupMicrosoftTeams);
router.get('/', verifyToken, getIntegrations);
router.delete('/:provider', verifyToken, requirePermission('settings', 'delete'), disconnectIntegration);

module.exports = router;