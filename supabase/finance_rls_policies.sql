-- TEYEON Finance RLS policies
-- Apply manually in Supabase SQL Editor after reviewing existing policies.
-- This file does not change schema or delete data.

ALTER TABLE public.finance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_monthly_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_settings ENABLE ROW LEVEL SECURITY;

-- FINANCE_MANAGER is intentionally left as a TODO in active RLS conditions.
-- Current production roles use CEO / ADMIN for finance management.
-- When profiles.role and AuthContext fully support FINANCE_MANAGER, add it to the role lists below.

DROP POLICY IF EXISTS finance_transactions_admin_select ON public.finance_transactions;
DROP POLICY IF EXISTS finance_transactions_admin_insert ON public.finance_transactions;
DROP POLICY IF EXISTS finance_transactions_admin_update ON public.finance_transactions;
DROP POLICY IF EXISTS finance_transactions_admin_delete ON public.finance_transactions;

CREATE POLICY finance_transactions_admin_select
ON public.finance_transactions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);

CREATE POLICY finance_transactions_admin_insert
ON public.finance_transactions
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);

CREATE POLICY finance_transactions_admin_update
ON public.finance_transactions
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);

CREATE POLICY finance_transactions_admin_delete
ON public.finance_transactions
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);

DROP POLICY IF EXISTS finance_monthly_reports_admin_select ON public.finance_monthly_reports;
DROP POLICY IF EXISTS finance_monthly_reports_admin_insert ON public.finance_monthly_reports;
DROP POLICY IF EXISTS finance_monthly_reports_admin_update ON public.finance_monthly_reports;
DROP POLICY IF EXISTS finance_monthly_reports_admin_delete ON public.finance_monthly_reports;
DROP POLICY IF EXISTS finance_monthly_reports_member_confirmed_select ON public.finance_monthly_reports;

CREATE POLICY finance_monthly_reports_admin_select
ON public.finance_monthly_reports
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);

CREATE POLICY finance_monthly_reports_member_confirmed_select
ON public.finance_monthly_reports
FOR SELECT
TO authenticated
USING (status = 'CONFIRMED');

CREATE POLICY finance_monthly_reports_admin_insert
ON public.finance_monthly_reports
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);

CREATE POLICY finance_monthly_reports_admin_update
ON public.finance_monthly_reports
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);

CREATE POLICY finance_monthly_reports_admin_delete
ON public.finance_monthly_reports
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);

DROP POLICY IF EXISTS finance_receivables_admin_select ON public.finance_receivables;
DROP POLICY IF EXISTS finance_receivables_admin_insert ON public.finance_receivables;
DROP POLICY IF EXISTS finance_receivables_admin_update ON public.finance_receivables;
DROP POLICY IF EXISTS finance_receivables_admin_delete ON public.finance_receivables;
DROP POLICY IF EXISTS finance_receivables_member_public_open_select ON public.finance_receivables;

CREATE POLICY finance_receivables_admin_select
ON public.finance_receivables
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);

CREATE POLICY finance_receivables_member_public_open_select
ON public.finance_receivables
FOR SELECT
TO authenticated
USING (
  status = 'OPEN'
  AND is_public = true
  AND is_confirmed = true
);

CREATE POLICY finance_receivables_admin_insert
ON public.finance_receivables
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);

CREATE POLICY finance_receivables_admin_update
ON public.finance_receivables
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);

CREATE POLICY finance_receivables_admin_delete
ON public.finance_receivables
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);

DROP POLICY IF EXISTS finance_settings_admin_select ON public.finance_settings;
DROP POLICY IF EXISTS finance_settings_admin_insert ON public.finance_settings;
DROP POLICY IF EXISTS finance_settings_admin_update ON public.finance_settings;
DROP POLICY IF EXISTS finance_settings_admin_delete ON public.finance_settings;
DROP POLICY IF EXISTS finance_settings_member_select ON public.finance_settings;

CREATE POLICY finance_settings_member_select
ON public.finance_settings
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY finance_settings_admin_insert
ON public.finance_settings
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);

CREATE POLICY finance_settings_admin_update
ON public.finance_settings
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);

CREATE POLICY finance_settings_admin_delete
ON public.finance_settings
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('CEO', 'ADMIN')
  )
);
