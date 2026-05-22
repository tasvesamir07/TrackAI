const express = require('express');
const router = express.Router();
const telegramController = require('../controllers/telegramController');
const telegramService = require('../utils/telegramService');

// POST /api/telegram/webhook
router.post('/webhook', async (req, res) => {
    try {
        const bot = telegramService.getBot();
        if (bot) {
            // Process the incoming webhook manually
            bot.processUpdate(req.body);
            return res.sendStatus(200);
        }
        res.sendStatus(503); // Service Unavailable if bot not initialized
    } catch (err) {
        console.error('[Telegram Webhook] Error processing update:', err);
        res.sendStatus(500);
    }
});

module.exports = router;
