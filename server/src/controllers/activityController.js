const db = require('../db');
const timeService = require('../utils/timeService');
const attendanceService = require('../utils/attendanceService');
const { toZonedTime } = require('date-fns-tz');

const DEFAULT_WORK_HOURS_SETTINGS = { standardHours: 8, weekendDays: [5, 6] };

const safeParseJson = (value, fallback) => {
    if (!value || typeof value !== 'string') return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const normalizeCompanyId = (value) => {
    const raw = String(value || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
        ? raw
        : null;
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

/**
 * Log a user activity (sign_in, break_start, break_end, sign_out)
 */
const logActivity = async (userId, activityType, io = null, timestamp = null, coveredDate = null, balanceChange = 0) => {
    try {
        // Backward-compatible normalization for legacy callers.
        const normalizedActivityType = activityType === 'break'
            ? 'break_start'
            : activityType === 'resume'
                ? 'break_end'
                : activityType;

        // Create a literal string representation of the virtual time to prevent DB UTC shifting
        const actualTimestamp = timestamp || timeService.getNow();
        const literalTimestamp = timeService.formatLiteral(actualTimestamp);

        // Insert activity log
        const result = await db.query(
            'INSERT INTO activity_logs (user_id, activity_type, timestamp, covered_date, balance_change) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [userId, normalizedActivityType, literalTimestamp, coveredDate, balanceChange]
        );

        // Get username for real-time event
        if (io) {
            const userResult = await db.query('SELECT username, role FROM users WHERE deleted_at IS NULL AND id = $1', [userId]);
            if (userResult.rows.length > 0) {
                const activity = result.rows[0];
                const user = userResult.rows[0];
                io.emit('activity_logged', {
                    id: activity.id,
                    user_id: userId,
                    username: user.username,
                    role: user.role,
                    activity_type: normalizedActivityType,
                    timestamp: activity.timestamp
                });
            }
        }

        return result.rows[0];
    } catch (err) {
        console.error('Error logging activity:', err);
        throw err;
    }
};

/**
 * Get activity logs for a specific user
 */
const getUserActivityLogs = async (req, res) => {
    const userId = req.user.id;
    const { startDate, endDate, limit = 50 } = req.query;

    try {
        let query = 'SELECT al.id, al.user_id, al.activity_type, al.timestamp FROM activity_logs al WHERE al.user_id = $1';
        const params = [userId];

        if (startDate) {
            params.push(startDate);
            query += ` AND timestamp >= $${params.length}`;
        }

        if (endDate) {
            params.push(endDate);
            query += ` AND timestamp <= $${params.length}`;
        }

        query += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1);
        params.push(limit);

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

/**
 * Get all activity logs (Admin only)
 * Returns all employees with their activities for the date range
 */
const getAllActivityLogs = async (req, res) => {
    const { startDate, endDate, userId, activityType, limit = 1000 } = req.query;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        let query = `
            SELECT 
                u.id as user_id,
                u.username,
                u.role,
                al.id,
                al.activity_type,
                al.timestamp,
                al.created_at
            FROM users u
            LEFT JOIN activity_logs al ON u.id = al.user_id
        `;
        const params = [];
        const conditions = [];

        // Only show employees
        conditions.push("u.role = 'employee'");
        params.push(requesterCompanyId);
        conditions.push(`(
            ($${params.length}::uuid IS NULL AND u.company_id IS NULL)
            OR u.company_id = $${params.length}::uuid
        )`);

        // Filter activities by date if provided
        if (startDate && endDate) {
            params.push(startDate);
            params.push(endDate);
            conditions.push(`(al.timestamp IS NULL OR (DATE(al.timestamp) >= $${params.length - 1} AND DATE(al.timestamp) <= $${params.length}))`);
        }

        if (userId) {
            params.push(userId);
            conditions.push(`u.id = $${params.length}`);
        }

        if (activityType) {
            params.push(activityType);
            conditions.push(`al.activity_type = $${params.length}`);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY u.username ASC, al.timestamp DESC';

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

/**
 * Get activity summary for all users (Admin dashboard)
 * Returns distinct sessions for each user on the given date
 */
const getActivitySummary = async (req, res) => {
    const { date, startDate, endDate } = req.query;
    const targetDate = date || timeService.getDateStr(timeService.getNow());

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        // Fetch all employees
        const employeesRes = await db.query(
            `SELECT id, username, profile_picture
             FROM users
             WHERE role = 'employee'
               AND (
                    ($1::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $1::uuid
               )
             ORDER BY username`,
            [requesterCompanyId]
        );
        const employees = employeesRes.rows;

        // Fetch ALL activity logs for the target date range
        // If startDate/endDate provided, use them for precise local day matching.
        // Otherwise fallback to the date-based logic.
        const queryRangeStart = startDate || `${targetDate} 00:00:00`;
        const queryRangeEnd = endDate || `${targetDate} 23:59:59`;

        const logsRes = await db.query(
            `
            WITH RankedLogs AS (
                SELECT al.id, al.user_id, al.activity_type, al.timestamp, al.created_at,
                       MAX(al.timestamp) FILTER (WHERE al.activity_type = 'sign_in') 
                       OVER (PARTITION BY al.user_id ORDER BY al.timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as session_start_time
                FROM activity_logs al
                JOIN users u ON al.user_id = u.id
                WHERE u.role = 'employee'
                AND (
                    ($3::uuid IS NULL AND u.company_id IS NULL)
                    OR u.company_id = $3::uuid
                )
                AND al.timestamp >= ($1::timestamp - INTERVAL '24 hours')
                AND al.timestamp < ($2::timestamp + INTERVAL '24 hours')
            )
            SELECT id, user_id, activity_type, timestamp, created_at, session_start_time
            FROM RankedLogs
            WHERE (session_start_time >= $1::timestamp AND session_start_time <= $2::timestamp)
               OR (session_start_time IS NULL AND timestamp >= $1::timestamp AND timestamp <= $2::timestamp)
            ORDER BY user_id, timestamp ASC, created_at, session_start_time
            `,
            [queryRangeStart, queryRangeEnd, requesterCompanyId]
        );

        const logs = logsRes.rows;

        // Group logs by user
        const logsByUser = {};
        logs.forEach(log => {
            if (!logsByUser[log.user_id]) logsByUser[log.user_id] = [];
            logsByUser[log.user_id].push(log);
        });

        // Construct sessions
        const result = [];

        for (const user of employees) {
            const userLogs = logsByUser[user.id] || [];

            // If no logs, push an empty row so they appear in the list with "-"
            if (userLogs.length === 0) {
                result.push({
                    id: `${user.id}-no-activity`,
                    user_id: user.id,
                    username: user.username,
                    profile_picture: user.profile_picture,
                    sign_in_time: null,
                    breaks: [],
                    sign_out_time: null
                });
                continue;
            }

            // Process logs into sessions
            let currentSession = null;
            let sessionCounter = 0;

            for (const log of userLogs) {
                if (log.activity_type === 'sign_in') {
                    // Start new session
                    // If there was an open previous session (forgot to sign out?), push it first
                    if (currentSession) {
                        result.push(currentSession);
                    }
                    sessionCounter++;
                    currentSession = {
                        id: `${user.id}-session-${sessionCounter}`,
                        user_id: user.id,
                        username: user.username,
                        profile_picture: user.profile_picture,
                        sign_in_time: log.timestamp,
                        breaks: [], // Initialize breaks array
                        sign_out_time: null
                    };
                } else if (log.activity_type === 'break_start') {
                    if (currentSession) {
                        currentSession.breaks.push({
                            start: log.timestamp,
                            end: null
                        });
                    }
                } else if (log.activity_type === 'break_end') {
                    if (currentSession && currentSession.breaks.length > 0) {
                        // Find the last break that doesn't have an end time
                        const lastBreak = currentSession.breaks[currentSession.breaks.length - 1];
                        if (lastBreak && !lastBreak.end) {
                            lastBreak.end = log.timestamp;
                        }
                    }
                } else if (log.activity_type === 'sign_out') {
                    if (currentSession) {
                        currentSession.sign_out_time = log.timestamp;
                        result.push(currentSession);
                        currentSession = null; // Session closed
                    } else {
                        // Independent sign out (orphan)
                        sessionCounter++;
                        result.push({
                            id: `${user.id}-session-${sessionCounter}`,
                            user_id: user.id,
                            username: user.username,
                            profile_picture: user.profile_picture,
                            sign_in_time: null,
                            breaks: [],
                            sign_out_time: log.timestamp
                        });
                    }
                }
            }

            // If a session is still open (active now), push it
            if (currentSession) {
                result.push(currentSession);
            }
        }

        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

/**
 * Get monthly attendance report (Admin only)
 * Returns all employees with attendance status for each day of the month
 */
const getMonthlyReport = async (req, res) => {
    const { month } = req.query; // Format: YYYY-MM

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        if (!month) {
            return res.status(400).json({ error: 'Month parameter is required (format: YYYY-MM)' });
        }

        const [year, monthNum] = month.split('-').map(Number);
        const daysInMonth = new Date(year, monthNum, 0).getDate();

        // Get all employees
        const employeesResult = await db.query(
            `SELECT id, username
             FROM users
             WHERE role = $1
               AND (
                    ($2::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $2::uuid
               )
             ORDER BY username`,
            ['employee', requesterCompanyId]
        );

        // Get all sign_in activities for the month
        const activitiesResult = await db.query(
            `SELECT 
                user_id,
                EXTRACT(DAY FROM timestamp) as day
            FROM activity_logs al
            JOIN users u ON u.id = al.user_id
            WHERE activity_type = 'sign_in'
                AND (
                    ($3::uuid IS NULL AND u.company_id IS NULL)
                    OR u.company_id = $3::uuid
                )
                AND EXTRACT(YEAR FROM timestamp) = $1
                AND EXTRACT(MONTH FROM timestamp) = $2
            GROUP BY user_id, EXTRACT(DAY FROM timestamp)`,
            [year, monthNum, requesterCompanyId]
        );

        // Get all task submissions for the month
        const tasksResult = await db.query(
            `SELECT 
                t.user_id,
                EXTRACT(DAY FROM t.date) as day
            FROM tasks t
            JOIN users u ON u.id = t.user_id
            WHERE EXTRACT(YEAR FROM date) = $1
                AND EXTRACT(MONTH FROM date) = $2
                AND (
                    ($3::uuid IS NULL AND u.company_id IS NULL)
                    OR u.company_id = $3::uuid
                )
            GROUP BY t.user_id, EXTRACT(DAY FROM t.date)`,
            [year, monthNum, requesterCompanyId]
        );

        // Map activities to user_id -> array of days
        const attendanceMap = {};

        // Add sign-in days
        activitiesResult.rows.forEach(row => {
            const userId = row.user_id;
            if (!attendanceMap[userId]) {
                attendanceMap[userId] = new Set();
            }
            attendanceMap[userId].add(parseInt(row.day));
        });

        // Add task submission days
        tasksResult.rows.forEach(row => {
            const userId = row.user_id;
            if (!attendanceMap[userId]) {
                attendanceMap[userId] = new Set();
            }
            attendanceMap[userId].add(parseInt(row.day));
        });

        const report = employeesResult.rows.map(employee => {
            const attendance = [];
            const activeDays = attendanceMap[employee.id] || new Set();
            for (let i = 1; i <= daysInMonth; i++) {
                attendance.push(activeDays.has(i));
            }
            return {
                id: employee.id,
                username: employee.username,
                attendance
            };
        });

        res.json({
            month,
            daysInMonth,
            report
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

/**
 * Resolve report period boundaries in the user's timezone.
 */
const getPeriodRange = (period, now, timezone) => {
    const zonedNow = toZonedTime(now, timezone);
    const normalized = new Date(zonedNow);
    normalized.setMilliseconds(0);

    let start = new Date(normalized);
    let end = new Date(normalized);

    if (period === 'week') {
        start.setDate(normalized.getDate() - normalized.getDay());
        start.setHours(0, 0, 0, 0);

        end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
    } else if (period === 'year') {
        start = new Date(normalized.getFullYear(), 0, 1, 0, 0, 0, 0);
        end = new Date(normalized.getFullYear(), 11, 31, 23, 59, 59, 999);
    } else {
        start = new Date(normalized.getFullYear(), normalized.getMonth(), 1, 0, 0, 0, 0);
        end = new Date(normalized.getFullYear(), normalized.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    return { start, end };
};

/**
 * Get period statistics for the logged-in user
 */
const getMyMonthlyStats = async (req, res) => {
    const userId = req.user.id;
    const now = timeService.getNow();
    const requestedPeriod = String(req.query?.period || 'month').trim().toLowerCase();
    const period = req.user?.role === 'employee'
        ? 'month'
        : (['week', 'month', 'year'].includes(requestedPeriod) ? requestedPeriod : 'month');

    try {
        const userRes = await db.query('SELECT minutes_balance, status, timezone, company_id FROM users WHERE deleted_at IS NULL AND id = $1', [userId]);
        const userStatus = userRes.rows[0]?.status;
        const minutesBalance = userRes.rows[0]?.minutes_balance || 0;
        const userTz = userRes.rows[0]?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const userCompanyId = userRes.rows[0]?.company_id || null;

        const { start, end } = getPeriodRange(period, now, userTz);
        const startDateStr = timeService.getDateStr(start, userTz);
        const endDateStr = timeService.getDateStr(end, userTz);

        const fetchStart = new Date(start);
        fetchStart.setDate(fetchStart.getDate() - 1);
        fetchStart.setHours(0, 0, 0, 0);

        const fetchEnd = new Date(end);
        fetchEnd.setDate(fetchEnd.getDate() + 1);
        fetchEnd.setHours(23, 59, 59, 999);

        // 1. Calculate total hours worked across the selected period.
        const logsResult = await db.query(
            `SELECT activity_type, timestamp, covered_date 
             FROM activity_logs 
             WHERE user_id = $1 
             AND activity_type IN ('sign_in', 'break_start', 'break_end', 'sign_out')
             AND (
                (covered_date IS NOT NULL AND covered_date >= $2::date AND covered_date <= $3::date)
                OR
                (timestamp >= $4::timestamp AND timestamp <= $5::timestamp)
             )
             ORDER BY timestamp ASC`,
            [
                userId,
                startDateStr,
                endDateStr,
                timeService.formatLiteral(fetchStart, userTz),
                timeService.formatLiteral(fetchEnd, userTz)
            ]
        );

        const logs = logsResult.rows;
        let totalMinutes = 0;
        let sessionStart = null;
        let sessionCoveredDate = null;

        const activeDays = new Set();
        const isDateInRange = (dateStr) => !!dateStr && dateStr >= startDateStr && dateStr <= endDateStr;

        for (const log of logs) {
            const time = timeService.parseLiteral(log.timestamp, userTz);
            const effectiveCoveredDate = log.covered_date ? timeService.getDateStr(log.covered_date, userTz) : null;

            if (log.activity_type === 'sign_in' || log.activity_type === 'break_end') {
                if (!sessionStart) {
                    sessionStart = time;
                    sessionCoveredDate = effectiveCoveredDate || timeService.getDateStr(time, userTz);
                }
            } else if (log.activity_type === 'break_start' || log.activity_type === 'sign_out') {
                if (sessionStart) {
                    const sessionDateStr = sessionCoveredDate || timeService.getDateStr(sessionStart, userTz);
                    const durationRaw = (time - sessionStart) / (1000 * 60);
                    if (durationRaw > 0 && isDateInRange(sessionDateStr)) {
                        totalMinutes += durationRaw;
                        activeDays.add(sessionDateStr);
                    }
                    sessionStart = null;
                    sessionCoveredDate = null;
                }
            }
        }

        // Handle ongoing session for the current selected period.
        if (sessionStart && (userStatus === 'active' || userStatus === 'working' || userStatus === 'break')) {
            const virtualNow = timeService.getNow();
            const sessionDateStr = sessionCoveredDate || timeService.getDateStr(sessionStart, userTz);
            const durationRaw = (virtualNow - sessionStart) / (1000 * 60);
            if (durationRaw > 0 && isDateInRange(sessionDateStr)) {
                totalMinutes += durationRaw;
                activeDays.add(sessionDateStr);
            }
        }

        // 2. Calculate configured workdays in the selected period.
        const settingsRes = await db.query(
            `SELECT value
             FROM settings
             WHERE key = 'work_hours'
               AND (company_id = $1::uuid OR company_id IS NULL)
             ORDER BY CASE WHEN company_id = $1::uuid THEN 0 ELSE 1 END
             LIMIT 1`,
            [userCompanyId]
        );
        const settings = settingsRes.rows.length > 0 ? JSON.parse(settingsRes.rows[0].value) : { standardHours: 4, weekendDays: [5, 6] };

        const holidayRes = await db.query(
            `SELECT value
             FROM settings
             WHERE key = 'holidays'
               AND (company_id = $1::uuid OR company_id IS NULL)
             ORDER BY CASE WHEN company_id = $1::uuid THEN 0 ELSE 1 END
             LIMIT 1`,
            [userCompanyId]
        );
        const holidays = holidayRes.rows.length > 0 ? JSON.parse(holidayRes.rows[0].value) : [];

        const totalWorkingDays = attendanceService.calculateWorkDaysForRange(start, end, settings, holidays, userTz);

        // 3. Count submitted task reports in the selected period.
        const tasksRes = await db.query(
            `SELECT COUNT(*)::int AS submission_count
             FROM tasks
             WHERE user_id = $1
             AND date >= $2::date
             AND date <= $3::date`,
            [userId, startDateStr, endDateStr]
        );

        res.json({
            period,
            rangeStart: startDateStr,
            rangeEnd: endDateStr,
            hoursWorked: Math.round((totalMinutes / 60) * 100) / 100,
            attendanceCount: activeDays.size,
            totalWorkingDays,
            minutesBalance,
            submissionCount: tasksRes.rows[0]?.submission_count || 0
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

/**
 * Get team weekly hours for workload chart (Admin only)
 * Returns daily hours for the current work week
 */
const getTeamWeeklyHours = async (req, res) => {
    const now = timeService.getNow();
    const userTz = req.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const companyId = normalizeCompanyId(req.user?.company_id);

    try {
        // Get weekend days from settings
        const settingsRes = await db.query(
            `SELECT value FROM settings WHERE key = 'work_hours' AND (company_id = $1::uuid OR company_id IS NULL) ORDER BY CASE WHEN company_id = $1::uuid THEN 0 ELSE 1 END LIMIT 1`,
            [companyId]
        );
        const settings = settingsRes.rows.length > 0
            ? safeParseJson(settingsRes.rows[0].value, DEFAULT_WORK_HOURS_SETTINGS)
            : DEFAULT_WORK_HOURS_SETTINGS;
        const weekendDays = Array.isArray(settings.weekendDays) ? settings.weekendDays : [5, 6];

        // Calculate work week start (Monday)
        const zonedNow = toZonedTime(now, userTz);
        const dayOfWeek = zonedNow.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const weekStart = new Date(zonedNow);
        weekStart.setDate(zonedNow.getDate() + mondayOffset);
        weekStart.setHours(0, 0, 0, 0);

        // Get all work days in the week (excluding weekends)
        const workDays = [];
        for (let i = 0; i < 7; i++) {
            const day = new Date(weekStart);
            day.setDate(weekStart.getDate() + i);
            const dayOfWeekNum = day.getDay();
            if (!weekendDays.includes(dayOfWeekNum)) {
                workDays.push({
                    date: timeService.getDateStr(day, userTz),
                    dayName: day.toLocaleDateString('en-US', { weekday: 'short' }),
                    dateNum: day.getDate(),
                    hours: 0,
                    employeeCount: 0
                });
            }
        }

        // Get all sign_in/sign_out pairs for the week
        const weekStartStr = timeService.getDateStr(weekStart, userTz);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const weekEndStr = timeService.getDateStr(weekEnd, userTz);

        const logsRes = await db.query(
            `SELECT al.user_id, al.activity_type, al.timestamp, al.covered_date, u.username
             FROM activity_logs al
             JOIN users u ON al.user_id = u.id
             WHERE u.role = 'employee'
             AND (
                 (al.covered_date IS NOT NULL AND al.covered_date >= $1::date AND al.covered_date <= $2::date)
                 OR
                 (al.timestamp >= $3::timestamp AND al.timestamp <= $4::timestamp)
             )
             AND (
                 ($5::uuid IS NULL AND u.company_id IS NULL)
                 OR u.company_id = $5::uuid
             )
             ORDER BY al.timestamp ASC`,
            [weekStartStr, weekEndStr, 
             timeService.formatLiteral(new Date(weekStart), userTz),
             timeService.formatLiteral(new Date(weekEnd.setHours(23, 59, 59, 999)), userTz),
             companyId]
        );

        // Calculate hours per day
        const dayHoursMap = {};
        workDays.forEach(wd => { dayHoursMap[wd.date] = { hours: 0, employees: new Set() }; });

        let sessionStart = null;
        let sessionDate = null;

        for (const log of logsRes.rows) {
            const effectiveDate = log.covered_date 
                ? timeService.getDateStr(log.covered_date, userTz) 
                : timeService.getDateStr(timeService.parseLiteral(log.timestamp, userTz), userTz);

            if (log.activity_type === 'sign_in' || log.activity_type === 'break_end') {
                if (!sessionStart) {
                    sessionStart = timeService.parseLiteral(log.timestamp, userTz);
                    sessionDate = effectiveDate;
                }
            } else if (log.activity_type === 'break_start' || log.activity_type === 'sign_out') {
                if (sessionStart && sessionDate) {
                    const endTime = timeService.parseLiteral(log.timestamp, userTz);
                    const durationMinutes = (endTime - sessionStart) / (1000 * 60);
                    if (durationMinutes > 0 && durationMinutes < 1440 && dayHoursMap[sessionDate]) {
                        dayHoursMap[sessionDate].hours += durationMinutes / 60;
                        dayHoursMap[sessionDate].employees.add(log.user_id);
                    }
                    sessionStart = null;
                    sessionDate = null;
                }
            }
        }

        // Handle ongoing sessions
        const currentDateStr = timeService.getDateStr(now, userTz);
        if (sessionStart && sessionDate && dayHoursMap[sessionDate]) {
            const durationMinutes = (timeService.getNow() - sessionStart) / (1000 * 60);
            if (durationMinutes > 0) {
                dayHoursMap[sessionDate].hours += durationMinutes / 60;
                dayHoursMap[sessionDate].employees.add(req.user.id);
            }
        }

        // Update work days with calculated hours
        workDays.forEach(wd => {
            const dayData = dayHoursMap[wd.date] || { hours: 0, employees: new Set() };
            wd.hours = Math.round(dayData.hours * 10) / 10;
            wd.employeeCount = dayData.employees.size;
        });

        res.json({
            weekStart: weekStartStr,
            weekEnd: weekEndStr,
            workDays
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

/**
 * Get team summary for dashboard (Admin only)
 * Returns aggregate stats for focus mode and quick stats
 */
const getTeamSummary = async (req, res) => {
    const userId = req.user.id;
    const now = timeService.getNow();
    const userTz = req.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const companyId = normalizeCompanyId(req.user?.company_id);

    try {
        // Get all employees
        const employeesRes = await db.query(
            `SELECT id, username, full_name, status, department, profile_picture, is_on_leave, leave_start_date, leave_end_date
             FROM users
             WHERE role = 'employee'
             AND (
                 ($1::uuid IS NULL AND company_id IS NULL)
                 OR company_id = $1::uuid
             )
             ORDER BY username`,
            [companyId]
        );

        const employees = employeesRes.rows;
        
        // Get weekend days from settings
        const settingsRes = await db.query(
            `SELECT value FROM settings WHERE key = 'work_hours' AND (company_id = $1::uuid OR company_id IS NULL) ORDER BY CASE WHEN company_id = $1::uuid THEN 0 ELSE 1 END LIMIT 1`,
            [companyId]
        );
        const settings = settingsRes.rows.length > 0
            ? safeParseJson(settingsRes.rows[0].value, DEFAULT_WORK_HOURS_SETTINGS)
            : DEFAULT_WORK_HOURS_SETTINGS;
        const standardHours = Number(settings.standardHours) > 0 ? Number(settings.standardHours) : 8;
        const weekendDays = Array.isArray(settings.weekendDays) ? settings.weekendDays : [5, 6];

        // Calculate current week boundaries
        const zonedNow = toZonedTime(now, userTz);
        const dayOfWeek = zonedNow.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const weekStart = new Date(zonedNow);
        weekStart.setDate(zonedNow.getDate() + mondayOffset);
        weekStart.setHours(0, 0, 0, 0);
        const weekStartStr = timeService.getDateStr(weekStart, userTz);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const weekEndStr = timeService.getDateStr(weekEnd, userTz);

        // Get weekly hours for all employees
        const weeklyHoursRes = await db.query(
            `SELECT al.user_id, SUM(
                CASE WHEN al.activity_type IN ('sign_in', 'break_end') THEN 0
                WHEN al.activity_type IN ('break_start', 'sign_out') THEN 
                    COALESCE(
                        (EXTRACT(EPOCH FROM (al.timestamp - prev_log.timestamp)) / 3600),
                        0
                    )
                ELSE 0 END
             ) as total_hours
             FROM activity_logs al
             JOIN users u ON al.user_id = u.id
             LEFT join LATERAL (
                 SELECT timestamp from activity_logs
                 WHERE user_id = al.user_id AND timestamp < al.timestamp
                 ORDER BY timestamp DESC LIMIT 1
             ) prev ON true
             WHERE u.role = 'employee'
             AND al.covered_date >= $1::date
             AND al.covered_date <= $2::date
             AND (
                 ($3::uuid IS NULL AND u.company_id IS NULL)
                 OR u.company_id = $3::uuid
             )
             GROUP BY al.user_id`,
            [weekStartStr, weekEndStr, companyId]
        );

        const weeklyHoursMap = {};
        weeklyHoursRes.rows.forEach(row => {
            weeklyHoursMap[row.user_id] = parseFloat(row.total_hours) || 0;
        });

        // Calculate work days in a week based on weekend settings
        const workDaysInWeek = 7 - weekendDays.length;
        const weeklyGoal = standardHours * workDaysInWeek;
        const dailyGoal = standardHours;

        let totalTeamHours = 0;
        let employeesWithData = 0;

        employees.forEach(emp => {
            const hours = weeklyHoursMap[emp.id] || 0;
            totalTeamHours += hours;
            if (hours > 0) employeesWithData++;
        });

        // Count by status
        const statusCounts = {
            active: employees.filter(e => e.status === 'active' || e.status === 'working').length,
            break: employees.filter(e => e.status === 'break').length,
            offline: employees.filter(e => !e.status || e.status === 'inactive').length,
            on_leave: employees.filter(e => e.is_on_leave).length
        };

        // Get pending tasks count from project_tasks
        const pendingTasksRes = await db.query(
            `SELECT COUNT(*)::int as count
             FROM project_tasks pt
             JOIN projects p ON pt.project_id = p.id
             WHERE pt.status NOT IN ('completed', 'cancelled')
             AND (
                 ($1::uuid IS NULL AND p.company_id IS NULL)
                 OR p.company_id = $1::uuid
             )`,
            [companyId]
        );
        const pendingTasksCount = pendingTasksRes.rows[0]?.count || 0;

        // Get pending leave requests count
        const pendingLeavesRes = await db.query(
            `SELECT COUNT(*)::int as count
             FROM leaves l
             JOIN users u ON l.user_id = u.id
             WHERE l.status = 'pending'
             AND (
                 ($1::uuid IS NULL AND u.company_id IS NULL)
                 OR u.company_id = $1::uuid
             )`,
            [companyId]
        );
        const pendingLeavesCount = pendingLeavesRes.rows[0]?.count || 0;

        res.json({
            totalEmployees: employees.length,
            totalTeamHours: Math.round(totalTeamHours * 10) / 10,
            weeklyGoal,
            dailyGoal,
            workDaysInWeek,
            standardHours,
            weekendDays,
            weeklyProgress: employees.length > 0 ? Math.round((totalTeamHours / (weeklyGoal * employees.length)) * 100) : 0,
            activeEmployees: statusCounts.active,
            onBreak: statusCounts.break,
            offline: statusCounts.offline,
            onLeave: statusCounts.on_leave,
            pendingTasksCount,
            pendingLeavesCount,
            employeesWithData
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {
    logActivity,
    getUserActivityLogs,
    getAllActivityLogs,
    getActivitySummary,
    getMonthlyReport,
    getMyMonthlyStats,
    getTeamWeeklyHours,
    getTeamSummary
};
