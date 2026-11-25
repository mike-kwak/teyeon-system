-- =============================================================================
-- MAINT-002 ROLLBACK · KDK FINAL REPORT 회원 전용 순위 공개 되돌리기   [필요할 때만 · 사용자 승인 후 실행]
--   하는 일: get_public_kdk_final_report(text) 를 MAINT-002 이전 정의(add_kdk_final_report.sql §7 원문)로 복원하고
--            MAINT-002 신규 함수 5개를 삭제한다. 표 · 데이터 · 다른 함수 무변경.
--   ⚠ 실행하면 공개 RPC 가 다시 발행 원본 전체(순위 · TOP3 · 개인 기록)와 officialSessionId 를 anon 에게 돌려준다.
--   ⚠ 새 프런트엔드는 rollback 후에도 동작한다(공개 SSR 은 프런트 쪽 투영으로 계속 순위를 숨김 · 회원 API 는 not_available → 회원도 공개본만 보임).
--   SQL Editor 에서 파일 전체를 한 번에 실행. 재실행 안전.
-- =============================================================================

create or replace function public.get_public_kdk_final_report(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rep public.kdk_final_reports%rowtype; v_a record; v_raw jsonb;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]{12,32}$' then return jsonb_build_object('ok', false, 'state', 'not_found'); end if;
  select * into v_rep from public.kdk_final_reports where public_slug = p_slug and status = 'published';
  if v_rep.id is null then return jsonb_build_object('ok', false, 'state', 'not_found'); end if;
  select a.id, a.raw_data, a.is_official, a.is_test, a.archive_type into v_a from public.teyeon_archive_v1 a where a.id = v_rep.session_id;
  if v_a.id is null or coalesce(v_a.archive_type, '') <> 'kdk' or v_a.is_official is not true or v_a.is_test is true then
    return jsonb_build_object('ok', false, 'state', 'not_found');
  end if;
  v_raw := coalesce(v_a.raw_data, '{}'::jsonb);
  if v_rep.source_signature is distinct from public.kdk_final_report_signature(v_raw) then
    return jsonb_build_object('ok', true, 'state', 'corrected',
      'title', coalesce(v_rep.public_payload->'session'->>'title', ''), 'date', coalesce(v_rep.public_payload->'session'->>'date', ''),
      'officialSessionId', v_rep.session_id);
  end if;
  return jsonb_build_object('ok', true, 'state', 'ok', 'payload', v_rep.public_payload, 'revision', v_rep.revision,
    'publishedAt', to_char(v_rep.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'officialSessionId', v_rep.session_id);
end
$$;
revoke all on function public.get_public_kdk_final_report(text) from public;
grant execute on function public.get_public_kdk_final_report(text) to anon, authenticated;

drop function if exists public.get_kdk_final_report_member(text);
drop function if exists public.kdk_fr_public_view(jsonb, jsonb);
drop function if exists public.kdk_fr_public_text(text, text[], integer);
drop function if exists public.kdk_fr_public_names(jsonb, jsonb);
drop function if exists public.kdk_fr_can_view_ranking(uuid, text);
