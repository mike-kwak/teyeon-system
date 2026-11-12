// TEYEON KDK FINAL REPORT — 로컬 화면 QA 용 가짜 공개 RPC 서버(운영 DB 미접속 · 가상 선수 이름).
//   실제 P1 모델(buildFinalReportModel → buildFinalReportPayload)로 공개본을 만들어 get_public_kdk_final_report 응답을 흉내 낸다.
//
//   실행:  node --experimental-strip-types scripts/final_report_fixture_server.mjs [port=54399]
//   앱:    NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 NEXT_PUBLIC_SUPABASE_ANON_KEY=qa-fake-anon-key next build && next start
//   열기:  /club/report/<slug>  (slug 목록은 아래 FIXTURES · 실행 시 출력)
import http from 'node:http';
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);
const fr = await import('../lib/kdk/finalReport/finalReportModel.ts');

const PORT = Number(process.argv[2] || 54399);
const U = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NAMES = ['구봉준', '박광현', '정다은', '김영호', '홍길동(G)', '이상윤', '남인우', '최지훈', '오세훈', '한지민', '윤서준', '강민호'];
const pid = (i) => (i === 4 || i === 20 ? `manual-guest-${i}` : U(i + 1));

// 운영 Archive 형태(2026-11 점검): A/B 로 나뉜 날은 선수마다 한 조에서만 경기(짝수 번째 A · 홀수 번째 B),
//   조 구분 없는 날(groups: false)은 경기 group_name 이 전부 기본값 'A' 이고 순위표 group 은 일부만 'A'.
function source({ names = NAMES, groups = true, title = '11월 정모 KDK', date = '2026-11-11' } = {}) {
  const base = [[7, 0, 22], [6, 1, 15], [5, 2, 9], [4, 3, 4], [4, 3, 2], [3, 4, -1], [3, 4, -3], [3, 4, -4], [2, 5, -8], [2, 5, -10], [1, 6, -12], [1, 6, -14]];
  const rec = names.map((_, i) => base[i] || [Math.max(0, 4 - Math.floor(i / 7)), Math.min(4, Math.floor(i / 7)), 6 - i]);
  const rankingData = names.map((n, i) => ({ id: pid(i), name: n.replace(/\(G\)$/, ''), wins: rec[i][0], losses: rec[i][1], diff: rec[i][2], ...(!groups && i % 5 === 0 ? { group: 'A' } : {}) }));
  const pg = {}; names.forEach((_, i) => { if (groups) pg[pid(i)] = i % 2 ? 'B' : 'A'; });
  const M = (id, round, court, g, idx, s1, s2) => ({ id, round, court, group_name: groups ? g : 'A', status: 'complete',
    player_ids: idx.map(pid), player_names: idx.map((i) => names[i]), score1: s1, score2: s2 });
  const snapshotData = [
    M('m-01', 1, 1, 'A', [0, 2, 4, 6], 6, 5), M('m-02', 1, 2, 'B', [1, 3, 5, 7], 6, 0), M('m-03', 1, 3, 'A', [8, 10, 2, 4], 6, 3),
    M('m-04', 2, 1, 'A', [0, 4, 2, 8], 6, 2), M('m-05', 2, 2, 'B', [1, 5, 3, 9], 5, 6), M('m-06', 2, 3, 'B', [7, 11, 9, 3], 6, 4),
    M('m-07', 3, 1, 'A', [0, 6, 4, 10], 6, 1), M('m-08', 3, 2, 'B', [1, 7, 5, 11], 6, 3), M('m-09', 3, 3, 'A', [2, 8, 6, 10], 4, 6),
  ];
  return { id: 'KDK-20261111-QAFX', archiveType: 'kdk', isOfficial: true, isTest: false, title, date, rankingData, snapshotData, playerGroups: pg };
}
function payloadOf(src, content) {
  const b = fr.buildFinalReportModel(src);
  if (!b.ok) throw new Error(`model ${b.reason}`);
  const fp = (id) => fr.matchFingerprint(b.model.matches.find((m) => m.matchId === id));
  const c = typeof content === 'function' ? content(fp) : content;
  const parsed = fr.parseFinalReportContent(c);
  if (!parsed.ok) throw new Error(`content ${parsed.reason} ${parsed.field}`);
  const p = fr.buildFinalReportPayload(b.model, parsed.content);
  if (!p.ok) throw new Error(`payload ${p.reason} ${JSON.stringify(p.issues || p.reconciled)}`);
  return p.payload;
}

const FULL = (fp) => ({
  schema: 1,
  opening: '열두 명이 세 라운드를 치른 11월 정모, 공식 결과를 정리했습니다.',
  closing: '함께해 주신 모든 분께 감사드립니다. 다음 정모에서 만나요.',
  stories: [
    { playerKey: U(1), rank: 1, text: '7전 전승, 득실 +22로 정상에 올랐습니다.' },
    { playerKey: U(2), rank: 2, text: '6승 1패로 끝까지 우승 경쟁을 이어 갔습니다.' },
    { playerKey: U(3), rank: 3, text: '5승 2패, 3위로 시상대에 올랐습니다.' },
  ],
  featured: [
    { matchId: 'm-01', fingerprint: fp('m-01'), review: '6:5, 이날 가장 적은 점수 차로 끝난 경기입니다.', tag: 'MATCH_OF_THE_DAY' },
    { matchId: 'm-05', fingerprint: fp('m-05'), review: '2라운드 B조, 5:6 한 점 차 승부였습니다.', tag: 'OPERATORS_PICK' },
    { matchId: 'm-02', fingerprint: fp('m-02'), review: '', tag: null },
    { matchId: 'm-09', fingerprint: fp('m-09'), review: '3라운드 마지막 코트 경기입니다.', tag: null },
  ],
});
const MANY = Array.from({ length: 27 }, (_, i) => (i < NAMES.length ? NAMES[i] : i === 20 ? '최종손님(G)' : `회원${String(i + 1).padStart(2, '0')}`));
const LONG = [...NAMES]; LONG[0] = '가나다라마바사아자차카타파하가나다'; LONG[4] = '김수한무거북이와두루미삼천갑자(G)'; LONG[2] = 'Alexander Montgomery';

// v1 공개본(기존 발행본 형태) — v2 엔진이 붙인 필드를 떼어 낸다. 운영 발행본(2026-11-10 1판)과 같은 모양.
function legacy(p) {
  const { edition, headline, highlights, featuredMode, ...rest } = p; // eslint-disable-line no-unused-vars
  return {
    ...rest,
    podium: rest.podium.map(({ record, ...x }) => x), // eslint-disable-line no-unused-vars
    featured: rest.featured.map(({ note, ...x }) => x), // eslint-disable-line no-unused-vars
  };
}

// ── v2(edition 2) 화면 QA 용: 8명 · 4라운드 · 1인 4경기(라운드마다 전원 1경기) — 공식 승패와 경기 기록이 일치하는 세션 ──
const SCHED = [
  [1, 1, [0, 1, 2, 3]], [1, 2, [4, 5, 6, 7]], [2, 1, [0, 2, 4, 6]], [2, 2, [1, 3, 5, 7]],
  [3, 1, [0, 5, 1, 4]], [3, 2, [2, 7, 3, 6]], [4, 1, [0, 7, 2, 5]], [4, 2, [1, 6, 3, 4]],
];
const N8 = ['구봉준', '박광현', '정다은', '김영호', '홍길동(G)', '이상윤', '남인우', '최지훈'];
const pid8 = (i, names) => (/\(G\)$/.test(names[i]) ? `manual-guest-${i}` : U(i + 1));
function sourceV2({ names = N8, scores, title = '11월 정모 KDK', date = '2026-11-11', groups = false } = {}) {
  const snapshotData = SCHED.map(([round, court, idx], k) => ({
    id: `v2-${k + 1}`, round, court, group_name: groups ? (k % 2 ? 'B' : 'A') : 'A', status: 'complete',
    player_ids: idx.map((i) => pid8(i, names)), player_names: idx.map((i) => names[i]), score1: scores[k][0], score2: scores[k][1],
  }));
  const rec = names.map(() => ({ w: 0, l: 0, d: 0 }));
  SCHED.forEach(([, , idx], k) => idx.forEach((p, j) => {
    const mine = j < 2 ? scores[k][0] : scores[k][1]; const th = j < 2 ? scores[k][1] : scores[k][0];
    if (mine > th) rec[p].w += 1; else if (mine < th) rec[p].l += 1; rec[p].d += mine - th;
  }));
  const order = names.map((_, i) => i).sort((a, b) => rec[b].w - rec[a].w || rec[b].d - rec[a].d || a - b);
  const rankingData = order.map((i) => ({ id: pid8(i, names), name: names[i].replace(/\(G\)$/, ''), wins: rec[i].w, losses: rec[i].l, diff: rec[i].d }));
  return { id: 'KDK-20261111-QAV2', archiveType: 'kdk', isOfficial: true, isTest: false, title, date, rankingData, snapshotData, playerGroups: {} };
}
function payloadV2(src, contentOf) {
  const b = fr.buildFinalReportModel(src);
  if (!b.ok) throw new Error(`model ${b.reason}`);
  const m = b.model;
  const parsed = fr.parseFinalReportContent(contentOf ? contentOf(m) : { schema: 1 });
  if (!parsed.ok) throw new Error(`content ${parsed.reason} ${parsed.field}`);
  const p = fr.buildFinalReportPayload(m, parsed.content);
  if (!p.ok) throw new Error(`payload ${p.reason} ${JSON.stringify(p.issues || p.reconciled)}`);
  return p.payload;
}
// 1번(구봉준) 4전 전승 · 1점 차 3경기 · 완봉 1경기.
const SC_MAIN = [[6, 5], [6, 3], [6, 2], [5, 6], [6, 4], [6, 0], [6, 5], [4, 6]];
// 게스트(홍길동(G), 5번째)가 4전 전승.
const SC_GUEST = [[6, 4], [6, 5], [3, 6], [6, 2], [2, 6], [6, 3], [6, 5], [4, 6]];
const fpOf = (m, id) => fr.matchFingerprint(m.matches.find((x) => x.matchId === id));
const V2_FULL = (m) => ({
  schema: 1,
  opening: '여덟 명이 네 라운드를 치른 11월 정모, 공식 결과를 정리했습니다.',
  closing: '함께해 주신 모든 분께 감사드립니다. 다음 정모에서 만나요.',
  stories: m.standings.slice(0, 3).map((s) => ({ playerKey: s.key, rank: s.rank, text: s.rank === 1 ? '4전 전승으로 정상에 올랐습니다.' : `${s.wins}승 ${s.losses}패로 시상대에 올랐습니다.` })),
  featured: [
    { matchId: 'v2-6', fingerprint: fpOf(m, 'v2-6'), review: '6:0, 이날 유일한 완봉 경기입니다.', tag: null },
    { matchId: 'v2-1', fingerprint: fpOf(m, 'v2-1'), review: '1라운드 첫 경기, 6:5 한 점 차로 끝났습니다.', tag: 'MATCH_OF_THE_DAY' },
    { matchId: 'v2-7', fingerprint: fpOf(m, 'v2-7'), review: '', tag: 'OPERATORS_PICK' },
  ],
});
const LONG8 = ['가나다라마바사아자차카타파하가나다', '박광현', 'Alexander Montgomery', '김영호', '김수한무거북이와두루미삼천갑자(G)', '이상윤', '남인우', '최지훈'];

export const FIXTURES = {
  // v1 공개본(기존 발행본 형태) — 기존 화면 그대로 보여야 한다(소급 표시 없음).
  frqafullreport01: { body: { ok: true, state: 'ok', payload: legacy(payloadOf(source(), FULL)), revision: 2, publishedAt: '2026-11-11T12:00:00Z', officialSessionId: 'KDK-20261111-QAFX' } },
  frqaminimal00001: { body: { ok: true, state: 'ok', payload: legacy(payloadOf(source(), { schema: 1 })), revision: 1, publishedAt: '2026-11-11T12:00:00Z', officialSessionId: 'KDK-20261111-QAFX' } },
  frqanofeatured01: { body: { ok: true, state: 'ok', payload: legacy(payloadOf(source({ groups: false }), { schema: 1, featured: [] })), revision: 1, publishedAt: null, officialSessionId: null } },
  frqalongnames001: { body: { ok: true, state: 'ok', payload: legacy(payloadOf(source({ names: LONG, title: '2026 TEYEON 가을 시즌 파이널 정기 KDK 리그 최종 라운드' }), (fp) => ({ ...FULL(fp), stories: [], opening: '', closing: '' }))), revision: 1, publishedAt: null, officialSessionId: 'KDK-20261111-QAFX' } },
  frqa27players01: { body: { ok: true, state: 'ok', payload: legacy(payloadOf(source({ names: MANY, groups: false, title: '11월 정모 KDK · 27명' }), { schema: 1 })), revision: 3, publishedAt: null, officialSessionId: 'KDK-20261111-QAFX' } },
  // v2 공개본(edition 2)
  frqav2full00001: { body: { ok: true, state: 'ok', payload: payloadV2(sourceV2({ scores: SC_MAIN }), V2_FULL), revision: 2, publishedAt: '2026-11-12T12:00:00Z', officialSessionId: 'KDK-20261111-QAV2' } },
  frqav2auto00001: { body: { ok: true, state: 'ok', payload: payloadV2(sourceV2({ scores: SC_MAIN })), revision: 1, publishedAt: null, officialSessionId: 'KDK-20261111-QAV2' } },
  frqav2guestlong1: { body: { ok: true, state: 'ok', payload: payloadV2(sourceV2({ names: LONG8, scores: SC_GUEST, title: '2026 TEYEON 가을 시즌 파이널 정기 KDK 리그 최종 라운드' })), revision: 1, publishedAt: null, officialSessionId: 'KDK-20261111-QAV2' } },
  frqav2manual0001: { body: { ok: true, state: 'ok', payload: payloadV2(sourceV2({ scores: SC_MAIN, groups: true }), (m) => ({ schema: 1, headline: '11월의 주인공, 네 경기 모두 이긴 구봉준',
    featured: ['v2-3', 'v2-5'].map((id) => ({ matchId: id, fingerprint: fpOf(m, id), review: '', tag: null })) })), revision: 1, publishedAt: null, officialSessionId: 'KDK-20261111-QAV2' } },
  frqav2many00001: { body: { ok: true, state: 'ok', payload: payloadOf(source({ names: MANY, groups: false, title: '11월 정모 KDK · 27명' }), { schema: 1 }), revision: 1, publishedAt: null, officialSessionId: 'KDK-20261111-QAFX' } },
  frqav2nofeat0001: { body: { ok: true, state: 'ok', payload: payloadV2(sourceV2({ scores: SC_MAIN }), () => ({ schema: 1, featured: [] })), revision: 1, publishedAt: null, officialSessionId: null } },
  frqacorrected001: { body: { ok: true, state: 'corrected', title: '11월 정모 KDK', date: '2026-11-11', officialSessionId: 'KDK-20261111-QAFX' } },
  frqaunavailable1: { status: 500, body: { message: 'fixture: unavailable' } },
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); };
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__fixtures') return send(200, FIXTURES);
    if (req.method === 'POST' && u.pathname === '/rest/v1/rpc/get_public_kdk_final_report') {
      let slug = ''; try { slug = JSON.parse(body || '{}').p_slug || ''; } catch {}
      const f = FIXTURES[slug];
      if (!f) return send(200, { ok: false, state: 'not_found' });
      return send(f.status || 200, f.body);
    }
    return send(404, { message: 'fixture: not handled' });
  });
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`FINAL REPORT fixture RPC on http://127.0.0.1:${PORT}`);
  for (const k of Object.keys(FIXTURES)) console.log(`  /club/report/${k}`);
});
