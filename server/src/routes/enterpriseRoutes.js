const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const {
  setupSSO, getSSOConfig, disableSSO,
  createAnnouncement, getAnnouncements,
  addBookmark, getBookmarks, deleteBookmark,
  createScheduledReport, getScheduledReports
} = require('../controllers/enterpriseController');

router.post('/sso', verifyToken, requirePermission('settings', 'update'), setupSSO);
router.get('/sso', verifyToken, getSSOConfig);
router.delete('/sso', verifyToken, requirePermission('settings', 'delete'), disableSSO);

router.post('/announcements', verifyToken, requirePermission('announcements', 'create'), createAnnouncement);
router.get('/announcements', verifyToken, getAnnouncements);

router.post('/bookmarks', verifyToken, addBookmark);
router.get('/bookmarks', verifyToken, getBookmarks);
router.delete('/bookmarks/:id', verifyToken, deleteBookmark);

router.post('/scheduled-reports', verifyToken, requirePermission('reports', 'create'), createScheduledReport);
router.get('/scheduled-reports', verifyToken, getScheduledReports);

module.exports = router;