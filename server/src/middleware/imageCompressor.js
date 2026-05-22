const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_DIMENSION = 1600; // Max width or height
const WEBP_QUALITY = 72;
const WEBP_EFFORT = 4;

/**
 * Get a standardized sharp compression pipeline for a given format/extension.
 * @param {string} ext - The file extension (e.g., '.jpg')
 * @returns {sharp.Sharp} The configured sharp pipeline
 */
function getCompressionPipeline(ext, source = null) {
    let pipeline = sharp(source || undefined)
        .resize(MAX_DIMENSION, MAX_DIMENSION, {
            fit: 'inside',
            withoutEnlargement: true
        })
        .rotate();

    const normalizedExt = ext.toLowerCase();

    if (normalizedExt === '.jpg' || normalizedExt === '.jpeg') {
        pipeline = pipeline.jpeg({ quality: 80, mozjpeg: true });
    } else if (normalizedExt === '.png') {
        pipeline = pipeline.png({ compressionLevel: 8, palette: true });
    } else if (normalizedExt === '.webp') {
        pipeline = pipeline.webp({ quality: 80 });
    }

    return pipeline;
}

/**
 * Compress a single image file in-place using sharp.
 */
async function compressImage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext)) return;

    try {
        const tempPath = filePath + '.tmp';
        const pipeline = getCompressionPipeline(ext, filePath);

        await pipeline.toFile(tempPath);

        const originalSize = fs.statSync(filePath).size;
        const compressedSize = fs.statSync(tempPath).size;

        if (compressedSize < originalSize) {
            fs.unlinkSync(filePath);
            fs.renameSync(tempPath, filePath);
            const savings = ((1 - compressedSize / originalSize) * 100).toFixed(1);
            console.log(`[ImageCompressor] ${path.basename(filePath)}: ${(originalSize / 1024).toFixed(0)}KB → ${(compressedSize / 1024).toFixed(0)}KB (${savings}% saved)`);
        } else {
            fs.unlinkSync(tempPath);
            console.log(`[ImageCompressor] ${path.basename(filePath)}: kept original (${(originalSize / 1024).toFixed(0)}KB)`);
        }
    } catch (err) {
        console.error(`[ImageCompressor] Error compressing ${filePath}:`, err.message);
    }
}

/**
 * Compress an uploaded image buffer in memory.
 */
async function compressImageBuffer(file) {
    if (!file?.buffer || !Buffer.isBuffer(file.buffer)) return;

    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext)) return;

    try {
        const originalBuffer = file.buffer;

        // Normalize raster images to WebP for better network and storage performance.
        const transformedBuffer = await sharp(originalBuffer)
            .rotate()
            .resize(MAX_DIMENSION, MAX_DIMENSION, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT })
            .toBuffer();

        if (transformedBuffer.length < originalBuffer.length) {
            file.buffer = transformedBuffer;
            file.size = transformedBuffer.length;
            file.mimetype = 'image/webp';

            const originalName = String(file.originalname || 'upload');
            file.originalname = originalName.replace(/\.[^.]+$/, '') + '.webp';

            const savings = ((1 - transformedBuffer.length / originalBuffer.length) * 100).toFixed(1);
            console.log(`[ImageCompressor] ${path.basename(originalName)} -> ${path.basename(file.originalname)}: ${(originalBuffer.length / 1024).toFixed(0)}KB -> ${(transformedBuffer.length / 1024).toFixed(0)}KB (${savings}% saved)`);
        }
    } catch (err) {
        console.error(`[ImageCompressor] Error compressing in-memory file ${file.originalname || '(unknown)'}:`, err.message);
    }
}

/**
 * Express middleware: compress all uploaded image files after multer processes them.
 */
function compressUploadedImages(req, res, next) {
    const files = req.files || (req.file ? [req.file] : []);
    if (files.length === 0) return next();

    Promise.all(
        files.map(file => {
            if (file.buffer && Buffer.isBuffer(file.buffer)) {
                return compressImageBuffer(file);
            }

            if (file.path) {
                return compressImage(path.resolve(file.path));
            }

            return Promise.resolve();
        })
    )
        .then(() => next())
        .catch(() => next());
}

module.exports = { compressImage, compressImageBuffer, compressUploadedImages, getCompressionPipeline };
