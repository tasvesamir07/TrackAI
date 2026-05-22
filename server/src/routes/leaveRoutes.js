const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/leaveController');
const { verifyToken, isAdmin, isAdminOrModerator } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(verifyToken);

// Employee routes
router.post('/request', requirePermission('leaves', 'request'), leaveController.requestLeave);
router.get('/my', requirePermission('leaves', 'view_own'), leaveController.getMyLeaves);
router.get('/uncovered', requirePermission('leaves', 'view_own'), leaveController.getUncoveredLeaves);
router.post('/cover', requirePermission('leaves', 'cover_others'), leaveController.coverLeave);

// Admin/Moderator routes
router.get('/admin', requirePermission('leaves', 'view_all'), isAdminOrModerator, leaveController.getAdminLeaves);
router.get('/upcoming', requirePermission('leaves', 'view_all'), isAdminOrModerator, leaveController.getUpcomingLeaves);
router.patch('/:id/status', requirePermission('leaves', 'approve'), isAdminOrModerator, leaveController.updateLeaveStatus);
router.patch('/batch-status/:requestId', requirePermission('leaves', 'approve'), isAdminOrModerator, leaveController.updateLeaveStatusByRequestId);
router.patch('/batch-proceed/:requestId', requirePermission('leaves', 'proceed'), isAdminOrModerator, leaveController.proceedLeaveStatusByRequestId);
router.patch('/batch-decline/:requestId', requirePermission('leaves', 'reject'), isAdminOrModerator, leaveController.declineLeaveStatusByRequestId);
router.delete('/batch/:requestId', requirePermission('leaves', 'delete'), isAdmin, leaveController.deleteLeaveByRequestId);
router.delete('/:id', requirePermission('leaves', 'delete'), isAdmin, leaveController.deleteLeave);

module.exports = router;
