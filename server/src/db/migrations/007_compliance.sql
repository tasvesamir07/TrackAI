-- Compliance & Legal Tables

-- Employee contracts
CREATE TABLE IF NOT EXISTS employee_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES users(id),
  contract_type TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  terms JSONB,
  document_url TEXT,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_contracts_employee ON employee_contracts(employee_id);

-- Employee documents
CREATE TABLE IF NOT EXISTS employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES users(id),
  document_type TEXT NOT NULL,
  document_name TEXT,
  expiry_date DATE,
  document_url TEXT,
  alert_days_before INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_expiry ON employee_documents(expiry_date);