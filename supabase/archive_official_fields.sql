-- Archive official/test flags for KDK profile aggregation.
-- Safe to run multiple times.

ALTER TABLE public.teyeon_archive_v1
ADD COLUMN IF NOT EXISTS is_official boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
ADD COLUMN IF NOT EXISTS confirmed_by text,
ADD COLUMN IF NOT EXISTS profile_reflected boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS archive_type text NOT NULL DEFAULT 'kdk';

CREATE INDEX IF NOT EXISTS teyeon_archive_v1_official_created_at_idx
ON public.teyeon_archive_v1 (is_official, created_at DESC);

CREATE INDEX IF NOT EXISTS teyeon_archive_v1_archive_type_official_idx
ON public.teyeon_archive_v1 (archive_type, is_official);
