/**
 * User Service
 * Handles user-related business logic
 * @service UserService
 * @description Provides CRUD operations for user management within companies
 */

const db = require('../db');
const bcrypt = require('bcryptjs');

/**
 * @class UserService
 * @description User management service for CRUD operations
 */
class UserService {
  /**
   * Create a new user
   * @async
   * @method create
   * @param {Object} userData - User data object
   * @param {string} userData.username - Unique username
   * @param {string} [userData.email] - User email address
   * @param {string} [userData.full_name] - Full name of user
   * @param {string} [userData.role='EMPLOYEE'] - User role (EMPLOYEE, PROJECT_MANAGER, COMPANY_ADMIN)
   * @param {string} [userData.department] - Department name
   * @param {string} [userData.contact_number] - Contact phone number
   * @param {string} [userData.password] - Plain text password
   * @param {string} companyId - Company UUID
   * @returns {Promise<Object>} Created user object
   * @example
   * const user = await UserService.create({
   *   username: 'john.doe',
   *   email: 'john@example.com',
   *   role: 'EMPLOYEE',
   *   companyId: '550e8400-e29b-41d4-a716-446655440001'
   * });
   */
  async create(userData, companyId) {
    const { username, email, full_name, role, department, contact_number, password } = userData;
    
    const bcryptRounds = Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
    const password_hash = password ? await bcrypt.hash(password, bcryptRounds) : null;
    
    const { rows } = await db.query(
      `INSERT INTO users (username, email, full_name, role, department, contact_number, password_hash, company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, username, email, full_name, role, department, is_active, created_at`,
      [username, email, full_name, role || 'EMPLOYEE', department, contact_number, password_hash, companyId]
    );
    
    return rows[0];
  }

  /**
   * Get users by company with pagination
   */
  async getByCompany(companyId, options = {}) {
    const { page = 1, limit = 50, search, department, role } = options;
    const offset = (page - 1) * limit;
    
    let query = 'SELECT id, username, email, full_name, role, department, is_active, created_at FROM users WHERE company_id = $1';
    const params = [companyId];
    
    if (search) {
      query += ` AND (username ILIKE $${params.length + 1} OR full_name ILIKE $${params.length + 1} OR email ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }
    
    if (department) {
      query += ` AND department = $${params.length + 1}`;
      params.push(department);
    }
    
    if (role) {
      query += ` AND role = $${params.length + 1}`;
      params.push(role);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    const { rows } = await db.query(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM users WHERE company_id = $1';
    const countParams = [companyId];
    
    if (search) {
      countQuery += ` AND (username ILIKE $2 OR full_name ILIKE $2 OR email ILIKE $2)`;
      countParams.push(`%${search}%`);
    }
    
    const { rows: [{ count }] } = await db.query(countQuery, countParams);
    
    return {
      users: rows,
      total: parseInt(count),
      page,
      limit
    };
  }

  /**
   * Get user by ID
   */
  async getById(userId, companyId) {
    const { rows } = await db.query(
      `SELECT id, username, email, full_name, role, department, contact_number, is_active, created_at
       FROM users WHERE id = $1 AND company_id = $2`,
      [userId, companyId]
    );
    
    return rows[0] || null;
  }

  /**
   * Update user
   */
  async update(userId, companyId, updateData) {
    const allowedFields = ['full_name', 'email', 'role', 'department', 'contact_number', 'is_active'];
    const updates = [];
    const params = [];
    
    Object.entries(updateData).forEach(([key, value], index) => {
      if (allowedFields.includes(key) && value !== undefined) {
        updates.push(`${key} = $${index + 1}`);
        params.push(value);
      }
    });
    
    if (updates.length === 0) return null;
    
    params.push(userId, companyId);
    
    const { rows } = await db.query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND company_id = $${params.length}
       RETURNING id, username, email, full_name, role, department, is_active`,
      params
    );
    
    return rows[0] || null;
  }

  /**
   * Delete (soft delete) user
   */
  async delete(userId, companyId) {
    const { rows } = await db.query(
      `UPDATE users SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING id`,
      [userId, companyId]
    );
    
    return rows[0] ? true : false;
  }

  /**
   * Get departments for company
   */
  async getDepartments(companyId) {
    const { rows } = await db.query(
      `SELECT DISTINCT department FROM users 
       WHERE company_id = $1 AND department IS NOT NULL AND department != ''
       ORDER BY department`,
      [companyId]
    );
    
    return rows.map(r => r.department);
  }
}

module.exports = new UserService();