const path = require('path');
const { createPresignedUpload } = require('../utils/storageService');

const sanitizeFileName = (fileName) => {
    const base = path.basename(fileName);
    return base.replace(/[^a-zA-Z0-9._-]/g, '_');
};

const createUploadUrl = async (req, res) => {
    try {
        const body = req.body || {};
        const folder = String(body.folder || 'misc').trim().replace(/[^a-zA-Z0-9/_-]/g, '');
        const fileName = sanitizeFileName(String(body.fileName || 'file.bin').trim());
        const contentType = String(body.contentType || 'application/octet-stream').trim();

        const upload = await createPresignedUpload({ folder, fileName, contentType });
        return res.json({
            success: true,
            data: upload
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error?.message || 'Failed to create upload URL'
        });
    }
};

module.exports = {
    createUploadUrl
};
