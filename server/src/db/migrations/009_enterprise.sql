-- Enterprise Features

-- SSO Configuration
CREATE TABLE IF NOT EXISTS sso_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  client_id TEXT,
  client_secret TEXT,
  metadata_url TEXT,
  enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sso_config_company ON sso_config(company_id);

-- Announcements
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  priority TEXT DEFAULT 'normal',
  target_roles TEXT[] DEFAULT '{}',
  is_pinned BOOLEAN DEFAULT FALSE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_company ON announcements(company_id);

-- Bookmarks
CREATE TABLE IF NOT EXISTS user_bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_bookmarks_user ON user_bookmarks(user_id);

-- Scheduled Reports
CREATE TABLE IF NOT EXISTS scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL,
  frequency TEXT NOT NULL,
  recipients JSONB DEFAULT '[]',
  filters JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_company ON scheduled_reports(company_id);