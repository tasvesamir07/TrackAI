const db = require('../db');
const { deleteFile } = require('./fileUtils');

const normalizeAttachments = (attachments) => {
    if (!attachments) return [];
    if (Array.isArray(attachments)) return attachments;

    if (typeof attachments === 'string') {
        try {
            const parsed = JSON.parse(attachments);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    return [];
};

const clearUserSubmissions = async (userId) => {
    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        const tasksRes = await client.query(
            'SELECT id, date, attachments FROM tasks WHERE deleted_at IS NULL AND user_id = $1 ORDER BY date DESC, id DESC',
            [userId]
        );

        const affectedDates = Array.from(new Set(
            tasksRes.rows
                .map((row) => row.date)
                .filter(Boolean)
                .map((value) => {
                    const parsed = new Date(value);
                    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().split('T')[0];
                })
        ));

        if (affectedDates.length > 0) {
            await client.query(
                'DELETE FROM daily_summaries WHERE date = ANY($1::date[])',
                [affectedDates]
            );
        }

        await client.query('UPDATE tasks SET deleted_at = NOW() WHERE user_id = $1', [userId]);
        await client.query('COMMIT');

        for (const row of tasksRes.rows) {
            const attachments = normalizeAttachments(row.attachments);
            for (const att of attachments) {
                if (att?.url) {
                    deleteFile(att.url);
                }
            }
        }

        return {
            deletedTasks: tasksRes.rowCount,
            affectedDates
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

module.exports = {
    clearUserSubmissions
};
