const db = require('../db');

const THREE_MONTHS_SQL = "NOW() - INTERVAL '3 months'";

const terminateInactiveUsersWithAssignedTasks = async () => {
    try {
        const result = await db.query(
            `
            WITH candidates AS (
                SELECT DISTINCT u.id
                FROM users u
                JOIN project_tasks pt
                    ON (
                        pt.assigned_to = u.id
                        OR EXISTS (
                            SELECT 1
                            FROM task_assignees ta
                            WHERE ta.task_id = pt.id AND ta.user_id = u.id
                        )
                    )
                WHERE COALESCE(u.status, '') NOT IN ('terminated')
                  AND (
                    COALESCE(u.last_heartbeat, TIMESTAMP 'epoch') < ${THREE_MONTHS_SQL}
                    AND COALESCE(u.updated_at, u.created_at, TIMESTAMP 'epoch') < ${THREE_MONTHS_SQL}
                  )
            )
            UPDATE users u
            SET status = 'terminated',
                updated_at = NOW()
            FROM candidates c
            WHERE u.id = c.id
            RETURNING u.id
            `
        );

        if (result.rows.length > 0) {
            console.log(`[Scheduler] Terminated ${result.rows.length} inactive users with assigned tasks.`);
        }
    } catch (error) {
        console.error('[Scheduler] inactivity termination task failed:', error);
    }
};

module.exports = {
    terminateInactiveUsersWithAssignedTasks
};
