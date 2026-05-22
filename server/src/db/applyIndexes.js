
const db = require('../db');

const applyIndexes = async () => {
    console.log('Applying performance indexes...');
    try {
        await db.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

        // Users
        await db.query('CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));');
        await db.query('CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));');
        await db.query('CREATE INDEX IF NOT EXISTS idx_users_department ON users (department);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_users_department_trgm ON users USING gin (department gin_trgm_ops);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_users_email_trgm ON users USING gin (email gin_trgm_ops);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_users_full_name_trgm ON users USING gin (full_name gin_trgm_ops);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_users_employee_name_trgm ON users USING gin (username gin_trgm_ops);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_users_name_email_department_compound ON users (LOWER(username), LOWER(email), department);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_users_company_role_status ON users (company_id, role, status);');

        // Leaves
        await db.query('CREATE INDEX IF NOT EXISTS idx_leaves_request_id ON leaves (request_id);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_leaves_user_id ON leaves (user_id);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_leaves_status ON leaves (status);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_leaves_moderator_status ON leaves (moderator_status);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_leaves_leave_date ON leaves (leave_date DESC);');

        // Project Tasks
        await db.query('CREATE INDEX IF NOT EXISTS idx_project_tasks_project_id ON project_tasks (project_id);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON project_tasks (status);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_project_tasks_priority ON project_tasks (priority);');
        await db.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'project_tasks' AND column_name = 'assigned_to'
                ) THEN
                    CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee_project_status
                    ON project_tasks (assigned_to, project_id, status);
                ELSIF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'project_tasks' AND column_name = 'assigned_by'
                ) THEN
                    CREATE INDEX IF NOT EXISTS idx_project_tasks_assigned_by_project_status
                    ON project_tasks (assigned_by, project_id, status);
                END IF;
            END $$;
        `);

        // Activity Logs
        await db.query('CREATE INDEX IF NOT EXISTS idx_activity_logs_user_timestamp ON activity_logs (user_id, timestamp DESC);');
        await db.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'activity_logs' AND column_name = 'company_id'
                ) THEN
                    CREATE INDEX IF NOT EXISTS idx_activity_logs_user_company_created ON activity_logs (user_id, company_id, created_at DESC);
                END IF;
            END $$;
        `);
        
        // Messages
        await db.query('CREATE INDEX IF NOT EXISTS idx_messages_dm_lookup_v2 ON messages (user_id, recipient_id, created_at DESC);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_messages_group_lookup ON messages (group_id, created_at DESC);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_messages_group_cursor ON messages (group_id, created_at DESC, id DESC);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_messages_dm_pair_cursor ON messages (user_id, recipient_id, created_at DESC, id DESC);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_messages_team_cursor ON messages (created_at DESC, id DESC) WHERE recipient_id IS NULL AND group_id IS NULL;');

        // Tenancy
        await db.query('CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug);');

        // Additional performance indexes
        await db.query('CREATE INDEX IF NOT EXISTS idx_users_role_status ON users (role, status);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_users_department_status ON users (department, status) WHERE department IS NOT NULL;');
        
        // Activity logs - covered date queries
        await db.query('CREATE INDEX IF NOT EXISTS idx_activity_logs_covered_date ON activity_logs (covered_date DESC);');
        await db.query('CREATE INDEX IF NOT EXISTS idx_activity_logs_user_covered ON activity_logs (user_id, covered_date DESC);');
        
        // Leaves - user status date queries
        await db.query('CREATE INDEX IF NOT EXISTS idx_leaves_user_status_date ON leaves (user_id, status, leave_date DESC);');
        
        // Messages - read status
        await db.query('CREATE INDEX IF NOT EXISTS idx_messages_user_read ON messages (user_id, status) WHERE status = \'read\';');
        
        // Tasks - covered date queries
        await db.query('CREATE INDEX IF NOT EXISTS idx_tasks_covered_date ON tasks (covered_date DESC);');
        
        // Departments
        await db.query('CREATE INDEX IF NOT EXISTS idx_departments_company ON departments (company_id);');
        
        // Categories
        await db.query('CREATE INDEX IF NOT EXISTS idx_categories_company ON categories (company_id);');

        console.log('Performance indexes applied successfully.');
    } catch (err) {
        console.error('Error applying indexes:', err);
    }
};

if (require.main === module) {
    applyIndexes().then(() => process.exit(0));
}

module.exports = applyIndexes;
