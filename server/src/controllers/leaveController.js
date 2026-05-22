const db = require('../db');
const whatsappService = require('../utils/whatsappService');
const { getAdminMessagingTargets, getModeratorMessagingTargets } = require('../utils/notificationService');
const emailService = require('../utils/emailService');
const { runInBackground } = require('../utils/background');
const VALID_LEAVE_TYPES = ['paid', 'unpaid'];
let leaveWorkflowSchemaReady = false;
let leaveWorkflowSchemaPromise = null;

const ensureLeaveWorkflowSchema = async () => {
    if (leaveWorkflowSchemaReady) return;
    if (leaveWorkflowSchemaPromise) {
        await leaveWorkflowSchemaPromise;
        return;
    }

    leaveWorkflowSchemaPromise = (async () => {
        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='leaves' AND column_name='is_paid'
                ) THEN
                    ALTER TABLE leaves ADD COLUMN is_paid BOOLEAN DEFAULT FALSE;
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='leaves' AND column_name='leave_type'
                ) THEN
                    ALTER TABLE leaves ADD COLUMN leave_type TEXT DEFAULT 'unpaid';
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='leaves' AND column_name='request_id'
                ) THEN
                    ALTER TABLE leaves ADD COLUMN request_id TEXT;
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='leaves' AND column_name='handled_by'
                ) THEN
                    ALTER TABLE leaves ADD COLUMN handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='leaves' AND column_name='handled_at'
                ) THEN
                    ALTER TABLE leaves ADD COLUMN handled_at TIMESTAMP;
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='leaves' AND column_name='handled_by_name'
                ) THEN
                    ALTER TABLE leaves ADD COLUMN handled_by_name TEXT;
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='leaves' AND column_name='moderator_status'
                ) THEN
                    ALTER TABLE leaves ADD COLUMN moderator_status TEXT DEFAULT 'pending';
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='leaves' AND column_name='moderated_by'
                ) THEN
                    ALTER TABLE leaves ADD COLUMN moderated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='leaves' AND column_name='moderated_at'
                ) THEN
                    ALTER TABLE leaves ADD COLUMN moderated_at TIMESTAMP;
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='leaves' AND column_name='covered_by_date'
                ) THEN
                    ALTER TABLE leaves ADD COLUMN covered_by_date DATE;
                END IF;
            END $$;
        `);

        await db.query(`
            UPDATE leaves
            SET
                moderator_status = COALESCE(moderator_status, 'pending'),
                is_paid = COALESCE(is_paid, FALSE),
                leave_type = COALESCE(leave_type, 'unpaid')
            WHERE moderator_status IS NULL OR is_paid IS NULL OR leave_type IS NULL
        `);

        leaveWorkflowSchemaReady = true;
    })();

    try {
        await leaveWorkflowSchemaPromise;
    } finally {
        leaveWorkflowSchemaPromise = null;
    }
};

const resolveRequesterCompanyId = async (userId, companyIdFromToken, queryClient = db) => {
    if (companyIdFromToken) return companyIdFromToken;
    if (!userId) return null;

    const requesterRes = await queryClient.query(
        'SELECT company_id FROM users WHERE deleted_at IS NULL AND id = $1 LIMIT 1',
        [userId]
    );
    return requesterRes.rows[0]?.company_id || null;
};

const rollbackQuietly = async (client) => {
    try {
        await client.query('ROLLBACK');
    } catch (_err) {
        // Ignore rollback errors when transaction is already closed.
    }
};

const resolveActorDisplayName = async (userLike = {}, queryable = db) => {
    const userId = userLike?.id || null;
    if (userId) {
        try {
            const actorRes = await queryable.query(
                'SELECT full_name, username FROM users WHERE deleted_at IS NULL AND id = $1 LIMIT 1',
                [userId]
            );
            const actor = actorRes.rows[0];
            const fullName = String(actor?.full_name || '').trim();
            if (fullName) return fullName;
            const username = String(actor?.username || '').trim();
            if (username) return username;
        } catch (err) {
            console.warn('[LeaveController] Failed to resolve actor display name:', err.message);
        }
    }

    return String(userLike?.full_name || userLike?.username || 'System').trim() || 'System';
};

const createHttpError = (statusCode, message) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const reverseAbsenceDeductionForLeaveDate = async (client, userId, leaveDate) => {
    if (!userId || !leaveDate) return 0;

    const deductionsRes = await client.query(
        `SELECT id, COALESCE(balance_change, 0)::int AS balance_change
         FROM activity_logs
         WHERE user_id = $1
           AND activity_type = 'absence_deduction'
           AND COALESCE(balance_change, 0) < 0
           AND (
                covered_date = $2::date
                OR timestamp::date = $2::date
           )
         FOR UPDATE`,
        [userId, leaveDate]
    );

    if (deductionsRes.rows.length === 0) return 0;

    const restoreMinutes = deductionsRes.rows.reduce(
        (sum, row) => sum + Math.abs(Number(row.balance_change || 0)),
        0
    );

    if (restoreMinutes <= 0) return 0;

    const deductionIds = deductionsRes.rows.map((row) => Number(row.id)).filter(Number.isFinite);
    if (deductionIds.length > 0) {
        await client.query(
            'DELETE FROM activity_logs WHERE id = ANY($1::int[])',
            [deductionIds]
        );
    }

    await client.query(
        'UPDATE users SET minutes_balance = COALESCE(minutes_balance, 0) + $1 WHERE id = $2',
        [restoreMinutes, userId]
    );

    return restoreMinutes;
};

const normalizeLeaveDateValue = (value) => {
    if (!value) return null;

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
        if (ymdMatch) {
            return new Date(Number(ymdMatch[1]), Number(ymdMatch[2]) - 1, Number(ymdMatch[3]), 12, 0, 0, 0);
        }

        const parsed = new Date(trimmed);
        if (!Number.isNaN(parsed.getTime())) {
            return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0, 0);
        }
    }

    return null;
};

const buildLeaveDateRangeLabel = (leaveDates) => {
    const normalizedDates = (Array.isArray(leaveDates) ? leaveDates : [])
        .map((value) => normalizeLeaveDateValue(value))
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime());

    if (normalizedDates.length === 0) {
        return 'Unknown dates';
    }

    const startObj = normalizedDates[0];
    const endObj = normalizedDates[normalizedDates.length - 1];
    const formatMonthDay = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toLowerCase();
    const monthsSame = startObj.getMonth() === endObj.getMonth() && startObj.getFullYear() === endObj.getFullYear();

    if (normalizedDates.length === 1) {
        return formatMonthDay(startObj);
    }

    if (monthsSame) {
        return `${startObj.getDate()}-${endObj.getDate()} ${startObj.toLocaleDateString('en-GB', { month: 'short' }).toLowerCase()}`;
    }

    return `${formatMonthDay(startObj)} - ${formatMonthDay(endObj)}`;
};



const getLeaveRequestContextByRequestId = async (queryable, requestId, expectedCompanyId = null) => {
    const result = await queryable.query(
        `SELECT l.request_id, l.leave_date, l.leave_type, l.reason, l.user_id, u.username, u.full_name
         FROM leaves l
         JOIN users u ON l.user_id = u.id
         WHERE l.request_id = $1
           AND (
                ($2::uuid IS NULL AND u.company_id IS NULL)
                OR u.company_id = $2::uuid
           )
         ORDER BY l.leave_date ASC`,
        [requestId, expectedCompanyId]
    );

    if (result.rows.length === 0) {
        return null;
    }

    return {
        requestId,
        userId: result.rows[0].user_id,
        employeeName: result.rows[0].full_name || result.rows[0].username,
        username: result.rows[0].username,
        full_name: result.rows[0].full_name,
        leaveType: result.rows[0].leave_type || 'unpaid',
        reason: result.rows[0].reason || '',
        leaveDates: result.rows.map((row) => row.leave_date)
    };
};

const getLeaveRequestRowsByIdentifier = async (queryable, identifier, expectedCompanyId = null) => {
    const directRes = await queryable.query(
        `SELECT
            l.id,
            l.request_id,
            l.leave_date,
            l.leave_type,
            l.reason,
            l.user_id,
            l.status,
            l.handled_by_name,
            handler.username AS handled_by_username,
            u.username,
            u.full_name
         FROM leaves l
         JOIN users u ON l.user_id = u.id
         LEFT JOIN users handler ON handler.id = l.handled_by
         WHERE l.request_id = $1
           AND (
                ($2::uuid IS NULL AND u.company_id IS NULL)
                OR u.company_id = $2::uuid
           )
         ORDER BY l.leave_date ASC`,
        [identifier, expectedCompanyId]
    );

    if (directRes.rows.length > 0) {
        return directRes.rows;
    }

    const fallbackRes = await queryable.query(
        `SELECT
            l.id,
            l.request_id,
            l.leave_date,
            l.leave_type,
            l.reason,
            l.user_id,
            l.status,
            l.handled_by_name,
            handler.username AS handled_by_username,
            u.username,
            u.full_name
         FROM leaves l
         JOIN users u ON l.user_id = u.id
         LEFT JOIN users handler ON handler.id = l.handled_by
         WHERE l.id::text = $1
           AND (
                ($2::uuid IS NULL AND u.company_id IS NULL)
                OR u.company_id = $2::uuid
           )
         ORDER BY l.leave_date ASC`,
        [identifier, expectedCompanyId]
    );

    return fallbackRes.rows;
};

const buildLeaveResolutionSummary = ({ actorName, employeeName, leaveType, leaveDates, status }) => {
    const duration = leaveDates.length;
    const dateRangeStr = buildLeaveDateRangeLabel(leaveDates);
    const normalizedActor = actorName || 'An admin';
    const normalizedEmployee = employeeName || 'Employee';
    const normalizedType = leaveType || 'unpaid';
    const normalizedStatus = status === 'approved' ? 'approved' : 'rejected';
    const emoji = normalizedStatus === 'approved' ? '✅' : '❌';
    const title = normalizedStatus === 'approved' ? 'APPROVED' : 'REJECTED';

    return {
        actorName: normalizedActor,
        employeeName: normalizedEmployee,
        leaveType: normalizedType,
        leaveDates,
        duration,
        dateRangeStr,
        status: normalizedStatus,
        plainText: `${normalizedActor} has ${normalizedStatus} the leave request for ${normalizedEmployee} for ${duration} ${duration === 1 ? 'day' : 'days'} (${dateRangeStr}).`,
        telegramText: `${emoji} *Leave Request ${title}*\n*Admin:* ${normalizedActor}\n*Employee:* ${normalizedEmployee}\n*Days:* ${dateRangeStr} (${duration} ${duration === 1 ? 'Day' : 'Days'})\n*Type:* ${normalizedType}`
    };
};

const notifyAdminsAboutLeaveResolution = async ({
    actorName,
    actorUserId = null,
    actorEmail = null,
    actorTelegramChatId = null,
    actorWhatsAppNumber = null,
    employeeName,
    leaveType,
    leaveDates,
    status,
    companyId = null,
    excludeTelegramChatIds = [],
    excludeWhatsAppNumbers = []
}) => {
    const summary = buildLeaveResolutionSummary({ actorName, employeeName, leaveType, leaveDates, status });

    runInBackground(async () => {
        try {
            const targets = await getAdminMessagingTargets({ forceEmailRecipients: true, companyId });
            const moderatorTargets = await getModeratorMessagingTargets({ companyId });
            const excludedTelegram = new Set(excludeTelegramChatIds.map(String));
            const excludedWhatsApp = new Set(excludeWhatsAppNumbers.map((n) => whatsappService.cleanPhoneNumber(n)).filter(Boolean));
            const excludedEmails = new Set();
            let senderUser = null;

            const explicitActorEmail = String(actorEmail || '').trim().toLowerCase();
            if (explicitActorEmail) excludedEmails.add(explicitActorEmail);

            const explicitActorTelegram = String(actorTelegramChatId || '').trim();
            if (explicitActorTelegram) excludedTelegram.add(explicitActorTelegram);

            const explicitActorWhatsApp = whatsappService.cleanPhoneNumber(actorWhatsAppNumber || '');
            if (explicitActorWhatsApp) excludedWhatsApp.add(explicitActorWhatsApp);

            if (actorUserId) {
                try {
                    const actorRes = await db.query(
                        'SELECT full_name, username, email, contact_number, telegram_chat_id FROM users WHERE deleted_at IS NULL AND id = $1',
                        [actorUserId]
                    );
                    const currentUser = actorRes.rows[0];
                    if (currentUser) {
                        senderUser = currentUser;
                        const email = String(currentUser.email || '').trim().toLowerCase();
                        if (email) excludedEmails.add(email);
                        const number = whatsappService.cleanPhoneNumber(currentUser.contact_number || '');
                        if (number) excludedWhatsApp.add(number);
                        const tg = String(currentUser.telegram_chat_id || '').trim();
                        if (tg) excludedTelegram.add(tg);
                    }
                } catch (err) {
                    console.warn('Failed to resolve actor email for exclusion:', err.message);
                }
            }

            const notificationPromises = [];
            const combinedTelegramTargets = Array.from(new Set([
                ...(Array.isArray(targets.telegramChatIds) ? targets.telegramChatIds : []),
                ...(Array.isArray(moderatorTargets.telegramChatIds) ? moderatorTargets.telegramChatIds : [])
            ]));
            const combinedEmailTargets = Array.from(new Set([
                ...(Array.isArray(targets.emailRecipients) ? targets.emailRecipients : []),
                ...(Array.isArray(moderatorTargets.emailRecipients) ? moderatorTargets.emailRecipients : [])
            ].map((email) => String(email || '').trim()).filter(Boolean)));

            // WhatsApp
            for (const number of targets.whatsappNumbers) {
                if (!excludedWhatsApp.has(number)) {
                    notificationPromises.push(whatsappService.sendText(number, summary.plainText).catch(e => console.error(`WhatsApp fail: ${e.message}`)));
                }
            }

            // Telegram
            if (combinedTelegramTargets.length > 0) {
                const telegramService = require('../utils/telegramService');
                for (const chatId of combinedTelegramTargets) {
                    if (excludedTelegram.has(String(chatId))) continue;
                    notificationPromises.push(telegramService.sendText(chatId, summary.telegramText).catch(e => console.error(`Telegram fail: ${e.message}`)));
                }
            }

            // Email
            if (combinedEmailTargets.length > 0) {
                for (const email of combinedEmailTargets) {
                    const normalized = String(email || '').trim().toLowerCase();
                    if (!normalized || excludedEmails.has(normalized)) continue;
                    notificationPromises.push(emailService.sendLeaveResolutionNotificationEmail(email, {
                        actorName: summary.actorName,
                        employeeName: summary.employeeName,
                        status: summary.status,
                        leaveType: summary.leaveType,
                        dateRangeStr: summary.dateRangeStr,
                        duration: summary.duration
                    }, senderUser).catch(e => console.error(`Email fail: ${e.message}`)));
                }
            }

            await Promise.allSettled(notificationPromises);
        } catch (err) {
            console.error('Background admin notification error:', err);
        }
    });

    return summary;
};

/**
 * Notifies the employee about the resolution or progression of their leave request.
 */
const notifyEmployeeAboutLeaveResolution = async ({ userId, status, moderatorStatus, actedByName, actedByUserId = null, leaveDates }) => {
    runInBackground(async () => {
        try {
            let senderUser = null;
            if (actedByUserId) {
                const actorRes = await db.query(
                    'SELECT full_name, username, email FROM users WHERE deleted_at IS NULL AND id = $1 LIMIT 1',
                    [actedByUserId]
                );
                senderUser = actorRes.rows[0] || null;
            }

            const userRes = await db.query('SELECT telegram_chat_id, email, username, full_name FROM users WHERE deleted_at IS NULL AND id = $1', [userId]);
            const employee = userRes.rows[0];
            if (!employee) return;

            let statusText = '';
            if (status === 'approved') statusText = '✅ Approved by HR';
            else if (status === 'rejected' && moderatorStatus === 'declined') statusText = '❌ Declined by Project Manager';
            else if (status === 'rejected') statusText = '❌ Rejected by HR';
            else if (moderatorStatus === 'proceeded') statusText = '➡️ Proceeded to HR (Waiting final approval)';
            
            if (!statusText) return;

            const dateRangeStr = buildLeaveDateRangeLabel(leaveDates);
            const message = `📋 *Leave Request Update*\n\n` +
                            `Your leave request has been: *${statusText}*\n` +
                            `*Dates:* ${dateRangeStr}\n` +
                            `*Action By:* ${actedByName}`;

            const promises = [];
            if (employee.telegram_chat_id) {
                const telegramService = require('../utils/telegramService');
                promises.push(telegramService.sendText(employee.telegram_chat_id, message).catch(e => console.error(`Employee TG fail: ${e.message}`)));
            }

            if (employee.email) {
                const emailService = require('../utils/emailService');
                promises.push(emailService.sendLeaveResolutionNotificationEmail(employee.email, {
                    actorName: actedByName,
                    employeeName: employee.full_name || employee.username,
                    status,
                    moderatorStatus,
                    leaveType: 'request',
                    dateRangeStr,
                    duration: leaveDates.length
                }, senderUser).catch(e => console.error(`Employee Email fail: ${e.message}`)));
            }
            await Promise.allSettled(promises);
        } catch (err) {
            console.error('Failed to notify employee about leave update:', err);
        }
    });
};

const notifyModeratorsAboutLeaveRequest = async ({ userId, username, leaveDates, reason, leaveType, requestId }) => {
    runInBackground(async () => {
        try {
            const userRes = await db.query('SELECT * FROM users WHERE deleted_at IS NULL AND id = $1', [userId]);
            const user = userRes.rows[0];
            const effectiveUsername = user?.username || username;
            const companyId = user?.company_id || null;

            const targets = await getModeratorMessagingTargets({ companyId });
            
            const dateRangeStr = buildLeaveDateRangeLabel(leaveDates);
            const duration = leaveDates.length;
            const messageBody = `*Leave Request (Pending PM Approval)*\n*Employee:* ${effectiveUsername}\n*Days:* ${dateRangeStr} (${duration} ${duration > 1 ? 'Days' : 'Day'})\n*Type:* ${leaveType}\n*Reason:* ${reason}`;

            const tgInlineKeyboard = [[
                { text: 'Proceed', callback_data: `tg_leave_proceed_${requestId}` },
                { text: 'Decline', callback_data: `tg_leave_decline_${requestId}` }
            ]];

            const promises = [];
            if (targets.telegramChatIds.length > 0) {
                const telegramService = require('../utils/telegramService');
                for (const chatId of targets.telegramChatIds) {
                    promises.push(telegramService.sendInlineKeyboard(chatId, messageBody, tgInlineKeyboard).catch(e => console.error(`Mod TG fail: ${e.message}`)));
                }
            }

            if (targets.emailRecipients.length > 0) {
                for (const email of targets.emailRecipients) {
                    promises.push(emailService.sendLeaveNotificationEmail(email, {
                        username: effectiveUsername,
                        department: user?.department,
                        leaveDates,
                        reason,
                        leaveType,
                        duration,
                        dateRangeStr,
                        subjectPrefix: '[PM ACTION REQUIRED]'
                    }, user).catch(e => console.error(`Mod Email fail: ${e.message}`)));
                }
            }
            await Promise.allSettled(promises);
        } catch (err) {
            console.error('Failed to notify moderators about leave request:', err);
        }
    });
};

const notifyAdminsAboutLeaveRequest = async ({ userId, username, leaveDates, reason, leaveType, requestId, proceededBy = null, proceededByUserId = null }) => {
    runInBackground(async () => {
        try {
            const userRes = await db.query('SELECT * FROM users WHERE deleted_at IS NULL AND id = $1', [userId]);
            const user = userRes.rows[0];
            const effectiveUsername = user?.username || username;
            const companyId = user?.company_id || null;
            let senderUser = user;
            if (proceededByUserId) {
                const actorRes = await db.query(
                    'SELECT full_name, username, email FROM users WHERE deleted_at IS NULL AND id = $1 LIMIT 1',
                    [proceededByUserId]
                );
                senderUser = actorRes.rows[0] || user;
            }

            const targets = await getAdminMessagingTargets({ forceEmailRecipients: true, companyId });
            const emailRecipients = Array.isArray(targets.emailRecipients) ? targets.emailRecipients : [];
            
            const dateRangeStr = buildLeaveDateRangeLabel(leaveDates);
            const duration = leaveDates.length;
            const pmInfo = proceededBy ? `\n*Proceeded by PM:* ${proceededBy}` : '';
            const messageBody = `*Leave Request (Proceeded to HR)*${pmInfo}\n*Employee:* ${effectiveUsername}\n*Days:* ${dateRangeStr} (${duration} ${duration > 1 ? 'Days' : 'Day'})\n*Type:* ${leaveType}\n*Reason:* ${reason}`;

            const tgInlineKeyboard = [[
                { text: 'Approve', callback_data: `tg_leave_approve_${requestId}` },
                { text: 'Reject', callback_data: `tg_leave_reject_${requestId}` }
            ]];

            const promises = [];
            if (targets.telegramChatIds.length > 0) {
                const telegramService = require('../utils/telegramService');
                for (const chatId of targets.telegramChatIds) {
                    promises.push(telegramService.sendInlineKeyboard(chatId, messageBody, tgInlineKeyboard).catch(e => console.error(`Admin TG fail: ${e.message}`)));
                }
            }

            if (emailRecipients.length > 0) {
                for (const email of emailRecipients) {
                    promises.push(emailService.sendLeaveNotificationEmail(email, {
                        username: effectiveUsername,
                        department: user?.department,
                        leaveDates,
                        reason,
                        leaveType,
                        duration,
                        dateRangeStr,
                        proceededBy
                    }, senderUser).catch(e => console.error(`Admin Email fail: ${e.message}`)));
                }
            }
            await Promise.allSettled(promises);
        } catch (err) {
            console.error('Failed to notify admins about leave request:', err);
        }
    });
};

const createLeaveRequestInternal = async ({ userId, username, leaveDates, reason, leaveType, io }) => {
    if (!leaveDates || !Array.isArray(leaveDates) || leaveDates.length === 0) {
        throw createHttpError(400, 'Leave dates are required (array)');
    }

    if (!reason || reason.trim() === '') {
        throw createHttpError(400, 'Reason for leave is required');
    }

    if (!VALID_LEAVE_TYPES.includes(leaveType)) {
        throw createHttpError(400, 'Leave type must be either paid or unpaid');
    }

    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        const crypto = require('crypto');
        const requestId = crypto.randomUUID();
        const results = [];

        for (const leaveDate of leaveDates) {
            const result = await client.query(
                'INSERT INTO leaves (user_id, leave_date, reason, request_id, leave_type) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                [userId, leaveDate, reason.trim(), requestId, leaveType]
            );
            results.push(result.rows[0]);
        }

        await client.query('COMMIT');

        if (io) {
            io.emit('leave_update', {
                type: 'new_request_batch',
                leaves: results.map(l => ({ ...l, username })),
                requestId
            });
        }

        await notifyModeratorsAboutLeaveRequest({ userId, username, leaveDates, reason: reason.trim(), leaveType, requestId });

        return { message: 'Leave request submitted', count: results.length, requestId, leaves: results };
    } catch (err) {
        await rollbackQuietly(client);
        if (err.code === '23505') {
            throw createHttpError(400, 'Leave already requested for one of these dates');
        }
        throw err;
    } finally {
        client.release();
    }
};

const applyLeaveStatusChange = async (client, leaveId, status, actedByUserId = null, actedByName = null, expectedCompanyId = null) => {
    const currentLeaveRes = await client.query(
        `SELECT
            status,
            user_id,
            leave_type,
            is_paid,
            request_id,
            handled_by,
            handled_by_name,
            handled_at,
            moderator_status
         FROM leaves l
         JOIN users u ON u.id = l.user_id
         WHERE l.id = $1
           AND (
                ($2::uuid IS NULL AND u.company_id IS NULL)
                OR u.company_id = $2::uuid
           )
         FOR UPDATE`,
        [leaveId, expectedCompanyId]
    );

    if (currentLeaveRes.rows.length === 0) {
        throw createHttpError(404, 'Leave request not found');
    }

    const {
        status: oldStatus,
        user_id: userId,
        leave_type: leaveType,
        is_paid: isPaid,
        handled_by: handledByUserId,
        handled_by_name: handledByName
    } = currentLeaveRes.rows[0];

    let handledByUsername = null;
    if (handledByUserId) {
        const handlerRes = await client.query('SELECT username FROM users WHERE deleted_at IS NULL AND id = $1', [handledByUserId]);
        handledByUsername = handlerRes.rows[0]?.username || null;
    }

    if (oldStatus !== 'pending' && !(['approved', 'working'].includes(oldStatus) && status === 'covered')) {
        const resolvedHandler = handledByName || handledByUsername;
        const handledSuffix = resolvedHandler ? ` by ${resolvedHandler}` : '';
        throw createHttpError(409, `Leave request has already been ${oldStatus}${handledSuffix}`);
    }

    // Safety: If status is being set to approved/rejected by Admin, ensure PM has proceeded (unless it's a PM action)
    // Note: status 'rejected' with moderator_status 'declined' is handled in declineLeaveStatusByRequestId
    if (['approved', 'rejected'].includes(status)) {
        const currentModeratorStatus = currentLeaveRes.rows[0].moderator_status;
        if (currentModeratorStatus !== 'proceeded') {
            throw createHttpError(400, `Cannot ${status} leave request until it has been proceeded by a Project Manager`);
        }
    }

    if (status === 'approved' && oldStatus !== 'approved') {
        if (leaveType === 'paid') {
            const userRes = await client.query('SELECT paid_leave_balance FROM users WHERE deleted_at IS NULL AND id = $1 FOR UPDATE', [userId]);
            const balance = userRes.rows[0]?.paid_leave_balance || 0;

            if (balance < 1) {
                throw createHttpError(400, 'User does not have enough paid leave balance for this request');
            }

            await client.query('UPDATE users SET paid_leave_balance = paid_leave_balance - 1 WHERE id = $1', [userId]);
            await client.query('UPDATE leaves SET is_paid = true WHERE id = $1', [leaveId]);
        } else {
            await client.query('UPDATE leaves SET is_paid = false WHERE id = $1', [leaveId]);
        }
    } else if (status !== 'approved' && oldStatus === 'approved' && isPaid) {
        await client.query('UPDATE users SET paid_leave_balance = paid_leave_balance + 1 WHERE id = $1', [userId]);
        await client.query('UPDATE leaves SET is_paid = false WHERE id = $1', [leaveId]);
    }

    const result = await client.query(
        `UPDATE leaves
         SET status = $1,
             handled_by = $3,
             handled_by_name = $4,
             handled_at = NOW(),
             covered_by_date = CASE 
                WHEN $1 = 'covered' AND covered_by_date IS NULL THEN leave_date
                WHEN $1 = 'approved' THEN NULL
                ELSE covered_by_date
             END
         WHERE id = $2
         RETURNING *`,
        [status, leaveId, actedByUserId, actedByName]
    );

    const updatedLeave = result.rows[0];

    // Retroactive correction: if a past day was deducted as absence before leave approval,
    // restore that deduction so approved leave never counts as missed work.
    if (status === 'approved' && oldStatus !== 'approved') {
        await reverseAbsenceDeductionForLeaveDate(client, userId, updatedLeave.leave_date);
    }

    return updatedLeave;
};

const updateLeaveStatusById = async ({ leaveId, status, io, actedByUserId = null, actedByName = null, excludeTelegramChatIds = [], excludeWhatsAppNumbers = [], expectedCompanyId = null }) => {
    if (!['approved', 'rejected', 'pending', 'covered'].includes(status)) {
        throw createHttpError(400, 'Invalid status');
    }

    const client = await db.getClient();

    try {
        await client.query('BEGIN');
        const currentLeaveRes = await client.query(
            `SELECT l.request_id
             FROM leaves l
             JOIN users u ON u.id = l.user_id
             WHERE l.id = $1
               AND (
                    ($2::uuid IS NULL AND u.company_id IS NULL)
                    OR u.company_id = $2::uuid
               )
             FOR UPDATE`,
            [leaveId, expectedCompanyId]
        );
        if (currentLeaveRes.rows.length === 0) {
            throw createHttpError(404, 'Leave request not found');
        }
        const requestId = currentLeaveRes.rows[0].request_id;
        const context = await getLeaveRequestContextByRequestId(client, requestId, expectedCompanyId);
        const updatedLeave = await applyLeaveStatusChange(client, leaveId, status, actedByUserId, actedByName, expectedCompanyId);
        await client.query('COMMIT');

        const resolutionSummary = await notifyAdminsAboutLeaveResolution({
            actorName: actedByName,
            actorUserId: actedByUserId,
            employeeName: context?.employeeName,
            leaveType: context?.leaveType,
            leaveDates: context?.leaveDates || [updatedLeave.leave_date],
            status,
            companyId: expectedCompanyId,
            excludeTelegramChatIds,
            excludeWhatsAppNumbers
        });

        if (io) {
            io.emit('leave_update', {
                type: 'status_changed',
                leave: updatedLeave,
                newStatus: status,
                actedBy: actedByName || null
            });
        }

        return {
            updatedLeaves: [updatedLeave],
            summary: resolutionSummary
        };
    } catch (err) {
        await rollbackQuietly(client);
        throw err;
    } finally {
        client.release();
    }
};

const updateLeaveStatusByRequestIdInternal = async ({ requestId, status, io, actedByUserId = null, actedByName = null, excludeTelegramChatIds = [], excludeWhatsAppNumbers = [], expectedCompanyId = null }) => {
    if (!['approved', 'rejected', 'pending', 'covered'].includes(status)) {
        throw createHttpError(400, 'Invalid status');
    }

    const client = await db.getClient();

    try {
        await client.query('BEGIN');
        const existingRows = await getLeaveRequestRowsByIdentifier(client, requestId, expectedCompanyId);
        if (existingRows.length === 0) {
            throw createHttpError(404, 'Leave request not found');
        }

        const effectiveRequestId = existingRows[0].request_id;
        const context = {
            requestId: effectiveRequestId,
            userId: existingRows[0].user_id,
            employeeName: existingRows[0].username,
            leaveType: existingRows[0].leave_type || 'unpaid',
            reason: existingRows[0].reason || '',
            leaveDates: existingRows.map((row) => row.leave_date)
        };

        const alreadyHandledRow = existingRows.find((row) => row.status !== 'pending');
        if (alreadyHandledRow) {
            const handledBy = alreadyHandledRow.handled_by_name || alreadyHandledRow.handled_by_username || 'another admin';
            const err = createHttpError(409, `Leave request has already been ${alreadyHandledRow.status} by ${handledBy}`);
            err.summary = buildLeaveResolutionSummary({
                actorName: handledBy,
                employeeName: context.employeeName,
                leaveType: context.leaveType,
                leaveDates: context.leaveDates,
                status: alreadyHandledRow.status
            });
            throw err;
        }

        const leaveIdsRes = await client.query(
            `SELECT l.id, l.moderator_status
             FROM leaves l
             JOIN users u ON u.id = l.user_id
             WHERE l.request_id = $1
               AND (
                    ($2::uuid IS NULL AND u.company_id IS NULL)
                    OR u.company_id = $2::uuid
               )
             ORDER BY l.leave_date ASC
             FOR UPDATE`,
            [effectiveRequestId, expectedCompanyId]
        );

        if (['approved', 'rejected'].includes(status)) {
            const unmoderatedRow = leaveIdsRes.rows.find(row => row.moderator_status !== 'proceeded');
            if (unmoderatedRow) {
                throw createHttpError(400, `This request must be proceeded by a Project Manager first before it can be ${status}`);
            }
        }

        const updatedLeaves = [];
        for (const row of leaveIdsRes.rows) {
            updatedLeaves.push(await applyLeaveStatusChange(client, row.id, status, actedByUserId, actedByName, expectedCompanyId));
        }

        await client.query('COMMIT');

        const resolutionSummary = await notifyAdminsAboutLeaveResolution({
            actorName: actedByName,
            actorUserId: actedByUserId,
            employeeName: context?.employeeName,
            leaveType: context?.leaveType,
            leaveDates: context?.leaveDates || updatedLeaves.map((leave) => leave.leave_date),
            status,
            companyId: expectedCompanyId,
            excludeTelegramChatIds,
            excludeWhatsAppNumbers
        });

        // Notify employee
        await notifyEmployeeAboutLeaveResolution({
            userId: context.userId,
            status,
            moderatorStatus: updatedLeaves[0]?.moderator_status,
            actedByName,
            actedByUserId,
            leaveDates: context.leaveDates
        });

        if (io) {
            updatedLeaves.forEach((leave) => {
                io.emit('leave_update', {
                    type: 'status_changed',
                    leave,
                    newStatus: status,
                    actedBy: actedByName || null
                });
            });
        }

        return {
            updatedLeaves,
            summary: resolutionSummary
        };
    } catch (err) {
        await rollbackQuietly(client);
        throw err;
    } finally {
        client.release();
    }
};

/**
 * PM Action: Proceed leave request to HR
 */
const proceedLeaveStatusByRequestId = async (req, res) => {
    const { requestId } = req.params;
    const companyId = req.user.company_id;
    const actedByUserId = req.user.id;
    const actedByName = await resolveActorDisplayName(req.user);
    const io = req.app.get('io');

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const existingRows = await getLeaveRequestRowsByIdentifier(client, requestId, companyId);
        if (existingRows.length === 0) throw createHttpError(404, 'Leave request not found');

        const alreadyHandled = existingRows.find(r => r.status !== 'pending' || r.moderator_status === 'proceeded');
        if (alreadyHandled) throw createHttpError(409, 'Request already processed');

        const updatedLeaves = [];
        for (const row of existingRows) {
            const result = await client.query(
                `UPDATE leaves SET moderator_status = 'proceeded', moderated_by = $1, moderated_at = NOW() WHERE id = $2 RETURNING *`,
                [actedByUserId, row.id]
            );
            updatedLeaves.push(result.rows[0]);
        }

        await client.query('COMMIT');

        const context = await getLeaveRequestContextByRequestId(db, existingRows[0].request_id, companyId);
        await notifyAdminsAboutLeaveRequest({
            ...context,
            proceededBy: actedByName,
            proceededByUserId: actedByUserId
        });

        // Notify employee
        await notifyEmployeeAboutLeaveResolution({
            userId: context.userId,
            status: 'pending',
            moderatorStatus: 'proceeded',
            actedByName,
            actedByUserId,
            leaveDates: context.leaveDates
        });

        if (io) {
            updatedLeaves.forEach(l => io.emit('leave_update', { type: 'moderator_proceeded', leave: l, actedBy: actedByName }));
        }

        res.json({ message: 'Request proceeded to HR', requestId });
    } catch (err) {
        await rollbackQuietly(client);
        res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
        client.release();
    }
};

/**
 * PM Action: Decline leave request
 */
const declineLeaveStatusByRequestId = async (req, res) => {
    const { requestId } = req.params;
    const companyId = req.user.company_id;
    const actedByUserId = req.user.id;
    const actedByName = await resolveActorDisplayName(req.user);
    const io = req.app.get('io');

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const existingRows = await getLeaveRequestRowsByIdentifier(client, requestId, companyId);
        if (existingRows.length === 0) throw createHttpError(404, 'Leave request not found');

        const alreadyHandled = existingRows.find(r => r.status !== 'pending');
        if (alreadyHandled) throw createHttpError(409, 'Request already processed');

        const updatedLeaves = [];
        for (const row of existingRows) {
            const result = await client.query(
                `UPDATE leaves SET status = 'rejected', moderator_status = 'declined', moderated_by = $1, moderated_at = NOW(), handled_by = $1, handled_by_name = $2, handled_at = NOW() WHERE id = $3 RETURNING *`,
                [actedByUserId, actedByName, row.id]
            );
            updatedLeaves.push(result.rows[0]);
        }

        await client.query('COMMIT');

        const context = await getLeaveRequestContextByRequestId(db, existingRows[0].request_id, companyId);
        
        // Notify employee
        await notifyEmployeeAboutLeaveResolution({
            userId: context.userId,
            status: 'rejected',
            moderatorStatus: 'declined',
            actedByName,
            actedByUserId,
            leaveDates: context.leaveDates
        });

        if (io) {
            updatedLeaves.forEach(l => io.emit('leave_update', { type: 'moderator_declined', leave: l, actedBy: actedByName }));
        }

        res.json({ message: 'Request declined', requestId });
    } catch (err) {
        await rollbackQuietly(client);
        res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
        client.release();
    }
};

/**
 * Request a leave
 */
const requestLeave = async (req, res) => {
    const { leaveDates, reason, leaveType } = req.body; // Expecting array of YYYY-MM-DD
    const userId = req.user.id;

    try {
        const result = await createLeaveRequestInternal({
            userId,
            username: req.user.username,
            leaveDates,
            reason,
            leaveType,
            io: req.app.get('io')
        });
        res.json({ message: result.message, count: result.count, requestId: result.requestId });
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Server error' });
    }
};

/**
 * Get all leaves for current user (all statuses)
 */
const getMyLeaves = async (req, res) => {
    const userId = req.user.id;

    try {
        const attendanceService = require('../utils/attendanceService');
        const { settings } = await attendanceService.getAttendanceSettings();
        const standardHours = settings.standardHours || 4;

        const result = await db.query(
            `SELECT l.*, m.full_name AS moderated_by_name 
             FROM leaves l 
             LEFT JOIN users m ON l.moderated_by = m.id 
             WHERE l.user_id = $1 
             ORDER BY l.leave_date DESC`,
            [userId]
        );

        const leaves = result.rows;
        const leaveQueryDates = leaves.map(l => l.covered_by_date || l.leave_date);
        const workedHoursMap = await attendanceService.getWorkedHoursByDates(userId, leaveQueryDates);

        const enrichedLeaves = leaves.map(l => {
            const dateToUse = l.covered_by_date || l.leave_date;
            const dateStr = require('../utils/timeService').getDateStr(dateToUse);
            return {
                ...l,
                worked_hours: workedHoursMap[dateStr] || 0,
                target_hours: standardHours
            };
        });

        res.json(enrichedLeaves);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

/**
 * Get uncovered (approved) leaves for current user
 */
const getUncoveredLeaves = async (req, res) => {
    const userId = req.user.id;

    try {
        const attendanceService = require('../utils/attendanceService');
        const { settings } = await attendanceService.getAttendanceSettings();
        const standardHours = settings.standardHours || 4;

        const result = await db.query(
            'SELECT * FROM leaves WHERE user_id = $1 AND status = \'approved\' AND covered_by_date IS NULL AND (is_paid IS FALSE OR is_paid IS NULL) ORDER BY leave_date ASC',
            [userId]
        );

        const leaves = result.rows;
        const leaveQueryDates = leaves.map(l => l.covered_by_date || l.leave_date);
        const workedHoursMap = await attendanceService.getWorkedHoursByDates(userId, leaveQueryDates);

        const enrichedLeaves = leaves.map(l => {
            const dateToUse = l.covered_by_date || l.leave_date;
            const dateStr = require('../utils/timeService').getDateStr(dateToUse);
            return {
                ...l,
                worked_hours: workedHoursMap[dateStr] || 0,
                target_hours: standardHours
            };
        });

        res.json(enrichedLeaves);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

/**
 * Cover a leave with a holiday work date (marks as 'working' until sign-out)
 */
const coverLeave = async (req, res) => {
    const { leaveId, holidayDate } = req.body;
    const userId = req.user.id;

    if (!leaveId || !holidayDate) {
        return res.status(400).json({ error: 'Leave ID and holiday date are required' });
    }

    try {
        const statusRes = await db.query('SELECT status FROM users WHERE deleted_at IS NULL AND id = $1', [userId]);
        const currentStatus = statusRes.rows[0]?.status;

        if (currentStatus === 'active' || currentStatus === 'break') {
            return res.status(409).json({ error: 'You are already in a session' });
        }

        const result = await db.query(
            'UPDATE leaves SET covered_by_date = $1, status = \'working\' WHERE id = $2 AND user_id = $3 AND status = \'approved\' RETURNING *',
            [holidayDate, leaveId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Leave request not found or not eligible for cover-up' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

/**
 * Get all leaves (Admin only)
 */
const getAdminLeaves = async (req, res) => {
    try {
        await ensureLeaveWorkflowSchema();
        const requesterCompanyIdRaw = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const requesterCompanyId = requesterCompanyIdRaw ? String(requesterCompanyIdRaw) : null;
        const attendanceService = require('../utils/attendanceService');
        let standardHours = 4;
        try {
            const { settings } = await attendanceService.getAttendanceSettings();
            standardHours = settings?.standardHours || 4;
        } catch (settingsErr) {
            console.error('[Leaves/admin] getAttendanceSettings failed, using defaults:', settingsErr.message || settingsErr);
        }

        let result;
        try {
            result = await db.query(`
            SELECT
                l.*,
                l.leave_date AS start_date,
                l.leave_date AS end_date,
                l.leave_type AS type,
                1 AS days_total,
                u.username,
                u.profile_picture,
                u.full_name,
                m.full_name AS moderated_by_name
            FROM leaves l 
            JOIN users u ON l.user_id = u.id 
            LEFT JOIN users m ON l.moderated_by = m.id
            WHERE (
                ($1::text IS NULL AND u.company_id IS NULL)
                OR u.company_id::text = $1::text
            )
            ORDER BY l.created_at DESC
        `, [requesterCompanyId]);
        } catch (queryErr) {
            console.error('[Leaves/admin] enriched query failed, using fallback:', queryErr.message || queryErr);
            result = await db.query(`
                SELECT
                    l.*,
                    l.leave_date AS start_date,
                    l.leave_date AS end_date,
                    COALESCE(l.leave_type, 'unpaid') AS type,
                    1 AS days_total,
                    u.username,
                    u.profile_picture,
                    u.full_name,
                    NULL::text AS moderated_by_name
                FROM leaves l
                JOIN users u ON l.user_id = u.id
                WHERE (
                    ($1::text IS NULL AND u.company_id IS NULL)
                    OR u.company_id::text = $1::text
                )
                ORDER BY l.created_at DESC
            `, [requesterCompanyId]);
        }
        
        const leaves = result.rows;
        
        // Group by user to fetch worked hours efficiently.
        // Run users in parallel and dedupe dates per user to avoid N+1 latency.
        const userIds = [...new Set(leaves.map(l => l.user_id))];
        const userWorkedHoursMap = {};

        await Promise.all(userIds.map(async (uid) => {
            const userLeaves = leaves.filter((l) => l.user_id === uid && l.status !== 'rejected');
            if (userLeaves.length === 0) return;

            const dates = [...new Set(userLeaves.map((l) => {
                const raw = l.covered_by_date || l.leave_date;
                return (typeof raw === 'string' ? raw : require('../utils/timeService').getDateStr(raw)).substring(0, 10);
            }))];
            try {
                userWorkedHoursMap[uid] = await attendanceService.getWorkedHoursByDates(uid, dates);
            } catch (hoursErr) {
                console.error(`[Leaves/admin] getWorkedHoursByDates failed for user ${uid}:`, hoursErr.message || hoursErr);
                userWorkedHoursMap[uid] = {};
            }
        }));

        const enrichedLeaves = leaves.map(l => {
            const dateToUse = l.covered_by_date || l.leave_date;
            const dateStr = require('../utils/timeService').getDateStr(dateToUse);
            return {
                ...l,
                worked_hours: userWorkedHoursMap[l.user_id]?.[dateStr] || 0,
                target_hours: standardHours
            };
        });

        res.json(enrichedLeaves);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

/**
 * Update leave status (Admin only)
 */
const updateLeaveStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        await ensureLeaveWorkflowSchema();
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const actedByName = await resolveActorDisplayName(req.user);
        const result = await updateLeaveStatusById({
            leaveId: id,
            status,
            io: req.app.get('io'),
            actedByUserId: req.user?.id || null,
            actedByName,
            expectedCompanyId: requesterCompanyId
        });
        res.json(result);
    } catch (err) {
        console.error(err);
        try {
            // Fallback for legacy schemas where newer leave workflow columns may be missing.
            const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
            const fallbackRes = await db.query(
                `UPDATE leaves l
                 SET status = $1
                 FROM users u
                 WHERE l.id = $2
                   AND u.id = l.user_id
                   AND (
                        ($3::uuid IS NULL AND u.company_id IS NULL)
                        OR u.company_id = $3::uuid
                   )
                 RETURNING l.*`,
                [status, id, requesterCompanyId]
            );

            if (fallbackRes.rows.length === 0) {
                return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Server error' });
            }

            const io = req.app.get('io');
            if (io) {
                io.emit('leave_update', {
                    type: 'status_changed',
                    leave: fallbackRes.rows[0],
                    newStatus: status,
                    actedBy: await resolveActorDisplayName(req.user)
                });
            }

            return res.json({
                updatedLeaves: [fallbackRes.rows[0]],
                summary: null,
                fallback: true
            });
        } catch (fallbackErr) {
            console.error('[updateLeaveStatus] Fallback failed:', fallbackErr);
            return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Server error' });
        }
    }
};

/**
 * Update leave status by request ID (Admin only)
 */
const updateLeaveStatusByRequestId = async (req, res) => {
    const { requestId } = req.params;
    const { status } = req.body;

    try {
        await ensureLeaveWorkflowSchema();
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const actedByName = await resolveActorDisplayName(req.user);
        const result = await updateLeaveStatusByRequestIdInternal({
            requestId,
            status,
            io: req.app.get('io'),
            actedByUserId: req.user?.id || null,
            actedByName,
            expectedCompanyId: requesterCompanyId
        });
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Server error' });
    }
};

/**
 * Delete a leave request (Admin only)
 */
const deleteLeave = async (req, res) => {
    const { id } = req.params;
    const client = await db.getClient();

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id, client);
        await client.query('BEGIN');
        const leaveRes = await client.query(
            `SELECT l.user_id, l.status, l.is_paid
             FROM leaves l
             JOIN users u ON u.id = l.user_id
             WHERE l.id = $1
               AND (
                    ($2::uuid IS NULL AND u.company_id IS NULL)
                    OR u.company_id = $2::uuid
               )
             FOR UPDATE`,
            [id, requesterCompanyId]
        );
        
        if (leaveRes.rows.length === 0) {
            await rollbackQuietly(client);
            return res.status(404).json({ error: 'Leave request not found' });
        }

        const leave = leaveRes.rows[0];

        // If it was an approved paid leave, revert the balance
        if (leave.status === 'approved' && leave.is_paid) {
            await client.query('UPDATE users SET paid_leave_balance = paid_leave_balance + 1 WHERE id = $1', [leave.user_id]);
        }

        const result = await client.query(
            `DELETE FROM leaves l
             USING users u
             WHERE l.id = $1
               AND u.id = l.user_id
               AND (
                    ($2::uuid IS NULL AND u.company_id IS NULL)
                    OR u.company_id = $2::uuid
               )
             RETURNING l.*`,
            [id, requesterCompanyId]
        );

        await client.query('COMMIT');

        // Emit socket event for real-time updates
        const io = req.app.get('io');
        if (io) {
            io.emit('leave_update', {
                type: 'deleted',
                leaveId: id
            });
        }

        res.json({ message: 'Leave request deleted successfully', id });
    } catch (err) {
        await rollbackQuietly(client);
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
};

/**
 * Delete a batch of leave requests by requestId (Admin only)
 */
const deleteLeaveByRequestId = async (req, res) => {
    const { requestId } = req.params;
    const client = await db.getClient();

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id, client);
        await client.query('BEGIN');
        
        // Find all leaves in this batch
        const leavesRes = await client.query(
            `SELECT l.user_id, l.status, l.is_paid
             FROM leaves l
             JOIN users u ON u.id = l.user_id
             WHERE l.request_id = $1
               AND (
                    ($2::uuid IS NULL AND u.company_id IS NULL)
                    OR u.company_id = $2::uuid
               )
             FOR UPDATE`,
            [requestId, requesterCompanyId]
        );
        
        if (leavesRes.rows.length === 0) {
            await rollbackQuietly(client);
            return res.status(404).json({ error: 'Leave request batch not found' });
        }

        // Revert balance for each approved paid leave day
        for (const leave of leavesRes.rows) {
            if (leave.status === 'approved' && leave.is_paid) {
                await client.query('UPDATE users SET paid_leave_balance = paid_leave_balance + 1 WHERE id = $1', [leave.user_id]);
            }
        }

        await client.query(
            `DELETE FROM leaves l
             USING users u
             WHERE l.request_id = $1
               AND u.id = l.user_id
               AND (
                    ($2::uuid IS NULL AND u.company_id IS NULL)
                    OR u.company_id = $2::uuid
               )`,
            [requestId, requesterCompanyId]
        );

        await client.query('COMMIT');

        const io = req.app.get('io');
        if (io) {
            io.emit('leave_update', {
                type: 'deleted_batch',
                requestId
            });
        }

        res.json({ message: 'Leave request batch deleted successfully', requestId });
    } catch (err) {
        await rollbackQuietly(client);
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
};

/**
 * Get upcoming leave requests (Admin only)
 * Returns upcoming approved/pending leaves starting from today
 */
const getUpcomingLeaves = async (req, res) => {
    try {
        await ensureLeaveWorkflowSchema();
        const requesterCompanyIdRaw = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const requesterCompanyId = requesterCompanyIdRaw ? String(requesterCompanyIdRaw) : null;
        const timeService = require('../utils/timeService');
        const today = timeService.getDateStr(timeService.getNow());

        const result = await db.query(`
            SELECT
                l.*,
                l.leave_date AS start_date,
                l.leave_date AS end_date,
                l.leave_type AS type,
                u.username,
                u.profile_picture,
                u.full_name
            FROM leaves l 
            JOIN users u ON l.user_id = u.id 
            WHERE l.status IN ('approved', 'pending')
            AND l.leave_date >= $1::date
            AND (
                ($2::text IS NULL AND u.company_id IS NULL)
                OR u.company_id::text = $2::text
            )
            ORDER BY
                CASE WHEN l.status = 'approved' THEN 0 ELSE 1 END,
                l.leave_date ASC
            LIMIT 5
        `, [today, requesterCompanyId]);

        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {
    createLeaveRequestInternal,
    updateLeaveStatusById,
    updateLeaveStatusByRequestIdInternal,
    requestLeave,
    getMyLeaves,
    getUncoveredLeaves,
    coverLeave,
    getAdminLeaves,
    getUpcomingLeaves,
    updateLeaveStatus,
    updateLeaveStatusByRequestId,
    proceedLeaveStatusByRequestId,
    declineLeaveStatusByRequestId,
    deleteLeave,
    deleteLeaveByRequestId
};
