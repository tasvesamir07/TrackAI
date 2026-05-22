const express = require('express');
const router = express.Router();
const {
    getDailyReports,
    getMonthlyReports,
    getWeeklyReports,
    getYearlyReports,
    deleteTask,
    createUser,
    getUsers,
    deleteUser,
    updateUserRole,
    updateUserDepartment,
    getDepartments,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    getCategories,
    createCategory,
    deleteCategory,
    updateUserCategories,
    getHolidays,
    updateHolidays,
    getWorkHours,
    updateWorkHours,
    updateWeekendDays,
    getEarlyLeaves,
    getEmailSettings,
    saveEmailSettings,
    getOvertimeSettings,
    saveOvertimeSettings,
    getAttachmentSettings,
    saveAttachmentSettings,
    sendReportEmail,
    sendReportWhatsApp,
    sendReportTelegram,
    summarizeReport,
    getReportSummary,
    saveReportSummary,
    getUserDetails,
    getProfileRequests,
    handleProfileRequest,
    getDevToolsSettings,
    saveDevToolsSettings,
    getNotificationSettings,
    saveNotificationSettings,
    getPaidLeaveSettings,
    savePaidLeaveSettings,
    updateUserPaidLeaveBalance,
    resetUserPaidLeaveBalance,
    resetAllPaidLeaveBalances,
    resetUserMinutesBalance,
    resetAllMinutesBalances,
    clearUserLeaveHistory,
    clearUserSkippedDays,
    clearAllSkippedDays,
    clearManagedUserSubmissions,
    resetLeaves,
    requestEmployeeLocation
} = require('../controllers/adminController');

const { getActivitySummary } = require('../controllers/activityController');
const {
    verifyToken,
    isAdmin,
    isAdminOrModerator,
    isUserDirectoryViewer,
    isUserDirectoryDetailsViewer
} = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(verifyToken);

router.get('/holidays', requirePermission('settings', 'read'), isAdmin, getHolidays);
router.get('/work-hours', requirePermission('settings', 'read'), isAdmin, getWorkHours);
router.get('/early-leaves', requirePermission('leaves', 'view_all'), isAdminOrModerator, getEarlyLeaves);
router.get('/categories', requirePermission('settings', 'read'), getCategories);
router.get('/departments', requirePermission('users', 'read'), getDepartments);
router.get('/activity-log', requirePermission('activity', 'read'), isAdminOrModerator, getActivitySummary);
router.get('/daily-reports', requirePermission('reports', 'read'), isAdminOrModerator, getDailyReports);
router.get('/monthly-reports', requirePermission('reports', 'read'), isAdminOrModerator, getMonthlyReports);
router.get('/weekly-reports', requirePermission('reports', 'read'), isAdminOrModerator, getWeeklyReports);
router.get('/yearly-reports', requirePermission('reports', 'read'), isAdminOrModerator, getYearlyReports);
router.get('/users', requirePermission('users', 'read'), isUserDirectoryViewer, getUsers);
router.get('/users/:id', requirePermission('users', 'read_details'), isUserDirectoryDetailsViewer, getUserDetails);
router.post('/users/:id/request-location', requirePermission('users', 'request_location'), isAdmin, requestEmployeeLocation);
router.get('/report-summary', requirePermission('reports', 'read'), isAdminOrModerator, getReportSummary);
router.post('/report-summary', requirePermission('reports', 'read'), isAdminOrModerator, saveReportSummary);
router.post('/send-report-email', requirePermission('reports', 'send_email'), isAdminOrModerator, sendReportEmail);
router.post('/send-report-whatsapp', requirePermission('reports', 'send_whatsapp'), isAdminOrModerator, sendReportWhatsApp);
router.post('/send-report-telegram', requirePermission('reports', 'send_telegram'), isAdminOrModerator, sendReportTelegram);
router.post('/summarize-report', requirePermission('reports', 'summarize'), isAdminOrModerator, summarizeReport);
router.delete('/tasks/:id', requirePermission('tasks', 'submit'), isAdminOrModerator, deleteTask);

router.get('/profile-requests', requirePermission('users', 'read'), getProfileRequests);
router.post('/profile-requests/:requestId/handle', requirePermission('users', 'update'), handleProfileRequest);
router.post('/users', requirePermission('users', 'create'), isAdmin, createUser);
router.patch('/users/:id/role', requirePermission('users', 'update_role'), isAdmin, updateUserRole);
router.patch('/users/:id/department', requirePermission('users', 'update'), isAdmin, updateUserDepartment);
router.patch('/users/:id/categories', requirePermission('users', 'update'), isAdmin, updateUserCategories);
router.post('/departments', requirePermission('settings', 'update'), isAdmin, createDepartment);
router.patch('/departments/:id', requirePermission('settings', 'update'), isAdmin, updateDepartment);
router.delete('/departments/:id', requirePermission('settings', 'update'), isAdmin, deleteDepartment);
router.patch('/users/:id/paid-leave-balance', requirePermission('users', 'update_leave_balance'), updateUserPaidLeaveBalance);
router.patch('/users/:id/paid-leave-balance/reset', requirePermission('users', 'reset_balance'), resetUserPaidLeaveBalance);
router.post('/users/paid-leave-balance/reset-all', requirePermission('users', 'reset_balance'), resetAllPaidLeaveBalances);
router.patch('/users/:id/minutes-balance/reset', requirePermission('users', 'reset_balance'), resetUserMinutesBalance);
router.delete('/users/:id/leave-history', requirePermission('leaves', 'delete'), clearUserLeaveHistory);
router.delete('/users/:id/skipped-days', requirePermission('leaves', 'delete'), clearUserSkippedDays);
router.delete('/users/:id/submissions', requirePermission('leaves', 'delete'), clearManagedUserSubmissions);
router.post('/users/skipped-days/reset-all', requirePermission('leaves', 'delete'), clearAllSkippedDays);
router.post('/users/minutes-balance/reset-all', requirePermission('users', 'reset_balance'), resetAllMinutesBalances);
router.delete('/users/:id', requirePermission('users', 'delete'), deleteUser);

router.post('/holidays', requirePermission('settings', 'update'), updateHolidays);
router.post('/work-hours', requirePermission('settings', 'update'), updateWorkHours);
router.post('/weekend-days', requirePermission('settings', 'update'), updateWeekendDays);
router.post('/categories', requirePermission('settings', 'update'), createCategory);
router.delete('/categories/:id', requirePermission('settings', 'update'), deleteCategory);

router.get('/email-settings', requirePermission('settings', 'read'), getEmailSettings);
router.post('/email-settings', requirePermission('settings', 'update'), saveEmailSettings);

router.get('/overtime-settings', requirePermission('settings', 'read'), getOvertimeSettings);
router.post('/overtime-settings', requirePermission('settings', 'update'), saveOvertimeSettings);

router.get('/dev-tools-settings', requirePermission('settings', 'read'), getDevToolsSettings);
router.post('/dev-tools-settings', requirePermission('settings', 'update'), saveDevToolsSettings);
router.post('/reset-leaves', requirePermission('leaves', 'delete'), resetLeaves);

router.get('/attachment-settings', requirePermission('settings', 'read'), getAttachmentSettings);
router.post('/attachment-settings', requirePermission('settings', 'update'), saveAttachmentSettings);

router.get('/notification-settings', requirePermission('settings', 'read'), getNotificationSettings);
router.post('/notification-settings', requirePermission('settings', 'update'), saveNotificationSettings);

router.get('/paid-leave-settings', requirePermission('settings', 'read'), getPaidLeaveSettings);
router.post('/paid-leave-settings', requirePermission('settings', 'update'), savePaidLeaveSettings);


module.exports = router;
