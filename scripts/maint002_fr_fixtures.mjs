// MAINT-002 시험 공통 fixture — 실제 모델(buildFinalReportModel → buildFinalReportPayload · V41)로 판형별 발행본을 만든다.
//   운영 DB 미접속 · 가상 선수 이름만. verify_maint002_fr_member_ranking_sql.mjs 와 화면 QA 가짜 서버가 같이 쓴다.
//   실행 환경: node --experimental-strip-types (확장자 없는 TS import 는 ts-resolve-hook 이 해석)
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);
const fr = await import('../lib/kdk/finalReport/finalReportModel.ts');
const v41m = await import('../lib/kdk/finalReport/v41/payloadV41.ts');

export const U = (n) => `22222222-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const NAMES = ['김가람', '이나래', '박다온', '최라온', '정마루(G)', '한바다', '윤사랑', '오아라'];
const pid = (i) => (/\(G\)$/.test(NAMES[i]) ? `manual-guest-정마루` : U(i + 1));
// 8명 · 4라운드 · 2코트(1인 4경기)
const SCHED = [[1, 1, [0, 1, 2, 3]], [1, 2, [4, 5, 6, 7]], [2, 1, [0, 2, 4, 6]], [2, 2, [1, 3, 5, 7]],
  [3, 1, [0, 3, 5, 6]], [3, 2, [1, 2, 4, 7]], [4, 1, [0, 4, 1, 5]], [4, 2, [2, 6, 3, 7]]];
const SCORES = [[6, 5], [6, 3], [6, 2], [5, 6], [6, 4], [6, 0], [6, 5], [4, 6]];

export function sourceOf({ id, title, date, scores = SCORES }) {
  const snapshotData = SCHED.map(([round, court, idx], k) => ({ id: `${id}-m${k + 1}`, round, court, group_name: 'A', status: 'complete',
    player_ids: idx.map(pid), player_names: idx.map((i) => NAMES[i]), score1: scores[k][0], score2: scores[k][1] }));
  const rec = NAMES.map(() => ({ w: 0, l: 0, d: 0 }));
  SCHED.forEach(([, , idx], k) => idx.forEach((p, j) => {
    const mine = j < 2 ? scores[k][0] : scores[k][1]; const th = j < 2 ? scores[k][1] : scores[k][0];
    rec[p].w += mine > th ? 1 : 0; rec[p].l += mine < th ? 1 : 0; rec[p].d += mine - th;
  }));
  const order = NAMES.map((_, i) => i).sort((a, b) => rec[b].w - rec[a].w || rec[b].d - rec[a].d || a - b);
  const rankingData = order.map((i) => ({ id: pid(i), name: NAMES[i].replace(/\(G\)$/, ''), wins: rec[i].w, losses: rec[i].l, diff: rec[i].d }));
  return { id, archiveType: 'kdk', isOfficial: true, isTest: false, title, date, rankingData, snapshotData, playerGroups: {} };
}
/** Archive raw_data(운영 형태) — SQL 시험용. */
export const rawOf = (src) => ({ title: src.title, date: src.date, ranking_data: src.rankingData, snapshot_data: src.snapshotData });

const SAFE = {
  opening: '여덟 명이 네 라운드를 치른 11월 정모, 공식 결과를 정리했습니다.',
  closing: '함께해 주신 모든 분께 감사드립니다. 다음 정모 08:00 코트에서 만나요.',
};
function contentOf(model, extra = {}) {
  const top = model.standings.slice(0, 3);
  const c = { schema: 1, ...SAFE, stories: top.map((s) => ({ playerKey: s.key, rank: s.rank, text: `${s.wins}승 ${s.losses}패로 시상대에 올랐습니다.` })),
    featured: null, ...extra };
  const p = fr.parseFinalReportContent(c);
  if (!p.ok) throw new Error(`content ${p.reason} ${p.field}`);
  return p.content;
}
const modelOf = (src) => { const b = fr.buildFinalReportModel(src); if (!b.ok) throw new Error(`model ${b.reason}`); return b.model; };

/** v2 엔진 공개본에서 v2 필드를 빼 v1(edition 없음) 형태로 — 운영 rev1 과 같은 모양. */
export function payloadV1(src, extra) {
  const p = fr.buildFinalReportPayload(modelOf(src), contentOf(modelOf(src), extra));
  if (!p.ok) throw new Error(`payload ${p.reason}`);
  const { edition, headline, highlights, featuredMode, ...rest } = p.payload; // eslint-disable-line no-unused-vars
  return { ...rest, podium: rest.podium.map(({ record, ...x }) => x), featured: rest.featured.map(({ note, ...x }) => x) }; // eslint-disable-line no-unused-vars
}
export function payloadV2(src, extra) {
  const m = modelOf(src);
  const p = fr.buildFinalReportPayload(m, contentOf(m, extra));
  if (!p.ok) throw new Error(`payload ${p.reason}`);
  return p.payload;
}
/** V4.1(edition 3) — layout 2(V4.2) 가 기본. layout1=true 면 layout 을 지워 V4.1 8장 판형(운영 10-27 발행본과 같은 모양). */
export function payloadV41(src, extra, { layout1 = false } = {}) {
  const m = modelOf(src);
  const ctx = { date: src.date, history: [{ self: true, date: src.date, ranking: src.rankingData.map((r) => ({ id: r.id, wins: r.wins })),
    matches: src.snapshotData.map((x) => ({ ids: x.player_ids, score1: x.score1, score2: x.score2 })) }],
    next: { date: '2026-12-01', startTime: '08:00' }, nextReliable: true };
  const p = v41m.buildFinalReportPayloadV41(m, contentOf(m, { closingTitle: 'SEE YOU IN DECEMBER', ...extra }), ctx);
  if (!p.ok) throw new Error(`v41 ${p.reason}`);
  if (!layout1) return p.payload;
  const { layout, closingTitle, ...v } = p.payload.v41; // eslint-disable-line no-unused-vars
  return { ...p.payload, v41: { ...v, rivalry: v.rivalry ?? null } };
}
