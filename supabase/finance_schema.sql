-- TEYEON Finance MVP
-- KakaoBank CSV upload based finance ledger and member-facing confirmed reports.
-- Review and apply manually in Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.finance_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_date DATE NOT NULL,
    transaction_time TEXT,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('INCOME', 'EXPENSE')),
    amount INTEGER NOT NULL,
    balance_after INTEGER,
    transaction_method TEXT,
    description TEXT,
    counterparty TEXT,
    category TEXT CHECK (
      category IS NULL OR category IN (
        '월회비',
        '연회비',
        '게스트비',
        '벌금',
        '게스트비+벌금',
        '상금',
        '코트비',
        '공값/용품비',
        '식대/간식',
        '찬조금',
        '이자',
        '기타'
      )
    ),
    suggested_category TEXT CHECK (
      suggested_category IS NULL OR suggested_category IN (
        '월회비',
        '연회비',
        '게스트비',
        '벌금',
        '게스트비+벌금',
        '상금',
        '코트비',
        '공값/용품비',
        '식대/간식',
        '찬조금',
        '이자',
        '기타'
      )
    ),
    classification_status TEXT NOT NULL DEFAULT 'UNCLASSIFIED'
      CHECK (classification_status IN ('UNCLASSIFIED', 'SUGGESTED', 'NEEDS_REVIEW', 'CONFIRMED')),
    is_ambiguous BOOLEAN NOT NULL DEFAULT false,
    review_reason TEXT,
    member_id TEXT,
    payer_name TEXT,
    related_player_name TEXT,
    memo TEXT,
    source TEXT NOT NULL DEFAULT 'kakaobank_upload',
    source_file_name TEXT,
    source_row_index INTEGER,
    source_hash TEXT UNIQUE,
    confirmed_by TEXT,
    confirmed_at TIMESTAMPTZ,
    created_by TEXT,
    updated_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finance_monthly_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    opening_balance INTEGER NOT NULL DEFAULT 0,
    income_total INTEGER NOT NULL DEFAULT 0,
    expense_total INTEGER NOT NULL DEFAULT 0,
    closing_balance INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED')),
    income_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
    expense_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
    top_expenses JSONB NOT NULL DEFAULT '[]'::jsonb,
    public_note TEXT,
    confirmed_at TIMESTAMPTZ,
    confirmed_by TEXT,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (year, month)
);

ALTER TABLE public.finance_monthly_reports
ADD COLUMN IF NOT EXISTS income_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS expense_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS top_expenses JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS public_note TEXT,
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS confirmed_by TEXT,
ADD COLUMN IF NOT EXISTS note TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE TABLE IF NOT EXISTS public.finance_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    monthly_fee_amount INTEGER NOT NULL DEFAULT 10000,
    yearly_fee_amount INTEGER NOT NULL DEFAULT 120000,
    guest_fee_amount INTEGER NOT NULL DEFAULT 5000,
    sojeong_guest_fee_amount INTEGER NOT NULL DEFAULT 10000,
    penalty_l1_amount INTEGER NOT NULL DEFAULT 3000,
    penalty_l2_amount INTEGER NOT NULL DEFAULT 5000,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.finance_settings
ADD COLUMN IF NOT EXISTS sojeong_guest_fee_amount INTEGER NOT NULL DEFAULT 10000;

ALTER TABLE public.finance_settings
ALTER COLUMN guest_fee_amount SET DEFAULT 5000;

-- Deprecated if a previous draft migration was already applied:
-- default_penalty_amount and sojeong_penalty_amount are not used by the app.
-- Do not drop them automatically here; review production data first if cleanup is needed.

CREATE TABLE IF NOT EXISTS public.finance_receivables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id TEXT,
    member_name TEXT,
    player_name TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    category TEXT,
    target_month TEXT,
    kdk_archive_id TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PAID', 'WAIVED')),
    is_public BOOLEAN NOT NULL DEFAULT true,
    is_confirmed BOOLEAN NOT NULL DEFAULT false,
    confirmed_by TEXT,
    confirmed_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    memo TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.finance_receivables
ADD COLUMN IF NOT EXISTS member_id TEXT,
ADD COLUMN IF NOT EXISTS member_name TEXT,
ADD COLUMN IF NOT EXISTS player_name TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS amount INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS category TEXT,
ADD COLUMN IF NOT EXISTS target_month TEXT,
ADD COLUMN IF NOT EXISTS kdk_archive_id TEXT,
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'OPEN',
ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS confirmed_by TEXT,
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS memo TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE TABLE IF NOT EXISTS public.finance_member_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_month TEXT NOT NULL,
    member_id TEXT NOT NULL,
    member_name TEXT NOT NULL,
    fee_type TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (fee_type IN ('MONTHLY', 'YEARLY')),
    expected_amount INTEGER NOT NULL DEFAULT 0,
    paid_amount INTEGER NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'UNCONFIRMED'
      CHECK (payment_status IN ('UNCONFIRMED', 'UNPAID', 'PARTIAL', 'PAID', 'WAIVED', 'YEARLY_PAID')),
    is_yearly_payer BOOLEAN NOT NULL DEFAULT false,
    matched_transaction_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_public BOOLEAN NOT NULL DEFAULT true,
    is_confirmed BOOLEAN NOT NULL DEFAULT false,
    confirmed_by TEXT,
    confirmed_at TIMESTAMPTZ,
    memo TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (target_month, member_id, fee_type)
);

CREATE INDEX IF NOT EXISTS finance_transactions_date_idx
ON public.finance_transactions (transaction_date DESC);

CREATE INDEX IF NOT EXISTS finance_transactions_category_idx
ON public.finance_transactions (category);

CREATE INDEX IF NOT EXISTS finance_transactions_status_idx
ON public.finance_transactions (classification_status);

CREATE INDEX IF NOT EXISTS finance_monthly_reports_year_month_idx
ON public.finance_monthly_reports (year DESC, month DESC);

CREATE INDEX IF NOT EXISTS finance_monthly_reports_public_idx
ON public.finance_monthly_reports (status, year DESC, month DESC);

CREATE INDEX IF NOT EXISTS finance_receivables_public_open_idx
ON public.finance_receivables (status, is_public, is_confirmed);

CREATE INDEX IF NOT EXISTS finance_receivables_target_month_idx
ON public.finance_receivables (target_month);

CREATE INDEX IF NOT EXISTS finance_member_payments_month_idx
ON public.finance_member_payments (target_month DESC);

CREATE INDEX IF NOT EXISTS finance_member_payments_public_idx
ON public.finance_member_payments (target_month DESC, is_public, is_confirmed, payment_status);

CREATE INDEX IF NOT EXISTS finance_settings_effective_from_idx
ON public.finance_settings (effective_from DESC);

-- RLS policy should be reviewed before production use.
-- Recommended direction:
-- - Members can SELECT finance_monthly_reports where status = 'CONFIRMED'.
-- - Members can SELECT finance_receivables where status = 'OPEN' AND is_public = true AND is_confirmed = true.
-- - Members can SELECT finance_member_payments only for public, confirmed unpaid/partial rows if 공개 미납 현황 is needed.
-- - finance_transactions and DRAFT reports should be visible only to CEO, ADMIN, and future FINANCE_MANAGER.
-- - INSERT/UPDATE/DELETE should be restricted to CEO, ADMIN, and future FINANCE_MANAGER.
-- This MVP creates the schema only; policies are intentionally left for a separate reviewed migration.
