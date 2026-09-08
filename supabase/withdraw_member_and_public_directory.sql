-- =============================================================================
-- TEYEON 회원 탈회 처리 — 현재 명단/공개 디렉토리에서 제외 (과거 기록 전량 보존)
--
--   대상: 강정호 (club_id = TEYEON)
--   방식: hard delete 금지. members.role 을 '탈회' 로 바꾸는 soft 처리.
--
--   ✅ 실행 승인 완료 — Supabase SQL Editor 에 파일 내용 전체를 붙여넣어 1회 실행.
--      (프로젝트 표준 적용 경로: supabase/APPLY_CHECKLIST.md — CLI 마이그레이션 미사용)
--   rollback: supabase/withdraw_member_and_public_directory_rollback.sql
--
-- ── PREFLIGHT 확정값 (2026-09-08, 운영 조회 완료) ──────────────────────────
--   nickname                  : 강정호
--   members.role              : '부회장'          → 이 스크립트가 '탈회' 로 변경
--   profiles.role             : 'ADMIN'           → 이 스크립트가 'MEMBER' 로 강등 (§4-A)
--   profile_visibility_level  : 'public'          → 값 자체는 변경하지 않는다(역사 데이터).
--                                                   §3 이 active membership 을 우선 적용해 공개 제외.
--   auth_user_id              : 연결됨(유지)       → auth 계정·연결 모두 삭제하지 않는다.
--   ranking_managers 등재      : false            → §4-C 는 0건 삭제가 정상(로그로 확인).
--   전체 권한 계정             : ADMIN 5명 / CEO 1명 → ADMIN 강등이므로 관리자 잠김 위험 없음.
--
-- ── 왜 role 인가 (신규 컬럼을 만들지 않는 이유) ────────────────────────────
--   · 운영 members 에는 status / is_active / withdrawn / deleted 컬럼이 없다.
--     (supabase/secure_member_column_privileges.sql 의 2026-07-11 REST probe 실측)
--   · members 는 column-level GRANT 로 잠겨 있어(같은 파일) 신규 컬럼 추가 시
--     `grant select (...)` 를 함께 고쳐야 하고, 누락하면 전 회원 조회가 깨진다.
--   · 프로젝트 관례도 동일 — lib/finance/duesService.ts: "신규 분류 컬럼은 만들지 않는다".
--   · 앱 코드의 판정 단일 출처는 lib/members/membershipStatus.ts (WITHDRAWN_ROLE='탈회').
--
-- ── 절대 건드리지 않는 것 (과거 기록) ──────────────────────────────────────
--   teyeon_archive_v1 (raw_data 포함) · ranking_snapshots · club_schedule_attendances
--   · member_achievements · finance_dues_* · 감사/보정 이력.
--   members row 와 members.id(stable id) 가 그대로 남으므로 위 기록은 전부 계속 조회된다.
--   이 파일에는 DELETE 가 단 한 줄도 없다(권한 화이트리스트 row 제외 — §4 참조).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- §0. PREFLIGHT — 먼저 이것만 실행하고 출력을 반드시 보관할 것.
--     rollback 은 이 출력값(변경 전 상태)을 필요로 한다.
-- ─────────────────────────────────────────────────────────────────────────────
-- select m.id                        as member_id,
--        m.nickname,
--        m.role                      as club_role_before,     -- 예상: '부회장'
--        m."비고"                     as memo_before,
--        m.auth_user_id,
--        p.role                      as app_role_before,      -- Admin 권한 판정의 실제 기준
--        p.profile_visibility_level  as visibility_before
--   from public.members m
--   left join public.profiles p on p.id = m.auth_user_id
--  where m.nickname = '강정호';
--
-- select to_regclass('public.admin_users')      as admin_users_table,
--        to_regclass('public.ranking_managers') as ranking_managers_table;
--
-- -- 위 두 테이블이 실제로 존재할 때만 실행:
-- select 'admin_users' as src, a.user_id
--   from public.admin_users a
--   join public.members m on m.auth_user_id = a.user_id
--  where m.nickname = '강정호'
-- union all
-- select 'ranking_managers', r.user_id
--   from public.ranking_managers r
--   join public.members m on m.auth_user_id = r.user_id
--  where m.nickname = '강정호';


begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. 탈회 판정 helper — 앱(lib/members/membershipStatus.splitMemberRoles)과 동일 규칙.
--     members.role 은 'CEO, 재무' 처럼 쉼표 다중값이 저장될 수 있으므로 단순 <> 비교로는
--     '정회원, 탈회' 를 놓친다. RPC/정책이 이 helper 하나만 참조하도록 둔다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_withdrawn_member_role(p_role text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
    select exists (
        select 1
          from unnest(string_to_array(coalesce(p_role, ''), ',')) as r(value)
         where btrim(r.value) = '탈회'
    );
$$;
comment on function public.is_withdrawn_member_role(text) is
    'members.role 이 탈회 상태인지. 쉼표 다중 역할 대응. 앱 판정(lib/members/membershipStatus)과 동일 규칙.';
revoke execute on function public.is_withdrawn_member_role(text) from public;
grant  execute on function public.is_withdrawn_member_role(text) to anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- §2. 회원 상태 변경 — members.role → '탈회' (row 삭제 아님)
--     · 직전 직책은 "비고" 에 기계 판독 가능한 형태로 남긴다(rollback 근거 + 운영 이력).
--       "비고" 는 authenticated 에 GRANT 되지 않은 컬럼이라(관리자 RPC 전용) 노출 위험 없음.
--     · 정확히 1건만 바뀌는지 검증하고, 아니면 전체 롤백한다(동명이인·오타 방지).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
    v_id           uuid;
    v_prior_role   text;
    v_count        integer;
begin
    select count(*) into v_count
      from public.members
     where nickname = '강정호'
       and club_id  = '512d047d-a076-4080-97e5-6bb5a2c07819';

    if v_count <> 1 then
        raise exception '대상 회원이 정확히 1건이 아닙니다 (found=%). 중단합니다.', v_count;
    end if;

    select id, role into v_id, v_prior_role
      from public.members
     where nickname = '강정호'
       and club_id  = '512d047d-a076-4080-97e5-6bb5a2c07819';

    if public.is_withdrawn_member_role(v_prior_role) then
        raise notice '이미 탈회 상태입니다 (role=%). members 변경을 건너뜁니다.', v_prior_role;
    else
        update public.members
           set role   = '탈회',
               "비고" = concat_ws(' / ',
                            nullif("비고", ''),
                            format('[withdrawn:2026-09-08] prior_club_role=%s', coalesce(v_prior_role, '(null)'))
                        )
         where id = v_id;
        raise notice '탈회 처리 완료 — member_id=%, prior_club_role=%', v_id, v_prior_role;
    end if;
end $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- §3. 공개 디렉토리(/club/members) 에서 제외
--     기존 조건(auth 연결 + profile_visibility_level='public')에 "현재 회원" 조건을 추가한다.
--     요구사항: 공개 동의(visibility)가 true 여도 현재 회원 자격이 우선한다.
--     ⚠️ 이 함수 외 다른 로직·반환 필드는 원본 그대로다(add_public_club_rpcs.sql §2).
--        과거 공개 결과(get_public_kdk_session 등)는 이 변경의 영향을 받지 않는다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_public_member_directory()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nickname',   m.nickname,
      'avatarUrl',  case
        when m.avatar_url is not null and m.avatar_url <> '' then
          regexp_replace(m.avatar_url, '^http://(img1|t1|k)\.kakaocdn\.net', 'https://\1.kakaocdn.net')
        else null
      end,
      'role',       case when m.role in ('CEO', 'ADMIN') then m.role else null end
    ) order by m.nickname asc nulls last), '[]'::jsonb)
    from public.members m
    where m.auth_user_id is not null
      and m.nickname is not null
      -- 추가: 탈회 회원은 공개 동의와 무관하게 제외.
      and not public.is_withdrawn_member_role(m.role)
      and exists (
        select 1 from public.profiles p
         where p.id = m.auth_user_id
           and coalesce(p.profile_visibility_level, 'public') = 'public'
      )
  );
end;
$$;
revoke execute on function public.get_public_member_directory() from public;
grant  execute on function public.get_public_member_directory() to anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- §4. 운영 권한 제거 — 조건부·멱등. 필요할 때만 동작하고, 아니면 아무것도 하지 않는다.
--
--     Admin Console 접근의 실제 source of truth 는 profiles.role 이다
--     (lib/admin/adminAccess.ts / middleware.ts — members.role 은 클럽 직책일 뿐이라
--      §2 만으로는 Admin 접근이 차단되지 않는다).
--
--     확정 정책:
--       · profiles.role 이 CEO/ADMIN/OPERATOR/FINANCE_MANAGER 면 → 'MEMBER' 로 강등
--       · 이미 MEMBER/GUEST/null 이면 → UPDATE 하지 않음(불필요한 쓰기 금지)
--       · ranking_managers 에 실제 등재된 경우에만 → 해당 row 제거
--       · admin_users 는 운영에 테이블이 없으므로 대상에서 제외
--       · 앱 계정을 GUEST 까지 낮추지는 않는다(운영 권한 회수까지가 이번 범위)
--
--     ⚠️ 아래 블록은 변경 전 값을 `raise notice` 로 출력한다.
--        **출력 로그를 반드시 보관할 것** — rollback(§R4)이 그 값을 필요로 한다.
--
--     ── PREFLIGHT 확정 (2026-09-08) ──────────────────────────────────────
--       · profiles.role           : **'ADMIN'** → §4-A 가 'MEMBER' 로 강등한다(실제 변경 발생).
--       · ranking_managers 등재    : **false**  → §4-C 는 "미등재 — 변경 없음" 로그만 남는다(정상).
--       · public.admin_users      : **테이블 없음** (PGRST205) → 대상 아님.
--     확정값을 알고 있어도 아래 방어 로직(조건 판정·멱등·CEO 잠김 가드)은 그대로 유지한다 —
--     재실행 안전성과 rollback 후 재적용을 보장하기 위함.
-- ─────────────────────────────────────────────────────────────────────────────

-- §4-A. 앱 보안 Role 강등 — 운영/관리 권한을 가진 경우에만 'MEMBER' 로 내린다.
--       CEO 인데 다른 CEO 가 하나도 없으면 관리자 잠김을 막기 위해 전체를 중단한다.
do $$
declare
    v_uid       uuid;
    v_role      text;
    v_other_ceo integer;
begin
    select m.auth_user_id into v_uid
      from public.members m
     where m.nickname = '강정호'
       and m.club_id  = '512d047d-a076-4080-97e5-6bb5a2c07819';

    if v_uid is null then
        raise notice '[4-A] auth 계정 연결 없음 — profiles 변경 대상 아님.';
        return;
    end if;

    select p.role into v_role from public.profiles p where p.id = v_uid;
    raise notice '[4-A] 변경 전 profiles.role = %  (rollback 용으로 기록해 둘 것)', coalesce(v_role, '(null)');

    if upper(coalesce(v_role, '')) not in ('CEO', 'ADMIN', 'OPERATOR', 'FINANCE_MANAGER') then
        raise notice '[4-A] 운영 권한 없음 — UPDATE 하지 않음.';
        return;
    end if;

    if upper(coalesce(v_role, '')) = 'CEO' then
        select count(*) into v_other_ceo
          from public.profiles p
         where upper(coalesce(p.role, '')) = 'CEO' and p.id <> v_uid;
        if v_other_ceo = 0 then
            raise exception '[4-A] 유일한 CEO 를 강등하면 관리자가 잠깁니다. 다른 CEO 를 먼저 지정하세요.';
        end if;
    end if;

    update public.profiles set role = 'MEMBER' where id = v_uid;
    raise notice '[4-A] profiles.role % → MEMBER 강등 완료.', v_role;
end $$;

-- §4-B. Admin Console 화이트리스트(admin_users) — 운영에 테이블이 없어 대상 아님.
--       향후 supabase/add_admin_users.sql 을 적용하면 그때 제거 로직을 추가할 것.

-- §4-C. Ranking Manager 화이트리스트 — 실제 등재된 경우에만 제거.
--       테이블 부재 환경에서도 실패하지 않도록 to_regclass 로 가드.
do $$
declare
    v_uid     uuid;
    v_deleted integer := 0;
begin
    if to_regclass('public.ranking_managers') is null then
        raise notice '[4-C] ranking_managers 테이블 없음 — 건너뜀.';
        return;
    end if;

    select m.auth_user_id into v_uid
      from public.members m
     where m.nickname = '강정호'
       and m.club_id  = '512d047d-a076-4080-97e5-6bb5a2c07819';

    if v_uid is null then
        raise notice '[4-C] auth 계정 연결 없음 — 대상 아님.';
        return;
    end if;

    delete from public.ranking_managers where user_id = v_uid;
    get diagnostics v_deleted = row_count;

    if v_deleted = 0 then
        raise notice '[4-C] ranking_managers 미등재 — 변경 없음. (PREFLIGHT 확정값과 일치: 정상)';
    else
        raise notice '[4-C] ranking_managers 등재 %건 제거 (rollback 시 재등록 필요).', v_deleted;
    end if;
end $$;


commit;

notify pgrst, 'reload schema';


-- ─────────────────────────────────────────────────────────────────────────────
-- §5. VERIFY — 적용 후 실행해 결과를 확인한다.
-- ─────────────────────────────────────────────────────────────────────────────
-- -- (1) members row 는 살아 있고 role 만 '탈회' 여야 한다.
-- select id, nickname, role, "비고"
--   from public.members where nickname = '강정호';
--
-- -- (2) 공개 디렉토리에서 사라져야 한다 → 0 건.
-- select count(*)
--   from jsonb_array_elements(public.get_public_member_directory()) e
--  where e->>'nickname' = '강정호';
--
-- -- (3) 과거 공식 KDK 기록은 그대로여야 한다 → 적용 전과 같은 건수.
-- select count(*) as official_kdk_sessions
--   from public.teyeon_archive_v1
--  where archive_type = 'kdk' and is_official = true;
--
-- -- (4) 과거 참석/입상/재무 이력 건수도 변하지 않아야 한다.
-- select (select count(*) from public.club_schedule_attendances a
--          join public.members m on m.id = a.member_id where m.nickname = '강정호') as attendances,
--        (select count(*) from public.member_achievements ma
--          join public.members m on m.id = ma.member_id where m.nickname = '강정호') as achievements;
