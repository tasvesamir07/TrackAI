let UserRole = {
  SUPERADMIN: 'SUPERADMIN',
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  PROJECT_MANAGER: 'PROJECT_MANAGER',
  EMPLOYEE: 'EMPLOYEE'
};

try {
  const prismaClient = require('@prisma/client');
  if (prismaClient && prismaClient.UserRole) {
    UserRole = prismaClient.UserRole;
  }
} catch (_err) {
  // Keep role helpers available even when Prisma client generation is unavailable at boot time.
}

const RoleUtils = {
  SUPERADMIN: 'SUPERADMIN',
  COMPANY_ADMIN: 'COMPANY_ADMIN', 
  PROJECT_MANAGER: 'PROJECT_MANAGER',
  EMPLOYEE: 'EMPLOYEE',

  isAdmin(role) {
    return role === this.SUPERADMIN || role === this.COMPANY_ADMIN;
  },

  isSuperAdmin(role) {
    return role === this.SUPERADMIN;
  },

  isProjectManager(role) {
    return role === this.PROJECT_MANAGER;
  },

  isEmployee(role) {
    return role === this.EMPLOYEE;
  },

  isManager(role) {
    return role === this.COMPANY_ADMIN || role === this.PROJECT_MANAGER;
  },

  canApproveLeaves(role) {
    return role === this.SUPERADMIN || role === this.COMPANY_ADMIN || role === this.PROJECT_MANAGER;
  },

  canManageUsers(role) {
    return role === this.SUPERADMIN || role === this.COMPANY_ADMIN;
  },

  canManageBilling(role) {
    return role === this.SUPERADMIN;
  },

  canViewAuditLogs(role) {
    return role === this.SUPERADMIN || role === this.COMPANY_ADMIN;
  },

  getDisplayName(role) {
    const names = {
      SUPERADMIN: 'Super Admin',
      COMPANY_ADMIN: 'Company Admin',
      PROJECT_MANAGER: 'Project Manager',
      EMPLOYEE: 'Employee'
    };
    return names[role] || role;
  },

  getAllRoles() {
    return [this.SUPERADMIN, this.COMPANY_ADMIN, this.PROJECT_MANAGER, this.EMPLOYEE];
  }
};

const normalizeRole = (role) => {
  if (!role) return RoleUtils.EMPLOYEE;
  
  const upper = role.toUpperCase();
  
  if (upper === 'SUPERADMIN' || upper === 'SUPER_ADMIN') return RoleUtils.SUPERADMIN;
  if (upper === 'COMPANY_ADMIN' || upper === 'ADMIN') return RoleUtils.COMPANY_ADMIN;
  if (upper === 'PROJECT_MANAGER' || upper === 'MODERATOR' || upper === 'MANAGER') return RoleUtils.PROJECT_MANAGER;
  
  return RoleUtils.EMPLOYEE;
};

const hasRole = (userRole, requiredRoles) => {
  if (!userRole || !requiredRoles) return false;
  
  const normalized = normalizeRole(userRole);
  
  if (Array.isArray(requiredRoles)) {
    return requiredRoles.map(r => normalizeRole(r)).includes(normalized);
  }
  
  return normalizeRole(requiredRoles) === normalized;
};

module.exports = {
  RoleUtils,
  normalizeRole,
  hasRole,
  UserRole
};
