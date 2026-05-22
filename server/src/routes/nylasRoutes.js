const express = require('express');
const router = express.Router();
const {
    startOauth,
    callbackOauth,
    getConnectionStatus,
    disconnectMailbox,
    nylasWebhook
} = require('../controllers/nylasController');
const { verifyToken } = require('../middleware/authMiddleware');

router.get('/oauth/start', verifyToken, startOauth);
router.get('/oauth/callback', callbackOauth);
router.get('/connection', verifyToken, getConnectionStatus);
router.delete('/connection', verifyToken, disconnectMailbox);
router.post('/webhook', express.json({ type: '*/*' }), nylasWebhook);

module.exports = router;

