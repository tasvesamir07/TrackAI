-- Project Resource Tables

-- Resource allocations
CREATE TABLE IF NOT EXISTS resource_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES users(id),
  project_id UUID REFERENCES projects(id),
  task_id UUID REFERENCES tasks(id),
  hours_allocated DECIMAL(5, 2),
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resource_allocations_employee ON resource_allocations(employee_id, start_date);
CREATE INDEX IF NOT EXISTS idx_resource_allocations_project ON resource_allocations(project_id);

-- Project templates
CREATE TABLE IF NOT EXISTS project_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  tasks JSONB DEFAULT '[]',
  team_roles JSONB DEFAULT '[]',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_templates_company ON project_templates(company_id);

-- Add time budget to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS budget_hours DECIMAL(5, 2);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_hours DECIMAL(5, 2) DEFAULT 0;