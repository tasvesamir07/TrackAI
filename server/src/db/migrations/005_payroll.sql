-- Payroll Module Tables

-- Salary history
CREATE TABLE IF NOT EXISTS salary_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES users(id),
  effective_from DATE NOT NULL,
  base_salary DECIMAL(12, 2) NOT NULL,
  allowances JSONB DEFAULT '{}',
  deductions JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salary_history_employee ON salary_history(employee_id, effective_from);

-- Payslips
CREATE TABLE IF NOT EXISTS payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES tenants(id),
  employee_id UUID REFERENCES users(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  basic_salary DECIMAL(12, 2) NOT NULL,
  allowances JSONB DEFAULT '{}',
  deductions JSONB DEFAULT '{}',
  overtime_pay DECIMAL(12, 2) DEFAULT 0,
  gross_pay DECIMAL(12, 2) NOT NULL,
  net_pay DECIMAL(12, 2) NOT NULL,
  pdf_url TEXT,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips(employee_id, period_start);
CREATE INDEX IF NOT EXISTS idx_payslips_company ON payslips(company_id, period_start);

-- Bonuses
CREATE TABLE IF NOT EXISTS bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES tenants(id),
  employee_id UUID REFERENCES users(id),
  amount DECIMAL(12, 2) NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  payment_date DATE,
  tax_deducted BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bonuses_employee ON bonuses(employee_id, payment_date);