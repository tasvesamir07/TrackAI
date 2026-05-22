const express = require('express');
const router = express.Router();
const { verifyToken, isAdminOrModerator } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { getUserActivityLogs, getAllActivityLogs, getActivitySummary, getMonthlyReport, getMyMonthlyStats, getTeamWeeklyHours, getTeamSummary } = require('../controllers/activityController');

// Get current user's activity logs
router.get('/my-logs', verifyToken, getUserActivityLogs);

// Get all activity logs (Admin/Moderator)
router.get('/all', verifyToken, requirePermission('activity', 'read'), isAdminOrModerator, getAllActivityLogs);

// Get activity summary for all users (Admin/Moderator)
router.get('/summary', verifyToken, requirePermission('activity', 'read'), isAdminOrModerator, getActivitySummary);

// Get monthly attendance report (Admin/Moderator)
router.get('/report', verifyToken, requirePermission('activity', 'read'), isAdminOrModerator, getMonthlyReport);

// Get monthly statistics for logged-in user
router.get('/my-monthly-stats', verifyToken, getMyMonthlyStats);

// Get team weekly hours for workload chart (Admin/Moderator)
router.get('/team-weekly-hours', verifyToken, requirePermission('activity', 'read'), isAdminOrModerator, getTeamWeeklyHours);

// Get team summary for dashboard (Admin/Moderator)
router.get('/team-summary', verifyToken, requirePermission('activity', 'read'), isAdminOrModerator, getTeamSummary);

// Export activity logs (Admin/Moderator)
router.get('/export', verifyToken, requirePermission('activity', 'export'), isAdminOrModerator, (req, res) => {
    res.status(501).json({ error: 'Export endpoint - implement with your export logic' });
});

module.exports = router;
