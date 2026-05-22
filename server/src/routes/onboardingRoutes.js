const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { saveStep1, saveStep2, saveStep3, saveStep4, completeOnboarding } = require('../controllers/onboardingController');

router.post('/step1', verifyToken, saveStep1);
router.post('/step2', verifyToken, saveStep2);
router.post('/step3', verifyToken, saveStep3);
router.post('/step4', verifyToken, saveStep4);
router.post('/complete', verifyToken, completeOnboarding);

module.exports = router;