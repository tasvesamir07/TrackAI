const express = require('express');
const router = express.Router();
const { getMessages, getConversations, createGroup, uploadAttachment, deleteMessage, editMessage, addReaction, togglePin, getGroupMembers, clearConversation, leaveGroup } = require('../controllers/chatController');
const { getPushPublicKey, subscribePush, unsubscribePush } = require('../controllers/pushController');
const { verifyToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { uploadLimiter, chatLimiter } = require('../middleware/rateLimiter');
const multer = require('multer');
const path = require('path');
const { compressUploadedImages } = require('../middleware/imageCompressor');
const { uploadIncomingFile } = require('../utils/storageService');

// Allowed MIME types for chat uploads
const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/pdf', 'text/plain',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip', 'application/x-zip-compressed'
];

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return cb(new Error(`Invalid file type: ${file.mimetype}. Allowed types: images, PDF, DOC, DOCX, XLS, XLSX, TXT, ZIP`), false);
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.sh', '.php', '.jsp', '.asp', '.aspx', '.dll', '.so'];
    if (dangerousExtensions.includes(ext)) {
        return cb(new Error(`Dangerous file type not allowed: ${ext}`), false);
    }

    cb(null, true);
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 70 * 1024 * 1024,
        files: 10
    },
    fileFilter: fileFilter
});

router.get('/history', chatLimiter, verifyToken, requirePermission('chat', 'read'), getMessages);
router.get('/conversations', chatLimiter, verifyToken, requirePermission('chat', 'read'), getConversations);
router.get('/push/public-key', verifyToken, getPushPublicKey);
router.post('/push/subscribe', verifyToken, subscribePush);
router.post('/push/unsubscribe', verifyToken, unsubscribePush);
router.post('/groups', verifyToken, requirePermission('chat', 'create_group'), createGroup);
router.get('/groups/:id/members', verifyToken, requirePermission('chat', 'read'), getGroupMembers);
router.delete('/groups/:id/leave', verifyToken, requirePermission('chat', 'read'), leaveGroup);
router.delete('/conversations/:id', verifyToken, requirePermission('chat', 'read'), clearConversation);
router.post('/upload', uploadLimiter, verifyToken, requirePermission('chat', 'send'), (req, res, next) => {
    upload.array('files', 10)(req, res, (err) => {
        if (!err) return next();

        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'File too large. Max 70MB per file.' });
            }
            return res.status(400).json({ error: err.message || 'Invalid upload payload' });
        }

        return res.status(400).json({ error: err?.message || 'Invalid file upload' });
    });
}, compressUploadedImages, async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const uploadedFiles = await Promise.all(
            req.files.map((file) => uploadIncomingFile(file, { folder: 'chat' }))
        );

        const responseFiles = uploadedFiles.map((file) => ({
            url: file.url,
            type: file.type,
            name: file.name,
            size: file.size
        }));

        res.json({
            files: responseFiles,
            url: responseFiles[0].url,
            type: responseFiles[0].type
        });
    } catch (err) {
        console.error('[ChatUpload] Upload failed:', err);
        res.status(500).json({ error: 'Failed to upload files' });
    }
});
router.delete('/message/:id', verifyToken, requirePermission('chat', 'delete'), deleteMessage);
router.put('/message/:id', verifyToken, requirePermission('chat', 'send'), editMessage);
router.post('/message/:id/reaction', verifyToken, requirePermission('chat', 'send'), addReaction);
router.put('/message/:id/pin', verifyToken, requirePermission('chat', 'read'), togglePin);

module.exports = router;
