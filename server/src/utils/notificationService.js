const db = require('../db');
const whatsappService = require('./whatsappService');
const telegramService = require('./telegramService');
const aiService = require('./aiService');
const {
    buildEmailDomainPolicyFromConfig,
    isEmailAllowedByPolicy,
    isValidEmail,
    normalizeEmail,
    loadEmailDomainPolicy
} = require('./emailDomainPolicy');

const escapeTelegram = (text) => {
    if (!text) return '';
    return String(text)
        .replace(/_/g, '\\_')
        .replace(/\*/g, '\\*')
        .replace(/\[/g, '\\[');
};

/**
 * Send a consolidated daily summary to admins via multiple channels.
 * This is triggered by the minute-by-minute scheduler.
 */
const sendScheduledAdminNotificationSummary = async (requestedDate = null) => {
    try {
        const timeService = require('./timeService');
        const reportService = require('./reportService');
        const emailService = require('./emailService');

        // 1. Get Settings
        const settingsRes = await db.query("SELECT value FROM settings WHERE key = 'admin_notification_settings'");
        if (settingsRes.rows.length === 0) return null;
        
        const config = JSON.parse(settingsRes.rows[0].value);
        if (!config.enabled) return null;

        // 2. Determine the target date to report on
        let targetDate = requestedDate;
        
        if (!targetDate) {
            try {
                // Check summaries, tasks, AND pending scheduled actions
                const logicalToday = reportService.getLogicalDate(timeService.getNow());
                
                const latestDateRes = await db.query(`
                    SELECT date FROM (
                        SELECT date FROM daily_summaries
                        UNION
                        SELECT date FROM tasks
                        UNION
                        SELECT (scheduled_at::timestamp AT TIME ZONE 'UTC' AT TIME ZONE $1)::date AS date 
                        FROM scheduled_actions 
                        WHERE status = 'pending'
                    ) AS activity
                    WHERE date <= $2::date
                    ORDER BY date DESC
                    LIMIT 1
                `, [config.timezone || 'Asia/Dhaka', logicalToday]);
                
                if (latestDateRes.rows.length > 0) {
                    targetDate = latestDateRes.rows[0].date;
                }
            } catch (e) {
                console.error('[NotificationService] Error determining target date:', e.message);
            }
        }

        if (!targetDate) {
            targetDate = reportService.getLogicalDate(timeService.getNow());
        }

        // Standardize targetDate to YYYY-MM-DD string if it's a Date object
        const finalTargetDateStr = (targetDate instanceof Date) 
            ? targetDate.toISOString().split('T')[0] 
            : (typeof targetDate === 'string' ? targetDate.split('T')[0] : targetDate);

        // --- DUPLICATE CHECK ---
        if (config.lastReportedDate === finalTargetDateStr) {
            console.log(`[NotificationService] Report for ${finalTargetDateStr} already sent. Skipping.`);
            return null;
        }

        // 3. Generate the final Bangla summary (Uses AI)
        const finalBanglaText = await reportService.generateFinalReport(finalTargetDateStr);
        if (!finalBanglaText || finalBanglaText.includes("No reports submitted")) {
            console.log(`[NotificationService] No report content for ${finalTargetDateStr}. Skipping.`);
            return null;
        }

        // 4. Send to Email (if enabled)
        if (config.emailEnabled && config.recipientEmails && config.recipientEmails.length > 0) {
            const emails = config.recipientEmails.filter(e => e && !e.startsWith('!'));
            if (emails.length > 0) {
                const senderRes = await db.query(
                    "SELECT id, full_name, username, email FROM users WHERE deleted_at IS NULL AND (role = 'admin' OR role = 'moderator') ORDER BY id ASC LIMIT 1"
                );
                const senderUser = senderRes.rows.length > 0 ? senderRes.rows[0] : null;
                await emailService.sendDailyReportEmail(emails.join(','), finalBanglaText, finalTargetDateStr, senderUser);
            }
        }

        // 5. Send to WhatsApp
        if (config.whatsappNumbers && config.whatsappNumbers.length > 0) {
            const phones = config.whatsappNumbers.filter(p => !p.startsWith('!'));
            for (const phone of phones) {
                try {
                    await whatsappService.sendText(phone, finalBanglaText);
                } catch (err) {
                    console.error(`[NotificationService] WhatsApp failed for ${phone}:`, err.message);
                }
            }
        }

        // 6. Send to Telegram
        if (config.telegramChatIds && config.telegramChatIds.length > 0) {
            const tgBody = `🎯 *Bangla Daily Work Summary*\n\n${finalBanglaText}`;
            const chats = config.telegramChatIds.filter(c => !c.startsWith('!'));
            const resolvedChatIds = await resolveTelegramChatIds(chats);
            for (const chatId of resolvedChatIds) {
                try {
                    await telegramService.sendText(chatId, tgBody);
                } catch (err) {
                    console.error(`[NotificationService] Telegram failed for ${chatId}:`, err.message);
                }
            }
        }

        console.log(`[NotificationService] Daily automated report processed for ${finalTargetDateStr}.`);
        return finalTargetDateStr;

    } catch (err) {
        console.error('[NotificationService] Error in scheduled summary:', err);
        return null;
    }
};

/**
 * Resolves a list of phone numbers or raw chat IDs into verified Telegram Chat IDs
 */
const resolveTelegramChatIds = async (identifiers, companyId = null) => {
    const resolvedChatIds = new Set();
    const cleanIdentifiers = Array.isArray(identifiers) ? identifiers : identifiers.split(',').map(i => i.trim()).filter(Boolean);
    const usersRes = await db.query(
        `SELECT contact_number, telegram_chat_id
         FROM users
         WHERE telegram_chat_id IS NOT NULL
           AND contact_number IS NOT NULL
           AND (
                ($1::uuid IS NULL AND company_id IS NULL)
                OR company_id = $1::uuid
           )`,
        [companyId]
    );

    for (const phoneOrId of cleanIdentifiers) {
        const normalizedIdentifier = whatsappService.cleanPhoneNumber(phoneOrId);

        if (normalizedIdentifier.length >= 10) {
            const matchedUser = usersRes.rows.find(
                (user) => whatsappService.cleanPhoneNumber(user.contact_number) === normalizedIdentifier
            );

            if (matchedUser?.telegram_chat_id) {
                resolvedChatIds.add(matchedUser.telegram_chat_id);
                continue;
            }
        }
        resolvedChatIds.add(phoneOrId);
    }
    return resolvedChatIds;
};

/**
 * Manually send a report summary to specific Telegram recipients
 */
const sendManualTelegramReport = async (recipients, reportText, date, companyId = null) => {
    const resolvedChatIds = await resolveTelegramChatIds(recipients, companyId);
    const { summarizeToBangla } = require('./aiService');
    const timeService = require('./timeService');

    const todayStr = timeService.getDateStr(timeService.getNow());
    const finalBanglaText = await summarizeToBangla(reportText, date || todayStr);
    const tgBody = `🎯 *Bangla Daily Work Summary*\n\n${finalBanglaText}`;

    for (const chatId of resolvedChatIds) {
        try {
            await telegramService.sendText(chatId, tgBody);
        } catch (err) {
            console.error(`[NotificationService] Manual Telegram failed for ${chatId}:`, err.message);
        }
    }
};

const parseEmailList = (raw) => {
    if (!raw) return [];
    const values = Array.isArray(raw) ? raw : String(raw).split(',');
    return values
        .map((email) => String(email || '').trim())
        .filter((email) => email && !email.startsWith('!'));
};

/**
 * Fetches all admin messaging targets (WhatsApp, Telegram and Email)
 */
const getAdminMessagingTargets = async (options = {}) => {
    const companyId = options.companyId || null;
    const forceEmailRecipients = options.forceEmailRecipients === true;
    const settingsRes = await db.query(
        `SELECT value
         FROM settings
         WHERE key = 'admin_notification_settings'
           AND (company_id = $1::uuid OR company_id IS NULL)
         ORDER BY CASE WHEN company_id = $1::uuid THEN 0 ELSE 1 END
         LIMIT 1`,
        [companyId]
    );
    let whatsappNumbers = [];
    const telegramChatIds = new Set();
    const emailRecipients = [];
    let emailEnabled = true;
    let emailDomainPolicy = buildEmailDomainPolicyFromConfig({});

    if (settingsRes.rows.length > 0) {
        const config = JSON.parse(settingsRes.rows[0].value);
        emailEnabled = forceEmailRecipients ? true : (config.emailEnabled !== false);
        emailDomainPolicy = buildEmailDomainPolicyFromConfig(config);
        
        if (config.whatsappNumbers) {
            const rawNumbers = Array.isArray(config.whatsappNumbers)
                ? config.whatsappNumbers
                : config.whatsappNumbers.split(',').map((n) => n.trim()).filter(Boolean);
            rawNumbers.filter(n => !n.startsWith('!')).forEach(n => whatsappNumbers.push(n));
        }

        if (config.telegramChatIds) {
            const rawChatIds = Array.isArray(config.telegramChatIds)
                ? config.telegramChatIds
                : String(config.telegramChatIds).split(',').map((c) => c.trim()).filter(Boolean);
            const chats = rawChatIds.filter(c => !String(c).startsWith('!'));
            const resolvedIds = await resolveTelegramChatIds(chats, companyId);
            resolvedIds.forEach((id) => telegramChatIds.add(id));
        }

        if ((emailEnabled || forceEmailRecipients) && config.recipientEmails) {
            parseEmailList(config.recipientEmails).forEach((email) => emailRecipients.push(email));
        }
    }

    const adminDetailsRes = await db.query(
        `SELECT telegram_chat_id, email
         FROM users
         WHERE LOWER(role) IN ('admin', 'company_admin')
           AND (telegram_chat_id IS NOT NULL OR email IS NOT NULL)
           AND (
                ($1::uuid IS NULL AND company_id IS NULL)
                OR company_id = $1::uuid
           )`,
        [companyId]
    );
    adminDetailsRes.rows.forEach((row) => {
        if (row.telegram_chat_id) telegramChatIds.add(row.telegram_chat_id);
        if ((emailEnabled || forceEmailRecipients) && row.email) emailRecipients.push(row.email);
    });

    const dedupedEmails = [];
    const seenEmails = new Set();
    for (const rawEmail of emailRecipients) {
        const normalized = normalizeEmail(rawEmail);
        if (!normalized || seenEmails.has(normalized)) continue;
        if (!isValidEmail(normalized)) continue;
        if (!isEmailAllowedByPolicy(normalized, emailDomainPolicy)) continue;
        seenEmails.add(normalized);
        dedupedEmails.push(rawEmail.trim());
    }

    return {
        whatsappNumbers: Array.from(new Set(whatsappNumbers.map((n) => whatsappService.cleanPhoneNumber(n)).filter(Boolean))),
        telegramChatIds: Array.from(telegramChatIds),
        emailRecipients: dedupedEmails
    };
};

/**
 * Notifies admins via Telegram when an employee starts working and shares their location.
 */
const sendEmployeeLocationNotification = async (user, location, options = {}) => {
    if (!location || !location.latitude || !location.longitude) return [];

    try {
        const targets = await getAdminMessagingTargets({ companyId: user.company_id });
        if (targets.telegramChatIds.length === 0) return [];

        const { full_name, username } = user;
        const employeeName = full_name || username;
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const message = `📍 *Employee Location Shared*\n\n*Employee:* ${employeeName}\n*Time:* ${now}\n*Status:* Working${options.live_period ? '\n*(Live tracking active)*' : ''}`;

        const results = [];
        for (const chatId of targets.telegramChatIds) {
            try {
                await telegramService.sendText(chatId, message);
                const mapMsg = await telegramService.sendLocation(chatId, location.latitude, location.longitude, options);
                if (mapMsg) {
                    results.push({ chatId, messageId: mapMsg.message_id });
                }
            } catch (err) {
                console.error(`[NotificationService] Location notification failed for ${chatId}:`, err.message);
            }
        }
        return results;
    } catch (err) {
        console.error('[NotificationService] Error in employee location notification:', err);
        return [];
    }
};

/**
 * Notifies employees via Telegram when a task is assigned to them.
 */
const sendTaskAssignmentNotification = async (taskId, assigneeIds, assignerUserId) => {
    if (!taskId || !assigneeIds || !Array.isArray(assigneeIds) || assigneeIds.length === 0) return;

    try {
        // 1. Fetch Task and Assigner Details
        const taskRes = await db.query(
            `SELECT t.title, t.description, t.priority, u.full_name, u.username
             FROM project_tasks t
             LEFT JOIN users u ON u.id = $2
             WHERE t.id = $1`,
            [taskId, assignerUserId]
        );
        
        if (taskRes.rows.length === 0) return;
        const task = taskRes.rows[0];
        const assignerName = task.full_name || task.username || 'Admin';

        // 2. Fetch Telegram Chat IDs for all assignees
        const usersRes = await db.query(
            'SELECT id, telegram_chat_id, username, full_name FROM users WHERE deleted_at IS NULL AND id = ANY($1) AND telegram_chat_id IS NOT NULL',
            [assigneeIds]
        );

        if (usersRes.rows.length === 0) return;

        // 3. Filter out the assigner (if they are in the list)
        const recipients = usersRes.rows.filter(u => Number(u.id) !== Number(assignerUserId));
        if (recipients.length === 0) return;

        const priorityEmoji = {
            'low': '🔵',
            'medium': '🟡',
            'high': '🟠',
            'urgent': '🔴'
        }[task.priority?.toLowerCase()] || '⚪';

        const escapedTitle = escapeTelegram(task.title);
        const escapedDescription = escapeTelegram(task.description || 'No description provided.');
        const escapedAssignerName = escapeTelegram(assignerName);

        const message = `🧩 *New Task Assigned*\n\n` +
            `*Assigned By:* ${escapedAssignerName}\n` +
            `*Priority:* ${priorityEmoji} ${String(task.priority || 'medium').toUpperCase()}\n` +
            `*Title:* ${escapedTitle}\n\n` +
            `*Description:*\n${escapedDescription}`;

        // 4. Send notifications
        for (const user of recipients) {
            try {
                await telegramService.sendText(user.telegram_chat_id, message);
                console.log(`[NotificationService] Task assignment notification sent to ${user.full_name || user.username} (${user.telegram_chat_id})`);
            } catch (tgErr) {
                console.error(`[NotificationService] Failed to send Telegram to ${user.username}:`, tgErr.message);
            }
        }
    } catch (err) {
        console.error('[NotificationService] Task assignment notification failed:', err);
    }
};

/**
 * Fetches all moderator/PM messaging targets
 */
const getModeratorMessagingTargets = async (options = {}) => {
    const companyId = options.companyId || null;
    const telegramChatIds = new Set();
    const rawEmailRecipients = [];

    const modDetailsRes = await db.query(
        `SELECT telegram_chat_id, email
         FROM users
         WHERE LOWER(role) IN ('moderator', 'project_manager')
           AND (telegram_chat_id IS NOT NULL OR email IS NOT NULL)
           AND (
                ($1::uuid IS NULL AND company_id IS NULL)
                OR company_id = $1::uuid
           )`,
        [companyId]
    );

    modDetailsRes.rows.forEach((row) => {
        if (row.telegram_chat_id) telegramChatIds.add(row.telegram_chat_id);
        if (row.email) rawEmailRecipients.push(row.email);
    });

    const policy = await loadEmailDomainPolicy(db, companyId);
    const dedupedEmails = [];
    const seenEmails = new Set();
    for (const rawEmail of rawEmailRecipients) {
        const normalized = normalizeEmail(rawEmail);
        if (!normalized || seenEmails.has(normalized)) continue;
        if (!isValidEmail(normalized)) continue;
        if (!isEmailAllowedByPolicy(normalized, policy)) continue;
        seenEmails.add(normalized);
        dedupedEmails.push(rawEmail.trim());
    }

    return {
        telegramChatIds: Array.from(telegramChatIds),
        emailRecipients: dedupedEmails
    };
};

module.exports = {
    sendScheduledAdminNotificationSummary,
    resolveTelegramChatIds,
    sendManualTelegramReport,
    getAdminMessagingTargets,
    getModeratorMessagingTargets,
    sendEmployeeLocationNotification,
    sendTaskAssignmentNotification,
    escapeTelegram
};
