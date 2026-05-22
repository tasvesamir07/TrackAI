const db = require('../db');
const timeService = require('../utils/timeService');

/**
 * Initialize database tables and run migrations
 */
const initDb = async () => {
    try {
        await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

        await db.query(`
            CREATE TABLE IF NOT EXISTS plans (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              code TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              monthly_price NUMERIC(10,2) NOT NULL CHECK (monthly_price >= 0),
              currency TEXT NOT NULL DEFAULT 'USD',
              trial_days INTEGER NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
              max_company_admins INTEGER NOT NULL CHECK (max_company_admins >= 0),
              max_project_managers INTEGER NOT NULL CHECK (max_project_managers >= 0),
              max_employees INTEGER NOT NULL CHECK (max_employees >= 0),
              stripe_price_id TEXT UNIQUE,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS tenants (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              name TEXT NOT NULL,
              slug TEXT NOT NULL UNIQUE,
              plan_id UUID NOT NULL REFERENCES plans(id),
              stripe_customer_id TEXT UNIQUE,
              stripe_subscription_id TEXT UNIQUE,
              subscription_status TEXT NOT NULL DEFAULT 'trialing'
                CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid')),
              trial_ends_at TIMESTAMPTZ,
              current_period_ends_at TIMESTAMPTZ,
              last_payment_at TIMESTAMPTZ,
              unlimited_access BOOLEAN NOT NULL DEFAULT FALSE,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'unlimited_access') THEN
                    ALTER TABLE tenants ADD COLUMN unlimited_access BOOLEAN NOT NULL DEFAULT FALSE;
                END IF;
            END $$;
        `);

        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'company_id') THEN
                    ALTER TABLE users ADD COLUMN company_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_active') THEN
                    ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'updated_at') THEN
                    ALTER TABLE users ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'nylas_grant_id') THEN
                    ALTER TABLE users ADD COLUMN nylas_grant_id TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'nylas_provider') THEN
                    ALTER TABLE users ADD COLUMN nylas_provider TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'nylas_connected_email') THEN
                    ALTER TABLE users ADD COLUMN nylas_connected_email TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'nylas_grant_status') THEN
                    ALTER TABLE users ADD COLUMN nylas_grant_status TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'nylas_connected_at') THEN
                    ALTER TABLE users ADD COLUMN nylas_connected_at TIMESTAMPTZ;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'nylas_last_error') THEN
                    ALTER TABLE users ADD COLUMN nylas_last_error TEXT;
                END IF;
                IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'deleted_at'
                ) THEN
                    ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
                END IF;
            END $$;
        `);

        await db.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tasks')
                   AND NOT EXISTS (
                       SELECT 1
                       FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'deleted_at'
                   ) THEN
                    ALTER TABLE tasks ADD COLUMN deleted_at TIMESTAMPTZ;
                END IF;
            END $$;
        `);

        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
        `);

        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_users_company_role_active ON users(company_id, role, is_active);
        `);

        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS ux_users_company_email
            ON users(company_id, LOWER(email))
            WHERE email IS NOT NULL;
        `);

        await db.query(`
            INSERT INTO plans (
              code, name, monthly_price, currency, trial_days, max_company_admins, max_project_managers, max_employees, stripe_price_id, is_active
            ) VALUES
              ('FREE', 'Free', 19.99, 'USD', 7, 1, 1, 15, 'price_free_monthly', TRUE),
              ('BASIC', 'Basic', 44.99, 'USD', 0, 1, 2, 25, 'price_basic_monthly', TRUE),
              ('PRO', 'Pro', 79.99, 'USD', 0, 2, 5, 50, 'price_pro_monthly', TRUE),
              ('ADVANCE', 'Advance', 119.99, 'USD', 0, 3, 5, 100, 'price_advance_monthly', TRUE)
            ON CONFLICT (code) DO UPDATE SET
              name = EXCLUDED.name,
              monthly_price = EXCLUDED.monthly_price,
              currency = EXCLUDED.currency,
              trial_days = EXCLUDED.trial_days,
              max_company_admins = EXCLUDED.max_company_admins,
              max_project_managers = EXCLUDED.max_project_managers,
              max_employees = EXCLUDED.max_employees,
              stripe_price_id = EXCLUDED.stripe_price_id,
              is_active = EXCLUDED.is_active,
              updated_at = NOW();
        `);

        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'plans'
                      AND column_name = 'is_popular'
                ) THEN
                    ALTER TABLE plans ADD COLUMN is_popular BOOLEAN NOT NULL DEFAULT FALSE;
                END IF;
            END $$;
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT NOT NULL,
              value TEXT NOT NULL,
              company_id UUID REFERENCES tenants(id) ON DELETE CASCADE
            );
        `);

        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'company_id') THEN
                    ALTER TABLE settings ADD COLUMN company_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM information_schema.table_constraints
                    WHERE table_name = 'settings'
                      AND constraint_name = 'settings_pkey'
                      AND constraint_type = 'PRIMARY KEY'
                ) THEN
                    ALTER TABLE settings DROP CONSTRAINT settings_pkey;
                END IF;
            END $$;
        `);

        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS ux_settings_company_key
            ON settings(company_id, key)
            WHERE company_id IS NOT NULL;
        `);

        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS ux_settings_global_key
            ON settings(key)
            WHERE company_id IS NULL;
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS early_leaves (
              id SERIAL PRIMARY KEY,
              user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
              reason TEXT NOT NULL,
              hours_worked FLOAT NOT NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS departments (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL,
              company_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS categories (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL,
              company_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS user_categories (
              user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
              category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
              PRIMARY KEY (user_id, category_id)
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS chat_groups (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL,
              company_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
              created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'departments' AND column_name = 'company_id') THEN
                    ALTER TABLE departments ADD COLUMN company_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
                END IF;
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.table_constraints
                    WHERE table_name = 'departments'
                      AND constraint_name = 'departments_name_key'
                ) THEN
                    ALTER TABLE departments DROP CONSTRAINT departments_name_key;
                END IF;
            END $$;
        `);

        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS ux_departments_company_name
            ON departments(company_id, LOWER(name))
            WHERE company_id IS NOT NULL;
        `);

        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS ux_departments_global_name
            ON departments(LOWER(name))
            WHERE company_id IS NULL;
        `);

        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'categories' AND column_name = 'company_id') THEN
                    ALTER TABLE categories ADD COLUMN company_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
                END IF;
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.table_constraints
                    WHERE table_name = 'categories'
                      AND constraint_name = 'categories_name_key'
                ) THEN
                    ALTER TABLE categories DROP CONSTRAINT categories_name_key;
                END IF;
            END $$;
        `);

        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_company_name
            ON categories(company_id, LOWER(name))
            WHERE company_id IS NOT NULL;
        `);

        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_global_name
            ON categories(LOWER(name))
            WHERE company_id IS NULL;
        `);

        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_groups' AND column_name = 'company_id') THEN
                    ALTER TABLE chat_groups ADD COLUMN company_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
                END IF;
            END $$;
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS chat_group_members (
              group_id INTEGER REFERENCES chat_groups(id) ON DELETE CASCADE,
              user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
              joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (group_id, user_id)
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
              id SERIAL PRIMARY KEY,
              user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
              endpoint TEXT NOT NULL UNIQUE,
              subscription JSONB NOT NULL,
              user_agent TEXT,
              failure_count INTEGER NOT NULL DEFAULT 0,
              last_success_at TIMESTAMP,
              last_failure_at TIMESTAMP,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
            ON push_subscriptions(user_id);
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS password_resets (
              id SERIAL PRIMARY KEY,
              user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
              email TEXT NOT NULL,
              otp TEXT NOT NULL,
              purpose TEXT NOT NULL DEFAULT 'password_reset',
              used BOOLEAN DEFAULT FALSE,
              expires_at TIMESTAMP NOT NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Add last_heartbeat column if it doesn't exist
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_heartbeat') THEN 
                    ALTER TABLE users ADD COLUMN last_heartbeat TIMESTAMP; 
                END IF; 
            END $$;
        `);

        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='is_forwarded') THEN
                    ALTER TABLE messages ADD COLUMN is_forwarded BOOLEAN DEFAULT FALSE;
                END IF;
            END $$;
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS profile_update_requests (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                requested_changes JSONB NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                handled_at TIMESTAMP,
                admin_id INTEGER REFERENCES users(id),
                rejection_reason TEXT,
                user_notified BOOLEAN DEFAULT FALSE
            );
        `);

        // Migration for attachments column in tasks
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tasks' AND column_name='attachments') THEN 
                    ALTER TABLE tasks ADD COLUMN attachments JSONB DEFAULT '[]'; 
                END IF; 
            END $$;
        `);

        // Migration for position column in project_tasks for Kanban ordering
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_tasks' AND column_name='position') THEN 
                    ALTER TABLE project_tasks ADD COLUMN position DOUBLE PRECISION DEFAULT 0; 
                END IF; 
            END $$;
        `);

        // Migration for assignment metadata on project tasks
        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name='project_tasks' AND column_name='assigned_by'
                ) THEN
                    ALTER TABLE project_tasks
                    ADD COLUMN assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
                END IF;

                IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name='project_tasks' AND column_name='assigned_at'
                ) THEN
                    ALTER TABLE project_tasks
                    ADD COLUMN assigned_at TIMESTAMP;
                END IF;
            END $$;
        `);

        // Migration for attachments column in messages
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='attachments') THEN 
                    ALTER TABLE messages ADD COLUMN attachments JSONB DEFAULT '[]'; 
                END IF; 
            END $$;
        `);

        // Migration for status column in messages (sent, delivered, seen)
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='status') THEN 
                    ALTER TABLE messages ADD COLUMN status VARCHAR(20) DEFAULT 'sent'; 
                END IF; 
            END $$;
        `);

        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='group_id') THEN
                    ALTER TABLE messages ADD COLUMN group_id INTEGER REFERENCES chat_groups(id) ON DELETE CASCADE;
                END IF;
            END $$;
        `);

        // Also add user_notified column if it doesn't exist (for existing tables)
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profile_update_requests' AND column_name='user_notified') THEN 
                    ALTER TABLE profile_update_requests ADD COLUMN user_notified BOOLEAN DEFAULT FALSE; 
                END IF; 
            END $$;
        `);

        // Migration for deleted_at in projects table
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name='projects' AND column_name='deleted_at'
                ) THEN 
                    ALTER TABLE projects ADD COLUMN deleted_at TIMESTAMP; 
                END IF; 
            END $$;
        `);

        // Migration for last_overtime_alert in users
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_overtime_alert') THEN 
                    ALTER TABLE users ADD COLUMN last_overtime_alert TIMESTAMP; 
                END IF; 
            END $$;
        `);

        // Migration for last_goal_reached_alert in users
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_goal_reached_alert') THEN 
                    ALTER TABLE users ADD COLUMN last_goal_reached_alert TIMESTAMP; 
                END IF; 
            END $$;
        `);

        // Migration for timezone in users table
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='timezone') THEN 
                    ALTER TABLE users ADD COLUMN timezone VARCHAR(100); 
                END IF; 
            END $$;
        `);

        // Migration for full_name in users table
        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='full_name') THEN
                    ALTER TABLE users ADD COLUMN full_name TEXT;
                END IF;
            END $$;
        `);

        // Migration for location tracking in users table
        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_latitude') THEN
                    ALTER TABLE users ADD COLUMN last_latitude DOUBLE PRECISION;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_longitude') THEN
                    ALTER TABLE users ADD COLUMN last_longitude DOUBLE PRECISION;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_location_update') THEN
                    ALTER TABLE users ADD COLUMN last_location_update TIMESTAMP;
                END IF;
            END $$;
        `);

        // Migration for OTP purpose in password_resets
        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='password_resets' AND column_name='purpose') THEN
                    ALTER TABLE password_resets ADD COLUMN purpose TEXT DEFAULT 'password_reset';
                END IF;

                UPDATE password_resets
                SET purpose = 'password_reset'
                WHERE purpose IS NULL OR TRIM(purpose) = '';

                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name='password_resets' AND column_name='purpose'
                ) AND NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'password_resets_purpose_check'
                ) THEN
                    ALTER TABLE password_resets
                    ADD CONSTRAINT password_resets_purpose_check
                    CHECK (purpose IN ('password_reset', 'username_recovery'));
                END IF;
            END $$;
        `);

        // Migration for paid_leave_balance in users
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='paid_leave_balance') THEN 
                    ALTER TABLE users ADD COLUMN paid_leave_balance INTEGER DEFAULT 0; 
                END IF; 
            END $$;
        `);

        // Migration for moderator role support in users table
        await db.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.table_constraints
                    WHERE table_name = 'users'
                      AND constraint_name = 'users_role_check'
                ) THEN
                    ALTER TABLE users DROP CONSTRAINT users_role_check;
                END IF;

                ALTER TABLE users
                    ADD CONSTRAINT users_role_check
                    CHECK (role IN (
                        'admin',
                        'moderator',
                        'employee',
                        'SUPERADMIN',
                        'COMPANY_ADMIN',
                        'PROJECT_MANAGER',
                        'EMPLOYEE'
                    ));
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END $$;
        `);

        // Migration for covered_date in activity_logs
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='covered_date') THEN 
                    ALTER TABLE activity_logs ADD COLUMN covered_date DATE; 
                END IF; 
            END $$;
        `);

        // Migration for covered_date in tasks
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tasks' AND column_name='covered_date') THEN 
                    ALTER TABLE tasks ADD COLUMN covered_date DATE; 
                END IF; 
            END $$;
        `);

        // Migration for is_paid in leaves
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaves' AND column_name='is_paid') THEN 
                    ALTER TABLE leaves ADD COLUMN is_paid BOOLEAN DEFAULT FALSE; 
                END IF; 
            END $$;
        `);

        // Migration for request_id in leaves
        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaves' AND column_name='request_id') THEN
                    ALTER TABLE leaves ADD COLUMN request_id TEXT;
                    UPDATE leaves
                    SET request_id = CONCAT('legacy-', id::text)
                    WHERE request_id IS NULL;
                    ALTER TABLE leaves ALTER COLUMN request_id SET NOT NULL;
                END IF;
            END $$;
        `);

        // Migration for leave_type in leaves
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaves' AND column_name='leave_type') THEN 
                    ALTER TABLE leaves ADD COLUMN leave_type TEXT DEFAULT 'unpaid';
                    UPDATE leaves
                    SET leave_type = CASE WHEN is_paid IS TRUE THEN 'paid' ELSE 'unpaid' END
                    WHERE leave_type IS NULL;
                    ALTER TABLE leaves ALTER COLUMN leave_type SET NOT NULL;
                END IF; 
            END $$;
        `);

        await db.query(`
            DO $$ 
            BEGIN 
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name='leaves' AND column_name='leave_type'
                ) AND NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'leaves_leave_type_check'
                ) THEN
                    ALTER TABLE leaves
                    ADD CONSTRAINT leaves_leave_type_check CHECK (leave_type IN ('paid', 'unpaid'));
                END IF;
            END $$;
        `);

        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaves' AND column_name='handled_by') THEN
                    ALTER TABLE leaves ADD COLUMN handled_by INTEGER REFERENCES users(id);
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaves' AND column_name='handled_at') THEN
                    ALTER TABLE leaves ADD COLUMN handled_at TIMESTAMP;
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaves' AND column_name='handled_by_name') THEN
                    ALTER TABLE leaves ADD COLUMN handled_by_name TEXT;
                END IF;
            END $$;
        `);

        // Initialize overtime_settings if it doesn't exist
        await db.query(`
            INSERT INTO settings (key, value, company_id) 
            VALUES ('overtime_settings', '{"enabled": false, "threshold": 6}', NULL) 
            ON CONFLICT (key) WHERE company_id IS NULL DO NOTHING;
        `);

        // Initialize task_comments table
        // DROP TABLE to ensure correct foreign key reference during development fix
        await db.query('DROP TABLE IF EXISTS task_comments');

        await db.query(`
            CREATE TABLE IF NOT EXISTS task_comments (
                id SERIAL PRIMARY KEY,
                task_id INTEGER REFERENCES project_tasks(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                content TEXT,
                attachments JSONB DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Initialize dev_tools_settings if it doesn't exist
        await db.query(`
            INSERT INTO settings (key, value, company_id) 
            VALUES ('dev_tools_settings', '{"enabled": true}', NULL) 
            ON CONFLICT (key) WHERE company_id IS NULL DO NOTHING;
        `);

        // Initialize admin_notification_settings if it doesn't exist
        await db.query(`
            INSERT INTO settings (key, value, company_id)
            VALUES ('admin_notification_settings', '{"enabled": false, "emailEnabled": false, "whatsappNumbers": [], "telegramChatIds": [], "telegramChatIdLabels": {}, "recipientEmails": [], "emailDomainMode": "all", "allowedEmailDomains": [], "scheduleTime": "18:00", "smtpHost": "", "smtpPort": "587", "smtpUser": "", "smtpPass": ""}', NULL)
            ON CONFLICT (key) WHERE company_id IS NULL DO NOTHING;
        `);

        // Initialize landing_hero_video_url if it doesn't exist
        await db.query(`
            INSERT INTO settings (key, value, company_id)
            VALUES ('landing_hero_video_url', '', NULL)
            ON CONFLICT (key) WHERE company_id IS NULL DO NOTHING;
        `);

        // Initialize landing_hero_video_enabled if it doesn't exist
        await db.query(`
            INSERT INTO settings (key, value, company_id)
            VALUES ('landing_hero_video_enabled', 'true', NULL)
            ON CONFLICT (key) WHERE company_id IS NULL DO NOTHING;
        `);

        // Initialize task_assignees table
        await db.query(`
            CREATE TABLE IF NOT EXISTS task_assignees (
                task_id INTEGER REFERENCES project_tasks(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                PRIMARY KEY (task_id, user_id)
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS task_assignment_alerts (
                task_id INTEGER REFERENCES project_tasks(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                dismissed_at TIMESTAMP,
                PRIMARY KEY (task_id, user_id)
            );
        `);

        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name='task_assignment_alerts'
                      AND column_name='assigned_by'
                ) THEN
                    ALTER TABLE task_assignment_alerts
                    ADD COLUMN assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
                END IF;
            END $$;
        `);

        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_task_assignment_alerts_user_id
            ON task_assignment_alerts(user_id);
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS task_activity_logs (
                id SERIAL PRIMARY KEY,
                task_id INTEGER REFERENCES project_tasks(id) ON DELETE SET NULL,
                project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                action_type TEXT NOT NULL,
                details JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await db.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_activity_logs_action_type_check') THEN
                    ALTER TABLE task_activity_logs DROP CONSTRAINT task_activity_logs_action_type_check;
                END IF;
                ALTER TABLE task_activity_logs ADD CONSTRAINT task_activity_logs_action_type_check 
                CHECK (action_type IN ('task_created', 'assignees_updated', 'task_deleted', 'status_updated', 'task_modified'));
            END $$;
        `);

        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_task_activity_logs_task_id
            ON task_activity_logs(task_id, created_at DESC);
        `);


        // Initialize task_assignees table
        await db.query(`
            CREATE TABLE IF NOT EXISTS task_assignees (
                task_id INTEGER REFERENCES project_tasks(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                PRIMARY KEY (task_id, user_id)
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS task_assignment_alerts (
                task_id INTEGER REFERENCES project_tasks(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                dismissed_at TIMESTAMP,
                PRIMARY KEY (task_id, user_id)
            );
        `);

        await db.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name='task_assignment_alerts'
                      AND column_name='assigned_by'
                ) THEN
                    ALTER TABLE task_assignment_alerts
                    ADD COLUMN assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
                END IF;
            END $$;
        `);

        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_task_assignment_alerts_user_id
            ON task_assignment_alerts(user_id);
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS task_activity_logs (
                id SERIAL PRIMARY KEY,
                task_id INTEGER REFERENCES project_tasks(id) ON DELETE SET NULL,
                project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                action_type TEXT NOT NULL,
                details JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await db.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_activity_logs_action_type_check') THEN
                    ALTER TABLE task_activity_logs DROP CONSTRAINT task_activity_logs_action_type_check;
                END IF;
                ALTER TABLE task_activity_logs ADD CONSTRAINT task_activity_logs_action_type_check 
                CHECK (action_type IN ('task_created', 'assignees_updated', 'task_deleted', 'status_updated', 'task_modified'));
            END $$;
        `);

        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_task_activity_logs_task_id
            ON task_activity_logs(task_id, created_at DESC);
        `);

        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_task_activity_logs_project_id
            ON task_activity_logs(project_id, created_at DESC);
        `);

        // Initialize telegram_live_locations table
        await db.query(`
            CREATE TABLE IF NOT EXISTS telegram_live_locations (
                employee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                admin_chat_id TEXT NOT NULL,
                admin_message_id INTEGER NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                PRIMARY KEY (employee_id, admin_chat_id)
            );
        `);

        // Seed departments from users table if departments table is empty
        const deptCheck = await db.query('SELECT COUNT(*) FROM departments');
        if (parseInt(deptCheck.rows[0].count) === 0) {
            await db.query(`
                INSERT INTO departments (name, company_id)
                SELECT DISTINCT department, company_id
                FROM users 
                WHERE department IS NOT NULL AND department != ''
                ON CONFLICT DO NOTHING
            `);
            console.log('Seeded departments from existing user data');
        }

        // Migration for moderator columns in leaves
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaves' AND column_name='moderator_status') THEN 
                    ALTER TABLE leaves ADD COLUMN moderator_status TEXT DEFAULT 'pending';
                END IF; 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaves' AND column_name='moderated_by') THEN 
                    ALTER TABLE leaves ADD COLUMN moderated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
                END IF; 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaves' AND column_name='moderated_at') THEN 
                    ALTER TABLE leaves ADD COLUMN moderated_at TIMESTAMP;
                END IF; 
            END $$;
        `);

        // Permission System Tables
        await db.query(`
            CREATE TABLE IF NOT EXISTS permission_modules (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE,
                display_name VARCHAR(255) NOT NULL,
                description TEXT,
                icon VARCHAR(50),
                sort_order INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS permission_actions (
                id SERIAL PRIMARY KEY,
                module_id INTEGER NOT NULL REFERENCES permission_modules(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                display_name VARCHAR(255) NOT NULL,
                description TEXT,
                sort_order INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(module_id, name)
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS role_permissions_global (
                id SERIAL PRIMARY KEY,
                module_id INTEGER NOT NULL REFERENCES permission_modules(id) ON DELETE CASCADE,
                action_id INTEGER NOT NULL REFERENCES permission_actions(id) ON DELETE CASCADE,
                role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'moderator', 'employee')),
                is_enabled BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(module_id, action_id, role)
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS role_permissions_company (
                id SERIAL PRIMARY KEY,
                module_id INTEGER NOT NULL REFERENCES permission_modules(id) ON DELETE CASCADE,
                action_id INTEGER NOT NULL REFERENCES permission_actions(id) ON DELETE CASCADE,
                role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'moderator', 'employee')),
                company_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
                is_enabled BOOLEAN,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(module_id, action_id, role, company_id)
            );
        `);

        // Create indexes for faster lookups
        await db.query(`CREATE INDEX IF NOT EXISTS idx_permission_actions_module ON permission_actions(module_id);`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_role_permissions_global_role ON role_permissions_global(role);`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_role_permissions_company_lookup ON role_permissions_company(role, company_id);`);

        console.log('Database tables initialized');
    } catch (err) {
        console.error('Error initializing database tables:', err);
    }
};

module.exports = { initDb };
