-- Enable RLS and add policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Note: The auth.jwt() ->> 'company_id' requires that the JWT being passed contains company_id.
-- Supabase automatically populates auth.jwt() with the custom claims if set properly.

DROP POLICY IF EXISTS tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users
    USING (company_id::text = current_setting('request.jwt.claim.company_id', true) OR current_setting('request.jwt.claim.role', true) = 'superadmin');

DROP POLICY IF EXISTS tenant_isolation_projects ON projects;
CREATE POLICY tenant_isolation_projects ON projects
    USING (company_id::text = current_setting('request.jwt.claim.company_id', true) OR current_setting('request.jwt.claim.role', true) = 'superadmin');

DROP POLICY IF EXISTS tenant_isolation_tasks ON tasks;
CREATE POLICY tenant_isolation_tasks ON tasks
    USING (
        EXISTS (
            SELECT 1 FROM users WHERE users.id = tasks.user_id AND (users.company_id::text = current_setting('request.jwt.claim.company_id', true) OR current_setting('request.jwt.claim.role', true) = 'superadmin')
        )
    );
