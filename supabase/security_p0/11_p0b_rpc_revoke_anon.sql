-- =============================================================================
-- SECURITY P0-B (1단계) — anon 이 실행할 수 있는 matches 쓰기 SECURITY DEFINER RPC 차단   [초안 · 승인 전 실행 금지]
--
--   대상(저장소 supabase/sync_rpc_v1.sql — 권한 검사 없음 · search_path 미고정 · anon 실행 가능):
--     sync_tournament_matches(jsonb)                       — /special 대진 저장·투입·점수(로그인 화면에서만 호출)
--     update_match_status(text,text,integer,integer,integer) — 앱 코드 호출 없음(레거시)
--     date_match_status(text)                              — 앱 코드 호출 없음(레거시 · matches 전 컬럼 반환)
--   추가 대상(2026-11-04 운영 08 결과): KDK 운영 RPC 3개 — 본문은 auth.uid()+CEO/ADMIN 검사가 있어 anon 이 실행해도 거부되지만,
--     Supabase 기본 권한(새 함수에 anon EXECUTE 자동 부여)으로 anon 실행이 열려 있다 → anon 실행만 회수(이중 방어).
--     delete_kdk_live_session(text,text) · start_kdk_match(text,text) · start_kdk_match_timer(text,text)
--   대상 함수가 운영에 없으면 건너뛴다(새로 만들지 않음).
--   조치: PUBLIC·anon 실행 권한 회수 → authenticated · service_role 만 실행. search_path 고정(public, pg_temp).
--   바꾸지 않는 것: 함수 본문 · 반환형 · authenticated 동작 · /special 화면 흐름(로그인 사용자).
--   ⚠ 2단계(본문에 "클럽 회원/운영진" 검사 추가)는 /special 점수 입력 주체 결정 후 별도 SQL.
--   rollback: 11_p0b_rollback.sql
-- =============================================================================
begin;
set local lock_timeout = '3s';

create schema if not exists security_backup;
revoke all on schema security_backup from public, anon, authenticated;
create table if not exists security_backup.function_acl_p0b (
    captured_at timestamptz not null default now(),
    signature   text not null,
    proacl      text,
    proconfig   text
);
alter table security_backup.function_acl_p0b add column if not exists restored_at timestamptz;
revoke all on security_backup.function_acl_p0b from public, anon, authenticated;

-- KDK 운영 RPC 3개: 운영 본문이 "검토를 마친 본문"(md5 허용 목록) 중 하나일 때만 진행. 아니면 STOP·무변경.
--   P0-B 는 본문을 바꾸지 않는다(CREATE OR REPLACE 없음) — anon EXECUTE 만 회수.
--   허용 목록 근거(2026-11-04):
--     start_kdk_match         81257f29… 저장소 최신(2106e5b) / 8b6c074d… 운영 본문 = 저장소 이전판 99012c3(auth.uid + CEO/ADMIN 검사 동일)
--     start_kdk_match_timer   a5b98752… 저장소 = 운영(9b OK)
--     delete_kdk_live_session 9f7a0b85… 저장소 최신 / 77c38499… 운영 본문(저장소 이력에 없음). 9c(13_function_body_review) 검토 결과(2026-11-04):
--                             DELETE 이전에 CEO/ADMIN 검사 존재(auth.uid() 또는 JWT email 로 profiles 판정). 본문은 바꾸지 않고 anon EXECUTE 만 회수.
do $$
declare r record;
begin
  for r in select * from (values
      ('public.delete_kdk_live_session(text,text)', array['9f7a0b856885da2899766c4daefcf6d1', '77c38499351b4920dfd3eb6f3cb3726c']),
      ('public.start_kdk_match(text,text)',         array['81257f29c2abed42a8e28bc9e8376626', '8b6c074d6e336c45f5e24bba2e1fd460']),
      ('public.start_kdk_match_timer(text,text)',   array['a5b9875242bb9c28f33f9b1ad910ccc7'])) v(sig, allowed)
  loop
    if to_regprocedure(r.sig) is not null
       and (select md5(replace(prosrc, E'\r', '')) from pg_proc where oid = to_regprocedure(r.sig)) <> all(r.allowed) then
      raise exception 'STOP P0-B: % 운영 본문이 검토된 본문(md5 허용 목록)과 다름 — 변경 없음', r.sig;
    end if;
  end loop;
end $$;

do $$
declare
  sigs constant text[] := array[
    'public.sync_tournament_matches(jsonb)',
    'public.update_match_status(text,text,integer,integer,integer)',
    'public.date_match_status(text)',
    -- 2026-11-04 운영 확인: 내부에서 auth.uid()+CEO/ADMIN 을 검사하지만 Supabase 기본 권한으로 anon 실행이 열려 있음.
    --   anon 실행만 회수(본문 무변경) — 로그인 운영진 동작 그대로. anon 이 이미 불가하고 search_path 고정이면 건너뜀.
    'public.delete_kdk_live_session(text,text)',
    'public.start_kdk_match(text,text)',
    'public.start_kdk_match_timer(text,text)'
  ];
  s text; v_oid regprocedure;
begin
  foreach s in array sigs loop
    v_oid := to_regprocedure(s);
    if v_oid is null then
      raise notice 'P0-B: % 없음 — 건너뜀', s;
      continue;
    end if;
    -- 이미 적용된 함수(anon 실행 불가 + search_path 고정)는 건너뜀 → 재실행이 백업 회차를 덮지 않는다.
    if not has_function_privilege('anon', v_oid, 'execute')
       and (select coalesce(array_to_string(proconfig, ' '), '') like '%search_path%' from pg_proc where oid = v_oid) then
      raise notice 'P0-B: % 이미 적용 — 건너뜀', s;
      continue;
    end if;
    insert into security_backup.function_acl_p0b (signature, proacl, proconfig)
    select s, p.proacl::text, array_to_string(p.proconfig, ' ') from pg_proc p where p.oid = v_oid;
    execute format('revoke execute on function %s from public, anon', s);
    execute format('grant execute on function %s to authenticated, service_role', s);
    execute format('alter function %s set search_path = public, pg_temp', s);
    raise notice 'P0-B: % — anon 실행 회수 · search_path 고정', s;
  end loop;
end $$;
commit;

select s as signature,
       has_function_privilege('anon', s, 'execute')          as anon_exec,          -- false 여야 함
       has_function_privilege('authenticated', s, 'execute') as authenticated_exec, -- true 여야 함
       (select array_to_string(proconfig, ' ') from pg_proc where oid = to_regprocedure(s)) as config
  from unnest(array['public.sync_tournament_matches(jsonb)',
                    'public.update_match_status(text,text,integer,integer,integer)',
                    'public.date_match_status(text)',
                    'public.delete_kdk_live_session(text,text)',
                    'public.start_kdk_match(text,text)',
                    'public.start_kdk_match_timer(text,text)']) s
 where to_regprocedure(s) is not null;
