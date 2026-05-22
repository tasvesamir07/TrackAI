const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const {
  runLoadTest,
  streamLoadTest,
  getTestStatus,
  getTestResult,
  stopLoadTest,
} = require('../controllers/loadTestController');

router.post('/run', verifyToken, requirePermission('superadmin', 'execute'), runLoadTest);
router.get('/stream/:testId', verifyToken, requirePermission('superadmin', 'execute'), streamLoadTest);
router.get('/status/:testId', verifyToken, requirePermission('superadmin', 'execute'), getTestStatus);
router.get('/result/:testId', verifyToken, requirePermission('superadmin', 'execute'), getTestResult);
router.post('/stop', verifyToken, requirePermission('superadmin', 'execute'), stopLoadTest);

module.exports = router;
