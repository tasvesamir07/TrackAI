const db = require('../db');
const telegramService = require('../utils/telegramService');
const telegramCalendar = require('../utils/telegramCalendar');
const timeService = require('../utils/timeService');
const attendanceService = require('../utils/attendanceService');
const { logActivity } = require('./activityController');
const authController = require('./authController');
const { requestEmployeeLocationByAdmin } = require('./adminController');
const { 
    createLeaveRequestInternal, 
    updateLeaveStatusByRequestIdInternal,
    proceedLeaveStatusByRequestId,
    declineLeaveStatusByRequestId
} = require('./leaveController');
const aiService = require('../utils/aiService');
const { format } = require('date-fns');
const fs = require('fs');
const path = require('path');
const notificationService = require('../utils/notificationService');
const {
    buildVirtualAdminUser,
    findUserByPhoneNumber,
    formatRoleLabel,
    getConfiguredTelegramAdminLabel,
    isConfiguredTelegramAdminChatId,
    linkTelegramAdminPhone,
    normalizePhoneNumber
} = require('../utils/adminAccessService');
const messengerHandler = require('../utils/messengerHandler');

const LEAVE_TYPE_CALLBACK_PREFIX = 'tg_apply_leave_type_';
const ASSIGN_TASK_PROJECT_PREFIX = 'tg_assign_task_project_';
const ASSIGN_TASK_MEMBER_TOGGLE_PREFIX = 'tg_assign_task_member_toggle_';
const ASSIGN_TASK_MEMBER_DONE = 'tg_assign_task_member_done';
const ASSIGN_TASK_SKIP_DESCRIPTION = 'tg_assign_task_skip_desc';
const ASSIGN_TASK_BACK_TO_MENU = 'tg_assign_task_back_menu';
const ASSIGN_TASK_BACK_TO_PROJECT = 'tg_assign_task_back_project';
const ASSIGN_TASK_BACK_TO_TITLE = 'tg_assign_task_back_title';
const ASSIGN_TASK_BACK_TO_DESCRIPTION = 'tg_assign_task_back_description';
const ASSIGN_TASK_BACK_TO_MEMBERS = 'tg_assign_task_back_members';
const ASSIGN_TASK_CANCEL = 'tg_assign_task_cancel';
const ASSIGN_TASK_PRIORITY_PREFIX = 'tg_assign_task_priority_';
const ASSIGN_TASK_CREATE = 'tg_assign_task_create';
const REQUEST_LOCATION_CALLBACK_PREFIX = 'tg_request_location_';
const REQUEST_LOCATION_BACK = 'tg_request_location_back';
const isManagerRole = (role) => {
    const r = String(role || '').toLowerCase();
    return r === 'admin' || r === 'moderator' || r === 'company_admin' || r === 'project_manager';
};
const hasPrivilegedProjectAccess = (role) => {
    const r = String(role || '').toLowerCase();
    return r === 'admin' || r === 'moderator' || r === 'company_admin' || r === 'project_manager';
};
const isAdminRole = (role) => {
    const r = String(role || '').toLowerCase();
    return r === 'admin' || r === 'company_admin';
};
const isModeratorRole = (role) => {
    const r = String(role || '').toLowerCase();
    return r === 'moderator' || r === 'project_manager';
};

const logToFile = (msg) => {
    try {
        const logPath = path.join(__dirname, '../../tg_debug.log');
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`);
    } catch (err) {
        console.error('[TelegramController] logToFile failed:', err.message);
    }
};

const formatTelegramDate = (dateInput) => {
    const parsed = typeof dateInput === 'string' ? parseYmdDate(dateInput) : dateInput;
    if (!parsed) return String(dateInput);
    return format(parsed, 'dd-MM-yyyy');
};

const isChatIdAdmin = async (chatId) => {
    try {
        return await isConfiguredTelegramAdminChatId(chatId);
    } catch (err) {
        console.error('[TelegramController] Admin check error:', err.message);
        return false;
    }
};

const getUserByTelegramChatId = async (chatId) => {
    try {
        const res = await db.query(
            `SELECT u.*, t.name as company_name 
             FROM users u 
             LEFT JOIN tenants t ON t.id = u.company_id 
             WHERE u.telegram_chat_id = $1 OR u.telegram_chat_id = $2`, 
            [chatId.toString(), Number(chatId)]
        );
        let user = res.rows[0] || null;

        if (user) {
            logToFile(`[getUserByTelegramChatId] Found real user: ${user.username} (ID: ${user.id}, Role: ${user.role}) for ChatID: ${chatId}`);
        }

        if (!user || !isAdminRole(user.role)) {
            const isPowerAdmin = await isChatIdAdmin(chatId);
            if (isPowerAdmin) {
                const actingAdminName = await getConfiguredTelegramAdminLabel(chatId) || 'Admin';
                if (!user) {
                    user = buildVirtualAdminUser({ chatId, actingAdminName });
                } else {
                    user.original_role = user.role;
                    user.role = 'admin';
                    user.is_communication_hub_admin = true;
                    user.acting_admin_name = actingAdminName;
                }
            }
        }
        return user;
    } catch (err) {
        console.error('[TelegramController] DB error:', err.message);
        return null;
    }
};

const parseYmdDate = (dateStr) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

    if (Number.isNaN(date.getTime())) return null;
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

    return date;
};

const expandDateRange = (startStr, endStr) => {
    const start = parseYmdDate(startStr);
    const end = parseYmdDate(endStr);
    if (!start || !end || start > end) return null;

    const dates = [];
    const cursor = new Date(start);
    while (cursor <= end) {
        dates.push(timeService.getDateStr(cursor, 'UTC'));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
};

const parseLeaveDatesInput = (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
        return { error: 'Please send at least one date.' };
    }

    const normalizeDateInput = (value) => {
        const cleanValue = value.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(cleanValue)) {
            return cleanValue;
        }

        const dayFirstMatch = /^(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})$/.exec(cleanValue);
        if (dayFirstMatch) {
            return `${dayFirstMatch[3]}-${dayFirstMatch[2]}-${dayFirstMatch[1]}`;
        }

        return cleanValue;
    };

    const singleDatePattern = /^(?:\d{4}-\d{2}-\d{2}|\d{2}[\/\-.]\d{2}[\/\-.]\d{4})$/;
    const rangePattern = /^(.+?)\s*(?:to)\s*(.+)$/i;
    const dashedRangePattern = /^(.+?)\s+-\s+(.+)$/i;

    let dates = [];
    if (singleDatePattern.test(trimmed)) {
        dates = [normalizeDateInput(trimmed)];
    } else {
        const rangeMatch = trimmed.match(rangePattern) || trimmed.match(dashedRangePattern);
        if (rangeMatch) {
            dates = expandDateRange(normalizeDateInput(rangeMatch[1]), normalizeDateInput(rangeMatch[2])) || [];
        } else if (trimmed.includes(',')) {
            dates = trimmed.split(',').map(part => normalizeDateInput(part)).filter(Boolean);
        } else {
            return { error: 'Use DD-MM-YYYY, DD/MM/YYYY, DD-MM-YYYY to DD-MM-YYYY, or comma-separated dates.' };
        }
    }

    if (dates.length === 0) {
        return { error: 'No valid dates were found in your message.' };
    }

    const invalidDates = dates.filter((dateStr) => !parseYmdDate(dateStr));
    if (invalidDates.length > 0) {
        return { error: `Invalid date format: ${invalidDates.map(formatTelegramDate).join(', ')}` };
    }

    return { dates: [...new Set(dates)].sort() };
};

const filterApplicableLeaveDates = async (user, dateStrings) => {
    const { settings, holidays } = await attendanceService.getAttendanceSettings();
    const timezone = user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const validDates = [];
    const skippedDates = [];

    for (const dateStr of dateStrings) {
        const date = parseYmdDate(dateStr);
        const dayType = attendanceService.getDayType(date, settings, holidays, [], timezone);
        if (dayType.type === 'workday') {
            validDates.push(dateStr);
        } else {
            const reason = dayType.type === 'holiday' ? `holiday${dayType.name ? ` (${dayType.name})` : ''}` : dayType.type;
            skippedDates.push({ date: dateStr, reason });
        }
    }

    return { validDates, skippedDates };
};

const promptLeaveTypeSelection = async (chatId, leaveDates, skippedDates = []) => {
    const skippedText = skippedDates.length > 0
        ? `\n\nSkipped non-working days:\n${skippedDates.map(item => `- ${formatTelegramDate(item.date)} (${item.reason})`).join('\n')}`
        : '';

    await telegramService.sendInlineKeyboard(
        chatId,
        `*Leave Dates Selected*\n\nDates:\n${leaveDates.map(d => `- ${formatTelegramDate(d)}`).join('\n')}${skippedText}\n\nChoose leave type:`,
        [[
            { text: 'Paid', callback_data: `${LEAVE_TYPE_CALLBACK_PREFIX}paid` },
            { text: 'Unpaid', callback_data: `${LEAVE_TYPE_CALLBACK_PREFIX}unpaid` }
        ], [
            { text: 'Cancel', callback_data: 'cancel' }
        ]]
    );
};

const escapeTelegram = (text) => {
    if (!text) return '';
    return String(text)
        .replace(/_/g, '\\_')
        .replace(/\*/g, '\\*')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/`/g, '\\`');
};


const truncateText = (value, maxLength = 180) => {
    const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 3)}...`;
};

const formatYmdDate = (date) => format(date, 'yyyy-MM-dd');

const getWorkHoursSettings = async () => {
    const result = await db.query("SELECT value FROM settings WHERE key = 'work_hours'");
    return result.rows.length > 0
        ? JSON.parse(result.rows[0].value)
        : { standardHours: 4, weekendDays: [5, 6] };
};

const getConfiguredWeekStartDay = (weekendDays = []) => {
    const normalizedWeekendDays = Array.from(new Set(weekendDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)));
    if (normalizedWeekendDays.length === 0) {
        return 1;
    }

    const weekendSet = new Set(normalizedWeekendDays);
    for (let day = 0; day < 7; day += 1) {
        const previousDay = (day + 6) % 7;
        if (!weekendSet.has(day) && weekendSet.has(previousDay)) {
            return day;
        }
    }

    for (let day = 0; day < 7; day += 1) {
        if (!weekendSet.has(day)) {
            return day;
        }
    }

    return 1;
};

const getConfiguredWorkWeekLength = (weekendDays = []) => {
    const weekendCount = Array.from(new Set(weekendDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).length;
    return Math.max(1, 7 - weekendCount);
};

const getReportWeekStartDate = (referenceDate, weekendDays = []) => {
    const normalizedDate = parseYmdDate(formatYmdDate(referenceDate)) || new Date(referenceDate);
    normalizedDate.setHours(12, 0, 0, 0);

    const weekStartDay = getConfiguredWeekStartDay(weekendDays);
    const daysSinceWeekStart = (normalizedDate.getDay() - weekStartDay + 7) % 7;
    normalizedDate.setDate(normalizedDate.getDate() - daysSinceWeekStart);
    return normalizedDate;
};

const getReportWeekEndDate = (startDate, weekendDays = []) => {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + getConfiguredWorkWeekLength(weekendDays) - 1);
    endDate.setHours(12, 0, 0, 0);
    return endDate;
};

const getMonthStartDate = (referenceDate) => new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1, 12, 0, 0));

const getMonthEndDate = (referenceDate) => new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, 0, 12, 0, 0));

const getYearStartDate = (referenceDate) => new Date(Date.UTC(referenceDate.getUTCFullYear(), 0, 1, 12, 0, 0));

const getYearEndDate = (referenceDate) => new Date(Date.UTC(referenceDate.getUTCFullYear(), 11, 31, 12, 0, 0));

const sendLongText = async (chatId, text) => {
    const chunks = [];
    let remaining = String(text || '').trim();

    while (remaining.length > 3900) {
        let splitAt = remaining.lastIndexOf('\n\n', 3900);
        if (splitAt < 1000) {
            splitAt = remaining.lastIndexOf('\n', 3900);
        }
        if (splitAt < 1000) {
            splitAt = 3900;
        }
        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
    }

    if (remaining) {
        chunks.push(remaining);
    }

    for (const chunk of chunks) {
        await telegramService.sendText(chatId, chunk);
    }
};

const isHolidayOnDate = (dateStr, holidays = []) => holidays.some((holiday) => {
    if (holiday.date) {
        return formatYmdDate(new Date(holiday.date)) === dateStr;
    }
    if (holiday.startDate && holiday.endDate) {
        const startStr = typeof holiday.startDate === 'string' ? holiday.startDate : formatYmdDate(new Date(holiday.startDate));
        const endStr = typeof holiday.endDate === 'string' ? holiday.endDate : formatYmdDate(new Date(holiday.endDate));
        return dateStr >= startStr && dateStr <= endStr;
    }
    return false;
});

const getWorkingDaysInMonth = async (referenceDate) => {
    const settings = await getWorkHoursSettings();
    const holidaysRes = await db.query("SELECT value FROM settings WHERE key = 'holidays'");
    const holidays = holidaysRes.rows.length > 0 ? JSON.parse(holidaysRes.rows[0].value) : [];
    const year = referenceDate.getUTCFullYear();
    const monthIndex = referenceDate.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    let count = 0;

    for (let day = 1; day <= daysInMonth; day += 1) {
        const currentDate = new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));
        const dateStr = formatYmdDate(currentDate);
        const dayOfWeek = currentDate.getUTCDay();
        if ((settings.weekendDays || [5, 6]).includes(dayOfWeek)) continue;
        if (isHolidayOnDate(dateStr, holidays)) continue;
        count += 1;
    }

    return count;
};

const showUpcomingHolidays = async (chatId) => {
    const result = await db.query("SELECT value FROM settings WHERE key = 'holidays'");
    const holidays = result.rows.length > 0 ? JSON.parse(result.rows[0].value) : [];

    if (!holidays.length) {
        await telegramService.sendText(chatId, 'No holidays are configured.');
        return;
    }

    const lines = holidays.slice(0, 20).map((holiday) => {
        if (holiday.date) {
            const label = holiday.name ? `${escapeTelegram(holiday.name)}: ` : '';
            return `• ${label}${escapeTelegram(formatTelegramDate(holiday.date))}`;
        }
        if (holiday.startDate && holiday.endDate) {
            const label = holiday.name ? `${escapeTelegram(holiday.name)}: ` : '';
            return `• ${label}${escapeTelegram(formatTelegramDate(holiday.startDate))} to ${escapeTelegram(formatTelegramDate(holiday.endDate))}`;
        }
        return null;
    }).filter(Boolean);

    await telegramService.sendText(chatId, `🗓 *Holidays*\n\n${lines.join('\n')}`);
};

const showMyLeaves = async (chatId, user) => {
    const result = await db.query(`
        SELECT request_id, leave_type, status, COUNT(*)::int AS days, MIN(leave_date) AS start_date, MAX(leave_date) AS end_date, MAX(reason) AS reason
        FROM leaves
        WHERE user_id = $1
        GROUP BY request_id, leave_type, status
        ORDER BY MAX(created_at) DESC
        LIMIT 12
    `, [user.id]);

    if (!result.rows.length) {
        await telegramService.sendText(chatId, 'You have no leave requests yet.');
        return;
    }

    const text = `📋 *My Leaves*\n\n${result.rows.map((row) => (
        `• *${escapeTelegram(row.leave_type.toUpperCase())}* | ${escapeTelegram(row.status.toUpperCase())}\n` +
        `  ${escapeTelegram(formatTelegramDate(row.start_date))}${row.start_date !== row.end_date ? ` to ${escapeTelegram(formatTelegramDate(row.end_date))}` : ''} • ${row.days} day(s)\n` +
        `  ${escapeTelegram(truncateText(row.reason || 'No reason', 120))}`
    )).join('\n\n')}`;

    await sendLongText(chatId, text);
};

const showOnLeaveNow = async (chatId) => {
    const today = formatYmdDate(new Date());
    const result = await db.query(`
        SELECT u.username, u.full_name, u.department, l.leave_type
        FROM leaves l
        JOIN users u ON u.id = l.user_id
        WHERE l.status = 'approved' AND l.leave_date = $1::date
        ORDER BY u.username ASC
    `, [today]);

    if (!result.rows.length) {
        await telegramService.sendText(chatId, `No one is on leave on ${today}.`);
        return;
    }

    const text = `🌴 *On Leave Now (${today})*\n\n${result.rows.map((row) => (
        `• *${escapeTelegram(row.full_name || row.username)}* (${escapeTelegram(row.department || 'No Department')}) - ${escapeTelegram(String(row.leave_type || '').toUpperCase())}`
    )).join('\n')}`;
    await sendLongText(chatId, text);
};

const showPendingLeaves = async (chatId, user) => {
    if (!isManagerRole(user.role)) {
        await telegramService.sendText(chatId, 'Only Managers/Admins can review pending leaves.');
        return;
    }

    const isPM = isModeratorRole(user.role);
    const isAdmin = isAdminRole(user.role);

    // If PM: show leaves where moderator_status is pending
    // If Admin: show leaves where moderator_status is proceeded (waiting for final)
    // Note: If someone is both (unlikely in this UI), they see everything relevant
    let query;
    if (isAdmin) {
        query = `
            SELECT l.request_id, u.username, u.full_name, u.department, l.leave_type,
                   COUNT(*)::int AS days, MIN(l.leave_date) AS start_date, MAX(l.leave_date) AS end_date,
                   MAX(l.reason) AS reason, MAX(l.moderator_status) as mod_status
            FROM leaves l
            JOIN users u ON l.user_id = u.id
            WHERE l.status = 'pending' AND l.moderator_status = 'proceeded'
            GROUP BY l.request_id, u.username, u.full_name, u.department, l.leave_type
            ORDER BY MIN(l.leave_date) ASC LIMIT 10
        `;
    } else {
        query = `
            SELECT l.request_id, u.username, u.full_name, u.department, l.leave_type,
                   COUNT(*)::int AS days, MIN(l.leave_date) AS start_date, MAX(l.leave_date) AS end_date,
                   MAX(l.reason) AS reason, MAX(l.moderator_status) as mod_status
            FROM leaves l
            JOIN users u ON l.user_id = u.id
            WHERE l.status = 'pending' AND l.moderator_status = 'pending'
            GROUP BY l.request_id, u.username, u.full_name, u.department, l.leave_type
            ORDER BY MIN(l.leave_date) ASC LIMIT 10
        `;
    }
    
    const pendingRes = await db.query(query);

    if (!pendingRes.rows.length) {
        await telegramService.sendText(chatId, 'No pending leaves.');
        return;
    }

    for (const row of pendingRes.rows) {
        const message = `📝 *Pending Leave*\n\n` +
            `*Employee:* ${escapeTelegram(row.full_name || row.username)}\n` +
            `*Department:* ${escapeTelegram(row.department || 'No Department')}\n` +
            `*Type:* ${escapeTelegram(String(row.leave_type || '').toUpperCase())}\n` +
            `*Dates:* ${escapeTelegram(formatTelegramDate(row.start_date))}${row.start_date !== row.end_date ? ` to ${escapeTelegram(formatTelegramDate(row.end_date))}` : ''}\n` +
            `*Days:* ${row.days}\n` +
            `*Reason:* ${escapeTelegram(truncateText(row.reason || 'No reason', 180))}`;

        const buttons = [];
        if (isAdmin) {
            buttons.push([
                { text: '✅ Approve', callback_data: `tg_leave_approve_${row.request_id}` },
                { text: '❌ Reject', callback_data: `tg_leave_reject_${row.request_id}` }
            ]);
        } else {
            buttons.push([
                { text: '➡️ Proceed to HR', callback_data: `tg_leave_proceed_${row.request_id}` },
                { text: '🚫 Decline', callback_data: `tg_leave_decline_${row.request_id}` }
            ]);
        }

        await telegramService.sendInlineKeyboard(chatId, message, buttons);
    }
};

const showPendingProfileRequests = async (chatId, user) => {
    if (!isAdminRole(user.role)) {
        await telegramService.sendText(chatId, 'Only admins can review profile requests.');
        return;
    }

    const result = await db.query(`
        SELECT
            pr.id,
            pr.requested_changes,
            pr.created_at,
            u.username,
            u.full_name
        FROM profile_update_requests pr
        JOIN users u ON u.id = pr.user_id
        WHERE pr.status = 'pending'
        ORDER BY pr.created_at DESC
        LIMIT 10
    `);

    if (!result.rows.length) {
        await telegramService.sendText(chatId, 'No pending profile update requests.');
        return;
    }

    for (const row of result.rows) {
        const changes = typeof row.requested_changes === 'string'
            ? JSON.parse(row.requested_changes)
            : (row.requested_changes || {});
        const fields = Object.entries(changes).slice(0, 8).map(([key, value]) => (
            `• ${escapeTelegram(key)}: ${escapeTelegram(truncateText(typeof value === 'string' ? value : JSON.stringify(value), 120))}`
        ));

        const message = `🪪 *Profile Request*\n\n` +
            `*Employee:* ${escapeTelegram(row.full_name || row.username)}\n` +
            `*Submitted:* ${escapeTelegram(format(new Date(row.created_at), 'dd-MM-yyyy hh:mm a'))}\n\n` +
            `${fields.join('\n') || 'No changes found.'}`;

        await telegramService.sendInlineKeyboard(chatId, message, [[
            { text: 'Approve', callback_data: `tg_profile_approve_${row.id}` },
            { text: 'Reject', callback_data: `tg_profile_reject_${row.id}` }
        ]]);
    }
};

const showLocationRequestPicker = async (chatId, user) => {
    if (!isAdminRole(user.role)) {
        await telegramService.sendText(chatId, 'Only admins can request live location.');
        return;
    }

    const employeesRes = await db.query(
        `SELECT id, username, full_name, status, telegram_chat_id
         FROM users
         WHERE role = 'employee' AND status IN ('active', 'break')
         ORDER BY username ASC
         LIMIT 30`
    );

    if (!employeesRes.rows.length) {
        await telegramService.sendText(chatId, 'No active employees found for live location request.');
        return;
    }

    const buttons = employeesRes.rows.map((employee) => {
        const displayName = employee.full_name || employee.username;
        const stateLabel = employee.status === 'break' ? 'break' : 'active';
        const linkLabel = employee.telegram_chat_id ? '' : ' (last known)';
        return [{
            text: `${displayName} [${stateLabel}]${linkLabel}`,
            callback_data: `${REQUEST_LOCATION_CALLBACK_PREFIX}${employee.id}`
        }];
    });

    buttons.push([{ text: 'Back to Menu', callback_data: REQUEST_LOCATION_BACK }]);

    await telegramService.sendInlineKeyboard(
        chatId,
        '*Request Live Location*\n\nSelect an employee to request location.',
        buttons
    );
};

const showEmployeeStatus = async (chatId, user) => {
    if (!isManagerRole(user.role)) {
        await telegramService.sendText(chatId, 'Only managers and admins can view employee status.');
        return;
    }

    const companyId = user.company_id;
    if (!companyId) {
        await telegramService.sendText(chatId, 'Error: Could not identify your company. Please contact support.');
        return;
    }

    const usersRes = await db.query(`
        SELECT username, full_name, role, status 
        FROM users 
        WHERE company_id = $1 
        AND role IN ('employee', 'moderator', 'project_manager')
        ORDER BY role DESC, username ASC
    `, [companyId]);

    if (!usersRes.rows.length) {
        await telegramService.sendText(chatId, 'No team members found for your company.');
        return;
    }

    const pms = usersRes.rows.filter(u => isModeratorRole(u.role));
    const employees = usersRes.rows.filter(u => !isModeratorRole(u.role));

    let message = '👥 *Team Status Report*\n\n';

    if (pms.length > 0) {
        message += '🏗 *Project Managers*\n';
        pms.forEach((u, i) => {
            const emoji = u.status === 'active' ? '🟢' : u.status === 'break' ? '☕' : '🔴';
            message += `${i + 1}. ${emoji} *${escapeTelegram(u.full_name || u.username)}*: ${u.status.toUpperCase()}\n`;
        });
        message += '\n';
    }

    if (employees.length > 0) {
        message += '👤 *Employees*\n';
        employees.forEach((u, i) => {
            const emoji = u.status === 'active' ? '🟢' : u.status === 'break' ? '☕' : '🔴';
            message += `${i + 1}. ${emoji} *${escapeTelegram(u.full_name || u.username)}*: ${u.status.toUpperCase()}\n`;
        });
    }

    await telegramService.sendText(chatId, message);
};

const getAccessibleProjects = async (user) => {
    logToFile(`DEBUG: getAccessibleProjects for user.role=${user.role}`);
    if (hasPrivilegedProjectAccess(user.role)) {
        logToFile(`DEBUG: User has privileged access. Running admin query.`);
        const result = await db.query(`
            SELECT
                p.id,
                p.name,
                p.description,
                p.status,
                p.created_at,
                COALESCE(task_counts.total_tasks, 0)::int AS total_tasks,
                COALESCE(task_counts.todo_count, 0)::int AS todo_count,
                COALESCE(task_counts.in_progress_count, 0)::int AS in_progress_count,
                COALESCE(task_counts.ready_for_test_count, 0)::int AS ready_for_test_count,
                COALESCE(task_counts.ready_count, 0)::int AS ready_count,
                COALESCE(task_counts.done_count, 0)::int AS done_count,
                COALESCE(member_counts.member_count, 0)::int AS member_count
            FROM projects p
            LEFT JOIN (
                SELECT
                    project_id,
                    COUNT(*)::int AS total_tasks,
                    COUNT(*) FILTER (WHERE status = 'todo')::int AS todo_count,
                    COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_count,
                    COUNT(*) FILTER (WHERE status = 'ready_for_test')::int AS ready_for_test_count,
                    COUNT(*) FILTER (WHERE status = 'ready')::int AS ready_count,
                    COUNT(*) FILTER (WHERE status = 'done')::int AS done_count
                FROM project_tasks
                GROUP BY project_id
            ) task_counts ON task_counts.project_id = p.id
            LEFT JOIN (
                SELECT project_id, COUNT(*)::int AS member_count
                FROM project_members
                GROUP BY project_id
            ) member_counts ON member_counts.project_id = p.id
            WHERE p.deleted_at IS NULL
            ORDER BY p.created_at DESC
        `);
        return result.rows;
    }

    const result = await db.query(`
        SELECT
            p.id,
            p.name,
            p.description,
            p.status,
            p.created_at,
            pm.role AS user_role,
            COALESCE(task_counts.total_tasks, 0)::int AS total_tasks,
            COALESCE(task_counts.todo_count, 0)::int AS todo_count,
            COALESCE(task_counts.in_progress_count, 0)::int AS in_progress_count,
            COALESCE(task_counts.ready_for_test_count, 0)::int AS ready_for_test_count,
            COALESCE(task_counts.ready_count, 0)::int AS ready_count,
            COALESCE(task_counts.done_count, 0)::int AS done_count,
            COALESCE(member_counts.member_count, 0)::int AS member_count
        FROM projects p
        JOIN project_members pm ON p.id = pm.project_id
        LEFT JOIN (
            SELECT
                project_id,
                COUNT(*)::int AS total_tasks,
                COUNT(*) FILTER (WHERE status = 'todo')::int AS todo_count,
                COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_count,
                COUNT(*) FILTER (WHERE status = 'ready_for_test')::int AS ready_for_test_count,
                COUNT(*) FILTER (WHERE status = 'ready')::int AS ready_count,
                COUNT(*) FILTER (WHERE status = 'done')::int AS done_count
            FROM project_tasks
            GROUP BY project_id
        ) task_counts ON task_counts.project_id = p.id
        LEFT JOIN (
            SELECT project_id, COUNT(*)::int AS member_count
            FROM project_members
            GROUP BY project_id
        ) member_counts ON member_counts.project_id = p.id
        WHERE pm.user_id = $1 AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
    `, [user.id]);
    return result.rows;
};

const ensureProjectAccess = async (projectId, user) => {
    if (hasPrivilegedProjectAccess(user.role)) {
        return true;
    }
    const result = await db.query('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, user.id]);
    return result.rows.length > 0;
};

const getProjectEmployeeMembers = async (projectId) => {
    const result = await db.query(`
        SELECT u.id, u.username, u.full_name
        FROM project_members pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = $1
          AND u.role = 'employee'
        ORDER BY CASE WHEN pm.role = 'leader' THEN 0 ELSE 1 END, u.username ASC
    `, [projectId]);

    return result.rows;
};

const buildAssignTaskMembersKeyboard = (members = [], selectedAssigneeIds = []) => {
    const selectedSet = new Set((selectedAssigneeIds || []).map((id) => Number(id)));
    const rows = members.slice(0, 40).map((member) => {
        const isSelected = selectedSet.has(Number(member.id));
        const label = `${isSelected ? '✅' : '❌'} ${member.full_name || member.username}`;
        return [{ text: label.slice(0, 64), callback_data: `${ASSIGN_TASK_MEMBER_TOGGLE_PREFIX}${member.id}` }];
    });

    rows.push([
        { text: 'Back', callback_data: ASSIGN_TASK_BACK_TO_DESCRIPTION },
        { text: 'Next', callback_data: ASSIGN_TASK_MEMBER_DONE }
    ]);
    rows.push([{ text: 'Cancel Wizard', callback_data: ASSIGN_TASK_CANCEL }]);

    return rows;
};

const buildAssignTaskPriorityKeyboard = (selectedPriority = 'medium') => {
    const options = [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'urgent', label: 'Urgent' }
    ];

    const rows = options.map((option) => ([
        {
            text: `${selectedPriority === option.value ? '✅' : '❌'} ${option.label}`,
            callback_data: `${ASSIGN_TASK_PRIORITY_PREFIX}${option.value}`
        }
    ]));

    rows.push([{ text: 'Create Task', callback_data: ASSIGN_TASK_CREATE }]);
    rows.push([
        { text: 'Back', callback_data: ASSIGN_TASK_BACK_TO_MEMBERS },
        { text: 'Cancel Wizard', callback_data: ASSIGN_TASK_CANCEL }
    ]);

    return rows;
};

const isAssignTaskWizardStep = (step) => (
    step === 'awaiting_assign_task_project' ||
    step === 'awaiting_assign_task_title' ||
    step === 'awaiting_assign_task_description' ||
    step === 'awaiting_assign_task_members' ||
    step === 'awaiting_assign_task_priority'
);

const getAssignTaskWizardView = ({ state, projects = [], members = [] }) => {
    const selectedCount = Array.from(new Set((state.selectedAssigneeIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))).length;

    if (state.step === 'awaiting_assign_task_project') {
        const rows = projects.slice(0, 20).map((project) => ([{
            text: project.name.slice(0, 64),
            callback_data: `${ASSIGN_TASK_PROJECT_PREFIX}${project.id}`
        }]));
        rows.push([
            { text: 'Back', callback_data: ASSIGN_TASK_BACK_TO_MENU },
            { text: 'Cancel Wizard', callback_data: ASSIGN_TASK_CANCEL }
        ]);

        return {
            text: '*Assign Task Wizard* (1/5)\n\nSelect a project.',
            keyboard: rows
        };
    }

    if (state.step === 'awaiting_assign_task_title') {
        return {
            text: `*Assign Task Wizard* (2/5)\n\n*Project:* ${escapeTelegram(state.projectName || 'Unknown')}\n\nSend the task title as a message.`,
            keyboard: [[
                { text: 'Back', callback_data: ASSIGN_TASK_BACK_TO_PROJECT },
                { text: 'Cancel Wizard', callback_data: ASSIGN_TASK_CANCEL }
            ]]
        };
    }

    if (state.step === 'awaiting_assign_task_description') {
        return {
            text: `*Assign Task Wizard* (3/5)\n\n*Project:* ${escapeTelegram(state.projectName || 'Unknown')}\n*Title:* ${escapeTelegram(state.title || 'Not set')}\n\nSend task description as a message, or skip.`,
            keyboard: [
                [{ text: 'Skip Description', callback_data: ASSIGN_TASK_SKIP_DESCRIPTION }],
                [
                    { text: 'Back', callback_data: ASSIGN_TASK_BACK_TO_TITLE },
                    { text: 'Cancel Wizard', callback_data: ASSIGN_TASK_CANCEL }
                ]
            ]
        };
    }

    if (state.step === 'awaiting_assign_task_members') {
        return {
            text: `*Assign Task Wizard* (4/5)\n\n*Project:* ${escapeTelegram(state.projectName || 'Unknown')}\n*Title:* ${escapeTelegram(state.title || 'Not set')}\n*Description:* ${escapeTelegram(state.description || 'Skipped')}\n*Selected members:* ${selectedCount}\n\nToggle members, then press Next.`,
            keyboard: buildAssignTaskMembersKeyboard(members, state.selectedAssigneeIds || [])
        };
    }

    return {
        text: `*Assign Task Wizard* (5/5)\n\n*Project:* ${escapeTelegram(state.projectName || 'Unknown')}\n*Title:* ${escapeTelegram(state.title || 'Not set')}\n*Description:* ${escapeTelegram(state.description || 'Skipped')}\n*Selected members:* ${selectedCount}\n*Priority:* ${escapeTelegram((state.priority || 'medium').toUpperCase())}\n\nSelect priority, then press Create Task.`,
        keyboard: buildAssignTaskPriorityKeyboard(state.priority || 'medium')
    };
};

const renderAssignTaskWizard = async (chatId, user, state, options = {}) => {
    const bot = telegramService.getBot();
    const projects = options.projects || (state.step === 'awaiting_assign_task_project' ? await getAccessibleProjects(user) : []);
    const members = options.members || (state.step === 'awaiting_assign_task_members' ? await getProjectEmployeeMembers(state.projectId) : []);
    const view = getAssignTaskWizardView({ state, projects, members });
    let wizardMessageId = Number(state.wizardMessageId) || null;

    if (bot && wizardMessageId) {
        try {
            await bot.editMessageText(view.text, {
                chat_id: chatId,
                message_id: wizardMessageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: view.keyboard }
            });
            return { ...state, wizardMessageId };
        } catch (error) {
            const desc = String(error?.response?.body?.description || error?.message || '').toLowerCase();
            if (!desc.includes('message is not modified')) {
                wizardMessageId = null;
            }
        }
    }

    const sent = await telegramService.sendInlineKeyboard(chatId, view.text, view.keyboard);
    if (sent?.message_id) {
        wizardMessageId = sent.message_id;
    }
    return { ...state, wizardMessageId };
};

const cancelAssignTaskWizard = async (chatId, userState, reason = 'Assign Task wizard cancelled.') => {
    const bot = telegramService.getBot();
    const wizardMessageId = Number(userState?.wizardMessageId);

    if (bot && Number.isInteger(wizardMessageId) && wizardMessageId > 0) {
        await bot.editMessageText(reason, {
            chat_id: chatId,
            message_id: wizardMessageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [] }
        }).catch(() => {});
        return;
    }

    await telegramService.sendText(chatId, reason);
};

const openAssignTaskProjectPicker = async (chatId, user) => {
    if (!isManagerRole(user.role)) {
        await telegramService.sendText(chatId, 'Only admins and moderators can assign tasks.');
        return;
    }

    const projects = await getAccessibleProjects(user);
    if (!projects.length) {
        await telegramService.sendText(chatId, 'No projects are available for assignment.');
        return;
    }

    const nextState = {
        step: 'awaiting_assign_task_project'
    };
    const renderedState = await renderAssignTaskWizard(chatId, user, nextState, { projects });
    global.tgUserStates.set(chatId.toString(), renderedState);
};

const createTaskFromTelegram = async ({ projectId, title, description, assigneeIds, priority, actorUser }) => {
    let actorUserId = Number(actorUser?.id);
    if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
        const fallbackActorRes = await db.query(`
            SELECT COALESCE(
                p.created_by,
                (
                    SELECT pm.user_id
                    FROM project_members pm
                    WHERE pm.project_id = p.id
                    ORDER BY CASE WHEN pm.role = 'leader' THEN 0 ELSE 1 END, pm.user_id
                    LIMIT 1
                )
            ) AS actor_id
            FROM projects p
            WHERE p.id = $1
        `, [projectId]);
        const fallbackActorId = Number(fallbackActorRes.rows[0]?.actor_id);
        actorUserId = Number.isInteger(fallbackActorId) && fallbackActorId > 0 ? fallbackActorId : null;
    }

    const insertTaskRes = await db.query(
        `INSERT INTO project_tasks (project_id, title, description, status, priority, created_by, assigned_by, assigned_at)
         VALUES ($1, $2, $3, 'todo', $5, $4, $4, CURRENT_TIMESTAMP)
         RETURNING id`,
        [projectId, String(title).trim(), description ? String(description).trim() : null, actorUserId, priority || 'medium']
    );

    const taskId = insertTaskRes.rows[0]?.id;
    if (!taskId) {
        throw new Error('TASK_CREATE_FAILED');
    }

    for (const assigneeId of assigneeIds) {
        await db.query(
            'INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [taskId, assigneeId]
        );

        await db.query(
            `INSERT INTO task_assignment_alerts (task_id, user_id, assigned_by, created_at, dismissed_at)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP, NULL)
             ON CONFLICT (task_id, user_id)
             DO UPDATE SET assigned_by = $3, created_at = CURRENT_TIMESTAMP, dismissed_at = NULL`,
            [taskId, assigneeId, actorUserId]
        );
    }

    await db.query(
        `INSERT INTO task_activity_logs (task_id, project_id, actor_user_id, action_type, details)
         VALUES ($1, $2, $3, 'task_created', $4::jsonb)`,
        [
            taskId,
            projectId,
            actorUserId,
            JSON.stringify({
                title: String(title).trim(),
                assigneeIds: assigneeIds
            })
        ]
    );

    // Send Telegram notifications to assignees
    notificationService.sendTaskAssignmentNotification(taskId, assigneeIds, actorUserId).catch(err => {
        console.error('[TelegramController] Failed to send task assignment notification:', err.message);
    });

    const io = actorUser.io;
    if (io) {
        io.emit('project_task_update', {
            type: 'create',
            task: { id: taskId, project_id: projectId }
        });
        [...new Set(assigneeIds.map((id) => String(id)))].forEach((userId) => {
            io.to(userId).emit('assigned_task_alert_update', { userId: Number(userId) });
        });
    }

    return taskId;
};

const showProjectsMenu = async (chatId, user) => {
    const projects = await getAccessibleProjects(user);
    if (!projects.length) {
        await telegramService.sendText(chatId, 'No projects available for your account.');
        return;
    }

    const message = user.role === 'employee'
        ? '🗂 *My Projects*\n\nChoose a project to view details.'
        : '🗂 *Projects*\n\nChoose a project to view details.';
    const buttons = [];

    projects.slice(0, 20).forEach((project) => {
        buttons.push([{
            text: `${project.name} (${project.total_tasks || 0})`,
            callback_data: `tg_project_view_${project.id}`
        }]);
    });

    if (user.role === 'admin') {
        buttons.push([{ text: '🗑 Recycle Bin', callback_data: 'tg_project_bin' }]);
    }

    await telegramService.sendInlineKeyboard(chatId, message, buttons);
};

const showProjectDetails = async (chatId, user, projectId) => {
    if (!await ensureProjectAccess(projectId, user)) {
        await telegramService.sendText(chatId, 'Not authorized to view this project.');
        return;
    }

    const projectRes = await db.query('SELECT * FROM projects WHERE deleted_at IS NULL AND id = $1 AND deleted_at IS NULL', [projectId]);
    if (!projectRes.rows.length) {
        await telegramService.sendText(chatId, 'Project not found (it might be in the bin).');
        return;
    }

    const membersRes = await db.query(`
        SELECT u.username, pm.role
        FROM project_members pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = $1
        ORDER BY CASE WHEN pm.role = 'leader' THEN 0 ELSE 1 END, u.username
    `, [projectId]);

    const summaryRes = await db.query(`
        SELECT
            COUNT(*)::int AS total_tasks,
            COUNT(*) FILTER (WHERE status = 'todo')::int AS todo_count,
            COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_count,
            COUNT(*) FILTER (WHERE status = 'ready_for_test')::int AS ready_for_test_count,
            COUNT(*) FILTER (WHERE status = 'ready')::int AS ready_count,
            COUNT(*) FILTER (WHERE status = 'done')::int AS done_count
        FROM project_tasks
        WHERE project_id = $1
    `, [projectId]);

    const project = projectRes.rows[0];
    const counts = summaryRes.rows[0] || {};
    const message = `🗂 *${escapeTelegram(project.name)}*\n\n` +
        `*Status:* ${escapeTelegram(project.status || 'unknown')}\n` +
        `*Description:* ${escapeTelegram(truncateText(project.description || 'No description', 220))}\n` +
        `*Members:* ${membersRes.rows.length}\n` +
        `*Tasks:* ${counts.total_tasks || 0}\n` +
        `• Todo: ${counts.todo_count || 0}\n` +
        `• In Progress: ${counts.in_progress_count || 0}\n` +
        `• Ready for Test: ${counts.ready_for_test_count || 0}\n` +
        `• Ready: ${counts.ready_count || 0}\n` +
        `• Done: ${counts.done_count || 0}\n\n` +
        `*Team:* ${membersRes.rows.map((member) => `${escapeTelegram(member.username)} (${escapeTelegram(member.role)})`).join(', ') || 'No members'}`;

    const buttons = [
        [
            { text: 'Tasks', callback_data: `tg_project_tasks_${projectId}` },
            { text: 'Summary', callback_data: `tg_project_summary_${projectId}` }
        ]
    ];
    buttons.push([{ text: 'Back to Projects', callback_data: 'tg_projects_back' }]);

    await telegramService.sendInlineKeyboard(chatId, message, buttons);
};

const handleProjectBin = async (chatId, user) => {
    if (!isAdminRole(user.role)) {
        await telegramService.sendText(chatId, 'Only admins can view the bin.');
        return;
    }

    const result = await db.query(`
        SELECT p.*, u.username as creator_name
        FROM projects p
        LEFT JOIN users u ON p.created_by = u.id
        WHERE p.deleted_at IS NOT NULL
        ORDER BY p.deleted_at DESC
        LIMIT 20
    `);

    if (!result.rows.length) {
        await telegramService.sendText(chatId, 'Recycle Bin is empty.');
        return;
    }

    const message = '🗑 *Recycle Bin*\n\nSelect a project to restore:';
    const buttons = result.rows.map(p => ([{
        text: `Restore: ${p.name}`,
        callback_data: `tg_project_restore_${p.id}`
    }]));
    buttons.push([{ text: '🔙 Back', callback_data: 'tg_project_back' }]);

    await telegramService.sendInlineKeyboard(chatId, message, buttons);
};

const handleProjectRestore = async (chatId, user, projectId) => {
    if (!isAdminRole(user.role)) {
        await telegramService.sendText(chatId, 'Only admins can restore projects.');
        return;
    }

    await db.query('UPDATE projects SET deleted_at = NULL WHERE id = $1', [projectId]);
    await telegramService.sendText(chatId, '✅ Project restored successfully!');
    await showProjectsMenu(chatId, user);
};

const showProjectTasks = async (chatId, user, projectId) => {
    if (!await ensureProjectAccess(projectId, user)) {
        await telegramService.sendText(chatId, 'Not authorized to view project tasks.');
        return;
    }

    const projectRes = await db.query('SELECT name FROM projects WHERE deleted_at IS NULL AND id = $1', [projectId]);
    const tasksRes = await db.query(`
        SELECT
            t.title,
            t.status,
            t.priority,
            t.due_date,
            COALESCE(
                json_agg(json_build_object('username', u.username)) FILTER (WHERE u.id IS NOT NULL),
                '[]'
            ) AS assignees
        FROM project_tasks t
        LEFT JOIN task_assignees ta ON ta.task_id = t.id
        LEFT JOIN users u ON u.id = ta.user_id
        WHERE t.project_id = $1
        GROUP BY t.id
        ORDER BY t.position ASC, t.created_at DESC
        LIMIT 40
    `, [projectId]);

    if (!tasksRes.rows.length) {
        await telegramService.sendText(chatId, `No tasks found for ${escapeTelegram(projectRes.rows[0]?.name || 'this project')}.`);
        return;
    }

    const message = `📌 *Project Tasks: ${escapeTelegram(projectRes.rows[0]?.name || '')}*\n\n${tasksRes.rows.map((task) => {
        const assignees = Array.isArray(task.assignees) ? task.assignees.map((row) => row.username).filter(Boolean) : [];
        return `• *${escapeTelegram(task.title)}*\n` +
            `  Status: ${escapeTelegram(task.status || 'todo')} | Priority: ${escapeTelegram(task.priority || 'medium')}\n` +
            `  Assignees: ${escapeTelegram(assignees.join(', ') || 'None')}` +
            `${task.due_date ? `\n  Due: ${escapeTelegram(formatTelegramDate(task.due_date))}` : ''}`;
    }).join('\n\n')}`;

    await sendLongText(chatId, message);
};

const showProjectSummary = async (chatId, user, projectId) => {
    if (!await ensureProjectAccess(projectId, user)) {
        await telegramService.sendText(chatId, 'Not authorized to view project summary.');
        return;
    }

    const projectRes = await db.query('SELECT name FROM projects WHERE deleted_at IS NULL AND id = $1', [projectId]);
    if (projectRes.rows.length === 0) {
        await telegramService.sendText(chatId, 'Project not found.');
        return;
    }

    const summaryRes = await db.query(`
        SELECT
            COUNT(*)::int AS total_tasks,
            COUNT(*) FILTER (WHERE status = 'todo')::int AS todo_count,
            COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_count,
            COUNT(*) FILTER (WHERE status = 'ready_for_test')::int AS ready_for_test_count,
            COUNT(*) FILTER (WHERE status = 'ready')::int AS ready_count,
            COUNT(*) FILTER (WHERE status = 'done')::int AS done_count
        FROM project_tasks
        WHERE project_id = $1
    `, [projectId]);

    const counts = summaryRes.rows[0] || {};
    const message = `📊 *Project Summary: ${escapeTelegram(projectRes.rows[0]?.name || '')}*\n\n` +
        `*Total Tasks:* ${counts.total_tasks || 0}\n` +
        `• Todo: ${counts.todo_count || 0}\n` +
        `• In Progress: ${counts.in_progress_count || 0}\n` +
        `• Ready for Test: ${counts.ready_for_test_count || 0}\n` +
        `• Ready: ${counts.ready_count || 0}\n` +
        `• Done: ${counts.done_count || 0}`;

    await telegramService.sendText(chatId, message);
};

const showAssignedTasks = async (chatId, user) => {
    const result = await db.query(`
        SELECT
            t.id,
            t.title,
            t.status,
            t.priority,
            t.due_date,
            p.name AS project_name
        FROM project_tasks t
        JOIN task_assignees ta ON ta.task_id = t.id
        JOIN projects p ON p.id = t.project_id
        WHERE ta.user_id = $1
        ORDER BY CASE WHEN t.status = 'done' THEN 1 ELSE 0 END, t.due_date NULLS LAST, t.created_at DESC
        LIMIT 25
    `, [user.id]);

    if (!result.rows.length) {
        await telegramService.sendText(chatId, 'No assigned project tasks found.');
        return;
    }

    const text = `📌 *Assigned Tasks*\n\n${result.rows.map((task) => (
        `• *${escapeTelegram(task.title)}*\n` +
        `  Project: ${escapeTelegram(task.project_name)}\n` +
        `  Status: ${escapeTelegram(task.status)} | Priority: ${escapeTelegram(task.priority || 'medium')}` +
        `${task.due_date ? `\n  Due: ${escapeTelegram(formatTelegramDate(task.due_date))}` : ''}`
    )).join('\n\n')}`;

    await sendLongText(chatId, text);
};

const getEmployeeReportsForRange = async (startDate, endDate) => {
    const result = await db.query(`
        SELECT
            u.id AS user_id,
            u.username,
            u.full_name,
            u.department,
            COUNT(t.id)::int AS total_submissions,
            JSON_AGG(
                JSON_BUILD_OBJECT(
                    'date', t.date,
                    'todays_task', t.todays_task,
                    'attachments', t.attachments
                ) ORDER BY t.date DESC
            ) FILTER (WHERE t.id IS NOT NULL) AS tasks
        FROM users u
        LEFT JOIN tasks t ON u.id = t.user_id
            AND t.date >= $1::date
            AND t.date <= $2::date
        WHERE u.role = 'employee'
        GROUP BY u.id, u.username, u.full_name, u.department
        ORDER BY u.username ASC
    `, [startDate, endDate]);

    return result.rows.filter((row) => row.total_submissions > 0);
};

const showDailyTaskSummaries = async (chatId, dateStr) => {
    const reportsRes = await db.query(`
        SELECT t.todays_task, u.username
        FROM tasks t
        JOIN users u ON t.user_id = u.id
        WHERE t.date = $1
        ORDER BY u.username ASC
    `, [dateStr]);

    if (!reportsRes.rows.length) {
        await telegramService.sendText(chatId, `📝 *Daily Report (${dateStr})*\n\n_No reports found for this date._`);
        return;
    }

    try {
        const rawReportText = reportsRes.rows.map((row) => {
            const name = row.username.charAt(0).toUpperCase() + row.username.slice(1);
            return `${name}\n${row.todays_task}`;
        }).join('\n\n');
        const summarizedBangla = await aiService.summarizeToBangla(rawReportText, dateStr);
        await telegramService.sendText(chatId, `📝 *Daily Report (${dateStr})*\n\n${summarizedBangla}`);
    } catch (err) {
        console.error('[TelegramController] AI Summary failed:', err.message);
        const fallbackList = reportsRes.rows.map((row) => `👤 *${escapeTelegram(row.username)}*:\n${escapeTelegram(row.todays_task)}`).join('\n\n');
        await sendLongText(chatId, `📝 *Daily Report (${dateStr})*\n\n${fallbackList}`);
    }
};

const showRangeTaskReport = async (chatId, title, label, startDate, endDate) => {
    const rows = await getEmployeeReportsForRange(startDate, endDate);
    if (!rows.length) {
        await telegramService.sendText(chatId, `No submissions found for ${escapeTelegram(label)}.`);
        return;
    }

    const text = `📄 *${escapeTelegram(title)}*\n\n*Period:* ${escapeTelegram(label)}\n*Employees with submissions:* ${rows.length}\n\n${rows.map((row) => (
        `*${escapeTelegram(row.full_name || row.username)}* (${escapeTelegram(row.department || 'No Department')})\n` +
        `Submissions: ${row.total_submissions}\n` +
        `${(row.tasks || []).map((task) => `• ${escapeTelegram(formatTelegramDate(task.date))}: ${escapeTelegram(truncateText(task.todays_task, 160))}${Array.isArray(task.attachments) && task.attachments.length ? ` [${task.attachments.length} file(s)]` : ''}`).join('\n')}`
    )).join('\n\n')}`;

    await sendLongText(chatId, text);
};

const showMonthlyAttendanceReport = async (chatId, dateStr) => {
    const date = parseYmdDate(dateStr);
    if (!date) {
        await telegramService.sendText(chatId, 'Invalid attendance month selection.');
        return;
    }

    const month = format(date, 'yyyy-MM');
    const [year, monthNum] = month.split('-').map(Number);
    const employeesResult = await db.query(
        'SELECT id, username, full_name, department FROM users WHERE deleted_at IS NULL AND role = $1 ORDER BY username',
        ['employee']
    );
    const tasksResult = await db.query(`
        SELECT user_id, EXTRACT(DAY FROM date)::int AS day
        FROM tasks
        WHERE EXTRACT(YEAR FROM date) = $1 AND EXTRACT(MONTH FROM date) = $2
        GROUP BY user_id, EXTRACT(DAY FROM date)
    `, [year, monthNum]);
    const activitiesResult = await db.query(`
        SELECT user_id, EXTRACT(DAY FROM timestamp)::int AS day
        FROM activity_logs
        WHERE activity_type = 'sign_in'
            AND EXTRACT(YEAR FROM timestamp) = $1
            AND EXTRACT(MONTH FROM timestamp) = $2
        GROUP BY user_id, EXTRACT(DAY FROM timestamp)
    `, [year, monthNum]);

    const attendanceMap = {};
    for (const row of [...tasksResult.rows, ...activitiesResult.rows]) {
        if (!attendanceMap[row.user_id]) {
            attendanceMap[row.user_id] = new Set();
        }
        attendanceMap[row.user_id].add(Number(row.day));
    }

    const workingDaysCount = await getWorkingDaysInMonth(date);
    const text = `📈 *Attendance Report (${escapeTelegram(format(date, 'MMMM yyyy'))})*\n\nWorking days: *${workingDaysCount}*\n\n${employeesResult.rows.map((employee) => {
        const activeDays = attendanceMap[employee.id] || new Set();
        return `• *${escapeTelegram(employee.full_name || employee.username)}* (${escapeTelegram(employee.department || 'No Department')}): ${activeDays.size}/${workingDaysCount}`;
    }).join('\n')}`;

    await sendLongText(chatId, text);
};

const openSingleDateCalendar = async (chatId, prefix, prompt) => {
    const keyboard = telegramCalendar.generateCalendar(new Date(), 'single', [], prefix);
    await telegramService.sendMessage(chatId, prompt, {
        reply_markup: { inline_keyboard: keyboard }
    });
};

const openMonthPicker = async (chatId, prefix, prompt) => {
    const keyboard = telegramCalendar.generateMonthPicker(new Date().getFullYear(), prefix);
    await telegramService.sendMessage(chatId, prompt, {
        reply_markup: { inline_keyboard: keyboard }
    });
};

const openYearPicker = async (chatId, prefix, prompt) => {
    const keyboard = telegramCalendar.generateYearPicker(new Date().getFullYear(), prefix);
    await telegramService.sendMessage(chatId, prompt, {
        reply_markup: { inline_keyboard: keyboard }
    });
};

const sendMainMenu = async (chatId, user, introMessage = '') => {
    const isManager = isManagerRole(user.role);
    const keyboard = [];

    if (!isManager) {
        keyboard.push([{ text: 'My Status' }, { text: 'Assigned Tasks' }]);
        if (user.status === 'active') {
            keyboard.push([{ text: 'Break' }, { text: 'Sign Out' }]);
        } else if (user.status === 'break') {
            keyboard.push([{ text: 'Resume' }, { text: 'Sign Out' }]);
        } else {
            keyboard.push([{ text: 'Sign' }]);
        }
        keyboard.push([{ text: 'My Projects' }, { text: 'Apply Leave' }]);
        keyboard.push([{ text: 'My Leaves' }, { text: 'Holidays' }]);
    } else {
        const row1 = [{ text: 'Projects' }];
        if (isModeratorRole(user.role)) {
            row1.unshift({ text: 'Assigned Tasks' });
        }
        keyboard.push(row1);
        keyboard.push([{ text: 'Assign Task' }]);
        keyboard.push([{ text: 'Holidays' }, { text: 'On Leave Now' }]);
        keyboard.push([{ text: 'Employee Status' }, { text: 'Daily Report' }]);
        keyboard.push([{ text: 'Weekly Report' }, { text: 'Monthly Report' }]);
        keyboard.push([{ text: 'Yearly Report' }, { text: 'Attendance Report' }]);
    }

    const privilegedRow = [];
    if (isManagerRole(user.role)) {
        privilegedRow.push({ text: 'Pending Leaves' });
    }
    if (isAdminRole(user.role)) {
        privilegedRow.push({ text: 'Profile Requests' });
    }
    if (privilegedRow.length > 0) {
        keyboard.push(privilegedRow);
    }

    if (isAdminRole(user.role)) {
        keyboard.push([{ text: 'Request Live Location' }]);
    }

    keyboard.push([{ text: 'Menu' }]);

    const welcome = introMessage || `Welcome, *${escapeTelegram(user.acting_admin_name || user.username)}* (${escapeTelegram(formatRoleLabel(user.role))}). Choose an action below.`;
    await telegramService.sendKeyboard(chatId, welcome, keyboard, true, false);
};
if (!global.tgUserStates) global.tgUserStates = new Map();
if (!global.tgProcessedIds) global.tgProcessedIds = new Map();

const handleTelegramUpdate = async (msg, io) => {
    try {
        if (!msg || !msg.chat) return;
        
        // 0. Ignore non-text messages (locations are handled by handleTelegramLocation)
        if (!msg.text || msg.location) return;

        const chatId = msg.chat.id;
        const msgId = msg.message_id;
        
        // Anti-duplicate check
        const nowMs = Date.now();
        if (msgId && global.tgProcessedIds.has(msgId)) return;
        if (msgId) {
            global.tgProcessedIds.set(msgId, nowMs);
            
            // Cleanup: every 50 messages, clear IDs older than 10 minutes
            if (global.tgProcessedIds.size % 50 === 0) {
                const expiry = nowMs - (10 * 60 * 1000);
                for (const [id, timestamp] of global.tgProcessedIds.entries()) {
                    if (timestamp < expiry) {
                        global.tgProcessedIds.delete(id);
                    }
                }
            }
        }

        const text = msg.text ? msg.text.trim() : '';
        const messageBody = text.toLowerCase();
        
        if (messageBody === '/diag') {
            const uptime = Math.floor(process.uptime());
            const memory = Math.round(process.memoryUsage().rss / 1024 / 1024);
            await telegramService.sendText(chatId, `🤖 *Bot Diagnostic*\n\nStatus: Online\nUptime: ${uptime}s\nMemory: ${memory}MB\nProcessed IDs: ${global.tgProcessedIds.size}`);
            return;
        }

        const normalizedMessageBody = messageBody.normalize('NFKC').replace(/\uFE0F/g, '').trim();
        const textCommand = normalizedMessageBody.replace(/^[^a-z0-9]+/i, '').trim();

        console.log(`[DEBUG] Handling command: "${textCommand}" for chatId: ${chatId}`);
        logToFile(`DEBUG: textCommand="${textCommand}"`);

        logToFile(`Received message from ${chatId}: "${text}"`);

        let user = await getUserByTelegramChatId(chatId);
        if (!global.tgUserStates) global.tgUserStates = new Map();

        // 1. Linking Flow
        const userState = global.tgUserStates.get(chatId.toString());

        if (messageBody.startsWith('/start')) {
            const parts = text.split(' ');
            const token = parts.length > 1 ? parts[1] : null;

            if (token) {
                logToFile(`Deep link start with token: ${token}`);
                
                const res = await db.query(
                    'SELECT * FROM users WHERE deleted_at IS NULL AND tg_link_token = $1 AND tg_link_expiry > NOW()',
                    [token]
                );
                
                if (res.rows.length > 0) {
                    const foundUser = res.rows[0];
                    await db.query('UPDATE users SET telegram_chat_id = $1, tg_link_token = NULL, tg_link_expiry = NULL WHERE id = $2', [chatId.toString(), foundUser.id]);
                    if (await isConfiguredTelegramAdminChatId(chatId)) {
                        foundUser.role = 'admin';
                    }
                    await telegramService.sendMessage(chatId, `Account linked successfully to *${foundUser.username}* (${formatRoleLabel(foundUser.role)}).`, { reply_markup: { remove_keyboard: true } });
                    logToFile(`Successfully linked ${chatId} to ${foundUser.username} via token`);
                    user = foundUser;
                    await sendMainMenu(chatId, foundUser);
                    return;
                } else {
                    logToFile(`Invalid or expired token: ${token}`);
                }
            }

            if (user) {
                if (textCommand === 'diag') {
                    const dbCheck = await db.query('SELECT 1').then(() => 'Connected').catch(e => `Error: ${e.message}`);
                    const diagMsg = `🤖 *Bot Diagnostics*\n\n` +
                        `• *User*: ${user.username}\n` +
                        `• *Role*: ${user.role}\n` +
                        `• *Chat ID*: ${chatId}\n` +
                        `• *Database*: ${dbCheck}\n` +
                        `• *Time*: ${new Date().toISOString()}`;
                    await telegramService.sendText(chatId, diagMsg);
                    return;
                }

                // If it's just /start without token, show welcome back
                if (!token) {
                    logToFile(`[handleTelegramUpdate] User already linked: ${user.username} (Role: ${user.role})`);
                    await telegramService.sendText(chatId, `Welcome back, *${user.username}* (${formatRoleLabel(user.role)}). You are already linked to this account.`);
                    await sendMainMenu(chatId, user);
                    return;
                }
            }

            await telegramService.sendKeyboard(
                chatId, 
                'Welcome to Track AI. Please tap the button below to share your phone number so we can securely link your account.', 
                [[{ text: 'Share Phone Number', request_contact: true }]], 
                true, 
                true
            );
            global.tgUserStates.set(chatId.toString(), { step: 'awaiting_phone' });
            return;
        }

        if (userState?.step === 'awaiting_phone') {
            let phoneNumber = '';
            
            if (msg.contact && msg.contact.phone_number) {
                phoneNumber = msg.contact.phone_number;
            } else if (text && text !== '/cancel') {
                phoneNumber = text;
            } else if (messageBody === '/cancel') {
                global.tgUserStates.delete(chatId.toString());
                await telegramService.sendMessage(chatId, 'Action cancelled.', { reply_markup: { remove_keyboard: true } });
                return;
            }
            if (phoneNumber) {
                const cleaned = normalizePhoneNumber(phoneNumber);
                const foundUser = await findUserByPhoneNumber(cleaned);
                logToFile(`Linking attempt for ${chatId}. Phone: "${phoneNumber}", Cleaned: "${cleaned}", Matched user: ${foundUser ? `${foundUser.username} (${foundUser.role})` : 'none'}`);

                if (!foundUser) {
                    const linkedAsAdmin = await linkTelegramAdminPhone(cleaned, chatId);

                    if (linkedAsAdmin) {
                        const adminUser = buildVirtualAdminUser({ chatId, phoneNumber: cleaned });
                        global.tgUserStates.delete(chatId.toString());
                        user = adminUser;
                        await telegramService.sendMessage(
                            chatId,
                            'Admin access linked successfully. You can now use the admin menu.',
                            { reply_markup: { remove_keyboard: true } }
                        );
                        await sendMainMenu(chatId, adminUser);
                    } else {
                        await telegramService.sendMessage(
                            chatId,
                            'please at first create an account on our website',
                            { reply_markup: { remove_keyboard: true } }
                        );
                    }
                } else {
                    await db.query('UPDATE users SET telegram_chat_id = $1 WHERE id = $2', [chatId.toString(), foundUser.id]);
                    if (await isConfiguredTelegramAdminChatId(chatId)) {
                        foundUser.role = 'admin';
                    }
                    await telegramService.sendMessage(chatId, `Account linked successfully to *${foundUser.username}* (${formatRoleLabel(foundUser.role)}).`, { reply_markup: { remove_keyboard: true } });
                    global.tgUserStates.delete(chatId.toString());
                    user = foundUser;
                    await sendMainMenu(chatId, foundUser);
                }
                return;
            }
        }

        if (messageBody === '/cancel') {
            if (isAssignTaskWizardStep(userState?.step)) {
                await cancelAssignTaskWizard(chatId, userState, 'Assign Task wizard cancelled.');
                global.tgUserStates.delete(chatId.toString());
                await sendMainMenu(chatId, user);
                return;
            }
            global.tgUserStates.delete(chatId.toString());
            await telegramService.sendMessage(chatId, 'Action cancelled.', { reply_markup: { remove_keyboard: true } });
            return;
        }

        if (!user) {
            await telegramService.sendText(chatId, 'Your account is not linked yet. Send /start to begin.');
            return;
        }

        if (userState?.step === 'awaiting_assign_task_project') {
            await renderAssignTaskWizard(chatId, user, userState);
            return;
        }

        if (userState?.step === 'awaiting_assign_task_title') {
            if (!text || !text.trim()) {
                await telegramService.sendText(chatId, 'Task title is required.');
                return;
            }

            const nextState = await renderAssignTaskWizard(chatId, user, {
                ...userState,
                step: 'awaiting_assign_task_description',
                title: text.trim()
            });
            global.tgUserStates.set(chatId.toString(), nextState);
            return;
        }

        if (userState?.step === 'awaiting_assign_task_description') {
            if (!text || !text.trim()) {
                await telegramService.sendText(chatId, 'Send a description or press Skip Description.');
                return;
            }

            const projectMembers = await getProjectEmployeeMembers(userState.projectId);
            if (!projectMembers.length) {
                global.tgUserStates.delete(chatId.toString());
                await cancelAssignTaskWizard(chatId, userState, 'No employee members found in this project. Add employee members first.');
                return;
            }

            const nextState = await renderAssignTaskWizard(chatId, user, {
                ...userState,
                step: 'awaiting_assign_task_members',
                description: text.trim(),
                selectedAssigneeIds: []
            }, { members: projectMembers });
            global.tgUserStates.set(chatId.toString(), nextState);
            return;
        }

        if (userState?.step === 'awaiting_assign_task_members') {
            await renderAssignTaskWizard(chatId, user, userState);
            return;
        }

        if (userState?.step === 'awaiting_assign_task_priority') {
            await renderAssignTaskWizard(chatId, user, userState);
            return;
        }

        if (userState?.step === 'awaiting_leave_dates') {
            const parsed = parseLeaveDatesInput(text);
            if (parsed.error) {
                await telegramService.sendText(chatId, `Error: ${parsed.error}\n\nExample:\n- \`15-04-2026\`\n- \`15-04-2026 to 18-04-2026\`\n- \`15-04-2026, 18-04-2026\``);
                return;
            }

            const { validDates, skippedDates } = await filterApplicableLeaveDates(user, parsed.dates);
            if (validDates.length === 0) {
                await telegramService.sendText(chatId, `Error: No valid working days found in that selection.\n\nSkipped:\n${skippedDates.map(item => `- ${formatTelegramDate(item.date)} (${item.reason})`).join('\n')}`);
                return;
            }

            global.tgUserStates.set(chatId.toString(), {
                step: 'awaiting_leave_type',
                leaveDates: validDates
            });
            await promptLeaveTypeSelection(chatId, validDates, skippedDates);
            return;
        }

        if (userState?.step === 'awaiting_leave_type') {
            if (!['paid', 'unpaid'].includes(messageBody)) {
                await telegramService.sendText(chatId, 'Choose leave type from the buttons, or send `paid` or `unpaid`.');
                return;
            }

            global.tgUserStates.set(chatId.toString(), {
                step: 'awaiting_leave_reason',
                leaveDates: userState.leaveDates,
                leaveType: messageBody
            });
            await telegramService.sendText(chatId, `Selected *${messageBody.toUpperCase()}* leave.\nNow send the leave reason.`);
            return;
        }

        if (userState?.step === 'awaiting_leave_reason') {
            if (!text || !text.trim()) {
                await telegramService.sendText(chatId, 'Leave reason is required. Send your reason or type /cancel.');
                return;
            }

            try {
                const result = await createLeaveRequestInternal({
                    userId: user.id,
                    username: user.username,
                    leaveDates: userState.leaveDates,
                    reason: text.trim(),
                    leaveType: userState.leaveType,
                    io
                });

                global.tgUserStates.delete(chatId.toString());
                await telegramService.sendText(
                    chatId,
                    `*Leave request submitted*\n\nType: *${userState.leaveType.toUpperCase()}*\nDays: *${result.count}*\nDates:\n${userState.leaveDates.map(d => `- ${formatTelegramDate(d)}`).join('\n')}`
                );
                await sendMainMenu(chatId, user);
            } catch (err) {
                console.error('[TelegramController] Leave request failed:', err);
                await telegramService.sendText(chatId, err.statusCode ? err.message : 'Failed to submit leave request.');
            }
            return;
        }

        logToFile(`Processing with messengerHandler. user.role=${user.role} messageBody="${messageBody}"`);

        const platform = {
            sendText: (to, text) => telegramService.sendText(to, text),
            sendButtons: (to, text, buttons) => telegramService.sendInlineKeyboard(to, text, [buttons.map(b => ({ text: b.text, callback_data: b.id }))]),
            sendList: (to, text, buttonText, sections) => {
                const buttons = sections.flatMap(s => s.rows.map(r => [{ text: r.title, callback_data: r.id }]));
                return telegramService.sendInlineKeyboard(to, text, buttons);
            },
            sendCalendar: (to, text, baseDate, mode, selectedDates, prefix) => {
                const keyboard = telegramCalendar.generateCalendar(baseDate, mode, selectedDates, prefix);
                return telegramService.sendMessage(to, text, { reply_markup: { inline_keyboard: keyboard } });
            },
            sendMainMenu: (to, user, msg) => sendMainMenu(to, user, msg),
            formatBold: (text) => `*${escapeTelegram(text)}*`,
            formatItalic: (text) => `_${escapeTelegram(text)}_`,
            formatDivider: () => `━━━━━━━━━━━━━━━`
        };

        // 2. Delegate to Unified Handler
        const handled = await messengerHandler.handleEmployeeMessage({
            user,
            identifier: chatId.toString(),
            platform,
            stateMap: global.tgUserStates,
            messageBody: messageBody,
            buttonId: '',
            io,
            authController
        });

        logToFile(`DEBUG: messengerHandler handled=${handled}`);
        if (handled) return;

        logToFile(`DEBUG: textCommand="${textCommand}" user.role="${user.role}"`);

        // 3. Handle Other Commands
        if (messageBody === '/option' || textCommand === 'menu') {
            await sendMainMenu(chatId, user);
        } else if (textCommand === 'apply leave') {
            global.tgUserStates.set(chatId.toString(), { step: 'awaiting_leave_dates', selectedDates: [], calendarMonth: Date.now() });
            const calendarBaseDate = new Date();
            const keyboard = telegramCalendar.generateCalendar(calendarBaseDate, 'multi', [], 'leave_cal');
            await telegramService.sendMessage(chatId, 'Select leave dates using the calendar below. Click ✅ Done when finished.', {
                reply_markup: { inline_keyboard: keyboard }
            });
        } else if (textCommand === 'holidays') {
            await showUpcomingHolidays(chatId);
        } else if (textCommand === 'my leaves') {
            await showMyLeaves(chatId, user);
        } else if (textCommand === 'my status') {
            if (isManagerRole(user.role)) {
                await telegramService.sendText(chatId, `📊 *Status*\n\n👤 *User*: ${user.username}\n🟢 *Current State*: ${user.status.toUpperCase()}\n\n${escapeTelegram('— ' + (user.company_name || 'Daily Task Team'))}`);
            } else {
                const attendanceService = require('../utils/attendanceService');
                const { totalHours } = await attendanceService.calculateHoursWorkedToday(user.id);
                const balance = ((user.minutes_balance || 0) / 60).toFixed(2);
                await telegramService.sendText(chatId, `📊 *My Status*\n\n⏱️ *Worked Today*: ${totalHours.toFixed(2)} hrs\n⚖️ *Balance*: ${balance} hrs\n🟢 *Current State*: ${user.status.toUpperCase()}`);
            }
        } else if (textCommand === 'assigned tasks') {
            await showAssignedTasks(chatId, user);
        } else if (textCommand === 'assign task') {
            await openAssignTaskProjectPicker(chatId, user);
        } else if (textCommand === 'my projects' || textCommand === 'projects') {
            logToFile(`DEBUG: Entering Projects menu handler`);
            await showProjectsMenu(chatId, user);
        } else if (isManagerRole(user.role)) {
            logToFile(`DEBUG: Entering ManagerRole block`);
            if (textCommand === 'employee status') {
                await showEmployeeStatus(chatId, user);
            } else if (textCommand === 'task summaries' || textCommand === 'daily report') {
                await openSingleDateCalendar(chatId, 'task_cal', '📅 Select a date to view the daily report:');
            } else if (textCommand === 'weekly report') {
                await openSingleDateCalendar(chatId, 'weekly_report_cal', '📅 Select any date in the week you want to report:');
            } else if (textCommand === 'monthly report') {
                await openMonthPicker(chatId, 'monthly_report_cal', '📅 Select the month for the report:');
            } else if (textCommand === 'yearly report') {
                await openYearPicker(chatId, 'yearly_report_cal', '📅 Select the year for the report:');
            } else if (textCommand === 'attendance report') {
                logToFile('DEBUG: Handling attendance report command');
                await openMonthPicker(chatId, 'attendance_report_cal', '📅 Select the month for the attendance report:');
            } else if (textCommand === 'project report') {
                await telegramService.sendText(chatId, 'Project report has been removed. Open Projects and use the Summary button for each project.');
            } else if ((textCommand === 'request live location' || textCommand === 'live location') && isAdminRole(user.role)) {
                await showLocationRequestPicker(chatId, user);
            } else if (textCommand === 'pending leaves') {
                await showPendingLeaves(chatId, user);
            } else if (textCommand === 'on leave now') {
                await showOnLeaveNow(chatId);
            } else if (textCommand === 'profile requests' && isAdminRole(user.role)) {
                await showPendingProfileRequests(chatId, user);
            }
        }
    } catch (error) {
        console.error('[TelegramController] Update Error:', error);
        logToFile(`CRITICAL ERROR: ${error.message}\n${error.stack}`);
    }
};

const handleTelegramCallback = async (query, io) => {
    try {
        const chatId = query.message.chat.id;
        const data = query.data;
        const bot = telegramService.getBot();

        const user = await getUserByTelegramChatId(chatId);

        if (bot) {
            await bot.answerCallbackQuery(query.id).catch(() => {});
        }

        if (!user) {
            await telegramService.sendText(chatId, 'Your account is not linked yet.');
            return;
        }

        logToFile(`Processing callback with messengerHandler. user.role=${user.role} data="${data}"`);
        const platform = {
            sendText: (to, text) => telegramService.sendText(to, text),
            sendButtons: (to, text, buttons) => telegramService.sendInlineKeyboard(to, text, [buttons.map(b => ({ text: b.text, callback_data: b.id }))]),
            sendList: (to, text, buttonText, sections) => {
                const buttons = [];
                sections.forEach(s => s.rows.forEach(r => buttons.push([{ text: r.title, callback_data: r.id }])));
                return telegramService.sendInlineKeyboard(to, text, buttons);
            },
            sendCalendar: (to, text, baseDate, mode, selectedDates, prefix) => {
                const keyboard = telegramCalendar.generateCalendar(baseDate, mode, selectedDates, prefix);
                return telegramService.sendMessage(to, text, { reply_markup: { inline_keyboard: keyboard } });
            },
            sendMainMenu: (to, user, msg) => sendMainMenu(to, user, msg),
            formatBold: (text) => `*${escapeTelegram(text)}*`,
            formatDivider: () => "━━━━━━━━━━━━━━━"
        };

        if (!global.tgUserStates) {
            global.tgUserStates = new Map();
        }
        console.log(`[TelegramController] Callback received: ${data} from ${chatId} (${user?.username || "Unknown"})`);

        // --- 1. Admin/Moderator Actions (Priority) ---
        if (data.startsWith('tg_leave_approve_') || data.startsWith('tg_leave_reject_') || 
            data.startsWith('tg_leave_proceed_') || data.startsWith('tg_leave_decline_')) {
            
            const isModeratorAction = data.startsWith('tg_leave_proceed_') || data.startsWith('tg_leave_decline_');
            const isApproveReject = data.startsWith('tg_leave_approve_') || data.startsWith('tg_leave_reject_');

            if (isApproveReject && !isAdminRole(user.role)) {
                if (bot) {
                    await bot.answerCallbackQuery(query.id, {
                        text: 'Only admins can approve/reject leave requests.',
                        show_alert: true
                    }).catch(() => {});
                } else {
                    await telegramService.sendText(chatId, 'Only admins can approve/reject leave requests.');
                }
                return;
            }

            if (isModeratorAction && !isManagerRole(user.role)) {
                if (bot) {
                    await bot.answerCallbackQuery(query.id, {
                        text: 'Only project managers or admins can proceed/decline leave requests.',
                        show_alert: true
                    }).catch(() => {});
                } else {
                    await telegramService.sendText(chatId, 'Only project managers or admins can proceed/decline leave requests.');
                }
                return;
            }

            if (bot) bot.answerCallbackQuery(query.id).catch(() => {});

            const requestId = data.replace('tg_leave_approve_', '')
                                 .replace('tg_leave_reject_', '')
                                 .replace('tg_leave_proceed_', '')
                                 .replace('tg_leave_decline_', '');

            try {
                if (isApproveReject) {
                    const isApprove = data.startsWith('tg_leave_approve_');
                    const newStatus = isApprove ? 'approved' : 'rejected';
                    const result = await updateLeaveStatusByRequestIdInternal({
                        requestId,
                        status: newStatus,
                        io,
                        actedByUserId: user.id || null,
                        actedByName: user.full_name || user.acting_admin_name || user.username || 'Admin',
                        excludeTelegramChatIds: [chatId],
                        expectedCompanyId: user.company_id || null
                    });

                    if (bot && query.message) {
                        const originalText = query.message.text || 'Leave Request';
                        const updatedText = `${originalText}\n\n${result.summary.telegramText}`;
                        try {
                            await bot.editMessageText(updatedText, {
                                chat_id: chatId,
                                message_id: query.message.message_id,
                                parse_mode: 'Markdown'
                            });
                        } catch (e) {
                            await bot.editMessageText(`${originalText}\n\n${result.summary.plainText}`, {
                                chat_id: chatId,
                                message_id: query.message.message_id
                            }).catch(() => {});
                        }
                        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                            chat_id: chatId,
                            message_id: query.message.message_id
                        }).catch(() => {});
                    } else {
                        await telegramService.sendText(chatId, result.summary.telegramText);
                    }
                } else if (isModeratorAction) {
                    const isProceed = data.startsWith('tg_leave_proceed_');
                    const mockReq = { params: { requestId }, user, app: { get: (k) => k === 'io' ? io : null } };
                    const mockRes = { 
                        json: async (payload) => {
                            const originalText = query.message?.text || 'Leave Request';
                            const statusLabel = isProceed ? '✅ Proceeded to HR' : '❌ Declined by PM';
                            if (bot && query.message) {
                                await bot.editMessageText(`${originalText}\n\n*Moderator Action:* ${statusLabel}`, {
                                    chat_id: chatId,
                                    message_id: query.message.message_id,
                                    parse_mode: 'Markdown'
                                }).catch(() => {});
                                await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                                    chat_id: chatId,
                                    message_id: query.message.message_id
                                }).catch(() => {});
                            } else {
                                await telegramService.sendText(chatId, statusLabel);
                            }
                        },
                        status: () => ({ json: (p) => telegramService.sendText(chatId, p.error || 'Error') })
                    };

                    if (isProceed) {
                        await proceedLeaveStatusByRequestId(mockReq, mockRes);
                    } else {
                        await declineLeaveStatusByRequestId(mockReq, mockRes);
                    }
                }
            } catch (err) {
                console.error('[TelegramController] Leave Action Error:', err);
                await telegramService.sendText(chatId, err.message || 'Action failed.');
            }
        } else if (data.startsWith('tg_profile_approve_') || data.startsWith('tg_profile_reject_')) {
            if (!isAdminRole(user.role)) {
                if (bot) {
                    await bot.answerCallbackQuery(query.id, {
                        text: 'Only admins can approve/reject profile requests.',
                        show_alert: true
                    }).catch(() => {});
                } else {
                    await telegramService.sendText(chatId, 'Only admins can approve/reject profile requests.');
                }
                return;
            }

            if (bot) bot.answerCallbackQuery(query.id).catch(() => {});
            const isApprove = data.startsWith('tg_profile_approve_');
            const requestIdRaw = data.replace(isApprove ? 'tg_profile_approve_' : 'tg_profile_reject_', '');
            const requestId = Number.parseInt(requestIdRaw, 10);
            if (!Number.isInteger(requestId) || requestId <= 0) {
                await telegramService.sendText(chatId, `Invalid profile request id: ${requestIdRaw}`);
                return;
            }
            const newStatus = isApprove ? 'approved' : 'rejected';
            
            try {
                const adminController = require('./adminController');
                let httpStatusCode = 200;
                const reqMock = {
                    params: { requestId },
                    body: { status: newStatus },
                    user: {
                        id: user.id || null,
                        username: user.acting_admin_name || user.username || 'Admin',
                        acting_admin_name: user.acting_admin_name || null,
                        email: user.email || null,
                        telegram_chat_id: user.telegram_chat_id || String(chatId)
                    },
                    app: { get: () => io }
                };
                const resMock = {
                    status: function(code) {
                        httpStatusCode = code;
                        return this;
                    },
                    json: async function(jsonData) {
                        if (httpStatusCode >= 400 || jsonData.error) {
                            await telegramService.sendText(chatId, `Failed to process profile update: ${jsonData.error || 'Unknown error'}`);
                            return;
                        }

                        if (bot && query.message) {
                            const originalText = query.message.text || '';
                            const updatedText = `${originalText}\n\n*[${newStatus.toUpperCase()}]*`;

                            await bot.editMessageText(updatedText, {
                                chat_id: chatId,
                                message_id: query.message.message_id,
                                parse_mode: 'Markdown'
                            }).catch(err => console.error('[TelegramController] Edit error:', err.message));

                            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                                chat_id: chatId,
                                message_id: query.message.message_id
                            }).catch(() => {});
                        } else {
                            await telegramService.sendText(chatId, `Profile request ${newStatus}.`);
                        }
                    }
                };
                await adminController.handleProfileRequest(reqMock, resMock);
            } catch (err) {
                console.error('[TelegramController] Profile callback failed:', err);
                await telegramService.sendText(chatId, 'Failed to process profile request. Please try again.');
            }
        } else if (data === 'cancel') {
            if (bot) bot.answerCallbackQuery(query.id).catch(() => {});
            const callbackState = global.tgUserStates.get(chatId.toString());
            if (isAssignTaskWizardStep(callbackState?.step)) {
                await cancelAssignTaskWizard(chatId, callbackState, 'Assign Task wizard cancelled.');
                global.tgUserStates.delete(chatId.toString());
                await sendMainMenu(chatId, user);
                return;
            }
            global.tgUserStates.delete(chatId.toString());
            await telegramService.sendText(chatId, 'Action cancelled.');
            return;
        } else {
             if (bot) bot.answerCallbackQuery(query.id).catch(() => {});
        }

        // --- 2. Employee State Handlers ---
        const handled = await messengerHandler.handleEmployeeMessage({
            user,
            identifier: chatId.toString(),
            platform,
            stateMap: global.tgUserStates,
            messageBody: '',
            buttonId: data,
            io,
            authController
        });

        if (handled) return;

        const userState = global.tgUserStates.get(chatId.toString());

        if (data === ASSIGN_TASK_CANCEL) {
            if (isAssignTaskWizardStep(userState?.step)) {
                await cancelAssignTaskWizard(chatId, userState, 'Assign Task wizard cancelled.');
            }
            global.tgUserStates.delete(chatId.toString());
            await sendMainMenu(chatId, user);
            return;
        }

        if (data === ASSIGN_TASK_BACK_TO_MENU) {
            if (isAssignTaskWizardStep(userState?.step)) {
                await cancelAssignTaskWizard(chatId, userState, 'Assign Task wizard closed.');
            }
            global.tgUserStates.delete(chatId.toString());
            await sendMainMenu(chatId, user);
            return;
        }

        if (data === ASSIGN_TASK_BACK_TO_PROJECT && isAssignTaskWizardStep(userState?.step)) {
            const nextState = await renderAssignTaskWizard(chatId, user, {
                step: 'awaiting_assign_task_project',
                wizardMessageId: userState?.wizardMessageId
            });
            global.tgUserStates.set(chatId.toString(), nextState);
            return;
        }

        if (data === ASSIGN_TASK_BACK_TO_TITLE && userState?.step === 'awaiting_assign_task_description') {
            const nextState = await renderAssignTaskWizard(chatId, user, {
                ...userState,
                step: 'awaiting_assign_task_title'
            });
            global.tgUserStates.set(chatId.toString(), nextState);
            return;
        }

        if (data === ASSIGN_TASK_BACK_TO_DESCRIPTION && userState?.step === 'awaiting_assign_task_members') {
            const nextState = await renderAssignTaskWizard(chatId, user, {
                ...userState,
                step: 'awaiting_assign_task_description'
            });
            global.tgUserStates.set(chatId.toString(), nextState);
            return;
        }

        if (data === ASSIGN_TASK_BACK_TO_MEMBERS && userState?.step === 'awaiting_assign_task_priority') {
            const projectMembers = await getProjectEmployeeMembers(userState.projectId);
            const nextState = await renderAssignTaskWizard(chatId, user, {
                ...userState,
                step: 'awaiting_assign_task_members'
            }, { members: projectMembers });
            global.tgUserStates.set(chatId.toString(), nextState);
            return;
        }

        if (data.startsWith(ASSIGN_TASK_PROJECT_PREFIX)) {
            if (!isManagerRole(user.role)) {
                await telegramService.sendText(chatId, 'Only admins and moderators can assign tasks.');
                return;
            }

            const projectId = Number.parseInt(data.replace(ASSIGN_TASK_PROJECT_PREFIX, ''), 10);
            if (!Number.isInteger(projectId) || projectId <= 0) {
                await telegramService.sendText(chatId, 'Invalid project selection.');
                return;
            }

            if (!await ensureProjectAccess(projectId, user)) {
                await telegramService.sendText(chatId, 'Not authorized to assign tasks in this project.');
                return;
            }

            const projectRes = await db.query('SELECT id, name FROM projects WHERE deleted_at IS NULL AND id = $1 AND deleted_at IS NULL', [projectId]);
            if (!projectRes.rows.length) {
                await telegramService.sendText(chatId, 'Project not found.');
                return;
            }

            const nextState = await renderAssignTaskWizard(chatId, user, {
                step: 'awaiting_assign_task_title',
                projectId,
                projectName: projectRes.rows[0].name,
                description: '',
                selectedAssigneeIds: [],
                wizardMessageId: userState?.wizardMessageId || query?.message?.message_id
            });
            global.tgUserStates.set(chatId.toString(), nextState);
            return;
        }

        if (data === ASSIGN_TASK_SKIP_DESCRIPTION) {
            if (userState?.step !== 'awaiting_assign_task_description') {
                return;
            }

            const projectMembers = await getProjectEmployeeMembers(userState.projectId);
            if (!projectMembers.length) {
                global.tgUserStates.delete(chatId.toString());
                await cancelAssignTaskWizard(chatId, userState, 'No employee members found in this project. Add employee members first.');
                return;
            }

            const nextState = await renderAssignTaskWizard(chatId, user, {
                ...userState,
                step: 'awaiting_assign_task_members',
                description: '',
                selectedAssigneeIds: []
            }, { members: projectMembers });
            global.tgUserStates.set(chatId.toString(), nextState);
            return;
        }

        if (data.startsWith(ASSIGN_TASK_MEMBER_TOGGLE_PREFIX)) {
            if (userState?.step !== 'awaiting_assign_task_members') {
                return;
            }

            const memberId = Number.parseInt(data.replace(ASSIGN_TASK_MEMBER_TOGGLE_PREFIX, ''), 10);
            if (!Number.isInteger(memberId) || memberId <= 0) {
                return;
            }

            const projectMembers = await getProjectEmployeeMembers(userState.projectId);
            const memberExists = projectMembers.some((member) => Number(member.id) === memberId);
            if (!memberExists) {
                return;
            }

            const selected = new Set((userState.selectedAssigneeIds || []).map((id) => Number(id)));
            if (selected.has(memberId)) {
                selected.delete(memberId);
            } else {
                selected.add(memberId);
            }

            const nextState = {
                ...userState,
                selectedAssigneeIds: [...selected]
            };
            const renderedState = await renderAssignTaskWizard(chatId, user, nextState, { members: projectMembers });
            global.tgUserStates.set(chatId.toString(), renderedState);
            return;
        }

        if (data === ASSIGN_TASK_MEMBER_DONE) {
            if (userState?.step !== 'awaiting_assign_task_members') {
                return;
            }

            const projectMembers = await getProjectEmployeeMembers(userState.projectId);
            const validMemberIdSet = new Set(projectMembers.map((member) => Number(member.id)));
            const selectedAssigneeIds = Array.from(
                new Set((userState.selectedAssigneeIds || []).map((id) => Number(id)))
            ).filter((id) => validMemberIdSet.has(id));

            if (selectedAssigneeIds.length === 0) {
                if (bot) {
                    await bot.answerCallbackQuery(query.id, {
                        text: 'Select at least one member.',
                        show_alert: true
                    }).catch(() => {});
                } else {
                    await telegramService.sendText(chatId, 'Select at least one member.');
                }
                return;
            }

            const nextState = await renderAssignTaskWizard(chatId, user, {
                ...userState,
                step: 'awaiting_assign_task_priority',
                selectedAssigneeIds,
                priority: userState.priority || 'medium'
            });
            global.tgUserStates.set(chatId.toString(), nextState);
            return;
        }

        if (data.startsWith(ASSIGN_TASK_PRIORITY_PREFIX)) {
            if (userState?.step !== 'awaiting_assign_task_priority') {
                return;
            }

            const value = data.replace(ASSIGN_TASK_PRIORITY_PREFIX, '');
            const allowed = new Set(['low', 'medium', 'high', 'urgent']);
            if (!allowed.has(value)) {
                return;
            }

            const nextState = await renderAssignTaskWizard(chatId, user, {
                ...userState,
                priority: value
            });
            global.tgUserStates.set(chatId.toString(), nextState);
            return;
        }

        if (data === ASSIGN_TASK_CREATE) {
            if (userState?.step !== 'awaiting_assign_task_priority') {
                return;
            }

            const projectMembers = await getProjectEmployeeMembers(userState.projectId);
            const validMemberIdSet = new Set(projectMembers.map((member) => Number(member.id)));
            const selectedAssigneeIds = Array.from(
                new Set((userState.selectedAssigneeIds || []).map((id) => Number(id)))
            ).filter((id) => validMemberIdSet.has(id));

            if (selectedAssigneeIds.length === 0) {
                if (bot) {
                    await bot.answerCallbackQuery(query.id, {
                        text: 'Select at least one member.',
                        show_alert: true
                    }).catch(() => {});
                }
                return;
            }

            const taskId = await createTaskFromTelegram({
                projectId: userState.projectId,
                title: userState.title,
                description: userState.description || '',
                assigneeIds: selectedAssigneeIds,
                priority: userState.priority || 'medium',
                actorUser: { ...user, io }
            });

            global.tgUserStates.delete(chatId.toString());
            await cancelAssignTaskWizard(
                chatId,
                userState,
                `Task assigned successfully.\n\nProject: ${escapeTelegram(userState.projectName)}\nTask ID: ${taskId}\nTitle: ${escapeTelegram(userState.title)}\nPriority: ${escapeTelegram((userState.priority || 'medium').toUpperCase())}\nAssignees: ${selectedAssigneeIds.length}`
            );
            await sendMainMenu(chatId, user);
            return;
        }

        if (data === REQUEST_LOCATION_BACK) {
            await sendMainMenu(chatId, user);
            return;
        }

        if (data.startsWith(REQUEST_LOCATION_CALLBACK_PREFIX)) {
            if (!isAdminRole(user.role)) {
                await telegramService.sendText(chatId, 'Only admins can request live location.');
                return;
            }

            const employeeId = Number.parseInt(data.replace(REQUEST_LOCATION_CALLBACK_PREFIX, ''), 10);
            if (!Number.isInteger(employeeId) || employeeId <= 0) {
                await telegramService.sendText(chatId, 'Invalid employee selection.');
                return;
            }

            try {
                const result = await requestEmployeeLocationByAdmin(employeeId, user);
                await telegramService.sendText(
                    chatId,
                    `${result.message}\nEmployee: ${escapeTelegram(result.user?.username || String(employeeId))}`
                );
            } catch (err) {
                await telegramService.sendText(chatId, err?.message || 'Failed to request employee location.');
            }

            return;
        }

        if (data === 'tg_projects_back') {
            await showProjectsMenu(chatId, user);
            return;
        }

        if (data === 'tg_project_bin') {
            if (bot) bot.answerCallbackQuery(query.id).catch(() => {});
            await handleProjectBin(chatId, user);
            return;
        }

        if (data.startsWith('tg_project_restore_')) {
            if (bot) bot.answerCallbackQuery(query.id).catch(() => {});
            const projectId = data.replace('tg_project_restore_', '');
            await handleProjectRestore(chatId, user, projectId);
            return;
        }

        if (data.startsWith('tg_project_log_')) {
            await telegramService.sendText(chatId, 'Project log has been removed. Use the project Summary button instead.');
            return;
        }

        if (data.startsWith('tg_project_view_')) {
            const projectId = Number.parseInt(data.replace('tg_project_view_', ''), 10);
            await showProjectDetails(chatId, user, projectId);
            return;
        }

        if (data.startsWith('tg_project_tasks_')) {
            const projectId = Number.parseInt(data.replace('tg_project_tasks_', ''), 10);
            await showProjectTasks(chatId, user, projectId);
            return;
        }

        if (data.startsWith('tg_project_summary_')) {
            const projectId = Number.parseInt(data.replace('tg_project_summary_', ''), 10);
            await showProjectSummary(chatId, user, projectId);
            return;
        }

        if (data.startsWith('leave_cal_')) {
            if (userState?.step !== 'awaiting_leave_dates') return;
            if (data === 'leave_cal_done') {
                 if (!userState.selectedDates || userState.selectedDates.length === 0) {
                     if (bot) bot.answerCallbackQuery(query.id, { text: 'Please select at least one date.', show_alert: true }).catch(()=>{});
                     return;
                 }
                 const { validDates, skippedDates } = await filterApplicableLeaveDates(user, userState.selectedDates);
                 if (validDates.length === 0) {
                     await telegramService.sendText(chatId, `Error: No valid working days found.\n\nSkipped:\n${skippedDates.map(item => `- ${formatTelegramDate(item.date)} (${item.reason})`).join('\n')}`);
                     return;
                 }
                 global.tgUserStates.set(chatId.toString(), {
                     step: 'awaiting_leave_type',
                     leaveDates: validDates
                 });
                 if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }).catch(()=>{});
                 await promptLeaveTypeSelection(chatId, validDates, skippedDates);
                 return;
            } else if (data.startsWith('leave_cal_sel_')) {
                 const dateStr = data.replace('leave_cal_sel_', '');
                 let selectedDates = userState.selectedDates || [];
                 if (selectedDates.includes(dateStr)) selectedDates = selectedDates.filter(d => d !== dateStr);
                 else selectedDates.push(dateStr);
                 userState.selectedDates = selectedDates;
                 global.tgUserStates.set(chatId.toString(), userState);
                 const parsedDates = selectedDates.map(d => parseYmdDate(d)).filter(Boolean);
                 const calendarBaseDate = new Date(userState.calendarMonth || Date.now());
                 const keyboard = telegramCalendar.generateCalendar(calendarBaseDate, 'multi', parsedDates, 'leave_cal');
                 if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: chatId, message_id: query.message.message_id }).catch(()=>{});
                 return;
            } else {
                 const newNavDate = telegramCalendar.handleNavigation(data, 'leave_cal');
                 if (newNavDate) {
                     userState.calendarMonth = newNavDate.getTime();
                     global.tgUserStates.set(chatId.toString(), userState);
                     const parsedDates = (userState.selectedDates || []).map(d => parseYmdDate(d)).filter(Boolean);
                     const keyboard = telegramCalendar.generateCalendar(newNavDate, 'multi', parsedDates, 'leave_cal');
                     if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: chatId, message_id: query.message.message_id }).catch(()=>{});
                     return;
                 }
            }
        }

        if (data.startsWith('cover_cal_')) {
            if (userState?.step !== 'awaiting_cover_date') return;
            if (data.startsWith('cover_cal_sel_')) {
                const dateStr = data.replace('cover_cal_sel_', '');
                if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }).catch(()=>{});
                await messengerHandler.handleEmployeeMessage({
                    user,
                    identifier: chatId.toString(),
                    platform,
                    stateMap: global.tgUserStates,
                    messageBody: dateStr,
                    buttonId: '',
                    io,
                    authController
                });
                return;
            } else {
                const newNavDate = telegramCalendar.handleNavigation(data, 'cover_cal');
                if (newNavDate) {
                    userState.coverCalendarMonth = newNavDate.getTime();
                    global.tgUserStates.set(chatId.toString(), userState);
                    const keyboard = telegramCalendar.generateCalendar(newNavDate, 'single', [], 'cover_cal');
                    if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: chatId, message_id: query.message.message_id }).catch(()=>{});
                    return;
                }
            }
        }

        if (data.startsWith('task_cal_')) {
            if (data.startsWith('task_cal_sel_')) {
                const dateStr = data.replace('task_cal_sel_', '');
                if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }).catch(()=>{});
                await showDailyTaskSummaries(chatId, dateStr);
                return;
            } else {
                const newNavDate = telegramCalendar.handleNavigation(data, 'task_cal');
                if (newNavDate) {
                    const keyboard = telegramCalendar.generateCalendar(newNavDate, 'single', [], 'task_cal');
                    if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: chatId, message_id: query.message.message_id }).catch(()=>{});
                    return;
                }
            }
        }

        if (data.startsWith('weekly_report_cal_')) {
            if (data.startsWith('weekly_report_cal_sel_')) {
                const dateStr = data.replace('weekly_report_cal_sel_', '');
                const selectedDate = parseYmdDate(dateStr);
                if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
                const workHours = await getWorkHoursSettings();
                const startDate = getReportWeekStartDate(selectedDate, workHours.weekendDays || [5, 6]);
                const endDate = getReportWeekEndDate(startDate, workHours.weekendDays || [5, 6]);
                await showRangeTaskReport(chatId, 'Weekly Report', `${formatTelegramDate(formatYmdDate(startDate))} - ${formatTelegramDate(formatYmdDate(endDate))}`, formatYmdDate(startDate), formatYmdDate(endDate));
                return;
            }
            const newNavDate = telegramCalendar.handleNavigation(data, 'weekly_report_cal');
            if (newNavDate) {
                const keyboard = telegramCalendar.generateCalendar(newNavDate, 'single', [], 'weekly_report_cal');
                if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
                return;
            }
        }

        if (data.startsWith('monthly_report_cal_')) {
            if (data.startsWith('monthly_report_cal_sel_')) {
                const dateStr = data.replace('monthly_report_cal_sel_', '');
                const selectedDate = parseYmdDate(dateStr);
                if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
                const startDate = getMonthStartDate(selectedDate);
                const endDate = getMonthEndDate(selectedDate);
                await showRangeTaskReport(chatId, 'Monthly Report', format(selectedDate, 'MMMM yyyy'), formatYmdDate(startDate), formatYmdDate(endDate));
                return;
            }
            const newNavValue = telegramCalendar.handleNavigation(data, 'monthly_report_cal');
            if (newNavValue) {
                const keyboard = telegramCalendar.generateMonthPicker(newNavValue, 'monthly_report_cal');
                if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
                return;
            }
        }

        if (data.startsWith('yearly_report_cal_')) {
            if (data.startsWith('yearly_report_cal_sel_')) {
                const dateStr = data.replace('yearly_report_cal_sel_', '');
                const selectedDate = parseYmdDate(dateStr);
                if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
                const startDate = getYearStartDate(selectedDate);
                const endDate = getYearEndDate(selectedDate);
                await showRangeTaskReport(chatId, 'Yearly Report', format(selectedDate, 'yyyy'), formatYmdDate(startDate), formatYmdDate(endDate));
                return;
            }
            const newNavValue = telegramCalendar.handleNavigation(data, 'yearly_report_cal');
            if (newNavValue) {
                const keyboard = telegramCalendar.generateYearPicker(newNavValue, 'yearly_report_cal');
                if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
                return;
            }
        }

        if (data.startsWith('attendance_report_cal_')) {
            if (data.startsWith('attendance_report_cal_sel_')) {
                const dateStr = data.replace('attendance_report_cal_sel_', '');
                if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
                await showMonthlyAttendanceReport(chatId, dateStr);
                return;
            }
            const newNavValue = telegramCalendar.handleNavigation(data, 'attendance_report_cal');
            if (newNavValue) {
                const keyboard = telegramCalendar.generateMonthPicker(newNavValue, 'attendance_report_cal');
                if (bot) await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
                return;
            }
        }

        if (data.startsWith(LEAVE_TYPE_CALLBACK_PREFIX) && userState?.step === 'awaiting_leave_type') {
            const leaveType = data.replace(LEAVE_TYPE_CALLBACK_PREFIX, '');
            global.tgUserStates.set(chatId.toString(), {
                step: 'awaiting_leave_reason',
                leaveDates: userState.leaveDates,
                leaveType
            });
            await telegramService.sendText(chatId, `Selected *${leaveType.toUpperCase()}* leave.\nNow send the leave reason.`);
            return;
        }

    } catch (err) {
        console.error('[TelegramController] Callback Error:', err);
    }
};

const handleTelegramLocation = async (msg, io, isUpdate = false) => {
    try {
        const chatId = msg.chat.id;
        const location = msg.location;
        if (!location) return;

        const user = await getUserByTelegramChatId(chatId);
        if (!user) {
            if (!isUpdate) await telegramService.sendText(chatId, 'Your account is not linked yet.');
            return;
        }

        console.log(`[TelegramController] Received ${isUpdate ? 'update' : 'location'} from ${user.username}: ${location.latitude}, ${location.longitude}`);

        // Update DB with latest location
        await db.query(
            'UPDATE users SET last_latitude = $1, last_longitude = $2, last_location_update = CURRENT_TIMESTAMP WHERE id = $3',
            [location.latitude, location.longitude, user.id]
        );

        const notificationService = require('../utils/notificationService');

        if (!isUpdate) {
            // This is a NEW location message
            const livePeriod = location.live_period;
            
            // Notify Admins and get the message IDs of the maps sent to them
            const adminMapMessages = await notificationService.sendEmployeeLocationNotification(
                user, 
                location, 
                livePeriod ? { live_period: livePeriod } : {}
            );

            if (livePeriod && adminMapMessages.length > 0) {
                // Store mapping for future updates
                const expiresAt = new Date(Date.now() + livePeriod * 1000);
                for (const map of adminMapMessages) {
                    await db.query(`
                        INSERT INTO telegram_live_locations (employee_id, admin_chat_id, admin_message_id, expires_at)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (employee_id, admin_chat_id) DO UPDATE SET
                        admin_message_id = EXCLUDED.admin_message_id,
                        expires_at = EXCLUDED.expires_at
                    `, [user.id, map.chatId, map.messageId, expiresAt]);
                }
            }

            // Confirm to user
            await telegramService.sendMessage(chatId, '✅ *Location shared with Admins.*', { reply_markup: { remove_keyboard: true } });
            
            // Return to main menu
            await sendMainMenu(chatId, user);
        } else {
            // This is an UPDATE (live movement)
            // Update all admin map messages
            const liveMapsRes = await db.query(
                'SELECT admin_chat_id, admin_message_id FROM telegram_live_locations WHERE employee_id = $1 AND expires_at > NOW()',
                [user.id]
            );

            for (const row of liveMapsRes.rows) {
                try {
                    await telegramService.editMessageLiveLocation(
                        row.admin_chat_id,
                        row.admin_message_id,
                        location.latitude,
                        location.longitude
                    );
                } catch (editErr) {
                    // If the message is gone or session ended, we might want to clean up, but for now just log
                    console.warn(`[TelegramController] Failed to update live map for admin ${row.admin_chat_id}:`, editErr.message);
                }
            }
        }

    } catch (err) {
        console.error('[TelegramController] Location Handling Error:', err);
    }
};

const showProjectActivityLogs = async (chatId, projectId) => {
    try {
        const logsRes = await db.query(
            `SELECT tal.id, tal.task_id, tal.project_id, tal.actor_user_id, tal.action_type, tal.details, tal.created_at,
                    u.username AS actor_username
             FROM task_activity_logs tal
             LEFT JOIN users u ON u.id = tal.actor_user_id
             WHERE tal.project_id = $1
             ORDER BY tal.created_at DESC, tal.id DESC
             LIMIT 50`,
            [projectId]
        );

        if (logsRes.rows.length === 0) {
            await telegramService.sendText(chatId, 'No activity logs found for this project.');
            return;
        }

        const projectRes = await db.query('SELECT name FROM projects WHERE deleted_at IS NULL AND id = $1', [projectId]);
        const projectName = projectRes.rows[0]?.name || 'Unknown Project';

        let logText = `📜 *Activity Log: ${escapeTelegram(projectName)}*\n\n`;

        logsRes.rows.forEach(log => {
            const time = format(new Date(log.created_at), 'MMM dd, hh:mm a');
            const actor = escapeTelegram(log.actor_username || 'System');
            let action = (log.action_type || '').replace(/_/g, ' ');
            action = action.charAt(0).toUpperCase() + action.slice(1);

            let detailsText = '';
            if (log.details) {
                if (log.action_type === 'status_updated') {
                    detailsText = ` (${escapeTelegram(log.details.fromStatus)} ➔ ${escapeTelegram(log.details.toStatus)})`;
                } else if (log.action_type === 'assignees_updated') {
                    const added = (log.details.added || []).join(', ');
                    const removed = (log.details.removed || []).join(', ');
                    if (added) detailsText += ` (Added: ${escapeTelegram(added)})`;
                    if (removed) detailsText += ` (Removed: ${escapeTelegram(removed)})`;
                }
            }

            logText += `• *${time}* | ${actor}: ${action}${detailsText}\n`;
        });

        await sendLongText(chatId, logText);
    } catch (error) {
        console.error('[TelegramController] showProjectActivityLogs error:', error);
        await telegramService.sendText(chatId, 'Error fetching activity logs.');
    }
};

module.exports = {
    handleTelegramUpdate,
    handleTelegramCallback,
    handleTelegramLocation
};


