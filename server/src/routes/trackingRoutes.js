const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { 
  trackClick, 
  trackClickBatch, 
  getClickAnalytics,
  getRequestAnalytics,
  logBotDetection,
  getBotAnalytics
} = require('../controllers/trackingController');

router.post('/click', verifyToken, trackClick);
router.post('/click/batch', verifyToken, trackClickBatch);
router.get('/clicks', verifyToken, requirePermission('analytics', 'read'), getClickAnalytics);

router.get('/requests', verifyToken, requirePermission('analytics', 'read'), getRequestAnalytics);

router.post('/bot', logBotDetection);
router.get('/bots', verifyToken, requirePermission('analytics', 'read'), getBotAnalytics);

module.exports = router;