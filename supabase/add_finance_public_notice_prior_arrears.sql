-- ────────────────────────────────────────────────────────────────────────────
-- TEYEON Finance — 공개 공지 RPC 확장: 이전 월 이월 미납 passthrough
--
-- 목적: get_public_finance_notice 가 snapshot_data 의 선택 필드만 반환하므로, 새로 추가한
--       priorArrears / priorArrearsStats / overallOutstandingAmount 를 공개 응답에 함께 전달한다.
--       (선택 월 회비 현황 + 이전 월 이월 미납을 한 공지에서 공개 화면이 표시할 수 있도록)
--
-- 호환: 모든 신규 필드는 snapshot_data 에 없으면 빈 배열/null 로 coalesce → 구버전 공지도 정상.
--       기존 공지 스냅샷/데이터는 변경하지 않는다. 공개 컬럼 정책(member_id/연락처/메모 미반환)은 유지.
--
-- ⚠️ 자동 실행 금지. Supabase SQL Editor 에서 1회 실행(create or replace 라 재실행 안전).
--    add_finance_public_notices.sql 의 함수를 덮어쓰지 않고 동일 시그니처로 재정의(확장)한다.
--    적용 후: notify pgrst, 'reload schema';
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.get_public_finance_notice(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.finance_public_notices%rowtype;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    return null;
  end if;

  select * into v
    from public.finance_public_notices
   where token = p_token
     and is_active = true
   limit 1;

  if v.id is null then
    return null;
  end if;

  -- 공개 데이터는 스냅샷(고정)에서만. 실명·항목·금액·상태·사유·집계 + 이전 월 이월 미납만 포함.
  return jsonb_build_object(
    'title',         v.title,
    'targetYear',    v.target_year,
    'targetMonth',   v.target_month,
    'referenceDate', to_char(v.reference_date, 'YYYY-MM-DD'),
    'publicNote',    v.public_note,
    'stats',    coalesce(v.snapshot_data -> 'stats', '{}'::jsonb),
    'members',  coalesce(v.snapshot_data -> 'members', '[]'::jsonb),
    'excluded', coalesce(v.snapshot_data -> 'excluded', '[]'::jsonb),
    'paymentAccount', coalesce(v.snapshot_data -> 'paymentAccount', 'null'::jsonb),
    -- 이전 월 이월 미납(선택 월보다 이전, 같은 연도). 구버전 공지엔 없을 수 있어 빈 배열/null 허용.
    'priorArrears',            coalesce(v.snapshot_data -> 'priorArrears', '[]'::jsonb),
    'priorArrearsStats',       coalesce(v.snapshot_data -> 'priorArrearsStats', 'null'::jsonb),
    'overallOutstandingAmount', coalesce(v.snapshot_data -> 'overallOutstandingAmount', 'null'::jsonb)
  );
end;
$$;

revoke execute on function public.get_public_finance_notice(text) from public;
grant  execute on function public.get_public_finance_notice(text) to anon, authenticated;

comment on function public.get_public_finance_notice(text) is
  'TEYEON 재무 공개 공지 RPC. is_active=true 토큰만 조회. 스냅샷 공개 필드(+이전 월 이월 미납)만 반환. 내부 컬럼 미반환.';
