const express = require('express');
const router = express.Router();
const { submitTask, getHistory, getLastTask, getTaskByDate, checkTodayTaskSubmission, scheduleTask, getScheduledTask, cancelScheduledTask } = require('../controllers/taskController');
const { verifyToken } = require('../middleware/authMiddleware');
const { compressUploadedImages } = require('../middleware/imageCompressor');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(verifyToken);

router.post('/submit', requirePermission('tasks', 'submit'), submitTask);
router.put('/update', requirePermission('tasks', 'submit'), submitTask);
router.post('/schedule', requirePermission('tasks', 'schedule'), scheduleTask);
router.get('/schedule', requirePermission('tasks', 'schedule'), getScheduledTask);
router.delete('/schedule', requirePermission('tasks', 'schedule'), cancelScheduledTask);
router.get('/my-history', requirePermission('tasks', 'view_history'), getHistory);
router.get('/last-entry', requirePermission('tasks', 'view_history'), getLastTask);
router.get('/by-date/:date', requirePermission('tasks', 'view_history'), getTaskByDate);
router.get('/check-today', requirePermission('tasks', 'submit'), checkTodayTaskSubmission);

module.exports = router;
