-- Click Tracking Tables
-- Run this migration to create click tracking tables

-- Click events table
CREATE TABLE IF NOT EXISTS click_events (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  page_url TEXT NOT NULL,
  element_selector TEXT NOT NULL,
  element_text TEXT,
  x_position INTEGER NOT NULL,
  y_position INTEGER NOT NULL,
  session_id VARCHAR(100),
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_click_events_page ON click_events(page_url, timestamp);
CREATE INDEX IF NOT EXISTS idx_click_events_company ON click_events(company_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_click_events_user ON click_events(user_id, timestamp);

-- Page heatmap aggregation table
CREATE TABLE IF NOT EXISTS page_heatmaps (
  id BIGSERIAL PRIMARY KEY,
  page_url TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  click_count INTEGER DEFAULT 0,
  unique_clicks INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(page_url, x, y)
);

CREATE INDEX IF NOT EXISTS idx_page_heatmaps_url ON page_heatmaps(page_url);

-- Request logs for URL analytics
CREATE TABLE IF NOT EXISTS request_logs (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  ip_address VARCHAR(45),
  method VARCHAR(10) NOT NULL,
  path TEXT NOT NULL,
  query_params JSONB,
  status_code INTEGER,
  response_time_ms INTEGER,
  user_agent TEXT,
  country_code VARCHAR(2),
  city VARCHAR(100),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  isp VARCHAR(200),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_logs_path ON request_logs(path, created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_company ON request_logs(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_user ON request_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_ip ON request_logs(ip_address, created_at);

-- Bot logs for bot detection
CREATE TABLE IF NOT EXISTS bot_logs (
  id BIGSERIAL PRIMARY KEY,
  ip_address VARCHAR(45),
  user_agent TEXT,
  score INTEGER,
  blocked BOOLEAN DEFAULT FALSE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_logs_ip ON bot_logs(ip_address, created_at);
CREATE INDEX IF NOT EXISTS idx_bot_logs_blocked ON bot_logs(blocked, created_at);