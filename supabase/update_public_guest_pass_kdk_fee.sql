-- ────────────────────────────────────────────────────────────────────────────
-- Guest Pass 공개 RPC — 게스트비 단일 출처(KDK 세션) 반영
--
-- 목적:
--   공용 Guest Pass 페이지가 표시하는 게스트비를 "KDK 세션 게스트비"
--   (public.kdk_session_meta.guest_fee) 단일 출처에서만 가져오도록 변경.
--   기존의 fee_amount_override → club_schedules.fee_amount → default_fee_amount
--   3단 fallback 을 게스트비 source 로 더 이상 사용하지 않는다.
--
-- 연결 규칙 (Schedule ↔ KDK 세션은 1:1):
--   kdk_session_meta.club_schedule_id 로 해당 정모(schedule)에 연결된 KDK 세션을 찾는다.
--     - 연결된 세션 0건            → guest_fee_status = 'unlinked', guest_fee = NULL
--     - 연결된 세션 2건 이상        → guest_fee_status = 'conflict', guest_fee = NULL
--     - 연결 1건 & guest_fee IS NULL → guest_fee_status = 'unset',    guest_fee = NULL
--     - 연결 1건 & guest_fee >= 0    → guest_fee_status = 'confirmed', guest_fee = 실제값(0 포함)
--
-- 비파괴(non-destructive) 원칙:
--   - 기존 반환 JSON 구조/필드/타입을 제거하거나 변경하지 않는다.
--   - fee.amount 는 하위호환을 위해 계속 반환하되, source 를 guest_fee 로 바꾼다
--     (confirmed 면 실제값, 그 외에는 0). 새 프런트는 guest_fee/guest_fee_status 를 우선 사용한다.
--   - 새 필드만 추가: fee.guest_fee (int|null), fee.guest_fee_status (text),
--     그리고 최상위 guestFeeStatus (프런트 접근 편의를 위한 별칭).
--   - SECURITY DEFINER / set search_path / token(is_active) 검증 / grant·revoke 유지.
--
-- ⚠️ 운영 반영 순서 (아직 실행하지 않음 — 코드 리뷰 후 수동 적용):
--   1) supabase/secure_public_guest_pass.sql 이 이미 적용된 상태여야 한다(기존 RPC 존재).
--   2) 이 파일을 Supabase SQL Editor 에서 1회 실행 (CREATE OR REPLACE 라 재실행 안전).
--   3) 프런트(buildGuestPassDataFromToken)는 새 필드가 없어도 안전하게 동작하므로
--      SQL 먼저 적용하든 프런트 먼저 배포하든 순서 무관(양방향 호환).
--
-- ⏪ Rollback:
--   supabase/secure_public_guest_pass.sql 의 get_public_guest_pass 정의를 다시 실행하면
--   이 변경 이전(3단 fallback) 정의로 되돌아간다. 컬럼/정책 변경은 없으므로 데이터 손실 없음.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.get_public_guest_pass(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pass        public.club_schedule_guest_passes%rowtype;
  v_schedule    public.club_schedules%rowtype;
  v_defaults    public.club_guest_pass_defaults%rowtype;
  v_show_bank   boolean;
  v_notes       jsonb;
  -- 게스트비 단일 출처(KDK 세션)
  v_kdk_count   integer;
  v_guest_fee   integer;      -- confirmed 일 때만 실제값, 그 외 NULL
  v_fee_status  text;         -- 'unlinked' | 'unset' | 'confirmed' | 'conflict'
  v_fee_compat  integer;      -- 하위호환 fee.amount (confirmed→실제값, 그 외 0)
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

  -- ── 게스트비: KDK 세션(kdk_session_meta.guest_fee) 단일 출처 ──────────────
  -- schedule ↔ KDK 세션은 1:1 (club_schedule_id UNIQUE 부분 인덱스). 방어적으로 count 확인.
  select count(*) into v_kdk_count
    from public.kdk_session_meta
   where club_schedule_id = v_schedule.id;

  if v_kdk_count = 0 then
    v_fee_status := 'unlinked';
    v_guest_fee  := null;
  elsif v_kdk_count > 1 then
    v_fee_status := 'conflict';
    v_guest_fee  := null;
  else
    select guest_fee into v_guest_fee
      from public.kdk_session_meta
     where club_schedule_id = v_schedule.id
     limit 1;
    if v_guest_fee is null then
      v_fee_status := 'unset';
    elsif v_guest_fee >= 0 then
      v_fee_status := 'confirmed';   -- 0 도 유효한 확정값
    else
      -- 음수 등 비정상값은 미설정으로 취급(fabrication 금지)
      v_fee_status := 'unset';
      v_guest_fee  := null;
    end if;
  end if;

  -- 하위호환 fee.amount: 구형 프런트가 이 필드만 읽어도 5,000/10,000 같은 임의값이
  -- 새어 나가지 않도록, confirmed 면 실제값, 그 외에는 0 으로만 채운다.
  v_fee_compat := coalesce(v_guest_fee, 0);

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
      -- 하위호환: 기존 필드/타입 유지(정수). source 만 KDK 세션으로 변경.
      -- ⚠️ amount 는 guest_fee_status = 'confirmed' 일 때만 의미가 있다(실제 게스트비).
      --    그 외 상태(unlinked/unset/conflict)에서는 0 으로 내려가지만 "무료"가 아니라 "미확정"이며,
      --    프런트는 guest_fee_status 로 분기해 amount 를 무료로 오인하지 않는다.
      'amount', v_fee_compat,
      -- 신규: 게스트비 단일 출처 값과 상태. 새 프런트는 이 두 필드를 우선 사용.
      'guest_fee',        v_guest_fee,     -- int | null (null = 미확정)
      'guest_fee_status', v_fee_status,    -- 'unlinked' | 'unset' | 'confirmed' | 'conflict'
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
    -- 최상위 별칭(프런트 접근 편의). fee.guest_fee_status 와 동일.
    'guestFeeStatus',  v_fee_status,
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
  'show_bank_account=false 면 fee.bank/note 를 NULL 로 반환. 게스트비는 KDK 세션 ' ||
  '(kdk_session_meta.guest_fee) 단일 출처에서만 가져오며 fee.guest_fee/guest_fee_status 로 상태를 함께 반환. ' ||
  '내부 컬럼(created_by 등)은 반환하지 않는다.';
