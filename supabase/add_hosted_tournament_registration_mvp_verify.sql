-- =============================================================================
-- 검증 SQL — add_hosted_tournament_registration_mvp.sql 적용 후 확인(읽기 전용).
--   각 쿼리 옆의 "기대" 와 실제 결과가 다르면 적용이 잘못된 것이다.
--   섹션 A~L 은 읽기 전용이며, 섹션 M(경계 시나리오)만 별도 판단 후 수동 실행한다.
-- =============================================================================


-- ── A. 테이블 3개 존재 ────────────────────────────────────────────────────────
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('hosted_tournaments',
                      'hosted_tournament_registrations',
                      'hosted_tournament_registration_history')
 order by table_name;
-- 기대 3행


-- ── B. 필수 컬럼 존재 · nullable ──────────────────────────────────────────────
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'hosted_tournaments'
   and column_name in ('slug','title','subtitle','status','event_date','event_start_time',
                       'registration_open_at','registration_close_at','venue_name','organizer_name',
                       'sponsor_name','entry_fee','target_capacity','max_capacity',
                       'registration_no_prefix','contact_label','contact_phone',
                       'bank_name','bank_account','bank_holder','published_at')
 order by column_name;
-- 기대 21행. registration_close_at = NO(not null), registration_open_at = YES(nullable).

select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'hosted_tournament_registrations'
 order by ordinal_position;
-- 기대: id, tournament_id, sequence_no, registration_no,
--       player1_name, player1_phone, player1_phone_norm,
--       player2_name, player2_phone, player2_phone_norm,
--       pair_key, club_name, depositor_name, note,
--       registration_status, payment_status,
--       eligibility_confirmed_at, regulations_confirmed_at, privacy_agreed_at, media_notice_confirmed_at,
--       submitted_at, confirmed_at, cancelled_at, admin_note, created_at, updated_at
-- ⚠ club_name → is_nullable = YES (선택 입력)
-- ⚠ 4개 *_confirmed_at / privacy_agreed_at → is_nullable = NO (동의 시각 필수)
-- ⚠ 나이/합산연령/SMS 관련 컬럼이 하나도 없어야 한다.

-- 만들면 안 되는 컬럼이 섞여 들어가지 않았는지 역방향 확인.
select column_name from information_schema.columns
 where table_schema = 'public'
   and table_name in ('hosted_tournaments','hosted_tournament_registrations')
   and (column_name ~* 'age|birth|sms|message|sender' );
-- 기대 0행


-- ── C. CHECK 제약 ────────────────────────────────────────────────────────────
select con.conname, pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('hosted_tournaments','hosted_tournament_registrations','hosted_tournament_registration_history')
   and con.contype = 'c'
 order by c.relname, con.conname;
-- 기대에 포함되어야 할 것:
--   status               in (draft, published, registration_open, registration_closed, in_progress, completed, cancelled)
--   registration_status  in (applied, waitlisted, confirmed, cancelled, rejected)
--   payment_status       in (pending, paid, refund_pending, refunded)
--   action               in (submit, registration_status, payment_status, admin_note,
--                             player1_name, player1_phone, player2_name, player2_phone,
--                             club_name, depositor_name)
--                        ↑ 뒤 6종은 add_hosted_tournament_player_change.sql 적용 후에 보인다.
--                          미적용 상태라면 앞 4종만 나오는 것이 정상.
--   actor_type           in (public, admin, system)
--   player1_phone_norm / player2_phone_norm  ~ '^01[0-9]{8,9}$'
--   hosted_tournaments_capacity_order        (max_capacity >= target_capacity)
--   hosted_treg_distinct_phones              (player1_phone_norm <> player2_phone_norm)


-- ── D. 인덱스 · UNIQUE ────────────────────────────────────────────────────────
select indexname, indexdef from pg_indexes
 where schemaname = 'public'
   and tablename in ('hosted_tournaments','hosted_tournament_registrations','hosted_tournament_registration_history')
 order by tablename, indexname;
-- 기대에 포함:
--   hosted_treg_seq_unique     UNIQUE (tournament_id, sequence_no)
--   hosted_treg_no_unique      UNIQUE (tournament_id, registration_no)
--   hosted_treg_active_pair    UNIQUE (tournament_id, pair_key)
--                              WHERE registration_status = ANY (ARRAY['applied','waitlisted','confirmed'])
--   hosted_treg_tournament_seq_idx / hosted_treg_status_idx / hosted_treg_history_reg_idx

-- 전화번호 단독 전역 UNIQUE 가 실수로 생기지 않았는지 확인(정상 재접수를 막으면 안 된다).
select indexname, indexdef from pg_indexes
 where schemaname = 'public' and tablename = 'hosted_tournament_registrations'
   and indexdef ilike '%unique%'
   and (indexdef ilike '%player1_phone%' or indexdef ilike '%player2_phone%')
   and indexdef not ilike '%pair_key%';
-- 기대 0행


-- ── E. RLS 활성화 ────────────────────────────────────────────────────────────
select relname, relrowsecurity, relforcerowsecurity
  from pg_class
 where relname in ('hosted_tournaments','hosted_tournament_registrations','hosted_tournament_registration_history');
-- 기대 relrowsecurity = true (3행 모두)
-- 기대 relforcerowsecurity = false (3행 모두) — 의도된 값이다.
--   FORCE 를 켜면 테이블 소유자에게도 RLS 가 적용되어, 소유자 권한으로 동작하는
--   SECURITY DEFINER RPC(submit / get_admin_* / set_*)가 0행만 보게 되어 전부 깨진다.
--   "더 안전해 보인다"는 이유로 FORCE 를 켜지 말 것.


-- ── F. 정책은 SELECT 만, 조건은 can_manage_tournaments() ───────────────────────
select tablename, policyname, cmd, roles, qual
  from pg_policies
 where schemaname = 'public'
   and tablename in ('hosted_tournaments','hosted_tournament_registrations','hosted_tournament_registration_history')
 order by tablename, policyname;
-- 기대 3행, cmd 전부 SELECT, roles={authenticated}, qual 에 can_manage_tournaments()
-- ⚠ INSERT/UPDATE/DELETE 정책이 하나도 없어야 한다(쓰기는 RPC 전용).


-- ── G. anon 원본 테이블 권한 0 ────────────────────────────────────────────────
select table_name, privilege_type
  from information_schema.role_table_grants
 where grantee = 'anon'
   and table_name in ('hosted_tournaments','hosted_tournament_registrations','hosted_tournament_registration_history');
-- 기대 0행  ← 이 검증이 실패하면 즉시 적용을 중단하고 revoke 를 다시 실행할 것.

-- ⚠ 위 information_schema 뷰는 "현재 세션에서 활성화된 role" 이 grantor/grantee 인 항목만 보여준다.
--    그래서 0행이 "권한 없음"이 아니라 "안 보임"일 수 있다. 아래가 이 마이그레이션의 최종 P0 판정이다.
select t.tbl,
       has_table_privilege('anon', t.tbl, 'SELECT') as anon_select,
       has_table_privilege('anon', t.tbl, 'INSERT') as anon_insert,
       has_table_privilege('anon', t.tbl, 'UPDATE') as anon_update,
       has_table_privilege('anon', t.tbl, 'DELETE') as anon_delete
  from (values ('public.hosted_tournaments'),
               ('public.hosted_tournament_registrations'),
               ('public.hosted_tournament_registration_history')) as t(tbl);
-- 기대: 12개 값이 전부 false.  하나라도 true 면 개인정보가 anon 에게 열려 있는 것이다 — 즉시 중단.

-- authenticated 는 SELECT 만(INSERT/UPDATE/DELETE 없음).
select table_name, privilege_type
  from information_schema.role_table_grants
 where grantee = 'authenticated'
   and table_name in ('hosted_tournaments','hosted_tournament_registrations','hosted_tournament_registration_history')
 order by table_name, privilege_type;
-- 기대: 각 테이블 SELECT 1행씩(총 3행). INSERT/UPDATE/DELETE/TRUNCATE 가 있으면 실패.


-- ── H. RPC 실행 권한 ─────────────────────────────────────────────────────────
select p.proname,
       array_agg(distinct r.rolname order by r.rolname)
         filter (where has_function_privilege(r.oid, p.oid, 'EXECUTE')) as can_exec
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 cross join (select oid, rolname from pg_roles where rolname in ('anon','authenticated')) r
 where n.nspname = 'public'
   and p.proname in ('get_public_tournament','get_public_tournament_teams','submit_tournament_registration',
                     'get_admin_hosted_tournaments','get_admin_tournament_registrations',
                     'get_tournament_registration_history','set_tournament_registration_status',
                     'can_manage_tournaments','hosted_tournament_normalize_phone','hosted_tournament_pair_key')
 group by p.proname
 order by p.proname;
-- 기대:
--   get_public_tournament            → {anon, authenticated}
--   get_public_tournament_teams      → {anon, authenticated}
--   submit_tournament_registration   → {anon, authenticated}
--   get_admin_hosted_tournaments     → {authenticated}
--   get_admin_tournament_registrations → {authenticated}
--   get_tournament_registration_history → {authenticated}
--   set_tournament_registration_status  → {authenticated}
--   can_manage_tournaments           → {authenticated}
--   hosted_tournament_normalize_phone → NULL (아무도 직접 실행 불가 — SECURITY DEFINER 내부 전용)
--   hosted_tournament_pair_key        → NULL


-- ── I. SECURITY DEFINER + 고정 search_path ────────────────────────────────────
select p.proname, p.prosecdef as security_definer, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('get_public_tournament','get_public_tournament_teams','submit_tournament_registration',
                     'get_admin_hosted_tournaments','get_admin_tournament_registrations',
                     'get_tournament_registration_history','set_tournament_registration_status',
                     'can_manage_tournaments','hosted_tournament_normalize_phone','hosted_tournament_pair_key')
 order by p.proname;
-- 기대: 앞의 8개(RPC + can_manage_tournaments) prosecdef = true,
--       proconfig 에 {search_path=public,pg_temp}.
--       helper 2개(normalize_phone / pair_key)는 immutable + search_path 고정(정의자 권한 불필요).


-- ── J. 공개 RPC 반환 키 화이트리스트(개인정보 미노출) ──────────────────────────
--   ⚠ 시드가 draft 이면 get_public_tournament 는 NULL 을 반환하고, jsonb_object_keys(NULL) 은
--      "0행" 이 된다. 이 0행은 통과가 아니라 '아직 확인하지 못함' 이다.
--      반드시 접수를 연 뒤(또는 테스트 대회를 published 로 두고) 다시 실행해 키 목록을 눈으로 확인한다.
select jsonb_object_keys(public.get_public_tournament('2026-teyeon-open')) as key order by key;
-- 기대 키만: appliedCount, entryFee, eventDate, eventStartTime, isRegistrationOpen, maxCapacity,
--            organizerName, registrationCloseAt, registrationOpenAt, remaining, slug, sponsorName,
--            status, subtitle, targetCapacity, title, venueName, waitlistedCount
-- ⚠ id / bankAccount / bankName / bankHolder / contactPhone 가 있으면 실패.

select distinct jsonb_object_keys(elem) as key
  from jsonb_array_elements(public.get_public_tournament_teams('2026-teyeon-open')) elem
 order by key;
-- 기대 키만: clubName, player1Name, player2Name, publicStatus, sequenceNo
-- ⚠ phone / phoneNorm / pairKey / depositorName / note / adminNote / paymentStatus / id 가 있으면 실패.


-- ── K. 시드 확인(공식 요강 값) ────────────────────────────────────────────────
select slug, title, subtitle, status,
       event_date, event_start_time,
       registration_close_at at time zone 'Asia/Seoul' as close_kst,
       venue_name, organizer_name, sponsor_name,
       entry_fee, target_capacity, max_capacity, registration_no_prefix,
       bank_name, bank_holder
  from public.hosted_tournaments
 where slug = '2026-teyeon-open';
-- 기대: status='draft'(적용만으로 접수가 열리지 않는다),
--       event_date=2026-10-25, event_start_time=09:00,
--       close_kst=2026-10-19 17:00:00,
--       entry_fee=40000, target_capacity=48, max_capacity=60, prefix='TO'


-- ── L. 기존 /tournament-calendar 테이블 무변경 ────────────────────────────────
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('tournament_events','tournament_pairs','tournament_partner_requests')
 order by table_name;
-- 기대 3행 그대로 존재

select tablename, policyname, cmd, qual
  from pg_policies
 where schemaname = 'public' and tablename = 'tournament_events'
 order by policyname;
-- 기대: "Public read tournament events"(SELECT, qual=true) + "Admin write tournament events" 유지.
--       이 마이그레이션이 기존 정책을 바꾸지 않았는지 확인.

select count(*) as tournament_events_rows from public.tournament_events;
-- 기대: 적용 전 행 수와 동일

-- hosted_* 가 기존 대회 캘린더 테이블을 참조하지 않는지(도메인 분리) 확인.
select con.conname, c.relname as child, f.relname as parent
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_class f on f.oid = con.confrelid
 where con.contype = 'f' and c.relname like 'hosted_tournament%'
 order by c.relname, con.conname;
-- 기대 parent: hosted_tournaments / hosted_tournament_registrations / users(auth) 만.
--      tournament_events 가 나오면 실패.


-- =============================================================================
-- M. 세션별 실 호출 검증 (수동 — 테스트 대회로 진행 권장)
--
--   anon
--     · select * from public.hosted_tournament_registrations;           → 권한 오류 또는 0행
--     · select * from public.hosted_tournaments;                        → 권한 오류 또는 0행
--     · select public.get_public_tournament('2026-teyeon-open');        → 성공(draft 면 null)
--     · select public.get_admin_tournament_registrations('...');        → 권한 오류(실행 불가)
--     · select public.set_tournament_registration_status(...);          → 권한 오류(실행 불가)
--
--   MEMBER(일반 로그인)
--     · select * from public.hosted_tournament_registrations;           → 0행(RLS)
--     · select public.get_admin_tournament_registrations('...');        → FORBIDDEN
--     · select public.set_tournament_registration_status(...);          → FORBIDDEN
--
--   CEO / ADMIN
--     · get_admin_hosted_tournaments / get_admin_tournament_registrations → 성공
--     · set_tournament_registration_status → 성공 + history 1행 추가
--
--   접수 상태 게이트
--     · status='draft' / 'published' / 'registration_closed' 에서 submit → TOURNAMENT_NOT_OPEN
--     · registration_close_at 이후 submit                                → REGISTRATION_CLOSED
--
--   submit 응답 payload (계좌 노출 범위)
--     · applied 로 접수된 신청 응답  → bankName / bankAccount / bankHolder 포함
--     · waitlisted 로 접수된 신청 응답 → 위 3키가 없어야 한다(대기팀 입금 정책 미확정)
--     · 두 경우 모두 id / tournamentId / phone / depositorName / note 가 없어야 한다
--       확인: select jsonb_object_keys(public.submit_tournament_registration(...));  ← 테스트 대회에서만
--
--   동의·검증
--     · 4개 확인 중 하나라도 false → CONSENT_REQUIRED (행 미생성)
--     · 전화 형식 오류 → INVALID_PHONE / 두 선수 동일 번호 → SAME_PLAYER_PHONE
--     · 이름 21자 / 클럽명 41자 / 메모 301자 → FIELD_TOO_LONG
--     · 클럽명 공백 제출 → 성공, club_name IS NULL (문자열 '무소속' 이 저장되면 실패)
--
--   중복 페어(선수 순서 무관)
--     · (01011112222, 01033334444) 접수 후 (01033334444, 01011112222) 재접수 → DUPLICATE_REGISTRATION
--     · 해당 신청을 cancelled 로 변경 후 같은 페어 재접수 → 성공(새 sequence_no 발급)
--
--   48 / 49 / 60 / 61 경계  (target_capacity=48, max_capacity=60 기준)
--     · 48번째 → registration_status='applied'
--     · 49번째 → 'waitlisted'
--     · 60번째 → 'waitlisted'
--     · 61번째 → TOURNAMENT_FULL (행 미생성)
--     확인 쿼리:
--       select sequence_no, registration_no, registration_status
--         from public.hosted_tournament_registrations r
--         join public.hosted_tournaments t on t.id = r.tournament_id
--        where t.slug = '<테스트 slug>' order by sequence_no;
--
--   동시성(정원 경계가 깨지지 않는지)
--     · 서로 다른 페어로 submit 을 동시에 다수 실행(예: 60팀 상태에서 5건 동시)
--       → 전부 TOURNAMENT_FULL, 61번째 행이 생기지 않아야 한다.
--     · advisory lock 은 대회 단위이므로 다른 대회의 접수는 서로 막지 않는다.
--
--   순번 재사용 금지
--     · 중간 신청을 cancelled 로 바꾼 뒤 새 신청 → 비어 있는 순번을 재사용하지 않고 max+1 을 쓴다.
--       (registration_no 가 과거와 겹치면 실패)
-- =============================================================================
