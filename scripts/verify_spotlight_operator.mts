/**
 * MATCH SPOTLIGHT 운영진 관전 포인트 · 운영진 PICK · 공유 포스터 레이아웃 fixture (순수 계산 · DB/네트워크/DOM 미사용).
 *
 *   실행: node scripts/verify_spotlight_operator.mts
 *   검증: 메모 → 경기 연결(자동 · 추정 · 후보 여러 개 · 이름 없음) · 문구 정리/거부(HTML · 길이 · 빈 값) ·
 *         없는 경기 · 다른 선수 언급 거부 · 공식 분석 불변 · 원문 메모 비공개 · 운영진 PICK 자격(유형 없음 · 비공개 근거 ·
 *         시작됨 · 이미 TOP · 교체 대상) · 공개 파서 allow-list · 공유 문구 · 포스터 높이 1350~2340 · 이름 잘림 없음.
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);
const load = (path: string): Promise<any> => import(path);
const se = await load('../lib/kdk/analytics/spotlightEngine.ts');
const sp = await load('../lib/kdk/analytics/spotlightPublish.ts');
const pub = await load('../lib/kdk/analytics/publicSpotlight.ts');
const op = await load('../lib/kdk/analytics/spotlightOperator.ts');
const poster = await load('../lib/kdk/spotlightPoster.ts');

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, info = '') => { if (cond) passed += 1; else failures.push(`${name}${info ? ` — ${info}` : ''}`); };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ── 세션(가상 회원 · 실제 운영 데이터 아님) ──────────────────────────────────────
const NAMES = ['구봉준', '김영호', '김병식', '최지훈', '정다은', '이상윤', '박광현', '남인우', '오세훈', '한지민', '윤서준', '강민호'];
const MEMBERS = NAMES.map((name, i) => ({ id: `m${i + 1}`, name }));
const id = (n: string) => MEMBERS.find((m) => m.name === n)?.id || `guest-${n}`;
const row = (no: number, names: string[], status = 'waiting') => ({
  id: `L${no}`, round: no <= 3 ? 1 : 2, court: null, status, group_name: 'A',
  player_ids: names.map(id), player_names: names, session_title: '11월 정모',
});
const MATCHES = [
  row(1, ['구봉준', '김영호', '김병식', '최지훈']),
  row(2, ['정다은', '이상윤', '박광현', '남인우']),
  row(3, ['오세훈', '한지민', '윤서준', '강민호']),
  row(4, ['구봉준', '정다은', '김영호', '오세훈']),
  row(5, ['김병식', '이상윤', '홍길동(G)', '한지민']),
  row(6, ['최지훈', '박광현', '윤서준', '남인우']),
  row(7, ['강민호', '김영호', '이상윤', '오세훈']),
];
const built = se.buildSpotlight({ sessionId: 'S-OP', sessionDate: '2026-11-08', sessionMatches: MATCHES, archiveRows: [], members: MEMBERS });
const snap = (no: number) => clone(built.predictions.find((p: any) => p.matchNo === no));
const cand = (type: string, fact: any, score = 70) => ({ type, score, fact });
// 유형 지정(실제 엔진 snapshot 위에 테스트용 근거만 덮어씀)
const withType = (s: any, type: string | null, fact?: any) => ({ ...s, mainType: type, score: type ? 70 : 0, candidates: type ? [cand(type, fact)] : [] });
const S = {
  1: withType(snap(1), 'RIVAL', { type: 'RIVAL', kind: 'fated', aSlot: 0, bSlot: 2, aWins: 3, bWins: 3, games: 6 }),
  2: withType(snap(2), 'CLOSE', { type: 'CLOSE', probA: 0.5, tier: 'reference' }),
  3: withType(snap(3), 'POWER', { type: 'POWER', minGames: 25, avgRate: 0.6 }),
  4: withType(snap(4), 'HOT_STREAK', { type: 'HOT_STREAK', slot: 0, streak: 4 }),
  5: withType(snap(5), 'CLOSE', { type: 'CLOSE', probA: 0.52, tier: 'reference' }),
  6: withType(snap(6), 'CLOSE', { type: 'CLOSE', probA: 0.49, tier: 'reference' }),
  7: withType(snap(7), null),
} as Record<number, any>;
const stored = (sel: number[], over: Record<number, any> = {}) => Object.entries(S).map(([no, s]) => ({
  matchId: s.matchId, status: 'active', selected: sel.includes(Number(no)), snapshot: over[Number(no)] || s, currentPlayerIds: s.playerIds,
}));
const prep = (sel = [1, 2, 3, 4, 5], over: Record<number, any> = {}, restricted: string[] = []) => sp.preparePublish({
  modelVersion: 'm', selectVersion: 's', sessionId: 'S-OP', cutoffDate: '2026-11-08', title: '11월 정모', date: '2026-11-08',
  predictions: stored(sel, over), restrictedMemberIds: restricted,
});
const allWaiting = (p: any): Map<number, string> => new Map(p.eligible.map((s: any) => [s.matchNo as number, 'waiting']));
const ctx = (p: any, status: Map<number, string> | null = allWaiting(p)) => ({ eligible: p.eligible, usesRestricted: sp.mainFactUsesRestricted, currentStatus: status });

// ── 1. 메모 → 경기 연결 ───────────────────────────────────────────────────────
{
  const base = prep().payload;
  check('기본: 자동 TOP 5', base.items.length === 5, String(base.items.length));
  const notes = [
    '오늘 구봉준·김영호 경기 기대돼. 두 사람 호흡이 좋아.',
    '오늘 참가하는 게스트 홍길동님은 오픈부 우승 경험이 있어.',
    '오늘은 구봉준과 김병식의 라이벌전이 기대돼.',
    '영호 형 오늘 컨디션 최고래',
    '최지훈 박광현 듀오 첫 출전',
    '날씨가 좋아서 다들 기분 좋아 보여',
    '구봉준 오늘 생일',
  ];
  const links = op.linkOperatorNotes(notes, base);
  const L = (i: number) => links[i];
  check('예시1 구봉준·김영호 → 같은 팀 경기 자동 연결(1경기 · 파트너)', L(0).status === 'linked' && L(0).matchNo === 1 && L(0).relation === 'partners', JSON.stringify(L(0)));
  check('예시2 게스트(이름+님) → 그 게스트 경기(5경기)', L(1).status === 'linked' && L(1).matchNo === 5, JSON.stringify(L(1)));
  check('예시3 구봉준·김병식 → 맞대결 경기(1경기 · 상대)', L(2).status === 'linked' && L(2).matchNo === 1 && L(2).relation === 'opponents', JSON.stringify(L(2)));
  check('성 없는 이름(영호) → 추정 표시', L(3).status === 'guess' || L(3).status === 'choose', JSON.stringify(L(3)));
  check('최지훈·박광현 → TOP 밖 6경기 연결 · inTop=false', L(4).matchNo === 6 && L(4).inTop === false, JSON.stringify(L(4)));
  check('선수 이름 없음 → none(운영진이 경기 선택)', L(5).status === 'none' && L(5).matchNo === null);
  check('한 명이 여러 경기 → choose(후보 1·4경기)', L(6).status === 'choose' && JSON.stringify(L(6).candidates) === '[1,4]', JSON.stringify(L(6)));
  check('연결 결과에 공개 데이터 변경 없음(제안만)', JSON.stringify(base) === JSON.stringify(prep().payload));
  check('findNames: 긴 이름 우선 · 겹침 없음', JSON.stringify(op.findNames('김영호와영호', ['영호', '김영호'])) === '["김영호","영호"]');
  check('메모 최대 8줄', op.linkOperatorNotes(Array(12).fill('구봉준'), base).length === 8);
}

// ── 2. 문구 정리 · 형식 검증 ────────────────────────────────────────────────────
{
  check('HTML 꺾쇠 거부', op.sanitizeOperatorText('<b>굿</b>').reason === 'operator_html');
  check('스크립트 거부', op.sanitizeOperatorText('<script>alert(1)</script>').reason === 'operator_html');
  check('빈 문구 거부', op.sanitizeOperatorText('   \n ').reason === 'operator_text_empty');
  check('121자 거부', op.sanitizeOperatorText('가'.repeat(121)).reason === 'operator_text_too_long');
  check('120자 허용', op.sanitizeOperatorText('가'.repeat(120)).ok === true);
  const t = op.sanitizeOperatorText('호흡이\n\n좋아\u200B\u0007   기대돼 ');
  check('제어문자 · 줄바꿈 · 공백 정리', t.ok && t.text === '호흡이 좋아 기대돼', JSON.stringify(t));
  check('문자열 아님 거부', op.sanitizeOperatorText(123).reason === 'operator_invalid');
  check('operator 없음 → 빈 입력(자동 그대로)', op.parseOperatorInput(undefined).ok && op.parseOperatorInput(undefined).input.points.length === 0);
  check('같은 경기 두 문구 거부', op.parseOperatorInput({ points: [{ matchNo: 1, text: 'a' }, { matchNo: 1, text: 'b' }] }).reason === 'operator_duplicate_match');
  check('9개 이상 거부', op.parseOperatorInput({ points: Array.from({ length: 9 }, (_, i) => ({ matchNo: i + 1, text: 'a' })) }).reason === 'operator_too_many');
  check('경기 번호 형식 오류 거부', op.parseOperatorInput({ points: [{ matchNo: '1', text: 'a' }] }).reason === 'operator_invalid');
  check('PICK 형식 오류 거부', op.parseOperatorInput({ pick: { matchNo: 6, replace: 'x' } }).reason === 'operator_invalid');
  check('배열 아님 거부', op.parseOperatorInput({ points: 'x' }).reason === 'operator_invalid');
}

// ── 3. 관전 포인트 반영 · 공식 분석 불변 ──────────────────────────────────────────
{
  const p = prep();
  const input = { points: [{ matchNo: 1, text: '구봉준·김영호 호흡이 좋다는 운영진 소식' }, { matchNo: 6, text: '최지훈·박광현 듀오 첫 출전' }], pick: null };
  const r = op.applyOperatorInput(p.payload, input, ctx(p));
  check('반영 성공', r.ok === true, JSON.stringify(r));
  const it1 = r.payload.items.find((i: any) => i.matchNo === 1);
  check('TOP 경기 카드에 운영진 관전 포인트', it1.operatorPoint === '구봉준·김영호 호흡이 좋다는 운영진 소식');
  check('전체 분석 목록에도 같은 문구', r.payload.matches.find((m: any) => m.matchNo === 1).operatorPoint === it1.operatorPoint);
  check('TOP 밖 경기 문구는 전체 분석에만', !r.payload.items.some((i: any) => i.matchNo === 6) && r.payload.matches.find((m: any) => m.matchNo === 6).operatorPoint === '최지훈·박광현 듀오 첫 출전');
  const strip = (x: any) => { const { operatorPoint, operatorPick, ...rest } = x; return rest; };
  check('공식 분석(헤드라인 · 관전 포인트 · 예측 · 표본 · 배지 · 순서) 불변',
    JSON.stringify(r.payload.items.map(strip)) === JSON.stringify(p.payload.items.map(strip)) && JSON.stringify(r.payload.matches.map(strip)) === JSON.stringify(p.payload.matches.map(strip)));
  check('입력 객체 불변(원본 payload 수정 없음)', !p.payload.items.some((i: any) => i.operatorPoint));
  check('운영진 입력 없음 → 같은 payload', op.applyOperatorInput(p.payload, { points: [], pick: null }, ctx(p)).payload === p.payload);
  check('없는 경기 거부', op.applyOperatorInput(p.payload, { points: [{ matchNo: 99, text: '굿' }], pick: null }, ctx(p)).reason === 'operator_unknown_match');
  const mis = op.applyOperatorInput(p.payload, { points: [{ matchNo: 2, text: '구봉준 출전 기대' }], pick: null }, ctx(p));
  check('다른 경기 선수 언급 거부', mis.reason === 'operator_player_mismatch' && mis.matchNo === 2, JSON.stringify(mis));
  check('그 경기 선수만 언급하면 허용', op.applyOperatorInput(p.payload, { points: [{ matchNo: 2, text: '정다은·박광현 맞대결' }], pick: null }, ctx(p)).ok === true);
  check('선수 이름 없는 문구 허용', op.applyOperatorInput(p.payload, { points: [{ matchNo: 3, text: '오늘 첫 경기' }], pick: null }, ctx(p)).ok === true);
  const json = JSON.stringify(r.payload);
  check('원문 메모 · 내부 id 미포함', !json.includes('두 사람 호흡이 좋아') && !/"m\d+"|guest-|playerIds|matchId/.test(json));
}

// ── 4. 운영진 PICK ────────────────────────────────────────────────────────────
{
  const p = prep();
  const ok = op.applyOperatorInput(p.payload, { points: [], pick: { matchNo: 6, replace: 5 } }, ctx(p));
  check('PICK 성공(6경기 → 5경기 자리)', ok.ok === true, JSON.stringify(ok));
  const idx = p.payload.items.findIndex((i: any) => i.matchNo === 5);
  check('교체 위치 유지 · operatorPick 표시', ok.payload.items[idx].matchNo === 6 && ok.payload.items[idx].operatorPick === true);
  check('PICK 카드 배지 · 문구 = 공식 분석(describeSpotlight)', ok.payload.items[idx].badge === 'CLOSE' && ok.payload.items[idx].headline === pub.describeSpotlight(S[6]).headline);
  check('나머지 TOP 그대로', JSON.stringify(ok.payload.items.filter((_: any, i: number) => i !== idx)) === JSON.stringify(p.payload.items.filter((_: any, i: number) => i !== idx)));
  check('TOP 개수 그대로(5)', ok.payload.items.length === 5);
  check('PICK + 관전 포인트 함께', op.applyOperatorInput(p.payload, { points: [{ matchNo: 6, text: '최지훈 박광현 첫 출전' }], pick: { matchNo: 6, replace: 2 } }, ctx(p)).payload.items.find((i: any) => i.matchNo === 6).operatorPoint === '최지훈 박광현 첫 출전');
  check('유형 없는 경기 PICK 거부(공개 카드 구조상)', op.applyOperatorInput(p.payload, { points: [], pick: { matchNo: 7, replace: 5 } }, ctx(p)).reason === 'pick_no_analysis');
  check('이미 TOP 경기 PICK 거부', op.applyOperatorInput(p.payload, { points: [], pick: { matchNo: 1, replace: 5 } }, ctx(p)).reason === 'pick_already_selected');
  check('없는 경기 PICK 거부', op.applyOperatorInput(p.payload, { points: [], pick: { matchNo: 42, replace: 5 } }, ctx(p)).reason === 'pick_unknown_match');
  check('TOP 5 가득 · 교체 대상 없음 거부', op.applyOperatorInput(p.payload, { points: [], pick: { matchNo: 6, replace: null } }, ctx(p)).reason === 'pick_replace_required');
  check('교체 대상이 TOP 아님 거부', op.applyOperatorInput(p.payload, { points: [], pick: { matchNo: 6, replace: 7 } }, ctx(p)).reason === 'pick_replace_invalid');
  const started: Map<number, string> = new Map(allWaiting(p)); started.set(6, 'playing');
  check('시작된 경기 PICK 거부', op.applyOperatorInput(p.payload, { points: [], pick: { matchNo: 6, replace: 5 } }, ctx(p, started)).reason === 'pick_not_waiting');
  check('상태 확인 불가 → PICK 거부(fail-closed)', op.applyOperatorInput(p.payload, { points: [], pick: { matchNo: 6, replace: 5 } }, ctx(p, null)).reason === 'pick_not_waiting');
  // 증명 불가(저장 예측 없음 = 생성 때 DB 거절) · 선수 변경으로 무효 → eligible 에 없음
  const noCert = sp.preparePublish({ modelVersion: 'm', selectVersion: 's', sessionId: 'S-OP', cutoffDate: '2026-11-08', title: 't', date: '2026-11-08',
    predictions: stored([1, 2, 3, 4, 5]).filter((x: any) => x.matchId !== S[6].matchId), restrictedMemberIds: [] });
  check('저장 예측 없는 경기(증명 불가) PICK 거부', op.applyOperatorInput(noCert.payload, { points: [], pick: { matchNo: 6, replace: 5 } }, ctx(noCert)).reason === 'pick_unknown_match');
  const changed = sp.preparePublish({ modelVersion: 'm', selectVersion: 's', sessionId: 'S-OP', cutoffDate: '2026-11-08', title: 't', date: '2026-11-08',
    predictions: stored([1, 2, 3, 4, 5]).map((x: any) => (x.matchId === S[6].matchId ? { ...x, currentPlayerIds: ['m1', 'm2', 'm3', 'm9'] } : x)), restrictedMemberIds: [] });
  check('선수 교체로 무효된 경기 PICK 거부', op.applyOperatorInput(changed.payload, { points: [], pick: { matchNo: 6, replace: 5 } }, ctx(changed)).reason === 'pick_unknown_match');
  // 비공개 회원이 메인 근거(HOT_STREAK slot 0 = 최지훈 m4 를 비공개로)
  const s6hot = withType(S[6], 'HOT_STREAK', { type: 'HOT_STREAK', slot: 0, streak: 5 });
  const priv = prep([1, 2, 3, 4, 5], { 6: s6hot }, ['m4']);
  check('비공개 회원 근거 PICK 거부', op.applyOperatorInput(priv.payload, { points: [], pick: { matchNo: 6, replace: 5 } }, ctx(priv)).reason === 'pick_private');
  // TOP 5 미만이면 교체 없이 추가 가능
  const four = prep([1, 2, 3, 4]);
  const add = op.applyOperatorInput(four.payload, { points: [], pick: { matchNo: 6, replace: null } }, ctx(four));
  check('TOP 4 → PICK 추가(5번째)', add.ok && add.payload.items.length === 5 && add.payload.items[4].operatorPick === true);
  check('자동 점수 · 순서 비교자 불변(selected 플래그 · 점수 그대로)', S[6].score === 70 && four.eligible.find((s: any) => s.matchNo === 6).score === 70);
}

// ── 5. 공개 파서 allow-list · 공유 문구 · 편집기 복원 ────────────────────────────────
{
  const p = prep();
  const r = op.applyOperatorInput(p.payload, { points: [{ matchNo: 1, text: '호흡 좋은 듀오' }], pick: { matchNo: 6, replace: 5 } }, ctx(p));
  const raw = clone(r.payload);
  raw.items[0].operatorPoint = '<img src=x onerror=alert(1)>호흡\u0000좋음';
  raw.items[0].operatorPick = 'yes';
  raw.items[0].secretNote = '원문 메모';
  raw.matches[0].operatorPoint = 'x'.repeat(300);
  const parsed = pub.parsePublicSpotlightPayload(raw);
  check('파서: 꺾쇠 · 제어문자 제거', parsed.items[0].operatorPoint === 'img src=x onerror=alert(1)호흡 좋음', parsed.items[0].operatorPoint);
  check('파서: operatorPick 은 true 만', parsed.items[0].operatorPick === undefined);
  check('파서: 모르는 필드 제거', !('secretNote' in parsed.items[0]));
  check('파서: 120자 제한', [...parsed.matches[0].operatorPoint].length === 120);
  const good = pub.parsePublicSpotlightPayload(clone(r.payload));
  check('파서: 정상 PICK · 관전 포인트 유지', good.items.some((i: any) => i.operatorPick === true) && good.items[0].operatorPoint === '호흡 좋은 듀오');
  check('파서: 운영진 필드 없는 예전 payload 그대로', JSON.stringify(pub.parsePublicSpotlightPayload(clone(p.payload))) === JSON.stringify(pub.parsePublicSpotlightPayload(clone(p.payload))) && !JSON.stringify(pub.parsePublicSpotlightPayload(clone(p.payload))).includes('operator'));
  const share = pub.buildSpotlightShareText(good, 'https://x/club/spotlight/abc');
  check('공유 문구: 운영진 PICK · 관전 포인트 · 안내', share.includes('[운영진 PICK]') && share.includes('운영진 관전 포인트: 호흡 좋은 듀오') && share.includes(pub.OPERATOR_POINT_NOTICE));
  const back = op.operatorInputFromPayload(good);
  check('공개본 → 편집기 복원(문구 · PICK 경기)', back.points.some((x: any) => x.matchNo === 1 && x.text === '호흡 좋은 듀오') && back.pick?.matchNo === 6);
  check('sameOperatorInput 순서 무관', op.sameOperatorInput({ points: [{ matchNo: 2, text: 'b' }, { matchNo: 1, text: 'a' }], pick: null }, { points: [{ matchNo: 1, text: 'a' }, { matchNo: 2, text: 'b' }], pick: null }));
}

// ── 6. 포스터 레이아웃(글자 폭 근사 측정) ──────────────────────────────────────────
{
  // 근사 폭: 한글 1.0em · 영문 대문자 0.68 · 소문자/숫자 0.56 · 공백 0.3 · 기타 0.5
  const measure = (s: string, font: string) => {
    const size = Number((font.match(/(\d+)px/) || [])[1]) || 16;
    let w = 0;
    for (const ch of [...s]) {
      if (/[가-힣ㄱ-ㅎ]/.test(ch)) w += 1.0; else if (/[A-Z]/.test(ch)) w += 0.68; else if (/[a-z0-9]/.test(ch)) w += 0.56; else if (ch === ' ') w += 0.3; else w += 0.5;
    }
    return w * size;
  };
  const LONG = '가나다라마바사아자차카타파하가나다라마바사아'; // 22자
  const mk = (n: number, o: { long?: boolean; mid?: boolean; op?: boolean; pick?: boolean } = {}) => {
    const p = prep(n >= 5 ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5].slice(0, n)).payload;
    const pl = clone(p);
    pl.items = pl.items.slice(0, n).map((it: any, i: number) => ({
      ...it,
      teamA: o.long ? [`${LONG}${i}`, `${LONG.slice(0, 18)}…(G)`] : o.mid ? ['남궁민수아', '김수한무(G)'] : it.teamA,
      teamB: o.long ? [`${LONG}${i}B`, LONG.slice(0, 20)] : o.mid ? ['제갈공명현', '황보세종대왕'] : it.teamB,
      viewpoint: o.long ? '공식 맞대결 기록이 아주 길게 이어지는 경우를 가정한 분석 문장입니다. '.repeat(3).slice(0, 160) : it.viewpoint,
      ...(o.op && (o.long || i < 2) ? { operatorPoint: '운영진이 전한 현장 소식이 길게 들어가는 경우를 가정합니다. '.repeat(3).slice(0, o.long ? 120 : 70) } : {}),
      ...(o.pick && i === 1 ? { operatorPick: true } : {}),
    }));
    return pl;
  };
  const cases: Array<[string, any]> = [
    ['0경기', mk(0)], ['1경기', mk(1)], ['3경기', mk(3)], ['5경기', mk(5)],
    ['5경기 + 관전 포인트 2개(70자) + PICK', mk(5, { op: true, pick: true })],
    ['5경기 · 22자 이름 · 긴 분석', mk(5, { long: true })],
    ['5경기 · 7~8자 이름 + 관전 포인트 2개 + PICK', mk(5, { mid: true, op: true, pick: true })],
    ['5경기 · 긴 이름 · 긴 분석 · 관전 포인트 전부(최악)', mk(5, { long: true, op: true, pick: true })],
  ];
  for (const [label, pl] of cases) {
    const l = poster.layoutSpotlightPoster(pl, measure, { linkLabel: 'teyeon-system.vercel.app/club/spotlight/abcdefghijklmnop' });
    const inRange = l.width === 1080 && l.height >= 1350 && l.height <= 2340;
    const worst = label.includes('최악');
    console.log(`    포스터 ${label}: 1080 × ${l.height} · 단계 ${l.level} · 내용 ${l.contentHeight} · 전체 축소 ${l.fitScale.toFixed(3)}`);
    check(`포스터 ${label}: 1080 × 1350~2340`, inRange, `h=${l.height}`);
    check(`포스터 ${label}: ${worst ? '최악 입력도 축소 0.8 이상' : '압축 단계 안에서 맞음(전체 축소 없음)'}`, worst ? l.fitScale >= 0.8 : !l.overflow, `fit=${l.fitScale}`);
    // 이름 잘림 없음: 그려진 팀 줄을 합치면 원래 팀 문구(공백 무시)와 같다
    const allOk = pl.items.every((it: any, i: number) => {
      const drawn = l.teamLines[i].join('').replace(/[\s·]+/g, '');
      const want = [...it.teamA, ...it.teamB].join('').replace(/[\s·]+/g, '');
      return drawn === want;
    });
    check(`포스터 ${label}: 선수 이름 누락 · 잘림 없음`, allOk);
    check(`포스터 ${label}: 구분점이 줄 끝 · 줄 처음에 홀로 남지 않음`, l.teamLines.flat().every((x: string) => !/^\s*·|·\s*$/.test(x)));
    const fontOf = (pred: (t: string) => boolean) => { const o = l.ops.find((x: any) => x.t === 'text' && pred(x.text)); return o ? Number(o.font.match(/(\d+)px/)[1]) : null; };
    if (pl.items.length) {
      const it0 = pl.items[0];
      const nameF = fontOf((t) => it0.teamA.some((n: string) => t.includes(n)) || t.includes(it0.teamA[0]?.slice(0, 4) || '@@'));
      const vpF = fontOf((t) => t.startsWith(it0.viewpoint.slice(0, 6)));
      const headF = fontOf((t) => t === it0.headline || t.startsWith(it0.headline.slice(0, 4)));
      console.log(`      글자(px): 선수명 ${nameF} · 헤드라인 ${headF} · 분석 ${vpF}`);
      check(`포스터 ${label}: 선수명이 헤드라인보다 큼`, !!nameF && !!headF && nameF > headF, `${nameF} vs ${headF}`);
      if (!worst && !label.includes('22자')) {
        check(`포스터 ${label}: 본문 31px(390pt 전체화면 11pt) 이상`, !!vpF && vpF >= 31, `vp=${vpF}`);
        check(`포스터 ${label}: 선수명 40px 이상`, !!nameF && nameF >= 40, `name=${nameF}`);
      }
      check(`포스터 ${label}: 출처 칩 '공식 KDK 기록'`, l.ops.some((o: any) => o.t === 'text' && o.text === '공식 KDK 기록'));
    }
    const texts = l.ops.filter((o: any) => o.t === 'text').map((o: any) => o.text).join('\n');
    if (pl.items.some((i: any) => i.operatorPoint)) check(`포스터 ${label}: 운영진 관전 포인트 · 안내 표시`, texts.includes('운영진 관전 포인트') && texts.includes(pub.OPERATOR_POINT_NOTICE));
    if (pl.items.some((i: any) => i.operatorPick)) check(`포스터 ${label}: 운영진 PICK 배지`, texts.includes('운영진 PICK'));
    check(`포스터 ${label}: 면책 문구`, texts.includes(pub.SPOTLIGHT_DISCLAIMER));
    check(`포스터 ${label}: 숫자 확률 · 내부 id 없음`, !/%|probA|"m\d+"|guest-/.test(texts));
    const xs = l.ops.filter((o: any) => o.t === 'text' && o.align === 'left').every((o: any) => o.x >= 0 && o.x + measure(o.text, o.font) <= 1080 + 1);
    check(`포스터 ${label}: 왼쪽 정렬 글자가 폭 안`, xs);
  }
  const w = poster.wrapLines('가나다라마바사', '900 40px x', 120, measure, null);
  check('wrapLines: 긴 단어 글자 단위 줄바꿈 · 손실 없음', w.lines.join('') === '가나다라마바사' && w.lines.length === 3, JSON.stringify(w));
  const e = poster.wrapLines('가 나 다 라 마 바 사 아 자 차', '600 40px x', 100, measure, 2);
  check('wrapLines: 줄 수 제한 시 말줄임', e.ellipsized && e.lines.length === 2 && e.lines[1].endsWith('…'));
  check('파일 이름', poster.posterFileName('2026-11-08') === 'TEYEON_SPOTLIGHT_20261108.png');
  check('날짜 요일(세션 날짜 기준)', poster.posterDateLabel('2026-11-08') === '2026.11.08 (일)' && poster.posterDateLabel('2026-11-07') === '2026.11.07 (토)' && poster.posterDateLabel('2026-02-28') === '2026.02.28 (토)', poster.posterDateLabel('2026-11-08'));
  check('날짜 형식 다르면 그대로', poster.posterDateLabel('x') === 'x');
}

// ── P0: 메모(작성 지시) ↔ 공개 문구 분리 · 지시문 경고 ─────────────────────────────
{
  const INSTRUCTIONS = [
    '2번 경기는 오픈부 경기니까 강조해 줘', '2번은 오픈부 경기라 강조하고, 3번은 접전 예상', '5번은 특별히 주목해 줘',
    '두 사람 호흡이 좋다고 소개해 주세요', '이 경기를 포스터에 크게 넣어줘', '오픈부 경력 언급해줘', '관전 포인트로 써 주세요',
    '접전이라고 적어줘', '호흡 좋은 듀오라고 부각했으면', '3경기는 꼭 챙겨봐 줘', '이 경기 강조 부탁해',
  ];
  const PUBLIC_OK = [
    '오픈부 경력의 두 선수가 만나는 경기입니다.', '많은 응원 부탁드립니다!', '두 사람의 호흡을 주목해 주세요.',
    '오늘 첫 맞대결, 응원해 주세요!', '접전이 예상되는 경기, 놓치지 마세요.', '구봉준·김영호 듀오의 첫 출전입니다.',
    '지난달 결승 리턴 매치', '1세트부터 치열할 듯', '팽팽한 승부가 기대됩니다', '주장님이 직접 뛰는 경기', '3연승에 도전하는 팀', '두 선수 모두 10년 구력',
  ];
  for (const t of INSTRUCTIONS) check(`지시문 경고: ${t}`, op.detectOperatorInstruction(t).length > 0, JSON.stringify(op.detectOperatorInstruction(t)));
  for (const t of PUBLIC_OK) check(`공개 문장 경고 없음: ${t}`, op.detectOperatorInstruction(t).length === 0, JSON.stringify(op.detectOperatorInstruction(t)));
  check('지시문 경고: 경기 번호 지칭(match_ref)', op.detectOperatorInstruction('2번 경기는 오픈부 경기니까 강조해 줘').includes('match_ref'));
  check('지시문 경고: 메모 원문과 같음(same_as_note)', op.detectOperatorInstruction('호흡 좋은 듀오', ' 호흡  좋은 듀오 ').includes('same_as_note'));
  check('지시문 경고: 빈 문구는 경고 없음', op.detectOperatorInstruction('   ', '메모').length === 0);
  check('경고 사유 문구 4종', ['same_as_note', 'request', 'meta', 'match_ref'].every((k) => typeof op.INSTRUCTION_WARNING_TEXT[k] === 'string'));

  // 연결 병합: 공개 문구는 빈 칸에서 시작 · 기존 문구 행 유지 · 빈 행만 대체
  const link = (matchNo: number | null, note: string) => ({ index: 0, note, status: matchNo ? 'linked' : 'none', matchNo, candidates: matchNo ? [matchNo] : [], mentioned: [], relation: null, inTop: false });
  let n = 0;
  const mk = (l: any) => ({ id: `n${++n}`, note: l.note, status: l.status, candidates: l.candidates, matchNo: l.matchNo });
  const fresh = op.mergeLinkedRows([], [link(2, '2번 경기는 오픈부 경기니까 강조해 줘'), link(null, '분위기 좋음')], mk);
  check('연결: 메모 원문이 공개 문구로 복사되지 않음', fresh.length === 2 && fresh.every((r: any) => r.text === ''), JSON.stringify(fresh));
  check('연결: 메모 · 경기는 연결됨', fresh[0].matchNo === 2 && fresh[0].note.includes('강조해 줘') && fresh[1].matchNo === null);
  check('연결: 빈 공개 문구 행은 공개 입력에 들어가지 않음(기존 toOperatorInput 규칙)',
    fresh.filter((r: any) => r.matchNo && r.text.trim()).length === 0);
  const prev = [
    { id: 'a', note: '', status: 'manual', candidates: [], matchNo: 2, text: '승인된 기존 문구' },
    { id: 'b', note: '옛 메모', status: 'linked', candidates: [3], matchNo: 3, text: '' },
    { id: 'c', note: '', status: 'manual', candidates: [], matchNo: 4, text: '직접 쓴 문구' },
  ];
  const merged = op.mergeLinkedRows(prev, [link(2, '2번 강조해 줘'), link(3, '3번 접전 예상'), link(5, '5번 주목')], mk);
  check('연결: 기존 승인 문구 행 유지(덮어쓰지 않음)', merged.find((r: any) => r.id === 'a')?.text === '승인된 기존 문구' && merged.find((r: any) => r.id === 'c')?.text === '직접 쓴 문구');
  check('연결: 같은 경기 메모는 기존 행 메모 칸에만 붙음(새 행 없음)', merged.filter((r: any) => r.matchNo === 2).length === 1 && merged.find((r: any) => r.id === 'a')?.note === '2번 강조해 줘');
  check('연결: 메모만 있던 빈 행은 새 연결로 대체', !merged.some((r: any) => r.id === 'b') && merged.filter((r: any) => r.matchNo === 3).length === 1 && merged.find((r: any) => r.matchNo === 3)?.text === '');
  check('연결: 새 경기 행 추가 · 문구 빈 칸', merged.find((r: any) => r.matchNo === 5)?.text === '' && merged.length === 4, JSON.stringify(merged));
  check('연결: 입력 배열 불변', prev[0].note === '' && prev.length === 3);
  const mergedAgain = op.mergeLinkedRows(merged, [link(2, '다른 메모')], mk);
  check('연결: 메모가 이미 있으면 덮어쓰지 않음', mergedAgain.find((r: any) => r.id === 'a')?.note === '2번 강조해 줘');

  // 서버 경로 호환: 지시문처럼 보여도 서버는 막지 않는다(기존 공개 문구 · 재공개 차단 없음)
  const parsed = op.parseOperatorInput({ points: [{ matchNo: 2, text: '2번 경기는 오픈부 경기니까 강조해 줘' }] });
  check('서버 호환: parseOperatorInput 은 지시문 문구도 형식만 검증(차단 없음)', parsed.ok === true && parsed.input.points[0].text.includes('강조해 줘'));
  const mini = { schema: 1, modelVersion: 'x', title: 't', date: '2026-11-11', disclaimer: 'd', items: [],
    matches: [{ matchNo: 2, round: 1, group: 'A', teamA: ['구봉준', '김영호'], teamB: ['김병식', '최지훈'], badge: null, prediction: { kind: 'insufficient' }, confidence: '데이터 부족', sampleRange: null, unanalyzedPlayers: 0 }] };
  const ap = op.applyOperatorInput(mini, { points: [{ matchNo: 2, text: '오픈부 경기라 강조해 줘' }], pick: null }, { eligible: [], usesRestricted: () => false, currentStatus: null });
  check('서버 호환: applyOperatorInput 도 지시문 경고와 무관하게 기존 규칙 그대로', ap.ok === true && ap.payload.matches[0].operatorPoint === '오픈부 경기라 강조해 줘');
}

console.log(`MATCH SPOTLIGHT operator/poster fixture: ${passed} passed / ${failures.length} failed`);
for (const f of failures) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
