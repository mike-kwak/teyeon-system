# MATCH SPOTLIGHT 테스트 환경 (운영 DB 사용 금지)

운영 데이터는 복제하지 않는다. 구조는 저장소 SQL 기준으로 재현하고, 데이터는 가상 값(`QA-`/`SP-QA-` 접두사)만 쓴다.

## A. 로컬 PostgreSQL 17 (계정·외부 서비스 불필요)
`scripts/verify_match_spotlight_concurrency.mjs` 를 `SPOTLIGHT_LOCAL_STUB=1` 로 실행하면 아래 순서를 자동 수행한다.
(Supabase stub → 기본 구조 → 기존 KDK RPC 원본 → 가상 데이터 → SPOTLIGHT 설치/재적용/verify → 동시성 → rollback)

## B. Supabase 테스트 전용 프로젝트 (사용자 조작 필요)
1. supabase.com 에서 **새 프로젝트**를 만든다(운영 프로젝트와 별개 · 무료 플랜 가능 · 리전 무관).
2. 프로젝트 Settings → Database → Connection string(**Direct** 또는 Session pooler) 을 복사한다.
3. SQL Editor 에서 순서대로 실행(파일 내용 붙여넣기):
   1. `supabase/spotlight_testenv/01_testenv_base_schema.sql`   ← 00 stub 은 Supabase 에서 실행하지 않는다
   2. `supabase/kdk_session_meta.sql`
   3. `supabase/add_kdk_group_courts.sql`
   4. `supabase/add_matches_playing_court_unique_index.sql`
   5. `supabase/add_start_kdk_match_rpc.sql`
   6. `supabase/add_kdk_match_timer.sql`
   7. `supabase/add_delete_kdk_live_session_rpc.sql`
   8. `supabase/sync_rpc_v1.sql`
   9. `supabase/spotlight_testenv/02_testenv_seed.sql`
   10. `supabase/add_kdk_match_spotlight.sql` → `supabase/add_kdk_match_spotlight_verify.sql`
   - 또는 3번을 건너뛰고 아래 4번 스크립트가 1~9 를 자동 실행하게 둔다(빈 프로젝트일 때).
4. 실DB 동시성 시험(로컬 PC 에서 테스트 프로젝트로 접속):
   ```
   SPOTLIGHT_TESTDB=yes-test-only PG_MODULE=<pg 패키지 경로> DATABASE_URL=<테스트 프로젝트 연결 문자열> \
     node scripts/verify_match_spotlight_concurrency.mjs
   ```
   - `.env.local` 의 운영 project ref 가 연결 문자열에 있으면 스크립트가 즉시 중단한다.
   - `matches` 에 QA 가 아닌 행이 있으면 중단한다.
5. 로그인 화면 QA(선택): 테스트 프로젝트 Auth 에 테스트 계정을 만들고, 그 `auth.users.id` 로 `02_testenv_seed.sql` 의
   CEO 행을 바꾼 뒤, 로컬 앱을 테스트 프로젝트 URL·anon key·**service_role key** 로 띄워 `/kdk` 관리 시트를 점검한다.
   (운영 `.env.local` 은 바꾸지 말고 별도 env 파일/셸 변수로 실행)

## 운영 구조와 맞추고 싶을 때(선택 · 운영에서는 읽기 전용 조회만)
운영 SQL Editor 에서 **조회만** 실행해 결과(구조 정보, 개인정보 없음)를 비교한다:
```sql
select policyname, cmd, roles, qual, with_check from pg_policies where schemaname='public' and tablename='matches';
select tgname, tgenabled from pg_trigger where tgrelid='public.matches'::regclass and not tgisinternal;
select column_name, data_type from information_schema.columns where table_schema='public' and table_name='matches' order by ordinal_position;
select count(*) from public.matches;   -- 설치 시 backfill 행 수 · 잠금 시간 가늠
```
