const express = require('express');
const router = express.Router();
const {
    createProject,
    getProjects,
    getProjectDetails,
    updateProject,
    deleteProject,
    getDeletedProjects,
    restoreProject,
    addMember,
    removeMember,
    createTask,
    getProjectTasks,
    getAssignedTaskAlerts,
    dismissAssignedTaskAlert,
    getProjectActivityLogs,
    updateTask,
    deleteTask,
    getTaskComments,
    addTaskComment,
    uploadTaskAttachment
} = require('../controllers/projectController');
const { verifyToken, isAdminOrModerator, isAdmin } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const upload = require('../middleware/uploadMiddleware');
const { compressUploadedImages } = require('../middleware/imageCompressor');

router.use(verifyToken);

router.get('/bin', requirePermission('projects', 'read'), isAdminOrModerator, getDeletedProjects);
router.post('/:id/restore', requirePermission('projects', 'restore'), isAdminOrModerator, restoreProject);
router.post('/', requirePermission('projects', 'create'), isAdminOrModerator, createProject);
router.get('/', requirePermission('projects', 'read'), getProjects);
router.get('/:id', requirePermission('projects', 'read'), getProjectDetails);
router.get('/:id/activity-logs', requirePermission('activity', 'read'), isAdminOrModerator, getProjectActivityLogs);
router.put('/:id', requirePermission('projects', 'update'), isAdminOrModerator, updateProject);
router.delete('/:id', requirePermission('projects', 'delete'), isAdminOrModerator, deleteProject);


router.post('/:id/members', requirePermission('projects', 'manage_members'), isAdminOrModerator, addMember);
router.delete('/:id/members/:userId', requirePermission('projects', 'manage_members'), isAdminOrModerator, removeMember);

router.get('/tasks/assigned-alerts', requirePermission('tasks', 'view_history'), getAssignedTaskAlerts);
router.post('/tasks/:taskId/dismiss-alert', requirePermission('tasks', 'submit'), dismissAssignedTaskAlert);
router.post('/:id/tasks', requirePermission('tasks', 'submit'), createTask);
router.get('/:id/tasks', requirePermission('tasks', 'view_history'), getProjectTasks);
router.put('/tasks/:taskId', requirePermission('tasks', 'submit'), updateTask);
router.delete('/tasks/:taskId', requirePermission('tasks', 'submit'), deleteTask);
router.get('/tasks/:taskId/comments', requirePermission('tasks', 'view_history'), getTaskComments);
router.post('/tasks/:taskId/comments', requirePermission('tasks', 'submit'), addTaskComment);
router.post('/tasks/:taskId/attachments', requirePermission('tasks', 'submit'), upload.array('attachments', 10), compressUploadedImages, uploadTaskAttachment);

module.exports = router;
