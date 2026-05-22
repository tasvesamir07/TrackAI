const db = require('../db');
const timeService = require('./timeService');
const WORK_TRACKED_ROLES = new Set(['employee', 'EMPLOYEE']);
const isWorkTrackedRole = (role) => WORK_TRACKED_ROLES.has(String(role || ''));

/**
 * Helper to fetch attendance-related settings in a unified way.
 */
const getAttendanceSettings = async (client = db, companyId = null) => {
    const hoursRes = await client.query(
        `SELECT value
         FROM settings
         WHERE key = 'work_hours'
           AND (company_id = $1::uuid OR company_id IS NULL)
         ORDER BY CASE WHEN company_id = $1::uuid THEN 0 ELSE 1 END
         LIMIT 1`,
        [companyId]
    );
    const settings = hoursRes.rows.length > 0 ? JSON.parse(hoursRes.rows[0].value) : { standardHours: 4, weekendDays: [5, 6] };

    const holidayRes = await client.query(
        `SELECT value
         FROM settings
         WHERE key = 'holidays'
           AND (company_id = $1::uuid OR company_id IS NULL)
         ORDER BY CASE WHEN company_id = $1::uuid THEN 0 ELSE 1 END
         LIMIT 1`,
        [companyId]
    );
    const holidays = holidayRes.rows.length > 0 ? JSON.parse(holidayRes.rows[0].value) : [];

    return { settings, holidays };
};

/**
 * Categorizes a specific date for a user (Workday, Weekend, Holiday, or Leave).
 */
const getDayType = (date, settings, holidays, leaves = [], timezone) => {
    const dateStr = timeService.getDateStr(date, timezone);
    const dayOfWeek = timeService.getDayOfWeek(date, timezone);

    // 1. Check for User-Specific Approved Leave
    const leave = leaves.find(l => timeService.getDateStr(l.leave_date) === dateStr);
    if (leave) {
        return { type: 'leave', leaveId: leave.id };
    }

    // 2. Check for Special Holiday
    const holiday = holidays.find(h => {
        if (h.date) {
            return timeService.getDateStr(h.date) === dateStr;
        }
        if (h.startDate && h.endDate) {
            const startStr = typeof h.startDate === 'string' ? h.startDate : timeService.getDateStr(h.startDate);
            const endStr = typeof h.endDate === 'string' ? h.endDate : timeService.getDateStr(h.endDate);
            return dateStr >= startStr && dateStr <= endStr;
        }
        return false;
    });
    if (holiday) {
        return { type: 'holiday', name: holiday.name || 'Holiday' };
    }

    // 3. Check for Weekend
    const isWeekend = settings.weekendDays?.includes(dayOfWeek);
    if (isWeekend) {
        return { type: 'weekend' };
    }

    return { type: 'workday' };
};

/**
 * Checks if a specific date is a scheduled workday for a user.
 */
const isWorkDay = (date, settings, holidays, leaves = [], timezone, verbose = false) => {
    const dayType = getDayType(date, settings, holidays, leaves, timezone);
    const isWork = dayType.type === 'workday';

    if (verbose) {
        const dateStr = timeService.getDateStr(date, timezone);
        console.log(`[isWorkDay Calculation] 
        - Date: ${dateStr} 
        - DayType: ${dayType.type} ${dayType.name ? '(' + dayType.name + ')' : ''}
        - Final Answer (isWorkDay): ${isWork}`);
    }

    return isWork;
};

/**
 * Processes missed workdays for a user and deducts standard hours.
 */
const processMissedDays = async (userId, io = null) => {
    const client = await db.getClient();
    try {
        // console.log(`\n--- ATTENDANCE: Checking missed days for User ${userId} ---`);

        // 1. Get Settings, Holidays & User Timezone
        const userRes = await client.query('SELECT created_at, timezone, status, role, company_id FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) return 0;
        
        const user = userRes.rows[0];
        if (!isWorkTrackedRole(user.role)) {
            return 0; // Skip for non-employees
        }

        const userTz = user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const userCreatedAt = new Date(user.created_at);
        const userStatus = user.status;

        const { settings, holidays } = await getAttendanceSettings(client, user.company_id || null);
        const standardMinutes = (settings.standardHours || 4) * 60;

        // 2. Identify "Current Working Session" Date to protect it
        // If user is active/break, find the date they are currently "covering"
        let protectedDate = null;
        if (userStatus === 'active' || userStatus === 'break') {
            const latestSignInRes = await client.query(`
                SELECT covered_date, timestamp 
                FROM activity_logs 
                WHERE user_id = $1 AND activity_type = 'sign_in' 
                ORDER BY timestamp DESC LIMIT 1
            `, [userId]);
            
            if (latestSignInRes.rows.length > 0) {
                const log = latestSignInRes.rows[0];
                // Use covered_date if available, otherwise parse timestamp
                if (log.covered_date) {
                    protectedDate = timeService.getDateStr(log.covered_date, userTz);
                } else if (log.timestamp) {
                    protectedDate = timeService.getDateStr(log.timestamp, userTz);
                }
            }
        }

        // 3. Find last activity (sign_in, sign_out, or absence_deduction)
        const lastLogRes = await client.query(`
            SELECT timestamp 
            FROM activity_logs 
            WHERE user_id = $1 
            AND activity_type IN ('sign_in', 'sign_out', 'absence_deduction')
            ORDER BY timestamp DESC LIMIT 1
        `, [userId]);

        let lastActivityDate;
        if (lastLogRes.rows.length > 0) {
            lastActivityDate = new Date(lastLogRes.rows[0].timestamp);
        } else {
            lastActivityDate = userCreatedAt;
        }

        // 4. Iterate through days between last activity and "Today" (exclusive)
        const now = timeService.getNow();
        const todayStr = timeService.getDateStr(now, userTz);
        
        // Ensure we start from the day AFTER the last activity
        const iterDate = new Date(lastActivityDate);
        iterDate.setDate(iterDate.getDate() + 1); // Start from next day
        iterDate.setHours(0, 0, 0, 0);

        // Fetch User's Approved/Covered Leaves in this range
        const leaveRes = await client.query(`
            SELECT leave_date FROM leaves 
            WHERE user_id = $1 AND status IN ('approved', 'covered')
            AND leave_date >= $2 AND leave_date < $3
        `, [userId, timeService.getDateStr(lastActivityDate, userTz), todayStr]);
        const leaves = leaveRes.rows;

        let missedDaysCount = 0;

        // Process each day from the day after last activity up to (but not including) today
        while (timeService.getDateStr(iterDate, userTz) < todayStr) {
            const dateStr = timeService.getDateStr(iterDate, userTz);
            
            // Skip if this date is protected (being worked on right now)
            if (protectedDate && dateStr === protectedDate) {
                // console.log(`DEBUG: Skipping protected date (active session): ${dateStr}`);
                iterDate.setDate(iterDate.getDate() + 1);
                continue;
            }

            // Check if user has ANY activity on this day already (sign_in, etc.)
            const activityCheck = await client.query(`
                SELECT id FROM activity_logs 
                WHERE user_id = $1 
                AND (
                    (covered_date IS NOT NULL AND covered_date = $2::date)
                    OR 
                    (covered_date IS NULL AND timestamp::date = $2::date)
                )
                LIMIT 1
            `, [userId, dateStr]);

            if (activityCheck.rows.length === 0 && isWorkDay(iterDate, settings, holidays, leaves, userTz)) {
                // console.log(`- Missed Workday detected: ${dateStr}. Deducting ${settings.standardHours}h.`);

                // Log deduction in activity_logs at end of day
                const logTimeLiteral = timeService.formatLiteral(
                    new Date(iterDate.getFullYear(), iterDate.getMonth(), iterDate.getDate(), 23, 59, 59),
                    userTz
                );

                await client.query(
                    'INSERT INTO activity_logs (user_id, activity_type, timestamp, covered_date, balance_change) VALUES ($1, $2, $3, $4, $5)',
                    [userId, 'absence_deduction', logTimeLiteral, dateStr, -standardMinutes]
                );

                // Update user minute balance
                await client.query(
                    'UPDATE users SET minutes_balance = minutes_balance - $1 WHERE id = $2',
                    [standardMinutes, userId]
                );

                missedDaysCount++;
            }
            iterDate.setDate(iterDate.getDate() + 1);
        }

        // If balance changed, notify client (once for all missed days)
        if (missedDaysCount > 0 && io) {
            const userResult = await client.query('SELECT username, role FROM users WHERE id = $1', [userId]);
            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                io.emit('activity_logged', {
                    user_id: userId,
                    username: user.username,
                    role: user.role,
                    activity_type: 'absence_deduction',
                    timestamp: timeService.getNow(),
                    count: missedDaysCount
                });

                // Emit dedicated balance update
                const updatedUserRes = await client.query('SELECT minutes_balance FROM users WHERE id = $1', [userId]);
                if (updatedUserRes.rows.length > 0) {
                    io.to(userId.toString()).emit('balance_update', {
                        minutes_balance: updatedUserRes.rows[0].minutes_balance,
                        user_id: userId
                    });
                }
            }
        }

        if (missedDaysCount > 0) {
            console.log(`✓ User ${userId}: Deducted total of ${missedDaysCount * settings.standardHours}h for ${missedDaysCount} missed days.`);
        }

        return missedDaysCount;

    } catch (err) {
        console.error(`Error processing missed days for user ${userId}: `, err);
        throw err;
    } finally {
        client.release();
    }
};

/**
 * Handles signing out a user, updating their balance, and logging the activity.
 * This is the central source of truth for all sign-out logic (API and Scheduler).
 */
const signOut = async (userId, options = {}, io = null) => {
    const {
        reason = null,
        coverLeaveIds = [],
        todaysTask = null,
        forceTaskCheck = true
    } = options;

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Lock user row to make sign-out idempotent under concurrent requests.
        const userRes = await client.query('SELECT timezone, status, role, company_id FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const user = userRes.rows[0];
        const userTz = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const currentStatus = user?.status;
        const userRole = user?.role;
        const isWorkRole = isWorkTrackedRole(userRole);

        if (!isWorkRole) {
            if (currentStatus !== 'inactive') {
                await client.query('UPDATE users SET status = $1 WHERE id = $2', ['inactive', userId]);
            }
            await client.query('COMMIT');
            const updatedUser = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
            return {
                totalHours: 0,
                currentSessionHours: 0,
                sessionStartTime: null,
                user: updatedUser.rows[0],
                isCoveringSpecificLeave: false,
                coveredDate: null
            };
        }

        // If already inactive, skip writing another sign_out log.
        if (currentStatus === 'inactive') {
            const currentCalc = await calculateHoursWorkedToday(userId, client);
            await client.query('COMMIT');

            const updatedUser = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
            return {
                totalHours: currentCalc.totalHours,
                currentSessionHours: currentCalc.currentSessionHours,
                sessionStartTime: currentCalc.sessionStartTime,
                user: updatedUser.rows[0],
                isCoveringSpecificLeave: false,
                coveredDate: currentCalc.coveredDate || null
            };
        }

        const initialCalc = await calculateHoursWorkedToday(userId, client);
        const sessionStartTime = initialCalc.sessionStartTime;
        const sessionCoveredDate = initialCalc.coveredDate;
        
        let startToParse;
        if (sessionCoveredDate) {
            startToParse = sessionCoveredDate;
        } else if (sessionStartTime) {
            startToParse = timeService.parseLiteral(sessionStartTime, userTz);
        } else {
            startToParse = timeService.getNow();
        }

        const actualTodayStr = timeService.getDateStr(timeService.getNow(), userTz);
        const effectiveDateStr = timeService.getDateStr(startToParse, userTz) || actualTodayStr;

        const { totalHours, currentSessionHours } = await calculateHoursWorkedToday(userId, client, effectiveDateStr);
        const hoursWorkedToday = totalHours + currentSessionHours;

        const { settings, holidays } = await getAttendanceSettings(client, user.company_id || null);
        const leavesRes = await client.query("SELECT * FROM leaves WHERE user_id = $1 AND status = 'approved'", [userId]);
        const leaves = leavesRes.rows;

        const standardHours = settings.standardHours || 4;
        const standardMinutes = standardHours * 60;

        // 1. Auto-submit task
        if (todaysTask && todaysTask.trim()) {
            const existingTask = await client.query('SELECT id FROM tasks WHERE deleted_at IS NULL AND user_id = $1 AND date = $2', [userId, effectiveDateStr]);
            if (existingTask.rows.length === 0) {
                await client.query(
                    'INSERT INTO tasks (user_id, todays_task, date, created_at) VALUES ($1, $2, $3, $4)',
                    [userId, todaysTask, effectiveDateStr, timeService.getNow()]
                );
            }
        }

        // 2. Perform Task Submission Check
        if (forceTaskCheck) {
            const taskCheck = await client.query('SELECT id FROM tasks WHERE deleted_at IS NULL AND user_id = $1 AND date = $2', [userId, effectiveDateStr]);
            if (taskCheck.rows.length === 0) {
                const error = new Error(`Please submit your task for ${effectiveDateStr} before signing out`);
                error.statusCode = 400;
                throw error;
            }
        }

        // 3. Handle Leave Coverage (Consolidated)
        let coverageDebt = 0;
        const leavesToCover = Array.isArray(coverLeaveIds) ? [...coverLeaveIds] : [];
        
        const plannedLeaves = await client.query(
            "SELECT id FROM leaves WHERE user_id = $1 AND status = 'working'",
            [userId]
        );
        plannedLeaves.rows.forEach(l => {
            if (!leavesToCover.includes(l.id)) leavesToCover.push(l.id);
        });

        if (leavesToCover.length > 0) {
            for (const lId of leavesToCover) {
                const leaveRes = await client.query(
                    "SELECT id, leave_date, status, covered_by_date FROM leaves WHERE id = $1 AND user_id = $2",
                    [lId, userId]
                );
                if (leaveRes.rows.length > 0) {
                    const leave = leaveRes.rows[0];
                    // Fix: Allow processing even if covered_by_date is set (as coverLeave controller sets it)
                    if (leave.status === 'approved' || leave.status === 'working') {
                        const leaveDateStr = timeService.getDateStr(leave.leave_date);
                        
                        // Fix: Check goal against TOTAL hours worked today (including the session just ended)
                        const totalWorkedToday = hoursWorkedToday;
                        const isGoalMet = totalWorkedToday >= (standardHours - 0.02); 

                        if (isGoalMet) {
                            await client.query(
                                "UPDATE leaves SET covered_by_date = $1, status = 'covered' WHERE id = $2",
                                [effectiveDateStr, lId]
                            );
                        } else {
                            // If goal not met, revert to approved but keep the coverage date for progress tracking
                            await client.query(
                                "UPDATE leaves SET status = 'approved', covered_by_date = $1 WHERE id = $2",
                                [effectiveDateStr, lId]
                            );
                        }

                        const deductionCheck = await client.query(
                            "SELECT id, balance_change FROM activity_logs WHERE user_id = $1 AND activity_type = 'absence_deduction' AND (timestamp::date = $2::date OR covered_date = $2::date)",
                            [userId, leaveDateStr]
                        );
                        
                        // If an absence deduction already happened, undo it so we can apply the debt consistently today
                        if (deductionCheck.rows.length > 0) {
                            for (const d of deductionCheck.rows) {
                                // Add back the deducted minutes (d.balance_change is negative)
                                await client.query("UPDATE users SET minutes_balance = minutes_balance - $1 WHERE id = $2", [d.balance_change, userId]);
                                await client.query("DELETE FROM activity_logs WHERE id = $1", [d.id]);
                            }
                        }
                        
                        // Always add to coverageDebt to offset today's work hours
                        coverageDebt += standardMinutes;
                    }
                }
            }
        }
        const isCoveringSpecificLeave = coverageDebt > 0 || leavesToCover.length > 0;

        // 4. Calculate Balance Change
        let diffMinutes = Math.floor(currentSessionHours * 60) - coverageDebt;

        const paidCheck = await client.query(
            `SELECT id, activity_type FROM activity_logs 
             WHERE user_id = $1 
             AND activity_type IN ('sign_out', 'absence_deduction')
             AND (timestamp::date = $2::date OR covered_date = $2::date)`,
            [userId, effectiveDateStr]
        );

        const alreadyDeducted = paidCheck.rows.length > 0;
        const dayOfWeekForDebug = timeService.getDayOfWeek(startToParse, userTz);
        const dayType = getDayType(startToParse, settings, holidays, leaves, userTz);
        let isOff = dayType.type !== 'workday';
        
        if (dayType.type === 'leave') {
            const leaveId = dayType.leaveId;
            isOff = false; 
            const leaveCheck = await client.query("SELECT is_paid FROM leaves WHERE id = $1", [leaveId]);
            if (leaveCheck.rows[0]?.is_paid) {
                await client.query("UPDATE users SET paid_leave_balance = paid_leave_balance + 1 WHERE id = $1", [userId]);
                await client.query("UPDATE leaves SET is_paid = false WHERE id = $1", [leaveId]);
            }
        }

        const signouts = paidCheck.rows.filter(r => r.activity_type === 'sign_out');
        const deductions = paidCheck.rows.filter(r => r.activity_type === 'absence_deduction');

        if (signouts.length === 0) {
            if (deductions.length > 0) {
                for (const d of deductions) {
                    await client.query("UPDATE users SET minutes_balance = minutes_balance - $1 WHERE id = $2", [d.balance_change, userId]);
                    await client.query("DELETE FROM activity_logs WHERE id = $1", [d.id]);
                }
            }

            if (!isOff) {
                diffMinutes -= standardMinutes;
            }
        }

        // Update balance (Employees only)
        if (isWorkRole) {
            await client.query(
                'UPDATE users SET minutes_balance = minutes_balance + $1 WHERE id = $2',
                [diffMinutes, userId]
            );
        }

        const actualTimestamp = timeService.getNow();
        const literalTimestamp = timeService.formatLiteral(actualTimestamp);

        if (sessionStartTime) {
            await client.query(
                "UPDATE activity_logs SET covered_date = $1 WHERE user_id = $2 AND timestamp >= $3 AND (covered_date IS NULL OR covered_date = $1::date)",
                [effectiveDateStr, userId, sessionStartTime]
            );
        }

        const activityResult = await client.query(
            'INSERT INTO activity_logs (user_id, activity_type, timestamp, covered_date, balance_change) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [userId, 'sign_out', literalTimestamp, effectiveDateStr, diffMinutes]
        );

        // 5. Validation: Early Sign Out
        const isDayOff = !isWorkDay(timeService.getNow(), settings, holidays, leaves, userTz);
        const effectiveHoursWorked = hoursWorkedToday;

        if (effectiveHoursWorked < (standardHours - 0.01) && !isCoveringSpecificLeave && !isDayOff) {
            if (!reason) {
                const error = new Error(`You have worked less than ${standardHours} hours. Please provide a reason for signing out early.`);
                error.statusCode = 400;
                throw error;
            }
            await client.query('DELETE FROM early_leaves WHERE user_id = $1 AND DATE(created_at) = $2', [userId, effectiveDateStr]);
            await client.query(
                'INSERT INTO early_leaves (user_id, reason, hours_worked) VALUES ($1, $2, $3)',
                [userId, reason, effectiveHoursWorked]
            );
        } else {
            await client.query('DELETE FROM early_leaves WHERE user_id = $1 AND DATE(created_at) = $2', [userId, effectiveDateStr]);
        }

        if (reason && reason !== 'WhatsApp Sign Out') {
            const taskCheck = await client.query('SELECT * FROM tasks WHERE deleted_at IS NULL AND user_id = $1 AND date = $2', [userId, effectiveDateStr]);
            if (taskCheck.rows.length > 0) {
                await client.query(
                    'UPDATE tasks SET todays_task = $1, updated_at = $2 WHERE id = $3',
                    [reason, timeService.getNow(), taskCheck.rows[0].id]
                );
            } else {
                await client.query(
                    'INSERT INTO tasks (user_id, date, todays_task, attachments) VALUES ($1, $2, $3, $4)',
                    [userId, effectiveDateStr, reason, '[]']
                );
            }
        }

        // 6. Update status
        await client.query('UPDATE users SET status = $1 WHERE id = $2', ['inactive', userId]);

        await client.query('COMMIT');

        if (io) {
            const userResult = await client.query('SELECT username, role FROM users WHERE id = $1', [userId]);
            if (userResult.rows.length > 0) {
                const activity = activityResult.rows[0];
                const user = userResult.rows[0];
                io.emit('activity_logged', {
                    id: activity.id,
                    user_id: userId,
                    username: user.username,
                    role: user.role,
                    activity_type: 'sign_out',
                    timestamp: activity.timestamp
                });
            }
            io.emit('status_update', { userId, status: 'inactive' });
            
            const finalBalRes = await client.query('SELECT minutes_balance FROM users WHERE id = $1', [userId]);
            if (finalBalRes.rows.length > 0) {
                io.to(userId.toString()).emit('balance_update', {
                    minutes_balance: finalBalRes.rows[0].minutes_balance,
                    user_id: userId
                });
            }

            if (isCoveringSpecificLeave) {
                io.emit('leave_update', { user_id: userId, type: 'status_changed' });
            }
            if (reason && reason !== 'WhatsApp Sign Out') {
                io.emit('task_update', {
                    type: 'update',
                    userId: userId,
                    task: { todays_task: reason, date: effectiveDateStr }
                });
            }
        }

        const scheduler = require('../scheduler');
        await scheduler.cancelOvertimeAlert(userId);

        const updatedUser = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
        const latestSignInRes = await db.query(
            "SELECT covered_date FROM activity_logs WHERE user_id = $1 AND activity_type = 'sign_in' AND timestamp >= $2 ORDER BY timestamp DESC LIMIT 1",
            [userId, sessionStartTime || timeService.formatLiteral(timeService.getNow())]
        );

        return {
            totalHours,
            currentSessionHours,
            sessionStartTime,
            user: updatedUser.rows[0],
            isCoveringSpecificLeave,
            coveredDate: latestSignInRes.rows[0]?.covered_date || null
        };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in attendanceService.signOut:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Calculates the number of working days in a specific month.
 */
/**
 * Helper function to calculate hours worked today (calendar day based)
 */
const calculateHoursWorkedToday = async (userId, pgClient = null, targetDateStr = null) => {
    const client = pgClient || db;
    const now = timeService.getNow();
    
    // Fetch User Timezone
    const userRes = await client.query('SELECT timezone FROM users WHERE id = $1', [userId]);
    const userTz = userRes.rows[0]?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

    const todayStr = (targetDateStr instanceof Date)
        ? timeService.getDateStr(targetDateStr, userTz)
        : (targetDateStr || timeService.getDateStr(now, userTz));
    const midnight = timeService.parseLiteral(todayStr + " 00:00:00", userTz);
    const nextDayMidnight = new Date(midnight.getTime() + 24 * 60 * 60 * 1000);

    // 1. Find all activity logs that belong to this workday (either via covered_date or calendar date)
    const result = await client.query(
        `SELECT activity_type, timestamp, covered_date 
         FROM activity_logs 
         WHERE user_id = $1 
         AND (
             (covered_date = $2::date)
             OR (covered_date IS NULL AND timestamp >= $3 AND timestamp < $4)
         )
         ORDER BY timestamp ASC`,
        [userId, todayStr, midnight, nextDayMidnight]
    );

    let totalMinutes = 0;
    let activeStart = null;

    // 2. Check if user was already active at midnight 
    // We only care about sessions that BELONG to this workday.
    const lastBeforeRes = await client.query(
        `SELECT activity_type, timestamp FROM activity_logs 
         WHERE user_id = $1 AND timestamp < $2 
         AND covered_date IS NULL
         ORDER BY timestamp DESC LIMIT 1`,
        [userId, midnight]
    );

    if (lastBeforeRes.rows.length > 0) {
        const lastType = lastBeforeRes.rows[0].activity_type;
        if (lastType === 'sign_in' || lastType === 'break_end' || lastType === 'resume') {
            // Check if this preceding session belongs to today or yesterday
            // If it's the same workday start, we count from midnight.
            activeStart = midnight;
        }
    }

    // 3. Process today's regular logs
    const activities = result.rows;
    for (const activity of activities) {
        const time = timeService.parseLiteral(activity.timestamp, userTz);

        if (activity.activity_type === 'sign_in' || activity.activity_type === 'break_end' || activity.activity_type === 'resume') {
            activeStart = time;
        } else if (activity.activity_type === 'break_start' || activity.activity_type === 'sign_out') {
            if (activeStart) {
                totalMinutes += (time - activeStart) / (1000 * 60);
                activeStart = null;
            }
        }
    }

    // 4. If still active, count until now
    if (activeStart) {
        const userRes = await client.query('SELECT status FROM users WHERE id = $1', [userId]);
        const status = userRes.rows[0]?.status;
        if (status === 'active' || status === 'working') {
            totalMinutes += (now - activeStart) / (1000 * 60);
        }
    }

    // 5. Find current session metadata (absolute latest sign_in, regardless of date)
    const latestSignInRes = await client.query(
        "SELECT timestamp, covered_date FROM activity_logs WHERE user_id = $1 AND activity_type = 'sign_in' ORDER BY timestamp DESC LIMIT 1",
        [userId]
    );
    const latestSignIn = latestSignInRes.rows[0];
    const latestSessionStartRaw = latestSignIn?.timestamp || null;
    const coveredDate = latestSignIn?.covered_date ? timeService.getDateStr(latestSignIn.covered_date) : null;

    // Standardize sessionStartTime to a literal string in User TZ
    const sessionStartTime = latestSessionStartRaw ? timeService.formatLiteral(latestSessionStartRaw, userTz) : null;

    // Calculate current session hours separately if we want to show it even if excluding from goal
    let currentSessionHours = 0;
    if (latestSessionStartRaw) {
        // Fetch logs for JUST this session
        const sessionLogs = await client.query(
            "SELECT activity_type, timestamp FROM activity_logs WHERE user_id = $1 AND timestamp >= $2 ORDER BY timestamp ASC",
            [userId, latestSessionStartRaw]
        );
        let sessionActiveStart = null;
        let sessionMins = 0;

        for (const log of sessionLogs.rows) {
            const time = timeService.parseLiteral(log.timestamp, userTz);
            if (log.activity_type === 'sign_in' || log.activity_type === 'break_end' || log.activity_type === 'resume') {
                sessionActiveStart = time;
            } else if (log.activity_type === 'break_start' || log.activity_type === 'sign_out') {
                if (sessionActiveStart) {
                    sessionMins += (time - sessionActiveStart) / (1000 * 60);
                    sessionActiveStart = null;
                }
            }
        }

        if (sessionActiveStart) {
            const userRes = await client.query('SELECT status FROM users WHERE id = $1', [userId]);
            if (userRes.rows[0]?.status === 'active' || userRes.rows[0]?.status === 'working') {
                sessionMins += (now - sessionActiveStart) / (1000 * 60);
            }
        }
        currentSessionHours = sessionMins / 60;
    }

    const totalHours = totalMinutes / 60;
    
    // Safety check: If user is currently in a long session that technically belongs to this workday 
    // but totalHours is somehow lower (due to log glitches or spanning midnight), 
    // we should reflect the session's progress in the total.
    const finalTotalHours = (activeStart && currentSessionHours > totalHours) ? currentSessionHours : totalHours;

    console.log(`[CalcHours] Final for user ${userId}: totalHours=${finalTotalHours.toFixed(2)}, currentSession=${currentSessionHours.toFixed(2)}, coveredDate=${coveredDate}, sessionStartTime=${sessionStartTime}`);
    return {
        totalHours: finalTotalHours,
        currentSessionHours: currentSessionHours,
        sessionStartTime: sessionStartTime,
        coveredDate: coveredDate
    };
};

const calculateWorkDaysForRange = (startDate, endDate, settings, holidays, timezone) => {
    if (!startDate || !endDate) return 0;

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
        return 0;
    }

    let count = 0;
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);

    const finalDate = new Date(end);
    finalDate.setHours(0, 0, 0, 0);

    while (cursor <= finalDate) {
        if (isWorkDay(cursor, settings, holidays, [], timezone)) {
            count++;
        }
        cursor.setDate(cursor.getDate() + 1);
    }

    return count;
};

const calculateWorkDaysForMonth = (year, month, settings, holidays, timezone) => {
    let count = 0;
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    count = calculateWorkDaysForRange(start, end, settings, holidays, timezone);
    return count;
};

/**
 * Calculates total gross work hours for a specific set of dates (covered_date).
 */
const getWorkedHoursByDates = async (userId, dates, pgClient = null) => {
    const client = pgClient || db;
    if (!dates || dates.length === 0) return {};

    const userRes = await client.query('SELECT timezone FROM users WHERE id = $1', [userId]);
    const userTz = userRes.rows[0]?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

    const results = {};
    const uniqueDates = [...new Set(dates.map((d) => (
        typeof d === 'string' ? d.substring(0, 10) : timeService.getDateStr(d, userTz)
    )))];

    const workedHoursEntries = await Promise.all(uniqueDates.map(async (dateStr) => {
        const { totalHours } = await calculateHoursWorkedToday(userId, client, dateStr);
        return [dateStr, totalHours];
    }));

    for (const [dateStr, totalHours] of workedHoursEntries) {
        results[dateStr] = totalHours;
    }
    return results;
};

module.exports = {
    getAttendanceSettings,
    processMissedDays,
    isWorkDay,
    getDayType,
    signOut,
    calculateWorkDaysForRange,
    calculateWorkDaysForMonth,
    calculateHoursWorkedToday,
    getWorkedHoursByDates
};
