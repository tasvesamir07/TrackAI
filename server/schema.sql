-- Track AI Full Database Schema (PostgreSQL)
-- Generated for fresh deployment/hosting
-- Safe to run multiple times where practical.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================
-- SaaS Core
-- =====================================

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

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    plan_id UUID NOT NULL REFERENCES plans(id),
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    subscription_status TEXT NOT NULL DEFAULT 'trialing' CHECK (
        subscription_status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid')
    ),
    trial_ends_at TIMESTAMPTZ,
    current_period_ends_at TIMESTAMPTZ,
    last_payment_at TIMESTAMPTZ,
    unlimited_access BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS unlimited_access BOOLEAN NOT NULL DEFAULT FALSE;

-- =====================================
-- Users / Identity
-- =====================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    full_name TEXT,
    username TEXT NOT NULL,
    email TEXT,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'employee',
    status TEXT NOT NULL DEFAULT 'inactive',
    department TEXT,
    contact_number TEXT,
    bank_details TEXT,
    minutes_balance INTEGER NOT NULL DEFAULT 0,
    paid_leave_balance INTEGER NOT NULL DEFAULT 0,
    profile_picture TEXT,
    telegram_chat_id TEXT,
    tg_link_token TEXT,
    tg_link_expiry TIMESTAMP,
    company_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_heartbeat TIMESTAMP,
    last_overtime_alert TIMESTAMP,
    last_goal_reached_alert TIMESTAMP,
    timezone VARCHAR(100),
    last_latitude DOUBLE PRECISION,
    last_longitude DOUBLE PRECISION,
    last_location_update TIMESTAMP,
    CONSTRAINT users_role_check CHECK (
        role IN (
            'admin',
            'moderator',
            'employee',
            'SUPERADMIN',
            'COMPANY_ADMIN',
            'PROJECT_MANAGER',
            'EMPLOYEE'
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username_ci
    ON users (LOWER(username));

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_contact_number
    ON users (contact_number)
    WHERE contact_number IS NOT NULL AND BTRIM(contact_number) <> '';

CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_company_role_active ON users(company_id, role, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_company_email
    ON users(company_id, LOWER(email))
    WHERE email IS NOT NULL;

-- =====================================
-- Settings / Configuration
-- =====================================

CREATE TABLE IF NOT EXISTS settings (
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    company_id UUID REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_settings_company_key
    ON settings(company_id, key)
    WHERE company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_settings_global_key
    ON settings(key)
    WHERE company_id IS NULL;

-- =====================================
-- Attendance / Daily Work
-- =====================================

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    todays_task TEXT,
    attachments JSONB DEFAULT '[]'::jsonb,
    covered_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, date DESC);

CREATE TABLE IF NOT EXISTS activity_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    covered_date DATE,
    balance_change INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_timestamp ON activity_logs(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_covered_date ON activity_logs(user_id, covered_date);
CREATE INDEX IF NOT EXISTS idx_activity_logs_type ON activity_logs(activity_type);

CREATE TABLE IF NOT EXISTS early_leaves (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    hours_worked FLOAT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_early_leaves_user_created ON early_leaves(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scheduled_actions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMP NOT NULL,
    task_content TEXT,
    content TEXT,
    attachments JSONB DEFAULT '[]'::jsonb,
    action_type TEXT DEFAULT 'task_submission',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'failed', 'cancelled', 'skipped')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scheduled_actions_user_status_time
    ON scheduled_actions(user_id, status, scheduled_at);

-- =====================================
-- Leaves
-- =====================================

CREATE TABLE IF NOT EXISTS leaves (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_date DATE NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'working', 'covered')),
    covered_by_date DATE,
    is_paid BOOLEAN DEFAULT FALSE,
    request_id TEXT NOT NULL,
    leave_type TEXT NOT NULL DEFAULT 'unpaid' CHECK (leave_type IN ('paid', 'unpaid')),
    handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    handled_at TIMESTAMP,
    handled_by_name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, leave_date)
);

CREATE INDEX IF NOT EXISTS idx_leaves_user_date ON leaves(user_id, leave_date DESC);
CREATE INDEX IF NOT EXISTS idx_leaves_request_id ON leaves(request_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status ON leaves(status);

-- =====================================
-- Organization / Categorization
-- =====================================

CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    company_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_departments_company_name
    ON departments(company_id, LOWER(name))
    WHERE company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_departments_global_name
    ON departments(LOWER(name))
    WHERE company_id IS NULL;

CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    company_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_company_name
    ON categories(company_id, LOWER(name))
    WHERE company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_global_name
    ON categories(LOWER(name))
    WHERE company_id IS NULL;

CREATE TABLE IF NOT EXISTS user_categories (
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, category_id)
);

-- =====================================
-- Projects
-- =====================================

CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);

CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'member')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);

CREATE TABLE IF NOT EXISTS project_tasks (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'medium',
    due_date TIMESTAMP,
    position DOUBLE PRECISION DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMP,
    attachments JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_tasks_project_id ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project_position ON project_tasks(project_id, position ASC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_tasks_assigned_by ON project_tasks(assigned_by);

CREATE TABLE IF NOT EXISTS task_assignees (
    task_id INTEGER REFERENCES project_tasks(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_assignment_alerts (
    task_id INTEGER REFERENCES project_tasks(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    dismissed_at TIMESTAMP,
    PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignment_alerts_user_id
    ON task_assignment_alerts(user_id);

CREATE TABLE IF NOT EXISTS task_comments (
    id SERIAL PRIMARY KEY,
    task_id INTEGER REFERENCES project_tasks(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    content TEXT,
    attachments JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task_created ON task_comments(task_id, created_at ASC);

CREATE TABLE IF NOT EXISTS task_activity_logs (
    id SERIAL PRIMARY KEY,
    task_id INTEGER REFERENCES project_tasks(id) ON DELETE SET NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT task_activity_logs_action_type_check CHECK (
        action_type IN ('task_created', 'assignees_updated', 'task_deleted', 'status_updated', 'task_modified')
    )
);

CREATE INDEX IF NOT EXISTS idx_task_activity_logs_task_id
    ON task_activity_logs(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_activity_logs_project_id
    ON task_activity_logs(project_id, created_at DESC);

-- =====================================
-- Chat
-- =====================================

CREATE TABLE IF NOT EXISTS chat_groups (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    company_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_groups_company ON chat_groups(company_id);

CREATE TABLE IF NOT EXISTS chat_group_members (
    group_id INTEGER REFERENCES chat_groups(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_group_members_user ON chat_group_members(user_id);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES chat_groups(id) ON DELETE CASCADE,
    content TEXT,
    attachment_url TEXT,
    attachment_type TEXT,
    attachments JSONB DEFAULT '[]'::jsonb,
    reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    deleted_for INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[],
    reactions JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_edited BOOLEAN NOT NULL DEFAULT FALSE,
    is_forwarded BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'sent',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_group_id ON messages(group_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_dm_lookup ON messages(user_id, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_group_cursor ON messages(group_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_dm_pair_cursor ON messages(user_id, recipient_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_team_cursor ON messages(created_at DESC, id DESC) WHERE recipient_id IS NULL AND group_id IS NULL;

-- =====================================
-- Notifications / Security
-- =====================================

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

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
    ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    otp TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'password_reset' CHECK (purpose IN ('password_reset', 'username_recovery')),
    used BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user_purpose_used
    ON password_resets(user_id, purpose, used);

CREATE TABLE IF NOT EXISTS profile_update_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    requested_changes JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    handled_at TIMESTAMP,
    admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    rejection_reason TEXT,
    user_notified BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_profile_update_requests_user_status
    ON profile_update_requests(user_id, status, created_at DESC);

-- =====================================
-- Reporting
-- =====================================

CREATE TABLE IF NOT EXISTS daily_summaries (
    date DATE PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================
-- Seed Data
-- =====================================

INSERT INTO plans (
    code,
    name,
    monthly_price,
    currency,
    trial_days,
    max_company_admins,
    max_project_managers,
    max_employees,
    stripe_price_id,
    is_active
)
VALUES
    ('FREE', 'Free', 19.99, 'USD', 30, 1, 1, 15, 'price_free_monthly', TRUE),
    ('BASIC', 'Basic', 44.99, 'USD', 0, 1, 2, 25, 'price_basic_monthly', TRUE),
    ('PRO', 'Pro', 79.99, 'USD', 0, 2, 5, 50, 'price_pro_monthly', TRUE),
    ('ADVANCE', 'Advance', 119.99, 'USD', 0, 3, 5, 100, 'price_advance_monthly', TRUE)
ON CONFLICT (code)
DO UPDATE SET
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

INSERT INTO settings (key, value, company_id)
VALUES ('overtime_settings', '{"enabled": false, "threshold": 6}', NULL)
ON CONFLICT (key) WHERE company_id IS NULL DO NOTHING;

INSERT INTO settings (key, value, company_id)
VALUES ('dev_tools_settings', '{"enabled": true}', NULL)
ON CONFLICT (key) WHERE company_id IS NULL DO NOTHING;

INSERT INTO settings (key, value, company_id)
VALUES ('admin_notification_settings', '{"enabled": false, "emailEnabled": false, "whatsappNumbers": [], "telegramChatIds": [], "telegramChatIdLabels": {}, "recipientEmails": [], "emailDomainMode": "all", "allowedEmailDomains": [], "scheduleTime": "18:00", "smtpHost": "", "smtpPort": "587", "smtpUser": "", "smtpPass": ""}', NULL)
ON CONFLICT (key) WHERE company_id IS NULL DO NOTHING;

-- Superadmin is created via the /api/dev/setup-admin endpoint on first run.
-- Make sure to set SETUP_KEY in your environment variables before calling it.
