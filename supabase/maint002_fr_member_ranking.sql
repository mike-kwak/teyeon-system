-- =============================================================================
-- MAINT-002 · KDK FINAL REPORT 회원 전용 순위 공개   [초안 · 사용자 승인 전 운영 실행 금지]
--   precheck: maint002_fr_member_ranking_precheck_READONLY.sql   verify: maint002_fr_member_ranking_verify_READONLY.sql
--   rollback: maint002_fr_member_ranking_rollback.sql
--
--   하는 일
--     1) get_public_kdk_final_report(p_slug) — 같은 서명 · 같은 권한(anon, authenticated) · 같은 상태 판정.
--        응답 payload 를 발행 원본(public_payload) 대신 "공개용 투영(allow-list 로 새로 만든 JSON)" 으로 바꾼다.
--        · 남기는 것: schema · edition · session(제목 · 날짜 · 참가 인원 · 경기 수) · 안전 판정을 통과한 opening/closing/headline ·
--          v41.vol · v41.numbers(kind · value 집계만) · v41.next · v41.layout · v41.closingTitle(안전 판정)
--        · 비우는 것: standings · podium(record 포함) · featured · highlights · v41.heroes/mentions/rivalry
--        · 응답에서 officialSessionId 제거(공개 화면의 정정 안내는 더 이상 공식 순위를 보여 주지 않음).
--     2) get_kdk_final_report_member(p_slug) — 신규 · authenticated 만 실행. auth.uid() 회원 자격 판정 후에만 발행 원본을 준다.
--     3) 보조 함수 4개(자격 · 이름 목록 · 문구 안전 판정 · 공개 투영) — public/anon/authenticated 실행 불가.
--
--   하지 않는 것: kdk_final_reports · teyeon_archive_v1 데이터 수정 없음(발행 원본 그대로), 표 · 정책 · 트리거 변경 없음,
--     정산(kdk_can_view_settlement · get_kdk_final_report_settlement) · 발행 · 편집 함수 무변경,
--     get_public_kdk_session · matches · Archive 권한 무변경(별도 백로그).
--
--   ⚠ 적용 순서: 새 프런트엔드(공개 투영 파서 포함)를 먼저 배포한 뒤 이 SQL 을 적용한다.
--     구 프런트엔드는 standings 가 빈 payload 를 not_found 로 처리한다(누출은 없지만 공개 링크가 "없음" 으로 보임).
--   SQL Editor 에서 파일 전체를 한 번에 실행(단일 요청 = 한 트랜잭션). 재실행 안전.
-- =============================================================================

do $pre$
begin
  if to_regclass('public.kdk_final_reports') is null then raise exception 'STOP M00: kdk_final_reports 없음 — add_kdk_final_report.sql 선적용 필요'; end if;
  if to_regclass('public.teyeon_archive_v1') is null then raise exception 'STOP M01: teyeon_archive_v1 없음'; end if;
  if to_regclass('public.members') is null then raise exception 'STOP M02: members 없음'; end if;
  if to_regprocedure('public.kdk_final_report_signature(jsonb)') is null then raise exception 'STOP M03: kdk_final_report_signature(jsonb) 없음'; end if;
  if to_regprocedure('public.get_public_kdk_final_report(text)') is null then raise exception 'STOP M04: get_public_kdk_final_report(text) 없음'; end if;
  if to_regprocedure('auth.uid()') is null then raise exception 'STOP M05: auth.uid() 없음'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'club_id') then
    raise exception 'STOP M06: members.club_id 없음';
  end if;
end
$pre$;

-- ── 1) 순위 열람 자격(정산 자격과 분리) ──────────────────────────────────────────
--   허용: members.auth_user_id = p_uid 로 연결되고 club_id 가 리포트 클럽(p_club_id)과 같은 행의 클럽 역할에
--         정회원 · 준회원 · 임원(회장 · 부회장 · 총무 · 재무 · 경기 · 섭외) · CEO 토큰. p_club_id 가 null 이면 클럽 무관(리포트 조회 전 1차 판정용).
--   거부: 연결 행 어디든(클럽 무관) '탈회' 토큰(다른 역할보다 우선) · 연결 행 없음 · 다른 클럽 · 게스트 · 알 수 없는 역할.
--   profiles.role(CEO · ADMIN · OPERATOR 등)만으로는 허용하지 않는다. 이메일 fallback 없음.
create or replace function public.kdk_fr_can_view_ranking(p_uid uuid, p_club_id text default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with toks as (
    select btrim(t.v) as tok, (p_club_id is null or m.club_id::text = p_club_id) as in_club
      from public.members m
      cross join lateral unnest(string_to_array(coalesce(m.role, ''), ',')) as t(v)
     where p_uid is not null and m.auth_user_id = p_uid
  )
  select p_uid is not null
     and not exists (select 1 from toks where tok = '탈회')
     and exists (select 1 from toks where in_club and tok in ('정회원', '준회원', '회장', '부회장', '총무', '재무', '경기', '섭외', 'CEO'))
$$;
comment on function public.kdk_fr_can_view_ranking(uuid, text) is
  'MAINT-002: FINAL REPORT 순위 열람 자격. members.auth_user_id 연결 + 같은 클럽 + 정·준·임원 토큰, 탈회 우선 거부. profiles · 이메일 미사용.';
revoke all on function public.kdk_fr_can_view_ranking(uuid, text) from public, anon, authenticated;

-- ── 2) 참가자 이름 목록(공개 문구 안전 판정용) ───────────────────────────────────
--   발행 원본 + 공식 Archive 의 이름을 모은다. (G) 표시 제거 · 공백 제거(띄어쓰기 변형 대응) · 2글자 이상만.
--   한글 3~4글자 이름은 성을 뺀 이름(예: 김가람 → 가람)도 넣는다(이름만 부르는 문구 대응 · 오탐은 문구 미공개 = 안전 측).
create or replace function public.kdk_fr_public_names(p_payload jsonb, p_raw jsonb)
returns text[] language sql immutable set search_path = public, pg_temp as $$
  with arr(a) as (
    select case when jsonb_typeof(p_payload->'standings') = 'array' then p_payload->'standings' else '[]'::jsonb end
    union all select case when jsonb_typeof(p_payload->'podium') = 'array' then p_payload->'podium' else '[]'::jsonb end
    union all select case when jsonb_typeof(p_payload->'v41'->'heroes') = 'array' then p_payload->'v41'->'heroes' else '[]'::jsonb end
    union all select case when jsonb_typeof(p_payload->'v41'->'mentions') = 'array' then p_payload->'v41'->'mentions' else '[]'::jsonb end
    union all select case when jsonb_typeof(p_raw->'ranking_data') = 'array' then p_raw->'ranking_data' else '[]'::jsonb end
  ), teams(a) as (
    select case when jsonb_typeof(f->'teamA') = 'array' then f->'teamA' else '[]'::jsonb end
        || case when jsonb_typeof(f->'teamB') = 'array' then f->'teamB' else '[]'::jsonb end
      from jsonb_array_elements(case when jsonb_typeof(p_payload->'featured') = 'array' then p_payload->'featured' else '[]'::jsonb end) f
    union all
    select case when jsonb_typeof(m->'player_names') = 'array' then m->'player_names' else '[]'::jsonb end
      from jsonb_array_elements(case when jsonb_typeof(p_raw->'snapshot_data') = 'array' then p_raw->'snapshot_data' else '[]'::jsonb end) m
  ), raw_names(x) as (
    select e->>'name' from arr, jsonb_array_elements(arr.a) e where jsonb_typeof(e) = 'object'
    union all
    select t from teams, jsonb_array_elements_text(teams.a) t
  ), cleaned(n) as (
    select regexp_replace(regexp_replace(x, '\s*\([Gg]\)\s*$', ''), '\s+', '', 'g') from raw_names where x is not null
  ), variants(n) as (
    select n from cleaned
    union all
    select substr(n, 2) from cleaned where n ~ '^[가-힣]{3,4}$'
  )
  select coalesce(array_agg(distinct n), '{}'::text[]) from variants where char_length(n) >= 2
$$;
revoke all on function public.kdk_fr_public_names(jsonb, jsonb) from public, anon, authenticated;

-- ── 3) 공개 문구 안전 판정 ────────────────────────────────────────────────────────
--   참가자 이름(공백 무시 · 성 뺀 이름 포함) · (G) 표시 · 경기 점수 형태(한 자리:한 자리, 예 6:5 · 6-4)가 있으면 공개하지 않는다(null).
--   시각(08:00)은 통과. 한계: 별명 · 직함(예: '막내', '총무님') · 이름 없는 서술로 특정하는 문구는 판정하지 못한다.
create or replace function public.kdk_fr_public_text(p_text text, p_names text[], p_max integer)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare v text := btrim(coalesce(p_text, '')); v_compact text; n text;
begin
  if v = '' then return null; end if;
  if v ~ '(^|[^0-9])[0-9]\s*[:：\-–—]\s*[0-9]([^0-9]|$)' then return null; end if;
  if v ~ '\([Gg]\)' then return null; end if;
  v_compact := regexp_replace(v, '\s+', '', 'g');
  foreach n in array coalesce(p_names, '{}'::text[]) loop
    if strpos(v_compact, n) > 0 then return null; end if;
  end loop;
  return left(v, greatest(1, p_max));
end
$$;
revoke all on function public.kdk_fr_public_text(text, text[], integer) from public, anon, authenticated;

-- ── 4) 공개 투영(allow-list 로 새 JSON 을 만든다 — 원본 키를 지우는 방식이 아님) ─────────────
create or replace function public.kdk_fr_public_view(p_payload jsonb, p_raw jsonb)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_names text[] := public.kdk_fr_public_names(coalesce(p_payload, '{}'::jsonb), coalesce(p_raw, '{}'::jsonb));
  v_s jsonb := case when jsonb_typeof(p_payload->'session') = 'object' then p_payload->'session' else '{}'::jsonb end;
  v_ed integer := case when p_payload->>'edition' in ('2', '3') and jsonb_typeof(p_payload->'edition') = 'number' then (p_payload->>'edition')::int end;
  v_x jsonb := case when jsonb_typeof(p_payload->'v41') = 'object' then p_payload->'v41' else null end;
  v_out jsonb; v_v41 jsonb; v_nums jsonb; v_next jsonb := null;
begin
  v_out := jsonb_build_object(
    'schema', 1,
    'access', 'public',
    'session', jsonb_build_object(
      -- 세션명에 참가자 이름이 있으면(공백 무시) 일반 제목으로 바꾼다.
      'title', case when exists (select 1 from unnest(v_names) nm where strpos(regexp_replace(coalesce(v_s->>'title', ''), '\s+', '', 'g'), nm) > 0)
                    then 'TEYEON KDK' else left(coalesce(v_s->>'title', ''), 80) end,
      'date', left(coalesce(v_s->>'date', ''), 20),
      'officialConfirmed', true,
      'participantCount', case when coalesce(v_s->>'participantCount', '') ~ '^[0-9]{1,4}$' then (v_s->>'participantCount')::int else 0 end,
      'matchCount', case when coalesce(v_s->>'matchCount', '') ~ '^[0-9]{1,4}$' then (v_s->>'matchCount')::int else 0 end),
    'opening', public.kdk_fr_public_text(p_payload->>'opening', v_names, 60),
    'closing', public.kdk_fr_public_text(p_payload->>'closing', v_names, 90),
    'podium', '[]'::jsonb, 'featured', '[]'::jsonb, 'standings', '[]'::jsonb);
  if v_ed is not null then
    v_out := v_out || jsonb_build_object('edition', v_ed, 'headline', public.kdk_fr_public_text(p_payload->>'headline', v_names, 40), 'highlights', '[]'::jsonb);
  end if;
  if v_ed = 3 and v_x is not null then
    select coalesce(jsonb_agg(jsonb_build_object('kind', e->>'kind', 'value', (e->>'value')::int) order by o), '[]'::jsonb) into v_nums
      from jsonb_array_elements(case when jsonb_typeof(v_x->'numbers') = 'array' then v_x->'numbers' else '[]'::jsonb end) with ordinality as n(e, o)
     where o <= 4 and e->>'kind' in ('MATCHES', 'ONE_POINT', 'SHUTOUTS', 'GUESTS') and coalesce(e->>'value', '') ~ '^[0-9]{1,4}$';
    if jsonb_typeof(v_x->'next') = 'object' and coalesce(v_x->'next'->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then
      v_next := jsonb_build_object('date', v_x->'next'->>'date',
        'startTime', case when coalesce(v_x->'next'->>'startTime', '') ~ '^\d{2}:\d{2}$' then v_x->'next'->>'startTime' end);
    end if;
    v_v41 := jsonb_build_object(
      'vol', case when coalesce(v_x->>'vol', '') ~ '^[0-9]{1,4}$' then (v_x->>'vol')::int end,
      'heroes', '[]'::jsonb, 'mentions', '[]'::jsonb, 'rivalry', null, 'numbers', v_nums, 'next', v_next);
    if v_x->'layout' = '2'::jsonb then
      v_v41 := v_v41 || jsonb_build_object('layout', 2, 'closingTitle', public.kdk_fr_public_text(v_x->>'closingTitle', v_names, 30));
    end if;
    v_out := v_out || jsonb_build_object('v41', v_v41);
  end if;
  return v_out;
end
$$;
revoke all on function public.kdk_fr_public_view(jsonb, jsonb) from public, anon, authenticated;

-- ── 5) 공개 조회(anon) — 같은 서명 · 같은 상태 판정, payload 만 공개 투영 · officialSessionId 미반환 ──────
create or replace function public.get_public_kdk_final_report(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rep public.kdk_final_reports%rowtype; v_a record; v_raw jsonb;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]{12,32}$' then return jsonb_build_object('ok', false, 'state', 'not_found'); end if;
  select * into v_rep from public.kdk_final_reports where public_slug = p_slug and status = 'published';
  if v_rep.id is null then return jsonb_build_object('ok', false, 'state', 'not_found'); end if;
  select a.id, a.raw_data, a.is_official, a.is_test, a.archive_type into v_a from public.teyeon_archive_v1 a where a.id = v_rep.session_id;
  if v_a.id is null or coalesce(v_a.archive_type, '') <> 'kdk' or v_a.is_official is not true or v_a.is_test is true then
    return jsonb_build_object('ok', false, 'state', 'not_found');
  end if;
  v_raw := coalesce(v_a.raw_data, '{}'::jsonb);
  if v_rep.source_signature is distinct from public.kdk_final_report_signature(v_raw) then
    return jsonb_build_object('ok', true, 'state', 'corrected',
      'title', coalesce(public.kdk_fr_public_view(v_rep.public_payload, v_raw)->'session'->>'title', ''), 'date', coalesce(v_rep.public_payload->'session'->>'date', ''));
  end if;
  return jsonb_build_object('ok', true, 'state', 'ok', 'access', 'public', 'payload', public.kdk_fr_public_view(v_rep.public_payload, v_raw),
    'revision', v_rep.revision,
    'publishedAt', to_char(v_rep.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end
$$;
revoke all on function public.get_public_kdk_final_report(text) from public;
grant execute on function public.get_public_kdk_final_report(text) to anon, authenticated;

-- ── 6) 회원 전용 조회(authenticated · auth.uid()) ─────────────────────────────────
--   자격 판정을 리포트 조회보다 먼저 한다 → 비허용자는 리포트 존재 여부도 알 수 없다(단일 'forbidden').
create or replace function public.get_kdk_final_report_member(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_rep public.kdk_final_reports%rowtype; v_a record; v_raw jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'login_required'); end if;
  if not public.kdk_fr_can_view_ranking(v_uid) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]{12,32}$' then return jsonb_build_object('ok', false, 'reason', 'not_available'); end if;
  select * into v_rep from public.kdk_final_reports where public_slug = p_slug and status = 'published';
  if v_rep.id is null then return jsonb_build_object('ok', false, 'reason', 'not_available'); end if;
  -- 클럽 범위: 리포트 클럽의 회원만(다른 클럽 회원 · club_id 불일치 → 같은 'forbidden').
  if not public.kdk_fr_can_view_ranking(v_uid, v_rep.club_id) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select a.id, a.raw_data, a.is_official, a.is_test, a.archive_type into v_a from public.teyeon_archive_v1 a where a.id = v_rep.session_id;
  if v_a.id is null or coalesce(v_a.archive_type, '') <> 'kdk' or v_a.is_official is not true or v_a.is_test is true then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  v_raw := coalesce(v_a.raw_data, '{}'::jsonb);
  if v_rep.source_signature is distinct from public.kdk_final_report_signature(v_raw) then
    return jsonb_build_object('ok', true, 'state', 'corrected',
      'title', coalesce(v_rep.public_payload->'session'->>'title', ''), 'date', coalesce(v_rep.public_payload->'session'->>'date', ''),
      'officialSessionId', v_rep.session_id);
  end if;
  return jsonb_build_object('ok', true, 'state', 'ok', 'access', 'member', 'payload', v_rep.public_payload, 'revision', v_rep.revision,
    'publishedAt', to_char(v_rep.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end
$$;
comment on function public.get_kdk_final_report_member(text) is
  'MAINT-002: FINAL REPORT 회원 전용 전체 발행본. authenticated 만 · auth.uid() 자격(kdk_fr_can_view_ranking) 판정 후에만 반환.';
revoke all on function public.get_kdk_final_report_member(text) from public, anon, authenticated;
grant execute on function public.get_kdk_final_report_member(text) to authenticated;
