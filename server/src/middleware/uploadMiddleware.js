const multer = require('multer');
const path = require('path');

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_DOCUMENT_TYPES = ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm'];
const ALLOWED_ARCHIVE_TYPES = ['application/zip', 'application/x-zip-compressed'];
const ALLOWED_MIME_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOCUMENT_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_ARCHIVE_TYPES];

const MAGIC_NUMBER_MAP = {
    'image/jpeg': [[0xFF, 0xD8, 0xFF]],
    'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
    'image/gif': [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    'image/webp': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50]],
    'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
    'application/zip': [[0x50, 0x4B, 0x03, 0x04], [0x50, 0x4B, 0x05, 0x06], [0x50, 0x4B, 0x07, 0x08]],
    'video/mp4': [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]],
};

const validateMagicNumber = (buffer, mimeType) => {
    const signatures = MAGIC_NUMBER_MAP[mimeType];
    if (!signatures) return true;

    for (const signature of signatures) {
        let matches = true;
        for (let i = 0; i < signature.length; i++) {
            if (signature[i] !== null && buffer[i] !== signature[i]) {
                matches = false;
                break;
            }
        }
        if (matches) return true;
    }
    return false;
};

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_VIDEO_SIZE = 250 * 1024 * 1024;

const storage = multer.memoryStorage();

// File filter to validate MIME types and extensions
const fileFilter = (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return cb(new Error(`Invalid file type: ${file.mimetype}. Allowed types: images, documents, videos, and archives`), false);
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.sh', '.php', '.jsp', '.asp', '.aspx', '.dll', '.so'];
    if (dangerousExtensions.includes(ext)) {
        return cb(new Error(`Dangerous file type not allowed: ${ext}`), false);
    }

    if (file.buffer && !validateMagicNumber(file.buffer, file.mimetype)) {
        return cb(new Error(`File content does not match claimed type: ${file.mimetype}`), false);
    }

    cb(null, true);
};

const upload = multer({
    storage: storage,
    limits: { 
        fileSize: MAX_FILE_SIZE,
        files: 10 // Maximum 10 files per upload
    },
    fileFilter: fileFilter
});

module.exports = upload;
