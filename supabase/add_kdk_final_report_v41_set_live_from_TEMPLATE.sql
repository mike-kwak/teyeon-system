-- ============================================================================
-- TEYEON FINAL REPORT V4.1 — 정산 공개 기준일 설정(템플릿 · 운영자 승인 후에만 실행)
--   ⚠ 아래 'YYYY-MM-DD' 를 운영자가 승인한 "실제 Finance 기록으로 정산을 공개할 첫 공식 회차 날짜"로 바꾼 뒤 실행한다.
--     바꾸지 않고 실행하면 날짜 형식 오류로 실패한다(아무것도 바뀌지 않음) — 잘못된 기준일이 들어가는 것을 막기 위함.
--   · 이 날짜 이전 공식 회차: 레거시(운영 확인 · 수납 완료) — 개인별 금액 · 명단 없이 안내만, 납부 기록을 만들지 않는다.
--   · 이 날짜(포함) 이후 회차: 발행 시점 Finance · 게스트 납부 · 확인 기록으로 회원 전용 스냅샷 생성.
--   · 설정 전에는 모든 V4.1 리포트의 정산 장이 '기준 미설정' 안내만 보인다(금액 · 명단 없음).
--   · 이미 발행한 리포트의 스냅샷은 바뀌지 않는다(기준 변경 후 반영하려면 재발행 = 새 판, 이전 판 보존).
-- ============================================================================
insert into public.kdk_final_report_settings (key, value_date, note, updated_by)
values ('settlement_live_from', DATE 'YYYY-MM-DD', '운영자 승인: <승인 일시 · 승인자>', 'sql-editor')
on conflict (key) do update set value_date = excluded.value_date, note = excluded.note, updated_at = now(), updated_by = excluded.updated_by;

select key, value_date, note, updated_at from public.kdk_final_report_settings;
