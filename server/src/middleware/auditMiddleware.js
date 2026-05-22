/**
 * Audit Logging Middleware
 * Tracks all admin actions per tenant for compliance
 * @module auditMiddleware
 * @description Logs all CRUD operations to audit_logs table for compliance and security monitoring
 */

const db = require('../db');

/**
 * Log an audit event to the database
 * @async
 * @function auditLog
 * @param {Object} req - Express request object
 * @param {string} action - Action performed (create, update, delete, login, logout)
 * @param {string} resourceType - Type of resource (user, project, task, etc.)
 * @param {string} [resourceId] - UUID of the resource
 * @param {Object} [details={}] - Additional details about the action
 * @returns {Promise<void>}
 * @example
 * await auditLog(req, 'create', 'user', userId, { email: 'new@example.com' });
 */
const auditLog = async (req, action, resourceType, resourceId = null, details = {}) => {
  try {
    await db.query(
      `INSERT INTO audit_logs (company_id, user_id, action, resource_type, resource_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.companyId || req.user?.company_id,
        req.user?.id,
        action,
        resourceType,
        resourceId,
        JSON.stringify(details),
        req.ip || req.connection?.remoteAddress,
        req.get('user-agent')
      ]
    );
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
};

const SENSITIVE_FIELDS = ['password', 'token', 'secret', 'authorization', 'credit_card', 'ssn', 'api_key', 'apiKey', 'access_token', 'refresh_token'];

const sanitizeRequestBody = (body) => {
  if (!body || typeof body !== 'object') return body;
  const sanitized = { ...body };
  for (const field of SENSITIVE_FIELDS) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }
  return sanitized;
};

const auditMiddleware = (action, resourceType) => {
  return (req, res, next) => {
    const originalSend = res.send;
    const startTime = Date.now();
    
    res.send = function(body) {
      const responseTime = Date.now() - startTime;
      
      if (res.statusCode >= 200 && res.statusCode < 300) {
        let parsedBody = body;
        try {
          parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
        } catch (e) {}
        
        auditLog(
          req,
          action,
          resourceType,
          req.params?.id || parsedBody?.id,
          {
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
            responseTime: `${responseTime}ms`,
            requestBody: ['POST', 'PUT', 'PATCH'].includes(req.method) ? sanitizeRequestBody(req.body) : undefined
          }
        ).catch(console.error);
      }
      
      return originalSend.call(this, body);
    };
    
    next();
  };
};

const auditAction = (action, resourceType, resourceId) => {
  return async (req) => {
    await auditLog(req, action, resourceType, resourceId, { manual: true });
  };
};

const getAuditLogs = async (companyId, options = {}) => {
  const { userId, action, resourceType, startDate, endDate, page = 1, limit = 50 } = options;
  const offset = (page - 1) * limit;
  
  let query = 'SELECT * FROM audit_logs WHERE company_id = $1';
  const params = [companyId];
  
  if (userId) {
    query += ` AND user_id = $${params.length + 1}`;
    params.push(userId);
  }
  
  if (action) {
    query += ` AND action = $${params.length + 1}`;
    params.push(action);
  }
  
  if (resourceType) {
    query += ` AND resource_type = $${params.length + 1}`;
    params.push(resourceType);
  }
  
  if (startDate) {
    query += ` AND created_at >= $${params.length + 1}`;
    params.push(startDate);
  }
  
  if (endDate) {
    query += ` AND created_at <= $${params.length + 1}`;
    params.push(endDate);
  }
  
  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);
  
  const { rows } = await db.query(query, params);
  
  return rows;
};

module.exports = {
  auditLog,
  auditMiddleware,
  auditAction,
  getAuditLogs
};