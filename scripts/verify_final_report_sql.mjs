/**
 * KDK FINAL REPORT SQL 시험 — 격리된 PGlite(WASM Postgres) 테스트 DB 에서만 실행. 운영 DB 미접속.
 *
 *   실행: PGLITE_MODULE=<@electric-sql/pglite 의 dist/index.js 절대경로> node --experimental-strip-types scripts/verify_final_report_sql.mjs
 *   (pglite 는 프로젝트 의존성이 아니다 — 저장소 밖 임시 폴더에 설치해 경로만 넘긴다.)
 *
 *   Supabase 최소 stub: roles(anon/authenticated/service_role) · auth.uid() · profiles · members · kdk_managers ·
 *   teyeon_archive_v1 · kdk_spotlight_is_admin(운영 정의와 같은 판정: CEO · ADMIN · 등재 KDK 관리자).
 *   검증: 기록 지문(변경 감지 · 오탐 없음) · 권한 · anon 직접 접근 차단 · 초안 · 발행 · 재발행(slug 유지 · revision 증가) ·
 *        열람 재검증(정정 · 공개 범위 변경 · 공식 해제 · 테스트 · 비공개) · 공개본 누출 방어 · rollback · Archive 무변경.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.log('SKIP: PGLITE_MODULE 미지정 — SQL 시험 미실시'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);

const here = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(here, '../supabase/add_kdk_final_report.sql'), 'utf8');
const ROLLBACK = readFileSync(join(here, '../supabase/add_kdk_final_report_rollback.sql'), 'utf8');
const VERIFY = readFileSync(join(here, '../supabase/add_kdk_final_report_verify_READONLY.sql'), 'utf8');

let passed = 0;
const failures = [];
const check = (name, cond, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const clone = (v) => JSON.parse(JSON.stringify(v));

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const asRole = async (role, sub, fn) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${sub || ''}', false);`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
};
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.code || e?.message || e); } };

const CEO = '00000000-0000-0000-0000-00000000000a';
const MEMBER = '00000000-0000-0000-0000-00000000000b';
const KDKM = '00000000-0000-0000-0000-00000000000c';
const PRIV_AUTH = '00000000-0000-0000-0000-00000000000d';
const U = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ── Supabase stub ────────────────────────────────────────────────────────────
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create schema auth; grant usage on schema auth to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.profiles (id uuid primary key, role text, profile_visibility_level text default 'public');
  create table public.members (id uuid primary key, auth_user_id uuid);
  create table public.kdk_managers (user_id uuid primary key);
  create table public.teyeon_archive_v1 (
    id text primary key, raw_data jsonb, created_at timestamptz default now(),
    is_official boolean not null default false, is_test boolean not null default false,
    confirmed_at timestamptz, confirmed_by text, profile_reflected boolean not null default false, archive_type text not null default 'kdk');
  -- 운영 상태 모사(SQL 38 이후): anon 은 Archive SELECT 불가, 로그인 회원은 SELECT 가능.
  revoke all on public.teyeon_archive_v1 from anon; grant select on public.teyeon_archive_v1 to authenticated;
  -- 운영 kdk_spotlight_is_admin 과 같은 판정(시험용 단순화: CEO · ADMIN 또는 kdk_managers 등재 + MEMBER).
  create function public.kdk_spotlight_is_admin(p_user uuid) returns boolean language sql stable security definer
    set search_path = public, pg_temp as $$
    select p_user is not null and (
      exists (select 1 from public.profiles p where p.id = p_user and upper(btrim(coalesce(p.role, ''))) in ('CEO', 'ADMIN'))
      or (exists (select 1 from public.kdk_managers k where k.user_id = p_user)
          and exists (select 1 from public.profiles p where p.id = p_user and upper(btrim(coalesce(p.role, ''))) in ('MEMBER', 'OPERATOR', 'FINANCE_MANAGER'))))
  $$;
  revoke all on function public.kdk_spotlight_is_admin(uuid) from public, anon, authenticated;
  insert into public.profiles (id, role) values ('${CEO}', 'CEO'), ('${MEMBER}', 'MEMBER'), ('${KDKM}', 'MEMBER');
  insert into public.profiles (id, role, profile_visibility_level) values ('${PRIV_AUTH}', 'MEMBER', 'public');
  insert into public.kdk_managers values ('${KDKM}');
  insert into public.members values ('${U(6)}', '${PRIV_AUTH}');
`);

// ── 가상 공식 Archive ────────────────────────────────────────────────────────
const RAW = {
  title: '11월 정모', date: '2026-11-11',
  ranking_data: [
    { id: U(1), name: '구봉준', wins: 4, losses: 0, diff: 12, avatar: 'a.png' },
    { id: U(2), name: '박광현', wins: 3, losses: 1, diff: 7 },
    { id: U(3), name: '정다은', wins: 3, losses: 1, diff: 5 },
    { id: 'manual-guest-hong', name: '홍길동(G)', wins: 2, losses: 2, diff: 0 },
    { id: U(6), name: '이상윤', wins: 0, losses: 4, diff: -24 },
  ],
  snapshot_data: [
    { id: 'm-1', round: 1, court: 1, group_name: 'A', status: 'complete', player_ids: [U(1), U(2), U(3), U(6)], player_names: ['구봉준', '박광현', '정다은', '이상윤'], score1: 6, score2: 5 },
    { id: 'm-2', round: 1, court: 2, group_name: 'A', status: 'complete', player_ids: [U(1), 'manual-guest-hong', U(2), U(6)], player_names: ['구봉준', '홍길동', '박광현', '이상윤'], score1: 6, score2: 0 },
    { id: 'm-3', round: 2, court: 1, group_name: 'A', status: 'playing', player_ids: [U(1), U(3), U(2), U(6)], player_names: ['구봉준', '정다은', '박광현', '이상윤'], score1: 0, score2: 0 },
  ],
  settlement_data: [{ player_id: U(1), final_amount: -10000 }],
  player_metadata: { [U(1)]: { group: 'A', birthYear: 1980 }, [U(6)]: { group: 'B' } },
};
const SID = 'KDK-20261111-QAFR';
await db.query(`insert into public.teyeon_archive_v1 (id, raw_data, is_official, confirmed_at, confirmed_by) values ($1, $2, true, now(), 'admin@club.test')`, [SID, JSON.stringify(RAW)]);
await db.query(`insert into public.teyeon_archive_v1 (id, raw_data, is_official) values ('KDK-UNOFF', $1, false)`, [JSON.stringify(RAW)]);
await db.query(`insert into public.teyeon_archive_v1 (id, raw_data, is_official, is_test) values ('KDK-TEST', $1, true, true)`, [JSON.stringify(RAW)]);
const archiveBefore = await q(`select id, raw_data::text as r, is_official, is_test from public.teyeon_archive_v1 order by id`);

// ── 설치 ────────────────────────────────────────────────────────────────────
await db.exec(SQL);
check('설치 성공', !!(await one(`select to_regclass('public.kdk_final_reports') as t`)).t);
check('재실행 안전(같은 SQL 두 번)', (await errOf(() => db.exec(SQL))) === null);

// ── 13~15) 기록 지문 ──────────────────────────────────────────────────────────
const sig = async (raw) => (await one(`select public.kdk_final_report_signature($1::jsonb) as s`, [JSON.stringify(raw)])).s;
const S0 = await sig(RAW);
check('지문 형식 v1:md5', /^v1:[0-9a-f]{32}$/.test(S0), S0);
// 오탐 없음
const t1 = clone(RAW); t1.ranking_data = t1.ranking_data.map((r) => ({ ...r, wins: String(r.wins), losses: `${r.losses}.0`, diff: String(r.diff) }));
check('오탐 없음: 숫자 3 · "3" · "3.0"', (await sig(t1)) === S0);
const t2 = clone(RAW); t2.snapshot_data.reverse();
check('오탐 없음: 경기 배열 순서', (await sig(t2)) === S0);
const t3 = clone(RAW); t3.snapshot_data[0].player_ids = [U(2), U(1), U(6), U(3)]; t3.snapshot_data[0].player_names = ['박광현', '구봉준', '이상윤', '정다은'];
check('오탐 없음: 팀 안 선수 순서', (await sig(t3)) === S0);
const t4 = clone(RAW); t4.ranking_data[0].name = '  구봉준 '; t4.title = ' 11월 정모 ';
check('오탐 없음: 앞뒤 공백', (await sig(t4)) === S0);
const t5 = clone(RAW); t5.settlement_data = []; t5.ranking_data[0].avatar = 'b.png'; t5.player_metadata[U(1)].birthYear = 1979;
check('오탐 없음: 정산 · 아바타 · 출생연도(지문 대상 아님)', (await sig(t5)) === S0);
const t6 = clone(RAW); t6.snapshot_data[2].score1 = 3;
check('오탐 없음: 진행 중 경기 점수', (await sig(t6)) === S0);
const t7 = clone(RAW); for (const m of t7.snapshot_data) { m.playerIds = m.player_ids; delete m.player_ids; m.groupName = m.group_name; delete m.group_name; }
check('오탐 없음: 예전 키 이름(playerIds · groupName)', (await sig(t7)) === S0);
// 변경 감지
const c1 = clone(RAW); c1.snapshot_data[0].score2 = 4;
check('[13] 점수 정정 → 지문 변경', (await sig(c1)) !== S0);
const c2 = clone(RAW); [c2.ranking_data[1], c2.ranking_data[2]] = [c2.ranking_data[2], c2.ranking_data[1]];
check('[14] 순위 정정(순서 바뀜) → 지문 변경', (await sig(c2)) !== S0);
const c3 = clone(RAW); c3.ranking_data[1].diff = 6;
check('승 · 패 · 득실 변경 → 지문 변경', (await sig(c3)) !== S0);
const c4 = clone(RAW); c4.snapshot_data[0].player_ids[3] = 'manual-guest-hong'; c4.snapshot_data[0].player_names[3] = '홍길동';
check('[15] 경기 선수 구성 변경 → 지문 변경', (await sig(c4)) !== S0);
const c5 = clone(RAW); c5.snapshot_data[2].status = 'complete';
check('완료 경기 구성 변경(진행 중 → 완료) → 지문 변경', (await sig(c5)) !== S0);
const c6 = clone(RAW); c6.snapshot_data[0].player_ids = [U(3), U(6), U(1), U(2)]; c6.snapshot_data[0].player_names = ['정다은', '이상윤', '구봉준', '박광현'];
check('팀 바뀜(A팀 ↔ B팀, 점수 그대로) → 지문 변경', (await sig(c6)) !== S0);
const c7 = clone(RAW); c7.ranking_data[3].name = '홍길순(G)';
check('표시명 변경 → 지문 변경', (await sig(c7)) !== S0);
const c8 = clone(RAW); c8.player_metadata[U(6)].group = 'A';
check('조 태그 변경 → 지문 변경', (await sig(c8)) !== S0);

// ── 19 · 20) 권한 · 직접 접근 ──────────────────────────────────────────────────
const svc = (sql, params) => asRole('service_role', '', () => one(sql, params));
const source = (actor, sid = SID) => svc(`select public.get_kdk_final_report_source($1, $2::uuid) as r`, [sid, actor]).then((x) => x.r);
const save = (actor, content = { schema: 1, opening: '공식 기록입니다.' }, sid = SID, slug = 'reportslug0001') =>
  svc(`select public.save_kdk_final_report_draft('C1', $1, $2::uuid, $3::jsonb, $4) as r`, [sid, actor, JSON.stringify(content), slug]).then((x) => x.r);
const publish = (actor, payload, s, rev, sid = SID) =>
  svc(`select public.publish_kdk_final_report($1, $2::uuid, $3::jsonb, $4, $5) as r`, [sid, actor, JSON.stringify(payload), s, rev]).then((x) => x.r);
const unpublish = (actor, sid = SID) => svc(`select public.unpublish_kdk_final_report($1, $2::uuid) as r`, [sid, actor]).then((x) => x.r);
const pub = (slug, role = 'anon') => asRole(role, '', () => one(`select public.get_public_kdk_final_report($1) as r`, [slug])).then((x) => x.r);

check('[19] 일반 MEMBER → 조회 · 저장 · 발행 · 비공개 forbidden',
  (await source(MEMBER)).reason === 'forbidden' && (await save(MEMBER)).reason === 'forbidden'
  && (await publish(MEMBER, { schema: 1 }, 'x', 0)).reason === 'forbidden' && (await unpublish(MEMBER)).reason === 'forbidden');
check('[19] actor 없음(null) → forbidden', (await svc(`select public.get_kdk_final_report_source($1, null) as r`, [SID])).r.reason === 'forbidden');
check('[20] anon: 리포트 표 SELECT 불가', !!(await errOf(() => asRole('anon', '', () => q(`select * from public.kdk_final_reports`)))));
check('[20] 로그인 회원: 리포트 표 SELECT · INSERT 불가', !!(await errOf(() => asRole('authenticated', MEMBER, () => q(`select * from public.kdk_final_reports`))))
  && !!(await errOf(() => asRole('authenticated', CEO, () => q(`insert into public.kdk_final_reports (club_id, session_id, public_slug, created_by, updated_by) values ('C1','x','aaaaaaaaaaaa', '${CEO}', '${CEO}')`)))));
check('[20] anon: Archive 원본 SELECT 불가(기존 상태 유지)', !!(await errOf(() => asRole('anon', '', () => q(`select * from public.teyeon_archive_v1`)))));
check('[19][20] anon · 로그인 회원(CEO 포함): 운영진 RPC 직접 실행 불가',
  !!(await errOf(() => asRole('anon', '', () => q(`select public.get_kdk_final_report_source('${SID}', '${CEO}'::uuid)`))))
  && !!(await errOf(() => asRole('authenticated', CEO, () => q(`select public.publish_kdk_final_report('${SID}', '${CEO}'::uuid, '{}'::jsonb, 'a', 0)`)))));
check('[20] anon: 지문 함수 실행 불가', !!(await errOf(() => asRole('anon', '', () => q(`select public.kdk_final_report_signature('{}'::jsonb)`)))));
check('공개 범위 지문 함수 · 컬럼 없음(이름 정책 = 전원 표시)', !(await one(`select to_regprocedure('public.kdk_final_report_visibility_signature(jsonb)') as f`)).f
  && !(await one(`select count(*)::int as n from information_schema.columns where table_name = 'kdk_final_reports' and column_name = 'visibility_signature'`)).n);

// ── 원본 투영 · 초안 ───────────────────────────────────────────────────────────
const src = await source(KDKM);
check('KDK 관리자(등재) → 원본 조회 가능', src.ok === true);
const srcTxt = JSON.stringify(src);
check('원본 투영에 정산 · 출생연도 · 아바타 · 확정자 없음', !/settlement|final_amount|birthYear|avatar|admin@club/.test(srcTxt), srcTxt.slice(0, 120));
check('원본 투영: 순위 저장 순서 · 조 · 완료/진행 경기 · 지문 = 서명 함수', src.archive.rankingData.map((r) => r.name).join() === '구봉준,박광현,정다은,홍길동(G),이상윤'
  && src.archive.playerGroups[U(6)] === 'B' && src.archive.snapshotData.length === 3 && src.signature === S0 && src.report === null);
check('원본 조회에 회원 공개 범위 정보 없음', !('restrictedIds' in src) && !('visibilitySignature' in src));
check('[2] 미확정 · 테스트 Archive → 초안 저장 거부', (await save(CEO, undefined, 'KDK-UNOFF')).reason === 'not_official' && (await save(CEO, undefined, 'KDK-TEST')).reason === 'not_official');
check('잘못된 slug · 너무 큰 문구 거부', (await save(CEO, undefined, SID, 'BAD')).reason === 'invalid_slug'
  && (await save(CEO, { big: 'x'.repeat(20000) })).reason === 'invalid_content');
const d1 = await save(KDKM);
check('초안 저장(KDK 관리자) → draft · revision 0', d1.ok && d1.status === 'draft' && d1.revision === 0 && d1.publicSlug === 'reportslug0001');
check('초안만으로는 공개 안 됨', (await pub('reportslug0001')).state === 'not_found');

// ── 발행 · 재발행 ─────────────────────────────────────────────────────────────
const PAYLOAD = { schema: 1, session: { title: '11월 정모', date: '2026-11-11', officialConfirmed: true, participantCount: 5, matchCount: 2 },
  podium: [{ rank: 1, name: '구봉준', wins: 4, losses: 0, diff: 12, group: 'A', guest: false, story: null }],
  featured: [], standings: [{ rank: 1, name: '구봉준', wins: 4, losses: 0, diff: 12, group: 'A', guest: false }], opening: null, closing: null };
check('지문이 다르면 발행 거부(stale)', (await publish(CEO, PAYLOAD, 'v1:0000', 0)).reason === 'stale');
check('revision 다르면 발행 거부(동시 발행 보호)', (await publish(CEO, PAYLOAD, S0, 5)).reason === 'revision_conflict');
check('공개본에 회원 UUID → payload_leak', (await publish(CEO, { ...PAYLOAD, x: U(1) }, S0, 0)).reason === 'payload_leak');
check('공개본에 게스트 내부 id · 세션 id · 이메일 → payload_leak', (await publish(CEO, { ...PAYLOAD, x: 'manual-guest-hong' }, S0, 0)).reason === 'payload_leak'
  && (await publish(CEO, { ...PAYLOAD, x: SID }, S0, 0)).reason === 'payload_leak' && (await publish(CEO, { ...PAYLOAD, x: 'a@b.co' }, S0, 0)).reason === 'payload_leak');
check('schema 없는 공개본 거부', (await publish(CEO, { foo: 1 }, S0, 0)).reason === 'invalid_payload');
const p1 = await publish(KDKM, PAYLOAD, S0, 0);
check('발행(KDK 관리자) → revision 1', p1.ok && p1.revision === 1 && p1.publicSlug === 'reportslug0001', JSON.stringify(p1));
let g = await pub('reportslug0001');
check('[1] 공개 조회 ok · 공개본 그대로 · 세션 id(공식 결과 링크용)', g.ok && g.state === 'ok' && g.payload.session.title === '11월 정모' && g.revision === 1 && g.officialSessionId === SID);
check('공개 조회 응답에 원본 · 지문 · 작성자 없음', !/raw_data|signature|published_by|content|11111111-0000/.test(JSON.stringify(g)));
check('로그인 회원도 같은 공개 조회', (await pub('reportslug0001', 'authenticated')).state === 'ok');
await save(CEO, { schema: 1, opening: '수정한 문구' }, SID, 'otherslug00001');
g = await pub('reportslug0001');
check('초안 수정은 공개본을 바꾸지 않음 · 기존 slug 유지(새 slug 무시)', g.state === 'ok' && g.revision === 1 && (await source(CEO)).report.publicSlug === 'reportslug0001');
const p2 = await publish(CEO, { ...PAYLOAD, opening: '수정한 문구' }, S0, 1);
check('[17][18] 재발행 → slug 유지 · revision 2', p2.ok && p2.revision === 2 && p2.publicSlug === 'reportslug0001');
check('재발행 공개본 반영', (await pub('reportslug0001')).payload.opening === '수정한 문구');

// ── 열람 재검증 ────────────────────────────────────────────────────────────────
const setRaw = (raw) => db.query(`update public.teyeon_archive_v1 set raw_data = $2 where id = $1`, [SID, JSON.stringify(raw)]);
await setRaw(t2); // 오탐 없는 변경(배열 순서)
check('오탐 없는 Archive 변경 후에도 공개 유지', (await pub('reportslug0001')).state === 'ok');
await setRaw(c1); // 점수 정정
g = await pub('reportslug0001');
check('[13] 점수 정정 → corrected · 오래된 수치 미공개(제목 · 날짜만)', g.state === 'corrected' && !('payload' in g) && g.title === '11월 정모');
const srcC = await source(CEO);
check('운영진 조회: 발행 지문 ≠ 현재 지문(재확인 · 재발행 필요 판정 근거)', srcC.report.sourceSignature !== srcC.signature);
const p3 = await publish(CEO, PAYLOAD, srcC.signature, 2);
check('정정 후 재발행 → revision 3 · 다시 공개', p3.ok && p3.revision === 3 && (await pub('reportslug0001')).state === 'ok');
await db.exec(`update public.profiles set profile_visibility_level = 'private' where id = '${PRIV_AUTH}'`);
g = await pub('reportslug0001');
check('발행 뒤 회원이 프로필 공개 범위를 private 로 바꿔도 공개 유지(정정 상태 아님 · 공식 결과와 구분)', g.state === 'ok' && g.revision === 3);
await db.exec(`update public.profiles set profile_visibility_level = 'partial' where id = '${PRIV_AUTH}'`);
check('partial 로 바꿔도 공개 유지 · 지문 동일', (await pub('reportslug0001')).state === 'ok' && (await source(CEO)).signature === srcC.signature);
const srcV = await source(CEO);
await publish(CEO, PAYLOAD, srcV.signature, 3);
check('같은 기록으로 재발행 → 공개 · revision 4', (await pub('reportslug0001')).state === 'ok' && (await pub('reportslug0001')).revision === 4);
await db.exec(`update public.teyeon_archive_v1 set is_official = false where id = '${SID}'`);
check('[16] 공식 해제 → not_found(공개 차단)', (await pub('reportslug0001')).state === 'not_found');
check('[16] 공식 해제 상태에서 발행 거부', (await publish(CEO, PAYLOAD, srcV.signature, 4)).reason === 'not_official');
await db.exec(`update public.teyeon_archive_v1 set is_official = true, is_test = true where id = '${SID}'`);
check('테스트 전환 → not_found', (await pub('reportslug0001')).state === 'not_found');
await db.exec(`update public.teyeon_archive_v1 set is_test = false where id = '${SID}'`);
check('공식 · 비테스트 복귀 → 공개', (await pub('reportslug0001')).state === 'ok');
check('비공개(unpublish) → not_found', (await unpublish(KDKM)).reason === 'unpublished' && (await pub('reportslug0001')).state === 'not_found');
check('비공개 후 재발행 → 같은 slug 로 다시 공개 · revision 5', (await publish(CEO, PAYLOAD, srcV.signature, 4)).revision === 5 && (await pub('reportslug0001')).state === 'ok');
check('slug 형식 오류 · 없는 slug → not_found', (await pub("x' or 1=1 --")).state === 'not_found' && (await pub('nosuchslug0000')).state === 'not_found');

// ── P3: 초안 동시 편집 충돌 · 세션 → 공개 링크 ──────────────────────────────────────────
const saveX = (actor, content, expected, sid = SID, slug = 'reportslug0001') =>
  svc(`select public.save_kdk_final_report_draft('C1', $1, $2::uuid, $3::jsonb, $4, $5::timestamptz) as r`, [sid, actor, JSON.stringify(content), slug, expected]).then((x) => x.r);
{
  const cur = (await source(CEO)).report;
  check('원본 조회에 updatedAt(충돌 기준) 포함', typeof cur.updatedAt === 'string' && cur.updatedAt.length > 10);
  const a = await saveX(CEO, { schema: 1, opening: 'A 운영진' }, cur.updatedAt);
  check('같은 기준 시각으로 저장 → 성공 · 새 updatedAt 반환', a.ok === true && a.updatedAt && a.updatedAt !== cur.updatedAt);
  const b = await saveX(KDKM, { schema: 1, opening: 'B 운영진' }, cur.updatedAt);
  check('[충돌] 오래된 기준 시각으로 저장 → draft_conflict · 덮어쓰지 않음', b.reason === 'draft_conflict' && (await source(CEO)).report.content.opening === 'A 운영진');
  check('[충돌] 이미 있는 리포트를 "처음 작성"으로 저장 → draft_conflict', (await saveX(CEO, { schema: 1 }, '1970-01-01T00:00:00Z')).reason === 'draft_conflict');
  check('초안 저장은 공개본 유지', (await pub('reportslug0001')).state === 'ok' && (await pub('reportslug0001')).payload.opening !== 'A 운영진');
  const SID3 = 'KDK-20261113-QAE3';
  await db.query(`insert into public.teyeon_archive_v1 (id, raw_data, is_official) values ($1, $2, true)`, [SID3, JSON.stringify(RAW)]);
  check('[충돌] 없는 리포트를 기존 시각 기준으로 저장 → draft_conflict', (await saveX(CEO, { schema: 1 }, cur.updatedAt, SID3, 'reportslug0003')).reason === 'draft_conflict');
  check('처음 작성(epoch 기준) → 생성', (await saveX(CEO, { schema: 1 }, '1970-01-01T00:00:00Z', SID3, 'reportslug0003')).ok === true);
  const link = (sid, role = 'anon') => asRole(role, '', () => one(`select public.get_public_kdk_final_report_link($1) as r`, [sid])).then((x) => x.r);
  check('공개 링크: 발행 중 세션 → slug', (await link(SID)).ok === true && (await link(SID)).publicSlug === 'reportslug0001');
  check('공개 링크: 초안만 있는 세션 · 없는 세션 → ok false', (await link(SID3)).ok === false && (await link('NOPE')).ok === false);
  check('공개 링크 응답에 payload · 문구 · 작성자 없음', Object.keys(await link(SID)).sort().join() === 'ok,publicSlug');
  const keep = (await one(`select raw_data from public.teyeon_archive_v1 where id = $1`, [SID])).raw_data;
  await setRaw(c2);
  check('공개 링크: 기록 정정(지문 불일치) → ok false', (await link(SID)).ok === false);
  await setRaw(keep);
  check('공개 링크: anon 외 로그인 회원도 같은 결과', (await link(SID, 'authenticated')).ok === true);
  await db.query(`delete from public.kdk_final_reports where session_id = $1`, [SID3]);
  await db.query(`delete from public.teyeon_archive_v1 where id = $1`, [SID3]);
}

// ── 종단 확인: SQL 원본 투영 → TS 모델 → 공개본 → 발행 → 공개 조회 → 파서 ───────────────────
{
  const { register } = await import('node:module');
  register('./ts-resolve-hook.mjs', import.meta.url);
  const fr = await import('../lib/kdk/finalReport/finalReportModel.ts');
  const SID2 = 'KDK-20261112-QAE2';
  await db.query(`insert into public.teyeon_archive_v1 (id, raw_data, is_official, confirmed_at, confirmed_by) values ($1, $2, true, now(), 'admin@club.test')`, [SID2, JSON.stringify(RAW)]);
  const s2 = await source(CEO, SID2);
  const mb = fr.buildFinalReportModel(s2.archive);
  check('종단: SQL 투영 그대로 TS 모델 생성', mb.ok === true, JSON.stringify(mb).slice(0, 120));
  check('종단: 프로필 private 회원(이상윤)도 이름 표시 · 게스트 (G) · A·B 양쪽 경기 선수는 조 미표시(P4)', mb.model.standings[4].name === '이상윤' && mb.model.standings[3].name === '홍길동(G)' && mb.model.standings[4].group === '');
  const content = { schema: 1, opening: '', closing: '', stories: [{ playerKey: U(1), rank: 1, text: '전승 우승입니다.' }],
    featured: [{ matchId: 'm-1', fingerprint: fr.matchFingerprint(mb.model.matches[0]), review: '6:5 접전', tag: 'MATCH_OF_THE_DAY' }] };
  const pc = fr.parseFinalReportContent(content);
  await save(CEO, pc.content, SID2, 'reportslug0002');
  const pl = fr.buildFinalReportPayload(mb.model, pc.content);
  check('종단: 공개본 생성', pl.ok === true);
  const pr = await publish(CEO, pl.payload, s2.signature, 0, SID2);
  check('종단: TS 공개본이 SQL 누출 방어를 통과해 발행', pr.ok === true, JSON.stringify(pr));
  const gg = await pub('reportslug0002');
  const parsed = fr.parsePublicFinalReport(gg.payload);
  check('종단: 공개 조회 → 파서 통과 · 공개본과 동일', gg.state === 'ok' && JSON.stringify(parsed) === JSON.stringify(pl.payload));
  check('종단: 공개 응답에 이름 표시 · 내부 id 없음', JSON.stringify(gg).includes('이상윤') && !JSON.stringify(gg).includes('11111111-0000') && !JSON.stringify(gg).includes('manual-guest'));
  // 정정 → 운영진 재확인 흐름
  const fixed = clone(RAW); [fixed.ranking_data[0], fixed.ranking_data[1]] = [fixed.ranking_data[1], fixed.ranking_data[0]];
  await db.query(`update public.teyeon_archive_v1 set raw_data = $2 where id = $1`, [SID2, JSON.stringify(fixed)]);
  check('종단: 순위 정정 → 공개 corrected', (await pub('reportslug0002')).state === 'corrected');
  const s3 = await source(CEO, SID2);
  const m3 = fr.buildFinalReportModel(s3.archive).model;
  const saved = fr.parseFinalReportContent(s3.report.content).content;
  const rec = fr.reconcileContent(saved, m3);
  check('종단: 저장된 스토리(구봉준) → rank_changed · 문구 보존 · 재확인 전 발행본 생성 거부',
    rec.stories[0].state === 'rank_changed' && rec.stories[0].text === '전승 우승입니다.' && fr.buildFinalReportPayload(m3, saved).reason === 'needs_review');
  const re = fr.reanchorContent(saved, m3, { stories: [], featured: ['m-1'] });
  const pl3 = fr.buildFinalReportPayload(m3, re);
  const pr3 = await publish(CEO, pl3.payload, s3.signature, 1, SID2);
  check('종단: 운영진 재확인(스토리 제외) → 재발행 revision 2 · 같은 slug · 공개', pr3.ok && pr3.revision === 2 && pr3.publicSlug === 'reportslug0002' && (await pub('reportslug0002')).state === 'ok');
  await db.query(`delete from public.kdk_final_reports where session_id = $1`, [SID2]);
  await db.query(`delete from public.teyeon_archive_v1 where id = $1`, [SID2]);
}

// ── verify(READONLY) · Archive 무변경 · rollback ─────────────────────────────────
check('verify(READONLY) 실행 오류 없음', (await errOf(() => db.exec(VERIFY))) === null);
await setRaw(RAW);
await db.exec(`update public.teyeon_archive_v1 set is_official = true, is_test = false where id = '${SID}'`);
const archiveAfter = await q(`select id, raw_data::text as r, is_official, is_test from public.teyeon_archive_v1 order by id`);
check('[22] 리포트 RPC 는 Archive 를 바꾸지 않음(시험이 바꾼 값 복원 후 원본과 동일)', JSON.stringify(archiveAfter) === JSON.stringify(archiveBefore));
await db.exec(ROLLBACK);
check('rollback: 신규 표 · 함수 제거', !(await one(`select to_regclass('public.kdk_final_reports') as t`)).t
  && !(await one(`select to_regprocedure('public.get_public_kdk_final_report(text)') as f`)).f && !(await one(`select to_regprocedure('public.get_public_kdk_final_report_link(text)') as f`)).f && !(await one(`select to_regprocedure('public.kdk_fr_int(jsonb)') as f`)).f);
check('rollback: 기존 표 · 함수 유지', !!(await one(`select to_regclass('public.teyeon_archive_v1') as t`)).t && !!(await one(`select to_regprocedure('public.kdk_spotlight_is_admin(uuid)') as f`)).f);
check('rollback 후 재설치 가능', (await errOf(() => db.exec(SQL))) === null);

console.log(`KDK FINAL REPORT SQL (PGlite): ${passed} passed / ${failures.length} failed`);
for (const f of failures) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
