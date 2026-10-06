-- ────────────────────────────────────────────────────────────────────────────
-- TEYEON KDK 공식 기록 정정 (score correction)
--
-- 목적: KDK 종료 후 Archive(teyeon_archive_v1.raw_data)에 저장된 경기 1건의 점수
--       오입력이 발견됐을 때, CEO/ADMIN 이 앱에서 안전하게 정정한다.
--       SQL 수동 UPDATE 를 없애고 모든 정정을 감사 가능하게 만든다.
--
-- 설계 결정:
--   1) **순위 규칙·정산 규칙을 이 SQL 에 복제하지 않는다.**
--      공식 순위 SSoT 는 lib/kdk/officialRanking.ts 하나이며(① 승수 ② 득실 ③ 연장자
--      ④ 이름/ id), 클라이언트(운영자 세션)가 그 SSoT 로 next raw_data 를 계산한다.
--      RPC 는 그것을 **독립 검증**한다 — 규칙 재구현이 아니라 불변식 확인이다.
--      (2026-07-07 동률 오확정 사고 재발 방지: 규칙 정의가 두 곳에 있으면 반드시 어긋난다.)
--   2) 검증 범위:
--      · 구조 불변식  — 대상 경기의 score1/score2 외에 바뀐 것이 없는지
--      · 집계 재계산  — 단순 합산이므로 SQL 로 독립 확인(규칙 복제 아님)
--      · 순위 단조성  — (승수 ↓, 득실 ↓) 비감소. ③ 연장자 순서는 SQL 이 판정하지 않는다.
--      · 정산 금액    — tier 산술을 거울처럼 확인(아래 ⚠ 참고)
--   3) Archive lifecycle 컬럼(is_official/confirmed_at/confirmed_by/is_test/archive_type/
--      id/created_at)은 UPDATE SET 에 넣지 않는다. 공식 확정 **전/후 모두** 정정 가능하다.
--   4) 동시성: advisory lock + raw_data fingerprint(md5). 오래된 미리보기로 덮어쓰지 못한다.
--   5) Finance 는 건드리지 않는다. 금액이 바뀌는 정정이라도 기존 납부/지급 row 를
--      자동 수정·삭제하지 않는다(화면이 영향을 표시하고 운영자가 별도 처리).
--
-- ⚠ 정산 금액 검증은 lib/kdk/settlement.ts(computeSettlement)의 **거울**이다.
--    둘 중 하나를 고치면 반드시 함께 고친다. 금액 산식의 SSoT 는 TS 쪽이다.
--
-- ⚠ 자동 실행 금지. Supabase SQL Editor 에서 1회 실행. idempotent — 재실행 안전.
-- ⚠ 적용 후: notify pgrst, 'reload schema';
-- ⚠ 미적용 환경에서도 앱은 정상 동작한다(정정 버튼이 '준비 중'으로 비활성).
--
-- rollback: supabase/add_kdk_archive_correction_rollback.sql
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. 감사 로그 (append-only) ──────────────────────────────────────────────

create table if not exists public.kdk_archive_corrections (
  id              uuid        primary key default gen_random_uuid(),
  archive_id      text        not null,
  match_id        text        not null,
  before_score1   integer     not null,
  before_score2   integer     not null,
  after_score1    integer     not null,
  after_score2    integer     not null,
  reason          text        not null check (length(btrim(reason)) >= 4),
  -- 정정 직전 raw_data 전체(pre-image). 사고 조사·수동 복구의 유일한 근거.
  before_raw_data jsonb       not null,
  -- 화면 미리보기와 같은 영향 요약(순위/득실/금액 변동). 조사용 참고값.
  impact          jsonb       not null default '{}'::jsonb,
  -- 정정 시점의 Archive 공식 상태(정정이 확정 전이었는지 후였는지 구분).
  was_official    boolean,
  corrected_by    uuid        not null references auth.users(id) on delete restrict,
  corrected_at    timestamptz not null default now()
);

create index if not exists kdk_archive_corrections_archive_idx
  on public.kdk_archive_corrections(archive_id, corrected_at desc);
create index if not exists kdk_archive_corrections_match_idx
  on public.kdk_archive_corrections(archive_id, match_id);

comment on table public.kdk_archive_corrections is
  'KDK 공식 기록 점수 정정 감사 로그(append-only). before_raw_data = 정정 직전 raw_data 전체 pre-image. '
  '쓰기는 correct_kdk_archive_match_score RPC 만. UPDATE/DELETE 정책 없음.';

alter table public.kdk_archive_corrections enable row level security;

-- 조회: CEO/ADMIN 만(감사 필드 노출 최소화).
drop policy if exists "kdk_corrections_select_admin" on public.kdk_archive_corrections;
create policy "kdk_corrections_select_admin" on public.kdk_archive_corrections
  for select using (public.is_full_admin());

-- 쓰기: 정책을 두지 않는다(정책 없음 = RLS 가 모든 직접 INSERT/UPDATE/DELETE 거부).
drop policy if exists "kdk_corrections_insert_admin" on public.kdk_archive_corrections;
drop policy if exists "kdk_corrections_update_admin" on public.kdk_archive_corrections;
drop policy if exists "kdk_corrections_delete_admin" on public.kdk_archive_corrections;

-- ── 2. 정정 컨텍스트 조회 RPC ───────────────────────────────────────────────
--   fingerprint 는 Postgres 의 md5(raw_data::text) 여야 하므로(클라이언트가 jsonb
--   텍스트 표현을 재현할 수 없다) 여기서 함께 돌려준다. 미리보기 → 확정 사이의
--   변경을 이 값으로 감지한다.

create or replace function public.get_kdk_archive_correction_context(p_archive_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.teyeon_archive_v1%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;
  if not public.is_full_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_row from public.teyeon_archive_v1 where id = p_archive_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'archive_not_found');
  end if;
  if coalesce(v_row.archive_type, 'kdk') <> 'kdk' then
    return jsonb_build_object('ok', false, 'reason', 'not_kdk_archive');
  end if;

  return jsonb_build_object(
    'ok',             true,
    'archiveId',      v_row.id,
    'rawData',        v_row.raw_data,
    'fingerprint',    md5(v_row.raw_data::text),
    'isOfficial',     coalesce(v_row.is_official, false),
    'isTest',         coalesce(v_row.is_test, false),
    'confirmedAt',    v_row.confirmed_at,
    'correctionCount', (
      select count(*) from public.kdk_archive_corrections c where c.archive_id = v_row.id
    )
  );
end;
$$;

comment on function public.get_kdk_archive_correction_context(text) is
  'KDK Archive 정정 컨텍스트(raw_data + md5 fingerprint + 공식 상태). CEO/ADMIN 전용, 읽기 전용.';

-- 권한: PUBLIC·anon 전면 차단, authenticated 만 EXECUTE.
--   ⚠ authenticated 에는 일반 MEMBER 도 포함되므로, 함수 **내부**에서 is_full_admin() 을
--     다시 확인해 CEO/ADMIN 이 아니면 forbidden 을 돌려준다(기존 운영 RPC 와 같은 2중 방어).
revoke all     on function public.get_kdk_archive_correction_context(text) from public;
revoke execute on function public.get_kdk_archive_correction_context(text) from anon;
grant  execute on function public.get_kdk_archive_correction_context(text) to authenticated;

-- ── 3. 정정 RPC (원자적) ────────────────────────────────────────────────────

create or replace function public.correct_kdk_archive_match_score(
  p_archive_id    text,
  p_match_id      text,
  p_score1        integer,
  p_score2        integer,
  p_reason        text,
  p_expected_fingerprint text,
  p_next_raw_data jsonb,
  p_impact        jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row        public.teyeon_archive_v1%rowtype;
  v_cur        jsonb;
  v_next       jsonb;
  v_fp         text;
  v_before1    integer;
  v_before2    integer;
  v_n          integer;
  v_bottom     integer;
  v_pen_count  integer;
  v_first      integer;
  v_l1         integer;
  v_l2         integer;
  v_guest_fee  integer;
  v_bad        integer;
  v_status     text;
  v_corr_id    uuid;
  v_key        text;
begin
  -- 1) 인증
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;
  -- 2) 권한 — CEO/ADMIN
  if not public.is_full_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_reason is null or length(btrim(p_reason)) < 4 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  if length(btrim(p_reason)) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'reason_too_long');
  end if;
  if p_next_raw_data is null or jsonb_typeof(p_next_raw_data) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  -- 3) Archive 단위 직렬화 — 두 운영자가 같은 Archive 를 동시에 정정하지 못한다.
  perform pg_advisory_xact_lock(hashtext('kdk-archive-correction:' || coalesce(p_archive_id, '')));

  -- 4) Archive 존재
  select * into v_row from public.teyeon_archive_v1 where id = p_archive_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'archive_not_found');
  end if;
  -- 5) KDK 전용
  if coalesce(v_row.archive_type, 'kdk') <> 'kdk' then
    return jsonb_build_object('ok', false, 'reason', 'not_kdk_archive');
  end if;

  v_cur := v_row.raw_data;
  v_next := p_next_raw_data;

  -- 6) fingerprint — 미리보기 이후 다른 사람이 바꿨으면 거부
  v_fp := md5(v_cur::text);
  if p_expected_fingerprint is null or p_expected_fingerprint <> v_fp then
    return jsonb_build_object('ok', false, 'reason', 'version_conflict', 'fingerprint', v_fp);
  end if;

  -- 7) 대상 경기 존재 + 현재 점수 확보
  --    ⚠ 점수가 null 인 경우와 '경기 없음'을 구분한다(별도 존재 확인).
  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_cur->'snapshot_data', '[]'::jsonb)) m
     where m->>'id' = p_match_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'match_not_found');
  end if;

  select coalesce((m->>'score1')::int, 0), coalesce((m->>'score2')::int, 0),
         (m->>'status')
    into v_before1, v_before2, v_status
    from jsonb_array_elements(v_cur->'snapshot_data') m
   where m->>'id' = p_match_id
   limit 1;

  if coalesce(v_status, '') <> 'complete' then
    return jsonb_build_object('ok', false, 'reason', 'match_not_complete');
  end if;

  -- 8) 점수 유효성 — 동점 금지(동점은 집계 제외 규칙과 충돌), 음수 금지
  if p_score1 is null or p_score2 is null or p_score1 < 0 or p_score2 < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_score');
  end if;
  if p_score1 = p_score2 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_score');
  end if;
  if p_score1 = v_before1 and p_score2 = v_before2 then
    return jsonb_build_object('ok', false, 'reason', 'no_change');
  end if;

  -- ── 9) 구조 불변식 ──────────────────────────────────────────────────────
  -- 9-a) 바뀌면 안 되는 블록이 그대로인가
  foreach v_key in array array['title', 'date', 'player_metadata', 'settlement_meta',
                               'total_matches', 'total_rounds'] loop
    if (v_cur -> v_key) is distinct from (v_next -> v_key) then
      return jsonb_build_object('ok', false, 'reason', 'structure_mismatch', 'field', v_key);
    end if;
  end loop;

  -- 9-b) snapshot_data: 길이 동일 + 대상 경기의 score1/score2 만 다르고 나머지 전부 동일
  if jsonb_array_length(coalesce(v_cur->'snapshot_data', '[]'::jsonb))
     is distinct from jsonb_array_length(coalesce(v_next->'snapshot_data', '[]'::jsonb)) then
    return jsonb_build_object('ok', false, 'reason', 'structure_mismatch', 'field', 'snapshot_data_length');
  end if;

  select count(*) into v_bad
    from jsonb_array_elements(v_cur->'snapshot_data')  with ordinality a(m, i)
    join jsonb_array_elements(v_next->'snapshot_data') with ordinality b(m, i) using (i)
   where case
           when a.m->>'id' = p_match_id then
             -- 대상 경기: score 2개만 바뀌어야 한다
             (a.m - 'score1' - 'score2') is distinct from (b.m - 'score1' - 'score2')
             or (b.m->>'score1')::int is distinct from p_score1
             or (b.m->>'score2')::int is distinct from p_score2
           else
             a.m is distinct from b.m
         end;
  if v_bad > 0 then
    return jsonb_build_object('ok', false, 'reason', 'structure_mismatch',
                              'field', 'snapshot_data', 'rows', v_bad);
  end if;

  -- 9-c) 참가자 명단(ranking_data id 집합)이 그대로인가
  if (select count(*) from (
        select m->>'id' as id from jsonb_array_elements(coalesce(v_cur->'ranking_data','[]'::jsonb)) m
        except all
        select m->>'id' from jsonb_array_elements(coalesce(v_next->'ranking_data','[]'::jsonb)) m
      ) d) > 0
     or (select count(*) from (
        select m->>'id' as id from jsonb_array_elements(coalesce(v_next->'ranking_data','[]'::jsonb)) m
        except all
        select m->>'id' from jsonb_array_elements(coalesce(v_cur->'ranking_data','[]'::jsonb)) m
      ) d) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'structure_mismatch', 'field', 'ranking_roster');
  end if;

  -- 9-d) settlement_data 길이 = ranking_data 길이
  v_n := jsonb_array_length(coalesce(v_next->'ranking_data', '[]'::jsonb));
  if v_n < 1 then
    return jsonb_build_object('ok', false, 'reason', 'structure_mismatch', 'field', 'ranking_empty');
  end if;
  if jsonb_array_length(coalesce(v_next->'settlement_data', '[]'::jsonb)) is distinct from v_n then
    return jsonb_build_object('ok', false, 'reason', 'structure_mismatch', 'field', 'settlement_length');
  end if;

  -- ── 10) 집계 독립 검증 (단순 합산 — 규칙 복제 아님) ─────────────────────
  --   patched snapshot_data 에서 선수별 승/패·득점·실점·득실을 다시 세어
  --   next 의 ranking_data · settlement_data 값과 완전히 일치하는지 확인한다.
  --   공식 집계 규칙: status='complete' + score1<>score2 만, [0,1]=team1.
  with slots as (
    select s.pid::text as pid,
           (s.ord - 1) as slot,
           (m.m->>'status') as status,
           coalesce((m.m->>'score1')::int, 0) as s1,
           coalesce((m.m->>'score2')::int, 0) as s2
      from jsonb_array_elements(v_next->'snapshot_data') m(m),
           jsonb_array_elements_text(
             case
               when jsonb_typeof(m.m->'player_ids') = 'array' then m.m->'player_ids'
               when jsonb_typeof(m.m->'playerIds')  = 'array' then m.m->'playerIds'
               else '[]'::jsonb
             end
           ) with ordinality s(pid, ord)
  ),
  counted as (
    select pid,
           sum(case when status='complete' and s1<>s2 then (case when slot<2 then s1 else s2 end) else 0 end)::int as pf,
           sum(case when status='complete' and s1<>s2 then (case when slot<2 then s2 else s1 end) else 0 end)::int as pa,
           count(*) filter (where status='complete' and s1<>s2
                              and ((slot<2 and s1>s2) or (slot>=2 and s2>s1)))::int as wins,
           count(*) filter (where status='complete' and s1<>s2
                              and ((slot<2 and s1<s2) or (slot>=2 and s2<s1)))::int as losses
      from slots
     group by pid
  ),
  expected as (
    select r.m->>'id' as pid,
           coalesce(c.wins, 0)   as wins,
           coalesce(c.losses, 0) as losses,
           coalesce(c.pf, 0)     as pf,
           coalesce(c.pa, 0)     as pa,
           coalesce(c.pf, 0) - coalesce(c.pa, 0) as diff
      from jsonb_array_elements(v_next->'ranking_data') r(m)
      left join counted c on c.pid = r.m->>'id'
  ),
  got_rank as (
    select r.m->>'id' as pid,
           coalesce((r.m->>'wins')::int, 0)   as wins,
           coalesce((r.m->>'losses')::int, 0) as losses,
           coalesce((r.m->>'diff')::int, 0)   as diff
      from jsonb_array_elements(v_next->'ranking_data') r(m)
  ),
  got_set as (
    select s.m->>'player_id' as pid,
           coalesce((s.m->>'wins')::int, 0)            as wins,
           coalesce((s.m->>'losses')::int, 0)          as losses,
           coalesce((s.m->>'points_for')::int, 0)      as pf,
           coalesce((s.m->>'points_against')::int, 0)  as pa,
           coalesce((s.m->>'diff')::int, 0)            as diff
      from jsonb_array_elements(v_next->'settlement_data') s(m)
  )
  select count(*) into v_bad
    from expected e
    left join got_rank gr on gr.pid = e.pid
    left join got_set  gs on gs.pid = e.pid
   where gr.pid is null or gs.pid is null
      or gr.wins <> e.wins or gr.losses <> e.losses or gr.diff <> e.diff
      or gs.wins <> e.wins or gs.losses <> e.losses
      or gs.pf   <> e.pf   or gs.pa     <> e.pa     or gs.diff <> e.diff;
  if v_bad > 0 then
    return jsonb_build_object('ok', false, 'reason', 'aggregate_mismatch', 'rows', v_bad);
  end if;

  -- ── 11) 순위 기본 불변식 ────────────────────────────────────────────────
  --   (승수 ↓, 득실 ↓) 비감소. ③ 연장자 순서는 SQL 이 판정하지 않는다
  --   (출생연도 SSoT 는 클라이언트의 officialRanking comparator 가 적용했다).
  select count(*) into v_bad
    from (
      select coalesce((r.m->>'wins')::int, 0) as w,
             coalesce((r.m->>'diff')::int, 0) as d,
             lag(coalesce((r.m->>'wins')::int, 0)) over (order by r.i) as prev_w,
             lag(coalesce((r.m->>'diff')::int, 0)) over (order by r.i) as prev_d
        from jsonb_array_elements(v_next->'ranking_data') with ordinality r(m, i)
    ) t
   where t.prev_w is not null
     and (t.w > t.prev_w or (t.w = t.prev_w and t.d > t.prev_d));
  if v_bad > 0 then
    return jsonb_build_object('ok', false, 'reason', 'order_not_monotonic', 'rows', v_bad);
  end if;

  -- settlement_data.rank 가 1..n 순서대로이고 ranking_data 순서와 같은가
  select count(*) into v_bad
    from jsonb_array_elements(v_next->'settlement_data') with ordinality s(m, i)
    join jsonb_array_elements(v_next->'ranking_data')   with ordinality r(m, i) using (i)
   where coalesce((s.m->>'rank')::int, -1) <> s.i
      or coalesce(s.m->>'player_id', '') <> coalesce(r.m->>'id', '');
  if v_bad > 0 then
    return jsonb_build_object('ok', false, 'reason', 'settlement_order_mismatch', 'rows', v_bad);
  end if;

  -- ── 12) 정산 금액 검증 ──────────────────────────────────────────────────
  -- ⚠ lib/kdk/settlement.ts(computeSettlement)의 거울. 둘 중 하나를 고치면 함께 고친다.
  --   bottomHalf = ceil(n/2), penaltyCount = ceil(bottomHalf/2), idx = rank-1
  --     idx = 0 and not guest → 상금 (prizes.first || 10000)
  --     idx >= n - penaltyCount → L2 = -(prizes.l2 || 5000)
  --     idx >= n - bottomHalf   → L1 = -(prizes.l1 || 3000)
  --   게스트비 = (is_guest or is_associate_guest_fee_member) ? -guest_fee : 0
  --   최종 = 상금 + 벌금 + 게스트비
  v_bottom    := ceil(v_n / 2.0)::int;
  v_pen_count := ceil(v_bottom / 2.0)::int;
  v_first     := coalesce(nullif((v_next->'settlement_meta'->'prizes'->>'first')::int, 0), 10000);
  v_l1        := coalesce(nullif((v_next->'settlement_meta'->'prizes'->>'l1')::int, 0), 3000);
  v_l2        := coalesce(nullif((v_next->'settlement_meta'->'prizes'->>'l2')::int, 0), 5000);
  v_guest_fee := coalesce((v_next->'settlement_meta'->>'guest_fee')::int, 0);

  -- 게스트 여부는 점수와 무관하게 불변이어야 한다(정정으로 바뀔 수 없다).
  select count(*) into v_bad
    from jsonb_array_elements(v_next->'settlement_data') n(m)
    join jsonb_array_elements(v_cur->'settlement_data')  o(m)
      on n.m->>'player_id' = o.m->>'player_id'
   where coalesce(n.m->>'is_guest', 'false') <> coalesce(o.m->>'is_guest', 'false')
      or coalesce(n.m->>'is_associate_guest_fee_member', 'false')
         <> coalesce(o.m->>'is_associate_guest_fee_member', 'false')
      or coalesce(n.m->>'player_name', '') <> coalesce(o.m->>'player_name', '');
  if v_bad > 0 then
    return jsonb_build_object('ok', false, 'reason', 'settlement_identity_changed', 'rows', v_bad);
  end if;

  select count(*) into v_bad
    from (
      select (s.m->>'rank')::int - 1 as idx,
             coalesce((s.m->>'is_guest')::boolean, false) as is_guest,
             coalesce((s.m->>'is_associate_guest_fee_member')::boolean, false) as assoc,
             coalesce((s.m->>'penalty_amount')::int, 0)   as got_pen,
             coalesce((s.m->>'prize_amount')::int, 0)     as got_prize,
             coalesce((s.m->>'guest_fee_amount')::int, 0) as got_gf,
             coalesce((s.m->>'final_amount')::int, 0)     as got_final,
             s.m->>'penalty_level'                        as got_level
        from jsonb_array_elements(v_next->'settlement_data') s(m)
    ) t
    , lateral (
      select
        case when t.idx = 0 and not t.is_guest then v_first else 0 end as exp_prize,
        case when t.idx >= v_n - v_pen_count then -v_l2
             when t.idx >= v_n - v_bottom    then -v_l1
             else 0 end as exp_pen,
        case when t.is_guest or t.assoc then -v_guest_fee else 0 end as exp_gf,
        case when t.idx >= v_n - v_pen_count then 'L2'
             when t.idx >= v_n - v_bottom    then 'L1'
             else null end as exp_level
    ) e
   where t.got_prize <> e.exp_prize
      or t.got_pen   <> e.exp_pen
      or t.got_gf    <> e.exp_gf
      or t.got_final <> (e.exp_prize + e.exp_pen + e.exp_gf)
      or coalesce(t.got_level, '') <> coalesce(e.exp_level, '');
  if v_bad > 0 then
    return jsonb_build_object('ok', false, 'reason', 'settlement_mismatch', 'rows', v_bad);
  end if;

  -- ── 13) 감사 로그 (pre-image 보존) ──────────────────────────────────────
  insert into public.kdk_archive_corrections (
    archive_id, match_id,
    before_score1, before_score2, after_score1, after_score2,
    reason, before_raw_data, impact, was_official, corrected_by
  ) values (
    v_row.id, p_match_id,
    v_before1, v_before2, p_score1, p_score2,
    btrim(p_reason), v_cur, coalesce(p_impact, '{}'::jsonb),
    coalesce(v_row.is_official, false), auth.uid()
  )
  returning id into v_corr_id;

  -- ── 14) raw_data 만 갱신 ────────────────────────────────────────────────
  -- ⚠ id / created_at / is_official / confirmed_at / confirmed_by / is_test /
  --   archive_type 은 SET 절에 없다. 다른 Archive row 도 건드리지 않는다.
  update public.teyeon_archive_v1
     set raw_data = v_next
   where id = v_row.id;

  -- ── 15) 결과 ────────────────────────────────────────────────────────────
  return jsonb_build_object(
    'ok',           true,
    'correctionId', v_corr_id,
    'archiveId',    v_row.id,
    'matchId',      p_match_id,
    'beforeScore1', v_before1,
    'beforeScore2', v_before2,
    'afterScore1',  p_score1,
    'afterScore2',  p_score2,
    'wasOfficial',  coalesce(v_row.is_official, false),
    'fingerprint',  md5(v_next::text)
  );
end;
$$;

comment on function public.correct_kdk_archive_match_score(text, text, integer, integer, text, text, jsonb, jsonb) is
  'KDK Archive 경기 점수 정정(원자적). CEO/ADMIN 전용. 감사 로그 + raw_data 갱신을 한 트랜잭션에서 수행. '
  '순위/정산 규칙은 클라이언트 SSoT(lib/kdk/*)가 계산하고 이 함수는 독립 검증만 한다. '
  'Archive lifecycle 컬럼과 Finance 데이터는 건드리지 않는다.';

-- 권한: PUBLIC·anon 전면 차단, authenticated 만 EXECUTE + 내부 is_full_admin() 재확인.
revoke all     on function public.correct_kdk_archive_match_score(text, text, integer, integer, text, text, jsonb, jsonb) from public;
revoke execute on function public.correct_kdk_archive_match_score(text, text, integer, integer, text, text, jsonb, jsonb) from anon;
grant  execute on function public.correct_kdk_archive_match_score(text, text, integer, integer, text, text, jsonb, jsonb) to authenticated;

-- ── 적용 확인 ───────────────────────────────────────────────────────────────
-- select to_regclass('public.kdk_archive_corrections');                       -- not null
-- select proname from pg_proc where proname in
--   ('get_kdk_archive_correction_context', 'correct_kdk_archive_match_score'); -- 2행
-- notify pgrst, 'reload schema';
