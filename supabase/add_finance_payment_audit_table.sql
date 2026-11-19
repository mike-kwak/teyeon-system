-- ────────────────────────────────────────────────────────────────────────────
-- [DRAFT · 승인 전 실행 금지] Finance 납부 감사 이력 테이블(finance_payment_audit) — 최소 단독 migration
--
-- 배경:
--   2026-11-10 게스트 벌금 정정 SQL(fix_kdk_guest_penalty_mismatch_20261110*.sql)이 감사 이력을
--   public.finance_payment_audit 에 남기는데, 운영 DB 에 이 테이블이 없다(READ-ONLY 확인: to_regclass = NULL).
--   테이블 정의는 로컬 전용 파일 add_payment_reassignment_rpc.sql(저장소 미포함)에만 있고,
--   그 파일에는 월회비 귀속월 정정 RPC(reassign_monthly_payments)도 함께 있다.
--   → 그 파일 전체를 적용하지 않고, 감사 테이블만 이 파일로 분리해 만든다(RPC 없음).
--
-- 원본 대비 컬럼은 동일(정정 SQL·원본 RPC 와 호환). 보존 강화를 위해 다음만 다르다:
--   1) payment_id FK: on delete cascade → on delete restrict
--        감사 대상 납부 행을 지우면 감사 기록까지 사라지던 것을 막는다(감사 기록이 있는 납부는 삭제 불가).
--        앱은 납부를 삭제하지 않고 soft-cancel(is_voided) 한다(deletePayment 는 정의만 있고 호출처 없음).
--   2) 추가 전용(append-only): UPDATE / DELETE / TRUNCATE 를 트리거로 거부 — 정정·롤백 기록 모두 보존.
--        (롤백은 기존 행을 고치지 않고 '_ROLLBACK' 행을 추가하는 방식이라 영향 없음)
--   3) 권한: anon/authenticated 의 테이블 권한을 모두 회수한 뒤 authenticated 에 SELECT 만 부여.
--        Supabase 는 public 스키마 신규 테이블에 anon/authenticated 권한을 자동 부여할 수 있으므로 명시 회수.
--        SELECT 도 RLS 로 운영진(is_finance_manager)만 — 일반 회원/anon 조회 불가.
--        INSERT/UPDATE/DELETE 정책 없음 → 클라이언트 직접 쓰기 불가.
--        기록은 SQL Editor(테이블 소유자 권한) 또는 SECURITY DEFINER 함수로만.
--
-- 기존 객체 처리(조용히 덮어쓰지 않음):
--   · 테이블이 없으면 → 생성 + 인덱스 + RLS + 정책 + 권한 + 추가 전용 트리거.
--   · 테이블이 이미 있으면 → 컬럼(이름·타입·NULL 허용)이 기대와 정확히 같은지 확인.
--       다르면 예외로 중단(아무것도 바꾸지 않음).
--       같으면 테이블은 건드리지 않고, 보안 설정(RLS/정책/권한/트리거)만 기대 상태와 비교해 다르면 중단.
--       → 운영자가 상황을 보고 판단하도록 NOTICE 로 안내.
--   DO 블록 1개 = 1 트랜잭션 — 중간 실패 시 전체 롤백.
--
-- 선행: public.is_finance_manager() (add_manual_finance_management.sql) · finance_dues_payments · auth.users
-- 확인: add_finance_payment_audit_table_verify.sql (READ-ONLY)
-- 되돌리기: add_finance_payment_audit_table_rollback.sql (감사 행이 1건이라도 있으면 중단)
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_expected constant text[] := array[
    'id:uuid:NO', 'payment_id:uuid:NO', 'action:text:NO',
    'old_receivable_id:uuid:YES', 'new_receivable_id:uuid:YES',
    'old_target_year:integer:YES', 'old_target_month:integer:YES',
    'new_target_year:integer:YES', 'new_target_month:integer:YES',
    'reason:text:YES', 'changed_by:uuid:YES', 'changed_at:timestamp with time zone:NO'];
  v_actual text[];
begin
  if to_regprocedure('public.is_finance_manager()') is null then
    raise exception 'PREREQ_MISSING — public.is_finance_manager() 없음';
  end if;
  if to_regclass('public.finance_dues_payments') is null then
    raise exception 'PREREQ_MISSING — public.finance_dues_payments 없음';
  end if;

  if to_regclass('public.finance_payment_audit') is not null then
    select array_agg(column_name || ':' || data_type || ':' || is_nullable order by column_name)
      into v_actual
      from information_schema.columns
     where table_schema = 'public' and table_name = 'finance_payment_audit';
    if v_actual is distinct from (select array_agg(x order by x) from unnest(v_expected) x) then
      raise exception 'AUDIT_TABLE_SHAPE_MISMATCH — 기존 finance_payment_audit 구조가 예상과 다름. 덮어쓰지 않고 중단. actual=%', v_actual;
    end if;
    if not (select relrowsecurity from pg_class where oid = 'public.finance_payment_audit'::regclass) then
      raise exception 'AUDIT_TABLE_RLS_DISABLED — 기존 테이블 RLS 비활성. 수동 확인 필요';
    end if;
    if has_table_privilege('anon', 'public.finance_payment_audit', 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated', 'public.finance_payment_audit', 'INSERT,UPDATE,DELETE') then
      raise exception 'AUDIT_TABLE_GRANTS_WIDER — 기존 테이블에 anon 또는 쓰기 권한이 있음. 수동 확인 필요';
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = 'public.finance_payment_audit'::regclass
                    and tgname = 'finance_payment_audit_append_only') then
      raise exception 'AUDIT_TABLE_NOT_APPEND_ONLY — 기존 테이블에 추가 전용 트리거 없음. 수동 확인 필요';
    end if;
    raise notice 'AUDIT_TABLE_ALREADY_OK — 기존 테이블이 기대 상태와 같음. 변경 없음';
    return;
  end if;

  -- ── 생성 ────────────────────────────────────────────────────────────────
  create table public.finance_payment_audit (
    id                uuid        primary key default gen_random_uuid(),
    payment_id        uuid        not null references public.finance_dues_payments(id) on delete restrict,
    action            text        not null check (btrim(action) <> ''),
    old_receivable_id uuid,
    new_receivable_id uuid,
    old_target_year   integer,
    old_target_month  integer,
    new_target_year   integer,
    new_target_month  integer,
    reason            text,        -- 정정 SQL 은 JSON(text) 로 이전 상태·실행자(operator)를 기록
    changed_by        uuid        references auth.users(id) on delete set null,  -- SQL Editor 실행 시 NULL(실행자는 reason.operator)
    changed_at        timestamptz not null default now()
  );
  create index finance_payment_audit_payment_idx on public.finance_payment_audit(payment_id);
  create index finance_payment_audit_action_idx  on public.finance_payment_audit(action, changed_at);

  comment on table public.finance_payment_audit is
    'Finance 납부 변경 감사 이력(추가 전용). 정정/롤백은 각각 새 행. 조회=운영진(RLS), 클라이언트 쓰기 불가.';

  -- RLS: 조회는 운영진만. 쓰기 정책 없음(= 클라이언트 쓰기 전부 거부).
  alter table public.finance_payment_audit enable row level security;
  create policy "pay_audit_select_admin" on public.finance_payment_audit
    for select using (public.is_finance_manager());

  -- 권한: 자동 부여분 포함 전부 회수 → authenticated SELECT 만.
  revoke all on table public.finance_payment_audit from public;
  revoke all on table public.finance_payment_audit from anon;
  revoke all on table public.finance_payment_audit from authenticated;
  grant select on table public.finance_payment_audit to authenticated;

  -- 추가 전용: UPDATE/DELETE/TRUNCATE 거부(테이블 소유자·SQL Editor 포함).
  create function public.finance_payment_audit_block_mutation()
  returns trigger language plpgsql set search_path = public, pg_temp as $f$
  begin
    raise exception 'AUDIT_APPEND_ONLY — finance_payment_audit 는 수정/삭제할 수 없습니다(%)', tg_op
      using errcode = '42501';
  end;
  $f$;
  revoke all on function public.finance_payment_audit_block_mutation() from public;
  revoke all on function public.finance_payment_audit_block_mutation() from anon;
  revoke all on function public.finance_payment_audit_block_mutation() from authenticated;

  create trigger finance_payment_audit_append_only
    before update or delete on public.finance_payment_audit
    for each row execute function public.finance_payment_audit_block_mutation();
  create trigger finance_payment_audit_no_truncate
    before truncate on public.finance_payment_audit
    for each statement execute function public.finance_payment_audit_block_mutation();

  raise notice 'AUDIT_TABLE_CREATED';
end
$$;

notify pgrst, 'reload schema';
