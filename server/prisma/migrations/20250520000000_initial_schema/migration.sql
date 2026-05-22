-- CreateTrackAIInitialMigration
-- This migration represents the initial schema from schema.sql

BEGIN;

-- Plans (SaaS)
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "monthly_price" NUMERIC(10,2) NOT NULL CHECK (monthly_price >= 0),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "trial_days" INTEGER NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
    "max_company_admins" INTEGER NOT NULL DEFAULT 0 CHECK (max_company_admins >= 0),
    "max_project_managers" INTEGER NOT NULL DEFAULT 0 CHECK (max_project_managers >= 0),
    "max_employees" INTEGER NOT NULL DEFAULT 0 CHECK (max_employees >= 0),
    "stripe_price_id" TEXT UNIQUE,
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenants (Companies)
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL UNIQUE,
    "plan_id" TEXT NOT NULL REFERENCES "Plan"("id"),
    "stripe_customer_id" TEXT UNIQUE,
    "stripe_subscription_id" TEXT UNIQUE,
    "subscription_status" TEXT NOT NULL DEFAULT 'trialing',
    "trial_ends_at" TIMESTAMPTZ,
    "current_period_ends_at" TIMESTAMPTZ,
    "last_payment_at" TIMESTAMPTZ,
    "unlimited_access" BOOLEAN NOT NULL DEFAULT FALSE,
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE "User" (
    "id" SERIAL PRIMARY KEY,
    "full_name" TEXT,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'employee',
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "department" TEXT,
    "contact_number" TEXT,
    "bank_details" TEXT,
    "minutes_balance" INTEGER NOT NULL DEFAULT 0,
    "paid_leave_balance" INTEGER NOT NULL DEFAULT 0,
    "profile_picture" TEXT,
    "telegram_chat_id" TEXT,
    "tg_link_token" TEXT,
    "tg_link_expiry" TIMESTAMP,
    "company_id" TEXT REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "last_heartbeat" TIMESTAMP,
    "last_overtime_alert" TIMESTAMP,
    "last_goal_reached_alert" TIMESTAMP,
    "timezone" VARCHAR(100),
    "last_latitude" DOUBLE PRECISION,
    "last_longitude" DOUBLE PRECISION,
    "last_location_update" TIMESTAMP
);

-- Settings
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "company_id" TEXT REFERENCES "Tenant"("id") ON DELETE CASCADE
);

-- Tasks
CREATE TABLE "Task" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "date" DATE NOT NULL,
    "todays_task" TEXT,
    "attachments" JSONB DEFAULT '[]',
    "covered_date" DATE,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE ("user_id", "date")
);

-- Activity Logs
CREATE TABLE "ActivityLog" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "activity_type" TEXT NOT NULL,
    "timestamp" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "covered_date" DATE,
    "balance_change" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Early Leaves
CREATE TABLE "EarlyLeave" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER REFERENCES "User"("id") ON DELETE CASCADE,
    "reason" TEXT NOT NULL,
    "hours_worked" FLOAT NOT NULL,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Scheduled Actions
CREATE TABLE "ScheduledAction" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "scheduled_at" TIMESTAMP NOT NULL,
    "task_content" TEXT,
    "content" TEXT,
    "attachments" JSONB DEFAULT '[]',
    "action_type" TEXT DEFAULT 'task_submission',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Leaves
CREATE TABLE "Leave" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "leave_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "covered_by_date" DATE,
    "is_paid" BOOLEAN DEFAULT FALSE,
    "request_id" TEXT NOT NULL,
    "leave_type" TEXT NOT NULL DEFAULT 'unpaid',
    "handled_by" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
    "handled_at" TIMESTAMP,
    "handled_by_name" TEXT,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE ("user_id", "leave_date")
);

-- Departments
CREATE TABLE "Department" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "company_id" TEXT REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Categories
CREATE TABLE "Category" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "company_id" TEXT REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User Categories
CREATE TABLE "UserCategory" (
    "user_id" INTEGER REFERENCES "User"("id") ON DELETE CASCADE,
    "category_id" INTEGER REFERENCES "Category"("id") ON DELETE CASCADE,
    PRIMARY KEY ("user_id", "category_id")
);

-- Projects
CREATE TABLE "Project" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP
);

-- Project Members
CREATE TABLE "ProjectMember" (
    "project_id" INTEGER REFERENCES "Project"("id") ON DELETE CASCADE,
    "user_id" INTEGER REFERENCES "User"("id") ON DELETE CASCADE,
    "role" TEXT NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("project_id", "user_id")
);

-- Project Tasks
CREATE TABLE "ProjectTask" (
    "id" SERIAL PRIMARY KEY,
    "project_id" INTEGER NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "due_date" TIMESTAMP,
    "position" DOUBLE PRECISION DEFAULT 0,
    "created_by" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
    "assigned_by" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
    "assigned_at" TIMESTAMP,
    "attachments" JSONB DEFAULT '[]',
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Task Assignees
CREATE TABLE "TaskAssignee" (
    "task_id" INTEGER REFERENCES "ProjectTask"("id") ON DELETE CASCADE,
    "user_id" INTEGER REFERENCES "User"("id") ON DELETE CASCADE,
    PRIMARY KEY ("task_id", "user_id")
);

-- Task Assignment Alerts
CREATE TABLE "TaskAssignmentAlert" (
    "task_id" INTEGER REFERENCES "ProjectTask"("id") ON DELETE CASCADE,
    "user_id" INTEGER REFERENCES "User"("id") ON DELETE CASCADE,
    "assigned_by" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "dismissed_at" TIMESTAMP,
    PRIMARY KEY ("task_id", "user_id")
);

-- Task Comments
CREATE TABLE "TaskComment" (
    "id" SERIAL PRIMARY KEY,
    "task_id" INTEGER REFERENCES "ProjectTask"("id") ON DELETE CASCADE,
    "user_id" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
    "content" TEXT,
    "attachments" JSONB DEFAULT '[]',
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Task Activity Logs
CREATE TABLE "TaskActivityLog" (
    "id" SERIAL PRIMARY KEY,
    "task_id" INTEGER REFERENCES "ProjectTask"("id") ON DELETE SET NULL,
    "project_id" INTEGER REFERENCES "Project"("id") ON DELETE SET NULL,
    "actor_user_id" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
    "action_type" TEXT NOT NULL,
    "details" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chat Groups
CREATE TABLE "ChatGroup" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "company_id" TEXT REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "created_by" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chat Group Members
CREATE TABLE "ChatGroupMember" (
    "group_id" INTEGER REFERENCES "ChatGroup"("id") ON DELETE CASCADE,
    "user_id" INTEGER REFERENCES "User"("id") ON DELETE CASCADE,
    "joined_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("group_id", "user_id")
);

-- Messages
CREATE TABLE "Message" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "recipient_id" INTEGER REFERENCES "User"("id") ON DELETE CASCADE,
    "group_id" INTEGER REFERENCES "ChatGroup"("id") ON DELETE CASCADE,
    "content" TEXT,
    "attachment_url" TEXT,
    "attachment_type" TEXT,
    "attachments" JSONB DEFAULT '[]',
    "reply_to_id" INTEGER REFERENCES "Message"("id") ON DELETE SET NULL,
    "deleted_for" INTEGER[] NOT NULL DEFAULT '{}',
    "reactions" JSONB NOT NULL DEFAULT '{}',
    "is_pinned" BOOLEAN NOT NULL DEFAULT FALSE,
    "is_edited" BOOLEAN NOT NULL DEFAULT FALSE,
    "is_forwarded" BOOLEAN NOT NULL DEFAULT FALSE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'sent',
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Push Subscriptions
CREATE TABLE "PushSubscription" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER REFERENCES "User"("id") ON DELETE CASCADE,
    "endpoint" TEXT NOT NULL UNIQUE,
    "subscription" JSONB NOT NULL,
    "user_agent" TEXT,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_success_at" TIMESTAMP,
    "last_failure_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Password Resets
CREATE TABLE "PasswordReset" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER REFERENCES "User"("id") ON DELETE CASCADE,
    "email" TEXT NOT NULL,
    "otp" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'password_reset',
    "used" BOOLEAN DEFAULT FALSE,
    "expires_at" TIMESTAMP NOT NULL,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Profile Update Requests
CREATE TABLE "ProfileUpdateRequest" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER REFERENCES "User"("id") ON DELETE CASCADE,
    "requested_changes" JSONB NOT NULL,
    "status" VARCHAR(20) DEFAULT 'pending',
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "handled_at" TIMESTAMP,
    "admin_id" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
    "rejection_reason" TEXT,
    "user_notified" BOOLEAN DEFAULT FALSE
);

-- Daily Summaries
CREATE TABLE "DailySummary" (
    "date" DATE PRIMARY KEY,
    "content" TEXT NOT NULL,
    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE UNIQUE INDEX "ux_users_username_ci" ON "User" (LOWER(username));
CREATE UNIQUE INDEX "ux_users_contact_number" ON "User" (contact_number) WHERE contact_number IS NOT NULL AND BTRIM(contact_number) <> '';
CREATE INDEX "idx_users_company_id" ON "User"(company_id);
CREATE INDEX "idx_users_company_role_active" ON "User"(company_id, role, is_active);
CREATE UNIQUE INDEX "ux_users_company_email" ON "User"(company_id, LOWER(email)) WHERE email IS NOT NULL;

CREATE UNIQUE INDEX "ux_settings_company_key" ON "Setting"(company_id, key) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX "ux_settings_global_key" ON "Setting"(key) WHERE company_id IS NULL;

CREATE INDEX "idx_tasks_user_date" ON "Task"(user_id, date DESC);
CREATE INDEX "idx_activity_logs_user_timestamp" ON "ActivityLog"(user_id, timestamp DESC);
CREATE INDEX "idx_activity_logs_user_covered_date" ON "ActivityLog"(user_id, covered_date);
CREATE INDEX "idx_activity_logs_type" ON "ActivityLog"(activity_type);
CREATE INDEX "idx_early_leaves_user_created" ON "EarlyLeave"(user_id, created_at DESC);
CREATE INDEX "idx_scheduled_actions_user_status_time" ON "ScheduledAction"(user_id, status, scheduled_at);
CREATE INDEX "idx_leaves_user_date" ON "Leave"(user_id, leave_date DESC);
CREATE INDEX "idx_leaves_request_id" ON "Leave"(request_id);
CREATE INDEX "idx_leaves_status" ON "Leave"(status);

CREATE UNIQUE INDEX "ux_departments_company_name" ON "Department"(company_id, LOWER(name)) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX "ux_departments_global_name" ON "Department"(LOWER(name)) WHERE company_id IS NULL;
CREATE UNIQUE INDEX "ux_categories_company_name" ON "Category"(company_id, LOWER(name)) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX "ux_categories_global_name" ON "Category"(LOWER(name)) WHERE company_id IS NULL;

CREATE INDEX "idx_projects_deleted_at" ON "Project"(deleted_at);
CREATE INDEX "idx_projects_created_by" ON "Project"(created_by);
CREATE INDEX "idx_project_members_user_id" ON "ProjectMember"(user_id);
CREATE INDEX "idx_project_tasks_project_id" ON "ProjectTask"(project_id);
CREATE INDEX "idx_project_tasks_project_position" ON "ProjectTask"(project_id, position ASC, created_at DESC);
CREATE INDEX "idx_project_tasks_assigned_by" ON "ProjectTask"(assigned_by);
CREATE INDEX "idx_task_assignment_alerts_user_id" ON "TaskAssignmentAlert"(user_id);
CREATE INDEX "idx_task_comments_task_created" ON "TaskComment"(task_id, created_at ASC);
CREATE INDEX "idx_task_activity_logs_task_id" ON "TaskActivityLog"(task_id, created_at DESC);
CREATE INDEX "idx_task_activity_logs_project_id" ON "TaskActivityLog"(project_id, created_at DESC);

CREATE INDEX "idx_chat_groups_company" ON "ChatGroup"(company_id);
CREATE INDEX "idx_chat_group_members_user" ON "ChatGroupMember"(user_id);
CREATE INDEX "idx_messages_user_id" ON "Message"(user_id);
CREATE INDEX "idx_messages_recipient_id" ON "Message"(recipient_id);
CREATE INDEX "idx_messages_group_id" ON "Message"(group_id);
CREATE INDEX "idx_messages_created_at" ON "Message"(created_at DESC);
CREATE INDEX "idx_messages_dm_lookup" ON "Message"(user_id, recipient_id, created_at DESC);
CREATE INDEX "idx_push_subscriptions_user_id" ON "PushSubscription"(user_id);
CREATE INDEX "idx_password_resets_user_purpose_used" ON "PasswordReset"(user_id, purpose, used);
CREATE INDEX "idx_profile_update_requests_user_status" ON "ProfileUpdateRequest"(user_id, status, created_at DESC);

COMMIT;