const express = require('express');
const {
    signupTenantWithAdmin,
    loginSaasUser,
    signupTenantWithGoogle,
    getPublicPlans
} = require('../controllers/saasAuthController');

const router = express.Router();

router.post('/signup', signupTenantWithAdmin);
router.post('/google-signup', signupTenantWithGoogle);
router.post('/login', loginSaasUser);
router.get('/plans', getPublicPlans);

module.exports = router;
