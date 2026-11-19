-- ────────────────────────────────────────────────────────────────────────────
-- [PREFLIGHT · READ-ONLY] KDK 벌금 운영 적용 전/후 통합 점검 — 단일 SELECT 문
--
-- 대상 작업(적용 순서):
--   ① add_finance_payment_audit_table.sql   ② add_kdk_member_penalty_payment_rpc.sql
--   ③ fix_kdk_guest_penalty_mismatch_20261110.sql (2026-11-10 게스트 벌금 3,000원 정정)
--
-- 사용법: 이 파일 전체를 Supabase SQL Editor 에 붙여 넣고 Run. 결과 1개 표(행 = 검사 항목).
--   status: PASS        = 조건 충족
--           FAIL        = 적용 중단 사유(action 의 조치 먼저)
--           NOT_APPLIED = 아직 적용 전 객체(해당 단계 전에는 정상)
--           REVIEW      = 자동 판정하지 않음 — detail 을 사람이 확인
--   각 단계 전후로 다시 실행해 상태 변화를 확인한다.
--
-- 안전성:
--   · SELECT 1문. INSERT/UPDATE/DELETE/DDL 없음.
--   · 없을 수 있는 객체(finance_payment_audit, pay_kdk_member_penalty 등)는 to_regclass/to_regprocedure 로만
--     확인하고, 그 테이블의 행 조회는 존재할 때만 query_to_xml(동적 SELECT)로 실행 → 42P01 오류 없음.
--   · 2026-11-10 정정 대상 계산도 관련 테이블이 모두 있을 때만 동적으로 실행.
--   · 개인정보 최소화: 이름 미출력, 게스트 id 는 앞 12자. 정정 SQL 입력용 청구 id(uuid)만 전체 출력.
-- 정정 대상 판정 기준은 fix_kdk_guest_penalty_mismatch_20261110_precheck_READONLY.sql 과 동일(변경 없음).
-- ────────────────────────────────────────────────────────────────────────────
with
reg as (
  select to_regclass('public.finance_payment_audit')        as audit_t,
         to_regclass('public.finance_dues_payments')        as pay_t,
         to_regclass('public.finance_dues_receivables')     as recv_t,
         to_regclass('public.kdk_guest_penalty_payments')   as guest_t,
         to_regclass('public.teyeon_archive_v1')            as arch_t,
         to_regclass('public.members')                      as mem_t,
         to_regclass('public.profiles')                     as prof_t,
         to_regprocedure('public.is_finance_manager()')     as ifm_f,
         to_regprocedure('auth.uid()')                      as uid_f,
         to_regprocedure('public.pay_kdk_member_penalty(uuid,uuid,integer)') as rpc_f,
         to_regprocedure('public.finance_payment_audit_block_mutation()')    as guard_f,
         to_regprocedure('public.mark_kdk_guest_penalty_paid(text,text)')    as gmark_f,
         to_regprocedure('public.revert_kdk_guest_penalty_paid(text,text)')  as grevert_f
),
cols as (
  select table_name, column_name, data_type, is_nullable
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('finance_dues_payments','finance_dues_receivables','kdk_guest_penalty_payments','finance_payment_audit')
),
miss as (
  select
    (select string_agg(c, ', ') from unnest(array['id','member_id','receivable_id','payment_type','amount','paid_at','is_voided',
            'voided_at','voided_by','void_reason','created_at','created_by','updated_by','updated_at']) c
      where not exists (select 1 from cols where table_name='finance_dues_payments' and column_name=c)) as pay_missing,
    (select string_agg(c, ', ') from unnest(array['id','member_id','receivable_type','amount_due','status','exemption_reason',
            'target_year','target_month','related_kdk_session_id','updated_at']) c
      where not exists (select 1 from cols where table_name='finance_dues_receivables' and column_name=c)) as recv_missing,
    (select string_agg(c, ', ') from unnest(array['id','session_id','participant_id','charge_type','participant_name_snapshot',
            'amount','status','paid_at','paid_by','cancelled_at','cancelled_by','created_at','updated_at']) c
      where not exists (select 1 from cols where table_name='kdk_guest_penalty_payments' and column_name=c)) as guest_missing,
    (select data_type from cols where table_name='finance_dues_payments' and column_name='paid_at')  as pay_paid_at_type,
    (select data_type from cols where table_name='kdk_guest_penalty_payments' and column_name='paid_at') as guest_paid_at_type
),
audit_shape as (
  select (select array_agg(column_name || ':' || data_type || ':' || is_nullable order by column_name)
            from cols where table_name = 'finance_payment_audit') as actual,
         (select array_agg(x order by x) from unnest(array[
            'id:uuid:NO','payment_id:uuid:NO','action:text:NO','old_receivable_id:uuid:YES','new_receivable_id:uuid:YES',
            'old_target_year:integer:YES','old_target_month:integer:YES','new_target_year:integer:YES','new_target_month:integer:YES',
            'reason:text:YES','changed_by:uuid:YES','changed_at:timestamp with time zone:NO']) x) as expected
),
-- 2026-11-10 정정 대상(precheck 와 동일 기준) — 관련 테이블이 모두 있을 때만 동적 실행
cor_x as (
  select case when r.recv_t is not null and r.pay_t is not null and r.mem_t is not null
                   and r.arch_t is not null and r.guest_t is not null then
    query_to_xml($q$
      with norm as (
        select m.id,
               lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                 coalesce(m.nickname,''), '^manual-guest-','','i'), '\s*\(G\)\s*$','','i'), '\s+g$','','i'), '\s+','','g')) as name_key
          from public.members m
      ), rv as (
        select rv.*, n.name_key, a.raw_data->'settlement_data' as sd
          from public.finance_dues_receivables rv
          join norm n on n.id = rv.member_id
          join public.teyeon_archive_v1 a on a.id = rv.related_kdk_session_id
         where rv.receivable_type = 'penalty'
           and a.is_official is true and a.is_test is not true
           and jsonb_typeof(a.raw_data->'settlement_data') = 'array'
           and coalesce(nullif(a.raw_data->>'date',''), a.created_at::date::text) = '2026-11-10'
           and not exists (select 1 from jsonb_array_elements(a.raw_data->'settlement_data') e
                            where e->>'player_id' = rv.member_id::text)
      ), g as (
        select rv.id as recv_id, e as entry
          from rv, jsonb_array_elements(rv.sd) e
         where coalesce((e->>'is_guest')::boolean,false)
           and coalesce((e->>'penalty_amount')::int,0) < 0
           and lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                 coalesce(e->>'player_name',''), '^manual-guest-','','i'), '\s*\(G\)\s*$','','i'), '\s+g$','','i'), '\s+','','g')) = rv.name_key
      ), p as (
        select p.receivable_id, count(*) as cnt, sum(p.amount) as total,
               bool_and(p.paid_at = (p.created_at at time zone 'Asia/Seoul')::date) as date_ok
          from public.finance_dues_payments p where p.is_voided = false group by p.receivable_id
      ), t as (
        select rv.id as recv_id, rv.amount_due, rv.status as recv_status,
               (select count(*) from norm n2 where n2.name_key = rv.name_key) as member_name_unique,
               (select count(*) from g where g.recv_id = rv.id) as guest_match_count,
               (select left(g.entry->>'player_id',12) from g where g.recv_id = rv.id limit 1) as guest_pid12,
               exists (select 1 from g join public.members m2 on m2.id::text = g.entry->>'player_id' where g.recv_id = rv.id) as guest_pid_is_member,
               (select abs((g.entry->>'penalty_amount')::int) from g where g.recv_id = rv.id limit 1) as guest_archive_amt,
               coalesce(p.cnt,0) as valid_payment_count, coalesce(p.total,0) as valid_payment_sum, p.date_ok as paid_date_ok,
               gp.status as guest_row_status, gp.amount as guest_row_amount
          from rv
          left join p on p.receivable_id = rv.id
          left join public.kdk_guest_penalty_payments gp
            on gp.session_id = rv.related_kdk_session_id and gp.charge_type = 'penalty'
           and gp.participant_id = (select g.entry->>'player_id' from g where g.recv_id = rv.id limit 1)
         order by rv.id limit 1
      )
      select (select count(*) from rv) as cand_count,
             (select string_agg(id::text, ',' order by id) from rv) as cand_ids, t.*
        from (select 1) one left join t on true
    $q$, true, true, '')
  end as x
  from reg r
),
cor as (
  select x,
         nullif((xpath('/row/cand_count/text()', x))[1]::text, '')::int          as cand_count,
         (xpath('/row/cand_ids/text()', x))[1]::text                             as cand_ids,
         (xpath('/row/recv_id/text()', x))[1]::text                              as recv_id,
         nullif((xpath('/row/amount_due/text()', x))[1]::text, '')::int          as amount_due,
         (xpath('/row/recv_status/text()', x))[1]::text                          as recv_status,
         nullif((xpath('/row/member_name_unique/text()', x))[1]::text, '')::int  as member_name_unique,
         nullif((xpath('/row/guest_match_count/text()', x))[1]::text, '')::int   as guest_match_count,
         (xpath('/row/guest_pid12/text()', x))[1]::text                          as guest_pid12,
         (xpath('/row/guest_pid_is_member/text()', x))[1]::text                  as guest_pid_is_member,
         nullif((xpath('/row/guest_archive_amt/text()', x))[1]::text, '')::int   as guest_archive_amt,
         nullif((xpath('/row/valid_payment_count/text()', x))[1]::text, '')::int as valid_payment_count,
         nullif((xpath('/row/valid_payment_sum/text()', x))[1]::text, '')::int   as valid_payment_sum,
         (xpath('/row/paid_date_ok/text()', x))[1]::text                         as paid_date_ok,
         (xpath('/row/guest_row_status/text()', x))[1]::text                     as guest_row_status,
         nullif((xpath('/row/guest_row_amount/text()', x))[1]::text, '')::int    as guest_row_amount
    from cor_x
),
-- 감사 테이블 행 조회(존재할 때만)
aud as (
  select case when r.audit_t is not null then
           nullif((xpath('/row/n/text()', query_to_xml('select count(*) as n from public.finance_payment_audit', true, true, '')))[1]::text, '')::int
         end as total_rows,
         case when r.audit_t is not null and c.recv_id is not null then
           nullif((xpath('/row/n/text()', query_to_xml(format($q$
             select count(*) as n from public.finance_payment_audit au
              where au.action = 'KDK_GUEST_MISMATCH_TRANSFER_V1' and au.old_receivable_id = %L::uuid
                and not exists (select 1 from public.finance_payment_audit rb
                                 where rb.action = 'KDK_GUEST_MISMATCH_TRANSFER_V1_ROLLBACK'
                                   and rb.payment_id = au.payment_id and rb.changed_at > au.changed_at)
           $q$, c.recv_id), true, true, '')))[1]::text, '')::int
         end as applied_rows
    from reg r, cor c
),
checks(ord, area, check_id, item, status, detail, action) as (
  -- ── 0. 공통 선행 조건 ────────────────────────────────────────────────────
  select 10, '0_PREREQ', 'PRE01', 'is_finance_manager() 존재',
         case when ifm_f is not null then 'PASS' else 'FAIL' end,
         coalesce(ifm_f::text, 'NULL'), case when ifm_f is null then 'add_manual_finance_management.sql 선행 필요' end
    from reg
  union all
  select 11, '0_PREREQ', 'PRE02', 'is_finance_manager() SECURITY DEFINER + search_path 고정',
         case when p.prosecdef and array_to_string(p.proconfig, ',') ilike '%search_path%' then 'PASS'
              when r.ifm_f is null then 'FAIL' else 'REVIEW' end,
         'secdef=' || coalesce(p.prosecdef::text,'?') || ' config=' || coalesce(array_to_string(p.proconfig, ','), 'NULL'), null
    from reg r left join pg_proc p on p.oid = r.ifm_f
  union all
  select 12, '0_PREREQ', 'PRE03', 'is_finance_manager() 역할 = CEO/ADMIN/FINANCE_MANAGER (앱 canManageFinance 와 동일)',
         case when r.ifm_f is null then 'FAIL'
              when d ilike '%''CEO''%' and d ilike '%''ADMIN''%' and d ilike '%''FINANCE_MANAGER''%' then 'REVIEW'
              else 'FAIL' end,
         left(regexp_replace(coalesce(d,'NULL'), '\s+', ' ', 'g'), 400),
         '세 역할 문자열은 확인됨 — 다른 역할이 추가돼 있지 않은지 본문을 눈으로 확인'
    from reg r left join lateral (select pg_get_functiondef(r.ifm_f) as d) f on true
  union all
  select 13, '0_PREREQ', 'PRE04', 'auth.uid() 존재',
         case when uid_f is not null then 'PASS' else 'FAIL' end, coalesce(uid_f::text,'NULL'), null from reg
  union all
  select 14, '0_PREREQ', 'PRE05', '필수 테이블(payments/receivables/guest/archive/members/profiles)',
         case when pay_t is not null and recv_t is not null and guest_t is not null and arch_t is not null
                   and mem_t is not null and prof_t is not null then 'PASS' else 'FAIL' end,
         concat_ws(' ', 'payments=' || coalesce(pay_t::text,'NULL'), 'receivables=' || coalesce(recv_t::text,'NULL'),
                   'guest=' || coalesce(guest_t::text,'NULL'), 'archive=' || coalesce(arch_t::text,'NULL'),
                   'members=' || coalesce(mem_t::text,'NULL'), 'profiles=' || coalesce(prof_t::text,'NULL')), null
    from reg
  union all
  select 15, '0_PREREQ', 'PRE06', '필수 컬럼(누락 없음) · paid_at 타입',
         case when pay_missing is null and recv_missing is null and guest_missing is null
                   and pay_paid_at_type = 'date' and guest_paid_at_type = 'timestamp with time zone' then 'PASS' else 'FAIL' end,
         concat_ws(' | ', 'payments 누락=' || coalesce(pay_missing,'없음'), 'receivables 누락=' || coalesce(recv_missing,'없음'),
                   'guest 누락=' || coalesce(guest_missing,'없음'),
                   'payments.paid_at=' || coalesce(pay_paid_at_type,'NULL'), 'guest.paid_at=' || coalesce(guest_paid_at_type,'NULL')),
         case when pay_missing is not null or recv_missing is not null or guest_missing is not null
              then 'add_finance_v2_security_hardening.sql / add_kdk_penalty_finance_link.sql / add_kdk_guest_penalty_payments.sql 적용 상태 확인' end
    from miss
  union all
  select 16, '0_PREREQ', 'PRE07', 'receivables.status CHECK 에 exempt·not_target 포함',
         case when exists (select 1 from pg_constraint c where c.conrelid = r.recv_t and c.contype = 'c'
                            and pg_get_constraintdef(c.oid) ilike '%not_target%' and pg_get_constraintdef(c.oid) ilike '%exempt%')
              then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(pg_get_constraintdef(c.oid), ' ; ') from pg_constraint c
                    where c.conrelid = r.recv_t and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%status%'), 'NULL'), null
    from reg r
  union all
  select 17, '0_PREREQ', 'PRE08', 'kdk_guest_penalty_payments UNIQUE(session_id, participant_id, charge_type) · status(paid/cancelled)',
         case when exists (select 1 from pg_constraint c where c.conrelid = r.guest_t and c.contype = 'u'
                            and pg_get_constraintdef(c.oid) ilike '%session_id%participant_id%charge_type%')
               and exists (select 1 from pg_constraint c where c.conrelid = r.guest_t and c.contype = 'c'
                            and pg_get_constraintdef(c.oid) ilike '%paid%' and pg_get_constraintdef(c.oid) ilike '%cancelled%')
              then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(pg_get_constraintdef(c.oid), ' ; ') from pg_constraint c
                    where c.conrelid = r.guest_t and c.contype in ('u','c')), 'NULL'), null
    from reg r
  union all
  select 18, '0_PREREQ', 'PRE09', 'RLS 활성: payments · receivables',
         case when (select bool_and(relrowsecurity) from pg_class where oid in (r.pay_t, r.recv_t)) then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(relname || ' rls=' || relrowsecurity || ' force=' || relforcerowsecurity, ', ')
                     from pg_class where oid in (r.pay_t, r.recv_t)), 'NULL'), null
    from reg r
  union all
  select 19, '0_PREREQ', 'PRE10', 'payments 쓰기 RLS 정책 = is_finance_manager()',
         'REVIEW',
         coalesce((select string_agg(polname || '[' || polcmd::text || '] using=' || coalesce(pg_get_expr(polqual, polrelid),'-')
                                     || ' check=' || coalesce(pg_get_expr(polwithcheck, polrelid),'-'), ' ; ' order by polname)
                     from pg_policy where polrelid = r.pay_t), '정책 없음'),
         'INSERT(a)/UPDATE(w)/DELETE(d) 정책이 is_finance_manager() 만 허용하는지 확인 — RPC 권한 조건과 같아야 권한 확대 없음'
    from reg r
  union all
  select 20, '0_PREREQ', 'PRE11', 'payments·receivables 사용자 트리거 없음',
         case when not exists (select 1 from pg_trigger where tgrelid in (r.pay_t, r.recv_t) and not tgisinternal) then 'PASS' else 'REVIEW' end,
         coalesce((select string_agg(tgrelid::regclass::text || '.' || tgname, ', ') from pg_trigger
                    where tgrelid in (r.pay_t, r.recv_t) and not tgisinternal), '없음'),
         case when exists (select 1 from pg_trigger where tgrelid in (r.pay_t, r.recv_t) and not tgisinternal)
              then '트리거가 RPC/정정 SQL 의 INSERT/UPDATE 에 영향 주는지 확인' end
    from reg r
  union all
  select 21, '0_PREREQ', 'PRE12', 'public 기본 함수 권한(anon EXECUTE 자동 부여 여부)',
         'REVIEW',
         coalesce((select string_agg(defaclrole::regrole::text || ': ' || defaclacl::text, ' ; ') from pg_default_acl
                    where defaclobjtype = 'f' and defaclnamespace = 'public'::regnamespace), '설정 없음'),
         'anon=X 가 있으면 신규 함수에 anon EXECUTE 자동 부여 → RPC SQL 의 revoke from anon 필수(포함됨). 적용 후 RPC03 으로 확인'
  union all
  select 22, '0_PREREQ', 'PRE13', 'public 기본 테이블 권한(anon 자동 부여 여부)',
         'REVIEW',
         coalesce((select string_agg(defaclrole::regrole::text || ': ' || defaclacl::text, ' ; ') from pg_default_acl
                    where defaclobjtype = 'r' and defaclnamespace = 'public'::regnamespace), '설정 없음'),
         '감사 migration 이 anon/authenticated 권한을 모두 회수 후 SELECT 만 부여. 적용 후 AUD05 로 확인'
  union all
  select 23, '0_PREREQ', 'PRE14', '이미 초과 납부된 KDK 회원 벌금 청구 0건',
         case when n = 0 then 'PASS' else 'REVIEW' end, n || '건',
         case when n > 0 then '초과 납부 청구 별도 정정 필요(이번 적용과 무관하나 RPC 는 이 청구를 already_paid 로 처리)' end
    from (select count(*) as n from (
            select r.id from public.finance_dues_receivables r
              join public.finance_dues_payments p on p.receivable_id = r.id and p.is_voided = false
             where r.receivable_type = 'penalty'
             group by r.id, r.amount_due having sum(p.amount) > r.amount_due) z) o
  union all
  select 24, '0_PREREQ', 'PRE15', '게스트 납부 RPC(mark/revert) 존재 — 변경 대상 아님, 회귀 기준',
         case when gmark_f is not null and grevert_f is not null then 'PASS' else 'REVIEW' end,
         'mark=' || coalesce(gmark_f::text,'NULL') || ' revert=' || coalesce(grevert_f::text,'NULL'), null
    from reg
  -- ── ① 감사 테이블 ─────────────────────────────────────────────────────────
  union all
  select 30, '1_AUDIT', 'AUD01', 'finance_payment_audit 존재',
         case when audit_t is null then 'NOT_APPLIED' else 'PASS' end,
         coalesce(audit_t::text, 'NULL — add_finance_payment_audit_table.sql 적용 전'),
         case when audit_t is null then '①단계에서 생성(정정 SQL 은 이 테이블 없으면 AUDIT_TABLE_MISSING 으로 중단)' end
    from reg
  union all
  select 31, '1_AUDIT', 'AUD02', '이름 충돌 없음: finance_payment_audit_block_mutation()',
         case when r.audit_t is null and r.guard_f is not null then 'FAIL'
              when r.audit_t is null then 'NOT_APPLIED'
              when r.guard_f is not null then 'PASS' else 'FAIL' end,
         coalesce(r.guard_f::text, 'NULL'),
         case when r.audit_t is null and r.guard_f is not null then '테이블 없이 같은 이름 함수가 존재 → migration 의 create function 실패. 원인 확인'
              when r.audit_t is not null and r.guard_f is null then '추가 전용 트리거 함수 없음 → migration 이 아닌 다른 경로로 생성된 테이블. 수동 확인' end
    from reg r
  union all
  select 32, '1_AUDIT', 'AUD03', '컬럼 구조 = 정정 SQL 기대값',
         case when r.audit_t is null then 'NOT_APPLIED' when s.actual = s.expected then 'PASS' else 'FAIL' end,
         case when r.audit_t is null then '-' else array_to_string(s.actual, ', ') end,
         case when r.audit_t is not null and s.actual is distinct from s.expected then '구조 불일치 — migration 은 덮어쓰지 않고 중단함. 원인 확인' end
    from reg r, audit_shape s
  union all
  select 33, '1_AUDIT', 'AUD04', 'RLS on · SELECT 정책 1개(is_finance_manager) · 쓰기 정책 없음',
         case when r.audit_t is null then 'NOT_APPLIED'
              when (select relrowsecurity from pg_class where oid = r.audit_t)
               and (select count(*) from pg_policy where polrelid = r.audit_t) = 1
               and exists (select 1 from pg_policy where polrelid = r.audit_t and polcmd = 'r'
                            and pg_get_expr(polqual, polrelid) ilike '%is_finance_manager%') then 'PASS'
              else 'FAIL' end,
         case when r.audit_t is null then '-' else coalesce((select string_agg(polname || '[' || polcmd::text || '] ' || coalesce(pg_get_expr(polqual, polrelid),'-'), ' ; ')
                                                              from pg_policy where polrelid = r.audit_t), '정책 없음') end, null
    from reg r
  union all
  select 34, '1_AUDIT', 'AUD05', '권한: anon 없음 · authenticated SELECT 만',
         case when r.audit_t is null then 'NOT_APPLIED'
              when not has_table_privilege('anon', r.audit_t, 'SELECT') and not has_table_privilege('anon', r.audit_t, 'INSERT')
               and not has_table_privilege('anon', r.audit_t, 'UPDATE') and not has_table_privilege('anon', r.audit_t, 'DELETE')
               and has_table_privilege('authenticated', r.audit_t, 'SELECT')
               and not has_table_privilege('authenticated', r.audit_t, 'INSERT')
               and not has_table_privilege('authenticated', r.audit_t, 'UPDATE')
               and not has_table_privilege('authenticated', r.audit_t, 'DELETE') then 'PASS'
              else 'FAIL' end,
         case when r.audit_t is null then '-' else
           'anon S/I/U/D=' || has_table_privilege('anon', r.audit_t, 'SELECT') || '/' || has_table_privilege('anon', r.audit_t, 'INSERT') || '/'
             || has_table_privilege('anon', r.audit_t, 'UPDATE') || '/' || has_table_privilege('anon', r.audit_t, 'DELETE')
             || ' authenticated S/I/U/D=' || has_table_privilege('authenticated', r.audit_t, 'SELECT') || '/' || has_table_privilege('authenticated', r.audit_t, 'INSERT') || '/'
             || has_table_privilege('authenticated', r.audit_t, 'UPDATE') || '/' || has_table_privilege('authenticated', r.audit_t, 'DELETE') end, null
    from reg r
  union all
  select 35, '1_AUDIT', 'AUD06', '추가 전용 트리거 2개 · payment_id FK on delete restrict',
         case when r.audit_t is null then 'NOT_APPLIED'
              when (select count(*) from pg_trigger where tgrelid = r.audit_t and not tgisinternal
                     and tgname in ('finance_payment_audit_append_only','finance_payment_audit_no_truncate')) = 2
               and exists (select 1 from pg_constraint where conrelid = r.audit_t and contype = 'f' and confdeltype = 'r'
                            and pg_get_constraintdef(oid) ilike '%(payment_id)%') then 'PASS'
              else 'FAIL' end,
         case when r.audit_t is null then '-' else
           coalesce((select string_agg(tgname, ', ') from pg_trigger where tgrelid = r.audit_t and not tgisinternal), '트리거 없음')
           || ' | fk=' || coalesce((select string_agg(conname || ':' || confdeltype::text, ', ') from pg_constraint where conrelid = r.audit_t and contype = 'f'), '-') end, null
    from reg r
  union all
  select 36, '1_AUDIT', 'AUD07', '감사 행 수',
         case when r.audit_t is null then 'NOT_APPLIED' else 'REVIEW' end,
         case when r.audit_t is null then '-' else a.total_rows || '행' end,
         case when r.audit_t is not null then '정정 전 0행 기대. 정정 후 1행, 롤백 시 +1행' end
    from reg r, aud a
  -- ── ② 회원 벌금 납부 RPC ──────────────────────────────────────────────────
  union all
  select 40, '2_RPC', 'RPC01', 'pay_kdk_member_penalty(uuid,uuid,integer) 존재',
         case when rpc_f is null then 'NOT_APPLIED' else 'PASS' end,
         coalesce(rpc_f::text, 'NULL — add_kdk_member_penalty_payment_rpc.sql 적용 전'),
         case when rpc_f is null then '②단계에서 생성. 생성 전 앱 배포 시 회원 [납부 완료]는 "DB 업데이트 필요" 안내로 실패(잘못된 기록 없음)' end
    from reg
  union all
  select 41, '2_RPC', 'RPC02', 'SECURITY DEFINER · search_path=public, pg_temp',
         case when r.rpc_f is null then 'NOT_APPLIED'
              when p.prosecdef and array_to_string(p.proconfig, ',') ilike '%search_path=public, pg_temp%' then 'PASS' else 'FAIL' end,
         case when r.rpc_f is null then '-' else 'secdef=' || p.prosecdef || ' config=' || coalesce(array_to_string(p.proconfig, ','),'NULL') end, null
    from reg r left join pg_proc p on p.oid = r.rpc_f
  union all
  select 42, '2_RPC', 'RPC03', 'EXECUTE: anon 불가 · authenticated 가능',
         case when r.rpc_f is null then 'NOT_APPLIED'
              when not has_function_privilege('anon', r.rpc_f, 'EXECUTE') and has_function_privilege('authenticated', r.rpc_f, 'EXECUTE') then 'PASS'
              else 'FAIL' end,
         case when r.rpc_f is null then '-' else 'anon=' || has_function_privilege('anon', r.rpc_f, 'EXECUTE')
              || ' authenticated=' || has_function_privilege('authenticated', r.rpc_f, 'EXECUTE') end,
         case when r.rpc_f is not null and has_function_privilege('anon', r.rpc_f, 'EXECUTE')
              then 'revoke all on function public.pay_kdk_member_penalty(uuid,uuid,integer) from anon 재실행 필요' end
    from reg r
  union all
  select 43, '2_RPC', 'RPC04', '같은 이름 다른 시그니처(오버로드) 없음',
         case when n <= 1 then 'PASS' else 'FAIL' end, n || '개',
         case when n > 1 then 'PostgREST 호출 모호성 — 불필요한 오버로드 확인' end
    from (select count(*) as n from pg_proc where proname = 'pay_kdk_member_penalty' and pronamespace = 'public'::regnamespace) o
  -- ── ③ 2026-11-10 정정 대상 ────────────────────────────────────────────────
  union all
  select 50, '3_FIX1110', 'COR01', '정정 대상 청구 정확히 1건',
         case when c.x is null then 'FAIL' when c.cand_count = 1 then 'PASS' else 'FAIL' end,
         case when c.x is null then '관련 테이블 없음' else coalesce(c.cand_count,0) || '건 · recv_id=' || coalesce(c.cand_ids,'-') end,
         case when coalesce(c.cand_count,0) <> 1 then '0건이면 이미 다른 방식으로 정리됐는지, 2건 이상이면 대상 특정 필요 — 정정 실행 금지'
              else 'recv_id 를 정정 SQL 의 c_recv_id 에 입력' end
    from cor c
  union all
  select 51, '3_FIX1110', 'COR02', '청구 금액 3,000 · 현재 상태',
         case when c.recv_id is null then 'FAIL'
              when c.recv_status = 'not_target' then 'REVIEW'
              when c.amount_due = 3000 and c.recv_status not in ('exempt','not_target') then 'PASS' else 'FAIL' end,
         'amount_due=' || coalesce(c.amount_due::text,'-') || ' status=' || coalesce(c.recv_status,'-'),
         case when c.recv_status = 'not_target' then '이미 비대상 — 정정 적용 후 상태일 수 있음(COR09 확인)' end
    from cor c
  union all
  select 52, '3_FIX1110', 'COR03', '회원 닉네임 유일(동명 회원 없음)',
         case when c.member_name_unique = 1 then 'PASS' else 'FAIL' end, coalesce(c.member_name_unique::text,'-') || '명', null
    from cor c
  union all
  select 53, '3_FIX1110', 'COR04', '같은 이름 게스트 벌금 항목 1개 · 게스트 id 가 회원 id 아님 · Archive 금액 3,000',
         case when c.guest_match_count = 1 and c.guest_pid_is_member = 'false' and c.guest_archive_amt = 3000 then 'PASS' else 'FAIL' end,
         'match=' || coalesce(c.guest_match_count::text,'-') || ' pid12=' || coalesce(c.guest_pid12,'-')
           || ' pid_is_member=' || coalesce(c.guest_pid_is_member,'-') || ' archive_amt=' || coalesce(c.guest_archive_amt::text,'-'), null
    from cor c
  union all
  select 54, '3_FIX1110', 'COR05', '회원 유효 납부 1건 · 3,000',
         case when c.valid_payment_count = 1 and c.valid_payment_sum = 3000 then 'PASS'
              when c.valid_payment_count = 0 and c.recv_status = 'not_target' then 'REVIEW' else 'FAIL' end,
         'count=' || coalesce(c.valid_payment_count::text,'-') || ' sum=' || coalesce(c.valid_payment_sum::text,'-'),
         case when c.valid_payment_count = 0 and c.recv_status = 'not_target' then '정정 적용 후 상태로 보임(COR09 확인)' end
    from cor c
  union all
  select 55, '3_FIX1110', 'COR06', '회원 납부 paid_at = created_at 의 KST 날짜(사후 수정 없음)',
         case when c.paid_date_ok = 'true' then 'PASS' when c.valid_payment_count = 0 then 'REVIEW' else 'FAIL' end,
         'date_ok=' || coalesce(c.paid_date_ok,'-'),
         case when c.paid_date_ok = 'false' then '납부일이 수정된 기록 — 정정 SQL 이 PAID_DATE_EDITED 로 중단. 실제 납부 시각 수동 판단 필요' end
    from cor c
  union all
  select 56, '3_FIX1110', 'COR07', '게스트 납부 행 상태(없음/cancelled → 신규 paid, paid → 보존)',
         case when c.guest_row_status is null or c.guest_row_status = 'cancelled' then 'PASS'
              when c.guest_row_status = 'paid' and c.guest_row_amount = 3000 then 'REVIEW'
              else 'FAIL' end,
         'guest_row=' || coalesce(c.guest_row_status,'없음') || ' amount=' || coalesce(c.guest_row_amount::text,'-'),
         case when c.guest_row_status = 'paid' then '이미 게스트 납부 존재 — 정정 SQL 은 게스트 행 보존, 회원 납부만 취소(정정 후 상태일 수도 있음: COR09)' end
    from cor c
  union all
  select 57, '3_FIX1110', 'COR08', '감사 테이블 준비(정정 SQL 실행 전제)',
         case when r.audit_t is null then 'NOT_APPLIED' else 'PASS' end,
         coalesce(r.audit_t::text,'NULL'), case when r.audit_t is null then '①감사 테이블 migration 먼저' end
    from reg r
  union all
  select 58, '3_FIX1110', 'COR09', '정정 적용 여부(롤백되지 않은 감사 행)',
         case when r.audit_t is null then 'NOT_APPLIED'
              when c.recv_id is null then 'FAIL'
              when a.applied_rows = 0 then 'PASS'
              else 'REVIEW' end,
         case when r.audit_t is null then '감사 테이블 없음 — 적용 이력 없음'
              else 'applied_rows=' || coalesce(a.applied_rows::text,'-') end,
         case when a.applied_rows > 0 then '이미 적용됨 — 재실행 불필요(재실행 시 ALREADY_APPLIED 로 변경 없음). verify SQL 로 결과 확인' end
    from reg r, cor c, aud a
)
select ord, area, check_id, item, status, detail, action
  from checks
 order by ord;
