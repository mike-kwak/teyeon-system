-- ============================================================================
-- TEYEON KDK FINAL REPORT V4.1 — rollback
--   · 함수 · 트리거를 제거해 V4.1 발행 · 회원 정산 조회를 멈춘다(기존 발행 함수 · 공개 조회는 그대로 동작).
--   · 데이터 보존 원칙: 이력 · 스냅샷 · 확인 기록 표에 행이 하나라도 있으면 표는 지우지 않는다(NOTICE 로 알림).
--     V4.1 발행 전(표가 비었거나 설치 시 복사한 판본뿐)일 때만 표까지 제거한다.
--   · kdk_final_reports · 기존 발행본은 건드리지 않는다.
-- ============================================================================
drop function if exists public.get_kdk_final_report_settlement(text);
drop function if exists public.publish_kdk_final_report_v41(text, uuid, jsonb, text, integer, jsonb);
drop function if exists public.get_kdk_final_report_v41_context(text, uuid);
drop function if exists public.kdk_fr_settlement_problem(jsonb);
drop function if exists public.kdk_can_view_settlement(uuid);
drop trigger if exists kdk_fr_capture_revision on public.kdk_final_reports;
drop function if exists public.kdk_fr_capture_revision();

do $$
declare v_set bigint := 0; v_rev3 bigint := 0; v_rev bigint := 0; v_rev_unknown bigint := 0; v_reviews bigint := 0;
begin
  if to_regclass('public.kdk_final_report_settlements') is not null then
    execute 'select count(*) from public.kdk_final_report_settlements' into v_set;
  end if;
  if to_regclass('public.kdk_settlement_reviews') is not null then
    execute 'select count(*) from public.kdk_settlement_reviews' into v_reviews;
  end if;
  if to_regclass('public.kdk_final_report_revisions') is not null then
    execute 'select count(*), count(*) filter (where edition = 3) from public.kdk_final_report_revisions' into v_rev, v_rev3;
    -- 설치 시 복사한 판본 = 현재 kdk_final_reports 의 판과 같은 것. 그 외 판(이후 재발행 이력)이 있으면 보존한다.
    execute 'select count(*) from public.kdk_final_report_revisions v
              where not exists (select 1 from public.kdk_final_reports r where r.id = v.report_id and r.revision = v.revision)' into v_rev_unknown;
  end if;

  if v_set = 0 then
    drop table if exists public.kdk_final_report_settlements;
  else
    raise notice 'kept kdk_final_report_settlements (% rows)', v_set;
  end if;
  if v_reviews = 0 then
    drop table if exists public.kdk_settlement_reviews;
  else
    raise notice 'kept kdk_settlement_reviews (% rows)', v_reviews;
  end if;
  if v_rev3 = 0 and v_rev_unknown = 0 then
    drop table if exists public.kdk_final_report_revisions;
  else
    raise notice 'kept kdk_final_report_revisions (% rows, edition3 %, history %)', v_rev, v_rev3, v_rev_unknown;
  end if;
end
$$;

-- 운영 설정 표(기준일): 설정된 값이 있으면 보존(재설치 시 같은 기준), 비어 있으면 제거.
do $$
declare v_n bigint := 0;
begin
  if to_regclass('public.kdk_final_report_settings') is not null then
    execute 'select count(*) from public.kdk_final_report_settings' into v_n;
    if v_n = 0 then drop table public.kdk_final_report_settings; else raise notice 'kept kdk_final_report_settings (% rows)', v_n; end if;
  end if;
end
$$;

-- 표가 남아 있으면 보호 트리거 함수도 남긴다(남은 표의 insert-only 보호 유지).
do $$
begin
  if to_regclass('public.kdk_final_report_revisions') is null and to_regclass('public.kdk_final_report_settlements') is null
     and to_regclass('public.kdk_settlement_reviews') is null then
    drop function if exists public.kdk_fr_append_only_guard();
    drop function if exists public.kdk_fr_edition_of(jsonb);
  end if;
end
$$;
