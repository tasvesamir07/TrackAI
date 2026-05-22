const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { 
  getReferralCode, 
  registerWithReferral, 
  getReferralStats 
} = require('../controllers/referralController');

router.get('/code', verifyToken, getReferralCode);
router.get('/stats', verifyToken, getReferralStats);
router.post('/register', registerWithReferral);

module.exports = router;