-- users_tenant_rls.sql
-- Strict RBAC + tenant isolation for public.users in Supabase/PostgreSQL.
-- Apply in Supabase SQL Editor.

BEGIN;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Optional hardening:
-- ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_super_admin ON public.users;
DROP POLICY IF EXISTS users_select_same_company ON public.users;
DROP POLICY IF EXISTS users_insert_super_admin ON public.users;
DROP POLICY IF EXISTS users_insert_same_company_admin ON public.users;
DROP POLICY IF EXISTS users_update_super_admin ON public.users;
DROP POLICY IF EXISTS users_update_same_company_admin ON public.users;
DROP POLICY IF EXISTS users_delete_super_admin ON public.users;
DROP POLICY IF EXISTS users_delete_same_company_admin ON public.users;

-- Super admin: full read access across all companies
CREATE POLICY users_select_super_admin
ON public.users
FOR SELECT
TO authenticated
USING (
  LOWER(
    COALESCE(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      ''
    )
  ) IN ('super_admin', 'superadmin')
);

-- Tenant-scoped read access:
-- company_admin and employee (plus admin/moderator variants) can read only same company_id
CREATE POLICY users_select_same_company
ON public.users
FOR SELECT
TO authenticated
USING (
  LOWER(
    COALESCE(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      ''
    )
  ) IN ('company_admin', 'employee', 'admin', 'moderator', 'project_manager')
  AND company_id::text = COALESCE(
    auth.jwt() ->> 'company_id',
    auth.jwt() -> 'app_metadata' ->> 'company_id',
    ''
  )
);

-- Super admin: full insert rights
CREATE POLICY users_insert_super_admin
ON public.users
FOR INSERT
TO authenticated
WITH CHECK (
  LOWER(
    COALESCE(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      ''
    )
  ) IN ('super_admin', 'superadmin')
);

-- Tenant admin insert rights: only within own tenant
CREATE POLICY users_insert_same_company_admin
ON public.users
FOR INSERT
TO authenticated
WITH CHECK (
  LOWER(
    COALESCE(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      ''
    )
  ) IN ('company_admin', 'admin')
  AND company_id::text = COALESCE(
    auth.jwt() ->> 'company_id',
    auth.jwt() -> 'app_metadata' ->> 'company_id',
    ''
  )
);

-- Super admin: full update rights
CREATE POLICY users_update_super_admin
ON public.users
FOR UPDATE
TO authenticated
USING (
  LOWER(
    COALESCE(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      ''
    )
  ) IN ('super_admin', 'superadmin')
)
WITH CHECK (
  LOWER(
    COALESCE(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      ''
    )
  ) IN ('super_admin', 'superadmin')
);

-- Tenant admin update rights: only rows in own tenant, and keep row in own tenant
CREATE POLICY users_update_same_company_admin
ON public.users
FOR UPDATE
TO authenticated
USING (
  LOWER(
    COALESCE(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      ''
    )
  ) IN ('company_admin', 'admin')
  AND company_id::text = COALESCE(
    auth.jwt() ->> 'company_id',
    auth.jwt() -> 'app_metadata' ->> 'company_id',
    ''
  )
)
WITH CHECK (
  LOWER(
    COALESCE(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      ''
    )
  ) IN ('company_admin', 'admin')
  AND company_id::text = COALESCE(
    auth.jwt() ->> 'company_id',
    auth.jwt() -> 'app_metadata' ->> 'company_id',
    ''
  )
);

-- Super admin: full delete rights
CREATE POLICY users_delete_super_admin
ON public.users
FOR DELETE
TO authenticated
USING (
  LOWER(
    COALESCE(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      ''
    )
  ) IN ('super_admin', 'superadmin')
);

-- Tenant admin delete rights: only rows in own tenant
CREATE POLICY users_delete_same_company_admin
ON public.users
FOR DELETE
TO authenticated
USING (
  LOWER(
    COALESCE(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      ''
    )
  ) IN ('company_admin', 'admin')
  AND company_id::text = COALESCE(
    auth.jwt() ->> 'company_id',
    auth.jwt() -> 'app_metadata' ->> 'company_id',
    ''
  )
);

COMMIT;
