const path = require('path');
const { deleteUploadedFile, toRelativeUploadUrl } = require('./storageService');

/**
 * Validates that a relative URL is safe and within allowed directories
 * @param {string} relativeUrl - The relative URL of the file
 * @returns {boolean} - True if the path is safe
 */
const isSafePath = (relativeUrl) => {
    const normalizedUrl = toRelativeUploadUrl(relativeUrl);
    if (!normalizedUrl) {
        return false;
    }

    // Must start with /uploads
    if (!normalizedUrl.startsWith('/uploads/')) {
        console.warn(`[FileDelete] Rejected: Path does not start with /uploads/: ${relativeUrl}`);
        return false;
    }

    // Normalize and check for path traversal attempts
    const normalizedPath = path.normalize(normalizedUrl);
    if (normalizedPath.includes('..') || normalizedPath.includes('\\')) {
        console.warn(`[FileDelete] Rejected: Path contains traversal characters: ${relativeUrl}`);
        return false;
    }

    // Only allow specific file extensions
    const ext = path.extname(normalizedUrl).toLowerCase();
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.mp4', '.mov', '.bin'];
    if (!allowedExtensions.includes(ext)) {
        console.warn(`[FileDelete] Rejected: Invalid file extension: ${ext}`);
        return false;
    }

    return true;
};

/**
 * Deletes a file from the server's filesystem based on a relative URL.
 * @param {string} relativeUrl - The relative URL of the file (e.g., /uploads/chat/filename.ext)
 */
const deleteFile = (relativeUrl) => {
    if (!relativeUrl) return;
    const normalizedUrl = toRelativeUploadUrl(relativeUrl);

    // Security check: validate the path is safe
    if (!normalizedUrl || !isSafePath(normalizedUrl)) {
        console.warn(`[FileDelete] Security: Blocked deletion of unsafe path: ${relativeUrl}`);
        return;
    }

    deleteUploadedFile(normalizedUrl)
        .then(() => {
            console.log(`[FileDelete] Delete request completed: ${normalizedUrl}`);
        })
        .catch((err) => {
            console.error(`[FileDelete] Error deleting file ${normalizedUrl}:`, err);
        });
};

module.exports = {
    deleteFile,
    isSafePath
};
