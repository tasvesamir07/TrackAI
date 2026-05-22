-- Performance Indexes Migration
-- Add indexes for improved query performance

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_company_role 
  ON users(company_id, role);

CREATE INDEX IF NOT EXISTS idx_users_company_created 
  ON users(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_username_lower 
  ON users((LOWER(username)));

CREATE INDEX IF NOT EXISTS idx_users_email_lower 
  ON users((LOWER(email)));

CREATE INDEX IF NOT EXISTS idx_users_department 
  ON users(company_id, department) 
  WHERE department IS NOT NULL;

-- Attendance table indexes
CREATE INDEX IF NOT EXISTS idx_attendance_user_date 
  ON attendance(user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_company_date 
  ON attendance(company_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_check_in 
  ON attendance(check_in_time) 
  WHERE check_in_time IS NOT NULL;

-- Tasks table indexes
CREATE INDEX IF NOT EXISTS idx_tasks_project_status 
  ON tasks(project_id, status);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned 
  ON tasks(assigned_to, status);

CREATE INDEX IF NOT EXISTS idx_tasks_company_status 
  ON tasks(company_id, status);

CREATE INDEX IF NOT EXISTS idx_tasks_due_date 
  ON tasks(due_date) 
  WHERE due_date IS NOT NULL;

-- Projects table indexes
CREATE INDEX IF NOT EXISTS idx_projects_company_status 
  ON projects(company_id, status);

CREATE INDEX IF NOT EXISTS idx_projects_created 
  ON projects(company_id, created_at DESC);

-- Leaves table indexes
CREATE INDEX IF NOT EXISTS idx_leaves_user_status 
  ON leaves(user_id, status);

CREATE INDEX IF NOT EXISTS idx_leaves_company_status 
  ON leaves(company_id, status);

CREATE INDEX IF NOT EXISTS idx_leaves_dates 
  ON leaves(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_leaves_company_dates 
  ON leaves(company_id, start_date, end_date);

-- Activity logs indexes
CREATE INDEX IF NOT EXISTS idx_activity_user_created 
  ON activity_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_company_created 
  ON activity_logs(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_action 
  ON activity_logs(action, created_at DESC);

-- Sessions table indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user 
  ON sessions(user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_sessions_token 
  ON sessions(token);

CREATE INDEX IF NOT EXISTS idx_sessions_company 
  ON sessions(company_id, is_active);

-- Update statistics
ANALYZE users;
ANALYZE attendance;
ANALYZE tasks;
ANALYZE projects;
ANALYZE leaves;
ANALYZE activity_logs;
ANALYZE sessions;