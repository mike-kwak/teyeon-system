-- ============================================================================
-- add_kdk_session_guest_fee.sql
--
-- KDK 세션별 게스트비 snapshot 컬럼. 정모(Guest Pass/Club Schedule)별 게스트비를
-- 신규 KDK 세션 생성/연결 시 초기값으로 불러와 이 컬럼에 "실제 사용 금액"으로 박제한다.
--   · 정산/화면은 이 컬럼값을 단일 출처로 사용(불일치 제거).
--   · 이후 Guest Pass 원본이 바뀌어도 이미 저장된 세션 금액은 유지.
--   · null = 레거시 세션 → 앱에서 10,000원 fallback (DB 일괄 update 하지 않음).
--
-- 상태: 검토용(DRAFT). 운영 Supabase 미적용. 승인 전 실행 금지.
-- 성격: idempotent(재실행 안전).
-- 선행: supabase/kdk_session_meta.sql / add_kdk_session_club_schedule_link.sql 로
--       public.kdk_session_meta 테이블이 이미 존재해야 한다.
-- ============================================================================

-- 컬럼 추가 (기존 행은 null 로 유지 — 일괄 10,000원 update 하지 않는다).
alter table public.kdk_session_meta
  add column if not exists guest_fee integer;

-- 음수 금지 제약 (재실행 안전: 존재 여부 확인 후 추가).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.kdk_session_meta'::regclass
       and conname = 'kdk_session_meta_guest_fee_nonnegative'
  ) then
    alter table public.kdk_session_meta
      add constraint kdk_session_meta_guest_fee_nonnegative
      check (guest_fee is null or guest_fee >= 0);
  end if;
end $$;

comment on column public.kdk_session_meta.guest_fee is
  'KDK 세션 게스트비 snapshot(원). 신규 세션 생성/정모 연결 시 정모 게스트비를 초기값으로 저장. '
  'null = 레거시 세션 → 앱에서 10,000원 fallback. 정산/표시는 이 값을 단일 출처로 사용.';
-- ============================================================================
