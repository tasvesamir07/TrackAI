const db = require('../db');
const timeService = require('../utils/timeService');
const scheduler = require('../scheduler');
const { calculateHoursWorkedToday } = require('../utils/attendanceService');
const { deleteFile } = require('../utils/fileUtils');
const { clearUserSubmissions } = require('../utils/submissionCleanupService');

const getTimeTravel = async (req, res) => {
    try {
        res.json({
            offset_ms: timeService.getOffset(),
            virtual_time: timeService.getNow(),
            system_time: new Date()
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const setTimeTravel = async (req, res) => {
    try {
        const { offset_ms, add_ms, reset } = req.body;

        if (reset) {
            await timeService.reset();
        } else if (add_ms !== undefined) {
            await timeService.addOffset(Number.parseInt(String(add_ms), 10));
        } else if (offset_ms !== undefined) {
            await timeService.setOffset(Number.parseInt(String(offset_ms), 10));
        }

        res.json({
            success: true,
            offset_ms: timeService.getOffset(),
            virtual_time: timeService.getNow()
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const triggerTask = async (req, res) => {
    try {
        const { task } = req.body;
        console.log(`\n=== MANUAL TASK TRIGGER: ${task} ===`);

        if (task === 'overtime_check') {
            await scheduler.checkOvertime(req.app);
            res.json({ message: 'Overtime check triggered successfully' });
        } else if (task === 'attachment_cleanup') {
            await scheduler.checkAttachmentExpiration();
            res.json({ message: 'Attachment cleanup triggered successfully' });
        } else if (task === 'missed_day_check') {
            await scheduler.checkMissedWorkdays(req.app);
            res.json({ message: 'Missed workday check triggered successfully' });
        } else {
            res.status(400).json({ error: 'Invalid task name' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error triggering task' });
    }
};

const resetUserDay = async (req, res) => {
    const userId = req.user.id;
    const localNow = timeService.getNow();
    const today = timeService.getDateStr(localNow);

    try {
        console.log(`\n=== DEV: RESETTING DAY FOR USER ${userId} [${today}] ===`);

        const virtualMidnight = new Date(localNow);
        virtualMidnight.setHours(0, 0, 0, 0);

        const virtualNextDay = new Date(virtualMidnight);
        virtualNextDay.setDate(virtualNextDay.getDate() + 1);

        console.log(`DEBUG: Clearing range [${virtualMidnight.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}] to [${virtualNextDay.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}]`);

        const { sessionStartTime } = await calculateHoursWorkedToday(userId);

        console.log(`DEBUG: Resetting range from ${virtualMidnight.toISOString()} to ${virtualNextDay.toISOString()}`);

        const balanceChangesRes = await db.query(
            "SELECT SUM(balance_change) as total FROM activity_logs WHERE user_id = $1 AND timestamp >= $2 AND timestamp < $3",
            [userId, virtualMidnight, virtualNextDay]
        );
        const totalToUndo = Number.parseInt(String(balanceChangesRes.rows[0]?.total || 0), 10);

        if (totalToUndo !== 0) {
            console.log(`[Dev] Undoing balance change of ${totalToUndo} minutes.`);
            await db.query(
                "UPDATE users SET minutes_balance = minutes_balance - $1 WHERE id = $2",
                [totalToUndo, userId]
            );
        }

        if (sessionStartTime) {
            console.log(`Clearing logs from session start: ${sessionStartTime}`);
            await db.query(
                'DELETE FROM activity_logs WHERE user_id = $1 AND timestamp >= $2',
                [userId, sessionStartTime]
            );
        }

        await db.query(
            'DELETE FROM activity_logs WHERE user_id = $1 AND timestamp >= $2 AND timestamp < $3',
            [userId, virtualMidnight, virtualNextDay]
        );

        const tasksRes = await db.query('SELECT attachments FROM tasks WHERE deleted_at IS NULL AND user_id = $1 AND date = $2', [userId, today]);
        for (const row of tasksRes.rows) {
            let attachments = row.attachments || [];
            if (typeof attachments === 'string') {
                try {
                    attachments = JSON.parse(attachments);
                } catch {
                    attachments = [];
                }
            }
            attachments.forEach(att => deleteFile(att.url));
        }

        await db.query(
            'UPDATE tasks SET deleted_at = NOW() WHERE user_id = $1 AND date = $2',
            [userId, today]
        );

        await db.query(
            'DELETE FROM early_leaves WHERE user_id = $1 AND created_at >= $2 AND created_at < $3',
            [userId, virtualMidnight, virtualNextDay]
        );

        await db.query(
            'UPDATE users SET status = $1, last_heartbeat = NULL, last_overtime_alert = NULL WHERE id = $2',
            ['inactive', userId]
        );

        await scheduler.cancelOvertimeAlert(userId);

        const io = req.app.get('io');
        if (io) {
            io.emit('status_update', { userId, status: 'inactive' });            
            io.emit('activity_logged', { user_id: userId });
            io.to(userId.toString()).emit('balance_update', { user_id: userId });
        }

        res.json({ success: true, message: `Day reset successfully for user ${userId} on ${today}` });
    } catch (err) {
        console.error('Error resetting user day:', err);
        res.status(500).json({ error: 'Server error resetting user day' });
    }
};

const resetBalance = async (req, res) => {
    const userId = req.user.id;
    try {
        console.log(`\n=== DEV: RESETTING BALANCE FOR USER ${userId} ===`);

        await db.query('UPDATE users SET minutes_balance = 0, created_at = $1 WHERE id = $2', [timeService.getNow(), userId]);

        await db.query('DELETE FROM activity_logs WHERE user_id = $1', [userId]);

        const io = req.app.get('io');
        if (io) {
            io.emit('activity_logged', { user_id: userId });
            io.to(userId.toString()).emit('balance_update', { user_id: userId, minutes_balance: 0 });
        }

        res.json({ success: true, message: 'Balance and log history reset successfully' });
    } catch (err) {
        console.error('Error resetting balance:', err);
        res.status(500).json({ error: 'Server error resetting balance' });
    }
};

const testOvertimeAlert = async (req, res) => {
    try {
        await scheduler.checkOvertime(req.app);
        res.json({ success: true, message: 'Overtime check triggered manually. Check server logs and your inbox/WhatsApp.' });
    } catch (err) {
        console.error('Error triggering manual overtime check:', err);
        res.status(500).json({ error: 'Failed to trigger overtime check' });
    }
};

const resetMyLeaves = async (req, res) => {
    const userId = req.user.id;
    try {
        console.log(`\n=== DEV: RESETTING LEAVES FOR USER ${userId} ===`);
        
        await db.query('BEGIN');

        const paidLeavesRes = await db.query(
            'SELECT COUNT(*) as count FROM leaves WHERE user_id = $1 AND status = \'approved\' AND is_paid = true',
            [userId]
        );
        const restoreCount = Number.parseInt(String(paidLeavesRes.rows[0].count || 0), 10);

        if (restoreCount > 0) {
            console.log(`[Dev] Restoring ${restoreCount} paid leave credits to user ${userId}`);
            await db.query(
                'UPDATE users SET paid_leave_balance = paid_leave_balance + $1 WHERE id = $2',
                [restoreCount, userId]
            );
        }

        await db.query('DELETE FROM leaves WHERE user_id = $1', [userId]);

        const balanceRes = await db.query(
            'SELECT paid_leave_balance FROM users WHERE deleted_at IS NULL AND id = $1',
            [userId]
        );

        await db.query('COMMIT');

        const io = req.app.get('io');
        if (io) {
            io.emit('leave_update', { user_id: userId, type: 'deleted_all' });
            io.emit('activity_logged', { user_id: userId });
            io.to(userId.toString()).emit('balance_update', {
                user_id: userId,
                paid_leave_balance: balanceRes.rows[0]?.paid_leave_balance ?? 0,
                type: 'leave_history_reset'
            });
        }

        res.json({ success: true, message: `Your leave history has been reset and ${restoreCount} credits restored.` });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error('Error resetting user leaves:', err);
        res.status(500).json({ error: 'Server error resetting leaves' });
    }
};

const clearMySubmissions = async (req, res) => {
    const userId = req.user.id;

    try {
        const result = await clearUserSubmissions(userId);

        const io = req.app.get('io');
        if (io) {
            io.emit('task_update', {
                type: 'cleared_user_submissions',
                userId,
                affectedDates: result.affectedDates,
                deletedCount: result.deletedTasks
            });
        }

        res.json({
            success: true,
            message: `Cleared ${result.deletedTasks} submission${result.deletedTasks === 1 ? '' : 's'} from your history across all dates`,
            deletedTasks: result.deletedTasks,
            affectedDates: result.affectedDates
        });
    } catch (err) {
        console.error('Error clearing user submissions:', err);
        res.status(500).json({ error: 'Server error clearing submissions' });
    }
};

/**
 * Securely create initial admin user
 * Requires a setup key from environment variable for security
 */
const setupAdmin = async (req, res) => {
    try {
        const { setup_key, username, password } = req.body;

        // Verify setup key matches environment variable
        const expectedKey = process.env.SETUP_KEY;
        if (!expectedKey) {
            return res.status(500).json({ 
                error: 'SETUP_KEY not configured in environment. Please set it in .env file.' 
            });
        }

        if (setup_key !== expectedKey) {
            return res.status(401).json({ error: 'Invalid setup key' });
        }

        // Validate input
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long' });
        }

        // Check if admin already exists
        const existingAdmin = await db.query(
            'SELECT id FROM users WHERE deleted_at IS NULL AND role = $1 LIMIT 1',
            ['admin']
        );

        if (existingAdmin.rows.length > 0) {
            return res.status(400).json({ 
                error: 'Admin user already exists. Cannot create another initial admin.' 
            });
        }

        const bcrypt = require('bcryptjs');
        const salt = await bcrypt.genSalt(12);
        const password_hash = await bcrypt.hash(password, salt);

        // Create admin user
        const result = await db.query(
            'INSERT INTO users (username, password_hash, role, status) VALUES ($1, $2, $3, $4) RETURNING id, username, role',
            [username, password_hash, 'admin', 'active']
        );

        console.log(`[Setup] Initial admin created: ${username}`);

        res.status(201).json({
            message: 'Admin user created successfully',
            user: {
                id: result.rows[0].id,
                username: result.rows[0].username,
                role: result.rows[0].role
            }
        });
    } catch (err) {
        console.error('[Setup] Error creating admin:', err);
        res.status(500).json({ error: 'Server error during admin setup' });
    }
};

module.exports = {
    getTimeTravel,
    setTimeTravel,
    triggerTask,
    resetUserDay,
    resetBalance,
    testOvertimeAlert,
    resetMyLeaves,
    clearMySubmissions,
    setupAdmin
};
