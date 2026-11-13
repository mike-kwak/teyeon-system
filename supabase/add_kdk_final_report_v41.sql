-- ============================================================================
-- TEYEON KDK FINAL REPORT V4.1 — 발행 이력 · 회원 전용 정산 스냅샷 · 정산 확인 기록(추가형)
--
--   전제: add_kdk_final_report.sql 적용 완료(kdk_final_reports · publish_kdk_final_report · kdk_spotlight_is_admin).
--   원칙:
--     · 기존 함수 본문 · 기존 테이블 · 기존 발행본(rev1)을 바꾸지 않는다. 새 객체만 만든다.
--     · 발행 이력은 kdk_final_reports 의 트리거가 남긴다 → 기존 발행 함수도 수정 없이 이력이 쌓인다.
--     · 정산 스냅샷은 공개본(public_payload)에 넣지 않는다. 별도 표 + 회원 전용 조회 함수만.
--     · 회원 판정은 profiles.role 만으로 하지 않는다: members 연결 · 클럽 역할 · 탈회를 DB 가 확인한다.
--     · 새 표는 insert-only(수정 · 삭제 · TRUNCATE 차단), anon/authenticated 직접 접근 없음.
--   실행: SQL Editor 에서 파일 전체를 한 번에(단일 요청 = 암묵 트랜잭션). 재실행해도 안전(idempotent).
-- ============================================================================

-- ── 0) 공통: insert-only 보호 ─────────────────────────────────────────────────
create or replace function public.kdk_fr_append_only_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'append_only: % is insert-only', tg_table_name using errcode = '42501';
end
$$;
revoke all on function public.kdk_fr_append_only_guard() from public, anon, authenticated;

-- ── 1) 발행 이력 ───────────────────────────────────────────────────────────────
create table if not exists public.kdk_final_report_revisions (
  report_id        uuid        not null,
  session_id       text        not null,
  revision         integer     not null check (revision >= 1),
  edition          integer     not null default 1,
  public_payload   jsonb       not null check (jsonb_typeof(public_payload) = 'object'),
  source_signature text,
  published_at     timestamptz,
  published_by     uuid,
  captured_at      timestamptz not null default now(),
  constraint kdk_final_report_revisions_pk primary key (report_id, revision)
);
comment on table public.kdk_final_report_revisions is
  'FINAL REPORT published revisions (insert-only). Trigger copies each new revision of kdk_final_reports. No public or member direct access.';
alter table public.kdk_final_report_revisions enable row level security;
revoke all on public.kdk_final_report_revisions from public, anon, authenticated;

drop trigger if exists kdk_fr_revisions_no_update on public.kdk_final_report_revisions;
create trigger kdk_fr_revisions_no_update before update or delete on public.kdk_final_report_revisions
  for each row execute function public.kdk_fr_append_only_guard();
drop trigger if exists kdk_fr_revisions_no_truncate on public.kdk_final_report_revisions;
create trigger kdk_fr_revisions_no_truncate before truncate on public.kdk_final_report_revisions
  for each statement execute function public.kdk_fr_append_only_guard();

create or replace function public.kdk_fr_edition_of(p jsonb)
returns integer language sql immutable set search_path = public, pg_temp as $$
  select case when coalesce(p->>'edition', '') ~ '^[0-9]{1,3}$' then (p->>'edition')::int else 1 end
$$;
revoke all on function public.kdk_fr_edition_of(jsonb) from public, anon, authenticated;

create or replace function public.kdk_fr_capture_revision()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.public_payload is not null and new.revision >= 1
     and (tg_op = 'INSERT' or new.revision is distinct from old.revision) then
    insert into public.kdk_final_report_revisions
      (report_id, session_id, revision, edition, public_payload, source_signature, published_at, published_by)
    values (new.id, new.session_id, new.revision, public.kdk_fr_edition_of(new.public_payload), new.public_payload,
            new.source_signature, new.published_at, new.published_by)
    on conflict (report_id, revision) do nothing;
  end if;
  return null;
end
$$;
revoke all on function public.kdk_fr_capture_revision() from public, anon, authenticated;

drop trigger if exists kdk_fr_capture_revision on public.kdk_final_reports;
create trigger kdk_fr_capture_revision after insert or update on public.kdk_final_reports
  for each row execute function public.kdk_fr_capture_revision();

-- 현재 발행본(예: 운영 rev1)을 이력에 복사만 한다(원본 행 무변경).
insert into public.kdk_final_report_revisions
  (report_id, session_id, revision, edition, public_payload, source_signature, published_at, published_by)
select r.id, r.session_id, r.revision, public.kdk_fr_edition_of(r.public_payload), r.public_payload,
       r.source_signature, r.published_at, r.published_by
  from public.kdk_final_reports r
 where r.public_payload is not null and r.revision >= 1
on conflict (report_id, revision) do nothing;

-- ── 2) 정산 확인 기록(참가자별 · insert-only) — 쓰기 기능은 별도 승인 전 없음 ───────
create table if not exists public.kdk_settlement_reviews (
  id               uuid        primary key default gen_random_uuid(),
  session_id       text        not null check (btrim(session_id) <> ''),
  participant_id   text        not null check (btrim(participant_id) <> ''),
  subject          text        not null default 'guest' check (subject in ('guest')),
  decision         text        not null check (decision in ('unpaid_confirmed', 'withdrawn')),
  basis            text        not null check (basis in ('bank_check', 'cash_check', 'other')),
  official_amount  integer     not null check (official_amount > 0),
  reviewed_at      timestamptz not null default now(),
  reviewed_by      uuid        not null
);
comment on table public.kdk_settlement_reviews is
  'Guest penalty unpaid-review events per participant (insert-only). UNPAID only when the latest event is unpaid_confirmed with matching amount and time. Writer RPC and UI need separate approval.';
create index if not exists kdk_settlement_reviews_session_idx on public.kdk_settlement_reviews (session_id, participant_id, reviewed_at desc);
alter table public.kdk_settlement_reviews enable row level security;
revoke all on public.kdk_settlement_reviews from public, anon, authenticated;
drop trigger if exists kdk_settlement_reviews_no_update on public.kdk_settlement_reviews;
create trigger kdk_settlement_reviews_no_update before update or delete on public.kdk_settlement_reviews
  for each row execute function public.kdk_fr_append_only_guard();
drop trigger if exists kdk_settlement_reviews_no_truncate on public.kdk_settlement_reviews;
create trigger kdk_settlement_reviews_no_truncate before truncate on public.kdk_settlement_reviews
  for each statement execute function public.kdk_fr_append_only_guard();

-- ── 2b) V4.1 운영 설정(정산 공개 기준일) — 운영자 승인 후 SQL Editor 에서만 설정 ───────────
--   settlement_live_from: 이 날짜(포함) 이후 공식 회차부터 실제 Finance · 게스트 납부 · 확인 기록으로 정산 스냅샷을 만든다.
--     이전 회차 = 레거시(운영 확인: 수납 완료) → 개인 행 · 금액 없이 안내만. 납부 기록을 만들지 않는다.
--   행이 없으면(미설정) 모든 회차가 'unconfigured' → 회원 화면에도 금액 · 명단을 표시하지 않는다.
create table if not exists public.kdk_final_report_settings (
  key         text        primary key check (key in ('settlement_live_from')),
  value_date  date,
  note        text        check (note is null or length(note) <= 200),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
comment on table public.kdk_final_report_settings is
  'FINAL REPORT V4.1 settings. settlement_live_from = settlement disclosure start date (set only via SQL Editor after operator approval; unset = no settlement shown).';
alter table public.kdk_final_report_settings enable row level security;
revoke all on public.kdk_final_report_settings from public, anon, authenticated;

-- ── 3) 정산 스냅샷(발행 판별 · insert-only · 회원 전용) ─────────────────────────
create table if not exists public.kdk_final_report_settlements (
  report_id    uuid        not null,
  revision     integer     not null check (revision >= 1),
  session_id   text        not null,
  mode         text        not null check (mode in ('live', 'legacy_closed', 'not_ready', 'none', 'unconfigured')),
  snapshot     jsonb       not null check (jsonb_typeof(snapshot) = 'object'),
  captured_at  timestamptz not null default now(),
  captured_by  uuid        not null,
  constraint kdk_final_report_settlements_pk primary key (report_id, revision)
);
comment on table public.kdk_final_report_settlements is
  'FINAL REPORT V4.1 settlement snapshot at publish time (insert-only). Separate from public payload; read only via member-only function.';
alter table public.kdk_final_report_settlements enable row level security;
revoke all on public.kdk_final_report_settlements from public, anon, authenticated;
drop trigger if exists kdk_fr_settlements_no_update on public.kdk_final_report_settlements;
create trigger kdk_fr_settlements_no_update before update or delete on public.kdk_final_report_settlements
  for each row execute function public.kdk_fr_append_only_guard();
drop trigger if exists kdk_fr_settlements_no_truncate on public.kdk_final_report_settlements;
create trigger kdk_fr_settlements_no_truncate before truncate on public.kdk_final_report_settlements
  for each statement execute function public.kdk_fr_append_only_guard();

-- ── 4) 정산 열람 자격 ──────────────────────────────────────────────────────────
--   허용: (a) profiles.role ∈ {CEO, ADMIN, FINANCE_MANAGER}  또는
--         (b) 연결된 members 행의 클럽 역할에 정회원 · 준회원 · 임원(회장 · 부회장 · 총무 · 재무 · 경기 · 섭외) · CEO 토큰
--   공통 거부: 연결된 members 행에 '탈회' 토큰. 연결: auth_user_id 우선, 연결 행이 하나도 없을 때만 로그인 이메일 exact.
--   OPERATOR · KDK 관리자 · profiles MEMBER/GUEST 는 그 자체로 허용하지 않는다.
create or replace function public.kdk_can_view_settlement(p_uid uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with linked as (
    select m.role from public.members m where m.auth_user_id = p_uid
  ), by_email as (
    select m.role from public.members m
     where not exists (select 1 from public.members l where l.auth_user_id = p_uid)
       and m.auth_user_id is null and m.email is not null
       and lower(btrim(m.email)) = (select lower(btrim(u.email)) from auth.users u where u.id = p_uid)
  ), toks as (
    select btrim(t.v) as tok
      from (select role from linked union all select role from by_email) c,
           unnest(string_to_array(coalesce(c.role, ''), ',')) t(v)
  )
  select p_uid is not null
     and not exists (select 1 from toks where tok = '탈회')
     and (exists (select 1 from public.profiles p where p.id = p_uid and upper(btrim(coalesce(p.role, ''))) in ('CEO', 'ADMIN', 'FINANCE_MANAGER'))
          or exists (select 1 from toks where tok in ('정회원', '준회원', '회장', '부회장', '총무', '재무', '경기', '섭외', 'CEO')))
$$;
revoke all on function public.kdk_can_view_settlement(uuid) from public, anon, authenticated;

-- ── 5) 스냅샷 형식 검사(발행 함수 내부용) ───────────────────────────────────────
--   반환: null = 정상, 그 외 = 거부 사유
create or replace function public.kdk_fr_settlement_problem(p jsonb)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare v_mode text; v_rows jsonb; v_t jsonb; r jsonb; c bigint := 0; pd bigint := 0; up bigint := 0; pe bigint := 0; n int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' or coalesce(p->>'schema', '') <> '1' then return 'shape'; end if;
  v_mode := coalesce(p->>'mode', '');
  if v_mode not in ('live', 'legacy_closed', 'not_ready', 'none', 'unconfigured') then return 'mode'; end if;
  v_rows := p->'rows'; v_t := p->'totals';
  if jsonb_typeof(v_rows) <> 'array' or jsonb_typeof(v_t) <> 'object' then return 'shape'; end if;
  if v_mode <> 'live' and jsonb_array_length(v_rows) > 0 then return 'rows_not_allowed'; end if;
  if jsonb_array_length(v_rows) > 300 then return 'too_many_rows'; end if;
  for r in select value from jsonb_array_elements(v_rows) loop
    n := n + 1;
    if jsonb_typeof(r) <> 'object' then return 'row_shape'; end if;
    if coalesce(r->>'status', '') not in ('PAID', 'UNPAID', 'PENDING', 'REVIEW') then return 'row_status'; end if;
    if coalesce(jsonb_typeof(r->'name'), '') <> 'string' or length(r->>'name') < 1 or length(r->>'name') > 40 then return 'row_name'; end if;
    if coalesce(jsonb_typeof(r->'guest'), '') <> 'boolean' then return 'row_guest'; end if;
    if coalesce(jsonb_typeof(r->'charged'), '') <> 'number' or coalesce(jsonb_typeof(r->'paid'), '') <> 'number' then return 'row_amount'; end if;
    if (r->>'charged') !~ '^[0-9]{1,9}$' or (r->>'paid') !~ '^[0-9]{1,9}$'
       or (r->>'paid')::bigint > (r->>'charged')::bigint then return 'row_amount'; end if;
    if r->>'status' = 'PAID' and (r->>'paid')::bigint <> (r->>'charged')::bigint then return 'row_paid'; end if;
    if r->>'status' in ('PENDING', 'REVIEW') and (r->>'paid')::bigint <> 0 then return 'row_pending_paid'; end if;
    if r->>'status' = 'PAID' then c := c + (r->>'charged')::bigint; pd := pd + (r->>'paid')::bigint;
    elsif r->>'status' = 'UNPAID' then c := c + (r->>'charged')::bigint; pd := pd + (r->>'paid')::bigint; up := up + (r->>'charged')::bigint - (r->>'paid')::bigint;
    elsif r->>'status' = 'PENDING' then c := c + (r->>'charged')::bigint; pe := pe + (r->>'charged')::bigint;
    end if;
  end loop;
  if coalesce((v_t->>'charged')::bigint, -1) <> c or coalesce((v_t->>'paid')::bigint, -1) <> pd
     or coalesce((v_t->>'unpaid')::bigint, -1) <> up or coalesce((v_t->>'pending')::bigint, -1) <> pe then return 'totals_mismatch'; end if;
  if c <> pd + up + pe then return 'identity'; end if;
  return null;
end
$$;
revoke all on function public.kdk_fr_settlement_problem(jsonb) from public, anon, authenticated;

-- ── 6) V4.1 편집 맥락(서버 전용): 과거 공식 기록 · 다음 정모 · 정산 원천 ─────────────
create or replace function public.get_kdk_final_report_v41_context(p_session_id text, p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_a record; v_raw jsonb; v_date text; v_hist jsonb; v_next jsonb := null; v_items jsonb; v_recv jsonb; v_guest jsonb := '[]'::jsonb;
  v_guest_ok boolean := false; v_link_ok boolean; v_reviews jsonb; v_members jsonb;
begin
  if not coalesce(public.kdk_spotlight_is_admin(p_actor), false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select a.id, a.raw_data into v_a from public.teyeon_archive_v1 a
   where a.id = p_session_id and coalesce(a.archive_type, '') = 'kdk' and a.is_official is true and a.is_test is not true;
  if v_a.id is null then return jsonb_build_object('ok', false, 'reason', 'not_official'); end if;
  v_raw := coalesce(v_a.raw_data, '{}'::jsonb);
  v_date := coalesce(v_raw->>'date', '');

  -- 공식 세션 전체(시험 제외): 날짜 · 순위(id · 승) · 완료 경기(id · 점수). 회차 · 라이벌 · 개인 기록 판정용(공개하지 않음).
  select coalesce(jsonb_agg(jsonb_build_object(
           'self', a.id = p_session_id,
           'date', coalesce(a.raw_data->>'date', ''),
           'ranking', coalesce((select jsonb_agg(jsonb_build_object('id', r.item->>'id', 'wins', r.item->'wins'))
                                  from jsonb_array_elements(case when jsonb_typeof(a.raw_data->'ranking_data') = 'array' then a.raw_data->'ranking_data' else '[]'::jsonb end) r(item)), '[]'::jsonb),
           'matches', coalesce((select jsonb_agg(jsonb_build_object('ids', coalesce(m.item->'player_ids', m.item->'playerIds'), 'score1', m.item->'score1', 'score2', m.item->'score2'))
                                  from jsonb_array_elements(case when jsonb_typeof(a.raw_data->'snapshot_data') = 'array' then a.raw_data->'snapshot_data' else '[]'::jsonb end) m(item)
                                 where m.item->>'status' = 'complete'), '[]'::jsonb))), '[]'::jsonb)
    into v_hist
    from public.teyeon_archive_v1 a
   where coalesce(a.archive_type, '') = 'kdk' and a.is_official is true and a.is_test is not true;

  -- 다음 정모(있을 때만): 리포트 날짜 이후 가장 가까운 '정모'
  if to_regclass('public.club_schedules') is not null and v_date ~ '^\d{4}-\d{2}-\d{2}$' then
    execute $q$ select jsonb_build_object('date', s.schedule_date::text, 'startTime', to_char(s.start_time, 'HH24:MI'))
                  from public.club_schedules s where s.schedule_type = '정모' and s.schedule_date > $1::date
                 order by s.schedule_date, s.start_time nulls last limit 1 $q$ into v_next using v_date;
  end if;

  -- 정산 원천: 공식 settlement_data(벌금 항목 원형) · 회원 id 확인 · 회원 청구 · 게스트 납부 · 확인 기록
  v_items := coalesce((select jsonb_agg(jsonb_build_object('playerId', s.item->'player_id', 'name', s.item->'player_name',
                         'isGuest', s.item->'is_guest', 'penalty', s.item->'penalty_amount'))
                         from jsonb_array_elements(case when jsonb_typeof(v_raw->'settlement_data') = 'array' then v_raw->'settlement_data' else '[]'::jsonb end) s(item)
                        where jsonb_typeof(s.item) = 'object'), '[]'::jsonb);
  select coalesce(jsonb_agg(m.id::text), '[]'::jsonb) into v_members from public.members m
   where m.id::text in (select s.item->>'player_id' from jsonb_array_elements(case when jsonb_typeof(v_raw->'settlement_data') = 'array' then v_raw->'settlement_data' else '[]'::jsonb end) s(item));
  v_link_ok := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_dues_receivables' and column_name = 'related_kdk_session_id');
  select coalesce(jsonb_agg(jsonb_build_object('memberId', j->>'member_id', 'amountDue', j->'amount_due', 'status', j->>'status',
           'paid', coalesce((select sum(case when coalesce(pj->>'amount', '') ~ '^[0-9]+(\.[0-9]+)?$' then (pj->>'amount')::numeric else 0 end)
                               from (select to_jsonb(p) pj from public.finance_dues_payments p) pp
                              where pj->>'receivable_id' = j->>'id' and coalesce(pj->>'is_voided', 'false') <> 'true'), 0))), '[]'::jsonb)
    into v_recv
    from (select to_jsonb(r) j from public.finance_dues_receivables r) t
   where j->>'receivable_type' = 'penalty' and j->>'related_kdk_session_id' = p_session_id;
  if to_regclass('public.kdk_guest_penalty_payments') is not null then
    v_guest_ok := true;
    execute $q$ select coalesce(jsonb_agg(jsonb_build_object('participantId', g.participant_id, 'status', g.status, 'amount', g.amount,
                  'paidAt', g.paid_at, 'cancelledAt', g.cancelled_at, 'updatedAt', g.updated_at)), '[]'::jsonb)
                  from public.kdk_guest_penalty_payments g where g.session_id = $1 and g.charge_type = 'penalty' $q$ into v_guest using p_session_id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('participantId', r.participant_id, 'decision', r.decision, 'officialAmount', r.official_amount, 'reviewedAt', r.reviewed_at)
                            order by r.reviewed_at), '[]'::jsonb)
    into v_reviews from public.kdk_settlement_reviews r where r.session_id = p_session_id;

  -- 현재 발행본 판형(없으면 null): V4.1(3)로 발행된 리포트만 재발행 때도 V4.1, 기존 v1/v2 발행본은 기존 경로 유지.
  return jsonb_build_object('ok', true, 'date', v_date, 'history', v_hist, 'next', v_next,
    'currentEdition', (select public.kdk_fr_edition_of(r.public_payload) from public.kdk_final_reports r
                        where r.session_id = p_session_id and r.public_payload is not null and r.revision >= 1),
    -- 정산 공개 기준일(미설정 = null → 정산 미표시)
    'settlementLiveFrom', (select to_char(s.value_date, 'YYYY-MM-DD') from public.kdk_final_report_settings s where s.key = 'settlement_live_from'),
    -- club_schedules 에는 확정 · 취소 상태가 없어 다음 정모 일정을 확정된 경기처럼 보여 줄 수 없다(편집기 참고용 후보만).
    'nextReliable', false,
    'settlement', jsonb_build_object(
      'hasData', jsonb_typeof(v_raw->'settlement_data') = 'array',
      'items', v_items, 'memberIds', v_members, 'financeLinkAvailable', v_link_ok, 'receivables', v_recv,
      'guestTableAvailable', v_guest_ok, 'guestPayments', v_guest, 'reviews', v_reviews));
end
$$;
revoke all on function public.get_kdk_final_report_v41_context(text, uuid) from public, anon, authenticated;
grant execute on function public.get_kdk_final_report_v41_context(text, uuid) to service_role;

-- ── 7) V4.1 발행(서버 전용): 기존 발행 함수 재사용 + 정산 스냅샷을 같은 트랜잭션에 저장 ──────
create or replace function public.publish_kdk_final_report_v41(
  p_session_id text, p_actor uuid, p_payload jsonb, p_signature text, p_expected_revision integer, p_settlement jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_res jsonb; v_rep public.kdk_final_reports%rowtype; v_problem text; v_txt text; v_raw jsonb; v_id text;
begin
  if not coalesce(public.kdk_spotlight_is_admin(p_actor), false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or public.kdk_fr_edition_of(p_payload) <> 3 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;
  -- 공개본에는 정산 · 금액 · 계좌 관련 키/단어가 있으면 안 된다(회원 전용 정보 분리).
  if p_payload::text ~* '(penalt|settle|벌금|정산|납부|미납|amount|account|계좌|charged|unpaid)' then
    return jsonb_build_object('ok', false, 'reason', 'payload_leak');
  end if;
  v_problem := public.kdk_fr_settlement_problem(p_settlement);
  if v_problem is not null then return jsonb_build_object('ok', false, 'reason', 'invalid_settlement', 'detail', v_problem); end if;
  -- 스냅샷에도 내부 id · 이메일 · 세션 id 는 넣지 않는다(이름 · 금액 · 상태만).
  v_txt := p_settlement::text;
  if v_txt ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]' or strpos(v_txt, p_session_id) > 0
     or v_txt ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' or v_txt ~* 'manual-guest-' then
    return jsonb_build_object('ok', false, 'reason', 'settlement_leak');
  end if;
  select a.raw_data into v_raw from public.teyeon_archive_v1 a where a.id = p_session_id;
  for v_id in select btrim(coalesce(s.item->>'player_id', '')) from jsonb_array_elements(
                 case when jsonb_typeof(v_raw->'settlement_data') = 'array' then v_raw->'settlement_data' else '[]'::jsonb end) s(item)
               where length(btrim(coalesce(s.item->>'player_id', ''))) >= 8 loop
    if strpos(v_txt, v_id) > 0 then return jsonb_build_object('ok', false, 'reason', 'settlement_leak'); end if;
  end loop;

  v_res := public.publish_kdk_final_report(p_session_id, p_actor, p_payload, p_signature, p_expected_revision);
  if coalesce(v_res->>'ok', 'false') <> 'true' then return v_res; end if;
  select * into v_rep from public.kdk_final_reports where session_id = p_session_id;
  insert into public.kdk_final_report_settlements (report_id, revision, session_id, mode, snapshot, captured_by)
  values (v_rep.id, v_rep.revision, p_session_id, p_settlement->>'mode', p_settlement, p_actor);
  return v_res || jsonb_build_object('settlementMode', p_settlement->>'mode');
end
$$;
revoke all on function public.publish_kdk_final_report_v41(text, uuid, jsonb, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.publish_kdk_final_report_v41(text, uuid, jsonb, text, integer, jsonb) to service_role;

-- ── 8) 회원 전용 정산 조회(로그인 사용자 본인 토큰 · auth.uid()) ─────────────────────
--   판정을 리포트 조회보다 먼저 한다 → 비허용자는 리포트 존재 · 정산 유무를 알 수 없다(단일 'forbidden').
create or replace function public.get_kdk_final_report_settlement(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_rep public.kdk_final_reports%rowtype; v_a record; v_set public.kdk_final_report_settlements%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'login_required'); end if;
  if not public.kdk_can_view_settlement(v_uid) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]{12,32}$' then return jsonb_build_object('ok', false, 'reason', 'not_available'); end if;
  select * into v_rep from public.kdk_final_reports where public_slug = p_slug and status = 'published';
  if v_rep.id is null then return jsonb_build_object('ok', false, 'reason', 'not_available'); end if;
  select a.id, a.raw_data, a.is_official, a.is_test, a.archive_type into v_a from public.teyeon_archive_v1 a where a.id = v_rep.session_id;
  if v_a.id is null or coalesce(v_a.archive_type, '') <> 'kdk' or v_a.is_official is not true or v_a.is_test is true
     or v_rep.source_signature is distinct from public.kdk_final_report_signature(coalesce(v_a.raw_data, '{}'::jsonb)) then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  select * into v_set from public.kdk_final_report_settlements where report_id = v_rep.id and revision = v_rep.revision;
  if v_set.report_id is null then return jsonb_build_object('ok', false, 'reason', 'not_available'); end if;
  return jsonb_build_object('ok', true, 'revision', v_rep.revision,
    'capturedAt', to_char(v_set.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'snapshot', v_set.snapshot);
end
$$;
revoke all on function public.get_kdk_final_report_settlement(text) from public, anon, authenticated;
grant execute on function public.get_kdk_final_report_settlement(text) to authenticated;
