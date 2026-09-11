-- =============================================================================
-- QUICK VERIFY — add_hosted_tournament_payment_transitions.sql 적용 확인.
--
--   읽기 전용이다. 어떤 데이터도 변경하지 않는다.
--   상세 transition behavior 검증은 add_hosted_tournament_payment_transitions_verify.sql
--   의 LOCAL/STAGING ONLY 블록을 local/staging 에서 실행한다.
-- =============================================================================

with fn as (
    select pg_get_functiondef(p.oid) as body
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'set_tournament_registration_status'
       and pg_get_function_identity_arguments(p.oid) = 'p_registration_id uuid, p_registration_status text, p_payment_status text, p_admin_note text'
),
player_fn as (
    select pg_get_functiondef(p.oid) as body
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'set_tournament_registration_players'
),
checks as (

select 1 as seq, 'RPC exists' as check_name, '1' as expected,
       (select count(*)::text from fn) as actual

union all select 2, 'INVALID_PAYMENT_TRANSITION present', 'true',
       coalesce((select (body like '%INVALID_PAYMENT_TRANSITION%')::text from fn), '(none)')

union all select 3, 'pending -> paid present', 'true',
       coalesce((select (body like '%payment_status = ''pending''%'
                         and body like '%p_payment_status = ''paid''%')::text from fn), '(none)')

union all select 4, 'paid -> pending/refund_pending present', 'true',
       coalesce((select (body like '%payment_status = ''paid''%'
                         and body like '%p_payment_status in (''pending'', ''refund_pending'')%')::text from fn), '(none)')

union all select 5, 'refund_pending -> paid/refunded present', 'true',
       coalesce((select (body like '%payment_status = ''refund_pending''%'
                         and body like '%p_payment_status in (''paid'', ''refunded'')%')::text from fn), '(none)')

union all select 6, 'refunded terminal(no outgoing branch)', 'false',
       coalesce((select (body like '%payment_status = ''refunded''%')::text from fn), '(none)')

union all select 7, 'same-state no-op update guard present', 'true',
       coalesce((select (body like '%if v_registration_changed or v_payment_changed or v_admin_note_changed then%')::text from fn), '(none)')

union all select 8, 'admin status RPC SECURITY DEFINER', 'true',
       coalesce((select p.prosecdef::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='set_tournament_registration_status'), '(none)')

union all select 9, 'anon cannot execute admin status RPC', 'false',
       coalesce((select has_function_privilege('anon', p.oid, 'EXECUTE')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='set_tournament_registration_status'), '(none)')

union all select 10, 'authenticated can execute admin status RPC', 'true',
       coalesce((select has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='set_tournament_registration_status'), '(none)')

union all select 11, 'history action CHECK still includes payment_status', 'true',
       coalesce((select (pg_get_constraintdef(con.oid) like '%payment_status%')::text
                   from pg_constraint con join pg_class c on c.oid=con.conrelid
                  where c.relname='hosted_tournament_registration_history' and con.contype='c'
                    and con.conkey = array[(select a.attnum from pg_attribute a
                                             where a.attrelid=c.oid and a.attname='action')]), '(none)')

union all select 12, 'player-change pending/paid gate remains', 'true',
       coalesce((select (body like '%payment_status not in (''pending'', ''paid'')%')::text from player_fn), '(none)')

)
select seq, check_name, expected, actual,
       case when actual is not distinct from expected then 'PASS' else 'FAIL' end as verdict
  from checks
 order by seq;
