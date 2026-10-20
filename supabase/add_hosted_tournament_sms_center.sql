-- ============================================================================
--  대회 문자 안내 센터(SMS NOTICE CENTER) — 관리자 전용 저장 구조 + RPC
--
--  범위
--    · 문자 템플릿(대회별 5종 수정본) · 안내 URL · 주소록 스냅샷(전화번호 원문 대신 해시) · 수동 발송 기록.
--    · 문자를 보내지 않는다(외부 SMS 연동 없음). 운영진이 번호 · 문구를 복사해 휴대폰 문자 앱으로 직접 보낸다.
--
--  ⚠ 참가 신청 원본(hosted_tournament_registrations) · 팀 · 조편성 · 경기 · DRAW 공개 상태를 읽지도 바꾸지도 않는다.
--    연락처 조회는 기존 관리자 RPC get_admin_tournament_registrations(CEO/ADMIN 전용)를 그대로 쓴다.
--  ⚠ 새 테이블 2개는 RLS 를 켜고 정책을 두지 않는다 + public/anon/authenticated 권한 전부 회수.
--    접근은 아래 SECURITY DEFINER RPC 만, 각 RPC 가 can_manage_tournaments()(profiles.role CEO/ADMIN)를 먼저 확인한다.
--  ⚠ 발송 기록에는 전화번호를 저장하지 않는다(대상 수 · 배치 이름 · 메모만). client_key 도 번호가 아니라 참가자 키로 만든다.
--  ⚠ 스냅샷은 번호 원문 대신 SHA-256 앞 4자리(hex · 16비트) 지문만 저장한다 — 원본 변경 감지용.
--    휴대폰 번호는 경우의 수가 1억 개 남짓이라 전체 해시는 대입으로 되찾을 수 있다. 4자리는 지문 하나에 약 1,500개 번호가 겹친다.
--  ⚠ 기존 함수 · 테이블을 바꾸지 않는다(새 이름만 만든다). 한 트랜잭션으로 적용 — 실패하면 아무것도 남지 않는다.
-- ============================================================================

begin;

-- ── 1. 대회별 설정 한 줄(템플릿 · URL · 주소록 스냅샷) ─────────────────────────
create table if not exists public.hosted_tournament_sms_settings (
    tournament_id     uuid        primary key
                                  references public.hosted_tournaments(id) on delete cascade,
    -- { "<templateKey>": { "title": text|null, "body": text|null, "version": int, "updatedAt": ts, "updatedBy": uuid } }
    --   title/body 가 null 이면 '기본 문구로 초기화'된 상태(화면이 기본값을 쓴다). version 은 저장마다 +1(동시 수정 감지).
    templates         jsonb       not null default '{}'::jsonb,
    -- { "<urlKey>": { "url": text, "updatedAt": ts, "updatedBy": uuid } }
    urls              jsonb       not null default '{}'::jsonb,
    -- { "entries": [ { "r": registrationId, "s": 1|2, "h": sha256 앞 4자리 hex, "x": excluded } ], "recipientCount": int,
    --   "createdAt": ts, "createdBy": uuid, "createdByName": text }   — null = 스냅샷 없음
    snapshot          jsonb,
    snapshot_version  integer     not null default 0 check (snapshot_version >= 0),
    updated_at        timestamptz not null default now(),
    updated_by        uuid
);

alter table public.hosted_tournament_sms_settings enable row level security;
revoke all on table public.hosted_tournament_sms_settings from public, anon, authenticated;

-- ── 2. 수동 발송 기록(전화번호 없음) ──────────────────────────────────────────
create table if not exists public.hosted_tournament_sms_logs (
    id                 uuid        primary key default gen_random_uuid(),
    tournament_id      uuid        not null references public.hosted_tournaments(id) on delete cascade,
    -- 같은 기록을 두 번 남기지 않게(더블 탭 · 재시도) — 화면이 만든 키. 대회 안에서 unique.
    client_key         text        not null check (char_length(client_key) between 1 and 120),
    template_key       text        not null check (template_key in
                                       ('draw_checkin', 'day_notice', 'live_qf', 'results', 'highlight', 'custom')),
    template_title     text        check (template_title is null or char_length(template_title) <= 60),
    audience           text        check (audience is null or char_length(audience) <= 120),
    batch_label        text        check (batch_label is null or char_length(batch_label) <= 60),
    recipient_count    integer     not null check (recipient_count between 0 and 2000),
    -- copied = 번호를 복사함(발송 아님) · sent = 관리자가 직접 '발송 완료'로 기록 · void = 잘못 기록해 취소
    status             text        not null check (status in ('copied', 'sent', 'void')),
    note               text        check (note is null or char_length(note) <= 300),
    created_at         timestamptz not null default now(),
    created_by         uuid,
    created_by_name    text,
    status_changed_at  timestamptz,
    status_changed_by  uuid,
    constraint hosted_tsms_log_client_key_unique unique (tournament_id, client_key)
);

create index if not exists hosted_tsms_logs_tid_created
    on public.hosted_tournament_sms_logs (tournament_id, created_at desc);

alter table public.hosted_tournament_sms_logs enable row level security;
revoke all on table public.hosted_tournament_sms_logs from public, anon, authenticated;


-- ── 3. 조회 — 설정 + 최근 발송 기록 200건 ────────────────────────────────────
--   CEO/ADMIN 이 아니면 null(존재 여부도 알려주지 않는다). 없는 대회면 null.
create or replace function public.get_admin_sms_center(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid;
    v_s   public.hosted_tournament_sms_settings%rowtype;
begin
    if not public.can_manage_tournaments() then
        return null;
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return null;
    end if;
    select * into v_s from public.hosted_tournament_sms_settings where tournament_id = v_tid;
    return jsonb_build_object(
        'slug',            p_slug,
        'templates',       coalesce(v_s.templates, '{}'::jsonb),
        'urls',            coalesce(v_s.urls, '{}'::jsonb),
        'snapshot',        v_s.snapshot,
        'snapshotVersion', coalesce(v_s.snapshot_version, 0),
        'logs', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id',             l.id,
                       'templateKey',    l.template_key,
                       'templateTitle',  l.template_title,
                       'audience',       l.audience,
                       'batchLabel',     l.batch_label,
                       'recipientCount', l.recipient_count,
                       'status',         l.status,
                       'note',           l.note,
                       'createdAt',      l.created_at,
                       'createdByName',  l.created_by_name,
                       'mine',           (l.created_by = auth.uid()),
                       'statusChangedAt', l.status_changed_at
                   ) order by l.created_at desc)
              from (select * from public.hosted_tournament_sms_logs
                     where tournament_id = v_tid order by created_at desc limit 200) l
        ), '[]'::jsonb),
        'serverNow',       now()
    );
end;
$$;

revoke execute on function public.get_admin_sms_center(text) from public;
revoke execute on function public.get_admin_sms_center(text) from anon;
grant  execute on function public.get_admin_sms_center(text) to authenticated;


-- 내부 도우미 — 설정 줄을 만들고(없으면) 잠근다. 외부에서 직접 부르지 못하게 권한을 모두 회수한다.
create or replace function public.hosted_tournament_sms_lock_settings(p_tid uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    insert into public.hosted_tournament_sms_settings (tournament_id) values (p_tid)
        on conflict (tournament_id) do nothing;
    perform 1 from public.hosted_tournament_sms_settings where tournament_id = p_tid for update;
end;
$$;

revoke execute on function public.hosted_tournament_sms_lock_settings(uuid) from public;
revoke execute on function public.hosted_tournament_sms_lock_settings(uuid) from anon;
revoke execute on function public.hosted_tournament_sms_lock_settings(uuid) from authenticated;


-- ── 4. 템플릿 저장 · 기본값 초기화(동시 수정 감지) ───────────────────────────
--   p_expected_version = 화면이 읽었을 때의 version(처음이면 0). 다르면 저장하지 않고 현재 값을 돌려준다.
--   p_reset = true 면 title/body 를 null 로(기본 문구 사용) — version 은 그래도 +1.
create or replace function public.save_sms_template(
    p_slug             text,
    p_key              text,
    p_title            text,
    p_body             text,
    p_expected_version integer,
    p_reset            boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid   uuid;
    v_cur   jsonb;
    v_ver   integer;
    v_title text := nullif(btrim(coalesce(p_title, '')), '');
    v_body  text := replace(coalesce(p_body, ''), chr(13), '');
    v_now   timestamptz := now();
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    if p_key is null or p_key not in ('draw_checkin', 'day_notice', 'live_qf', 'results', 'highlight') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_key');
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;
    if not coalesce(p_reset, false) then
        if v_title is null or char_length(v_title) > 60 then
            return jsonb_build_object('ok', false, 'reason', 'invalid_title');
        end if;
        if btrim(v_body) = '' or char_length(v_body) > 2000 then
            return jsonb_build_object('ok', false, 'reason', 'invalid_body');
        end if;
    end if;

    perform public.hosted_tournament_sms_lock_settings(v_tid);
    select templates -> p_key into v_cur from public.hosted_tournament_sms_settings where tournament_id = v_tid;
    v_ver := coalesce((v_cur ->> 'version')::integer, 0);
    if coalesce(p_expected_version, -1) <> v_ver then
        return jsonb_build_object('ok', false, 'reason', 'version_conflict',
                                  'currentVersion', v_ver, 'current', v_cur);
    end if;

    update public.hosted_tournament_sms_settings
       set templates = templates || jsonb_build_object(p_key, jsonb_build_object(
               'title',     case when coalesce(p_reset, false) then null else v_title end,
               'body',      case when coalesce(p_reset, false) then null else v_body end,
               'version',   v_ver + 1,
               'updatedAt', v_now,
               'updatedBy', auth.uid())),
           updated_at = v_now,
           updated_by = auth.uid()
     where tournament_id = v_tid;

    return jsonb_build_object('ok', true, 'version', v_ver + 1, 'updatedAt', v_now);
end;
$$;

revoke execute on function public.save_sms_template(text,text,text,text,integer,boolean) from public;
revoke execute on function public.save_sms_template(text,text,text,text,integer,boolean) from anon;
grant  execute on function public.save_sms_template(text,text,text,text,integer,boolean) to authenticated;


-- ── 5. 안내 URL 저장 · 비우기 ─────────────────────────────────────────────────
--   https:// 만 허용(javascript: · data: · http: 등 거절). 빈 값(null · '')이면 그 키를 지운다.
create or replace function public.save_sms_url(p_slug text, p_key text, p_url text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid;
    v_url text := btrim(coalesce(p_url, ''));
    v_now timestamptz := now();
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    if p_key is null or p_key not in ('home', 'draw', 'my_match', 'knockout', 'live', 'results', 'video') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_key');
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;
    if v_url <> '' and (char_length(v_url) > 500
                        or v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]<>"''`]*)?$') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_url');
    end if;

    perform public.hosted_tournament_sms_lock_settings(v_tid);
    update public.hosted_tournament_sms_settings
       set urls = case when v_url = '' then urls - p_key
                       else urls || jsonb_build_object(p_key, jsonb_build_object(
                                'url', v_url, 'updatedAt', v_now, 'updatedBy', auth.uid())) end,
           updated_at = v_now,
           updated_by = auth.uid()
     where tournament_id = v_tid;

    return jsonb_build_object('ok', true, 'updatedAt', v_now);
end;
$$;

revoke execute on function public.save_sms_url(text,text,text) from public;
revoke execute on function public.save_sms_url(text,text,text) from anon;
grant  execute on function public.save_sms_url(text,text,text) to authenticated;


-- ── 6. 주소록 스냅샷 저장 · 지우기(동시 수정 감지) ───────────────────────────
--   entries = [ { r: 신청 id(uuid 문자열), s: 1|2, h: sha256 앞 4자리 hex(빈 번호는 ''), x: 제외 여부 } ] — 최대 1000개.
--   ⚠ 전화번호 원문 · 전체 해시는 받지 않는다(h 는 정확히 4자리만). 신청 원본을 바꾸지 않는다. p_entries 가 null 이면 스냅샷을 지운다.
create or replace function public.save_sms_snapshot(
    p_slug             text,
    p_entries          jsonb,
    p_recipient_count  integer,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid  uuid;
    v_ver  integer;
    v_nick text;
    v_now  timestamptz := now();
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;
    if p_entries is not null then
        if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 1000 then
            return jsonb_build_object('ok', false, 'reason', 'invalid_entries');
        end if;
        if exists (
            select 1 from jsonb_array_elements(p_entries) e
             where jsonb_typeof(e) <> 'object'
                or coalesce(e ->> 'r', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                or coalesce(e ->> 's', '') not in ('1', '2')
                or coalesce(e ->> 'h', '') !~ '^([0-9a-f]{4})?$'
                or jsonb_typeof(e -> 'x') is distinct from 'boolean'
                or (select count(*) from jsonb_object_keys(e)) <> 4
        ) then
            return jsonb_build_object('ok', false, 'reason', 'invalid_entries');
        end if;
        if p_recipient_count is null or p_recipient_count < 0 or p_recipient_count > 2000 then
            return jsonb_build_object('ok', false, 'reason', 'invalid_entries');
        end if;
    end if;

    perform public.hosted_tournament_sms_lock_settings(v_tid);
    select snapshot_version into v_ver from public.hosted_tournament_sms_settings where tournament_id = v_tid;
    if coalesce(p_expected_version, -1) <> v_ver then
        return jsonb_build_object('ok', false, 'reason', 'version_conflict', 'currentVersion', v_ver);
    end if;
    select nickname into v_nick from public.profiles where id = auth.uid();

    update public.hosted_tournament_sms_settings
       set snapshot = case when p_entries is null then null else jsonb_build_object(
                          'entries',        p_entries,
                          'recipientCount', p_recipient_count,
                          'createdAt',      v_now,
                          'createdBy',      auth.uid(),
                          'createdByName',  v_nick) end,
           snapshot_version = v_ver + 1,
           updated_at = v_now,
           updated_by = auth.uid()
     where tournament_id = v_tid;

    return jsonb_build_object('ok', true, 'version', v_ver + 1, 'createdAt', v_now);
end;
$$;

revoke execute on function public.save_sms_snapshot(text,jsonb,integer,integer) from public;
revoke execute on function public.save_sms_snapshot(text,jsonb,integer,integer) from anon;
grant  execute on function public.save_sms_snapshot(text,jsonb,integer,integer) to authenticated;


-- ── 7. 발송 기록 남기기(중복 방지) ─────────────────────────────────────────────
--   같은 client_key 가 이미 있으면 새로 만들지 않고 기존 기록을 알려준다(reason = duplicate).
create or replace function public.add_sms_log(
    p_slug            text,
    p_client_key      text,
    p_template_key    text,
    p_template_title  text,
    p_audience        text,
    p_batch_label     text,
    p_recipient_count integer,
    p_status          text,
    p_note            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid  uuid;
    v_id   uuid;
    v_old  public.hosted_tournament_sms_logs%rowtype;
    v_nick text;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;
    if p_status is null or p_status not in ('copied', 'sent') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_status');
    end if;
    if p_template_key is null or p_template_key not in
           ('draw_checkin', 'day_notice', 'live_qf', 'results', 'highlight', 'custom') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_key');
    end if;
    if p_client_key is null or char_length(p_client_key) not between 1 and 120
       or p_recipient_count is null or p_recipient_count not between 0 and 2000
       or char_length(coalesce(p_template_title, '')) > 60
       or char_length(coalesce(p_audience, '')) > 120
       or char_length(coalesce(p_batch_label, '')) > 60
       or char_length(coalesce(p_note, '')) > 300 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_input');
    end if;

    select * into v_old from public.hosted_tournament_sms_logs
     where tournament_id = v_tid and client_key = p_client_key;
    if found then
        return jsonb_build_object('ok', false, 'reason', 'duplicate', 'id', v_old.id, 'status', v_old.status);
    end if;
    select nickname into v_nick from public.profiles where id = auth.uid();

    insert into public.hosted_tournament_sms_logs
        (tournament_id, client_key, template_key, template_title, audience, batch_label,
         recipient_count, status, note, created_by, created_by_name)
    values (v_tid, p_client_key, p_template_key, nullif(btrim(p_template_title), ''), nullif(btrim(p_audience), ''),
            nullif(btrim(p_batch_label), ''), p_recipient_count, p_status, nullif(btrim(p_note), ''),
            auth.uid(), v_nick)
    on conflict (tournament_id, client_key) do nothing
    returning id into v_id;

    if v_id is null then   -- 동시에 같은 키가 먼저 들어간 경우
        select * into v_old from public.hosted_tournament_sms_logs
         where tournament_id = v_tid and client_key = p_client_key;
        return jsonb_build_object('ok', false, 'reason', 'duplicate', 'id', v_old.id, 'status', v_old.status);
    end if;
    return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke execute on function public.add_sms_log(text,text,text,text,text,text,integer,text,text) from public;
revoke execute on function public.add_sms_log(text,text,text,text,text,text,integer,text,text) from anon;
grant  execute on function public.add_sms_log(text,text,text,text,text,text,integer,text,text) to authenticated;


-- ── 8. 발송 기록 상태 고치기(잘못 체크한 '발송 완료' 취소 등) ─────────────────
--   다른 대회의 기록은 고치지 못한다(slug 의 대회와 기록의 대회가 같아야 한다). 기록을 지우지 않는다.
create or replace function public.set_sms_log_status(
    p_slug   text,
    p_log_id uuid,
    p_status text,
    p_note   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid;
    v_n   integer;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;
    if p_status is null or p_status not in ('copied', 'sent', 'void') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_status');
    end if;
    if char_length(coalesce(p_note, '')) > 300 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_input');
    end if;

    update public.hosted_tournament_sms_logs
       set status = p_status,
           note = coalesce(nullif(btrim(p_note), ''), note),
           status_changed_at = now(),
           status_changed_by = auth.uid()
     where id = p_log_id and tournament_id = v_tid;
    get diagnostics v_n = row_count;
    if v_n = 0 then
        return jsonb_build_object('ok', false, 'reason', 'log_not_found');
    end if;
    return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.set_sms_log_status(text,uuid,text,text) from public;
revoke execute on function public.set_sms_log_status(text,uuid,text,text) from anon;
grant  execute on function public.set_sms_log_status(text,uuid,text,text) to authenticated;

notify pgrst, 'reload schema';

commit;
