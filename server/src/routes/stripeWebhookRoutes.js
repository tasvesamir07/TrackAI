const express = require('express');
const { createCheckoutSession, stripeWebhookHandler } = require('../controllers/stripeWebhookController');

const router = express.Router();

router.post('/checkout-session', express.json(), createCheckoutSession);
router.post('/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

module.exports = router;
