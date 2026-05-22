/**
 * Attendance Service
 * Handles attendance-related business logic
 * @service AttendanceService
 * @description Provides check-in/check-out functionality and attendance tracking
 */

const db = require('../db');
const { format } = require('date-fns');

/**
 * @class AttendanceService
 * @description Attendance management service for tracking employee check-ins and work hours
 */
class AttendanceService {
  /**
   * Check in user for the day
   * @async
   * @method checkIn
   * @param {number} userId - User ID
   * @param {string} companyId - Company UUID
   * @param {Object} [checkInData={}] - Optional check-in data
   * @param {string} [checkInData.location] - Check-in location (GPS coordinates or address)
   * @returns {Promise<Object>} Created attendance record
   * @throws {Error} If user already checked in today
   * @example
   * const record = await AttendanceService.checkIn(1, 'company-uuid', { location: 'Office' });
   */
  async checkIn(userId, companyId, checkInData = {}) {
    const today = format(new Date(), 'yyyy-MM-dd');
    const now = new Date().toISOString();
    
    // Check if already checked in today
    const existing = await db.query(
      `SELECT id FROM attendance WHERE user_id = $1 AND date = $2`,
      [userId, today]
    );
    
    if (existing.rows.length > 0) {
      throw new Error('Already checked in today');
    }
    
    const { rows } = await db.query(
      `INSERT INTO attendance (user_id, company_id, date, check_in_time, check_in_location)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, companyId, today, now, checkInData.location || null]
    );
    
    return rows[0];
  }

  /**
   * Check out user
   */
  async checkOut(userId, companyId, checkOutData = {}) {
    const today = format(new Date(), 'yyyy-MM-dd');
    const now = new Date().toISOString();
    
    const { rows } = await db.query(
      `UPDATE attendance SET check_out_time = $1, check_out_location = $2, updated_at = NOW()
       WHERE user_id = $3 AND company_id = $4 AND date = $5 AND check_out_time IS NULL
       RETURNING *`,
      [now, checkOutData.location || null, userId, companyId, today]
    );
    
    if (rows.length === 0) {
      throw new Error('No active check-in found or already checked out');
    }
    
    return rows[0];
  }

  /**
   * Get today's attendance for company
   */
  async getTodayAttendance(companyId) {
    const today = format(new Date(), 'yyyy-MM-dd');
    
    const { rows } = await db.query(
      `SELECT a.*, u.username, u.full_name, u.email, u.profile_picture
       FROM attendance a
       JOIN users u ON a.user_id = u.id
       WHERE a.company_id = $1 AND a.date = $2
       ORDER BY a.check_in_time DESC`,
      [companyId, today]
    );
    
    return rows;
  }

  /**
   * Get attendance records
   */
  async getRecords(companyId, options = {}) {
    const { userId, startDate, endDate, page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;
    
    let query = `SELECT a.*, u.username, u.full_name, u.email 
                 FROM attendance a
                 JOIN users u ON a.user_id = u.id
                 WHERE a.company_id = $1`;
    const params = [companyId];
    
    if (userId) {
      query += ` AND a.user_id = $${params.length + 1}`;
      params.push(userId);
    }
    
    if (startDate) {
      query += ` AND a.date >= $${params.length + 1}`;
      params.push(startDate);
    }
    
    if (endDate) {
      query += ` AND a.date <= $${params.length + 1}`;
      params.push(endDate);
    }
    
    query += ` ORDER BY a.date DESC, a.check_in_time DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    const { rows } = await db.query(query, params);
    
    return rows;
  }

  /**
   * Get attendance summary for a date range
   */
  async getSummary(companyId, startDate, endDate) {
    const { rows } = await db.query(
      `SELECT 
         COUNT(*) as total_records,
         COUNT(DISTINCT user_id) as unique_users,
         COUNT(CASE WHEN check_in_time IS NOT NULL AND check_out_time IS NOT NULL THEN 1 END) as complete,
         COUNT(CASE WHEN check_in_time IS NOT NULL AND check_out_time IS NULL THEN 1 END) as still_active
       FROM attendance
       WHERE company_id = $1 AND date >= $2 AND date <= $3`,
      [companyId, startDate, endDate]
    );
    
    return rows[0];
  }

  /**
   * Calculate work hours
   */
  calculateHours(checkIn, checkOut) {
    if (!checkIn || !checkOut) return 0;
    
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diffMs = end - start;
    
    return Math.round(diffMs / (1000 * 60 * 60) * 10) / 10;
  }

  /**
   * Get user attendance stats
   */
  async getUserStats(userId, companyId, month, year) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
    
    const { rows } = await db.query(
      `SELECT 
         COUNT(*) as total_days,
         SUM(CASE WHEN check_in_time IS NOT NULL THEN 1 ELSE 0 END) as days_present,
         SUM(CASE WHEN check_in_time IS NOT NULL AND check_out_time IS NOT NULL 
           THEN EXTRACT(EPOCH FROM (check_out_time - check_in_time))/3600 
           ELSE 0 END) as total_hours
       FROM attendance
       WHERE user_id = $1 AND company_id = $2 AND date >= $3 AND date <= $4`,
      [userId, companyId, startDate, endDate]
    );
    
    return rows[0];
  }
}

module.exports = new AttendanceService();