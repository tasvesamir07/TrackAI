const db = require('../db');
const { uploadIncomingFile } = require('../utils/storageService');
const notificationService = require('../utils/notificationService');

const hasPrivilegedProjectAccess = (role) => role === 'moderator' || role === 'COMPANY_ADMIN';

const resolveRequesterCompanyId = async (userId, companyIdFromToken, queryClient = db) => {
    if (companyIdFromToken) return companyIdFromToken;
    if (!userId) return null;

    const requesterRes = await queryClient.query(
        'SELECT company_id FROM users WHERE deleted_at IS NULL AND id = $1 LIMIT 1',
        [userId]
    );
    return requesterRes.rows[0]?.company_id || null;
};

// Helper function to check if user has access to a project
const checkProjectAccess = async (projectId, userId, userRole, requiredRole = null, expectedCompanyId = null) => {
    const companyProjectCheck = await db.query(
        `SELECT p.id
         FROM projects p
         WHERE p.id = $1
           AND (
                EXISTS (
                    SELECT 1
                    FROM users creator
                    WHERE creator.id = p.created_by
                      AND (
                          ($2::uuid IS NULL AND creator.company_id IS NULL)
                          OR creator.company_id = $2::uuid
                      )
                )
                OR EXISTS (
                    SELECT 1
                    FROM project_members pm
                    JOIN users mu ON mu.id = pm.user_id
                    WHERE pm.project_id = p.id
                      AND (
                          ($2::uuid IS NULL AND mu.company_id IS NULL)
                          OR mu.company_id = $2::uuid
                      )
                )
           )
         LIMIT 1`,
        [projectId, expectedCompanyId]
    );

    if (companyProjectCheck.rows.length === 0) {
        return { hasAccess: false, isAdmin: false, memberRole: null };
    }

    // Admins and moderators always have access
    if (hasPrivilegedProjectAccess(userRole)) {
        return { hasAccess: true, isAdmin: true, memberRole: null };
    }

    // Check if user is a project member
    const memberCheck = await db.query(
        'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2',
        [projectId, userId]
    );

    if (memberCheck.rows.length === 0) {
        return { hasAccess: false, isAdmin: false, memberRole: null };
    }

    const memberRole = memberCheck.rows[0].role;

    // If specific role required, check it
    if (requiredRole) {
        if (requiredRole === 'leader' && memberRole !== 'leader') {
            return { hasAccess: false, isAdmin: false, memberRole };
        }
    }

    return { hasAccess: true, isAdmin: false, memberRole };
};

// --- Projects ---

const createProject = async (req, res) => {
    const { name, description, status, member_ids } = req.body;
    const created_by = req.user.id;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'Project name is required' });
        }

        const requestedMemberIds = Array.isArray(member_ids)
            ? Array.from(
                new Set(
                    member_ids
                        .map((id) => Number(id))
                        .filter((id) => Number.isInteger(id) && id > 0 && id !== created_by)
                )
            )
            : [];

        await db.query('BEGIN');

        const result = await db.query(
            'INSERT INTO projects (name, description, status, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
            [String(name).trim(), description || null, status || 'active', created_by]
        );

        const projectId = result.rows[0].id;

        // Add creator as leader.
        await db.query(
            'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)',
            [projectId, created_by, 'leader']
        );

        if (requestedMemberIds.length > 0) {
            const validUsersRes = await db.query(
                `SELECT id
                 FROM users
                 WHERE id = ANY($1::int[])
                   AND role = 'employee'
                   AND (
                        ($2::uuid IS NULL AND company_id IS NULL)
                        OR company_id = $2::uuid
                   )`,
                [requestedMemberIds, requesterCompanyId]
            );

            for (const { id: userId } of validUsersRes.rows) {
                await db.query(
                    'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO NOTHING',
                    [projectId, userId, 'member']
                );
            }
        }

        await db.query('COMMIT');
        res.status(201).json(result.rows[0]);
    } catch (err) {
        try {
            await db.query('ROLLBACK');
        } catch (rollbackErr) {
            console.error('Project creation rollback failed:', rollbackErr);
        }
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getProjects = async (req, res) => {
    const user_id = req.user.id;
    const { role } = req.user;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        let query;
        let params = [];

        if (hasPrivilegedProjectAccess(role)) {
            params = [requesterCompanyId];
            query = `
                SELECT p.*, 
                (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as member_count,
                 u.username as creator_name,
                 COALESCE(member_preview.member_preview, '[]'::json) as member_preview
                FROM projects p
                LEFT JOIN users u ON p.created_by = u.id
                LEFT JOIN LATERAL (
                    SELECT json_agg(
                        json_build_object(
                            'id', preview.id,
                            'username', preview.username,
                            'profile_picture', preview.profile_picture,
                            'role', preview.role,
                            'account_role', preview.account_role
                        )
                        ORDER BY preview.sort_order, preview.username
                    ) as member_preview
                    FROM (
                        SELECT u2.id, u2.username, u2.profile_picture, pm.role, u2.role as account_role,
                                 CASE WHEN pm.role = 'leader' THEN 0 ELSE 1 END as sort_order
                        FROM project_members pm
                        JOIN users u2 ON u2.id = pm.user_id
                        WHERE pm.project_id = p.id
                        ORDER BY CASE WHEN pm.role = 'leader' THEN 0 ELSE 1 END, u2.username
                        LIMIT 4
                    ) preview
                ) member_preview ON true
                WHERE p.deleted_at IS NULL
                  AND (
                        EXISTS (
                            SELECT 1
                            FROM users creator2
                            WHERE creator2.id = p.created_by
                               AND (
                                     ($1::uuid IS NULL AND creator2.company_id IS NULL)
                                     OR creator2.company_id = $1::uuid
                               )
                        )
                        OR EXISTS (
                            SELECT 1
                            FROM project_members pmc
                            JOIN users uc ON uc.id = pmc.user_id
                            WHERE pmc.project_id = p.id
                               AND (
                                     ($1::uuid IS NULL AND uc.company_id IS NULL)
                                     OR uc.company_id = $1::uuid
                               )
                        )
                  )
                ORDER BY p.created_at DESC
            `;
        } else {
            query = `
                SELECT p.*, pm.role as user_role,
                (SELECT COUNT(*) FROM project_members pm2 WHERE pm2.project_id = p.id) as member_count,
                 u.username as creator_name,
                 COALESCE(member_preview.member_preview, '[]'::json) as member_preview
                FROM projects p
                JOIN project_members pm ON p.id = pm.project_id
                LEFT JOIN users u ON p.created_by = u.id
                LEFT JOIN LATERAL (
                    SELECT json_agg(
                        json_build_object(
                            'id', preview.id,
                            'username', preview.username,
                            'profile_picture', preview.profile_picture,
                            'role', preview.role,
                            'account_role', preview.account_role
                        )
                        ORDER BY preview.sort_order, preview.username
                    ) as member_preview
                    FROM (
                        SELECT u2.id, u2.username, u2.profile_picture, pm3.role, u2.role as account_role,
                                 CASE WHEN pm3.role = 'leader' THEN 0 ELSE 1 END as sort_order
                        FROM project_members pm3
                        JOIN users u2 ON u2.id = pm3.user_id
                        WHERE pm3.project_id = p.id
                        ORDER BY CASE WHEN pm3.role = 'leader' THEN 0 ELSE 1 END, u2.username
                        LIMIT 4
                    ) preview
                ) member_preview ON true
                WHERE pm.user_id = $1 AND p.deleted_at IS NULL
                ORDER BY p.created_at DESC
            `;
            params = [user_id];
        }

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getProjectDetails = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        // Check authorization
        const access = await checkProjectAccess(id, userId, userRole, null, requesterCompanyId);
        if (!access.hasAccess) {
            return res.status(403).json({ error: 'Not authorized to view this project' });
        }

        const project = await db.query('SELECT * FROM projects WHERE deleted_at IS NULL AND id = $1 AND deleted_at IS NULL', [id]);
        if (project.rows.length === 0) return res.status(404).json({ error: 'Project not found' });

        const members = await db.query(`
            SELECT u.id, u.username, u.profile_picture, pm.role, u.role as account_role
            FROM project_members pm 
            JOIN users u ON pm.user_id = u.id 
            WHERE pm.project_id = $1
            ORDER BY CASE WHEN pm.role = 'leader' THEN 0 ELSE 1 END, u.username
        `, [id]);

        res.json({ ...project.rows[0], members: members.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const updateProject = async (req, res) => {
    const { id } = req.params;
    const { name, description, status } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        // Check authorization - only leaders, moderators, or admins can update
        const access = await checkProjectAccess(id, userId, userRole, 'leader', requesterCompanyId);
        if (!access.hasAccess) {
            return res.status(403).json({ error: 'Not authorized to update this project. Only project leaders, moderators, or admins can update.' });
        }

        const result = await db.query(
            'UPDATE projects SET name = $1, description = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *',
            [name, description, status, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const deleteProject = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        // Check authorization - only leaders, moderators, or admins can delete
        const access = await checkProjectAccess(id, userId, userRole, 'leader', requesterCompanyId);
        if (!access.hasAccess) {
            return res.status(403).json({ error: 'Not authorized to delete this project. Only project leaders, moderators, or admins can delete.' });
        }

        await db.query('UPDATE projects SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
        res.json({ message: 'Project moved to Bin' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getDeletedProjects = async (req, res) => {
    const userRole = req.user.role;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        if (userRole !== 'COMPANY_ADMIN' && userRole !== 'moderator') {
            return res.status(403).json({ error: 'Only admins or moderators can view the bin.' });
        }

        const result = await db.query(`
            SELECT p.*, u.username as creator_name
            FROM projects p
            LEFT JOIN users u ON p.created_by = u.id
            WHERE p.deleted_at IS NOT NULL
               AND (
                     ($1::uuid IS NULL AND u.company_id IS NULL)
                     OR u.company_id = $1::uuid
               )
            ORDER BY p.deleted_at DESC
        `, [requesterCompanyId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const restoreProject = async (req, res) => {
    const { id } = req.params;
    const userRole = req.user.role;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        if (userRole !== 'COMPANY_ADMIN' && userRole !== 'moderator') {
            return res.status(403).json({ error: 'Only admins or moderators can restore projects.' });
        }

        const result = await db.query(
            `UPDATE projects p
              SET deleted_at = NULL
              FROM users u
              WHERE p.id = $1
                AND u.id = p.created_by
                AND (
                     ($2::uuid IS NULL AND u.company_id IS NULL)
                     OR u.company_id = $2::uuid
                )
              RETURNING p.*`,
            [id, requesterCompanyId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found in Bin' });
        }

        res.json({ message: 'Project restored', project: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

// --- Members ---

const addMember = async (req, res) => {
    const { id } = req.params;
    const { user_id, role } = req.body;
    const requesterId = req.user.id;
    const requesterRole = req.user.role;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        // Check authorization - only leaders, moderators, or admins can add members
        const access = await checkProjectAccess(id, requesterId, requesterRole, 'leader', requesterCompanyId);
        if (!access.hasAccess) {
            return res.status(403).json({ error: 'Not authorized to add members. Only project leaders, moderators, or admins can add members.' });
        }

        // Validate user_id exists
        const userCheck = await db.query(
            `SELECT id, role
              FROM users
              WHERE id = $1
                AND (
                     ($2::uuid IS NULL AND company_id IS NULL)
                     OR company_id = $2::uuid
                )`,
            [user_id, requesterCompanyId]
        );
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (userCheck.rows[0].role !== 'employee') {
            return res.status(400).json({ error: 'Only employees can be added as project members.' });
        }

        await db.query(
            'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3',
            [id, user_id, role || 'member']
        );
        res.json({ message: 'Member added' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const removeMember = async (req, res) => {
    const { id, userId: memberToRemoveId } = req.params;
    const requesterId = req.user.id;
    const requesterRole = req.user.role;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        // Check authorization - only leaders, moderators, or admins can remove members
        const access = await checkProjectAccess(id, requesterId, requesterRole, 'leader', requesterCompanyId);
        if (!access.hasAccess) {
            return res.status(403).json({ error: 'Not authorized to remove members. Only project leaders, moderators, or admins can remove members.' });
        }

        // Prevent removing yourself if you're the only leader
        if (parseInt(memberToRemoveId) === requesterId) {
            const leaderCount = await db.query(
                'SELECT COUNT(*) as count FROM project_members WHERE project_id = $1 AND role = \'leader\'',
                [id]
            );
            if (leaderCount.rows[0].count <= 1) {
                return res.status(400).json({ error: 'Cannot remove yourself as the only leader. Assign another leader first.' });
            }
        }

        await db.query(
            `DELETE FROM project_members pm
              USING users u
              WHERE pm.project_id = $1
                AND pm.user_id = $2
                AND u.id = pm.user_id
                AND (
                     ($3::uuid IS NULL AND u.company_id IS NULL)
                     OR u.company_id = $3::uuid
                )`,
            [id, memberToRemoveId, requesterCompanyId]
        );
        res.json({ message: 'Member removed' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

// --- Tasks ---

const normalizeAssigneeIds = (assignees) => (
    Array.isArray(assignees)
        ? Array.from(
            new Set(
                assignees
                    .map((assigneeId) => Number(assigneeId))
                    .filter((assigneeId) => Number.isInteger(assigneeId) && assigneeId > 0)
            )
        )
        : []
);

const validateProjectAssignees = async (projectId, assigneeIds) => {
    if (assigneeIds.length === 0) {
        return [];
    }

    const validAssigneesRes = await db.query(
        `SELECT pm.user_id
         FROM project_members pm
         JOIN users u ON u.id = pm.user_id
         WHERE pm.project_id = $1
           AND pm.user_id = ANY($2::int[])
           AND u.role = 'employee'`,
        [projectId, assigneeIds]
    );

    const validAssigneeIds = validAssigneesRes.rows.map((row) => row.user_id);

    if (validAssigneeIds.length !== assigneeIds.length) {
        throw new Error('INVALID_TASK_ASSIGNEES');
    }

    return validAssigneeIds;
};

const getTaskAssigneeIds = async (taskId) => {
    const result = await db.query(
        'SELECT user_id FROM task_assignees WHERE task_id = $1',
        [taskId]
    );

    return result.rows.map((row) => row.user_id);
};

const emitAssignedTaskAlertRefresh = (io, userIds) => {
    if (!io) return;

    [...new Set(userIds.map((userId) => Number(userId)).filter(Boolean))].forEach((userId) => {
        io.to(userId.toString()).emit('assigned_task_alert_update', { userId });
    });
};

const getUsernamesByIds = async (userIds = []) => {
    const normalized = Array.from(
        new Set(
            (Array.isArray(userIds) ? userIds : [])
                .map((id) => Number(id))
                .filter((id) => Number.isInteger(id) && id > 0)
        )
    );
    if (normalized.length === 0) return [];

    const usersRes = await db.query(
        'SELECT id, username FROM users WHERE deleted_at IS NULL AND id = ANY($1::int[])',
        [normalized]
    );
    const byId = new Map(usersRes.rows.map((row) => [row.id, row.username]));
    return normalized.map((id) => byId.get(id)).filter(Boolean);
};

const areSameNumberSets = (left = [], right = []) => {
    const a = Array.from(new Set(left.map(Number).filter((id) => Number.isInteger(id) && id > 0))).sort((x, y) => x - y);
    const b = Array.from(new Set(right.map(Number).filter((id) => Number.isInteger(id) && id > 0))).sort((x, y) => x - y);
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
};

const logTaskActivity = async (taskId, projectId, actorUserId, actionType, details = {}) => {
    await db.query(
        `INSERT INTO task_activity_logs (task_id, project_id, actor_user_id, action_type, details)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [taskId, projectId, actorUserId || null, actionType, JSON.stringify(details || {})]
    );
};

const syncTaskAssignmentAlerts = async (taskId, previousAssigneeIds, nextAssigneeIds, assignedByUserId = null) => {
    const previous = new Set(previousAssigneeIds);
    const next = new Set(nextAssigneeIds);
    const addedAssigneeIds = [...next].filter((userId) => !previous.has(userId));
    const removedAssigneeIds = [...previous].filter((userId) => !next.has(userId));

    if (removedAssigneeIds.length > 0) {
        await db.query(
            'DELETE FROM task_assignment_alerts WHERE task_id = $1 AND user_id = ANY($2::int[])',
            [taskId, removedAssigneeIds]
        );
    }

    for (const userId of addedAssigneeIds) {
        await db.query(
            `INSERT INTO task_assignment_alerts (task_id, user_id, assigned_by, created_at, dismissed_at)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP, NULL)
             ON CONFLICT (task_id, user_id)
             DO UPDATE SET assigned_by = $3, created_at = CURRENT_TIMESTAMP, dismissed_at = NULL`,
            [taskId, userId, assignedByUserId]
        );
    }

    return {
        addedAssigneeIds,
        removedAssigneeIds,
    };
};

// Helper to get task with assignees
async function getTaskWithAssignees(taskId) {
    const result = await db.query(`
        SELECT t.*,
        MAX(u_creator.username) as creator_name,
        COALESCE(MAX(assigner.username), MAX(u_creator.username), 'Legacy task') as assigned_by_name,
        COALESCE(
            json_agg(
                json_build_object(
                    'id', u.id,
                    'username', u.username,
                    'profile_picture', u.profile_picture
                )
            ) FILTER (WHERE u.id IS NOT NULL), 
            '[]'
        ) as assignees
        FROM project_tasks t
        LEFT JOIN task_assignees ta ON t.id = ta.task_id
        LEFT JOIN users u ON ta.user_id = u.id
        LEFT JOIN users assigner ON assigner.id = t.assigned_by
        LEFT JOIN users u_creator ON u_creator.id = t.created_by
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.id = $1
        GROUP BY t.id
    `, [taskId]);
    return result.rows[0];
}

const createTask = async (req, res) => {
    const { project_id, title, description, status, priority, assignees, due_date } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const normalizedAssignees = normalizeAssigneeIds(assignees);
        let validAssigneeIds = [];

        // Check authorization - must be project member or admin
        const access = await checkProjectAccess(project_id, userId, userRole, null, requesterCompanyId);
        if (!access.hasAccess) {
            return res.status(403).json({ error: 'Not authorized to create tasks in this project' });
        }

        // Validate required fields
        if (!title || !String(title).trim()) {
            return res.status(400).json({ error: 'Task title is required' });
        }

        const result = await db.query(
            'INSERT INTO project_tasks (project_id, title, description, status, priority, due_date, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [project_id, String(title).trim(), description || null, status || 'todo', priority || 'medium', due_date || null, userId]
        );

        const task = result.rows[0];

        // Handle assignees
        if (normalizedAssignees.length > 0) {
            validAssigneeIds = await validateProjectAssignees(project_id, normalizedAssignees);
            for (const assigneeId of validAssigneeIds) {
                await db.query(
                    'INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [task.id, assigneeId]
                );
            }

            await db.query(
                'UPDATE project_tasks SET assigned_by = $1, assigned_at = CURRENT_TIMESTAMP WHERE id = $2',
                [userId, task.id]
            );

            // Notify newly assigned employees via Telegram
            notificationService.sendTaskAssignmentNotification(task.id, validAssigneeIds, userId).catch(err => {
                console.error('[ProjectController] Failed to send task assignment notification:', err.message);
            });
        }

        const createdAssigneeNames = await getUsernamesByIds(validAssigneeIds);
        await logTaskActivity(task.id, project_id, userId, 'task_created', {
            title: task.title,
            assigneeIds: validAssigneeIds,
            assigneeNames: createdAssigneeNames
        });

        const alertChanges = await syncTaskAssignmentAlerts(task.id, [], validAssigneeIds, userId);

        const completeTask = await getTaskWithAssignees(task.id);

        // Notify via socket
        const io = req.app.get('io');
        if (io) {
            io.emit('project_task_update', { type: 'create', task: completeTask });
            emitAssignedTaskAlertRefresh(io, alertChanges.addedAssigneeIds);
        }

        res.status(201).json(completeTask);
    } catch (err) {
        if (err.message === 'INVALID_TASK_ASSIGNEES') {
            return res.status(400).json({ error: 'All assignees must be members of this project.' });
        }
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getProjectTasks = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        // Check authorization - must be project member or admin
        const access = await checkProjectAccess(id, userId, userRole, null, requesterCompanyId);
        if (!access.hasAccess) {
            return res.status(403).json({ error: 'Not authorized to view tasks in this project' });
        }

        const result = await db.query(`
            SELECT t.*,
            MAX(u_creator.username) as creator_name,
            COALESCE(MAX(assigner.username), MAX(u_creator.username), 'Legacy task') as assigned_by_name,
            COALESCE(
                json_agg(
                    json_build_object(
                        'id', u.id,
                        'username', u.username,
                        'profile_picture', u.profile_picture
                    )
                ) FILTER (WHERE u.id IS NOT NULL), 
                '[]'
            ) as assignees
            FROM project_tasks t
            LEFT JOIN task_assignees ta ON t.id = ta.task_id
            LEFT JOIN users u ON ta.user_id = u.id
            LEFT JOIN users assigner ON assigner.id = t.assigned_by
            LEFT JOIN users u_creator ON u_creator.id = t.created_by
            LEFT JOIN projects p ON p.id = t.project_id
            WHERE t.project_id = $1
            GROUP BY t.id
            ORDER BY t.position ASC, t.created_at DESC
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getAssignedTaskAlerts = async (req, res) => {
    const userId = req.user.id;

    try {
        const result = await db.query(`
            SELECT
                taa.task_id,
                taa.created_at AS assigned_at,
                taa.assigned_by,
                assigner.username AS assigned_by_name,
                t.project_id,
                t.title,
                t.description,
                t.status,
                t.priority,
                t.due_date,
                p.name AS project_name
            FROM task_assignment_alerts taa
            JOIN project_tasks t ON t.id = taa.task_id
            JOIN projects p ON p.id = t.project_id
            LEFT JOIN users assigner ON assigner.id = taa.assigned_by
            WHERE taa.user_id = $1
              AND taa.dismissed_at IS NULL
            ORDER BY taa.created_at DESC
        `, [userId]);

        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const dismissAssignedTaskAlert = async (req, res) => {
    const { taskId } = req.params;
    const userId = req.user.id;

    try {
        await db.query(
            'UPDATE task_assignment_alerts SET dismissed_at = CURRENT_TIMESTAMP WHERE task_id = $1 AND user_id = $2',
            [taskId, userId]
        );

        const io = req.app.get('io');
        if (io) {
            emitAssignedTaskAlertRefresh(io, [userId]);
        }

        res.json({ message: 'Alert dismissed' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getProjectActivityLogs = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        // Only admins and moderators can see project logs as per user request
        if (!hasPrivilegedProjectAccess(userRole)) {
            return res.status(403).json({ error: 'Only admins and moderators can view project logs' });
        }

        const logsRes = await db.query(
            `SELECT tal.id, tal.task_id, tal.project_id, tal.actor_user_id, tal.action_type, tal.details, tal.created_at,
                    u.username AS actor_username, u.role AS actor_role
             FROM task_activity_logs tal
             LEFT JOIN users u ON u.id = tal.actor_user_id
             WHERE tal.project_id = $1
             ORDER BY tal.created_at DESC, tal.id DESC
             LIMIT 200`,
            [id]
        );

        res.json(logsRes.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const updateTask = async (req, res) => {
    const { taskId } = req.params;
    const { title, description, status, priority, assignees, due_date, position, attachments } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const normalizedAssignees = normalizeAssigneeIds(assignees);
        let alertRefreshUserIds = [];

        // First get the task to check project access
        const taskCheck = await db.query('SELECT project_id, title, status, description, priority, due_date FROM project_tasks WHERE id = $1', [taskId]);
        if (taskCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }
        const currentTask = taskCheck.rows[0];
        const projectId = currentTask.project_id;

        // Check authorization - must be project member, assignee, or admin
        const access = await checkProjectAccess(projectId, userId, userRole, null, requesterCompanyId);
        if (!access.hasAccess) {
            return res.status(403).json({ error: 'Not authorized to update tasks in this project' });
        }

        // Additional check: non-privileged users can only update tasks assigned to them
        if (!access.isAdmin && access.memberRole !== 'leader') {
            const assigneeCheck = await db.query(
                'SELECT 1 FROM task_assignees WHERE task_id = $1 AND user_id = $2',
                [taskId, userId]
            );
            if (assigneeCheck.rows.length === 0) {
                return res.status(403).json({ error: 'Not authorized to update this task. Only assignees, leaders, moderators, or admins can update.' });
            }
        }

        const result = await db.query(
            `UPDATE project_tasks SET 
             title = COALESCE($1, title), 
             description = COALESCE($2, description), 
             status = COALESCE($3, status), 
             priority = COALESCE($4, priority), 
             due_date = COALESCE($5, due_date),
             position = COALESCE($6, position),
             attachments = COALESCE($7, attachments),
             updated_at = CURRENT_TIMESTAMP 
             WHERE id = $8 RETURNING *`,
            [title ? String(title).trim() : null, description, status, priority, due_date, position, attachments !== undefined ? JSON.stringify(attachments) : null, taskId]
        );

        // Update assignees if provided
        if (assignees !== undefined && Array.isArray(assignees)) {
            // Only leaders, moderators, or admins can change assignees
            if (access.isAdmin || access.memberRole === 'leader') {
                const previousAssigneeIds = await getTaskAssigneeIds(taskId);
                const validAssigneeIds = await validateProjectAssignees(projectId, normalizedAssignees);
                await db.query('DELETE FROM task_assignees WHERE task_id = $1', [taskId]);
                for (const assigneeId of validAssigneeIds) {
                    await db.query(
                        'INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                        [taskId, assigneeId]
                    );
                }

                if (validAssigneeIds.length > 0) {
                    await db.query(
                        'UPDATE project_tasks SET assigned_by = $1, assigned_at = CURRENT_TIMESTAMP WHERE id = $2',
                        [userId, taskId]
                    );
                } else {
                    await db.query(
                        'UPDATE project_tasks SET assigned_by = NULL, assigned_at = NULL WHERE id = $1',
                        [taskId]
                    );
                }

                const alertChanges = await syncTaskAssignmentAlerts(taskId, previousAssigneeIds, validAssigneeIds, userId);
                alertRefreshUserIds = [...alertChanges.addedAssigneeIds, ...alertChanges.removedAssigneeIds];

                // Notify only newly added assignees
                if (alertChanges.addedAssigneeIds.length > 0) {
                    notificationService.sendTaskAssignmentNotification(taskId, alertChanges.addedAssigneeIds, userId).catch(err => {
                        console.error('[ProjectController] Failed to send task assignment notification:', err.message);
                    });
                }

                if (!areSameNumberSets(previousAssigneeIds, validAssigneeIds)) {
                    const previousAssigneeNames = await getUsernamesByIds(previousAssigneeIds);
                    const newAssigneeNames = await getUsernamesByIds(validAssigneeIds);
                    const previousSet = new Set(previousAssigneeIds);
                    const nextSet = new Set(validAssigneeIds);
                    const addedIds = validAssigneeIds.filter((id) => !previousSet.has(id));
                    const removedIds = previousAssigneeIds.filter((id) => !nextSet.has(id));

                    await logTaskActivity(taskId, projectId, userId, 'assignees_updated', {
                        title: result.rows[0]?.title || null,
                        fromAssigneeIds: previousAssigneeIds,
                        fromAssigneeNames: previousAssigneeNames,
                        toAssigneeIds: validAssigneeIds,
                        toAssigneeNames: newAssigneeNames,
                        addedIds,
                        removedIds,
                        addedNames: await getUsernamesByIds(addedIds),
                        removedNames: await getUsernamesByIds(removedIds)
                    });
                }
            }
        }

        // Log status change
        if (status && status !== currentTask.status) {
            await logTaskActivity(taskId, projectId, userId, 'status_updated', {
                title: result.rows[0].title,
                fromStatus: currentTask.status,
                toStatus: status
            });
        }

        // Log general modification
        if (title || description || priority || due_date) {
            const changedFields = [];
            if (title && title !== currentTask.title) changedFields.push('title');
            if (description !== undefined && description !== currentTask.description) changedFields.push('description');
            if (priority && priority !== currentTask.priority) changedFields.push('priority');
            if (due_date !== undefined && due_date !== currentTask.due_date) changedFields.push('due_date');

            if (changedFields.length > 0) {
                await logTaskActivity(taskId, projectId, userId, 'task_modified', {
                    title: result.rows[0].title,
                    fields: changedFields
                });
            }
        }

        const completeTask = await getTaskWithAssignees(taskId);

        // Notify via socket
        const io = req.app.get('io');
        if (io) {
            io.emit('project_task_update', { type: 'update', task: completeTask });
            emitAssignedTaskAlertRefresh(io, alertRefreshUserIds);
        }

        res.json(completeTask);
    } catch (err) {
        if (err.message === 'INVALID_TASK_ASSIGNEES') {
            return res.status(400).json({ error: 'All assignees must be members of this project.' });
        }
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const deleteTask = async (req, res) => {
    const { taskId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        // First get the task to check project access
        const taskCheck = await db.query('SELECT project_id, title FROM project_tasks WHERE id = $1', [taskId]);
        if (taskCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }
        const currentTask = taskCheck.rows[0];
        const projectId = currentTask.project_id;
        const taskTitle = taskCheck.rows[0].title;
        const assigneeIds = await getTaskAssigneeIds(taskId);

        // Check authorization - only project leaders, moderators, or admins can delete tasks
        const access = await checkProjectAccess(projectId, userId, userRole, 'leader', requesterCompanyId);
        if (!access.hasAccess) {
            return res.status(403).json({ error: 'Not authorized to delete tasks. Only project leaders, moderators, or admins can delete tasks.' });
        }

        const assigneeNames = await getUsernamesByIds(assigneeIds);
        await logTaskActivity(Number(taskId), projectId, userId, 'task_deleted', {
            title: taskTitle,
            assigneeIds,
            assigneeNames
        });

        const result = await db.query('DELETE FROM project_tasks WHERE id = $1 RETURNING project_id', [taskId]);
        if (result.rows.length > 0) {
            const io = req.app.get('io');
            if (io) {
                io.emit('project_task_update', { type: 'delete', taskId, projectId: result.rows[0].project_id });
                emitAssignedTaskAlertRefresh(io, assigneeIds);
            }
        }
        res.json({ message: 'Task deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getTaskComments = async (req, res) => {
    const { taskId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        // First get the task to check project access
        const taskCheck = await db.query('SELECT project_id FROM project_tasks WHERE id = $1', [taskId]);
        if (taskCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }
        const projectId = taskCheck.rows[0].project_id;

        // Check authorization - must be project member or admin
        const access = await checkProjectAccess(projectId, userId, userRole, null, requesterCompanyId);
        if (!access.hasAccess) {
            return res.status(403).json({ error: 'Not authorized to view comments in this project' });
        }

        const result = await db.query(`
            SELECT c.*, u.username, u.profile_picture 
            FROM task_comments c
            LEFT JOIN users u ON c.user_id = u.id
            WHERE c.task_id = $1
            ORDER BY c.created_at ASC
        `, [taskId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const addTaskComment = async (req, res) => {
    const { taskId } = req.params;
    const { content, attachments } = req.body;
    const user_id = req.user.id;
    const userRole = req.user.role;

    try {
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        // First get the task to check project access
        const taskCheck = await db.query('SELECT project_id FROM project_tasks WHERE id = $1', [taskId]);
        if (taskCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }
        const projectId = taskCheck.rows[0].project_id;

        // Check authorization - must be project member or admin
        const access = await checkProjectAccess(projectId, user_id, userRole, null, requesterCompanyId);
        if (!access.hasAccess) {
            return res.status(403).json({ error: 'Not authorized to comment in this project' });
        }

        // Validate content
        if (!content || !String(content).trim()) {
            return res.status(400).json({ error: 'Comment content is required' });
        }

        const result = await db.query(
            'INSERT INTO task_comments (task_id, user_id, content, attachments) VALUES ($1, $2, $3, $4) RETURNING *',
            [taskId, user_id, content, JSON.stringify(attachments || [])]
        );

        const comment = result.rows[0];

        // Fetch user details to return full comment object
        const userRes = await db.query('SELECT username, profile_picture FROM users WHERE deleted_at IS NULL AND id = $1', [user_id]);
        const fullComment = { ...comment, ...userRes.rows[0] };

        // Notify via socket
        const io = req.app.get('io');
        if (io) {
            io.emit('task_comment_update', { type: 'create', taskId, comment: fullComment });
        }

        res.status(201).json(fullComment);
    } catch (err) {
        console.error('[addTaskComment] Error adding comment:', err);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
};

const uploadTaskAttachment = async (req, res) => {
    const { taskId } = req.params;
    const files = req.files;

    if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }

    try {
        // Fetch current attachments
        const taskRes = await db.query('SELECT attachments FROM project_tasks WHERE id = $1', [taskId]);
        if (taskRes.rows.length === 0) return res.status(404).json({ error: 'Task not found' });

        const currentAttachments = taskRes.rows[0].attachments || [];
        const uploadedFiles = await Promise.all(
            files.map((file) => uploadIncomingFile(file, { folder: 'tasks' }))
        );

        const newAttachments = uploadedFiles.map((file) => ({
            name: file.name,
            url: file.url,
            type: file.type,
            size: file.size,
            uploaded_at: new Date().toISOString()
        }));

        const updatedAttachments = [...currentAttachments, ...newAttachments];

        await db.query(
            'UPDATE project_tasks SET attachments = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [JSON.stringify(updatedAttachments), taskId]
        );

        // Notify via socket
        const io = req.app.get('io');
        if (io) {
            io.emit('project_task_update', { 
                type: 'update', 
                taskId, 
                task: { id: taskId, attachments: updatedAttachments } 
            });
        }

        res.json({ message: 'Files uploaded successfully', attachments: newAttachments });
    } catch (err) {
        console.error('[uploadTaskAttachment] Error:', err);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
};

module.exports = {
    createProject,
    getProjects,
    getProjectDetails,
    updateProject,
    deleteProject,
    getDeletedProjects,
    restoreProject,
    addMember,
    removeMember,
    createTask,
    getProjectTasks,
    getAssignedTaskAlerts,
    dismissAssignedTaskAlert,
    getProjectActivityLogs,
    updateTask,
    deleteTask,
    getTaskComments,
    addTaskComment,
    uploadTaskAttachment
};
