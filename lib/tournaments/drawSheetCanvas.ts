// 전체 조편성표(가로형 공식 표) — canvas 로 그린다(브라우저 전용 · 서버 호출 없음 · 외부 라이브러리 없음).
//
//   ⚠ 화면에 보이는 표와 저장되는 이미지는 이 함수 하나가 그린 같은 그림이다(두 번 그리지 않는다).
//   ⚠ 입력은 모바일 대진표와 같은 entries(officialDrawModel.buildEntries) — 조 · 선수 · 소속 · 코트 · 차수 · 신고가 어긋날 수 없다.
//   ⚠ 글자가 칸을 넘으면 자르지 않는다 — 소속을 다음 줄로 내리고, 그래도 길면 글자를 줄인다(최소 11px).

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

const W = 1600;                 // 논리 폭(px) — 저장 이미지는 scale 배
const PAD = 36;
const COL = { group: 104, court: 76, session: 70, checkin: 84 };
const TEAM_SLOTS = 3;
const C = {
  ink: '#0F172A', soft: '#334155', muted: '#64748B', line: '#CBD5E1', lineSoft: '#E2E8F0', head: '#102A3D',
  s1: '#0E8C80', s1bg: '#E7F3F1', s2: '#B7791F', s2bg: '#FFF4E0', zebra: '#F8FAFC',
};

/** roundRect 미지원 브라우저(구형 iOS) — 직사각형으로 대신. */
const rrect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
};

const sessionText = (n: 1 | 2 | null) => (n === 1 ? '1차' : n === 2 ? '2차' : '-');

/** 한 선수 칸 — 이름(굵게) + 소속(작게). 폭을 넘으면 소속을 다음 줄로. 반환: 필요한 줄 수. */
function layoutPlayer(ctx: CanvasRenderingContext2D, font: string, name: string, club: string | null, width: number): { lines: number; clubSize: number; wrap: boolean } {
  ctx.font = `800 19px ${font}`;
  const nw = ctx.measureText(name).width;
  if (!club) return { lines: 1, clubSize: 14, wrap: false };
  for (const size of [14, 13, 12]) {
    ctx.font = `600 ${size}px ${font}`;
    if (nw + 8 + ctx.measureText(club).width <= width) return { lines: 1, clubSize: size, wrap: false };
  }
  for (const size of [14, 13, 12, 11]) {
    ctx.font = `600 ${size}px ${font}`;
    if (ctx.measureText(club).width <= width) return { lines: 2, clubSize: size, wrap: true };
  }
  return { lines: 2, clubSize: 11, wrap: true };
}

function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, min: number, width: number, font: string): number {
  let s = size;
  for (; s > min; s -= 1) { ctx.font = `${weight} ${s}px ${font}`; if (ctx.measureText(text).width <= width) break; }
  ctx.font = `${weight} ${s}px ${font}`;
  return s;
}

/** 표 전체 높이를 먼저 계산하고 그린다. scale = 저장 해상도 배수(화면 2, 저장 2). */
export function renderDrawSheet(entries: DrawEntry[], meta: SheetMeta, scale = 2, fontFamily = 'sans-serif'): HTMLCanvasElement {
  const font = fontFamily;
  const probe = document.createElement('canvas').getContext('2d')!;
  const teamW = (W - PAD * 2 - COL.group - COL.court - COL.session - COL.checkin) / TEAM_SLOTS;
  const cellPad = 12;
  // 행 높이 — 칸마다 선수 두 명 × (1~2줄)
  const rows = entries.map((e) => {
    const cells = Array.from({ length: TEAM_SLOTS }, (_, i) => {
      const t = e.teams[i];
      if (!t) return null;
      const p1 = layoutPlayer(probe, font, t.player1Name, t.club1, teamW - cellPad * 2);
      const p2 = layoutPlayer(probe, font, t.player2Name, t.club2, teamW - cellPad * 2);
      return { t, p1, p2, lines: p1.lines + p2.lines };
    });
    const lines = Math.max(2, ...cells.map((c) => (c ? c.lines : 2)));
    return { e, cells, h: 18 + lines * 24 };
  });
  const headerH = 150; const tableHeadH = 44; const footH = 64;
  const H = PAD + headerH + tableHeadH + rows.reduce((a, r) => a + r.h, 0) + footH + PAD;

  const cv = document.createElement('canvas');
  cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
  const ctx = cv.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);

  // ── 머리 ──
  let y = PAD;
  ctx.fillStyle = C.head; ctx.fillRect(0, 0, W, 8);
  ctx.fillStyle = C.ink; ctx.font = `900 36px ${font}`; ctx.fillText(meta.title, PAD, y + 40);
  if (meta.subtitle) { ctx.fillStyle = C.muted; ctx.font = `700 18px ${font}`; ctx.fillText(meta.subtitle, PAD, y + 72); }
  if (meta.checkinPlace) { ctx.fillStyle = C.soft; ctx.font = `700 17px ${font}`; ctx.fillText(`출전 신고 장소 · ${meta.checkinPlace}`, PAD, y + 104); }
  // 1차 · 2차 상자(오른쪽)
  const boxW = 300; let bx = W - PAD - boxW * meta.sessions.length - 14 * (meta.sessions.length - 1);
  for (const s of meta.sessions) {
    const tone = s.sessionNo === 2 ? { fg: C.s2, bg: C.s2bg } : { fg: C.s1, bg: C.s1bg };
    ctx.fillStyle = tone.bg; ctx.strokeStyle = tone.fg; ctx.lineWidth = 2;
    rrect(ctx, bx, y + 6, boxW, 112, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = tone.fg; rrect(ctx, bx + 14, y + 18, 54, 26, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `900 16px ${font}`; ctx.fillText(sessionText(s.sessionNo), bx + 26, y + 37);
    ctx.fillStyle = C.muted; ctx.font = `700 14px ${font}`; ctx.fillText('신고 마감', bx + 16, y + 70); ctx.fillText('경기 시작', bx + 156, y + 70);
    ctx.fillStyle = tone.fg; ctx.font = `900 30px ${font}`; ctx.fillText(s.checkinDeadline ?? '-', bx + 16, y + 104);
    ctx.fillStyle = C.ink;
    if (s.startTime) { ctx.font = `900 30px ${font}`; ctx.fillText(s.startTime, bx + 156, y + 104); }
    else { fitText(ctx, s.startNote ?? '-', 900, 19, 13, boxW - 170, font); ctx.fillText(s.startNote ?? '-', bx + 156, y + 100); }
    bx += boxW + 14;
  }
  y += headerH;

  // ── 표 머리 ──
  const x0 = PAD; const cols = [COL.group, COL.court, COL.session, COL.checkin, teamW, teamW, teamW];
  const xs: number[] = []; cols.reduce((x, w) => { xs.push(x); return x + w; }, x0);
  ctx.fillStyle = C.head; ctx.fillRect(x0, y, W - PAD * 2, tableHeadH);
  ctx.fillStyle = '#fff'; ctx.font = `800 17px ${font}`;
  ['조', '코트', '차수', '신고', '1팀 · 선수 / 소속', '2팀 · 선수 / 소속', '3팀 · 선수 / 소속'].forEach((t, i) => {
    const w = ctx.measureText(t).width; ctx.fillText(t, i < 4 ? xs[i] + (cols[i] - w) / 2 : xs[i] + cellPad, y + 28);
  });
  y += tableHeadH;

  // ── 행 ──
  rows.forEach((r, ri) => {
    const { e } = r; const tone = e.sessionNo === 2 ? { fg: C.s2, bg: C.s2bg } : e.sessionNo === 1 ? { fg: C.s1, bg: C.s1bg } : { fg: C.muted, bg: '#F1F5F9' };
    ctx.fillStyle = ri % 2 ? C.zebra : '#fff'; ctx.fillRect(x0, y, W - PAD * 2, r.h);
    ctx.fillStyle = tone.bg; ctx.fillRect(x0, y, COL.group + COL.court + COL.session + COL.checkin, r.h);
    const mid = y + r.h / 2;
    // 조
    ctx.fillStyle = C.ink;
    if (e.kind === 'placement') { fitText(ctx, '순위결정전', 900, 20, 13, COL.group - 12, font); const w = ctx.measureText('순위결정전').width; ctx.fillText('순위결정전', xs[0] + (COL.group - w) / 2, mid + 7); }
    else { ctx.font = `900 28px ${font}`; const w = ctx.measureText(e.label).width; ctx.fillText(e.label, xs[0] + (COL.group - w) / 2, mid + 10); }
    // 코트
    const court = e.courtNo !== null ? String(e.courtNo) : '-';
    ctx.font = `900 30px ${font}`; let w = ctx.measureText(court).width; ctx.fillStyle = C.head; ctx.fillText(court, xs[1] + (COL.court - w) / 2, mid + 11);
    // 차수
    ctx.font = `900 19px ${font}`; const st = sessionText(e.sessionNo); w = ctx.measureText(st).width; ctx.fillStyle = tone.fg; ctx.fillText(st, xs[2] + (COL.session - w) / 2, mid + 7);
    // 신고
    ctx.font = `800 18px ${font}`; const ck = e.checkinDeadline ?? '-'; w = ctx.measureText(ck).width; ctx.fillStyle = C.ink; ctx.fillText(ck, xs[3] + (COL.checkin - w) / 2, mid + 7);
    // 팀 칸
    r.cells.forEach((c, i) => {
      const cx = xs[4 + i] + cellPad; let ly = y + 9 + 19;
      if (!c) {
        if (e.pendingTeams && i === 0) { ctx.fillStyle = C.muted; ctx.font = `600 15px ${font}`; ctx.fillText('출전 팀은 경기 순서 확정 후 표시', cx, mid + 5); }
        return;
      }
      for (const [name, club, lay] of [[c.t.player1Name, c.t.club1, c.p1], [c.t.player2Name, c.t.club2, c.p2]] as const) {
        ctx.fillStyle = C.ink; ctx.font = `800 19px ${font}`; ctx.fillText(name, cx, ly);
        const nw = ctx.measureText(name).width;
        if (club) {
          ctx.fillStyle = C.muted; ctx.font = `600 ${lay.clubSize}px ${font}`;
          if (lay.wrap) { ly += 22; ctx.fillText(club, cx, ly); } else ctx.fillText(club, cx + nw + 8, ly);
        }
        ly += 24;
      }
    });
    // 선
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y + r.h + 0.5); ctx.lineTo(W - PAD, y + r.h + 0.5); ctx.stroke();
    ctx.strokeStyle = C.lineSoft;
    for (let k = 1; k < xs.length; k += 1) { ctx.beginPath(); ctx.moveTo(xs[k] + 0.5, y); ctx.lineTo(xs[k] + 0.5, y + r.h); ctx.stroke(); }
    y += r.h;
  });
  ctx.strokeStyle = C.head; ctx.lineWidth = 2; ctx.strokeRect(x0, PAD + headerH, W - PAD * 2, y - (PAD + headerH));

  // ── 바닥 ──
  const teams = entries.reduce((a, e) => a + e.teams.length, 0);
  const groups = entries.filter((e) => e.kind === 'group').length;
  ctx.fillStyle = C.soft; ctx.font = `700 16px ${font}`;
  ctx.fillText(`일반 ${groups}개 조 · 순위결정전 ${entries.length - groups}개 · 총 ${teams}팀 · 코트는 예정 코트(실제 코트는 현장 안내 · 앱 DRAW 기준)`, PAD, y + 30);
  ctx.fillStyle = C.muted; ctx.font = `600 14px ${font}`;
  ctx.fillText(`${meta.generatedAt} · 선수 교체 · 코트 변경 시 이 이미지는 바뀌지 않습니다 — 최신 정보는 앱 DRAW${meta.liveUrl ? ` (${meta.liveUrl})` : ''}`, PAD, y + 54);
  return cv;
}
