const db = require('../db');

class AuditLogger {
  constructor() {
    this.enabled = process.env.AUDIT_LOGGING_ENABLED !== 'false';
  }

  async log({
    actorId,
    actorIp,
    actorUserAgent,
    action,
    resourceType,
    resourceId,
    oldValues,
    newValues,
    companyId,
    status = 'success',
    errorMessage
  }) {
    if (!this.enabled) {
      console.log('[Audit]', action, resourceType, resourceId);
      return;
    }

    try {
      const changes = this.calculateChanges(oldValues, newValues);
      
      await db.query(
        `INSERT INTO "AuditLog" 
          (actor_id, actor_ip, actor_user_agent, action, resource_type, resource_id, 
           old_values, new_values, changes, company_id, status, error_message)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          actorId,
          actorIp,
          actorUserAgent,
          action,
          resourceType,
          resourceId,
          oldValues ? JSON.stringify(oldValues) : null,
          newValues ? JSON.stringify(newValues) : null,
          changes ? JSON.stringify(changes) : null,
          companyId,
          status,
          errorMessage
        ]
      );
    } catch (error) {
      console.error('[AuditLogger] Failed to write audit log:', error.message);
    }
  }

  calculateChanges(oldValues, newValues) {
    if (!oldValues || !newValues) return null;
    
    const changes = {};
    const allKeys = new Set([...Object.keys(oldValues || {}), ...Object.keys(newValues || {})]);
    
    for (const key of allKeys) {
      if (oldValues[key] !== newValues[key]) {
        changes[key] = {
          from: oldValues[key],
          to: newValues[key]
        };
      }
    }
    
    return Object.keys(changes).length > 0 ? changes : null;
  }

  async logUserLogin({ userId, ip, userAgent, companyId, success, errorMessage }) {
    await this.log({
      actorId: userId,
      actorIp: ip,
      actorUserAgent: userAgent,
      action: success ? 'USER_LOGIN' : 'USER_LOGIN_FAILED',
      resourceType: 'user',
      resourceId: String(userId),
      companyId,
      status: success ? 'success' : 'failed',
      errorMessage
    });
  }

  async logUserAction({ userId, action, resourceType, resourceId, oldValues, newValues, companyId, ip, userAgent }) {
    await this.log({
      actorId: userId,
      actorIp: ip,
      actorUserAgent: userAgent,
      action,
      resourceType,
      resourceId,
      oldValues,
      newValues,
      companyId
    });
  }

  async logAdminAction({ adminId, action, resourceType, resourceId, oldValues, newValues, companyId, ip, userAgent }) {
    await this.log({
      actorId: adminId,
      actorIp: ip,
      actorUserAgent: userAgent,
      action: `ADMIN_${action}`,
      resourceType,
      resourceId,
      oldValues,
      newValues,
      companyId
    });
  }

  async logSettingsChange({ userId, settingKey, oldValue, newValue, companyId, ip, userAgent }) {
    await this.log({
      actorId: userId,
      actorIp: ip,
      actorUserAgent: userAgent,
      action: 'SETTINGS_CHANGE',
      resourceType: 'settings',
      resourceId: settingKey,
      oldValues: { [settingKey]: oldValue },
      newValues: { [settingKey]: newValue },
      companyId
    });
  }

  async logSubscriptionChange({ companyId, adminId, planFrom, planTo, ip, userAgent }) {
    await this.log({
      actorId: adminId,
      actorIp: ip,
      actorUserAgent: userAgent,
      action: 'SUBSCRIPTION_CHANGE',
      resourceType: 'tenant',
      resourceId: companyId,
      oldValues: { plan: planFrom },
      newValues: { plan: planTo },
      companyId
    });
  }

  async logDataExport({ userId, exportType, recordCount, companyId, ip, userAgent }) {
    await this.log({
      actorId: userId,
      actorIp: ip,
      actorUserAgent: userAgent,
      action: 'DATA_EXPORT',
      resourceType: exportType,
      resourceId: String(recordCount),
      newValues: { recordCount },
      companyId
    });
  }

  async query({ companyId, userId, resourceType, action, startDate, endDate, limit = 100 }) {
    let query = `
      SELECT al.*, u.username as actor_username, u.full_name as actor_full_name
      FROM "AuditLog" al
      LEFT JOIN "User" u ON al.actor_id = u.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;

    if (companyId) {
      query += ` AND al.company_id = $${paramIndex++}`;
      params.push(companyId);
    }
    if (userId) {
      query += ` AND al.actor_id = $${paramIndex++}`;
      params.push(userId);
    }
    if (resourceType) {
      query += ` AND al.resource_type = $${paramIndex++}`;
      params.push(resourceType);
    }
    if (action) {
      query += ` AND al.action = $${paramIndex++}`;
      params.push(action);
    }
    if (startDate) {
      query += ` AND al.timestamp >= $${paramIndex++}`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND al.timestamp <= $${paramIndex++}`;
      params.push(endDate);
    }

    query += ` ORDER BY al.timestamp DESC LIMIT $${paramIndex++}`;
    params.push(limit);

    const result = await db.query(query, params);
    return result.rows;
  }
}

const auditLogger = new AuditLogger();

module.exports = auditLogger;