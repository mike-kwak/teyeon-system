-- =============================================================================
-- KDK 36 rollback — 김영호 부회장 KDK 관리자 등록 해제(1행만)   [승인 후에만 실행]
--   v_expected_fp 에 등록 때 쓴 계정 지문(12자리)을 넣는다. 그 계정 행 1개만 삭제 — 다른 관리자 · 권한 · 데이터 무변경.
--   이미 없으면 아무것도 하지 않는다(재실행 안전). 해제 즉시 관리자 화면 · 권한이 사라진다(회원 코트 운영 권한은 그대로).
-- =============================================================================
do $kdk36_rb$
declare
  v_expected_fp constant text := '____REPLACE_WITH_T05_FINGERPRINT____';
  v_n int;
begin
  perform set_config('lock_timeout', '3s', true);
  if v_expected_fp !~ '^[0-9a-f]{12}$' then
    raise exception 'STOP KDK36 rollback: v_expected_fp 를 넣지 않음 — 변경 없음';
  end if;
  if to_regclass('public.kdk_managers') is null then
    raise notice 'KDK36 rollback: kdk_managers 없음 — 변경 없음';
    return;
  end if;
  delete from public.kdk_managers where left(md5(user_id::text), 12) = v_expected_fp;
  get diagnostics v_n = row_count;
  if v_n > 1 then
    raise exception 'STOP KDK36 rollback: 지문이 같은 행이 % 개 — 전체 취소', v_n;
  end if;
  raise notice 'KDK36 rollback: % 행 해제', v_n;
end
$kdk36_rb$;

select 'KDK36 rollback' as step, (select count(*) from public.kdk_managers) as managers;
