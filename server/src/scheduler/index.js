const cron = require('node-cron');
const db = require('../db');
const cleanupTask = require('./cleanupTask');
const overtimeTask = require('./overtimeTask');
const actionProcessor = require('./actionProcessor');
const subscriptionReminderTask = require('./subscriptionReminderTask');
const { inactivityQueue, leaveBalanceQueue, isRedisEnabled } = require('./queue');
const { startWorkers } = require('./worker');

/**
 * Initialize all scheduled tasks
 */
const init = (app) => {
    // 1. Attachment Cleanup
    cleanupTask.schedule();

    // 3. Missed Workday Check (Daily at 1:00 AM)
    cron.schedule('0 1 * * *', () => {
        const { checkMissedWorkdays } = require('./index');
        checkMissedWorkdays(app);
    });

    // 4. Scheduled Action Processor (Every minute)
    cron.schedule('* * * * *', () => {
        actionProcessor.processScheduledActions(app);
        const { checkAdminSummary } = require('./index');
        checkAdminSummary(app);
        subscriptionReminderTask.checkSubscriptionReminders().catch((err) => {
            console.error('[Scheduler] Subscription reminder check failed:', err?.message || err);
        });
    });

    // 5. Daily missed workday check at midnight (Backup)
    cron.schedule('5 0 * * *', () => {
        const { checkMissedWorkdays } = require('./index');
        checkMissedWorkdays(app);
    });

    // Start BullMQ background workers only when Redis is configured.
    if (isRedisEnabled) {
        startWorkers();
    } else {
        console.warn('[Scheduler] BullMQ workers are disabled because REDIS_URL is not configured.');
    }

    // 6. Inactivity termination sweep (Daily at 2:30 AM)
    cron.schedule('30 2 * * *', () => {
        if (!inactivityQueue) return;
        inactivityQueue.add('terminateInactive', {});
    });

    // 7. Yearly Paid Leave Reset (00:00 Jan 1st)
    cron.schedule('0 0 1 1 *', () => {
        if (!leaveBalanceQueue) return;
        leaveBalanceQueue.add('resetLeaveBalance', {});
    });
};

/**
 * Reload settings-dependent tasks
 */
const reload = () => {
    cleanupTask.schedule();
};

const checkMissedWorkdays = async (app) => {
    try {
        const db = require('../db');
        const attendanceService = require('../utils/attendanceService');
        const io = app ? app.get('io') : null;
        console.log('[Scheduler] Running daily missed workday check...');
        const usersRes = await db.query("SELECT id FROM users WHERE role = 'employee'");
        for (const user of usersRes.rows) {
            await attendanceService.processMissedDays(user.id, io);
        }
    } catch (error) {
        console.error('[Scheduler] Error in checkMissedWorkdays:', error);
    }
};

const checkAdminSummary = async (app) => {
    try {
        const db = require('../db');
        const attendanceService = require('../utils/attendanceService');
        const notificationService = require('../utils/notificationService');
        const timeService = require('../utils/timeService');
        const { format: formatTz } = require('date-fns-tz');

        const settingsRes = await db.query("SELECT value FROM settings WHERE key = 'admin_notification_settings'");
        if (settingsRes.rows.length === 0) return;
        
        const config = JSON.parse(settingsRes.rows[0].value);
        if (!config.enabled) return;

        // Extract schedule time (Support both HH:mm string and legacy hour/minute fields)
        let scheduleTime = config.scheduleTime;
        if (!scheduleTime && config.hour !== undefined && config.minute !== undefined) {
            scheduleTime = `${config.hour.toString().padStart(2, '0')}:${config.minute.toString().padStart(2, '0')}`;
        }

        if (!scheduleTime) return;

        const now = timeService.getNow();
        const timezone = config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const todayStr = timeService.getDateStr(now);
        
        // 1. Skip if already sent purely for TODAY (execution check)
        if (config.lastSentDate === todayStr) return;

        // 2. Skip if TODAY is an OFF DAY (Strict requirement)
        const { settings, holidays } = await attendanceService.getAttendanceSettings();
        if (!attendanceService.isWorkDay(now, settings, holidays)) {
             return;
        }

        // 3. Check if current time matches scheduled time
        const currentTimeStr = formatTz(now, 'HH:mm', { timeZone: timezone });
        
        if (currentTimeStr === scheduleTime) {
            console.log(`[Scheduler] 🕒 MATCH: Current time ${currentTimeStr} (${timezone}) matches schedule ${scheduleTime}. Triggering summary...`);
            
            // 4. Trigger notification and get the date that was actually reported
            const processedDate = await notificationService.sendScheduledAdminNotificationSummary();
            
            // 5. If a report was actually sent, update settings
            if (processedDate) {
                // Check if this date was already reported
                if (config.lastReportedDate === processedDate) {
                    console.log(`[Scheduler] Report for ${processedDate} was already sent previously. Skipping duplicate.`);
                } else {
                    config.lastReportedDate = processedDate;
                }
            }

            // Always update lastSentDate to avoid multiple triggers in the same minute
            config.lastSentDate = todayStr;
            await db.query("UPDATE settings SET value = $1 WHERE key = 'admin_notification_settings'", [JSON.stringify(config)]);
        }

    } catch (error) {
        console.error('[Scheduler] Error in checkAdminSummary:', error);
    }
};

module.exports = {
    init,
    reload,
    checkMissedWorkdays,
    checkAdminSummary,
    checkSubscriptionReminders: subscriptionReminderTask.checkSubscriptionReminders,
    ...overtimeTask,
    checkAttachmentExpiration: cleanupTask.checkAttachmentExpiration
};
