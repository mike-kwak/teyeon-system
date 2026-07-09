-- =============================================================================
-- TEYEON Ranking — ranking_snapshots (시즌 종료 동결 snapshot, JSONB 단일)
--
-- 목적: 시즌 종료 시점의 최종 Ranking/Awards 계산 결과를 불변 blob 으로 박제한다.
--   · 종료 후 가중치 변경·Archive 추가·닉네임/사진 변경이 있어도 과거 시즌 결과는 그대로.
--   · 계산은 TypeScript computeClubRanking(단일 산식)이 담당하고, snapshot 은 그 결과를 보존만 한다.
--   · 쓰기는 finalize/reopen RPC(SECURITY DEFINER)만 — 직접 INSERT/UPDATE/DELETE 전면 차단.
--   · 시즌당 finalized 1건(부분 unique). 이전 것은 삭제 없이 superseded 로 보존.
--
-- ⚠️ 초안. 승인 후 실행. 선행: add_ranking_managers.sql(can_manage_ranking), add_ranking_config.sql.
-- rollback: supabase/add_ranking_snapshots_rollback.sql
-- =============================================================================

create table if not exists public.ranking_snapshots (
    id                     uuid        primary key default gen_random_uuid(),
    season_key             text        not null,               -- 'YYYY' (연도 시즌만 동결)
    season_name            text        not null,
    status                 text        not null check (status in ('finalized', 'superseded')),
    config_id              uuid        not null,               -- 동결 당시 적용 published config
    config_version         integer     not null,
    schema_version         integer     not null default 1 check (schema_version >= 1),
    snapshot_data          jsonb       not null,               -- { schemaVersion, generatedAt, summary, config, entries[], awards{} }
    member_count           integer     not null check (member_count >= 0),
    official_session_count integer     not null check (official_session_count > 0),
    latest_archive_date    text,
    archive_fingerprint    text,                               -- 향후 stale 감지용(이번엔 저장만)
    finalize_reason        text        not null check (length(trim(finalize_reason)) >= 4),
    finalized_at           timestamptz not null default now(),
    finalized_by           uuid        not null,
    reopened_at            timestamptz,
    reopened_by            uuid,
    reopen_reason          text,
    superseded_by          uuid,                               -- 재동결 시 이전(superseded) → 새 snapshot id
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);
comment on table public.ranking_snapshots is
    '시즌 종료 동결 snapshot(JSONB). 쓰기는 finalize/reopen RPC 만. finalized 는 시즌당 1건, 이전은 superseded 보존.';

-- 시즌당 finalized 는 최대 1건.
create unique index if not exists ranking_snapshots_one_finalized_per_season
    on public.ranking_snapshots (season_key) where status = 'finalized';
create index if not exists ranking_snapshots_season_status_idx
    on public.ranking_snapshots (season_key, status);

alter table public.ranking_snapshots enable row level security;

-- ── 읽기 ──────────────────────────────────────────────────────────────────────
--   authenticated 회원: finalized 조회 가능(과거 시즌 최종 순위는 공개 정보).
drop policy if exists ranking_snapshots_select_finalized on public.ranking_snapshots;
create policy ranking_snapshots_select_finalized on public.ranking_snapshots
    for select to authenticated
    using (status = 'finalized');

--   매니저(CEO OR ranking_managers): superseded 포함 전체 이력 조회.
drop policy if exists ranking_snapshots_select_manager on public.ranking_snapshots;
create policy ranking_snapshots_select_manager on public.ranking_snapshots
    for select to authenticated
    using (public.can_manage_ranking());

-- ── 쓰기: 직접 INSERT/UPDATE/DELETE 정책 없음 → 전면 차단.
--   snapshot 생성/상태전이는 finalize_ranking_season / reopen_ranking_season RPC(SECURITY DEFINER)만 수행.
--   (SECURITY DEFINER 함수는 RLS 를 우회하므로 정책 없이도 서버 검증하에 쓰기 가능.)

notify pgrst, 'reload schema';
