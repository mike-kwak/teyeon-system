-- ============================================================================
--  대회 문자 안내 센터 — 되돌리기(이번에 만든 함수 7개 · 테이블 2개만 지운다)
--
--  ⚠ 참가 신청 · 팀 · 조편성 · 경기 · DRAW · 일정 등 기존 객체는 건드리지 않는다.
--  ⚠ 저장한 문자 템플릿 · URL · 주소록 스냅샷 · 발송 기록이 함께 사라진다(되살릴 수 없다).
-- ============================================================================

begin;

drop function if exists public.set_sms_log_status(text,uuid,text,text);
drop function if exists public.add_sms_log(text,text,text,text,text,text,integer,text,text);
drop function if exists public.save_sms_snapshot(text,jsonb,integer,integer);
drop function if exists public.save_sms_url(text,text,text);
drop function if exists public.save_sms_template(text,text,text,text,integer,boolean);
drop function if exists public.get_admin_sms_center(text);
drop function if exists public.hosted_tournament_sms_lock_settings(uuid);

drop table if exists public.hosted_tournament_sms_logs;
drop table if exists public.hosted_tournament_sms_settings;

notify pgrst, 'reload schema';

commit;
