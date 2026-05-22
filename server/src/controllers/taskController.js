const db = require('../db');
const { uploadIncomingFile } = require('../utils/storageService');

const uploadTaskFiles = async (files, folder = 'tasks') => {
    if (!Array.isArray(files) || files.length === 0) return [];

    const uploaded = await Promise.all(
        files.map((file) => uploadIncomingFile(file, { folder }))
    );

    return uploaded.map((file) => ({
        url: file.url,
        type: file.type,
        name: file.name,
        size: file.size
    }));
};

const submitTask = async (req, res) => {
    console.log('');
    console.log('='.repeat(80));
    console.log('[SUBMIT TASK] ENDPOINT CALLED');
    console.log('[SUBMIT TASK] User ID:', req.user?.id);
    console.log('[SUBMIT TASK] Request Body Keys:', Object.keys(req.body));
    console.log('[SUBMIT TASK] Files:', req.body.attachments ? 'yes' : 'no');
    console.log('='.repeat(80));
    console.log('');

    if (!req.body || Object.keys(req.body).length === 0) {
        console.error('[SubmitTask] Error: req.body is empty or undefined');
        return res.status(400).json({
            error: 'Request body is missing. Ensure Content-Type is multipart/form-data or application/json.',
            debug: { headers: req.headers }
        });
    }

    const { todays_task, date: userDate } = req.body;
    const next_task = req.body.next_task || ""; // Ensure never null
    const user_id = req.user.id;
    const timeService = require('../utils/timeService');
    const getISODate = (date) => {
        const d = new Date(date);
        const month = '' + (d.getMonth() + 1);
        const day = '' + d.getDate();
        const year = d.getFullYear();
        return [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-');
    };
    const date = userDate || getISODate(timeService.getNow()); // Use local virtual today

    try {
        const io = req.app.get('io');

        // Process attachments if any
        let attachments = [];
         {
            
        }
        
        const processUpdate = async (existingTask) => {
            let existingAttachments = existingTask.attachments || [];
            if (typeof existingAttachments === 'string') {
                try { existingAttachments = JSON.parse(existingAttachments); } catch (e) { existingAttachments = []; }
            }

            // Handle removed attachments
            let removed_attachments = [];
            try {
                removed_attachments = req.body.removed_attachments ? JSON.parse(req.body.removed_attachments) : [];
            } catch (e) {
                console.error('[SubmitTask] Failed to parse removed_attachments:', e);
            }

            if (removed_attachments.length > 0) {
                const { deleteFile } = require('../utils/fileUtils');
                const relativeRemovedUrls = removed_attachments.map(url => {
                    try {
                        const urlObj = new URL(url, 'http://dummy.com');
                        const urlPath = urlObj.pathname.startsWith('/uploads') ? urlObj.pathname : url;
                        deleteFile(urlPath);
                        return urlPath;
                    } catch (e) {
                        deleteFile(url);
                        return url;
                    }
                });
                existingAttachments = existingAttachments.filter(att => !relativeRemovedUrls.includes(att.url));
            }

            const existingUrls = existingAttachments.map(ext => ext.url);
            const newAttachments = attachments.filter(att => !existingUrls.includes(att.url));
            const finalAttachments = [...existingAttachments, ...newAttachments];
            const result = await db.query(
                'UPDATE tasks SET todays_task = $1, updated_at = $2, attachments = $3 WHERE id = $4 RETURNING *',
                [todays_task, timeService.getNow(), JSON.stringify(finalAttachments), existingTask.id]
            );

            if (io) {
                io.emit('task_update', { type: 'update', task: result.rows[0], userId: user_id });
            }

            // Cancel any pending schedules
            await db.query("UPDATE scheduled_actions SET status = 'cancelled' WHERE user_id = $1 AND status = 'pending' AND (action_type IS NULL OR action_type = 'task_submission')", [user_id]);
            if (io) { io.emit('schedule_update', { userId: user_id, status: 'cancelled' }); }

            return res.json(result.rows[0]);
        };

        // Use database transaction with proper locking to prevent race conditions
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            // Lock the row for this user/date combination
            const lockResult = await client.query(
                'SELECT * FROM tasks WHERE deleted_at IS NULL AND user_id = $1 AND date = $2 FOR UPDATE',
                [user_id, date]
            );

            let existingTask = null;
            if (lockResult.rows.length > 0) {
                existingTask = lockResult.rows[0];
            }

            let result;
            if (existingTask) {
                // Process update with locked row
                let existingAttachments = existingTask.attachments || [];
                if (typeof existingAttachments === 'string') {
                    try { existingAttachments = JSON.parse(existingAttachments); } catch (e) { existingAttachments = []; }
                }

                // Handle removed attachments
                let removed_attachments = [];
                try {
                    removed_attachments = req.body.removed_attachments ? JSON.parse(req.body.removed_attachments) : [];
                } catch (e) {
                    console.error('[SubmitTask] Failed to parse removed_attachments:', e);
                }

                if (removed_attachments.length > 0) {
                    const { deleteFile } = require('../utils/fileUtils');
                    const relativeRemovedUrls = removed_attachments.map(url => {
                        try {
                            const urlObj = new URL(url, 'http://dummy.com');
                            const urlPath = urlObj.pathname.startsWith('/uploads') ? urlObj.pathname : url;
                            deleteFile(urlPath);
                            return urlPath;
                        } catch (e) {
                            deleteFile(url);
                            return url;
                        }
                    });
                    existingAttachments = existingAttachments.filter(att => !relativeRemovedUrls.includes(att.url));
                }

                const existingUrls = existingAttachments.map(ext => ext.url);
                const newAttachments = attachments.filter(att => !existingUrls.includes(att.url));
                const finalAttachments = [...existingAttachments, ...newAttachments];
                
                const updateResult = await client.query(
                    'UPDATE tasks SET todays_task = $1, updated_at = $2, attachments = $3 WHERE id = $4 RETURNING *',
                    [todays_task, timeService.getNow(), JSON.stringify(finalAttachments), existingTask.id]
                );
                result = updateResult.rows[0];

                if (io) {
                    io.emit('task_update', { type: 'update', task: result, userId: user_id });
                }

                // Cancel any pending schedules
                await client.query("UPDATE scheduled_actions SET status = 'cancelled' WHERE user_id = $1 AND status = 'pending' AND (action_type IS NULL OR action_type = 'task_submission')", [user_id]);
                if (io) { io.emit('schedule_update', { userId: user_id, status: 'cancelled' }); }
            } else {
                // Insert new task
                const insertResult = await client.query(
                    'INSERT INTO tasks (user_id, date, todays_task, attachments) VALUES ($1, $2, $3, $4) RETURNING *',
                    [user_id, date, todays_task, JSON.stringify(attachments)]
                );
                result = insertResult.rows[0];

                if (io) {
                    io.emit('task_update', { type: 'submit', task: result, userId: user_id });
                }
                
                // Cancel any pending schedules
                await client.query("UPDATE scheduled_actions SET status = 'cancelled' WHERE user_id = $1 AND status = 'pending' AND (action_type IS NULL OR action_type = 'task_submission')", [user_id]);
                if (io) { io.emit('schedule_update', { userId: user_id, status: 'cancelled' }); }
            }

            await client.query('COMMIT');
            return res.json(result);

        } catch (err) {
            await client.query('ROLLBACK');
            console.error('[SubmitTask] Transaction error:', err);
            res.status(500).json({ error: 'Server error during task submission' });
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('[SubmitTask] Error:', err);
        return res.status(500).json({ error: 'Server error', detail: err.message });
    }
};

const getHistory = async (req, res) => {
    const user_id = req.user.id;
    const limit = 10;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    try {
        const result = await db.query(
            'SELECT * FROM tasks WHERE deleted_at IS NULL AND user_id = $1 ORDER BY date DESC LIMIT $2 OFFSET $3',
            [user_id, limit, offset]
        );
        const total = await db.query('SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND user_id = $1', [user_id]);

        res.json({
            tasks: result.rows,
            totalPages: Math.ceil(total.rows[0].count / limit),
            currentPage: page
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getLastTask = async (req, res) => {
    const user_id = req.user.id;
    try {
        const result = await db.query(
            'SELECT * FROM tasks WHERE deleted_at IS NULL AND user_id = $1 ORDER BY date DESC LIMIT 1',
            [user_id]
        );
        res.json(result.rows[0] || {});
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

const checkTodayTaskSubmission = async (req, res) => {
    const user_id = req.user.id;
    const timeService = require('../utils/timeService');
    const getISODate = (date) => {
        const d = new Date(date);
        const month = '' + (d.getMonth() + 1);
        const day = '' + d.getDate();
        const year = d.getFullYear();
        return [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-');
    };
    const today = req.query.date || getISODate(timeService.getNow());

    try {
        const taskCheck = await db.query(
            'SELECT * FROM tasks WHERE deleted_at IS NULL AND user_id = $1 AND date = $2',
            [user_id, today]
        );

        const signOutCheck = await db.query(
            'SELECT * FROM activity_logs WHERE user_id = $1 AND activity_type = \'sign_out\' AND covered_date = $2::date',
            [user_id, today]
        );

        res.json({
            hasSubmitted: taskCheck.rows.length > 0,
            hasSignedOut: signOutCheck.rows.length > 0,
            task: taskCheck.rows[0] || null
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getTaskByDate = async (req, res) => {
    const user_id = req.user.id;
    const { date } = req.params;
    try {
        const result = await db.query(
            'SELECT * FROM tasks WHERE deleted_at IS NULL AND user_id = $1 AND date = $2',
            [user_id, date]
        );
        res.json(result.rows[0] || null);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

const scheduleTask = async (req, res) => {
    console.log('');
    console.log('='.repeat(80));
    console.log('[SCHEDULE TASK] ENDPOINT CALLED');
    console.log('[SCHEDULE TASK] User ID:', req.user.id);
    console.log('[SCHEDULE TASK] Request Body:', req.body);
    console.log('[SCHEDULE TASK] Files:', req.body.attachments ? 'yes' : 'no');
    console.log('='.repeat(80));
    console.log('');

    const user_id = req.user.id;
    const { scheduled_at, task_content } = req.body;

    if (!scheduled_at) {
        return res.status(400).json({ error: 'scheduled_at is required' });
    }

    try {
        // Process attachments if any
        let attachments = [];
         {
            
        }

        // Cancel any existing pending schedules for this user
        await db.query("UPDATE scheduled_actions SET status = 'cancelled' WHERE user_id = $1 AND status = 'pending'", [user_id]);

        // Store the scheduled_at time AS-IS (no adjustment needed)
        // The frontend sends the time in the user's timezone
        // processScheduledActions uses virtual time to check, so they will match correctly
        console.log('[Schedule Task] Received scheduled_at:', scheduled_at);
        console.log('[Schedule Task] Storing as-is for virtual time compatibility');

        const result = await db.query(
            'INSERT INTO scheduled_actions (user_id, scheduled_at, task_content, attachments) VALUES ($1, $2, $3, $4) RETURNING *',
            [user_id, scheduled_at, task_content, JSON.stringify(attachments)]
        );

        console.log('[Schedule Task] Stored in DB:', result.rows[0].scheduled_at);

        const io = req.app.get('io');
        if (io) {
            io.emit('schedule_update', {
                userId: user_id,
                status: 'scheduled',
                scheduled_at: result.rows[0].scheduled_at
            });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getScheduledTask = async (req, res) => {
    const user_id = req.user.id;
    try {
        // Only return task_submission type (auto-signout schedules), NOT overtime_alert or goal_reached_alert
        const result = await db.query(
            "SELECT * FROM scheduled_actions WHERE user_id = $1 AND status = 'pending' AND (action_type IS NULL OR action_type = 'task_submission') ORDER BY scheduled_at DESC LIMIT 1",
            [user_id]
        );

        if (result.rows.length > 0) {
            console.log(`[GetScheduledTask] Returning pending task_submission for user ${user_id}: ID=${result.rows[0].id}, Time=${result.rows[0].scheduled_at}`);
        }

        res.json(result.rows[0] || null);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const cancelScheduledTask = async (req, res) => {
    const user_id = req.user.id;
    try {
        // Only cancel task_submission type, not overtime/goal alerts
        await db.query("UPDATE scheduled_actions SET status = 'cancelled' WHERE user_id = $1 AND status = 'pending' AND (action_type IS NULL OR action_type = 'task_submission')", [user_id]);

        const io = req.app.get('io');
        if (io) {
            io.emit('schedule_update', {
                userId: user_id,
                status: 'cancelled'
            });
        }

        res.json({ message: 'Scheduled task cancelled' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { submitTask, getHistory, getLastTask, getTaskByDate, checkTodayTaskSubmission, scheduleTask, getScheduledTask, cancelScheduledTask };
