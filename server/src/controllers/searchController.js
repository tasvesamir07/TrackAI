const db = require('../db');

const searchAll = async (req, res) => {
  try {
    const { q, type } = req.query;
    if (!q || q.length < 2) {
      return res.json({ employees: [], projects: [], tasks: [], leaves: [] });
    }
    const searchTerm = `%${q}%`;
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const results = {
      employees: [],
      projects: [],
      tasks: [],
      leaves: []
    };
    if (type === 'all' || type === 'employee') {
      const employeesQuery = `
        SELECT id, full_name, username, email, role, department, profile_picture
        FROM users
        WHERE company_id = $1
        AND status = 'active'
        AND (full_name ILIKE $2 OR username ILIKE $2 OR email ILIKE $2)
        ORDER BY full_name
        LIMIT 10
      `;
      const { rows: employees } = await db.query(employeesQuery, [companyId, searchTerm]);
      results.employees = employees.map(emp => ({
        type: 'employee',
        id: emp.id,
        title: emp.full_name || emp.username,
        subtitle: emp.email,
        url: `/profile?userId=${emp.id}`,
        icon: null
      }));
    }
    if (type === 'all' || type === 'project') {
      const projectsQuery = `
        SELECT id, name, description, status
        FROM projects
        WHERE company_id = $1
        AND (name ILIKE $2 OR description ILIKE $2)
        ORDER BY name
        LIMIT 10
      `;
      const { rows: projects } = await db.query(projectsQuery, [companyId, searchTerm]);
      results.projects = projects.map(proj => ({
        type: 'project',
        id: proj.id,
        title: proj.name,
        subtitle: proj.status || 'Active',
        url: `/projects?projectId=${proj.id}`,
        icon: null
      }));
    }
    if (type === 'all' || type === 'task') {
      const tasksQuery = `
        SELECT t.id, t.title, t.status, p.name as project_name
        FROM tasks t
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE t.company_id = $1
        AND (t.title ILIKE $2 OR t.description ILIKE $2)
        AND (t.assignee_id = $3 OR t.created_by = $3 OR $4 IN ('admin', 'COMPANY_ADMIN', 'moderator'))
        ORDER BY t.created_at DESC
        LIMIT 10
      `;
      const userRole = req.user?.role || '';
      const isAdmin = ['admin', 'COMPANY_ADMIN', 'moderator'].includes(userRole);
      const { rows: tasks } = await db.query(tasksQuery, [companyId, searchTerm, userId, isAdmin ? userId : null]);
      results.tasks = tasks.map(task => ({
        type: 'task',
        id: task.id,
        title: task.title,
        subtitle: task.project_name ? `Project: ${task.project_name}` : task.status,
        url: `/projects?taskId=${task.id}`,
        icon: null
      }));
    }
    if (type === 'all' || type === 'leave') {
      const leavesQuery = `
        SELECT l.id, lt.name as leave_type, l.start_date, l.end_date, l.status, u.full_name as employee_name
        FROM leaves l
        LEFT JOIN leave_types lt ON l.leave_type_id = lt.id
        LEFT JOIN users u ON l.user_id = u.id
        WHERE l.company_id = $1
        AND (u.full_name ILIKE $2 OR lt.name ILIKE $2)
        ORDER BY l.created_at DESC
        LIMIT 10
      `;
      const { rows: leaves } = await db.query(leavesQuery, [companyId, searchTerm]);
      results.leaves = leaves.map(leave => ({
        type: 'leave',
        id: leave.id,
        title: `${leave.employee_name} - ${leave.leave_type}`,
        subtitle: `${leave.start_date} to ${leave.end_date} (${leave.status})`,
        url: `/admin?tab=leaves&leaveId=${leave.id}`,
        icon: null
      }));
    }
    return res.json({ data: results });
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
};

module.exports = {
  searchAll
};