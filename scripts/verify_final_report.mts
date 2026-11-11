/**
 * KDK FINAL REPORT P1 fixture — 순수 계산(모델 · 운영진 입력 · 정정 대조 · 공개 payload · 공개 조회 상태). DB/네트워크 미사용.
 *
 *   실행: node --experimental-strip-types scripts/verify_final_report.mts
 *   SQL(지문 · 권한 · 발행 · 열람 검증)은 scripts/verify_final_report_sql.mjs(PGlite) 가 맡는다.
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);
const load = (p: string): Promise<any> => import(p);
const fr = await load('../lib/kdk/finalReport/finalReportModel.ts');
const pub = await load('../lib/kdk/finalReportPublicService.ts');

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ── 가상 공식 Archive(가상 이름 · 운영 데이터 아님) ─────────────────────────────────
const U = (n: number) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 저장 순서 = 공식 순위. 3·4위(정다은 · 김영호)는 승 · 득실이 같고 이름 가나다로는 김영호가 앞이지만
// 저장 당시 연장자 규칙으로 정다은이 앞 — FINAL REPORT 는 이 순서를 그대로 써야 한다(재정렬 금지).
const RANKING = [
  { id: U(1), name: '구봉준', wins: 4, losses: 0, diff: 12, avatar: 'https://x/a.png' },
  { id: U(2), name: '박광현', wins: '3', losses: '1', diff: '7' },             // 문자열 숫자(예전 저장)
  { id: U(3), name: '정다은', wins: 3, losses: 1, diff: 5 },
  { id: U(4), name: '김영호', wins: 3, losses: 1, diff: 5 },
  { id: 'manual-guest-hong', name: '홍길동(G)', wins: 2, losses: 2, diff: 0 },
  { id: U(6), name: '이상윤', wins: 1, losses: 3, diff: -6 },                // 프로필 비공개 회원(private) — 공식 결과 이름은 표시
  { id: U(7), name: '남인우', wins: 1, losses: 3, diff: -9 },
  { id: U(8), name: '최지훈', wins: 0, losses: 4, diff: -14 },
];
const M = (id: string, r: number, c: number, g: string, ids: string[], names: string[], s1: any, s2: any, status = 'complete') =>
  ({ id, round: r, court: c, group_name: g, status, player_ids: ids, player_names: names, score1: s1, score2: s2 });
const SNAP = [
  M('m-2', 1, 2, 'A', [U(3), U(4), U(6), U(7)], ['정다은', '김영호', '이상윤', '남인우'], 6, 5),      // 접전(1점차)
  M('m-1', 1, 1, 'A', [U(1), U(2), 'manual-guest-hong', U(8)], ['구봉준', '박광현', '홍길동(G)', '최지훈'], 6, 0), // 완봉
  M('m-3', 2, 1, 'B', [U(1), U(3), U(2), U(4)], ['구봉준', '정다은', '박광현', '김영호'], '6', '4'),
  M('m-4', 2, 2, 'B', [U(6), U(7), U(8), 'manual-guest-hong'], ['이상윤', '남인우', '최지훈', '홍길동'], 3, 6),
  M('m-5', 3, 1, 'A', [U(1), U(4), U(2), U(3)], ['구봉준', '김영호', '박광현', '정다은'], 0, 0, 'playing'), // 진행 중 → 제외
  M('m-1', 9, 9, 'A', [U(5), U(5), U(5), U(5)], ['x', 'x', 'x', 'x'], 9, 9),                               // 중복 id → 제외
  M('', 1, 3, 'A', [U(1), U(2), U(3), U(4)], ['a', 'b', 'c', 'd'], 6, 1),                                   // id 없음 → 제외
  M('m-6', 3, 2, 'B', [U(1), U(2), U(3)], ['구봉준', '박광현', '정다은'], 6, 2),                             // 3명 → 제외
];
const SRC = {
  id: 'KDK-20261111-QAFR', archiveType: 'kdk', isOfficial: true, isTest: false, title: ' 11월 정모 ', date: '2026-11-11',
  rankingData: RANKING, snapshotData: SNAP,
  playerGroups: { [U(1)]: 'A', [U(2)]: 'A', [U(3)]: 'B', [U(4)]: 'B', 'manual-guest-hong': 'A', [U(6)]: 'B', [U(7)]: 'A', [U(8)]: 'B' },
};
const build = (src: any = SRC) => fr.buildFinalReportModel(src);

// ── 1 · 2) 공식 · 비테스트만 ────────────────────────────────────────────────────
const b = build();
check('[1] 공식 · 비테스트 Archive 정상 처리', b.ok === true);
const model = b.model;
check('[2] 미확정 Archive 차단', build({ ...SRC, isOfficial: false }).reason === 'not_official');
check('[2] 테스트 Archive 차단', build({ ...SRC, isTest: true }).reason === 'test');
check('[2] KDK 아닌 Archive 차단', build({ ...SRC, archiveType: 'special' }).reason === 'not_kdk');
check('ranking_data 없음 → 발행 불가', build({ ...SRC, rankingData: [] }).reason === 'no_ranking');
check('완료 경기 없음 → 발행 불가', build({ ...SRC, snapshotData: [SNAP[4]] }).reason === 'no_completed_matches');
check('순위표 같은 선수 두 번 → invalid_ranking', build({ ...SRC, rankingData: [RANKING[0], RANKING[0]] }).reason === 'invalid_ranking');

// ── 3 · 4 · 5) 저장 순서 그대로 ────────────────────────────────────────────────
const names = model.standings.map((s: any) => s.name);
check('[3] TOP3 순서 = 저장 순서(1 구봉준 · 2 박광현 · 3 정다은)', names.slice(0, 3).join() === '구봉준,박광현,정다은', names.join());
check('[4] 동률(승 · 득실 같음)도 재정렬 없음 — 정다은(3) · 김영호(4) 저장 순서 유지', model.standings[2].name === '정다은' && model.standings[3].name === '김영호');
check('[5] 과거 Archive 순위 보존 — 순위 번호 = 저장 위치', model.standings.every((s: any, i: number) => s.rank === i + 1));
check('세션: 제목 공백 정리 · 날짜 · 참가 8명 · 완료 경기 4', model.title === '11월 정모' && model.date === '2026-11-11' && model.participantCount === 8 && model.completedMatchCount === 4);
check('문자열 숫자 → 정수(박광현 3승 1패 +7)', model.standings[1].wins === 3 && model.standings[1].losses === 1 && model.standings[1].diff === 7);

// ── 6 · 7) 완료 경기만 · 다른 경기 혼입 없음 ────────────────────────────────────────
const ms = model.matches;
check('[6] 완료 경기만(진행 중 · 중복 id · id 없음 · 선수 3명 제외)', ms.map((m: any) => m.matchId).join() === 'm-1,m-2,m-3,m-4', ms.map((m: any) => m.matchId).join());
const m1 = ms.find((m: any) => m.matchId === 'm-1');
check('[7] 중복 id 경기의 선수 · 점수가 섞이지 않음(m-1 = 6:0 원본)', m1.score1 === 6 && m1.score2 === 0 && m1.teamA.join() === '구봉준,박광현');
const m3 = ms.find((m: any) => m.matchId === 'm-3');
check('[7] 경기별 선수 · 점수는 그 경기 기록만(m-3 6:4 · 문자열 점수 정수화)', m3.score1 === 6 && m3.score2 === 4 && m3.teamB.join() === '박광현,김영호');
check('경기 표시 순서: 라운드 → 코트(저장 순서와 무관)', ms[0].matchId === 'm-1' && ms[1].matchId === 'm-2');

// ── 9) 게스트 표시 · 10) 조 태그 ───────────────────────────────────────────────
const guest = model.standings[4];
check('[9] 게스트 표시 일관: 순위표 "홍길동(G)" · guest=true', guest.name === '홍길동(G)' && guest.guest === true);
const m4 = ms.find((m: any) => m.matchId === 'm-4');
check('[9] 경기 기록에 (G)가 없어도 순위표와 같은 "홍길동(G)"', m4.teamB[1] === '홍길동(G)' && m1.teamB[0] === '홍길동(G)');
// P4: 조는 표시용 변환(resolveDisplayGroups) — 이 fixture 는 선수들이 A · B 경기에 모두 나오므로 조를 임의로 정하지 않는다.
check('[10] A · B 양쪽 경기 선수는 조 미표시(임의 배정 없음) · 조별 순위 재계산 없음', model.standings[2].group === '' && model.standings[0].group === '' && !('groupRank' in model.standings[0]));

// ── 선수 이름 공개 정책(전원 표시 · /club/kdk 공식 결과와 동일) ───────────────────────────
check('프로필 비공개 회원(이상윤)도 공식 결과 이름 그대로 표시', model.standings[5].name === '이상윤' && !('masked' in model.standings[5]));
check('경기 기록에서도 같은 이름', ms.find((m: any) => m.matchId === 'm-2').teamB[0] === '이상윤');
check('가림 정책 상수 · 옵션 제거(FR_MASKED_NAME 없음)', !('FR_MASKED_NAME' in fr));

// ── 운영진 입력 · 11 · 12) 선수 키 · 경기 id 연결 ──────────────────────────────────────
const fp = (id: string) => fr.matchFingerprint(ms.find((m: any) => m.matchId === id));
const content0 = {
  schema: 1, opening: '11월 정모의 공식 기록입니다.', closing: '다음 정모에서 만나요.',
  stories: [{ playerKey: U(1), rank: 1, text: '4전 전승으로 정상에 올랐습니다.' }, { playerKey: U(2), rank: 2, text: '꾸준한 경기력을 보여 줬습니다.' }],
  featured: [{ matchId: 'm-2', fingerprint: fp('m-2'), review: '마지막 게임까지 6:5 접전이었습니다.', tag: 'MATCH_OF_THE_DAY' },
    { matchId: 'm-3', fingerprint: fp('m-3'), review: '', tag: 'OPERATORS_PICK' }],
};
const pc = fr.parseFinalReportContent(content0);
check('운영진 입력 형식 통과', pc.ok === true, JSON.stringify(pc));
check('빈 문구는 빈 상태 그대로(자동 생성 없음)', pc.content.featured[1].review === '' && fr.parseFinalReportContent({}).content.opening === '');
check('길이 제한: 오프닝 60 · 스토리 80 · 리뷰 100', fr.parseFinalReportContent({ opening: '가'.repeat(61) }).reason === 'too_long'
  && fr.parseFinalReportContent({ stories: [{ playerKey: U(1), rank: 1, text: '가'.repeat(81) }] }).reason === 'too_long'
  && fr.parseFinalReportContent({ featured: [{ matchId: 'm-1', fingerprint: 'x', review: '가'.repeat(101) }] }).reason === 'too_long'
  && fr.parseFinalReportContent({ opening: '가'.repeat(60) }).ok === true);
check('꺾쇠 거부 · 주요 경기 4개 초과 거부 · MOTD 2개 거부 · 같은 선수 스토리 2개 거부',
  fr.parseFinalReportContent({ closing: '<b>x</b>' }).reason === 'html'
  && fr.parseFinalReportContent({ featured: ['a', 'b', 'c', 'd', 'e'].map((x) => ({ matchId: x, fingerprint: 'f' })) }).reason === 'too_many'
  && fr.parseFinalReportContent({ featured: [{ matchId: 'a', fingerprint: 'f', tag: 'MATCH_OF_THE_DAY' }, { matchId: 'b', fingerprint: 'f', tag: 'MATCH_OF_THE_DAY' }] }).reason === 'tag_limit'
  && fr.parseFinalReportContent({ stories: [{ playerKey: U(1), rank: 1, text: 'a' }, { playerKey: U(1), rank: 2, text: 'b' }] }).reason === 'duplicate');
const rec0 = fr.reconcileContent(pc.content, model);
check('[11] 스토리 ↔ 선수 키 + 발행 당시 순위 일치 → ok', !rec0.needsReview && rec0.stories.every((x: any) => x.state === 'ok'));
check('[12] 리뷰 ↔ match id + 경기 지문 일치 → ok', rec0.featured.every((x: any) => x.state === 'ok'));

// ── 정정 시나리오(스토리 · 리뷰가 다른 선수 · 경기에 붙지 않음) ─────────────────────────────
const swapped = clone(SRC); [swapped.rankingData[0], swapped.rankingData[1]] = [swapped.rankingData[1], swapped.rankingData[0]];
const recSwap = fr.reconcileContent(pc.content, build(swapped).model);
check('[11] 정정으로 1 · 2위가 바뀜 → 두 스토리 모두 rank_changed(다른 선수에게 붙지 않음)',
  recSwap.needsReview && recSwap.stories.every((x: any) => x.state === 'rank_changed') && recSwap.stories[0].currentName === '구봉준' && recSwap.stories[0].currentRank === 2);
const dropped = clone(SRC); dropped.rankingData = [dropped.rankingData[2], dropped.rankingData[3], dropped.rankingData[4], ...dropped.rankingData.slice(5), dropped.rankingData[0], dropped.rankingData[1]];
check('[11] TOP3 밖으로 밀림 → not_top3', fr.reconcileContent(pc.content, build(dropped).model).stories[0].state === 'not_top3');
const scoreFix = clone(SRC); scoreFix.snapshotData[0].score2 = 4;
const recScore = fr.reconcileContent(pc.content, build(scoreFix).model);
check('[12] 리뷰한 경기 점수 정정 → match_changed(문구는 남음)', recScore.featured[0].state === 'match_changed' && recScore.featured[0].review.includes('6:5'));
const gone = clone(SRC); gone.snapshotData[0].status = 'playing';
check('[12] 리뷰한 경기가 완료 목록에서 빠짐 → match_missing', fr.reconcileContent(pc.content, build(gone).model).featured[0].state === 'match_missing');
check('정정 대상이 있으면 발행 payload 생성 거부(needs_review)', fr.buildFinalReportPayload(build(swapped).model, pc.content).reason === 'needs_review');
const re = fr.reanchorContent(pc.content, build(swapped).model, { stories: [U(1)], featured: ['m-2', 'm-3'] });
check('재확인 후 다시 묶기: 남긴 스토리는 현재 순위로 · 빼기로 한 스토리 제외 · 문구 보존',
  re.stories.length === 1 && re.stories[0].rank === 2 && re.stories[0].text === content0.stories[0].text && !fr.reconcileContent(re, build(swapped).model).needsReview);

// ── 공개 payload ──────────────────────────────────────────────────────────────
const P = fr.buildFinalReportPayload(model, pc.content);
check('공개 payload 생성', P.ok === true, JSON.stringify(P).slice(0, 200));
const txt = JSON.stringify(P.payload);
check('[8] 공개 payload 에 회원 UUID · 게스트 내부 id · 세션 id 없음', !txt.includes('11111111-0000') && !txt.includes('manual-guest') && !txt.includes('KDK-20261111'));
check('[8] 정산 · 출생연도 · 아바타 · 확정자 · 내부 키 없음', !/settlement|penalty|prize|guest_fee|birth|avatar|confirmed_by|playerKey|matchId|fingerprint|"key"|"id"/i.test(txt));
check('[8] 공식 결과 이름 표시(프로필 비공개 회원 포함)', txt.includes('이상윤'));
check('표지: 제목 · 날짜 · 공식 확정 · 참가 8 · 경기 4', P.payload.session.officialConfirmed === true && P.payload.session.participantCount === 8 && P.payload.session.matchCount === 4);
check('TOP3 카드: 순위 · 이름 · 승패득실 · 조 · 스토리(3위는 스토리 없음 → null)', P.payload.podium.length === 3 && P.payload.podium[0].story && P.payload.podium[2].story === null && P.payload.podium[2].group === '');
check('주요 경기: 운영진 선택 순서 · 태그(MOTD + 접전 · PICK) · 빈 리뷰 null',
  P.payload.featured.length === 2 && P.payload.featured[0].tags.join() === 'MATCH_OF_THE_DAY,CLOSEST_BATTLE' && P.payload.featured[1].tags.join() === 'OPERATORS_PICK' && P.payload.featured[1].review === null);
check('전체 순위 = 저장 순서 8명 · 게스트 표시', P.payload.standings.map((x: any) => x.rank).join() === '1,2,3,4,5,6,7,8' && P.payload.standings[4].guest === true);
const auto = fr.buildFinalReportPayload(model, fr.EMPTY_CONTENT);
check('운영진 입력 없음 → 기록만으로 기본 리포트(추천: 접전 m-2 → 완봉 m-1 · 문구 없음)',
  auto.ok && auto.payload.opening === null && auto.payload.podium.every((p: any) => p.story === null)
  && auto.payload.featured.map((f: any) => `${f.score1}:${f.score2}`).join() === '6:5,6:0' && auto.payload.featured[1].tags.includes('SHUTOUT'));
check('주요 경기 비우기([]) → 주요 경기 없이 발행', fr.buildFinalReportPayload(model, { ...fr.EMPTY_CONTENT, featured: [] }).payload.featured.length === 0);
check('기록으로 확인 안 되는 이야기 생성 없음(문구는 운영진 입력만)', !/역전|라이벌|극적|분위기|예상 밖/.test(JSON.stringify(auto.payload)));

// ── 문구 검증(공개 직전) ───────────────────────────────────────────────────────
const bad = fr.buildFinalReportPayload(model, { ...pc.content, stories: [{ playerKey: U(1), rank: 1, text: '최지훈 선수를 꺾었습니다.' }] });
check('스토리에 다른 선수 이름 → 차단', bad.reason === 'invalid_text' && bad.issues[0].issue.code === 'other_player');
check('마무리 문구에 참가자(이상윤) 이름 허용', fr.buildFinalReportPayload(model, { ...pc.content, closing: '이상윤 선수 수고했어요' }).ok === true);
const pii = fr.buildFinalReportPayload(model, { ...pc.content, opening: '문의 010-1234-5678' });
check('문구 개인정보(전화) → 차단', pii.reason === 'invalid_text' && pii.issues.some((x: any) => x.issue.code === 'pii'));
check('오프닝 · 마무리에 참가자 이름은 허용', fr.buildFinalReportPayload(model, { ...pc.content, opening: '구봉준 선수가 우승했습니다.' }).ok === true);

// ── 공개 응답 파서 · 공개 조회 상태 ───────────────────────────────────────────────
const parsed = fr.parsePublicFinalReport(P.payload);
check('파서: 발행 payload 그대로 통과', JSON.stringify(parsed) === JSON.stringify(P.payload));
const evil = clone(P.payload); evil.standings[0].memberId = U(1); evil.session.confirmedBy = 'x@y.z'; evil.podium[0].story = '<b>' + 'x'.repeat(200);
const pe = JSON.stringify(fr.parsePublicFinalReport(evil));
check('파서: 모르는 키(memberId · confirmedBy) 제거 · 길이 자름', !pe.includes(U(1)) && !pe.includes('x@y.z') && fr.parsePublicFinalReport(evil).podium[0].story.length === 80);
check('파서: schema 다름 · 순위 없음 → null', fr.parsePublicFinalReport({ ...P.payload, schema: 2 }) === null && fr.parsePublicFinalReport({ ...P.payload, standings: [] }) === null);
const rpc = (body: any, ok = true) => async () => ({ ok, status: ok ? 200 : 500, body });
check('공개 조회 ok', (await pub.fetchPublicFinalReport('abcdefabcdef12', rpc({ ok: true, state: 'ok', payload: P.payload, revision: 2, officialSessionId: 'S1' }))).state === 'ok');
const cor = await pub.fetchPublicFinalReport('abcdefabcdef12', rpc({ ok: true, state: 'corrected', title: '11월 정모', date: '2026-11-11', officialSessionId: 'S1', payload: P.payload }));
check('공개 조회 corrected → 수치 없이 제목 · 날짜만', cor.state === 'corrected' && !('payload' in cor) && cor.title === '11월 정모');
check('공개 조회 not_found · 조회 실패 unavailable · slug 형식 오류 not_found',
  (await pub.fetchPublicFinalReport('abcdefabcdef12', rpc({ ok: false, state: 'not_found' }))).state === 'not_found'
  && (await pub.fetchPublicFinalReport('abcdefabcdef12', rpc(null, false))).state === 'unavailable'
  && (await pub.fetchPublicFinalReport('../etc', rpc({}))).state === 'not_found');
check('공개 URL /club/report/[slug] · 공식 결과 /club/kdk/[id]', pub.finalReportPublicPath('abcdefabcdef12') === '/club/report/abcdefabcdef12' && pub.officialResultPath('KDK-1') === '/club/kdk/KDK-1');

console.log(`KDK FINAL REPORT model fixture: ${passed} passed / ${failures.length} failed`);
for (const f of failures) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
