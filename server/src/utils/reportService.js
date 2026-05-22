const db = require('../db');
const { summarizeToBangla } = require('./aiService');
const timeService = require('./timeService');

/**
 * Get the logical work date based on current time.
 * If before 12 PM (noon), it returns yesterday.
 * @param {Date} [date] - Optional date object.
 * @returns {string} - YYYY-MM-DD
 */
const getLogicalDate = (date = timeService.getNow()) => {
    const reportDate = new Date(date);
    if (date.getHours() < 12) {
        reportDate.setDate(date.getDate() - 1);
    }
    const year = reportDate.getFullYear();
    const month = String(reportDate.getMonth() + 1).padStart(2, '0');
    const day = String(reportDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Generate a report summary for a specific date.
 * @param {string} targetDate - The date in YYYY-MM-DD format.
 * @returns {Promise<string>} - The summarized report in Bangla.
 */
const generateFinalReport = async (targetDate) => {
    try {
        // 1. Check if a manually saved/edited summary exists for this date
        // This ensures that if an admin edited the report, the schedule sends the EDUCATED version, not a regeneration.
        const manualSummaryRes = await db.query(
            "SELECT content FROM daily_summaries WHERE date = $1",
            [targetDate]
        );

        if (manualSummaryRes.rows.length > 0) {
            let content = manualSummaryRes.rows[0].content;
            
            // If the manual summary exists but is empty/whitespace, ignore it and fall back to tasks.
            if (content && content.trim() !== '') {
                console.log(`[ReportService] Found manually saved report for ${targetDate}.`);
                
                // Check if the content is in Bangla. If not, translate it.
                const hasBangla = /[\u0980-\u09FF]/.test(content);
                if (!hasBangla) {
                    console.log(`[ReportService] Manual summary appears to be in English. Translating...`);
                    const { translateReportToBangla } = require('./aiService');
                    content = await translateReportToBangla(content);
                }
                return content;
            } else {
                console.log(`[ReportService] Manual summary record for ${targetDate} is empty. Falling back to fresh generation.`);
            }
        }

        // 2. Query both live tasks and pending scheduled actions
        const query = `
            WITH combined_activity AS (
                SELECT 
                    u.username,
                    u.department,
                    t.todays_task,
                    'live' as source
                FROM tasks t
                JOIN users u ON t.user_id = u.id
                WHERE t.date = $1
                
                UNION ALL
                
                SELECT 
                    u.username,
                    u.department,
                    sa.task_content as todays_task,
                    'scheduled' as source
                FROM scheduled_actions sa
                JOIN users u ON sa.user_id = u.id
                WHERE sa.status = 'pending' 
                  AND (sa.scheduled_at::timestamp AT TIME ZONE 'UTC' AT TIME ZONE $2)::date = $1
            )
            SELECT DISTINCT ON (username) * FROM combined_activity 
            ORDER BY username, source = 'live' DESC
        `;

        const timezoneRes = await db.query("SELECT value->>'timezone' as tz FROM settings WHERE key = 'admin_notification_settings'");
        const tz = timezoneRes.rows[0]?.tz || 'Asia/Dhaka';

        const result = await db.query(query, [targetDate, tz]);
        const reports = result.rows;

        if (reports.length === 0) {
            return "No reports submitted for this date.";
        }

        let hasAnyTaskContent = false;
        const rawReportText = reports.map(r => {
            const name = r.username.charAt(0).toUpperCase() + r.username.slice(1);
            const task = (r.todays_task || '').trim();
            if (task) hasAnyTaskContent = true;
            return `${name}\n${task}`;
        }).join('\n\n');

        if (!hasAnyTaskContent) {
            console.log(`[ReportService] No actual task content found for ${targetDate}. Skipping AI.`);
            return `Report for ${targetDate}\n\n` + reports.map(r => `${r.username}: No update submitted`).join('\n');
        }

        // AI Summarization/Translation to Bangla
        console.log(`[ReportService] Generating AI summary for ${targetDate}...`);
        const summarizedText = await summarizeToBangla(rawReportText, targetDate);

        return summarizedText;

    } catch (error) {
        console.error('Error in reportService.generateFinalReport:', error);
        throw error;
    }
};

module.exports = {
    generateFinalReport,
    getLogicalDate
};
