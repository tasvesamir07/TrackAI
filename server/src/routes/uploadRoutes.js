const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const { createUploadUrl } = require('../controllers/uploadController');

const router = express.Router();

router.post('/presign', verifyToken, createUploadUrl);

module.exports = router;
