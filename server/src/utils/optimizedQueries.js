const db = require('../db');

const getOptimizedDashboardStats = async (companyId) => {
  const queries = new Map();

  queries.set('employeeCount', db.query(
    `SELECT COUNT(*) as count FROM users WHERE company_id = $1 AND is_active = true AND role = 'EMPLOYEE'`,
    [companyId]
  ));

  queries.set('activeToday', db.query(
    `SELECT COUNT(DISTINCT user_id) as count 
     FROM "ActivityLog" 
     WHERE timestamp::date = CURRENT_DATE 
     AND user_id IN (SELECT id FROM users WHERE company_id = $1)`,
    [companyId]
  ));

  queries.set('pendingLeaves', db.query(
    `SELECT COUNT(*) as count FROM "Leave" 
     WHERE status = 'pending' 
     AND user_id IN (SELECT id FROM users WHERE company_id = $1)`,
    [companyId]
  ));

  queries.set('activeProjects', db.query(
    `SELECT COUNT(*) as count FROM "Project" 
     WHERE status = 'active' 
     AND deleted_at IS NULL
     AND created_by IN (SELECT id FROM users WHERE company_id = $1)`,
    [companyId]
  ));

  queries.set('recentTasks', db.query(
    `SELECT pt.id, pt.title, pt.status, pt.priority, pt.due_date, 
            p.name as project_name,
            u.username as assigned_to
     FROM "ProjectTask" pt
     LEFT JOIN "Project" p ON pt.project_id = p.id
     LEFT JOIN "TaskAssignee" ta ON pt.id = ta.task_id
     LEFT JOIN users u ON ta.user_id = u.id
     WHERE p.company_id = $1 OR p.company_id IS NULL
     ORDER BY pt.created_at DESC
     LIMIT 10`,
    [companyId]
  ));

  queries.set('recentActivities', db.query(
    `SELECT al.*, u.username, u.full_name, u.profile_picture
     FROM "ActivityLog" al
     JOIN users u ON al.user_id = u.id
     WHERE u.company_id = $1
     ORDER BY al.timestamp DESC
     LIMIT 20`,
    [companyId]
  ));

  queries.set('departmentBreakdown', db.query(
    `SELECT department, COUNT(*) as count 
     FROM users 
     WHERE company_id = $1 AND is_active = true AND department IS NOT NULL
     GROUP BY department
     ORDER BY count DESC`,
    [companyId]
  ));

  queries.set('leaveBalanceStats', db.query(
    `SELECT SUM(paid_leave_balance) as total_days, AVG(paid_leave_balance) as avg_days
     FROM users 
     WHERE company_id = $1 AND is_active = true`,
    [companyId]
  ));

  const results = {};
  for (const [key, promise] of queries) {
    try {
      const result = await promise;
      results[key] = result.rows[0];
    } catch (err) {
      console.error(`[DashboardStats] Error in ${key}:`, err.message);
      results[key] = key.includes('recent') ? [] : { count: 0 };
    }
  }

  return {
    employees: {
      total: parseInt(results.employeeCount?.count || 0),
      activeToday: parseInt(results.activeToday?.count || 0)
    },
    leaves: {
      pending: parseInt(results.pendingLeaves?.count || 0)
    },
    projects: {
      active: parseInt(results.activeProjects?.count || 0)
    },
    recentTasks: results.recentTasks || [],
    recentActivities: results.recentActivities || [],
    departments: results.departmentBreakdown || [],
    leaveStats: {
      totalDays: parseFloat(results.leaveBalanceStats?.total_days || 0),
      avgDays: parseFloat(results.leaveBalanceStats?.avg_days || 0).toFixed(1)
    }
  };
};

const getOptimizedEmployeeList = async (companyId, options = {}) => {
  const { search, department, status, page = 1, limit = 50 } = options;
  const offset = (page - 1) * limit;

  let whereConditions = ['u.company_id = $1', 'u.is_active = true'];
  let params = [companyId];
  let paramIndex = 2;

  if (search) {
    whereConditions.push(`(LOWER(u.full_name) LIKE $${paramIndex} OR LOWER(u.username) LIKE $${paramIndex} OR LOWER(u.email) LIKE $${paramIndex})`);
    params.push(`%${search.toLowerCase()}%`);
    paramIndex++;
  }

  if (department) {
    whereConditions.push(`u.department = $${paramIndex}`);
    params.push(department);
    paramIndex++;
  }

  if (status) {
    whereConditions.push(`u.status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  const whereClause = whereConditions.join(' AND ');

  const countQuery = `SELECT COUNT(*) as total FROM users u WHERE ${whereClause}`;
  const countResult = await db.query(countQuery, params);
  const total = parseInt(countResult.rows[0]?.total || 0, 10);

  const dataQuery = `
    SELECT u.id, u.full_name, u.username, u.email, u.role, u.status, 
           u.department, u.profile_picture, u.contact_number,
           u.paid_leave_balance, u.minutes_balance,
           u.last_heartbeat, u.created_at,
           COALESCE(
             (SELECT MAX(timestamp) FROM "ActivityLog" al WHERE al.user_id = u.id AND al.timestamp::date = CURRENT_DATE),
             NULL
           ) as clocked_in_today
    FROM users u
    WHERE ${whereClause}
    ORDER BY u.full_name
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;
  params.push(limit, offset);

  const dataResult = await db.query(dataQuery, params);

  return {
    data: dataResult.rows,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

const getOptimizedTaskList = async (companyId, options = {}) => {
  const { status, priority, assignedTo, projectId, page = 1, limit = 50 } = options;
  const offset = (page - 1) * limit;

  let whereConditions = [];
  let params = [companyId];
  let paramIndex = 2;

  if (status) {
    whereConditions.push(`pt.status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  if (priority) {
    whereConditions.push(`pt.priority = $${paramIndex}`);
    params.push(priority);
    paramIndex++;
  }

  if (projectId) {
    whereConditions.push(`pt.project_id = $${paramIndex}`);
    params.push(projectId);
    paramIndex++;
  }

  const whereClause = whereConditions.length > 0 
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  const countQuery = `
    SELECT COUNT(*) as total 
    FROM "ProjectTask" pt
    JOIN "Project" p ON pt.project_id = p.id
    ${whereClause}
  `;
  const countResult = await db.query(countQuery, params);
  const total = parseInt(countResult.rows[0]?.total || 0, 10);

  const dataQuery = `
    SELECT pt.*, 
           p.name as project_name,
           creator.username as creator_username,
           creator.full_name as creator_full_name,
           array_agg(DISTINCT assignee.username) FILTER (WHERE assignee.username IS NOT NULL) as assignees
    FROM "ProjectTask" pt
    JOIN "Project" p ON pt.project_id = p.id
    LEFT JOIN users creator ON pt.created_by = creator.id
    LEFT JOIN "TaskAssignee" ta ON pt.id = ta.task_id
    LEFT JOIN users assignee ON ta.user_id = assignee.id
    ${whereClause}
    GROUP BY pt.id, p.name, creator.username, creator.full_name
    ORDER BY pt.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;
  params.push(limit, offset);

  const dataResult = await db.query(dataQuery, params);

  return {
    data: dataResult.rows,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

module.exports = {
  getOptimizedDashboardStats,
  getOptimizedEmployeeList,
  getOptimizedTaskList
};