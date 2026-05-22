const db = require('../db');
const timeService = require('./timeService');
const attendanceService = require('./attendanceService');
const { logActivity } = require('../controllers/activityController');

/**
 * Shared logic for Messenger Bots (WhatsApp, Telegram)
 */

/**
 * Handle core commands and states for employees
 */
const handleEmployeeMessage = async ({
    user,
    identifier,
    platform,
    stateMap,
    messageBody,
    buttonId,
    io,
    authController
}) => {
    const userState = stateMap.get(identifier);
            const isManager = ['admin', 'moderator', 'company_admin', 'project_manager'].includes(String(user.role || '').toLowerCase());

    // 0. Guard for Management Roles
    // Admins and Moderators should not be able to Sign In, Out, or use Break functions
    const employeeOnlyCommands = [
        'sign', '✅ sign',
        'sign in', '✅ sign in', 'btn_signin',
        'sign out', '🛑 sign out', 'btn_signout',
        'break', '☕ break', 'btn_break',
        'resume', '▶️ resume', 'btn_resume',
        'btn_signin_normal', 'btn_signin_cover'
    ];

    const isEmployeeCommand = employeeOnlyCommands.includes(messageBody) || 
                              employeeOnlyCommands.includes(buttonId) || 
                              buttonId?.startsWith('btn_cover_date_');

    if (isManager && isEmployeeCommand) {
        await platform.sendText(identifier, `⚠️ ${platform.formatBold('Access Restricted')}\n\nAs a Manager/Admin, you do not need to track worked hours or balance. These features are for employee roles only.`);
        return true;
    }

    // 1. Handle States
    
    // State: Waiting for Task Summary (Normal Sign Out)
    if (userState === 'WAITING_FOR_TASK_SUMMARY') {
        try {
            const summary = messageBody;
            const signOutResult = await attendanceService.signOut(user.id, {
                reason: summary,
                forceTaskCheck: false
            }, io);

            const worked = signOutResult.totalHours.toFixed(2);
            const balanceMins = signOutResult.user.minutes_balance || 0;
            const balance = (balanceMins / 60).toFixed(2);

            let successMsg = platform.formatBold('Sign Out Successful') + '\n' + platform.formatDivider();
            if (signOutResult.coveredDate) {
                successMsg += `\n🎯 ${platform.formatBold('Covering Date')}: ${signOutResult.coveredDate}`;
            }
            successMsg += `\n\n📝 ${platform.formatBold('Task Summary')}:\n${summary}\n\n⏱️ ${platform.formatBold('Worked Today')}: ${worked} hrs\n⚖️ ${platform.formatBold('Balance')}: ${balance} hrs\n\n${platform.formatItalic('— ' + (user.company_name || 'Daily Task Team'))}`;

            user.status = 'inactive';
            if (platform.sendMainMenu) {
                await platform.sendMainMenu(identifier, user, successMsg);
            } else {
                await platform.sendText(identifier, successMsg);
            }
            stateMap.delete(identifier);
        } catch (err) {
            console.error("[MessengerHandler] SignOut Summary Error:", err);
            await platform.sendText(identifier, `❌ Sign Out Failed: ${err.message}`);
        }
        return true;
    }

    // State: Waiting for Early Sign Out Confirmation
    if (userState === 'WAITING_FOR_EARLY_CONFIRMATION') {
        if (buttonId === 'btn_early_confirm') {
            await platform.sendText(identifier, `📝 ${platform.formatBold('Sign Out Reason')}\nPlease provide a valid reason for leaving early:`);
            stateMap.set(identifier, 'WAITING_FOR_EARLY_REASON');
        } else if (buttonId === 'btn_early_cancel' || messageBody === 'cancel' || messageBody === 'no') {
            stateMap.delete(identifier);
            if (platform.sendMainMenu) {
                await platform.sendMainMenu(identifier, user, "❌ Sign Out cancelled. You are still 'Active'!");
            } else {
                await platform.sendText(identifier, "❌ Sign Out cancelled. You are still 'Active'!");
            }
        } else {
            const message = `⚠️ Please confirm your intent:\n\nAre you sure you want to sign out early?`;
            const buttons = [
                { id: 'btn_early_confirm', text: '✅ Yes, Sign Out' },
                { id: 'btn_early_cancel', text: '❌ No, Cancel' }
            ];
            await platform.sendButtons(identifier, message, buttons);
        }
        return true;
    }

    // State: Waiting for Early Leave Reason
    if (userState === 'WAITING_FOR_EARLY_REASON') {
        const reason = messageBody;
        if (reason.length < 3) {
            await platform.sendText(identifier, "⚠️ Reason too short. Please provide a valid reason:");
            return true;
        }

        try {
            const signOutResult = await attendanceService.signOut(user.id, {
                reason: reason,
                forceTaskCheck: false
            }, io);

            const worked = signOutResult.totalHours.toFixed(2);
            const balanceMins = signOutResult.user.minutes_balance || 0;
            const balance = (balanceMins / 60).toFixed(2);

            let successMsg = platform.formatBold('Early Sign Out') + '\n' + platform.formatDivider();
            if (signOutResult.coveredDate) {
                successMsg += `\n🎯 ${platform.formatBold('Covering Date')}: ${signOutResult.coveredDate}`;
            }
            successMsg += `\n\n📝 ${platform.formatBold('Reason')}: "${reason}"\n⏱️ ${platform.formatBold('Worked Today')}: ${worked} hrs\n⚖️ ${platform.formatBold('Balance')}: ${balance} hrs\n\n${platform.formatItalic('— ' + (user.company_name || 'Daily Task Team'))}`;

            user.status = 'inactive';
            if (platform.sendMainMenu) {
                await platform.sendMainMenu(identifier, user, successMsg);
            } else {
                await platform.sendText(identifier, successMsg);
            }
            stateMap.delete(identifier);
        } catch (err) {
            console.error("[MessengerHandler] Early SignOut Error:", err);
            await platform.sendText(identifier, `❌ Sign Out Failed: ${err.message}`);
        }
        return true;
    }

    // State: Waiting for Covering Leave Date
    if (userState?.step === 'awaiting_cover_date') {
        const dateStr = messageBody;
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateStr)) {
            await platform.sendText(identifier, "⚠️ Invalid format. Please use YYYY-MM-DD (e.g., 2026-02-15):");
            return true;
        }

        try {
            if (user.status !== 'inactive') {
                await attendanceService.signOut(user.id, { reason: 'Switching to Covering Leave', forceTaskCheck: false }, io);
            }
            await db.query('UPDATE users SET status = $1 WHERE id = $2', ['active', user.id]);
            await logActivity(user.id, 'sign_in', io, null, dateStr);
            if (authController) await authController.refreshDailyGoalAlert(user.id);

            if (io) io.emit('status_update', { userId: user.id, status: 'active' });
            const successMsg = `✅ Signed In for ${platform.formatBold('Covering Leave')} (${dateStr}). Thanks for stepping up!`;
            user.status = 'active';
            if (platform.sendMainMenu) {
                await platform.sendMainMenu(identifier, user, successMsg);
            } else {
                await platform.sendText(identifier, successMsg);
            }
            stateMap.delete(identifier);
        } catch (err) {
            console.error("[MessengerHandler] Cover Date Error:", err);
            await platform.sendText(identifier, `❌ Failed to process date: ${err.message}`);
        }
        return true;
    }

    // 2. Handle Commands
    
    // Command: Status
    if (messageBody === 'status' || buttonId === 'btn_status' || messageBody === '📊 my status') {
        try {
            const isManager = ['admin', 'moderator', 'company_admin', 'project_manager'].includes(String(user.role || '').toLowerCase());
            const statusEmoji = user.status === 'active' ? '🟢' : user.status === 'break' ? '☕' : '🔴';
            
            let statusMsg = platform.formatBold('Status Report') + '\n' + platform.formatDivider() + '\n\n';
            statusMsg += `👤 ${platform.formatBold('User')}: ${user.username}\n`;
            statusMsg += `${statusEmoji} ${platform.formatBold('Status')}: ${user.status.toUpperCase()}`;

            if (!isManager) {
                const { totalHours, currentSessionHours, coveredDate } = await attendanceService.calculateHoursWorkedToday(user.id);
                const userRes = await db.query('SELECT minutes_balance FROM users WHERE deleted_at IS NULL AND id = $1', [user.id]);
                const balanceMins = userRes.rows[0]?.minutes_balance || 0;
                const balanceHrs = (balanceMins / 60).toFixed(2);
                const targetDateLabel = coveredDate ? `Work for ${coveredDate}` : 'Worked Today';
                
                statusMsg += `\n\n⏱️ ${platform.formatBold(targetDateLabel)}: ${totalHours.toFixed(2)} hrs\n⏳ ${platform.formatBold('Current Session')}: ${currentSessionHours.toFixed(2)} hrs\n⚖️ ${platform.formatBold('Balance')}: ${balanceHrs} hrs`;
            }
            
            statusMsg += `\n\n${platform.formatItalic('— ' + (user.company_name || 'Daily Task Team'))}`;
            await platform.sendText(identifier, statusMsg);
        } catch (err) {
            console.error("[MessengerHandler] Status Error:", err);
            await platform.sendText(identifier, "❌ Error fetching status.");
        }
        return true;
    }

    // Command: Sign In
    if (messageBody === 'sign' || messageBody === '✅ sign' || messageBody === 'sign in' || messageBody === '✅ sign in' || buttonId === 'btn_signin') {
        if (user.status === 'active') {
            await platform.sendText(identifier, "⚠️ You are already Signed In.");
            return true;
        }
        if (user.status === 'break') {
            await platform.sendText(identifier, "⚠️ You are on break. Please select 'Resume' to continue the same session.");
            return true;
        }

        try {
            const settingsRes = await db.query("SELECT key, value FROM settings WHERE key IN ('work_hours', 'holidays')");
            let workHoursConfig = { standardHours: 4, weekendDays: [5, 6] };
            let holidays = [];

            settingsRes.rows.forEach(row => {
                if (row.key === 'work_hours') workHoursConfig = JSON.parse(row.value);
                if (row.key === 'holidays') holidays = JSON.parse(row.value);
            });

            const now = timeService.getNow();
            const dateStr = timeService.getDateStr(now);

            // Fetch user's approved leaves for today
            const leavesRes = await db.query(
                "SELECT id, leave_date FROM leaves WHERE user_id = $1 AND status = 'approved' AND leave_date = $2::date",
                [user.id, dateStr]
            );
            const leaves = leavesRes.rows;

            const userTz = user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
            const dayType = attendanceService.getDayType(now, workHoursConfig, holidays, leaves, userTz);

            if (dayType.type !== 'workday') {
                let typeLabel = "Off Day";
                let emoji = "🏖️";
                let actionLabel = "Overtime";

                if (dayType.type === 'weekend') {
                    typeLabel = "Weekend";
                } else if (dayType.type === 'holiday') {
                    typeLabel = `Holiday (${dayType.name})`;
                } else if (dayType.type === 'leave') {
                    typeLabel = "Leave Day";
                    emoji = "🌴";
                    actionLabel = "Work on Leave";
                }

                const message = `${emoji} ${platform.formatBold(typeLabel + ' detected')}: Today is a ${typeLabel}.\n\nWhat would you like to do?`;
                let buttons = [
                    { id: 'btn_signin_cover', text: '🎯 Cover Leave' },
                    { id: 'btn_signin_normal', text: `🚀 ${actionLabel}` }
                ];

                // If it's a leave day, user requested it NOT be cover leave or overtime.
                // So we remove the 'Cover Leave' option and just keep the 'Work' option.
                if (dayType.type === 'leave') {
                    buttons = [
                        { id: 'btn_signin_normal', text: `🚀 ${actionLabel}` }
                    ];
                }

                await platform.sendButtons(identifier, message, buttons);
            } else {
                await processSignIn(user, identifier, platform, io, authController);
            }
        } catch (err) {
            console.error("[MessengerHandler] SignIn Error:", err);
            await platform.sendText(identifier, "❌ Error processing Sign In.");
        }
        return true;
    }

    // Command: Sign In - Normal (on holiday/weekend)
    if (buttonId === 'btn_signin_normal') {
        await processSignIn(user, identifier, platform, io, authController);
        return true;
    }

    // Command: Sign In - Cover Leave
    if (buttonId === 'btn_signin_cover') {
        const leaveRes = await db.query(
            "SELECT l.*, u.username FROM leaves l JOIN users u ON l.user_id = u.id WHERE l.status = 'approved' ORDER BY l.leave_date DESC LIMIT 10"
        );

        if (leaveRes.rows.length === 0) {
            stateMap.set(identifier, { step: 'awaiting_cover_date' });
            if (platform.sendCalendar) {
                await platform.sendCalendar(identifier, "📝 No approved leaves found. Please select a custom date from the calendar to cover (or type /cancel):", new Date(), 'single', [], 'cover_cal');
            } else {
                await platform.sendText(identifier, "📝 No approved leaves found. If you are covering a skipped day or an unlisted date, please enter the date manually (YYYY-MM-DD):");
            }
        } else {
            const options = leaveRes.rows.map(l => ({
                id: `btn_cover_date_${timeService.getDateStr(l.leave_date)}`,
                title: `${timeService.getDateStr(l.leave_date)}: ${l.username}`
            }));
            options.push({ id: 'btn_cover_date_custom', title: 'Cover Skipped Day (Manual)' });
            
            await platform.sendList(identifier, "Select a leave to cover, or enter manually for skipped days:", "Leaves", [
                { title: "Approved Leaves", rows: options }
            ]);
        }
        return true;
    }

    // Command: Cover Date Selected (from list)
    if (buttonId?.startsWith('btn_cover_date_')) {
        const selectedDate = buttonId.replace('btn_cover_date_', '');
        if (selectedDate === 'custom') {
            try {
                // Find skipped working days in the last 14 days
                const settingsRes = await db.query("SELECT key, value FROM settings WHERE key IN ('work_hours', 'holidays')");
                let workHoursConfig = { standardHours: 4, weekendDays: [5, 6] };
                let holidays = [];

                settingsRes.rows.forEach(row => {
                    if (row.key === 'work_hours') workHoursConfig = JSON.parse(row.value);
                    if (row.key === 'holidays') holidays = JSON.parse(row.value);
                });

                // Generate last 60 days
                const userTz = user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
                const now = timeService.getZnow(userTz);
                now.setHours(0,0,0,0);
                const skippedDates = [];
                
                // Never check dates before the user's account was created
                const accountCreatedStr = timeService.getDateStr(new Date(user.created_at || now), userTz);
                
                for (let i = 1; i <= 60; i++) {
                    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
                    const dateStr = timeService.getDateStr(d, userTz);
                    
                    // Stop looking back if we reach the account creation date string
                    if (dateStr < accountCreatedStr) {
                        break;
                    }

                    const dayOfWeek = d.getDay();
                    
                    const isWeekend = workHoursConfig.weekendDays?.includes(dayOfWeek);
                    const isHoliday = holidays.some(h => {
                        if (h.date) return timeService.getDateStr(new Date(h.date)) === dateStr;
                        if (h.startDate && h.endDate) {
                            const start = typeof h.startDate === 'string' ? h.startDate : timeService.getDateStr(new Date(h.startDate));
                            const end = typeof h.endDate === 'string' ? h.endDate : timeService.getDateStr(new Date(h.endDate));
                            return dateStr >= start && dateStr <= end;
                        }
                        return false;
                    });

                    if (!isWeekend && !isHoliday) {
                        skippedDates.push(dateStr);
                    }
                }

                // Check which of these workdays have no attendance logs
                const logsRes = await db.query(
                    `SELECT DISTINCT DATE(timestamp) as log_date FROM activity_logs 
                     WHERE user_id = $1 AND DATE(timestamp) >= CURRENT_DATE - INTERVAL '60 days'`,
                    [user.id]
                );
                const workedDates = logsRes.rows.map(r => timeService.getDateStr(r.log_date));
                
                const actualSkipped = skippedDates.filter(d => !workedDates.includes(d));

                if (actualSkipped.length === 0) {
                    await platform.sendText(identifier, "🎉 No skipped working days found in the last 60 days! Great job!");
                    stateMap.delete(identifier);
                } else {
                    // Limit the number of buttons in Telegram to prevent errors (Telegram typically allows ~100 inline buttons max)
                    // We'll show up to the most recent 30 skipped days
                    const recentSkipped = actualSkipped.slice(0, 30);
                    
                    const options = recentSkipped.map(dateStr => ({
                        id: `btn_cover_date_${dateStr}`,
                        title: dateStr
                    }));
                    await platform.sendList(identifier, "Select a skipped day to cover:", "Skipped Days", [
                        { title: "Recent Skipped Workdays", rows: options }
                    ]);
                }
            } catch (err) {
                console.error("[MessengerHandler] Skipped Days Error:", err);
                await platform.sendText(identifier, "❌ Error retrieving skipped days.");
            }
        } else {
            try {
                if (user.status !== 'inactive') {
                    await attendanceService.signOut(user.id, { reason: 'Switching to Covering Leave', forceTaskCheck: false }, io);
                }
                await db.query('UPDATE users SET status = $1 WHERE id = $2', ['active', user.id]);
                await logActivity(user.id, 'sign_in', io, null, selectedDate);
                if (authController) await authController.refreshDailyGoalAlert(user.id);
                if (io) io.emit('status_update', { userId: user.id, status: 'active' });
                const successMsg = `✅ Signed In for ${platform.formatBold('Covering Leave')} (${selectedDate}).`;
                user.status = 'active';
                if (platform.sendMainMenu) {
                    await platform.sendMainMenu(identifier, user, successMsg);
                } else {
                    await platform.sendText(identifier, successMsg);
                }
            } catch (err) {
                console.error("[MessengerHandler] Cover Selection Error:", err);
                await platform.sendText(identifier, "❌ Error processing leave coverage.");
            }
        }
        return true;
    }

    // Command: Sign Out
    if (messageBody === 'sign out' || messageBody === '🛑 sign out' || buttonId === 'btn_signout') {
        if (user.status === 'inactive') {
            await platform.sendText(identifier, "⚠️ You are already Signed Out.");
            return true;
        }

        try {
            const { totalHours, currentSessionHours } = await attendanceService.calculateHoursWorkedToday(user.id);
            const { settings, holidays } = await attendanceService.getAttendanceSettings();
            const userTz = user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
            
            const isWorkDay = attendanceService.isWorkDay(timeService.getNow(), settings, holidays, [], userTz);
            const standardHours = isWorkDay ? (settings.standardHours || 4) : 0;

            const effectiveHours = Math.max(totalHours, currentSessionHours);

            if (standardHours > 0 && effectiveHours < (standardHours - 0.01)) {
                const message = `⚠️ ${platform.formatBold('Early Leave Detected')}\n\nYou have only worked ${effectiveHours.toFixed(2)}h today (Goal: ${standardHours}h).\n\nAre you sure you want to sign out early?`;
                const buttons = [
                    { id: 'btn_early_confirm', text: '✅ Yes, Sign Out' },
                    { id: 'btn_early_cancel', text: '❌ No, Cancel' }
                ];
                await platform.sendButtons(identifier, message, buttons);
                stateMap.set(identifier, 'WAITING_FOR_EARLY_CONFIRMATION');
            } else {
                const goalText = standardHours > 0 ? `Goal: ${standardHours}h` : "Day Off (Overtime Only)";
                await platform.sendText(identifier, `📝 ${platform.formatBold('Sign Out')} (${goalText})\nPlease provide a brief summary of what you did today:`);
                stateMap.set(identifier, 'WAITING_FOR_TASK_SUMMARY');
            }
        } catch (err) {
            console.error("[MessengerHandler] SignOut Check Error:", err);
            await platform.sendText(identifier, "❌ Error processing Sign Out.");
        }
        return true;
    }

    // Command: Break
    if (messageBody === 'break' || messageBody === '☕ break' || buttonId === 'btn_break') {
        if (user.status !== 'active') {
            await platform.sendText(identifier, "⚠️ You can only take a break while 'Active'.");
            return true;
        }
        try {
            // Find current session covered date
            const latestSignIn = await db.query(
                "SELECT covered_date FROM activity_logs WHERE user_id = $1 AND activity_type = 'sign_in' ORDER BY timestamp DESC LIMIT 1",
                [user.id]
            );
            const coveredDate = latestSignIn.rows[0]?.covered_date || null;

            await db.query('UPDATE users SET status = $1 WHERE id = $2', ['break', user.id]);
            await logActivity(user.id, 'break_start', io, null, coveredDate);
            if (io) io.emit('status_update', { userId: user.id, status: 'break' });
            const successMsg = "☕ Break started. Good work! Select 'Resume' when you're back.";
            user.status = 'break';
            if (platform.sendMainMenu) {
                await platform.sendMainMenu(identifier, user, successMsg);
            } else {
                await platform.sendText(identifier, successMsg);
            }
        } catch (err) { console.error("Break Error:", err); await platform.sendText(identifier, "❌ Error."); }
        return true;
    }

    // Command: Resume
    if (messageBody === 'resume' || messageBody === '▶️ resume' || buttonId === 'btn_resume') {
        if (user.status !== 'break') {
            await platform.sendText(identifier, "⚠️ You are not on a break.");
            return true;
        }
        try {
            // Find current session covered date
            const latestSignIn = await db.query(
                "SELECT covered_date FROM activity_logs WHERE user_id = $1 AND activity_type = 'sign_in' ORDER BY timestamp DESC LIMIT 1",
                [user.id]
            );
            const coveredDate = latestSignIn.rows[0]?.covered_date || null;

            await db.query('UPDATE users SET status = $1 WHERE id = $2', ['active', user.id]);
            await logActivity(user.id, 'break_end', io, null, coveredDate);
            if (io) io.emit('status_update', { userId: user.id, status: 'active' });
            const successMsg = "🟢 Welcome back! You are now 'Active' again.";
            user.status = 'active';
            if (platform.sendMainMenu) {
                await platform.sendMainMenu(identifier, user, successMsg);
            } else {
                await platform.sendText(identifier, successMsg);
            }
        } catch (err) { console.error("Resume Error:", err); await platform.sendText(identifier, "❌ Error."); }
        return true;
    }

    return false; // Command not handled
};

const processSignIn = async (user, identifier, platform, io, authController) => {
    try {
        const statusRes = await db.query('SELECT status FROM users WHERE deleted_at IS NULL AND id = $1', [user.id]);
        const currentStatus = statusRes.rows[0]?.status;

        if (currentStatus === 'active') {
            await platform.sendText(identifier, "⚠️ You are already Signed In.");
            return;
        }
        if (currentStatus === 'break') {
            await platform.sendText(identifier, "⚠️ You are on break. Please select 'Resume' to continue the same session.");
            return;
        }

        await db.query('UPDATE users SET status = $1 WHERE id = $2', ['active', user.id]);
        await logActivity(user.id, 'sign_in', io);
        if (authController) await authController.refreshDailyGoalAlert(user.id);
        if (io) io.emit('status_update', { userId: user.id, status: 'active' });
        const successMsg = `🚀 ${platform.formatBold('Sign In Successful')}! You are now 'Active'.`;
        user.status = 'active';
        if (platform.sendMainMenu) {
            await platform.sendMainMenu(identifier, user, successMsg);
        } else {
            await platform.sendText(identifier, successMsg);
        }
    } catch (err) {
        console.error("[MessengerHandler] processSignIn Error:", err);
        await platform.sendText(identifier, "❌ Failed to Sign In.");
    }
};

module.exports = { handleEmployeeMessage };
