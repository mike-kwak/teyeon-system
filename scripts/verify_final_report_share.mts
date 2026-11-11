/**
 * KDK FINAL REPORT P4 fixture — 공유 URL · 공유 동작(Web Share → 복사) · OG 표시 값 · 조 표시 변환. DB/네트워크 미사용.
 *
 *   실행: node --experimental-strip-types scripts/verify_final_report_share.mts
 *   조 표시 fixture 는 2026-11 운영 Archive 점검 형태를 본떴다(이름 · id 는 가짜):
 *     · 조 구분 없는 날 — 경기 group_name 전부 'A'(기본값), 순위표 group 은 일부 선수에게만 'A'
 *     · A/B 로 나뉜 날 — 선수마다 한 조에서만 경기, 순위표 group 은 비어 있음
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);
const load = (p: string): Promise<any> => import(p);
const fr = await load('../lib/kdk/finalReport/finalReportModel.ts');
const pub = await load('../lib/kdk/finalReportPublicService.ts');
const share = await load('../lib/kdk/finalReport/finalReportShare.ts');
const view = await load('../lib/kdk/finalReport/finalReportView.ts');

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };

const U = (n: number) => `22222222-0000-4000-8000-${String(n).padStart(12, '0')}`;
const R = (n: number, name: string, extra: Record<string, unknown> = {}) => ({ id: n === 99 ? 'g-1731000000000' : U(n), name, wins: 4 - (n % 4), losses: n % 4, diff: 10 - n, ...extra });
const M = (id: string, r: number, c: number, g: string, ids: string[], s1: number, s2: number) =>
  ({ id, round: r, court: c, group_name: g, status: 'complete', player_ids: ids, player_names: ids.map((x) => (x.startsWith('g-') ? '손님(G)' : `P${x.slice(-2)}`)), score1: s1, score2: s2 });
const src = (ranking: unknown[], snap: unknown[]) => ({ id: 'KDK-QA-P4', archiveType: 'kdk', isOfficial: true, isTest: false, title: '11월 정모', date: '2026-11-10', rankingData: ranking, snapshotData: snap, playerGroups: {} });

// ── 1) 조 표시 — 조 구분 없는 날(경기 전부 A · 순위표 일부만 A) → 조 전부 미표시 ───────────────
{
  const ranking = [R(1, '가', { group: 'A' }), R(2, '나'), R(3, '다', { group: 'A' }), R(4, '라'), R(99, '손님(G)')];
  const ids = [U(1), U(2), U(3), U(4)];
  const snap = [M('a1', 1, 1, 'A', ids, 6, 3), M('a2', 2, 1, 'A', [U(1), U(3), U(2), 'g-1731000000000'], 6, 4)];
  const b = fr.buildFinalReportModel(src(ranking, snap));
  check('조 구분 없는 날: 모델 생성', b.ok === true);
  check('조 구분 없는 날: 순위표 일부 A 가 있어도 조 미표시(몇 명만 A조로 읽히지 않음)', b.model.standings.every((s: any) => s.group === ''));
  check('조 구분 없는 날: 경기 메타에서도 A조 미표시', b.model.matches.every((m: any) => m.group === '') && view.matchMeta(b.model.matches[0]) === 'ROUND 1 · COURT 1');
  check('조 구분 없는 날: 순위 · 승패 · 득실 무변경(저장 순서)', b.model.standings.map((s: any) => s.rank).join() === '1,2,3,4,5' && b.model.standings[0].wins === 3 && b.model.standings[1].diff === 8);
  const P = fr.buildFinalReportPayload(b.model, fr.EMPTY_CONTENT);
  check('조 구분 없는 날: 공개본 조 열 없음(hasGroups=false)', P.ok && view.hasGroups(P.payload.standings) === false);
  check('게스트 (G): 순위표 이름에 (G) 없고 id 가 g- → 이름(G)', b.model.standings[4].name === '손님(G)' && b.model.standings[4].guest === true);
}
// ── 2) 조 표시 — A/B 로 나뉜 날(순위표 조 없음) → 경기에서 한 조로 정해지는 선수만 표시 ───────────
{
  const ranking = [R(1, '가'), R(5, '마'), R(2, '나'), R(6, '바'), R(3, '다'), R(7, '사'), R(4, '아'), R(8, '자'), R(9, '차')];
  const A = [U(1), U(2), U(3), U(4)]; const B = [U(5), U(6), U(7), U(8)];
  const snap = [M('a1', 1, 1, 'A', A, 6, 2), M('b1', 1, 2, 'B', B, 6, 5), M('a2', 2, 1, 'A', [U(1), U(3), U(2), U(4)], 6, 4), M('b2', 2, 2, 'B', [U(5), U(7), U(6), U(8)], 3, 6)];
  const b = fr.buildFinalReportModel(src(ranking, snap));
  const g = Object.fromEntries(b.model.standings.map((s: any) => [s.name, s.group]));
  check('A/B 나뉜 날: 경기 기준 선수 조 보완(가 · 나 · 다 · 아 = A, 마 · 바 · 사 · 자 = B)', g['가'] === 'A' && g['나'] === 'A' && g['다'] === 'A' && g['아'] === 'A' && g['마'] === 'B' && g['바'] === 'B' && g['사'] === 'B' && g['자'] === 'B', JSON.stringify(g));
  check('A/B 나뉜 날: 경기에 없는 선수(차)는 조 미표시', g['차'] === '');
  check('A/B 나뉜 날: 경기 조 유지', b.model.matches.filter((m: any) => m.group === 'B').length === 2);
  check('A/B 나뉜 날: 전체 순위 = 저장 순서 그대로(조별 재정렬 없음)', b.model.standings.map((s: any) => s.name).join('') === '가마나바다사아자차');
  const P = fr.buildFinalReportPayload(b.model, fr.EMPTY_CONTENT);
  check('A/B 나뉜 날: 공개본 TOP3 조(가 A · 마 B · 나 A)', P.ok && P.payload.podium.map((p: any) => p.group).join() === 'A,B,A');
  // 충돌 · 복수 조
  const conflict = fr.buildFinalReportModel(src(ranking.map((r: any) => (r.name === '가' ? { ...r, group: 'B' } : r)), snap));
  check('순위표 조(B)와 경기 조(A) 충돌 → 미표시', conflict.model.standings[0].group === '');
  const both = fr.buildFinalReportModel(src(ranking, [...snap, M('x1', 3, 1, 'B', [U(1), U(5), U(6), U(7)], 6, 1)]));
  check('같은 선수가 A · B 양쪽 경기 → 미표시(임의 배정 없음)', both.model.standings[0].group === '' && both.model.standings[1].group === 'B');
  const agree = fr.buildFinalReportModel(src(ranking.map((r: any) => (r.name === '마' ? { ...r, group: 'B' } : r)), snap));
  check('순위표 조와 경기 조 일치 → 그대로', agree.model.standings[1].group === 'B');
}

// ── 3) 공유 URL ─────────────────────────────────────────────────────────────────
check('공유 URL = 운영 공개 도메인 + slug + ?v=판', pub.finalReportShareUrl('abcdefabcdef12', 3) === 'https://teyeon-system.vercel.app/club/report/abcdefabcdef12?v=3');
check('판 번호 없음 · 0 · 소수 · 음수 → v 없음', ['abcdefabcdef12'].every((s) => pub.finalReportShareUrl(s, null) === 'https://teyeon-system.vercel.app/club/report/abcdefabcdef12'
  && pub.finalReportShareUrl(s, 0).endsWith('/abcdefabcdef12') && pub.finalReportShareUrl(s, 1.5).endsWith('/abcdefabcdef12') && pub.finalReportShareUrl(s, -2).endsWith('/abcdefabcdef12')));
check('재발행(판 증가) → 공유 URL 이 바뀜 · slug 유지', pub.finalReportShareUrl('abcdefabcdef12', 1) !== pub.finalReportShareUrl('abcdefabcdef12', 2) && pub.finalReportShareUrl('abcdefabcdef12', 2).includes('/club/report/abcdefabcdef12?'));
check('공유 URL 에 localhost · vercel Preview · 관리자 경로 없음', !/localhost|127\.0\.0\.1|-git-|\/admin|\/api\//.test(pub.finalReportShareUrl('abcdefabcdef12', 2)));
check('OG 경로 /club/report/[slug]/og?v=판 · 판 없으면 v 없음', pub.finalReportOgPath('abcdefabcdef12', 4) === '/club/report/abcdefabcdef12/og?v=4' && pub.finalReportOgPath('abcdefabcdef12', null) === '/club/report/abcdefabcdef12/og');
check('기존 slug URL(판 없음) 유지', pub.finalReportPublicPath('abcdefabcdef12') === '/club/report/abcdefabcdef12');
const sd = share.shareDataOf('11월 정모', 'https://teyeon-system.vercel.app/club/report/abcdefabcdef12?v=2');
check('공유 문구: 제목 · 고정 설명만(우승자 · 수치 · 개인정보 없음)', sd.title === 'THE FINAL STORY · 11월 정모' && sd.text === 'TEYEON KDK 공식 결과 리포트' && !/CHAMPION|\d+명/.test(sd.text));
check('공유 문구: 제목 없으면 TEYEON KDK', share.shareDataOf('  ', 'u').title === 'THE FINAL STORY · TEYEON KDK');

// ── 4) 공유 동작(Web Share → 복사) ─────────────────────────────────────────────────
const copyOk = async () => true; const copyNo = async () => false;
let copied = ''; const copySpy = async (t: string) => { copied = t; return true; };
const err = (name: string) => Object.assign(new Error(name), { name });
check('share 지원 → shared(복사 안 함)', (await share.shareOrCopy(sd, { share: async () => {} }, copySpy)) === 'shared' && copied === '');
check('share 미지원(PC 등) → 링크 복사', (await share.shareOrCopy(sd, {}, copySpy)) === 'copied' && copied === sd.url);
check('navigator 없음 → 복사', (await share.shareOrCopy(sd, null, copyOk)) === 'copied');
check('사용자가 공유 시트 취소(AbortError) → cancelled · 복사 안 함 · 안내 없음', await (async () => { copied = ''; const r = await share.shareOrCopy(sd, { share: async () => { throw err('AbortError'); } }, copySpy); return r === 'cancelled' && copied === '' && share.SHARE_OUTCOME_TEXT[r] === null; })());
check('share 실패(NotAllowedError · 인앱 제한) → 복사로 대체', (await share.shareOrCopy(sd, { share: async () => { throw err('NotAllowedError'); } }, copyOk)) === 'copied');
check('canShare=false → 공유 시트 없이 복사', await (async () => { let called = false; const r = await share.shareOrCopy(sd, { canShare: () => false, share: async () => { called = true; } }, copyOk); return r === 'copied' && !called; })());
check('canShare 가 오류 → 복사', (await share.shareOrCopy(sd, { canShare: () => { throw new Error('x'); }, share: async () => {} }, copyOk)) === 'copied');
check('복사 실패 → failed(주소 직접 표시 안내)', (await share.shareOrCopy(sd, {}, copyNo)) === 'failed' && /길게 눌러/.test(share.SHARE_OUTCOME_TEXT.failed));
check('복사 함수가 throw → failed', (await share.shareOrCopy(sd, {}, async () => { throw new Error('x'); })) === 'failed');
check('링크 복사 버튼(preferCopy) → 공유 시트 안 열고 복사', await (async () => { let called = false; const r = await share.shareOrCopy(sd, { share: async () => { called = true; } }, copyOk, { preferCopy: true }); return r === 'copied' && !called; })());
check('결과 문구에 "전송 완료" 류 표현 없음', Object.values(share.SHARE_OUTCOME_TEXT).every((t: any) => t == null || !/전송|완료|보냈/.test(t)) && share.SHARE_OUTCOME_TEXT.copied === '링크가 복사되었습니다. 카카오톡 대화방에 붙여 넣어 공유하세요.');

// ── 5) OG 표시 값 ───────────────────────────────────────────────────────────────
const payload = {
  schema: 1, session: { title: '11월 정모', date: '2026-11-10', officialConfirmed: true, participantCount: 27, matchCount: 27 }, opening: '초안에만 있는 문구', closing: null,
  podium: [{ rank: 1, name: '구봉준', wins: 4, losses: 0, diff: 14, group: '', guest: false, story: '스토리' }, { rank: 2, name: '아주아주긴이름의선수입니다', wins: 3, losses: 1, diff: 7, group: '', guest: false, story: null }, { rank: 3, name: '홍길동(G)', wins: 3, losses: 1, diff: 5, group: '', guest: true, story: null }],
  featured: [], standings: [],
};
const ov = view.ogViewOf({ state: 'ok', payload });
check('OG 발행본: report · 제목 · 날짜(요일)', ov.kind === 'report' && ov.title === '11월 정모' && ov.date === '2026. 11. 10 (화)');
check('OG TOP3 = 공개본 podium 순서 그대로 · 게스트 (G)', ov.top3.map((x: any) => x.rank).join() === '1,2,3' && ov.top3[0].name === '구봉준' && ov.top3[2].name === '홍길동(G)' && ov.top3[0].label === 'CHAMPION');
check('OG 긴 이름 말줄임(10자 이내)', [...ov.top3[1].name].length === 10 && ov.top3[1].name.endsWith('…'));
check('말줄임 앞 공백 제거(Alexander Montgomery → Alexander…)', view.clipText('Alexander Montgomery', 11) === 'Alexander…');
check('OG 에 운영진 문구 · 스토리 · 승패 수치 없음', !JSON.stringify(ov).includes('초안') && !JSON.stringify(ov).includes('스토리') && !('wins' in ov.top3[0]));
for (const st of ['corrected', 'not_found', 'unavailable']) check(`OG ${st} → 중립 이미지`, view.ogViewOf({ state: st, payload }).kind === 'neutral');
check('OG 결과 없음 → 중립', view.ogViewOf(null).kind === 'neutral');
check('clipText: 코드 포인트 기준(이모지 깨짐 없음)', view.clipText('가나다라마', 3) === '가나…' && view.clipText('가나', 3) === '가나' && view.clipText('😀😀😀😀', 3) === '😀😀…');
check('긴 세션명 OG 말줄임(24자)', [...view.ogViewOf({ state: 'ok', payload: { ...payload, session: { ...payload.session, title: '가'.repeat(40) } } }).title].length === 24);

console.log(`KDK FINAL REPORT P4 share/og/group fixture: ${passed} passed / ${failures.length} failed`);
for (const f of failures) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
