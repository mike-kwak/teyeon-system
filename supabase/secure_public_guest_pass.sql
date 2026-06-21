-- ────────────────────────────────────────────────────────────────────────────
-- Guest Pass 공개 데이터 보안 강화
--
-- 변경 요지:
--   1) 실제 예금주 컬럼(bank_account_holder) 제거
--      — 운영에는 공개용 마스킹 표시명(bank_account_holder_display)만 사용.
--   2) anon 의 club_guest_pass_defaults / club_schedule_guest_passes 직접 SELECT 차단
--      — anon 은 오직 get_public_guest_pass(p_token) RPC 만 호출 가능.
--      — 인증된 회원은 (활성 row 만) 기존처럼 직접 SELECT 가능 (member link card 동작).
--      — CEO/ADMIN 은 전체 SELECT/INSERT/UPDATE/DELETE 유지.
--   3) 공개 RPC get_public_guest_pass:
--      - security definer + 잠긴 search_path 로 권한 escalation 차단
--      - is_active=true 검증
--      - show_bank_account=false 면 fee.bank / fee.note 를 NULL 로 반환
--      - created_by / updated_by / 내부 컬럼은 반환 자체 안 함
--      - 비활성/존재하지 않는 token 은 NULL 반환
--
-- ⚠️ 이 migration 은 idempotent 로 작성. add_club_guest_pass_defaults.sql,
--    add_club_schedule_guest_passes.sql 이후에 1회 실행. 재실행 안전.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. 실제 예금주 컬럼 제거 ───────────────────────────────────────────────
-- 공개 응답에 절대 노출되지 않아야 하므로 DB 레벨에서 아예 제거 (운영 요구).
alter table public.club_guest_pass_defaults
  drop column if exists bank_account_holder;

-- ── 2. anon 직접 SELECT 차단 ──────────────────────────────────────────────
-- 2-1) club_guest_pass_defaults
--   기존 anon-허용 SELECT 정책 제거 → 인증 회원만 직접 SELECT 가능.
drop policy if exists "guest_pass_defaults_select"      on public.club_guest_pass_defaults;
drop policy if exists "guest_pass_defaults_select_auth" on public.club_guest_pass_defaults;
create policy "guest_pass_defaults_select_auth" on public.club_guest_pass_defaults
  for select using (auth.uid() is not null);

-- 2-2) club_schedule_guest_passes
--   기존 익명 활성 SELECT 정책 제거 → 인증 회원의 활성 row 만 직접 SELECT 가능.
--   CEO/ADMIN 전체 SELECT 정책(guest_pass_admin_select) 은 그대로 유지.
drop policy if exists "guest_pass_active_select"      on public.club_schedule_guest_passes;
drop policy if exists "guest_pass_active_select_auth" on public.club_schedule_guest_passes;
create policy "guest_pass_active_select_auth" on public.club_schedule_guest_passes
  for select using (auth.uid() is not null and is_active = true);

-- ── 3. 공개 전용 RPC ─────────────────────────────────────────────────────
-- token 으로 활성화된 정모 한 건의 공개 가능 필드만 반환.
-- security definer 사용 — anon 이 호출해도 함수 내부에서는 owner 권한으로 테이블 조회.
-- search_path 명시적으로 제한 (public, pg_temp) — 다른 schema 의 동명 객체로 우회 차단.
create or replace function public.get_public_guest_pass(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pass      public.club_schedule_guest_passes%rowtype;
  v_schedule  public.club_schedules%rowtype;
  v_defaults  public.club_guest_pass_defaults%rowtype;
  v_show_bank boolean;
  v_fee       integer;
  v_notes     jsonb;
begin
  if p_token is null or length(p_token) = 0 then
    return null;
  end if;

  -- 활성 pass 단건 조회
  select * into v_pass
    from public.club_schedule_guest_passes
   where public_token = p_token
     and is_active = true
   limit 1;

  if v_pass.id is null then
    return null;
  end if;

  select * into v_schedule
    from public.club_schedules
   where id = v_pass.schedule_id
   limit 1;

  if v_schedule.id is null then
    return null;
  end if;

  select * into v_defaults
    from public.club_guest_pass_defaults
   where club_key = 'TEYEON'
   limit 1;

  v_show_bank := coalesce(v_pass.show_bank_account, true);
  v_fee := coalesce(v_pass.fee_amount_override, v_schedule.fee_amount, v_defaults.default_fee_amount, 0);

  -- 운영 규칙 — defaults 에 있는 값만 jsonb 배열로 직렬화.
  v_notes := (
    select coalesce(jsonb_agg(jsonb_build_object('icon', icon, 'text', text)), '[]'::jsonb)
      from (
        select 'info'::text   as icon, v_defaults.kdk_start_notice      as text where v_defaults.kdk_start_notice      is not null and v_defaults.kdk_start_notice      <> ''
        union all
        select 'rules',                v_defaults.penalty_notice              where v_defaults.penalty_notice         is not null and v_defaults.penalty_notice         <> ''
        union all
        select 'trophy',               v_defaults.guest_prize_exclusion       where v_defaults.guest_prize_exclusion  is not null and v_defaults.guest_prize_exclusion  <> ''
        union all
        select 'time',                 v_defaults.late_or_absent_notice       where v_defaults.late_or_absent_notice  is not null and v_defaults.late_or_absent_notice  <> ''
      ) notes
  );

  return jsonb_build_object(
    'schedule', jsonb_build_object(
      'title',         v_schedule.title,
      'date',          to_char(v_schedule.schedule_date, 'YYYY-MM-DD'),
      'startTime',     case when v_schedule.start_time is null then null else to_char(v_schedule.start_time, 'HH24:MI') end,
      'endTime',       case when v_schedule.end_time   is null then null else to_char(v_schedule.end_time,   'HH24:MI') end,
      'location',      coalesce(v_schedule.location, '장소 미정'),
      'courtMode',     coalesce(v_schedule.court_mode, case when v_schedule.court_count is not null then 'fixed' else 'unknown' end),
      'courtCount',    v_schedule.court_count,
      'participation', coalesce(v_pass.participation_status, 'confirmed')
    ),
    'fee', jsonb_build_object(
      'amount', v_fee,
      -- 계좌 공개 OFF → note / bank 객체 자체를 NULL 로.
      'note',   case when v_show_bank then nullif(v_defaults.payment_note, '') else null end,
      'bank',   case
        when v_show_bank then jsonb_build_object(
          'bankName',      v_defaults.bank_name,
          'accountNumber', v_defaults.bank_account_number,
          'accountHolder', v_defaults.bank_account_holder_display
        )
        else null
      end
    ),
    'showBankAccount', v_show_bank,
    'extraNotice',     nullif(v_pass.extra_notice, ''),
    'preparation', jsonb_build_object(
      'items',                coalesce(v_defaults.preparation_items, '{}'::text[]),
      'arrivalGuideMinutes',  coalesce(v_defaults.arrival_guide_minutes, 15),
      'lateOrAbsentNotice',   coalesce(v_defaults.late_or_absent_notice, '')
    ),
    'guestNote', v_notes,
    'match', jsonb_build_object(
      'state',    'preparing',
      'title',    'KDK 경기 안내',
      'headline', coalesce(
        nullif(v_pass.match_status_headline_override, ''),
        nullif(v_defaults.match_status_headline, ''),
        '당일 대진표 공유 예정'
      ),
      'body', coalesce(
        nullif(v_pass.match_status_body_override, ''),
        nullif(v_defaults.match_status_body, ''),
        '대진표는 당일 경기이사가 편성한 뒤 앱에 등록되며, 준비가 완료되면 이 페이지에서 확인할 수 있습니다.'
      )
    ),
    'club', jsonb_build_object(
      'name',       coalesce(v_defaults.club_intro_name, 'TEYEON'),
      'paragraphs', coalesce(v_defaults.club_intro_paragraphs, '{}'::text[])
    ),
    'contactNotice', coalesce(nullif(v_defaults.contact_notice, ''), '문의사항은 초대한 회원 또는 TEYEON 운영진에게 부탁드립니다.')
  );
end;
$$;

-- 실행 권한 — 기본 public 권한을 회수하고 anon/authenticated 에만 명시 부여.
revoke execute on function public.get_public_guest_pass(text) from public;
grant  execute on function public.get_public_guest_pass(text) to anon, authenticated;

comment on function public.get_public_guest_pass(text) is
  'Guest Pass 공개 페이지 전용 RPC. is_active=true 인 token 만 조회 가능하며, ' ||
  'show_bank_account=false 면 fee.bank/note 를 NULL 로 반환. 내부 컬럼(created_by 등)은 반환하지 않는다.';
