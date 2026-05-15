-- TEYEON Tournament Calendar
-- Manual operations board for tournament schedules, pairs, partner requests, and results.

CREATE TABLE IF NOT EXISTS public.tournament_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    event_date DATE NOT NULL,
    venue TEXT,
    organizer TEXT NOT NULL CHECK (organizer IN ('KATO', 'KATA', 'KTA', '지역대회', '비랭킹')),
    division TEXT NOT NULL CHECK (division IN ('신인부', '오픈부', '단체전', '기타')),
    grade TEXT CHECK (grade IS NULL OR grade IN ('MA', 'A', '1', '2', '3', '비랭킹')),
    registration_start DATE,
    status TEXT NOT NULL DEFAULT '접수예정' CHECK (status IN ('접수예정', '접수중', '접수종료', '대회진행중', '대회종료', '대회취소')),
    memo TEXT,
    created_by TEXT,
    updated_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tournament_pairs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.tournament_events(id) ON DELETE CASCADE,
    player1_name TEXT NOT NULL,
    player2_name TEXT NOT NULL,
    player1_member_id TEXT,
    player2_member_id TEXT,
    result TEXT CHECK (result IS NULL OR result IN ('64', '32', '16', '8', 'Finalist', '준우승', '우승', '취소', 'X', '예정')),
    memo TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tournament_partner_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.tournament_events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    member_id TEXT,
    memo TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tournament_events_event_date_idx ON public.tournament_events(event_date);
CREATE INDEX IF NOT EXISTS tournament_events_status_idx ON public.tournament_events(status);
CREATE INDEX IF NOT EXISTS tournament_pairs_event_id_idx ON public.tournament_pairs(event_id);
CREATE INDEX IF NOT EXISTS tournament_partner_requests_event_id_idx ON public.tournament_partner_requests(event_id);

ALTER TABLE public.tournament_events
DROP CONSTRAINT IF EXISTS tournament_events_status_check;

ALTER TABLE public.tournament_events
ADD CONSTRAINT tournament_events_status_check
CHECK (status IN ('접수예정', '접수중', '접수종료', '대회진행중', '대회종료', '대회취소'));

ALTER TABLE public.tournament_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_partner_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read tournament events" ON public.tournament_events;
DROP POLICY IF EXISTS "Public read tournament pairs" ON public.tournament_pairs;
DROP POLICY IF EXISTS "Public read tournament partner requests" ON public.tournament_partner_requests;
DROP POLICY IF EXISTS "Admin write tournament events" ON public.tournament_events;
DROP POLICY IF EXISTS "Admin write tournament pairs" ON public.tournament_pairs;
DROP POLICY IF EXISTS "Admin write tournament partner requests" ON public.tournament_partner_requests;

CREATE POLICY "Public read tournament events"
ON public.tournament_events
FOR SELECT
USING (true);

CREATE POLICY "Public read tournament pairs"
ON public.tournament_pairs
FOR SELECT
USING (true);

CREATE POLICY "Public read tournament partner requests"
ON public.tournament_partner_requests
FOR SELECT
USING (true);

CREATE POLICY "Admin write tournament events"
ON public.tournament_events
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('ADMIN', 'CEO')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('ADMIN', 'CEO')
  )
);

CREATE POLICY "Admin write tournament pairs"
ON public.tournament_pairs
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('ADMIN', 'CEO')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('ADMIN', 'CEO')
  )
);

CREATE POLICY "Admin write tournament partner requests"
ON public.tournament_partner_requests
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('ADMIN', 'CEO')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id::text = auth.uid()::text
      AND profiles.role IN ('ADMIN', 'CEO')
  )
);
