-- Audit Logs for Multi-tenant Tracking

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB DEFAULT '{}',
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created 
  ON audit_logs(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created 
  ON audit_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action 
  ON audit_logs(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_resource 
  ON audit_logs(resource_type, resource_id);