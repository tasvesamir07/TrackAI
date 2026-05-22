const express = require('express');
const router = express.Router();
const {
    getTimeTravel,
    setTimeTravel,
    triggerTask,
    resetUserDay,
    resetBalance,
    testOvertimeAlert,
    resetMyLeaves,
    clearMySubmissions,
    setupAdmin
} = require('../controllers/devController');
const { verifyToken } = require('../middleware/authMiddleware');

router.post('/setup-admin', (req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Not available in production' });
    }
    next();
}, setupAdmin);

router.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Dev routes not available in production' });
    }
    next();
});

router.use(verifyToken);

router.get('/time-travel', getTimeTravel);
router.post('/time-travel', setTimeTravel);
router.post('/trigger-task', triggerTask);
router.post('/reset-user-day', resetUserDay);
router.post('/reset-balance', resetBalance);
router.post('/reset-my-leaves', resetMyLeaves);
router.post('/clear-my-submissions', clearMySubmissions);
router.post('/test-overtime-alert', testOvertimeAlert);

module.exports = router;
