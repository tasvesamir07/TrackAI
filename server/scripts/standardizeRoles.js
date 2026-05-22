const db = require('../db');

const ROLE_MAPPING = {
  'superadmin': 'SUPERADMIN',
  'super_admin': 'SUPERADMIN',
  'super admin': 'SUPERADMIN',
  'admin': 'COMPANY_ADMIN',
  'company_admin': 'COMPANY_ADMIN',
  'company admin': 'COMPANY_ADMIN',
  'moderator': 'PROJECT_MANAGER',
  'project_manager': 'PROJECT_MANAGER',
  'project manager': 'PROJECT_MANAGER',
  'employee': 'EMPLOYEE',
  'EMPLOYEE': 'EMPLOYEE',
  'companyadmin': 'COMPANY_ADMIN',
};

const STANDARDIZED_ROLES = ['SUPERADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER', 'EMPLOYEE'];

async function standardizeRoles() {
  console.log('[RoleMigration] Starting role standardization...');
  
  try {
    const updatePromises = Object.entries(ROLE_MAPPING).map(([oldRole, newRole]) => {
      if (oldRole === newRole) return null;
      return db.query(
        `UPDATE users SET role = $1 WHERE LOWER(role) = $2`,
        [newRole, oldRole.toLowerCase()]
      );
    });
    
    const results = await Promise.all(updatePromises.filter(p => p));
    console.log('[RoleMigration] Role mapping updates complete');
    
    const verifyResult = await db.query(
      `SELECT role, COUNT(*) as count FROM users GROUP BY role`
    );
    
    console.log('[RoleMigration] Current role distribution:');
    verifyResult.rows.forEach(row => {
      console.log(`  ${row.role}: ${row.count}`);
    });
    
    const invalidRoles = await db.query(
      `SELECT DISTINCT role FROM users WHERE role NOT IN ($1)`,
      [STANDARDIZED_ROLES.map(r => `'${r}'`).join(',')]
    );
    
    if (invalidRoles.rows.length > 0) {
      console.warn('[RoleMigration] Warning: Found non-standardized roles:', invalidRoles.rows);
    } else {
      console.log('[RoleMigration] All roles standardized successfully!');
    }
    
    return { success: true, distribution: verifyResult.rows };
  } catch (error) {
    console.error('[RoleMigration] Error:', error.message);
    return { success: false, error: error.message };
  }
}

if (require.main === module) {
  standardizeRoles()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { standardizeRoles, STANDARDIZED_ROLES };