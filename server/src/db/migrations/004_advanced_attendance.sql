-- Advanced Attendance Features Tables

-- Geofences
CREATE TABLE IF NOT EXISTS geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES tenants(id),
  name TEXT NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  radius_meters INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geofences_company ON geofences(company_id);

-- Shifts
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES tenants(id),
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  grace_minutes INTEGER DEFAULT 5,
  break_start TIME,
  break_end TIME,
  is_night_shift BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shifts_company ON shifts(company_id);

-- Shift assignments
CREATE TABLE IF NOT EXISTS shift_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES users(id),
  shift_id UUID REFERENCES shifts(id),
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_assignments_employee ON shift_assignments(employee_id, effective_from);

-- Attendance with photo and location
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_latitude DECIMAL(10, 8);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_longitude DECIMAL(11, 8);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_latitude DECIMAL(10, 8);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_longitude DECIMAL(11, 8);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES shifts(id);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS break_duration_minutes INTEGER DEFAULT 0;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS overtime_minutes INTEGER DEFAULT 0;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS geofence_id UUID REFERENCES geofences(id);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS geofence_verified BOOLEAN DEFAULT FALSE;