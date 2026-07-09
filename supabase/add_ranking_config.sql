-- =============================================================================
-- TEYEON Ranking — ranking_config (append-only 버전 산식 저장)
--
-- 구조: season_key 별 version append-only. 상태 draft / published / archived.
--   · 유효 산식 = 해당 season_key 의 최신 published 1행(부분 unique index 로 published 1행 강제).
--   · 과거 version 은 절대 값 덮어쓰기·삭제 금지(RLS 로 published/archived UPDATE·DELETE 차단).
--   · 가중치는 컬럼(jsonb 아님)으로 저장 → CHECK 범위 검증을 DB 가 직접 강제.
--
-- 앱 호환: 이 테이블이 없거나 published 행이 없으면 앱은 코드의 현재 고정 산식(기본값)으로 동작한다.
--   (참가 10 / 승리 5 / 1위 20 / 2위 12 / 3위 8 / 최소 참가 2 / 최고 승률상 6경기)
--
-- ⚠️ 초안. 승인 후 실행. 선행: add_ranking_managers.sql(can_manage_ranking()).
-- rollback: supabase/add_ranking_config_rollback.sql
-- =============================================================================

create table if not exists public.ranking_config (
    id                     uuid        primary key default gen_random_uuid(),
    season_key             text        not null,          -- 'all' | '2026' ...
    version                int         not null,          -- season_key 별 1,2,3 … (append-only)
    participation          int         not null default 10,
    win                    int         not null default 5,
    bonus_first            int         not null default 20,
    bonus_second           int         not null default 12,
    bonus_third            int         not null default 8,
    min_sessions           int         not null default 2,
    best_winrate_min_games int         not null default 6,
    status                 text        not null default 'draft'
                                       check (status in ('draft', 'published', 'archived')),
    reason                 text,
    changed_by             uuid        default auth.uid() references auth.users(id) on delete set null,
    created_at             timestamptz not null default now(),
    unique (season_key, version),
    -- 값 범위 validation(음수/과대 방지). 코드 clamp 와 이중 방어.
    constraint ranking_config_value_range check (
        participation          between 0 and 1000 and
        win                    between 0 and 1000 and
        bonus_first            between 0 and 1000 and
        bonus_second           between 0 and 1000 and
        bonus_third            between 0 and 1000 and
        min_sessions           between 1 and 100  and
        best_winrate_min_games between 1 and 1000
    )
);
comment on table public.ranking_config is
    '랭킹 산식 버전(append-only). 유효 산식 = season_key 별 최신 published. 과거 version 불변.';

-- season_key 당 published 는 최대 1행(중복 published 방지 — publish RPC 원자성과 이중 방어).
create unique index if not exists ranking_config_one_published_per_season
    on public.ranking_config (season_key) where status = 'published';
create index if not exists ranking_config_season_status_idx
    on public.ranking_config (season_key, status);

alter table public.ranking_config enable row level security;

-- ── 읽기 ──────────────────────────────────────────────────────────────────────
--   authenticated 회원: published 조회 가능(현재 적용 산식은 공개 정보 — Ranking Rule 표시).
drop policy if exists ranking_config_select_published on public.ranking_config;
create policy ranking_config_select_published on public.ranking_config
    for select to authenticated
    using (status = 'published');

--   매니저(CEO OR ranking_managers): draft/archived 포함 전체 조회(미리보기·이력).
drop policy if exists ranking_config_select_manager on public.ranking_config;
create policy ranking_config_select_manager on public.ranking_config
    for select to authenticated
    using (public.can_manage_ranking());

-- ── 쓰기 ──────────────────────────────────────────────────────────────────────
--   INSERT: 매니저만. draft 신규 저장. published 로의 직접 삽입은 partial unique + publish RPC 로 통제.
drop policy if exists ranking_config_insert_manager on public.ranking_config;
create policy ranking_config_insert_manager on public.ranking_config
    for insert to authenticated
    with check (public.can_manage_ranking());

--   UPDATE: 매니저가 'draft' 행만 수정 가능(값 다듬기). published/archived 는 불변(정책 없음 → 차단).
--     status 를 draft 이외로 바꾸는 것도 with_check 로 차단 → publish 는 반드시 RPC 를 통한다.
drop policy if exists ranking_config_update_draft on public.ranking_config;
create policy ranking_config_update_draft on public.ranking_config
    for update to authenticated
    using (public.can_manage_ranking() and status = 'draft')
    with check (public.can_manage_ranking() and status = 'draft');

--   DELETE: 매니저가 자신의 draft 만 삭제 가능(published/archived 삭제 불가 → 이력 보존).
drop policy if exists ranking_config_delete_draft on public.ranking_config;
create policy ranking_config_delete_draft on public.ranking_config
    for delete to authenticated
    using (public.can_manage_ranking() and status = 'draft');

notify pgrst, 'reload schema';
