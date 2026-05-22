const db = require('../db');
const timeService = require('../utils/timeService');
const attendanceService = require('../utils/attendanceService');
const { checkOvertime } = require('./overtimeTask');

const getISODate = (date, timezone) => {
    return timeService.getDateStr(date, timezone);
};

const processScheduledActions = async (app) => {
    try {
        const now = timeService.getNow();
        const io = app ? app.get('io') : null;

        const actionsRes = await db.query(
            "SELECT * FROM scheduled_actions WHERE status = 'pending' AND scheduled_at <= $1",
            [now]
        );

        if (actionsRes.rows.length === 0) return;

        console.log(`[Scheduler] Found ${actionsRes.rows.length} pending actions due.`);

        for (const action of actionsRes.rows) {
            try {
                const userId = action.user_id;

                if (action.action_type === 'overtime_alert') {
                    await checkOvertime(app, userId);
                } else if (action.action_type === 'goal_reached_alert') {
                    const userRes = await db.query("SELECT username, contact_number, telegram_chat_id, last_goal_reached_alert, timezone FROM users WHERE id = $1", [userId]);
                    const user = userRes.rows[0];
                    if (user) {
                        const userTz = user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
                        if (user.last_goal_reached_alert && getISODate(user.last_goal_reached_alert) === getISODate(now, userTz)) {
                            await db.query("UPDATE scheduled_actions SET status = 'skipped' WHERE id = $1", [action.id]);
                            continue;
                        }

                        const { totalHours } = await attendanceService.calculateHoursWorkedToday(userId);
                        const settingsRes = await db.query("SELECT value FROM settings WHERE key = 'work_hours'");
                        const standardHours = JSON.parse(settingsRes.rows[0]?.value || '{"standardHours":4}').standardHours || 4;

                        if (totalHours >= (standardHours - 0.01)) {
                            if (user.contact_number) {
                                await require('../utils/whatsappService').sendText(user.contact_number, `🎉 *Goal Reached!* \n\nHello *${user.username}*, \n\nYou have completed your daily goal of *${standardHours}* hours today. \n\nSign out whenever you are ready!`);
                            }
                            if (user.telegram_chat_id) {
                                await require('../utils/telegramService').sendText(user.telegram_chat_id, `🎉 *Goal Reached!* 🎉\n━━━━━━━━━━━━━━━\n\nHello *${user.username}*,\n\nYou have completed your daily goal of *${standardHours}* hours today.\n\nSign out whenever you are ready!`);
                            }
                            await db.query("UPDATE users SET last_goal_reached_alert = $1 WHERE id = $2", [now, userId]);
                        }
                    }
                } else if (!action.action_type || action.action_type === 'task_submission') {
                    const userRes = await db.query("SELECT timezone FROM users WHERE id = $1", [userId]);
                    const userTz = userRes.rows[0]?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
                    const stats = await attendanceService.calculateHoursWorkedToday(userId);
                    const today = stats.coveredDate ? getISODate(stats.coveredDate, userTz) : getISODate(now, userTz);

                    const taskCheck = await db.query('SELECT id, attachments FROM tasks WHERE user_id = $1 AND date = $2', [userId, today]);
                    const attachments = action.attachments ? (typeof action.attachments === 'string' ? JSON.parse(action.attachments) : action.attachments) : [];
                    let finalTask;

                    if (taskCheck.rows.length > 0) {
                        const existing = typeof taskCheck.rows[0].attachments === 'string' ? JSON.parse(taskCheck.rows[0].attachments) : (taskCheck.rows[0].attachments || []);
                        const merged = [...existing, ...attachments];
                        const res = await db.query('UPDATE tasks SET updated_at = $1, attachments = $2 WHERE id = $3 RETURNING *', [now, JSON.stringify(merged), taskCheck.rows[0].id]);
                        finalTask = res.rows[0];
                    } else {
                        const res = await db.query('INSERT INTO tasks (user_id, date, todays_task, attachments, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5) RETURNING *', [userId, today, action.content || '', JSON.stringify(attachments), now]);
                        finalTask = res.rows[0];
                    }

                    if (io) io.emit('task_update', { type: taskCheck.rows.length > 0 ? 'update' : 'submit', task: finalTask, userId });
                    await attendanceService.signOut(userId, { reason: 'Scheduled Auto-Signout', forceTaskCheck: false }, io);
                }

                await db.query("UPDATE scheduled_actions SET status = 'executed' WHERE id = $1", [action.id]);
                if (io) io.emit('schedule_update', { userId, status: 'executed', actionId: action.id });
            } catch (err) {
                console.error(`Failed action ${action.id}:`, err);
                await db.query("UPDATE scheduled_actions SET status = 'failed' WHERE id = $1", [action.id]);
            }
        }
    } catch (error) {
        console.error('[ActionProcessor] Error:', error);
    }
};

module.exports = { processScheduledActions };
