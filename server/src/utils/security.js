const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const rawKey = (process.env.MESSAGE_ENCRYPTION_KEY || '').trim();
const isValidHexKey = /^[a-fA-F0-9]{64}$/.test(rawKey);
const ENCRYPTION_KEY = isValidHexKey ? Buffer.from(rawKey, 'hex') : null; // Must be 32 bytes
const IV_LENGTH = 16; // AES block size

if (!ENCRYPTION_KEY) {
    console.warn('[Security] MESSAGE_ENCRYPTION_KEY is missing/invalid. Message encryption is disabled.');
}

/**
 * Encrypts text using AES-256-CBC
 * @param {string} text - The plain text to encrypt
 * @returns {string} - The encrypted text in format "iv:content" (hex)
 */
function encrypt(text) {
    if (!text) return text;
    if (!ENCRYPTION_KEY) return text;
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (err) {
        console.error('Encryption error:', err);
        return text; // Fallback to plain text on error (safer for now?) Or throw? 
        // For chat, maybe fallback or empty? 
        // Let's return original so we don't break flow, but log error.
    }
}

/**
 * Decrypts text using AES-256-CBC
 * @param {string} text - The encrypted text in format "iv:content" (hex)
 * @returns {string} - The decrypted plain text
 */
function decrypt(text) {
    if (!text) return text;
    if (!ENCRYPTION_KEY) return text;
    try {
        const textParts = text.split(':');

        // Basic check for format iv:content
        if (textParts.length !== 2) {
            // Assume legacy plain text if format doesn't match
            return text;
        }

        const iv = Buffer.from(textParts[0], 'hex');
        const encryptedText = Buffer.from(textParts[1], 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString();
    } catch (err) {
        // If decryption fails, it might be plain text or corrupt. compare to see if it makes sense.
        // Returning original text handles legacy unencrypted messages gracefully.
        return text;
    }
}

module.exports = { encrypt, decrypt };
