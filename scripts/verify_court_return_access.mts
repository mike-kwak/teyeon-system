/**
 * [CLOSING SPRINT B1] 코트 복귀 임원 직책 판정 — 앱(lib/kdk/courtReturnAccess.ts) ↔ SQL(B1) 일치 fixture. DB · 네트워크 미사용 · 가상 값.
 *   실행: node --experimental-strip-types scripts/verify_court_return_access.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
register('./ts-resolve-hook.mjs', import.meta.url);
const load = (p: string): Promise<any> => import(p);
const ca = await load('../lib/kdk/courtReturnAccess.ts');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/closing_sprint/B1_kdk_court_return_officers.sql'), 'utf8');

let passed = 0; const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };

// 1) 직책 목록이 SQL 과 정확히 같다(순서 무관).
const m = SQL.match(/btrim\(r\.v\) in \(([^)]*)\)/);
const sqlList = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort() : [];
check('SQL 직책 목록 추출', sqlList.length === 6, JSON.stringify(sqlList));
check('앱 직책 목록 = SQL 직책 목록', JSON.stringify([...ca.KDK_COURT_RETURN_POSITIONS].sort()) === JSON.stringify(sqlList));
check('확정 6개 직책', JSON.stringify([...ca.KDK_COURT_RETURN_POSITIONS].sort()) === JSON.stringify(['경기', '부회장', '섭외', '재무', '총무', '회장'].sort()));

// 2) 판정 행렬(B1 PGlite 시험과 같은 시나리오).
const C = 'club-1', C2 = 'club-2';
const cases: Array<[string, Array<{ role: string | null; club_id: string | null }>, string, boolean]> = [
    ['회장', [{ role: '회장', club_id: C }], C, true],
    ['부회장', [{ role: '부회장', club_id: C }], C, true],
    ['총무', [{ role: '총무', club_id: C }], C, true],
    ['재무', [{ role: '재무', club_id: C }], C, true],
    ['경기', [{ role: '경기', club_id: C }], C, true],
    ['섭외', [{ role: '섭외', club_id: C }], C, true],
    ["'CEO, 재무'", [{ role: 'CEO, 재무', club_id: C }], C, true],
    ['공백 다중값', [{ role: ' 정회원 ,  경기 ', club_id: C }], C, true],
    ['정회원', [{ role: '정회원', club_id: C }], C, false],
    ['준회원', [{ role: '준회원', club_id: C }], C, false],
    ['CEO 토큰 단독', [{ role: 'CEO', club_id: C }], C, false],
    ['부분 일치(경기위원)', [{ role: '경기위원,총무보', club_id: C }], C, false],
    ['탈회 겸직', [{ role: '총무,탈회', club_id: C }], C, false],
    ['다른 행에 탈회', [{ role: '총무', club_id: C }, { role: '탈회', club_id: C2 }], C, false],
    ['다른 클럽 직책', [{ role: '총무', club_id: C2 }], C, false],
    ['다른 클럽 직책(자기 클럽 기준)', [{ role: '총무', club_id: C2 }], C2, true],
    ['연결 행 없음', [], C, false],
    ['빈 role', [{ role: null, club_id: C }], C, false],
    ['빈 club id', [{ role: '총무', club_id: C }], '', false],
];
for (const [name, rows, club, want] of cases) {
    const got = ca.isCourtReturnOfficer(rows, club);
    check(`isCourtReturnOfficer ${name} = ${want}`, got === want, String(got));
}
check('null 행 → false', ca.isCourtReturnOfficer(null, C) === false);

// 3) 함수 없음 판정 · 세션 기억.
check('PGRST202 → missing', ca.isMissingRpcError({ code: 'PGRST202', message: 'Could not find the function' }) === true);
check('404 → missing', ca.isMissingRpcError({ code: '', status: 404 }) === true);
check('42501(권한) → missing 아님', ca.isMissingRpcError({ code: '42501', status: 403 }) === false);
check('네트워크 오류 → missing 아님', ca.isMissingRpcError({ message: 'Failed to fetch' }) === false);
check('null → missing 아님', ca.isMissingRpcError(null) === false);
ca.__resetCourtReturnRpcMemo();
check('초기: 기억 없음', ca.isCourtReturnRpcKnownMissing('u1') === false);
ca.markCourtReturnRpcMissing('u1');
check('404 표시 후 같은 계정: 재호출 안 함', ca.isCourtReturnRpcKnownMissing('u1') === true);
check('다른 계정(재로그인): 다시 조회', ca.isCourtReturnRpcKnownMissing('u2') === false);
check('비로그인 uid 없음: 기억 미적용', ca.isCourtReturnRpcKnownMissing(null) === false);
ca.__resetCourtReturnRpcMemo();
check('새로고침(모듈 재적재) 후: 다시 조회', ca.isCourtReturnRpcKnownMissing('u1') === false);
const src = fs.readFileSync(path.join(ROOT, 'lib/kdk/courtReturnAccess.ts'), 'utf8').replace(/\/\/.*$/gm, '');
check('영구 저장소(sessionStorage/localStorage) 미사용', !/sessionStorage|localStorage/.test(src));

console.log(`\nCOURT RETURN ACCESS (app ↔ SQL): ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
