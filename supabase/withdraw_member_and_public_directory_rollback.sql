-- =============================================================================
-- ROLLBACK — supabase/withdraw_member_and_public_directory.sql 되돌리기
--
--   되돌리는 대상:
--     §2 members.role = '탈회'            → 직전 직책으로 복원 + 감사 메모 제거
--     §3 get_public_member_directory()    → 탈회 필터 없던 원본 정의로 복원
--     §1 is_withdrawn_member_role()       → 삭제(다른 참조가 없을 때만)
--     §4 권한 회수(주석 블록을 실행했다면) → 아래 §R4 에서 원래 값으로 복원
--
--   ⚠️ 실행 전 확인: main SQL §0 PREFLIGHT 출력(변경 전 상태)을 손에 들고 있어야 한다.
--      main SQL 은 직전 직책을 members."비고" 에도 남긴다:
--        [withdrawn:2026-09-08] prior_club_role=부회장
--      아래 §R1 은 그 메모에서 값을 자동으로 읽어 복원하므로, 메모가 남아 있으면
--      수동 입력 없이 동작한다. 메모를 지웠다면 §R1-manual 을 대신 쓸 것.
--
--   과거 기록은 main SQL 이 애초에 건드리지 않으므로 이 파일도 복원할 것이 없다.
-- =============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- §R1. members.role 복원 — "비고" 에 남긴 prior_club_role 을 읽어 되돌린다.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
    v_id     uuid;
    v_memo   text;
    v_prior  text;
begin
    select id, "비고" into v_id, v_memo
      from public.members
     where nickname = '강정호'
       and club_id  = '512d047d-a076-4080-97e5-6bb5a2c07819';

    if v_id is null then
        raise exception '대상 회원을 찾지 못했습니다. 중단합니다.';
    end if;

    v_prior := (regexp_match(coalesce(v_memo, ''), '\[withdrawn:[0-9-]+\] prior_club_role=([^/]*)'))[1];
    v_prior := btrim(coalesce(v_prior, ''));

    if v_prior = '' or v_prior = '(null)' then
        raise exception
            '비고에서 직전 직책을 찾지 못했습니다. §R1-manual 블록을 사용하세요. memo=%', v_memo;
    end if;

    update public.members
       set role   = v_prior,
           -- 감사 메모만 제거하고 그 외 비고 내용은 보존.
           "비고" = nullif(btrim(both ' /' from
                        regexp_replace(coalesce("비고", ''),
                                       '\s*/?\s*\[withdrawn:[0-9-]+\] prior_club_role=[^/]*', '', 'g')
                    ), '')
     where id = v_id;

    raise notice 'members.role 복원 완료 — member_id=%, role=%', v_id, v_prior;
end $$;

-- §R1-manual. 위 자동 복원이 실패했을 때만 사용 (PREFLIGHT 의 club_role_before 값을 직접 기입).
--   기록상 직전 직책은 '부회장' 이다(테연 명단.csv / scripts/sync_members.js 일치).
-- update public.members
--    set role = '부회장'
--  where nickname = '강정호'
--    and club_id  = '512d047d-a076-4080-97e5-6bb5a2c07819';


-- ─────────────────────────────────────────────────────────────────────────────
-- §R2. get_public_member_directory() 원본 복원
--      add_public_club_rpcs.sql §2 의 정의와 완전히 동일(탈회 필터 없음).
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
-- §R3. helper 제거 — §R2 로 마지막 참조가 사라진 뒤이므로 안전.
--      (앱 코드는 이 함수를 직접 호출하지 않는다 — 판정은 TS 쪽 membershipStatus 가 담당)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.is_withdrawn_member_role(text);


-- ─────────────────────────────────────────────────────────────────────────────
-- §R4. 권한 복원 — main SQL §4 가 실제로 무언가를 바꿨을 때만 해당 블록을 실행한다.
--
--      무엇을 바꿨는지는 main SQL 실행 시 출력된 `raise notice` 로그로 판단한다:
--        "[4-A] 변경 전 profiles.role = X"        → X 를 §R4-A 에 넣어 복원
--        "[4-A] 운영 권한 없음 — UPDATE 하지 않음" → §R4-A 실행 불필요
--        "[4-C] ranking_managers 등재 N건 제거"    → §R4-C 실행 필요
--        "[4-C] ranking_managers 미등재 — 변경 없음" → §R4-C 실행 불필요
--
--      ⚠️ 값이 불확실하면 실행하지 말 것 — 잘못된 값은 권한 과다 부여가 된다.
--         (main SQL §4 는 권한을 낮추기만 하므로, 미실행 시의 위험은 "권한이 낮은 상태 유지"뿐이다)
-- ─────────────────────────────────────────────────────────────────────────────

-- §R4-A. 앱 보안 Role 복원.
--        PREFLIGHT 확정값(2026-09-08): 변경 전 profiles.role = 'ADMIN'.
--        main SQL 실행 로그의 "[4-A] 변경 전 profiles.role = ..." 과 일치하는지 확인 후 실행할 것.
-- update public.profiles p
--    set role = 'ADMIN'
--   from public.members m
--  where m.auth_user_id = p.id
--    and m.nickname = '강정호';

-- §R4-B. Admin Console 화이트리스트 — main SQL 이 admin_users 를 건드리지 않으므로
--        (운영에 테이블 자체가 없음) 복원할 것이 없다.

-- §R4-C. Ranking Manager 화이트리스트 복원 ([4-C] 가 제거를 보고했을 때만).
-- insert into public.ranking_managers (user_id, note)
-- select m.auth_user_id, 'rollback: withdraw_member_and_public_directory'
--   from public.members m
--  where m.nickname = '강정호' and m.auth_user_id is not null
--  on conflict (user_id) do nothing;


commit;

notify pgrst, 'reload schema';


-- ─────────────────────────────────────────────────────────────────────────────
-- §R5. VERIFY
-- ─────────────────────────────────────────────────────────────────────────────
-- select id, nickname, role, "비고" from public.members where nickname = '강정호';
--
-- select count(*)
--   from jsonb_array_elements(public.get_public_member_directory()) e
--  where e->>'nickname' = '강정호';   -- 복원 후 1 이어야 한다(공개 동의가 여전히 public 일 때)
--
-- select to_regprocedure('public.is_withdrawn_member_role(text)');  -- null 이어야 한다
--
-- ⚠️ 코드 롤백도 함께 필요하다: 앱은 members.role='탈회' 를 현재 명단에서 제외한다
--    (lib/members/membershipStatus). §R1 로 role 이 복원되면 앱 화면도 자동으로 정상 복귀하므로
--    별도 코드 되돌리기는 필요 없다.
