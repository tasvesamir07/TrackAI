const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');

// Verification endpoint (GET)
router.get('/webhook', whatsappController.verifyWebhook);

// Message handling endpoint (POST)
router.post('/webhook', whatsappController.handleWebhook);

module.exports = router;
