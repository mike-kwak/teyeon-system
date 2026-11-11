-- =============================================================================
-- TEYEON KDK FINAL REPORT — P1 데이터 기반   [초안 · 승인 전 운영 실행 금지]
--   rollback: add_kdk_final_report_rollback.sql   확인: add_kdk_final_report_verify_READONLY.sql
--
--   원칙
--     · 원본은 teyeon_archive_v1(공식 · 비테스트 · kdk). 이 파일은 Archive · Ranking · Finance · SPOTLIGHT 표를 바꾸지 않는다.
--     · 공식 순위는 raw_data.ranking_data 의 저장 순서 그대로(재계산 · 재정렬 없음).
--     · 신규 표 kdk_final_reports: RLS 켜짐 + anon/authenticated 권한 전부 회수 → 직접 SELECT/쓰기 불가.
--     · 쓰기 · 운영진 조회 RPC 는 service_role 전용(서버 route 가 사용자 토큰 검증 후 p_actor 로 호출) +
--       함수 안에서 kdk_spotlight_is_admin(p_actor)(CEO · ADMIN · kdk_managers 등재 KDK 관리자) 재검사.
--     · 공개 RPC(get_public_kdk_final_report)만 anon 실행 — 발행본(allow-list payload)만, 열람 때마다
--       Archive 공식 상태 + 기록 지문(source signature)을 다시 확인한다.
--     · 선수 이름: 기존 /club/kdk 공식 결과와 같이 전원 표시(2026-11-11 확정). 프로필 공개 설정은 공식 결과와
--       구분하므로 회원 프로필 설정 변경은 리포트를 정정 상태로 만들지 않는다(공개 범위 지문 없음).
--
--   기록 지문(kdk_final_report_signature) — 'v1:' || md5(정규화 JSON)
--     포함: title · date(btrim) / ranking_data 저장 순서대로 [선수 키, 표시명, 승, 패, 득실, 조] /
--           status='complete' 경기를 경기 id 순으로 [id, 라운드, 코트, 조, A팀 키(정렬), B팀 키(정렬),
--           A팀 이름(정렬), B팀 이름(정렬), score1, score2]
--     정규화: 숫자는 3 · "3" · 3.0 을 같은 정수로 · 문자열 앞뒤 공백 제거 · 조는 A/B/'' ·
--             선수 키 = id(공백 제거) 없으면 'nm:'+소문자 이름 · 경기 배열 순서 · 팀 안 선수 순서 무관.
--     제외: 정산 · player_metadata(조 외) · 아바타 · 확정자 · 진행 중 경기 → 이런 변경은 지문을 바꾸지 않는다.
--   문장 1개씩 · 재실행 안전(create or replace / if not exists).
-- =============================================================================

-- ── 0) 선행 조건(없으면 STOP · 무변경) ─────────────────────────────────────────
do $pre$
begin
  if to_regclass('public.teyeon_archive_v1') is null then raise exception 'STOP FR00: teyeon_archive_v1 없음'; end if;
  if to_regprocedure('public.kdk_spotlight_is_admin(uuid)') is null then
    raise exception 'STOP FR00: kdk_spotlight_is_admin(uuid) 없음 — MATCH SPOTLIGHT SQL 선적용 필요';
  end if;
end
$pre$;

-- ── 1) 표 ─────────────────────────────────────────────────────────────────────
create table if not exists public.kdk_final_reports (
    id                   uuid        primary key default gen_random_uuid(),
    club_id              text        not null,
    session_id           text        not null,
    public_slug          text        not null check (public_slug ~ '^[a-z0-9]{12,32}$'),
    status               text        not null default 'draft' check (status in ('draft','published','unpublished')),
    revision             integer     not null default 0 check (revision >= 0),        -- 0 = 아직 발행 전
    content              jsonb       not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
    public_payload       jsonb       check (public_payload is null or jsonb_typeof(public_payload) = 'object'),
    source_signature     text,
    created_at           timestamptz not null default now(),
    created_by           uuid        not null,
    updated_at           timestamptz not null default now(),
    updated_by           uuid        not null,
    published_at         timestamptz,
    published_by         uuid,
    unpublished_at       timestamptz,
    unpublished_by       uuid,
    constraint kdk_final_reports_session_uniq unique (session_id),
    constraint kdk_final_reports_slug_uniq unique (public_slug),
    constraint kdk_final_reports_published_ok check (status <> 'published' or (public_payload is not null and source_signature is not null and revision >= 1))
);
comment on table public.kdk_final_reports is
    'KDK FINAL REPORT. 세션당 1행 · slug 고정 · 재발행마다 revision+1. 쓰기는 service_role RPC 만. content = 운영진 입력(비공개 원본), public_payload = 발행본(allow-list).';
alter table public.kdk_final_reports enable row level security;
revoke all on public.kdk_final_reports from public, anon, authenticated;

-- ── 2) 정규화 helper + 기록 지문 ───────────────────────────────────────────────
create or replace function public.kdk_fr_int(p jsonb)
returns integer language sql immutable set search_path = public, pg_temp as $$
  select case jsonb_typeof(p)
           when 'number' then case when (p::text)::numeric = trunc((p::text)::numeric) then (p::text)::numeric::integer end
           when 'string' then case when btrim(p #>> '{}') ~ '^-?[0-9]{1,9}(\.0+)?$' then btrim(p #>> '{}')::numeric::integer end
         end
$$;

create or replace function public.kdk_fr_group(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when upper(coalesce(p, '')) like '%B%' or upper(coalesce(p, '')) like '%BLUE%' then 'B'
              when upper(coalesce(p, '')) like '%A%' or upper(coalesce(p, '')) like '%GOLD%' then 'A'
              else '' end
$$;

create or replace function public.kdk_fr_key(p_id text, p_name text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when nullif(btrim(coalesce(p_id, '')), '') is not null then btrim(p_id)
              when nullif(btrim(coalesce(p_name, '')), '') is not null then 'nm:' || lower(btrim(p_name))
              else '' end
$$;

create or replace function public.kdk_final_report_signature(p_raw jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
  with src as (
    select coalesce(p_raw, '{}'::jsonb) as raw
  ), rk as (
    select coalesce(jsonb_agg(jsonb_build_array(
             public.kdk_fr_key(r.item->>'id', r.item->>'name'),
             btrim(coalesce(r.item->>'name', '')),
             public.kdk_fr_int(r.item->'wins'), public.kdk_fr_int(r.item->'losses'), public.kdk_fr_int(r.item->'diff'),
             public.kdk_fr_group(coalesce(r.item->>'group', (select raw from src)->'player_metadata'->(btrim(coalesce(r.item->>'id', '')))->>'group'))
           ) order by r.ord), '[]'::jsonb) as v
      from src, jsonb_array_elements(case when jsonb_typeof(src.raw->'ranking_data') = 'array' then src.raw->'ranking_data' else '[]'::jsonb end)
           with ordinality as r(item, ord)
  ), mt as (
    select m.item, m.ord,
           case when jsonb_typeof(m.item->'player_ids') = 'array' then m.item->'player_ids'
                when jsonb_typeof(m.item->'playerIds') = 'array' then m.item->'playerIds' else '[]'::jsonb end as ids,
           case when jsonb_typeof(m.item->'player_names') = 'array' then m.item->'player_names'
                when jsonb_typeof(m.item->'playerNames') = 'array' then m.item->'playerNames' else '[]'::jsonb end as names
      from src, jsonb_array_elements(case when jsonb_typeof(src.raw->'snapshot_data') = 'array' then src.raw->'snapshot_data' else '[]'::jsonb end)
           with ordinality as m(item, ord)
     where m.item->>'status' = 'complete'
  ), mk as (
    select coalesce(jsonb_agg(jsonb_build_array(
             btrim(coalesce(mt.item->>'id', '')),
             public.kdk_fr_int(mt.item->'round'), public.kdk_fr_int(mt.item->'court'),
             public.kdk_fr_group(coalesce(mt.item->>'group_name', mt.item->>'groupName', mt.item->>'group')),
             (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from (select btrim(coalesce(mt.ids->>0, '')) as x union all select btrim(coalesce(mt.ids->>1, ''))) a),
             (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from (select btrim(coalesce(mt.ids->>2, '')) as x union all select btrim(coalesce(mt.ids->>3, ''))) b),
             (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from (select btrim(coalesce(mt.names->>0, '')) as x union all select btrim(coalesce(mt.names->>1, ''))) c),
             (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from (select btrim(coalesce(mt.names->>2, '')) as x union all select btrim(coalesce(mt.names->>3, ''))) d),
             public.kdk_fr_int(mt.item->'score1'), public.kdk_fr_int(mt.item->'score2')
           ) order by btrim(coalesce(mt.item->>'id', '')), mt.ord), '[]'::jsonb) as v
      from mt
  )
  select 'v1:' || md5(jsonb_build_array(
           btrim(coalesce((select raw from src)->>'title', '')),
           btrim(coalesce((select raw from src)->>'date', '')),
           (select v from rk), (select v from mk))::text)
$$;

revoke all on function public.kdk_fr_int(jsonb), public.kdk_fr_group(text), public.kdk_fr_key(text, text),
  public.kdk_final_report_signature(jsonb) from public, anon, authenticated;
grant execute on function public.kdk_fr_int(jsonb), public.kdk_fr_group(text), public.kdk_fr_key(text, text),
  public.kdk_final_report_signature(jsonb) to service_role;

-- ── 3) 운영진 조회(원본 최소 투영 + 지문 + 리포트) — service_role 전용 ───────────────
--   원본 투영: ranking_data(id · name · wins · losses · diff · group) · 완료/미완료 경기(id · round · court · group ·
--   status · player_ids · player_names · score1 · score2) · player_metadata 의 조만. 정산 · 출생연도 · 아바타 · 확정자 미포함.
create or replace function public.get_kdk_final_report_source(p_session_id text, p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_a record; v_rep public.kdk_final_reports%rowtype; v_raw jsonb;
begin
  if not coalesce(public.kdk_spotlight_is_admin(p_actor), false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_session_id is null or length(p_session_id) = 0 or length(p_session_id) > 80 then return jsonb_build_object('ok', false, 'reason', 'invalid_session'); end if;
  select a.id, a.raw_data, a.is_official, a.is_test, a.archive_type, a.confirmed_at into v_a
    from public.teyeon_archive_v1 a where a.id = p_session_id;
  if v_a.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  v_raw := coalesce(v_a.raw_data, '{}'::jsonb);
  select * into v_rep from public.kdk_final_reports where session_id = p_session_id;
  return jsonb_build_object(
    'ok', true,
    'archive', jsonb_build_object(
      'id', v_a.id, 'archiveType', coalesce(v_a.archive_type, ''), 'isOfficial', coalesce(v_a.is_official, false), 'isTest', coalesce(v_a.is_test, false),
      'confirmedAt', v_a.confirmed_at, 'title', coalesce(v_raw->>'title', ''), 'date', coalesce(v_raw->>'date', ''),
      'rankingData', coalesce((select jsonb_agg(jsonb_build_object('id', r.item->'id', 'name', r.item->'name', 'wins', r.item->'wins',
                                 'losses', r.item->'losses', 'diff', r.item->'diff', 'group', r.item->'group') order by r.ord)
                               from jsonb_array_elements(case when jsonb_typeof(v_raw->'ranking_data') = 'array' then v_raw->'ranking_data' else '[]'::jsonb end)
                                    with ordinality r(item, ord)), '[]'::jsonb),
      'snapshotData', coalesce((select jsonb_agg(jsonb_build_object('id', m.item->'id', 'round', m.item->'round', 'court', m.item->'court',
                                 'group_name', coalesce(m.item->'group_name', m.item->'groupName', m.item->'group'), 'status', m.item->'status',
                                 'player_ids', coalesce(m.item->'player_ids', m.item->'playerIds'), 'player_names', coalesce(m.item->'player_names', m.item->'playerNames'),
                                 'score1', m.item->'score1', 'score2', m.item->'score2') order by m.ord)
                                from jsonb_array_elements(case when jsonb_typeof(v_raw->'snapshot_data') = 'array' then v_raw->'snapshot_data' else '[]'::jsonb end)
                                     with ordinality m(item, ord)), '[]'::jsonb),
      'playerGroups', coalesce((select jsonb_object_agg(e.key, e.value->'group') from jsonb_each(
                                  case when jsonb_typeof(v_raw->'player_metadata') = 'object' then v_raw->'player_metadata' else '{}'::jsonb end) e
                                where jsonb_typeof(e.value) = 'object' and e.value ? 'group'), '{}'::jsonb)),
    'signature', public.kdk_final_report_signature(v_raw),
    'report', case when v_rep.id is null then null else jsonb_build_object(
      'status', v_rep.status, 'publicSlug', v_rep.public_slug, 'revision', v_rep.revision, 'content', v_rep.content,
      'sourceSignature', v_rep.source_signature,
      'updatedAt', v_rep.updated_at, 'publishedAt', v_rep.published_at, 'unpublishedAt', v_rep.unpublished_at) end);
end
$$;

-- ── 4) 초안 저장(공개본 무변경) ────────────────────────────────────────────────
create or replace function public.save_kdk_final_report_draft(
  p_club_id text, p_session_id text, p_actor uuid, p_content jsonb, p_new_slug text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a record; v_rep public.kdk_final_reports%rowtype;
begin
  perform set_config('lock_timeout', '3s', true);
  if not coalesce(public.kdk_spotlight_is_admin(p_actor), false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' or pg_column_size(p_content) > 16384 then return jsonb_build_object('ok', false, 'reason', 'invalid_content'); end if;
  select a.id, a.is_official, a.is_test, a.archive_type into v_a from public.teyeon_archive_v1 a where a.id = p_session_id;
  if v_a.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if coalesce(v_a.archive_type, '') <> 'kdk' or v_a.is_official is not true or v_a.is_test is true then
    return jsonb_build_object('ok', false, 'reason', 'not_official');
  end if;
  select * into v_rep from public.kdk_final_reports where session_id = p_session_id for update;
  if v_rep.id is null then
    if p_new_slug is null or p_new_slug !~ '^[a-z0-9]{12,32}$' then return jsonb_build_object('ok', false, 'reason', 'invalid_slug'); end if;
    insert into public.kdk_final_reports (club_id, session_id, public_slug, content, created_by, updated_by)
    values (p_club_id, p_session_id, p_new_slug, p_content, p_actor, p_actor) returning * into v_rep;
  else
    update public.kdk_final_reports set content = p_content, updated_at = now(), updated_by = p_actor
     where id = v_rep.id returning * into v_rep;
  end if;
  return jsonb_build_object('ok', true, 'reason', 'saved', 'status', v_rep.status, 'publicSlug', v_rep.public_slug, 'revision', v_rep.revision);
end
$$;

-- ── 5) 발행(지문 · 공식 상태 · revision 재확인 후 새 공개본 저장 · slug 유지) ──────────────
create or replace function public.publish_kdk_final_report(
  p_session_id text, p_actor uuid, p_payload jsonb, p_signature text, p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a record; v_rep public.kdk_final_reports%rowtype; v_raw jsonb; v_txt text; v_id text;
begin
  perform set_config('lock_timeout', '3s', true);
  if not coalesce(public.kdk_spotlight_is_admin(p_actor), false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_rep from public.kdk_final_reports where session_id = p_session_id for update;
  if v_rep.id is null then return jsonb_build_object('ok', false, 'reason', 'no_draft'); end if;
  if p_expected_revision is distinct from v_rep.revision then return jsonb_build_object('ok', false, 'reason', 'revision_conflict', 'revision', v_rep.revision); end if;
  select a.id, a.raw_data, a.is_official, a.is_test, a.archive_type into v_a from public.teyeon_archive_v1 a where a.id = p_session_id for share;
  if v_a.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if coalesce(v_a.archive_type, '') <> 'kdk' or v_a.is_official is not true or v_a.is_test is true then return jsonb_build_object('ok', false, 'reason', 'not_official'); end if;
  v_raw := coalesce(v_a.raw_data, '{}'::jsonb);
  if jsonb_typeof(v_raw->'ranking_data') <> 'array' or jsonb_array_length(v_raw->'ranking_data') = 0 then return jsonb_build_object('ok', false, 'reason', 'no_ranking'); end if;
  if p_signature is distinct from public.kdk_final_report_signature(v_raw) then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or coalesce(p_payload->>'schema', '') <> '1' or pg_column_size(p_payload) > 65536 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;
  -- 최후 방어: 공개본에 선수 내부 id · 이메일 형태가 섞이면 거부(서버 allow-list 의 이중 확인).
  v_txt := p_payload::text;
  if v_txt ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]' then return jsonb_build_object('ok', false, 'reason', 'payload_leak'); end if;
  -- (id 가 표시명과 같은 예전 행은 이름이 공개되는 것이 정상이므로 제외)
  for v_id in select btrim(coalesce(r.item->>'id', '')) from jsonb_array_elements(v_raw->'ranking_data') r(item)
               where btrim(coalesce(r.item->>'id', '')) <> btrim(coalesce(r.item->>'name', '')) loop
    if length(v_id) >= 8 and strpos(v_txt, v_id) > 0 then return jsonb_build_object('ok', false, 'reason', 'payload_leak'); end if;
  end loop;
  if strpos(v_txt, p_session_id) > 0 then return jsonb_build_object('ok', false, 'reason', 'payload_leak'); end if;
  update public.kdk_final_reports
     set status = 'published', revision = v_rep.revision + 1, public_payload = p_payload,
         source_signature = p_signature,
         published_at = now(), published_by = p_actor, updated_at = now(), updated_by = p_actor
   where id = v_rep.id returning * into v_rep;
  return jsonb_build_object('ok', true, 'reason', 'published', 'publicSlug', v_rep.public_slug, 'revision', v_rep.revision);
end
$$;

-- ── 6) 비공개 ─────────────────────────────────────────────────────────────────
create or replace function public.unpublish_kdk_final_report(p_session_id text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rep public.kdk_final_reports%rowtype;
begin
  perform set_config('lock_timeout', '3s', true);
  if not coalesce(public.kdk_spotlight_is_admin(p_actor), false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_rep from public.kdk_final_reports where session_id = p_session_id for update;
  if v_rep.id is null then return jsonb_build_object('ok', false, 'reason', 'no_draft'); end if;
  if v_rep.status <> 'published' then return jsonb_build_object('ok', true, 'reason', 'not_published'); end if;
  update public.kdk_final_reports set status = 'unpublished', unpublished_at = now(), unpublished_by = p_actor, updated_at = now(), updated_by = p_actor
   where id = v_rep.id;
  return jsonb_build_object('ok', true, 'reason', 'unpublished');
end
$$;

revoke all on function public.get_kdk_final_report_source(text, uuid), public.save_kdk_final_report_draft(text, text, uuid, jsonb, text),
  public.publish_kdk_final_report(text, uuid, jsonb, text, integer), public.unpublish_kdk_final_report(text, uuid)
  from public, anon, authenticated;
grant execute on function public.get_kdk_final_report_source(text, uuid), public.save_kdk_final_report_draft(text, text, uuid, jsonb, text),
  public.publish_kdk_final_report(text, uuid, jsonb, text, integer), public.unpublish_kdk_final_report(text, uuid)
  to service_role;

-- ── 7) 공개 조회(anon) — 발행본 + 열람 시 재검증 ──────────────────────────────────
--   상태: ok(payload) · corrected(공식 기록 정정 — 수치 없이 제목 · 날짜만) · not_found(없음 · 비공개 · 미확정 · 테스트).
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
      'title', coalesce(v_rep.public_payload->'session'->>'title', ''), 'date', coalesce(v_rep.public_payload->'session'->>'date', ''),
      'officialSessionId', v_rep.session_id);
  end if;
  return jsonb_build_object('ok', true, 'state', 'ok', 'payload', v_rep.public_payload, 'revision', v_rep.revision,
    'publishedAt', to_char(v_rep.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'officialSessionId', v_rep.session_id);
end
$$;
revoke all on function public.get_public_kdk_final_report(text) from public;
grant execute on function public.get_public_kdk_final_report(text) to anon, authenticated;
