const db = require('../db');

class PermissionService {
  constructor() {
    this.permissions = {
      // User management
      'users:read': 'View user list and profiles',
      'users:create': 'Create new users',
      'users:update': 'Update user information',
      'users:delete': 'Delete users',
      'users:impersonate': 'Impersonate other users',
      
      // Leave management
      'leaves:read': 'View leave requests',
      'leaves:create': 'Submit leave requests',
      'leaves:approve': 'Approve/reject leave requests',
      'leaves:manage': 'Full leave management',
      
      // Time tracking
      'timelog:read': 'View time logs',
      'timelog:create': 'Clock in/out',
      'timelog:manage': 'Manage all time logs',
      
      // Projects
      'projects:read': 'View projects',
      'projects:create': 'Create projects',
      'projects:update': 'Update projects',
      'projects:delete': 'Delete projects',
      
      // Tasks
      'tasks:read': 'View tasks',
      'tasks:create': 'Create tasks',
      'tasks:update': 'Update tasks',
      'tasks:delete': 'Delete tasks',
      'tasks:assign': 'Assign tasks to others',
      
      // Reports
      'reports:read': 'View reports',
      'reports:export': 'Export reports',
      'reports:manage': 'Manage scheduled reports',
      
      // Settings
      'settings:read': 'View settings',
      'settings:update': 'Update settings',
      'settings:manage': 'Full settings management',
      
      // Billing (Admin only)
      'billing:read': 'View billing info',
      'billing:manage': 'Manage billing and subscriptions',
      
      // Audit logs (Admin only)
      'audit:read': 'View audit logs',
      
      // Kudos
      'kudos:read': 'View kudos',
      'kudos:create': 'Give kudos',
      'kudos:manage': 'Manage kudos',
      
      // Surveys
      'surveys:read': 'View surveys',
      'surveys:create': 'Create surveys',
      'surveys:respond': 'Respond to surveys',
      
      // Chat
      'chat:read': 'View messages',
      'chat:send': 'Send messages',
      'chat:manage': 'Manage chat'
    };
    
    this.rolePermissions = {
      SUPERADMIN: Object.keys(this.permissions),
      COMPANY_ADMIN: [
        'users:read', 'users:create', 'users:update',
        'leaves:read', 'leaves:approve', 'leaves:manage',
        'timelog:read', 'timelog:manage',
        'projects:read', 'projects:create', 'projects:update', 'projects:delete',
        'tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete', 'tasks:assign',
        'reports:read', 'reports:export', 'reports:manage',
        'settings:read', 'settings:update',
        'audit:read',
        'kudos:read', 'kudos:create',
        'surveys:read', 'surveys:create',
        'chat:read', 'chat:send', 'chat:manage'
      ],
      PROJECT_MANAGER: [
        'users:read',
        'leaves:read', 'leaves:approve',
        'timelog:read',
        'projects:read', 'projects:update',
        'tasks:read', 'tasks:create', 'tasks:update', 'tasks:assign',
        'reports:read',
        'chat:read', 'chat:send'
      ],
      MODERATOR: [
        'users:read',
        'leaves:read', 'leaves:approve',
        'timelog:read',
        'projects:read',
        'tasks:read', 'tasks:create', 'tasks:update',
        'reports:read',
        'chat:read', 'chat:send'
      ],
      EMPLOYEE: [
        'leaves:read', 'leaves:create',
        'timelog:read', 'timelog:create',
        'projects:read',
        'tasks:read', 'tasks:create',
        'reports:read',
        'kudos:read', 'kudos:create',
        'surveys:read', 'surveys:respond',
        'chat:read', 'chat:send'
      ]
    };
  }

  normalizeRole(role) {
    const raw = String(role || '').trim();
    const upper = raw.toUpperCase();
    if (upper === 'ADMIN' || upper === 'COMPANY_ADMIN') return 'COMPANY_ADMIN';
    if (upper === 'PROJECT_MANAGER') return 'PROJECT_MANAGER';
    if (upper === 'MODERATOR') return 'MODERATOR';
    if (upper === 'EMPLOYEE') return 'EMPLOYEE';
    if (upper === 'SUPERADMIN') return 'SUPERADMIN';
    return upper;
  }

  async checkPermission(userId, permission, resourceId = null) {
    try {
      // Get user with role
      const userResult = await db.query(
        'SELECT role, company_id FROM users WHERE id = $1',
        [userId]
      );
      
      if (userResult.rows.length === 0) {
        return false;
      }
      
      const user = userResult.rows[0];
      
      // Superadmin has all permissions
      if (user.role === 'SUPERADMIN') {
        return true;
      }
      
      // Check role-based permissions first
      const rolePerms = this.rolePermissions[user.role] || [];
      if (rolePerms.includes(permission)) {
        // If permission is not resource-specific, grant access
        if (!resourceId) {
          return true;
        }
        
        // For resource-specific permissions, check user_permission table
        const customPerm = await db.query(
          `SELECT is_granted FROM "UserPermission" 
           WHERE user_id = $1 AND permission = $2 
           AND ($3 IS NULL OR resource_id = $3)`,
          [userId, permission, resourceId]
        );
        
        if (customPerm.rows.length > 0) {
          return customPerm.rows[0].is_granted;
        }
        
        return true; // Role permission is sufficient
      }
      
      // Check custom user permissions
      const customPerm = await db.query(
        `SELECT is_granted FROM "UserPermission" 
         WHERE user_id = $1 AND permission = $2 
         AND ($3 IS NULL OR resource_id = $3)
         AND (expires_at IS NULL OR expires_at > NOW())`,
        [userId, permission, resourceId]
      );
      
      if (customPerm.rows.length > 0) {
        return customPerm.rows[0].is_granted;
      }
      
      return false;
    } catch (error) {
      console.error('[PermissionService] Error checking permission:', error.message);
      return false;
    }
  }

  async grantPermission(userId, permission, resourceId = null, expiresAt = null, grantedBy = null) {
    try {
      await db.query(
        `INSERT INTO "UserPermission" (user_id, permission, resource_id, is_granted, granted_by, expires_at)
         VALUES ($1, $2, $3, true, $4, $5)
         ON CONFLICT (user_id, permission, resource_id) 
         DO UPDATE SET is_granted = true, granted_by = $4, expires_at = $5`,
        [userId, permission, resourceId, grantedBy, expiresAt]
      );
      return true;
    } catch (error) {
      console.error('[PermissionService] Error granting permission:', error.message);
      return false;
    }
  }

  async revokePermission(userId, permission, resourceId = null) {
    try {
      await db.query(
        `UPDATE "UserPermission" 
         SET is_granted = false 
         WHERE user_id = $1 AND permission = $2 
         AND ($3 IS NULL OR resource_id = $3)`,
        [userId, permission, resourceId]
      );
      return true;
    } catch (error) {
      console.error('[PermissionService] Error revoking permission:', error.message);
      return false;
    }
  }

  async getUserPermissions(userId) {
    try {
      const userResult = await db.query(
        'SELECT role, company_id FROM users WHERE id = $1',
        [userId]
      );
      
      if (userResult.rows.length === 0) {
        return [];
      }
      
      const user = userResult.rows[0];
      const rolePerms = this.rolePermissions[user.role] || [];
      
      const customPerms = await db.query(
        `SELECT permission, resource_id, is_granted, expires_at 
         FROM "UserPermission" 
         WHERE user_id = $1 AND is_granted = true 
         AND (expires_at IS NULL OR expires_at > NOW())`,
        [userId]
      );
      
      // Combine role permissions with custom permissions
      const allPerms = [...new Set([...rolePerms, ...customPerms.rows.map(p => p.permission)])];
      
      return allPerms.map(perm => ({
        permission: perm,
        description: this.permissions[perm] || 'Custom permission',
        isRoleBased: rolePerms.includes(perm),
        resourceId: customPerms.rows.find(p => p.permission === perm)?.resource_id,
        expiresAt: customPerms.rows.find(p => p.permission === perm)?.expires_at
      }));
    } catch (error) {
      console.error('[PermissionService] Error getting permissions:', error.message);
      return [];
    }
  }

  getAllPermissions() {
    return Object.entries(this.permissions).map(([key, description]) => ({
      permission: key,
      description
    }));
  }

  getRolePermissions(role) {
    const normalizedRole = this.normalizeRole(role);
    return this.rolePermissions[normalizedRole] || [];
  }

  async getPermission(role, module, action, _companyId = null) {
    const normalizedRole = this.normalizeRole(role);
    if (normalizedRole === 'SUPERADMIN') return true;
    const permissionKey = `${module}:${action}`;
    const rolePerms = this.rolePermissions[normalizedRole] || [];
    return rolePerms.includes(permissionKey);
  }
}

const permissionService = new PermissionService();

module.exports = permissionService;
