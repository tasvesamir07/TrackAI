const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { login, logout, signIn, signOut, me, updateStatus, getColleagues, heartbeat, updateProfile, changePassword, forgotPassword, verifyOTP, verifyUsernameOTP, resetPassword, forgotUsername, acknowledgeProfileNotification, getSkippedDays, getTelegramLinkToken, googleLogin, getPlanOptions, upgradeMyCompanyPlan } = require('../controllers/authController');
const { getStreamSession, createDirectChannel } = require('../controllers/streamController');
const { getWorkHours, getHolidays } = require('../controllers/adminController');
const { verifyToken, verifySession } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const upload = require('../middleware/uploadMiddleware');
const { compressUploadedImages } = require('../middleware/imageCompressor');

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: User login
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *               - password
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Username or email
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 */

const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Rate limiting for authentication endpoints
const authLimiter = rateLimit({
    windowMs: parsePositiveInt(process.env.AUTH_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: parsePositiveInt(process.env.AUTH_LIMIT_MAX_ATTEMPTS, 10),
    keyGenerator: (req) => {
        const identifier = String(req.body?.identifier || req.body?.username || req.body?.email || '').trim().toLowerCase();
        const ipKey = rateLimit.ipKeyGenerator(req.ip);
        return identifier ? `${ipKey}:${identifier}` : ipKey;
    },
    handler: (req, res) => {
        const retryAfterSeconds = Math.max(Math.ceil((req.rateLimit?.resetTime ? req.rateLimit.resetTime.getTime() - Date.now() : 0) / 1000), 1);
        return res.status(429).json({
            error: `Too many failed login attempts. Try again in about ${retryAfterSeconds} seconds`
        });
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    keyGenerator: (req) => {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const ipKey = rateLimit.ipKeyGenerator(req.ip);
        return email ? `${ipKey}:${email}` : ipKey;
    },
    message: { error: 'Too many password reset attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Public routes with rate limiting
router.post('/login', verifySession, authLimiter, login);
router.post('/google-login', verifySession, authLimiter, googleLogin);
router.post('/logout', verifySession, logout);
router.post('/forgot-username', forgotUsername);
router.post('/verify-username-otp', verifyUsernameOTP);
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password', resetPassword);

// Protected routes
router.post('/sign-in', verifyToken, requirePermission('auth', 'sign_in'), signIn);
router.post('/sign-out', verifyToken, requirePermission('auth', 'sign_out'), signOut);
router.get('/me', verifySession, me);
router.put('/status', verifyToken, updateStatus);
router.get('/colleagues', verifyToken, getColleagues);
router.get('/work-hours', verifyToken, getWorkHours);
router.get('/holidays', verifyToken, getHolidays);
router.post('/heartbeat', verifyToken, heartbeat);
router.put('/profile', verifyToken, upload.single('profile_picture'), compressUploadedImages, updateProfile);
router.post('/change-password', verifyToken, changePassword);
router.post('/acknowledge-profile-notification', verifyToken, acknowledgeProfileNotification);
router.get('/skipped-days', verifyToken, getSkippedDays);
router.get('/telegram-token', verifyToken, getTelegramLinkToken);
router.get('/stream/session', verifyToken, getStreamSession);
router.post('/stream/direct-channel', verifyToken, createDirectChannel);
router.get('/plan-options', verifyToken, getPlanOptions);
router.post('/upgrade-plan', verifyToken, upgradeMyCompanyPlan);


module.exports = router;
