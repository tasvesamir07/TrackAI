const db = require('../db');
const timeService = require('../utils/timeService');
const attendanceService = require('../utils/attendanceService');

const checkOvertime = async (app, userId) => {
    try {
        const io = app ? app.get('io') : null;
        const settingsRes = await db.query("SELECT value FROM settings WHERE key = 'overtime_settings'");
        if (settingsRes.rows.length === 0) return;

        const settings = JSON.parse(settingsRes.rows[0].value);
        if (!settings.enabled || !settings.threshold) return;

        const thresholdHours = parseFloat(settings.threshold);

        let query = "SELECT u.id, u.username, u.email, u.contact_number, u.telegram_chat_id, u.status, t.name as company_name FROM users u LEFT JOIN tenants t ON t.id = u.company_id WHERE u.role = 'employee' AND u.status IN ('active', 'working', 'break')";
        let params = [];
        if (userId) {
            query += " AND id = $1";
            params.push(userId);
        }

        const usersRes = await db.query(query, params);
        const users = usersRes.rows;

        for (const user of users) {
            const { currentSessionHours, sessionStartTime } = await attendanceService.calculateHoursWorkedToday(user.id);
            if (currentSessionHours === 0) continue;

            const alertRes = await db.query("SELECT last_overtime_alert FROM users WHERE id = $1", [user.id]);
            const lastAlert = alertRes.rows[0]?.last_overtime_alert;

            const now = timeService.getNow();
            if (lastAlert && sessionStartTime) {
                if (new Date(lastAlert) >= new Date(sessionStartTime)) continue;
            }

            if (currentSessionHours >= (thresholdHours - 0.01)) {
                let alertSent = false;
                if (user.email) {
                    try {
                        await require('../utils/emailService').sendOvertimeAlertEmail(user.email, user.username, currentSessionHours, thresholdHours);
                        alertSent = true;
                    } catch (err) { console.error(`Error sending overtime email to ${user.username}:`, err); }
                }
                if (user.contact_number) {
                    try {
                        const whatsappService = require('../utils/whatsappService');
                        const msg = `⏰ *Time to Rest!* \n\nHello *${user.username}*, \n\nYou have been working for *${currentSessionHours.toFixed(1)}* hours continuously. The limit is ${thresholdHours} hours. \n\nPlease consider signing out and taking a break. \n\nDaily Task System`;
                        await whatsappService.sendText(user.contact_number, msg);
                        alertSent = true;
                    } catch (err) { console.error(`Error sending overtime WhatsApp to ${user.username}:`, err); }
                }
                if (user.telegram_chat_id) {
                    try {
                        const telegramService = require('../utils/telegramService');
                        const msg = `🚨 *Time to Rest!* 🚨\n━━━━━━━━━━━━━━━\n\nHello *${user.username}*,\n\nYou have been working for *${currentSessionHours.toFixed(1)}* hours continuously. The standard limit is *${thresholdHours}* hours.\n\nPlease consider signing out and taking a break.\n\n_— ${user.company_name || 'Daily Task Team'}_`;
                        await telegramService.sendText(user.telegram_chat_id, msg);
                        alertSent = true;
                    } catch (err) { console.error(`Error sending overtime Telegram to ${user.username}:`, err); }
                }
                if (io) {
                    io.emit('overtime_alert', { userId: user.id, username: user.username, currentHours: currentSessionHours, thresholdHours: thresholdHours });
                }
                if (alertSent) {
                    await db.query("UPDATE users SET last_overtime_alert = $1 WHERE id = $2", [now, user.id]);
                }
            }
        }
    } catch (error) {
        console.error('Error in overtime checker:', error);
    }
};

const scheduleOvertimeAlert = async (userId, targetTime) => {
    try {
        await cancelOvertimeAlert(userId);
        await db.query(
            "INSERT INTO scheduled_actions (user_id, scheduled_at, action_type, status) VALUES ($1, $2, $3, $4)",
            [userId, targetTime, 'overtime_alert', 'pending']
        );
    } catch (err) {
        console.error(`[Scheduler] Failed to schedule overtime alert for user ${userId}:`, err);
    }
};

const cancelOvertimeAlert = async (userId) => {
    try {
        await db.query(
            "UPDATE scheduled_actions SET status = 'cancelled' WHERE user_id = $1 AND action_type = 'overtime_alert' AND status = 'pending'",
            [userId]
        );
    } catch (err) {
        console.error(`[Scheduler] Failed to cancel overtime alert for user ${userId}:`, err);
    }
};

const scheduleDailyGoalAlert = async (userId, targetTime) => {
    try {
        await cancelDailyGoalAlert(userId);
        await db.query(
            "INSERT INTO scheduled_actions (user_id, scheduled_at, action_type, status) VALUES ($1, $2, $3, $4)",
            [userId, targetTime, 'goal_reached_alert', 'pending']
        );
    } catch (err) {
        console.error(`[Scheduler] Failed to schedule daily goal alert for user ${userId}:`, err);
    }
};

const cancelDailyGoalAlert = async (userId) => {
    try {
        await db.query(
            "UPDATE scheduled_actions SET status = 'cancelled' WHERE user_id = $1 AND action_type = 'goal_reached_alert' AND status = 'pending'",
            [userId]
        );
    } catch (err) {
        console.error(`[Scheduler] Failed to cancel daily goal alert for user ${userId}:`, err);
    }
};

module.exports = {
    checkOvertime,
    scheduleOvertimeAlert,
    cancelOvertimeAlert,
    scheduleDailyGoalAlert,
    cancelDailyGoalAlert
};
