-- Approval Workflow Tables

-- Approval chains
CREATE TABLE IF NOT EXISTS approval_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES tenants(id),
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  steps JSONB NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_chains_company ON approval_chains(company_id, entity_type);

-- Approval requests
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES tenants(id),
  chain_id UUID REFERENCES approval_chains(id),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  requester_id UUID REFERENCES users(id),
  current_step INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_company ON approval_requests(company_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_requester ON approval_requests(requester_id);

-- Approval delegation
CREATE TABLE IF NOT EXISTS approval_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delegator_id UUID REFERENCES users(id),
  delegate_id UUID REFERENCES users(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT_idx_approval_delegations_delegator ON approval_delegations(delegator_id, is_active);

-- Auto-approval rules
CREATE TABLE IF NOT EXISTS auto_approval_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES tenants(id),
  entity_type TEXT NOT NULL,
  condition JSONB NOT NULL,
  action TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_approval_rules_company ON auto_approval_rules(company_id, is_active);