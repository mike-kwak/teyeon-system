// MATCH SPOTLIGHT 공유 포스터 — 공개(published) payload 만으로 1080px 폭 PNG 를 native Canvas 로 그린다.
//
//   설계(2026-11-06 승인)
//     - 기존 KDK 결과 이미지 · 회비 공지 이미지와 같은 방식(native Canvas · 신규 의존성 없음).
//     - 폭 1080 고정, 높이 1350~2340 가변. 내용이 길면 문장 줄 수 · 여백을 먼저 줄이고, 그다음 글자 크기를 조금씩 낮춘다.
//     - 가독성(2026-11-06 개선): 390pt 전체화면 기준 본문 11pt(원본 31px) 이상 · 선수명이 가장 큰 요소 ·
//       공식 KDK 기록(칩) / 운영진 관전 포인트(금색 상자) 출처 구분 · 운영진 PICK 은 금색 테두리 카드 + 별 배지.
//     - 선수 이름은 자르지 않는다(줄바꿈 · 한 줄에 한 명). 분석 문구 · 운영진 관전 포인트만 1~2줄 + 말줄임(전문은 공개 페이지).
//     - 입력은 parsePublicSpotlightPayload 를 거친 allow-list DTO 뿐(숫자 확률 · 회원 id · 연락처 없음).
//   구조: layoutSpotlightPoster(순수 · 글자 폭 측정 함수 주입 → Node fixture 로 검증) + drawPoster(Canvas).

import type { PublicSpotlightItem, PublicSpotlightPayload } from './analytics/publicSpotlight';
import { OPERATOR_PICK_LABEL, OPERATOR_POINT_NOTICE, SPOTLIGHT_BADGE_LABEL } from './analytics/publicSpotlight';
import type { SpotlightType } from './analytics/spotlight';
import { downloadImageBlob } from './resultImage';

export const POSTER_W = 1080;
export const POSTER_MIN_H = 1350;
export const POSTER_MAX_H = 2340;
const PAD = 40;
const INNER = POSTER_W - PAD * 2;

const FONT_STACK = '"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "Pretendard", "Segoe UI", Arial, sans-serif';
export const posterFont = (weight: number, size: number): string => `${weight} ${Math.round(size)}px ${FONT_STACK}`;

const COLOR = {
  bgTop: '#0A1A33', bgMid: '#10294D', bgBottom: '#0A1830',
  gold: '#E9D8A6', goldStrong: '#F0C75E', white: '#FFFFFF',
  muted: 'rgba(255,255,255,0.86)', soft: 'rgba(255,255,255,0.72)', faint: 'rgba(255,255,255,0.6)',
  card: 'rgba(255,255,255,0.10)', cardBorder: 'rgba(233,216,166,0.38)',
  opBg: 'rgba(240,199,94,0.14)', navy: '#0F2747', chipLine: 'rgba(255,255,255,0.45)',
};
const BADGE_FILL: Record<SpotlightType, string> = {
  RIVAL: '#F87171', HOT_STREAK: '#FB923C', CLOSE: '#2DD4BF', POWER: '#7AA7FF',
};

export type Measure = (text: string, font: string) => number;

export type DrawOp =
  | { t: 'text'; x: number; y: number; text: string; font: string; color: string; align: 'left' | 'right' | 'center' }
  | { t: 'rrect'; x: number; y: number; w: number; h: number; r: number; fill: string; stroke?: string; sw?: number }
  | { t: 'circle'; x: number; y: number; r: number; fill: string; stroke?: string }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number };

export interface PosterLayout {
  width: number;
  /** 출력 이미지 높이(1350~2340). */
  height: number;
  /** 레이아웃상 내용 높이(축소 전). */
  contentHeight: number;
  /** 1 = 그대로. 1 미만 = 마지막 단계로도 넘쳐 전체를 이 비율로 축소해 그림(가운데 정렬 · 극단 입력에서만). */
  fitScale: number;
  /** 0 = 기본, 1~ = 압축 단계(줄 수 · 여백 · 글자 크기 축소). */
  level: number;
  /** 압축 단계로도 최대 높이를 넘어 전체 축소를 썼는가(극단적 입력). */
  overflow: boolean;
  ops: DrawOp[];
  /** 검증용: 카드별로 그린 선수 이름 줄(이름 누락 확인). */
  teamLines: string[][];
  /** 검증용: 말줄임이 들어간 문단 수. */
  ellipsized: number;
}

// ── 줄바꿈 ───────────────────────────────────────────────────────────────────
/** 폭에 맞춰 줄바꿈. 공백 단위 우선, 한 단어가 폭보다 길면 글자 단위. maxLines 초과 시 마지막 줄 말줄임. */
export function wrapLines(text: string, font: string, maxW: number, measure: Measure, maxLines: number | null):
  { lines: string[]; ellipsized: boolean } {
  const words = String(text || '').split(/(\s+)/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let cur = '';
  const push = () => { if (cur.trim()) lines.push(cur.trim()); cur = ''; };
  for (const w of words) {
    const next = cur + w;
    if (measure(next.trim(), font) <= maxW) { cur = next; continue; }
    if (cur.trim()) push();
    if (/^\s+$/.test(w)) continue;
    if (measure(w, font) <= maxW) { cur = w; continue; }
    for (const ch of [...w]) {           // 긴 단어(긴 이름 등) — 글자 단위
      if (measure(cur + ch, font) > maxW && cur) push();
      cur += ch;
    }
  }
  push();
  if (maxLines == null || lines.length <= maxLines) return { lines, ellipsized: false };
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 0 && measure(`${last}…`, font) > maxW) last = [...last].slice(0, -1).join('');
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return { lines: kept, ellipsized: true };
}

/** 한 줄에 들어가게 글자 크기를 낮춘다(최소 크기에서 멈춤). */
function fitSize(text: string, weight: number, size: number, min: number, maxW: number, measure: Measure): number {
  let s = size;
  while (s > min && measure(text, posterFont(weight, s)) > maxW) s -= 1;
  return s;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
/** 세션 날짜 'YYYY-MM-DD' → '2026.11.08 (일)'. 형식이 다르면 그대로. 요일은 날짜 자체로 계산(시간대 영향 없음). */
export function posterDateLabel(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!m) return d || '';
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${m[1]}.${m[2]}.${m[3]} (${WEEKDAY[wd]})`;
}
const metaText = (m: PublicSpotlightItem): string =>
  [`R${m.round}`, m.group ? `${m.group}조` : '', `${m.matchNo}경기`].filter(Boolean).join(' · ');

/**
 * 팀 선수명 배치 — 선수명은 자르지 않는다.
 *   1) "이름 · 이름" 한 줄(글자 크기 nameMax → nameMin 까지 낮춤)
 *   2) 안 되면 한 줄에 한 명(구분점 없이 — 줄 끝에 " · " 가 홀로 남지 않음), 그래도 길면 그 이름만 글자 단위 줄바꿈
 */
function teamBlock(names: readonly string[], colW: number, nameMax: number, nameMin: number, measure: Measure):
  { size: number; font: string; lines: string[] } {
  const list = names.filter(Boolean);
  if (list.length === 0) return { size: nameMax, font: posterFont(900, nameMax), lines: ['미정'] };
  const joined = list.join(' · ');
  const s1 = fitSize(joined, 900, nameMax, nameMin, colW, measure);
  const oneLine = measure(joined, posterFont(900, s1)) <= colW;
  const longest = list.reduce((a, b) => (measure(a, posterFont(900, nameMax)) >= measure(b, posterFont(900, nameMax)) ? a : b));
  const s2 = fitSize(longest, 900, nameMax, nameMin, colW, measure);
  // 한 줄이 충분히 크면(nameMax 의 85% 이상) 한 줄, 아니면 한 명씩 두 줄이 6px 이상 크게 보일 때 두 줄
  if (oneLine && (s1 >= Math.round(nameMax * 0.85) || list.length < 2 || s2 < s1 + 6)) {
    return { size: s1, font: posterFont(900, s1), lines: [joined] };
  }
  const f = posterFont(900, s2);
  return { size: s2, font: f, lines: list.flatMap((n) => wrapLines(n, f, colW, measure, null).lines) };
}

// 압축 단계 — 먼저 문장 줄 수 · 여백을 줄이고(글자 크기 유지), 그다음 글자를 조금씩 줄인다.
//   vp: 공식 분석 문장 줄 수 · op: 운영진 문구 줄 수 · k: 카드 글자 배율 · gap: 여백 배율 · hk: 헤더/하단 배율
interface Level { vp: number; op: number; k: number; gap: number; hk: number; nameMax: number; nameMin: number }
const LEVELS: Level[] = [
  { vp: 2, op: 2, k: 1, gap: 1, hk: 1, nameMax: 50, nameMin: 40 },
  { vp: 1, op: 2, k: 1, gap: 1, hk: 1, nameMax: 50, nameMin: 40 },
  { vp: 1, op: 2, k: 1, gap: 0.82, hk: 0.88, nameMax: 48, nameMin: 38 },
  { vp: 1, op: 1, k: 1, gap: 0.78, hk: 0.84, nameMax: 48, nameMin: 36 },
  { vp: 1, op: 1, k: 1, gap: 0.62, hk: 0.78, nameMax: 46, nameMin: 34 },
  { vp: 1, op: 1, k: 0.94, gap: 0.6, hk: 0.78, nameMax: 44, nameMin: 32 },
  { vp: 1, op: 1, k: 0.9, gap: 0.56, hk: 0.76, nameMax: 42, nameMin: 30 },
];

// ── 레이아웃(순수) ────────────────────────────────────────────────────────────
/**
 * 단계적으로 줄 수 · 여백 · 글자 크기를 줄여 1350~2340 에 맞춘다. 그래도 넘치면(극단 입력) 마지막 단계 레이아웃을
 * 전체 비율 축소(fitScale)해 2340 안에 그린다 — 선수명은 누락하지 않는다.
 */
export function layoutSpotlightPoster(payload: PublicSpotlightPayload, measure: Measure, opts: { linkLabel: string }): PosterLayout {
  let last: PosterLayout | null = null;
  for (let level = 0; level < LEVELS.length; level++) {
    const l = build(payload, measure, opts, LEVELS[level], level);
    if (l.contentHeight <= POSTER_MAX_H) return l;
    last = l;
  }
  const l = last as PosterLayout;
  return { ...l, height: POSTER_MAX_H, fitScale: POSTER_MAX_H / l.contentHeight, overflow: true };
}

function build(payload: PublicSpotlightPayload, measure: Measure, opts: { linkLabel: string }, L: Level, level: number): PosterLayout {
  const ops: DrawOp[] = [];
  const teamLines: string[][] = [];
  let ellipsized = 0;
  const { k, gap: g, hk } = L;
  const text = (x: number, y: number, s: string, font: string, color: string, align: 'left' | 'right' | 'center' = 'left') =>
    ops.push({ t: 'text', x, y, text: s, font, color, align });

  // ── 헤더: 브랜드 · 날짜(요일) / 제목 / TOP · 세션 ── (장식선 없음)
  let y = Math.round(52 * hk);
  text(PAD, y + 26, 'TEYEON  ·  KDK', posterFont(800, 28), COLOR.gold);
  if (payload.date) text(POSTER_W - PAD, y + 26, posterDateLabel(payload.date), posterFont(800, 28), COLOR.muted, 'right');
  y += Math.round(48 * hk);
  const titleSize = fitSize("TODAY'S SPOTLIGHT", 900, Math.round(96 * hk), 64, INNER, measure);
  text(PAD, y + titleSize * 0.86, "TODAY'S SPOTLIGHT", posterFont(900, titleSize), COLOR.white);
  y += Math.round(titleSize * 1.04);
  const count = payload.items.length;
  const subF = posterFont(800, 38);
  const sub = count > 0 ? `오늘의 주목 경기 TOP ${count}` : '오늘의 주목 경기';
  text(PAD, y + 38, sub, subF, COLOR.goldStrong);
  if (payload.title) {
    const tx = PAD + measure(sub, subF) + 18;
    const tf = posterFont(700, 32);
    const t = wrapLines(payload.title, tf, POSTER_W - PAD - tx, measure, 1);
    if (t.lines[0]) text(tx, y + 38, t.lines[0], tf, COLOR.soft);
  }
  y += Math.round(64 * hk);
  ops.push({ t: 'line', x1: PAD, y1: y, x2: POSTER_W - PAD, y2: y, color: 'rgba(233,216,166,0.45)', width: 3 });
  y += Math.round(28 * hk);

  // ── 경기 카드 ──
  const cpx = 30;                                  // 카드 좌우 안쪽 여백
  const cpy = Math.round(26 * g);                  // 카드 위아래 안쪽 여백
  const cw = INNER - cpx * 2;
  const left = PAD + cpx;
  const right = POSTER_W - PAD - cpx;
  const vsW = Math.round(92 * k);
  const colW = Math.floor((cw - vsW - 16) / 2);

  if (count === 0) {
    const f = posterFont(700, 36);
    const msg = wrapLines('오늘은 공식 기록상 특별히 주목할 경기가 선정되지 않았습니다. 전체 경기 분석은 공개 페이지에서 확인하세요.', f, cw, measure, null);
    const h = 40 * 2 + msg.lines.length * 52;
    ops.push({ t: 'rrect', x: PAD, y, w: INNER, h, r: 28, fill: COLOR.card, stroke: COLOR.cardBorder, sw: 2 });
    msg.lines.forEach((line, i) => text(POSTER_W / 2, y + 40 + 38 + i * 52, line, f, COLOR.muted, 'center'));
    y += h + 24;
  }

  payload.items.forEach((it, idx) => {
    const top = y;
    const cardOps: DrawOp[] = [];
    const ct = (x: number, yy: number, s: string, font: string, color: string, align: 'left' | 'right' | 'center' = 'left') =>
      cardOps.push({ t: 'text', x, y: yy, text: s, font, color, align });
    let cy = top + cpy;

    // 1행: 순위 · (운영진 PICK) · 경기 정보 ······ 유형 배지
    const rowH = Math.round(50 * k);
    const rankF = posterFont(900, Math.round(42 * k));
    const rank = String(idx + 1).padStart(2, '0');
    ct(left, cy + Math.round(40 * k), rank, rankF, COLOR.goldStrong);
    let lx = left + measure(rank, rankF) + 16;
    const pillF = posterFont(900, Math.round(28 * k));
    const pillH = rowH;
    // 유형 배지(오른쪽 · 색 채움)
    const bLabel = SPOTLIGHT_BADGE_LABEL[it.badge];
    const bW = measure(bLabel, pillF) + 34;
    cardOps.push({ t: 'rrect', x: right - bW, y: cy, w: bW, h: pillH, r: pillH / 2, fill: BADGE_FILL[it.badge] });
    ct(right - bW / 2, cy + pillH / 2 + Math.round(10 * k), bLabel, pillF, COLOR.navy, 'center');
    // 운영진 PICK(왼쪽 · 금색 테두리 + 별) — 유형 배지와 위치 · 모양 모두 다르게
    if (it.operatorPick) {
      const pLabel = `★ ${OPERATOR_PICK_LABEL}`;
      const pW = measure(pLabel, pillF) + 34;
      cardOps.push({ t: 'rrect', x: lx, y: cy, w: pW, h: pillH, r: 12, fill: 'rgba(240,199,94,0.18)', stroke: COLOR.goldStrong, sw: 3 });
      ct(lx + pW / 2, cy + pillH / 2 + Math.round(10 * k), pLabel, pillF, COLOR.goldStrong, 'center');
      lx += pW + 14;
    }
    const metaF = posterFont(700, Math.round(28 * k));
    const metaMax = right - bW - 14 - lx;
    const meta = wrapLines(metaText(it), metaF, Math.max(80, metaMax), measure, 1);
    ct(lx, cy + pillH / 2 + Math.round(10 * k), meta.lines[0] || '', metaF, COLOR.soft);
    cy += rowH + Math.round(18 * g);

    // 2행: 선수명 VS 선수명 — 포스터의 주인공(가장 크게)
    const ta = teamBlock(it.teamA, colW, Math.round(L.nameMax * k), Math.round(L.nameMin * k), measure);
    const tb = teamBlock(it.teamB, colW, Math.round(L.nameMax * k), Math.round(L.nameMin * k), measure);
    teamLines.push([...ta.lines, ...tb.lines]);
    const lh = (s: number) => Math.round(s * 1.22);
    const teamH = Math.max(ta.lines.length * lh(ta.size), tb.lines.length * lh(tb.size), vsW);
    const ya = cy + (teamH - ta.lines.length * lh(ta.size)) / 2;
    ta.lines.forEach((line, i) => ct(left, ya + (i + 1) * lh(ta.size) - ta.size * 0.24, line, ta.font, COLOR.white));
    const yb = cy + (teamH - tb.lines.length * lh(tb.size)) / 2;
    tb.lines.forEach((line, i) => ct(right, yb + (i + 1) * lh(tb.size) - tb.size * 0.24, line, tb.font, COLOR.white, 'right'));
    const vx = left + cw / 2;
    cardOps.push({ t: 'circle', x: vx, y: cy + teamH / 2, r: vsW / 2 - 4, fill: COLOR.goldStrong });
    ct(vx, cy + teamH / 2 + Math.round(12 * k), 'VS', posterFont(900, Math.round(34 * k)), COLOR.navy, 'center');
    cy += teamH + Math.round(20 * g);

    // 3행: 공식 KDK 기록 — 출처 칩 + 헤드라인(선수명보다 작게) / 핵심 분석 1~2줄
    const chipF = posterFont(800, Math.round(26 * k));
    const chip = '공식 KDK 기록';
    const chipW = measure(chip, chipF) + 26;
    const chipH = Math.round(40 * k);
    cardOps.push({ t: 'rrect', x: left, y: cy + 2, w: chipW, h: chipH, r: 10, fill: 'rgba(255,255,255,0.08)', stroke: COLOR.chipLine, sw: 2 });
    ct(left + chipW / 2, cy + 2 + chipH / 2 + Math.round(9 * k), chip, chipF, COLOR.muted, 'center');
    // 헤드라인은 항상 선수명보다 작게(타이포 우선순위: 선수명 > 헤드라인)
    const hF = posterFont(800, Math.max(24, Math.min(Math.round(34 * k), Math.min(ta.size, tb.size) - 4)));
    const head = wrapLines(it.headline, hF, cw - chipW - 16, measure, 1);
    ct(left + chipW + 16, cy + 2 + chipH / 2 + Math.round(12 * k), head.lines[0] || '', hF, COLOR.gold);
    cy += chipH + Math.round(12 * g);
    const vF = posterFont(600, Math.round(31 * k));
    const vp = wrapLines(it.viewpoint, vF, cw, measure, L.vp);
    if (vp.ellipsized) ellipsized++;
    vp.lines.forEach((line) => { ct(left, cy + Math.round(31 * k), line, vF, COLOR.muted); cy += Math.round(43 * k); });

    // 4행: 운영진 관전 포인트 — 금색 상자 · 왼쪽 띠 · 라벨로 공식 기록과 구분
    if (it.operatorPoint) {
      cy += Math.round(12 * g);
      const oF = posterFont(700, Math.round(31 * k));
      const op = wrapLines(it.operatorPoint, oF, cw - 52, measure, L.op);
      if (op.ellipsized) ellipsized++;
      const padY = Math.round(14 * g);
      const labelH = Math.round(36 * k);
      const boxH = padY + labelH + op.lines.length * Math.round(43 * k) + padY;
      cardOps.push({ t: 'rrect', x: left, y: cy, w: cw, h: boxH, r: 16, fill: COLOR.opBg });
      cardOps.push({ t: 'rrect', x: left, y: cy, w: 8, h: boxH, r: 4, fill: COLOR.goldStrong });
      ct(left + 30, cy + padY + Math.round(27 * k), '운영진 관전 포인트', posterFont(800, Math.round(26 * k)), COLOR.goldStrong);
      op.lines.forEach((line, i) => ct(left + 30, cy + padY + labelH + (i + 1) * Math.round(43 * k) - Math.round(10 * k), line, oF, COLOR.white));
      cy += boxH;
    }
    cy += cpy;
    ops.push({ t: 'rrect', x: PAD, y: top, w: INNER, h: cy - top, r: 26, fill: COLOR.card,
      stroke: it.operatorPick ? COLOR.goldStrong : COLOR.cardBorder, sw: it.operatorPick ? 4 : 2 });
    ops.push(...cardOps);
    y = cy + Math.round(18 * g);
  });

  // ── 하단(안내 · 링크 · 출처 · 면책) ──
  const foot: Array<{ s: string; f: string; c: string }> = [];
  foot.push({ s: '전체 경기 분석 · 공식 기록 원문은 공개 페이지에서', f: posterFont(700, 27), c: COLOR.muted });
  if (opts.linkLabel) foot.push({ s: opts.linkLabel, f: posterFont(700, 26), c: COLOR.goldStrong });
  const notes = [payload.disclaimer];
  if (payload.items.some((i) => i.operatorPoint)) notes.push(OPERATOR_POINT_NOTICE);
  const footLines: Array<{ s: string; f: string; c: string }> = [];
  for (const fl of foot) for (const line of wrapLines(fl.s, fl.f, INNER, measure, 2).lines) footLines.push({ s: line, f: fl.f, c: fl.c });
  for (const n of notes) for (const line of wrapLines(n, posterFont(600, 24), INNER, measure, 3).lines) footLines.push({ s: line, f: posterFont(600, 24), c: COLOR.faint });
  const lh = Math.round(36 * Math.max(hk, 0.84));
  const footH = 22 + footLines.length * lh + Math.round(44 * hk);
  const contentEnd = y + 6;
  const contentHeight = Math.round(Math.max(POSTER_MIN_H, contentEnd + footH));
  let fy = contentHeight - footH + 22;
  ops.push({ t: 'line', x1: PAD, y1: fy - 16, x2: POSTER_W - PAD, y2: fy - 16, color: 'rgba(255,255,255,0.18)', width: 2 });
  for (const fl of footLines) { fy += lh; text(POSTER_W / 2, fy - 8, fl.s, fl.f, fl.c, 'center'); }

  return { width: POSTER_W, height: contentHeight, contentHeight, fitScale: 1, level, overflow: false, ops, teamLines, ellipsized };
}

// ── Canvas 그리기(브라우저) ───────────────────────────────────────────────────
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawPoster(ctx: CanvasRenderingContext2D, layout: PosterLayout): void {
  const { width: W, height: H } = layout;
  const g = ctx.createLinearGradient(0, 0, W * 0.35, H);
  g.addColorStop(0, COLOR.bgTop); g.addColorStop(0.55, COLOR.bgMid); g.addColorStop(1, COLOR.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 코트 라인 모티프(은은하게)
  ctx.save();
  ctx.strokeStyle = 'rgba(233,216,166,0.06)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(-80, H + 40, 360, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  ctx.textBaseline = 'alphabetic';
  ctx.save();
  if (layout.fitScale < 1) {   // 극단 입력: 내용 전체를 비율 축소(가운데) — 자르지 않는다
    ctx.translate((W - W * layout.fitScale) / 2, 0);
    ctx.scale(layout.fitScale, layout.fitScale);
  }
  for (const op of layout.ops) {
    if (op.t === 'rrect') {
      roundRectPath(ctx, op.x, op.y, op.w, op.h, op.r);
      ctx.fillStyle = op.fill; ctx.fill();
      if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.sw ?? 2; ctx.stroke(); }
    } else if (op.t === 'circle') {
      ctx.beginPath(); ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
      ctx.fillStyle = op.fill; ctx.fill();
      if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = 3; ctx.stroke(); }
    } else if (op.t === 'line') {
      ctx.beginPath(); ctx.moveTo(op.x1, op.y1); ctx.lineTo(op.x2, op.y2);
      ctx.strokeStyle = op.color; ctx.lineWidth = op.width; ctx.stroke();
    } else {
      ctx.font = op.font; ctx.fillStyle = op.color; ctx.textAlign = op.align;
      ctx.fillText(op.text, op.x, op.y);
    }
  }
  ctx.restore();
}

/** 공개 payload → 포스터 PNG. 브라우저 전용('use client' 컴포넌트에서 호출). */
export async function renderSpotlightPosterBlob(payload: PublicSpotlightPayload, opts: { linkLabel: string }):
  Promise<{ blob: Blob; layout: PosterLayout }> {
  try { await (document as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* 글꼴 대기 실패는 무시 */ }
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('Canvas is not supported.');
  const measure: Measure = (s, font) => { probe.font = font; return probe.measureText(s).width; };
  const layout = layoutSpotlightPoster(payload, measure, opts);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported.');
  drawPoster(ctx, layout);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to create spotlight poster.'))), 'image/png'));
  return { blob, layout };
}

export type PosterShareResult = 'shared' | 'cancelled' | 'unsupported';

/** 모바일 이미지 공유(Web Share · 파일). 미지원이면 'unsupported' → 화면이 저장 · 링크 복사로 안내. */
export async function sharePosterImage(blob: Blob, fileName: string, opts: { title: string; text: string }): Promise<PosterShareResult> {
  const file = new File([blob], fileName, { type: 'image/png' });
  const data = { files: [file], title: opts.title, text: opts.text } as ShareData & { files: File[] };
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as
    (Navigator & { canShare?: (d?: ShareData & { files?: File[] }) => boolean }) | undefined;
  if (!nav || typeof nav.share !== 'function' || (nav.canShare && !nav.canShare(data))) return 'unsupported';
  try {
    await nav.share(data);
    return 'shared';
  } catch (e: unknown) {
    return (e as { name?: string })?.name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}

export function savePosterImage(blob: Blob, fileName: string): void {
  downloadImageBlob(blob, fileName);
}

export function posterFileName(date: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.replace(/-/g, '') : 'today';
  return `TEYEON_SPOTLIGHT_${d}.png`;
}
