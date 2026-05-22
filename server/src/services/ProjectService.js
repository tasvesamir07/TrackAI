/**
 * Project Service
 * Handles project-related business logic
 * @service ProjectService
 * @description Provides CRUD operations for project management including team members
 */

const db = require('../db');

/**
 * @class ProjectService
 * @description Project management service for CRUD operations and team management
 */
class ProjectService {
  /**
   * Create a new project
   * @async
   * @method create
   * @param {Object} projectData - Project data object
   * @param {string} projectData.name - Project name
   * @param {string} [projectData.description] - Project description
   * @param {string} [projectData.status='active'] - Project status (active, completed, archived)
   * @param {string} [projectData.start_date] - Start date (YYYY-MM-DD)
   * @param {string} [projectData.end_date] - End date (YYYY-MM-DD)
   * @param {string} companyId - Company UUID
   * @param {number} userId - Creator user ID
   * @returns {Promise<Object>} Created project object
   */
  async create(projectData, companyId, userId) {
    const { name, description, status, start_date, end_date } = projectData;
    
    const { rows } = await db.query(
      `INSERT INTO projects (name, description, status, start_date, end_date, company_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, description, status || 'active', start_date, end_date, companyId, userId]
    );
    
    return rows[0];
  }

  /**
   * Get projects by company
   */
  async getByCompany(companyId, options = {}) {
    const { page = 1, limit = 50, status, search } = options;
    const offset = (page - 1) * limit;
    
    let query = 'SELECT * FROM projects WHERE company_id = $1';
    const params = [companyId];
    
    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }
    
    if (search) {
      query += ` AND (name ILIKE $${params.length + 1} OR description ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    const { rows } = await db.query(query, params);
    
    return rows;
  }

  /**
   * Get project by ID
   */
  async getById(projectId, companyId) {
    const { rows } = await db.query(
      `SELECT * FROM projects WHERE id = $1 AND company_id = $2`,
      [projectId, companyId]
    );
    
    return rows[0] || null;
  }

  /**
   * Update project
   */
  async update(projectId, companyId, updateData) {
    const allowedFields = ['name', 'description', 'status', 'start_date', 'end_date'];
    const updates = [];
    const params = [];
    
    Object.entries(updateData).forEach(([key, value], index) => {
      if (allowedFields.includes(key) && value !== undefined) {
        updates.push(`${key} = $${index + 1}`);
        params.push(value);
      }
    });
    
    if (updates.length === 0) return null;
    
    params.push(projectId, companyId);
    
    const { rows } = await db.query(
      `UPDATE projects SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND company_id = $${params.length}
       RETURNING *`,
      params
    );
    
    return rows[0] || null;
  }

  /**
   * Delete project
   */
  async delete(projectId, companyId) {
    const { rows } = await db.query(
      `UPDATE projects SET status = 'archived', updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING id`,
      [projectId, companyId]
    );
    
    return rows[0] ? true : false;
  }

  /**
   * Add members to project
   */
  async addMembers(projectId, companyId, userIds) {
    const values = userIds.map((userId, index) => `$${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3}`).join(', ');
    const params = userIds.flatMap(userId => [projectId, userId, companyId]);
    
    const { rows } = await db.query(
      `INSERT INTO project_members (project_id, user_id, company_id)
       VALUES ${values}
       ON CONFLICT (project_id, user_id) DO NOTHING
       RETURNING project_id`,
      params
    );
    
    return rows.length;
  }

  /**
   * Remove member from project
   */
  async removeMember(projectId, userId, companyId) {
    const { rows } = await db.query(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 AND company_id = $3 RETURNING project_id`,
      [projectId, userId, companyId]
    );
    
    return rows[0] ? true : false;
  }

  /**
   * Get project members
   */
  async getMembers(projectId, companyId) {
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.role, pm.role as project_role
       FROM project_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = $1 AND pm.company_id = $2`,
      [projectId, companyId]
    );
    
    return rows;
  }

  /**
   * Get project stats
   */
  async getStats(projectId, companyId) {
    const { rows } = await db.query(
      `SELECT 
         COUNT(DISTINCT pm.user_id) as total_members,
         COUNT(DISTINCT t.id) as total_tasks,
         COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_tasks,
         COUNT(CASE WHEN t.status = 'in_progress' THEN 1 END) as in_progress_tasks
       FROM projects p
       LEFT JOIN project_members pm ON p.id = pm.project_id
       LEFT JOIN tasks t ON p.id = t.project_id
       WHERE p.id = $1 AND p.company_id = $2`,
      [projectId, companyId]
    );
    
    return rows[0];
  }
}

module.exports = new ProjectService();