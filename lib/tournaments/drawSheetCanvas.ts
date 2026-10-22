// 전체 조편성표(가로형 공식 표) — canvas 로 그린다(브라우저 전용 · 서버 호출 없음 · 외부 라이브러리 없음).
//
//   ⚠ 화면에 보이는 표와 저장되는 이미지는 이 함수 하나가 그린 같은 그림이다(두 번 그리지 않는다).
//   ⚠ 입력은 모바일 대진표와 같은 entries(officialDrawModel.buildEntries) — 조 · 선수 · 소속 · 코트 · 차수 · 신고가 어긋날 수 없다.
//   ⚠ 순서는 호출자가 정한다(공식 조편성표 = 공개 조 번호 순 1조 → 18조). 조 이름은 entry.label(공개 표시 번호) — 내부 group_no 는 그리지 않는다.
//     코트 · 차수 · 신고는 저장된 값 그대로.
//   ⚠ 글자가 칸을 넘으면 자르지 않는다 — 소속을 다음 줄로 내리고, 그래도 길면 글자를 줄이고(최소 12px), 그래도 길면 여러 줄로 나눈다.
//   가독성: 논리 폭을 1280px 로 줄이고(휴대폰 · 공유 이미지에서 글자가 커지도록) 선수 이름을 가장 크게 · 진하게, 소속은 작고 연하게.

import type { DrawEntry, SessionHeader } from './officialDrawModel';

export interface SheetMeta {
  title: string;
  subtitle: string | null;
  checkinPlace: string | null;
  sessions: SessionHeader[];
  /** 바닥 줄 — 생성 시각 문구(호출자가 만든다). */
  generatedAt: string;
  /** 바닥 줄 — 실시간 확인 주소(코드 상수에서). */
  liveUrl: string | null;
}

/** 표 행의 위치(논리 px) — 화면에서 '조 이동' 할 때 쓴다. */
export interface SheetRowBox { key: string; label: string; y: number; h: number }

export const SHEET_WIDTH = 1280;          // 논리 폭(px) — 저장 이미지는 scale 배
const W = SHEET_WIDTH;
const PAD = 28;
const COL = { group: 92, court: 64, session: 58, checkin: 76 };
const TEAM_SLOTS = 3;
const NAME = 23;                          // 선수 이름 글자 크기
const CLUB = 15;                          // 소속 기본 글자 크기
const LINE_H = 29;                        // 이름 한 줄 높이
const CLUB_H = 21;                        // 소속이 다음 줄로 내려갈 때 그 줄 높이
const C = {
  ink: '#0B1220', soft: '#334155', muted: '#6B7A90', rowLine: '#94A3B8', colLine: '#D5DCE5', head: '#102A3D',
  s1: '#0E8C80', s1bg: '#EDF6F4', s2: '#A86A12', s2bg: '#FBF3E4', empty: '#F4F6F9',
};

/** roundRect 미지원 브라우저(구형 iOS) — 직사각형으로 대신. */
const rrect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
};
const sessionText = (n: 1 | 2 | null) => (n === 1 ? '1차' : n === 2 ? '2차' : '-');

/** 긴 소속을 폭에 맞게 여러 줄로(글자 단위 — 한글 · 영문 모두). */
function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = []; let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > width && cur) { out.push(cur); cur = ch.trimStart(); } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

interface PlayerLayout { name: string; nameSize: number; club: string | null; clubSize: number; clubLines: string[]; inline: boolean; h: number }

/** 한 선수 — 이름(굵게) 옆에 소속(작게). 폭을 넘으면 소속을 아래 줄로, 그래도 길면 글자 축소 → 여러 줄. */
function layoutPlayer(ctx: CanvasRenderingContext2D, font: string, name: string, club: string | null, width: number): PlayerLayout {
  let nameSize = NAME;
  for (; nameSize > 16; nameSize -= 1) { ctx.font = `800 ${nameSize}px ${font}`; if (ctx.measureText(name).width <= width) break; }
  ctx.font = `800 ${nameSize}px ${font}`;
  const nw = ctx.measureText(name).width;
  if (!club) return { name, nameSize, club: null, clubSize: CLUB, clubLines: [], inline: true, h: LINE_H };
  for (const size of [CLUB, 14, 13]) {
    ctx.font = `600 ${size}px ${font}`;
    if (nw + 9 + ctx.measureText(club).width <= width) return { name, nameSize, club, clubSize: size, clubLines: [club], inline: true, h: LINE_H };
  }
  for (const size of [CLUB, 14, 13, 12]) {
    ctx.font = `600 ${size}px ${font}`;
    if (ctx.measureText(club).width <= width) return { name, nameSize, club, clubSize: size, clubLines: [club], inline: false, h: LINE_H + CLUB_H };
  }
  ctx.font = `600 12px ${font}`;
  const lines = wrapText(ctx, club, width);
  return { name, nameSize, club, clubSize: 12, clubLines: lines, inline: false, h: LINE_H + CLUB_H * lines.length };
}

function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, min: number, width: number, font: string): number {
  let s = size;
  for (; s > min; s -= 1) { ctx.font = `${weight} ${s}px ${font}`; if (ctx.measureText(text).width <= width) break; }
  ctx.font = `${weight} ${s}px ${font}`;
  return s;
}

const centerText = (ctx: CanvasRenderingContext2D, text: string, x: number, w: number, y: number) => {
  ctx.fillText(text, x + (w - ctx.measureText(text).width) / 2, y);
};

/** 표 전체 높이를 먼저 계산하고 그린다. scale = 저장 해상도 배수. */
export function renderDrawSheet(entries: DrawEntry[], meta: SheetMeta, scale = 2, fontFamily = 'sans-serif'): { canvas: HTMLCanvasElement; rows: SheetRowBox[]; width: number; height: number } {
  const font = fontFamily;
  const probe = document.createElement('canvas').getContext('2d')!;
  const fixedW = COL.group + COL.court + COL.session + COL.checkin;
  const teamW = (W - PAD * 2 - fixedW) / TEAM_SLOTS;
  const cellPadX = 12; const cellPadY = 10;
  const inner = teamW - cellPadX * 2;
  const rows = entries.map((e) => {
    const cells = Array.from({ length: TEAM_SLOTS }, (_, i) => {
      const t = e.teams[i];
      if (!t) return null;
      const p1 = layoutPlayer(probe, font, t.player1Name, t.club1, inner);
      const p2 = layoutPlayer(probe, font, t.player2Name, t.club2, inner);
      return { p1, p2, h: p1.h + p2.h };
    });
    const content = Math.max(LINE_H * 2, ...cells.map((c) => (c ? c.h : 0)));
    return { e, cells, h: content + cellPadY * 2 };
  });
  const headerH = 156; const tableHeadH = 42; const footH = 70;
  const tableTop = PAD + headerH;
  const H = tableTop + tableHeadH + rows.reduce((a, r) => a + r.h, 0) + footH + PAD;

  const cv = document.createElement('canvas');
  cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
  const ctx = cv.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);

  // ── 머리: 제목 · 일시 · 신고 장소 / 1차 · 2차 상자 ──
  const y0 = PAD;
  ctx.fillStyle = C.head; ctx.fillRect(0, 0, W, 8);
  ctx.fillStyle = C.ink; fitText(ctx, meta.title, 900, 34, 24, W - PAD * 2 - 600, font); ctx.fillText(meta.title, PAD, y0 + 38);
  if (meta.subtitle) { ctx.fillStyle = C.muted; ctx.font = `700 18px ${font}`; ctx.fillText(meta.subtitle, PAD, y0 + 70); }
  if (meta.checkinPlace) { ctx.fillStyle = C.soft; ctx.font = `700 17px ${font}`; ctx.fillText(`출전 신고 장소 · ${meta.checkinPlace}`, PAD, y0 + 100); }
  ctx.fillStyle = C.muted; ctx.font = `600 14px ${font}`;
  ctx.fillText('08:40 · 09:20 은 출전 신고 마감 시각입니다(경기 시작 시각이 아닙니다).', PAD, y0 + 126);
  const boxW = 284; const gap = 12; let bx = W - PAD - boxW * meta.sessions.length - gap * Math.max(0, meta.sessions.length - 1);
  for (const s of meta.sessions) {
    const tone = s.sessionNo === 2 ? { fg: C.s2, bg: C.s2bg } : { fg: C.s1, bg: C.s1bg };
    ctx.fillStyle = tone.bg; ctx.strokeStyle = tone.fg; ctx.lineWidth = 2;
    rrect(ctx, bx, y0 + 4, boxW, 118, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = tone.fg; rrect(ctx, bx + 14, y0 + 16, 54, 26, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `900 16px ${font}`; centerText(ctx, sessionText(s.sessionNo), bx + 14, 54, y0 + 35);
    ctx.fillStyle = C.muted; ctx.font = `800 14px ${font}`; ctx.fillText('출전 신고 마감', bx + 16, y0 + 66); ctx.fillText('경기 시작', bx + 150, y0 + 66);
    ctx.fillStyle = tone.fg; ctx.font = `900 32px ${font}`; ctx.fillText(s.checkinDeadline ?? '-', bx + 16, y0 + 104);
    ctx.fillStyle = C.ink;
    if (s.startTime) { ctx.font = `900 32px ${font}`; ctx.fillText(s.startTime, bx + 150, y0 + 104); }
    else { const note = s.startNote ?? '-'; fitText(ctx, note, 900, 20, 13, boxW - 162, font); ctx.fillText(note, bx + 150, y0 + 100); }
    bx += boxW + gap;
  }

  // ── 표 머리 ──
  const x0 = PAD; const cols = [COL.group, COL.court, COL.session, COL.checkin, teamW, teamW, teamW];
  const xs: number[] = []; cols.reduce((x, w) => { xs.push(x); return x + w; }, x0);
  let y = tableTop;
  ctx.fillStyle = C.head; ctx.fillRect(x0, y, W - PAD * 2, tableHeadH);
  ctx.fillStyle = '#fff'; ctx.font = `800 17px ${font}`;
  ['조', '코트', '차수', '신고 마감'].forEach((t, i) => { fitText(ctx, t, 800, 17, 13, cols[i] - 8, font); centerText(ctx, t, xs[i], cols[i], y + 27); });
  ctx.font = `800 17px ${font}`;
  ['1팀', '2팀', '3팀'].forEach((t, i) => {
    ctx.font = `800 17px ${font}`; ctx.fillText(t, xs[4 + i] + cellPadX, y + 27);
    const tw = ctx.measureText(t).width; ctx.font = `600 13px ${font}`; ctx.fillStyle = '#B9C6D3'; ctx.fillText('선수 · 소속', xs[4 + i] + cellPadX + tw + 8, y + 27); ctx.fillStyle = '#fff';
  });
  y += tableHeadH;

  // ── 행 ──
  const boxes: SheetRowBox[] = [];
  rows.forEach((r) => {
    const { e } = r;
    const tone = e.sessionNo === 2 ? { fg: C.s2, bg: C.s2bg } : e.sessionNo === 1 ? { fg: C.s1, bg: C.s1bg } : { fg: C.muted, bg: '#F1F5F9' };
    boxes.push({ key: e.key, label: e.label, y, h: r.h });
    ctx.fillStyle = '#fff'; ctx.fillRect(x0, y, W - PAD * 2, r.h);
    ctx.fillStyle = tone.bg; ctx.fillRect(x0, y, fixedW, r.h);
    const mid = y + r.h / 2;
    // 조 · 코트 · 차수 · 신고
    ctx.fillStyle = C.ink;
    if (e.kind === 'placement' && e.displayNo === null) {
      ctx.font = `900 19px ${font}`; centerText(ctx, '순위', xs[0], COL.group, mid - 3); centerText(ctx, '결정전', xs[0], COL.group, mid + 20);
    } else if (e.kind === 'placement') {
      // 공개 표시 번호(예: 1조) + 작은 '순위결정전' — 2팀 조라는 것만 알려 준다.
      fitText(ctx, e.label, 900, 30, 20, COL.group - 10, font); centerText(ctx, e.label, xs[0], COL.group, mid + 2);
      ctx.fillStyle = C.muted; ctx.font = `700 13px ${font}`; centerText(ctx, '순위결정전', xs[0], COL.group, mid + 24); ctx.fillStyle = C.ink;
    } else { fitText(ctx, e.label, 900, 30, 20, COL.group - 10, font); centerText(ctx, e.label, xs[0], COL.group, mid + 10); }
    ctx.fillStyle = C.head; ctx.font = `900 32px ${font}`; centerText(ctx, e.courtNo !== null ? String(e.courtNo) : '-', xs[1], COL.court, mid + 11);
    ctx.fillStyle = tone.fg; ctx.font = `900 20px ${font}`; centerText(ctx, sessionText(e.sessionNo), xs[2], COL.session, mid + 7);
    ctx.fillStyle = C.ink; ctx.font = `800 19px ${font}`; centerText(ctx, e.checkinDeadline ?? '-', xs[3], COL.checkin, mid + 7);
    // 팀 칸
    r.cells.forEach((c, i) => {
      const cx = xs[4 + i] + cellPadX;
      if (!c) {
        ctx.fillStyle = C.empty; ctx.fillRect(xs[4 + i], y, teamW, r.h);   // 빈 세 번째 팀 = 실제 빈 칸
        if (e.pendingTeams && i === 0) { ctx.fillStyle = C.muted; ctx.font = `600 15px ${font}`; ctx.fillText('출전 팀은 경기 순서 확정 후 표시', cx, mid + 5); }
        return;
      }
      // 내용 높이만큼 세로 가운데
      let ly = y + (r.h - c.h) / 2;
      for (const p of [c.p1, c.p2]) {
        const base = ly + LINE_H - 7;
        ctx.fillStyle = C.ink; ctx.font = `800 ${p.nameSize}px ${font}`; ctx.fillText(p.name, cx, base);
        const nw = ctx.measureText(p.name).width;
        if (p.club) {
          ctx.fillStyle = C.muted; ctx.font = `600 ${p.clubSize}px ${font}`;
          if (p.inline) ctx.fillText(p.club, cx + nw + 9, base);
          else p.clubLines.forEach((l, k) => ctx.fillText(l, cx, base + CLUB_H * (k + 1) - 2));
        }
        ly += p.h;
      }
      // 같은 칸 안 두 선수 사이 옅은 선 없음 — 팀 사이(세로) 선으로만 구분
    });
    // 선 — 행 사이는 진하게, 열 사이는 옅게
    ctx.strokeStyle = C.colLine; ctx.lineWidth = 1;
    for (let k = 1; k < xs.length; k += 1) { ctx.beginPath(); ctx.moveTo(xs[k] + 0.5, y); ctx.lineTo(xs[k] + 0.5, y + r.h); ctx.stroke(); }
    ctx.strokeStyle = C.rowLine; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, y + r.h); ctx.lineTo(W - PAD, y + r.h); ctx.stroke();
    y += r.h;
  });
  ctx.strokeStyle = C.head; ctx.lineWidth = 2; ctx.strokeRect(x0, tableTop, W - PAD * 2, y - tableTop);
  // 고정 열(조 · 코트 · 차수 · 신고)과 팀 열 경계 강조
  ctx.beginPath(); ctx.moveTo(xs[4] + 0.5, tableTop); ctx.lineTo(xs[4] + 0.5, y); ctx.stroke();

  // ── 바닥 ──
  const teams = entries.reduce((a, e) => a + e.teams.length, 0);
  const pl = entries.filter((e) => e.kind === 'placement');
  const plNote = pl.length ? ` · ${pl.map((e) => e.label).join(' · ')} = 2팀(순위결정전)` : '';
  ctx.fillStyle = C.soft; ctx.font = `700 16px ${font}`;
  ctx.fillText(`총 ${entries.length}개 조 · ${teams}팀${plNote} · 코트는 예정 코트(실제 코트는 현장 안내 · 앱 DRAW 기준)`, PAD, y + 30);
  ctx.fillStyle = C.muted; ctx.font = `600 14px ${font}`;
  const foot = `${meta.generatedAt} · 선수 교체 · 코트 변경 시 이 이미지는 바뀌지 않습니다 — 최신 정보는 앱 DRAW${meta.liveUrl ? ` (${meta.liveUrl})` : ''}`;
  fitText(ctx, foot, 600, 14, 11, W - PAD * 2, font); ctx.fillText(foot, PAD, y + 54);
  return { canvas: cv, rows: boxes, width: W, height: H };
}
