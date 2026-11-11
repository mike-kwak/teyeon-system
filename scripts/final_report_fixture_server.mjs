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
const pid = (i) => (NAMES[i].endsWith('(G)') ? `manual-guest-${i}` : U(i + 1));

function source({ names = NAMES, groups = true, title = '11월 정모 KDK', date = '2026-11-11' } = {}) {
  const rec = [[7, 0, 22], [6, 1, 15], [5, 2, 9], [4, 3, 4], [4, 3, 2], [3, 4, -1], [3, 4, -3], [3, 4, -4], [2, 5, -8], [2, 5, -10], [1, 6, -12], [1, 6, -14]];
  const rankingData = names.map((n, i) => ({ id: pid(i), name: n, wins: rec[i][0], losses: rec[i][1], diff: rec[i][2] }));
  const pg = {}; names.forEach((_, i) => { if (groups) pg[pid(i)] = i % 2 ? 'B' : 'A'; });
  const M = (id, round, court, g, idx, s1, s2) => ({ id, round, court, group_name: groups ? g : '', status: 'complete',
    player_ids: idx.map(pid), player_names: idx.map((i) => names[i]), score1: s1, score2: s2 });
  const snapshotData = [
    M('m-01', 1, 1, 'A', [0, 2, 4, 6], 6, 5), M('m-02', 1, 2, 'B', [1, 3, 5, 7], 6, 0), M('m-03', 1, 3, 'A', [8, 10, 9, 11], 6, 3),
    M('m-04', 2, 1, 'A', [0, 4, 2, 8], 6, 2), M('m-05', 2, 2, 'B', [1, 5, 3, 9], 5, 6), M('m-06', 2, 3, 'A', [6, 10, 7, 11], 6, 4),
    M('m-07', 3, 1, 'A', [0, 6, 4, 10], 6, 1), M('m-08', 3, 2, 'B', [1, 7, 5, 11], 6, 3), M('m-09', 3, 3, 'A', [2, 8, 3, 9], 4, 6),
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
const LONG = [...NAMES]; LONG[0] = '가나다라마바사아자차카타파하가나다'; LONG[4] = '김수한무거북이와두루미삼천갑자(G)'; LONG[2] = 'Alexander Montgomery';

export const FIXTURES = {
  frqafullreport01: { body: { ok: true, state: 'ok', payload: payloadOf(source(), FULL), revision: 2, publishedAt: '2026-11-11T12:00:00Z', officialSessionId: 'KDK-20261111-QAFX' } },
  frqaminimal00001: { body: { ok: true, state: 'ok', payload: payloadOf(source(), { schema: 1 }), revision: 1, publishedAt: '2026-11-11T12:00:00Z', officialSessionId: 'KDK-20261111-QAFX' } },
  frqanofeatured01: { body: { ok: true, state: 'ok', payload: payloadOf(source({ groups: false }), { schema: 1, featured: [] }), revision: 1, publishedAt: null, officialSessionId: null } },
  frqalongnames001: { body: { ok: true, state: 'ok', payload: payloadOf(source({ names: LONG, title: '2026 TEYEON 가을 시즌 파이널 정기 KDK 리그 최종 라운드' }), (fp) => ({ ...FULL(fp), stories: [], opening: '', closing: '' })), revision: 1, publishedAt: null, officialSessionId: 'KDK-20261111-QAFX' } },
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
