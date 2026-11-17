/**
 * TEYEON Admin — 클럽 회원 자격(members.role) ↔ 앱 권한(profiles.role) 판정 · 저장 fixture.
 *
 *   실행: node scripts/verify_admin_role_sync.mts
 *   (Node 24 TypeScript type-stripping + scripts/ts-resolve-hook.mjs — DB 미접속, 가짜 클라이언트 주입)
 *
 *   검증: 앱 권한 표시(원본 보존 · 비표준 · 보호 역할) · 클럽 자격 분류 · 불일치 판정(조회 중/실패 보류) ·
 *         저장 함수(현재 값 비교 UPDATE · 실제 1행 확인 · 조용한 0행 · 서버 거부 · 동시 수정 · 부여 범위 4종 고정) ·
 *         MEMBER 수동 승격 전제조건(연결 · 회원 자격 · 정확히 GUEST).
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'fixture-anon-key';

// 경로를 변수로 넘겨 프로젝트 tsc 검사 대상에서 제외(기존 verify_*.mts 관례).
const load = (path: string): Promise<any> => import(path);
const S = await load('../lib/admin/memberRegistrationService.ts');

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const rejects = async (p: Promise<unknown>, reason: string): Promise<boolean> => {
  try { await p; return false; } catch (e: any) { return e instanceof S.RoleUpdateError && e.reason === reason; }
};

// ── 가짜 DB(PostgREST 빌더 최소 흉내) ─────────────────────────────────────────
type Row = Record<string, any>;
interface FakeOpts { silentUpdate?: boolean; updateError?: { code: string; message: string } | null; beforeUpdate?: (t: Row[]) => void; selectError?: boolean }
function fakeDb(tables: Record<string, Row[]>, opts: FakeOpts = {}) {
  const log: string[] = [];
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    const b: any = {
      select: () => b,
      update: (p: Row) => { patch = p; return b; },
      eq: (k: string, v: any) => { filters.push((r) => r[k] === v); return b; },
      is: (k: string, v: any) => { filters.push((r) => (r[k] ?? null) === v); return b; },
      maybeSingle: () => b.then((res: any) => ({ ...res, data: res.data?.[0] ?? null })),
      then: (resolve: any, reject: any) => {
        try {
          if (opts.selectError && !patch) return Promise.resolve({ data: null, error: { code: '500', message: 'down' } }).then(resolve, reject);
          const rows = tables[table];
          if (patch) {
            log.push(`${table}:update:${JSON.stringify(patch)}`);
            if (opts.updateError) return Promise.resolve({ data: null, error: opts.updateError }).then(resolve, reject);
            opts.beforeUpdate?.(rows);
            if (opts.silentUpdate) return Promise.resolve({ data: [], error: null }).then(resolve, reject);
            const hit = rows.filter((r) => filters.every((f) => f(r)));
            hit.forEach((r) => Object.assign(r, patch));
            return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r })), error: null }).then(resolve, reject);
        } catch (e) { return Promise.reject(e).then(resolve, reject); }
      },
    };
    return b;
  };
  return { from, log };
}

// ── 1. 앱 권한 표시 ─────────────────────────────────────────────────────────
{
  const d = S.describeAppRole;
  check('OPERATOR 원본 보존 · 보호(변경 불가)', d('OPERATOR').exact === 'OPERATOR' && d('OPERATOR').editable === false && d('OPERATOR').effective === 'OPERATOR');
  check('FINANCE_MANAGER 원본 보존 · 보호', d('FINANCE_MANAGER').exact === 'FINANCE_MANAGER' && !d('FINANCE_MANAGER').editable);
  check('GUEST/MEMBER/ADMIN/CEO 편집 가능', ['GUEST', 'MEMBER', 'ADMIN', 'CEO'].every((r) => d(r).editable && d(r).exact === r));
  check('비표준 " member" — 원본 유지 · 비표준 · 앱 적용은 MEMBER', d(' member').raw === ' member' && d(' member').exact === null && d(' member').effective === 'MEMBER' && !d(' member').editable);
  check('비표준 "정회원" — 앱 적용 GUEST · 보호', d('정회원').exact === null && d('정회원').effective === 'GUEST' && !d('정회원').editable);
  check('null — 값 없음 · 보호', d(null).raw === null && d(null).exact === null && !d(null).editable);
  check('부여 가능 4종 고정', JSON.stringify(S.GRANTABLE_APP_ROLES) === JSON.stringify(['GUEST', 'MEMBER', 'ADMIN', 'CEO']));
}

// ── 2. 클럽 자격 분류 ───────────────────────────────────────────────────────
{
  const c = S.clubStanding;
  check('정회원 · 준회원 → member', c('정회원') === 'member' && c('준회원') === 'member');
  check('운영진 직책(총무 · CEO, 재무) → member', c('총무') === 'member' && c('CEO, 재무') === 'member' && c('회장') === 'member');
  check('게스트 → guest', c('게스트') === 'guest');
  check('탈회 우선(정회원, 탈회) → withdrawn', c('정회원, 탈회') === 'withdrawn' && c('탈회') === 'withdrawn');
  check('미지정/알 수 없음 → unknown', c(null) === 'unknown' && c('') === 'unknown' && c('기타') === 'unknown');
}

// ── 3. 불일치 판정 ──────────────────────────────────────────────────────────
{
  const ready = (o: Record<string, string | null>) => ({ state: 'ready', byId: new Map(Object.entries(o)) });
  const sync = (role: string | null, uid: string | null, lookup: any) => S.computeRoleSync({ role, auth_user_id: uid }, lookup);
  const L = ready({ g: 'GUEST', m: 'MEMBER', o: 'OPERATOR', f: 'FINANCE_MANAGER', a: 'ADMIN', n: ' member', x: '정회원' });
  check('정회원 + GUEST → promotable ⚠', sync('정회원', 'g', L).kind === 'promotable' && sync('정회원', 'g', L).warn);
  check('준회원 + GUEST → promotable', sync('준회원', 'g', L).kind === 'promotable');
  check('운영진 직책 + GUEST → promotable', sync('총무', 'g', L).kind === 'promotable');
  check('정회원 + MEMBER → ok', sync('정회원', 'm', L).kind === 'ok' && !sync('정회원', 'm', L).warn);
  check('정회원 + OPERATOR/FINANCE_MANAGER/ADMIN → ok(고권한 유지)', ['o', 'f', 'a'].every((u) => sync('정회원', u, L).kind === 'ok'));
  check('정회원 + 비표준 → nonstandard ⚠(버튼 없음)', sync('정회원', 'n', L).kind === 'nonstandard' && sync('정회원', 'x', L).kind === 'nonstandard');
  check('게스트 + GUEST → ok', sync('게스트', 'g', L).kind === 'ok');
  check('게스트 + MEMBER → guest_with_access ⚠(강등 없음)', sync('게스트', 'm', L).kind === 'guest_with_access' && sync('게스트', 'm', L).warn);
  check('탈회 + GUEST → ok / 탈회 + MEMBER → withdrawn_with_access ⚠', sync('탈회', 'g', L).kind === 'ok' && sync('탈회', 'm', L).kind === 'withdrawn_with_access');
  check('미연결 → unlinked(경고 아님)', sync('정회원', null, L).kind === 'unlinked' && !sync('정회원', null, L).warn);
  check('연결됐지만 profiles 없음 → no_profile ⚠', sync('정회원', 'zz', L).kind === 'no_profile' && sync('정회원', 'zz', L).warn);
  check('조회 중 → pending(판정 보류, GUEST 로 보지 않음)', sync('정회원', 'g', { state: 'loading' }).kind === 'pending' && !sync('정회원', 'g', { state: 'loading' }).warn);
  check('조회 실패 → pending(판정 보류)', sync('정회원', 'g', { state: 'error' }).kind === 'pending' && !sync('정회원', 'g', { state: 'error' }).warn);
}

// ── 4. 앱 권한 저장(setAppRole) ─────────────────────────────────────────────
{
  const mk = () => ({ profiles: [{ id: 'p1', role: 'GUEST' }, { id: 'p2', role: 'ADMIN' }, { id: 'p3', role: 'OPERATOR' }, { id: 'p4', role: ' member' }] });
  let t = mk(); let db = fakeDb(t);
  const r = await S.setAppRole({ profileId: 'p1', expectedRaw: 'GUEST', next: 'MEMBER' }, db);
  check('정상 저장 · 실제 1행 반영', r.role === 'MEMBER' && t.profiles[0].role === 'MEMBER');

  t = mk(); db = fakeDb(t, { silentUpdate: true });
  check('RLS 조용한 0행 → not_applied(성공 아님)', await rejects(S.setAppRole({ profileId: 'p1', expectedRaw: 'GUEST', next: 'MEMBER' }, db), 'not_applied'));

  t = mk(); db = fakeDb(t, { updateError: { code: '42501', message: 'profiles: role 변경 권한 없음' } });
  check('P0-C 거부(42501) → forbidden', await rejects(S.setAppRole({ profileId: 'p2', expectedRaw: 'ADMIN', next: 'CEO' }, db), 'forbidden'));

  t = mk(); db = fakeDb(t, { beforeUpdate: (rows) => { rows[0].role = 'ADMIN'; } });
  check('동시 수정(저장 직전 다른 곳에서 ADMIN) → 0행 not_applied · ADMIN 유지', await rejects(S.setAppRole({ profileId: 'p1', expectedRaw: 'GUEST', next: 'MEMBER' }, db), 'not_applied') && t.profiles[0].role === 'ADMIN');

  t = mk(); db = fakeDb(t);
  check('OPERATOR 행 변경 시도 → invalid · DB 호출 없음', await rejects(S.setAppRole({ profileId: 'p3', expectedRaw: 'OPERATOR', next: 'GUEST' }, db), 'invalid') && db.log.length === 0 && t.profiles[2].role === 'OPERATOR');
  check('비표준 행 변경 시도 → invalid · 원본 유지', await rejects(S.setAppRole({ profileId: 'p4', expectedRaw: ' member', next: 'MEMBER' }, db), 'invalid') && t.profiles[3].role === ' member');
  check('OPERATOR/FINANCE_MANAGER 신규 부여 불가', await rejects(S.setAppRole({ profileId: 'p1', expectedRaw: 'GUEST', next: 'OPERATOR' }, db), 'invalid') && await rejects(S.setAppRole({ profileId: 'p1', expectedRaw: 'GUEST', next: 'FINANCE_MANAGER' }, db), 'invalid'));
  check('같은 값 → invalid', await rejects(S.setAppRole({ profileId: 'p1', expectedRaw: 'GUEST', next: 'GUEST' }, db), 'invalid'));
}

// ── 5. MEMBER 수동 승격(promoteLinkedMemberToMember) ─────────────────────────
{
  const mk = (role = '정회원', prole: string | null = 'GUEST', link = 'p1') => ({ members: [{ id: 'm1', role, auth_user_id: link }], profiles: [{ id: 'p1', role: prole }] });
  let t = mk(); let db = fakeDb(t);
  await S.promoteLinkedMemberToMember({ memberId: 'm1', profileId: 'p1' }, db);
  check('정회원 + 연결 + GUEST → MEMBER', t.profiles[0].role === 'MEMBER');
  for (const role of ['준회원', '총무']) { t = mk(role); db = fakeDb(t); await S.promoteLinkedMemberToMember({ memberId: 'm1', profileId: 'p1' }, db); check(`${role} + GUEST → MEMBER`, t.profiles[0].role === 'MEMBER'); }
  for (const role of ['게스트', '탈회', '정회원, 탈회']) { t = mk(role); db = fakeDb(t); check(`${role} → precondition · 변경 없음`, await rejects(S.promoteLinkedMemberToMember({ memberId: 'm1', profileId: 'p1' }, db), 'precondition') && t.profiles[0].role === 'GUEST'); }
  for (const pr of ['ADMIN', 'CEO', 'OPERATOR', 'FINANCE_MANAGER', 'MEMBER', ' guest']) { t = mk('정회원', pr); db = fakeDb(t); check(`현재 ${pr} → precondition · 원본 유지`, await rejects(S.promoteLinkedMemberToMember({ memberId: 'm1', profileId: 'p1' }, db), 'precondition') && t.profiles[0].role === pr && !db.log.some((l) => l.includes('update'))); }
  t = mk('정회원', 'GUEST', 'pX'); db = fakeDb(t);
  check('다른 계정에 연결된 회원 → precondition', await rejects(S.promoteLinkedMemberToMember({ memberId: 'm1', profileId: 'p1' }, db), 'precondition') && t.profiles[0].role === 'GUEST');
  t = mk('정회원', 'GUEST', 'p1'); t.members[0].auth_user_id = null as any; db = fakeDb(t);
  check('미연결 회원 → precondition(자동 연결 없음)', await rejects(S.promoteLinkedMemberToMember({ memberId: 'm1', profileId: 'p1' }, db), 'precondition') && t.members[0].auth_user_id === null);
  t = mk(); t.profiles = []; db = fakeDb(t);
  check('앱 계정 없음 → precondition', await rejects(S.promoteLinkedMemberToMember({ memberId: 'm1', profileId: 'p1' }, db), 'precondition'));
  t = mk(); db = fakeDb(t, { beforeUpdate: (rows) => { if (rows[0]?.id === 'p1') rows[0].role = 'ADMIN'; } });
  check('확인 직후 다른 곳에서 ADMIN 으로 바뀜 → 0행 not_applied · ADMIN 유지', await rejects(S.promoteLinkedMemberToMember({ memberId: 'm1', profileId: 'p1' }, db), 'not_applied') && t.profiles[0].role === 'ADMIN');
  t = mk(); db = fakeDb(t, { updateError: { code: '42501', message: 'permission denied' } });
  check('서버 거부 → forbidden · GUEST 유지', await rejects(S.promoteLinkedMemberToMember({ memberId: 'm1', profileId: 'p1' }, db), 'forbidden') && t.profiles[0].role === 'GUEST');
}

// ── 6. 클럽 회원 자격 저장(setClubRole) ─────────────────────────────────────
{
  const mk = (role: string | null = '정회원') => ({ members: [{ id: 'm1', role }] });
  let t = mk(); let db = fakeDb(t);
  const r = await S.setClubRole({ memberId: 'm1', expected: '정회원', next: '준회원' }, db);
  check('정상 저장 · 실제 1행 반영', r.role === '준회원' && t.members[0].role === '준회원');
  t = mk(); db = fakeDb(t, { silentUpdate: true });
  check('RLS 조용한 0행 → not_applied(기존 코드는 성공 토스트를 띄웠음)', await rejects(S.setClubRole({ memberId: 'm1', expected: '정회원', next: '준회원' }, db), 'not_applied'));
  t = mk(); db = fakeDb(t, { updateError: { code: '500', message: 'db down' } });
  check('서버 오류 → unknown(성공 아님)', await rejects(S.setClubRole({ memberId: 'm1', expected: '정회원', next: '준회원' }, db), 'unknown'));
  t = mk(); db = fakeDb(t, { beforeUpdate: (rows) => { rows[0].role = '게스트'; } });
  check('동시 수정 → not_applied · 다른 곳의 값 유지', await rejects(S.setClubRole({ memberId: 'm1', expected: '정회원', next: '준회원' }, db), 'not_applied') && t.members[0].role === '게스트');
  t = mk(null); db = fakeDb(t);
  await S.setClubRole({ memberId: 'm1', expected: null, next: '정회원' }, db);
  check('미지정(null) → 정회원 저장(is null 비교)', t.members[0].role === '정회원');
}

// ── 7. 앱 권한 조회 실패 → throw(화면은 판정 보류) ─────────────────────────────
{
  const db = fakeDb({ profiles: [] }, { selectError: true });
  let threw = false; try { await S.fetchAppRolesById(db); } catch { threw = true; }
  check('fetchAppRolesById 실패 → throw(빈 Map 으로 GUEST 판정 안 함)', threw);
  const ok = await S.fetchAppRolesById(fakeDb({ profiles: [{ id: 'a', role: 'OPERATOR' }, { id: 'b', role: null }] }));
  check('fetchAppRolesById 원본 그대로', ok.get('a') === 'OPERATOR' && ok.has('b') && ok.get('b') === null);
}

console.log(`verify_admin_role_sync: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log('  FAIL', f); process.exit(1); }
