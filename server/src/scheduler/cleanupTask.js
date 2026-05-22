const cron = require('node-cron');
const db = require('../db');
const timeService = require('../utils/timeService');
const { deleteFile } = require('../utils/fileUtils');

let cleanupTask = null;

/**
 * Schedule the attachment cleanup based on settings
 */
const schedule = async () => {
    try {
        if (cleanupTask) {
            cleanupTask.stop();
            cleanupTask = null;
        }

        const settingsRes = await db.query("SELECT value FROM settings WHERE key = 'attachment_config'");
        const settings = settingsRes.rows.length > 0
            ? JSON.parse(settingsRes.rows[0].value)
            : { retention_days: 30, cleanup_time: '04:00' };

        const [hour, minute] = (settings.cleanup_time || '04:00').split(':');

        cleanupTask = cron.schedule(`${minute} ${hour} * * *`, async () => {
            console.log('Running scheduled attachment cleanup...');
            await checkAttachmentExpiration();
        });

        console.log(`Attachment cleanup scheduled for ${settings.cleanup_time || '04:00'} daily.`);
    } catch (err) {
        console.error('Error in cleanupTask.schedule:', err);
    }
};

const checkAttachmentExpiration = async () => {
    try {
        console.log('Running daily attachment expiration check...');

        const settingsRes = await db.query("SELECT value FROM settings WHERE key = 'attachment_config'");
        const settings = settingsRes.rows.length > 0 ? JSON.parse(settingsRes.rows[0].value) : { retention_days: 30 };

        const retentionDays = parseInt(settings.retention_days);
        if (isNaN(retentionDays) || retentionDays <= 0) {
            console.log('Attachment retention disabled or invalid days.');
            return;
        }

        const expirationDate = timeService.getNow();
        expirationDate.setDate(expirationDate.getDate() - retentionDays);

        const expiredRes = await db.query(`
            SELECT id, attachment_url
            FROM messages
            WHERE attachment_url IS NOT NULL
            AND created_at < $1
        `, [expirationDate]);

        const expiredMessages = expiredRes.rows;
        if (expiredMessages.length === 0) return;

        let deletedCount = 0;
        for (const msg of expiredMessages) {
            try {
                if (msg.attachment_url) {
                    deleteFile(msg.attachment_url);
                    deletedCount++;
                }
                await db.query(`UPDATE messages SET attachment_url = NULL, attachment_type = NULL WHERE id = $1`, [msg.id]);
            } catch (err) {
                console.error(`Failed to delete attachment for message ${msg.id}:`, err);
            }
        }
        console.log(`Successfully deleted ${deletedCount} attachment files from disk.`);
    } catch (error) {
        console.error('Error in attachment expiration check:', error);
    }
};

module.exports = { schedule, checkAttachmentExpiration };
