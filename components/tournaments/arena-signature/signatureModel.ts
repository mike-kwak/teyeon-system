// Arena TV — Signature 화면 계산 (순수 함수만 둔다).
//
//   ⚠ 이 파일은 대진을 '결정'하지 않는다.
//     자리 · 연결 · BYE 칸 · 경기 매칭은 운영 Arena 와 같은 배치 함수(layoutMirroredBracket)가 만든다.
//     여기서는 그 결과의 **화면 좌표만** 다시 잡는다.
//       · 열마다 폭을 다르게(바깥 64강이 가장 넓게) — x 와 폭만 바꾼다.
//       · 16강 이상 칸은 높이만 키운다 — 중심 y 는 그대로라 연결 구조가 변하지 않는다.
//       · 연결선은 같은 공식(자식 안쪽 가장자리 → 꺾임 → 부모 바깥 가장자리)으로 새 좌표에서 다시 그린다.
//   ⚠ 승패 · 코트 상태 · 단계 이름은 Autumn Ivory(arena-design)와 같은 의미다.
//     실험 파일끼리 묶이지 않도록 import 하지 않고 같은 규칙을 여기 둔다(QA 에서 결과를 대조한다).

import { layoutMirroredBracket } from '@/lib/tournaments/layoutMirroredBracket';
import type { MirroredLayout, MirroredNode, MirroredWarning, MirrorSide } from '@/lib/tournaments/layoutMirroredBracket';
import type { ArenaBracket, ArenaCourt, ArenaKnockoutMatch, ArenaSlot } from '@/lib/tournaments/arenaTypes';
import { SIG_COLUMNS, SIG_LAYOUT, SIG_NAME_FLOOR, SIG_TIERS } from './signatureTheme';
import type { SignatureTier } from './signatureTheme';

// ── 이름 맞춤 ───────────────────────────────────────────────────────────────
//   TV 에서는 말줄임보다 '한 단계 작게' 또는 '선수별 두 줄' 로 끝까지 보여 준다.
//   ⚠ 글자 폭은 화면을 재지 않고 문자 종류로 추정한다(첫 그림부터 흔들리지 않게).
//     추정이 빗나가도 CSS 말줄임이 마지막 방어선으로 남는다(QA 가 잘림을 센다).

const emOf = (ch: string): number => {
  const c = ch.codePointAt(0) ?? 0;
  if ((c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3130 && c <= 0x318f) || (c >= 0x4e00 && c <= 0x9fff)) return 1.0;
  if (ch === ' ') return 0.26;
  if (ch === '·') return 0.34;
  if (ch === '.') return 0.3;
  if (ch >= 'A' && ch <= 'Z') return 0.7;
  if (ch >= '0' && ch <= '9') return 0.6;
  if (ch >= 'a' && ch <= 'z') return 0.57;
  return 0.6;
};

/** 굵은 글꼴 기준 대략적 폭(em). */
export const textEm = (s: string): number =>
  Array.from(s).reduce((sum, ch) => sum + emOf(ch), 0) * 1.04;

const LATIN_FULL = /^[A-Za-z][A-Za-z'-]*(?: [A-Za-z][A-Za-z'-]*)+$/;

/**
 * 긴 영문 이름 축약 — 'Alexander Maximilian' → 'Alexander M.'.
 *   ⚠ 영문(띄어쓰기 있는 라틴 이름)만 줄인다. 한글 이름은 절대 줄이지 않는다.
 */
export function abbreviateLatin(name: string): string {
  const s = name.trim();
  if (!LATIN_FULL.test(s)) return s;
  const parts = s.split(' ');
  return `${parts[0]} ${parts.slice(1).map((p) => `${p[0].toUpperCase()}.`).join(' ')}`;
}

export interface FittedName {
  lines: string[];
  fontSize: number;
  /** 영문 축약을 썼는가(QA · 화면 표시용). */
  abbreviated: boolean;
}

export interface FitOptions {
  /** 한 줄 기본 크기. */
  base: number;
  /** 한 줄로 버틸 최소 크기 — 이보다 작아지면 두 줄로 나눈다. */
  min: number;
  /** 두 줄일 때 최대 크기(칸 높이가 정한다). 두 줄을 허용하지 않으면 생략한다. */
  stackMax?: number;
  /** 축약을 허용하는가 — 데모 64강 · 32강에서만 true. */
  allowAbbreviation?: boolean;
  /**
   * 줄 높이 — 주면 축약 대신 '단어 단위 줄바꿈'(영문 이름을 이름 / 성 두 줄로)을 시도한다.
   *   축약을 쓰지 않는 칸(16강 이상)에서 긴 영문 이름을 끝까지 보여 주기 위한 마지막 단계다.
   */
  rowHeight?: number;
}

const half = (n: number): number => Math.floor(n * 2) / 2;

/** 두 선수 이름을 폭에 맞춘다. 한 줄 → 작게 한 줄 → 선수별 두 줄 → (허용 시) 영문 축약 순서. */
export function fitTeamName(names: string[], width: number, o: FitOptions): FittedName {
  const clean = names.map((s) => s.trim()).filter((s) => s !== '');
  if (clean.length === 0) return { lines: ['—'], fontSize: o.base, abbreviated: false };

  const joined = clean.join(' · ');
  const one = Math.min(o.base, width / textEm(joined));
  if (one >= o.min || clean.length < 2 || o.stackMax === undefined) {
    // 한 사람 이름이 혼자 길 때도 축약 규칙은 같다.
    if (clean.length === 1 && one < SIG_NAME_FLOOR && o.allowAbbreviation) {
      const short = abbreviateLatin(clean[0]);
      if (short !== clean[0]) {
        return { lines: [short], fontSize: Math.max(half(Math.min(o.base, width / textEm(short))), SIG_NAME_FLOOR), abbreviated: true };
      }
    }
    return { lines: [joined], fontSize: Math.max(half(one), clean.length < 2 ? SIG_NAME_FLOOR : o.min), abbreviated: false };
  }

  const stacked = (list: string[]): number =>
    Math.min(o.stackMax!, width / Math.max(...list.map(textEm)));

  const two = stacked(clean);
  // 두 줄로 나눠도 글자가 거의 커지지 않으면 한 줄이 낫다(짧은 한글 이름이 괜히 쌓이지 않게).
  //   한 줄이 14px 이상이면 두 줄이 3px 넘게 커질 때만 나눈다(코트 미포함의 높은 칸에서도 '박라온 · 임보람' 은 한 줄).
  if (one >= SIG_NAME_FLOOR && (one >= two - 1 || (one >= 14 && one >= two - 3))) {
    return { lines: [joined], fontSize: half(one), abbreviated: false };
  }
  if (two < SIG_NAME_FLOOR && !o.allowAbbreviation && o.rowHeight !== undefined) {
    // 단어 단위 줄바꿈 — 폭을 넘는 영문 이름만 띄어쓰기에서 나눈다(한글 이름은 나누지 않는다).
    const wrapped = clean.flatMap((n) => (textEm(n) * SIG_NAME_FLOOR > width && LATIN_FULL.test(n) ? n.split(' ') : [n]));
    if (wrapped.length > clean.length) {
      const cap = (o.rowHeight - 2) / (wrapped.length * 1.04);
      const size = Math.min(cap, width / Math.max(...wrapped.map(textEm)));
      return { lines: wrapped, fontSize: Math.max(half(size), SIG_NAME_FLOOR), abbreviated: false };
    }
  }
  if (two >= SIG_NAME_FLOOR || !o.allowAbbreviation) {
    return { lines: clean, fontSize: Math.max(half(two), SIG_NAME_FLOOR), abbreviated: false };
  }

  // 축약 — 폭을 넘는 영문 이름만 줄인다.
  const shortened = clean.map((n) => (textEm(n) * SIG_NAME_FLOOR > width ? abbreviateLatin(n) : n));
  const changed = shortened.some((n, i) => n !== clean[i]);
  return {
    lines: shortened,
    fontSize: Math.max(half(stacked(shortened)), SIG_NAME_FLOOR),
    abbreviated: changed,
  };
}

// ── 승패 · 코트 상태(Ivory 와 같은 의미) ────────────────────────────────────

export interface SideResult {
  score: number | null;
  winner: boolean;
  loser: boolean;
}

/** 끝난 경기에서만 점수와 승패를 낸다. 진행 중 · 대기 경기에는 숫자를 만들지 않는다. */
export function sideOf(match: ArenaKnockoutMatch | null, index: number): SideResult {
  if (!match || match.status !== 'completed') return { score: null, winner: false, loser: false };
  const score = index === 0 ? match.score1 : match.score2;
  const other = index === 0 ? match.score2 : match.score1;
  const decided = score !== null && other !== null && score !== other;
  return { score, winner: decided && score! > other!, loser: decided && score! < other! };
}

export type CourtState = 'live' | 'empty' | 'closed';

/**
 * 코트 상태 — 저장된 데이터에 있는 것만.
 *   LIVE(진행 중 경기가 코트를 점유) · 빈 코트 · 운영 중지.
 *   ⚠ '대기' · '예정'은 코트 데이터에 없다(call_match 는 코트를 점유하지 않는다).
 */
export const courtStateOf = (court: ArenaCourt | null): CourtState =>
  court?.now ? 'live' : court && !court.active ? 'closed' : 'empty';

/** 코트에서 진행 중인 경기의 단계 이름 — 대진 데이터에서 찾을 수 있을 때만. */
export function stageLabel(court: ArenaCourt, bracket: ArenaBracket | null): string | null {
  const now = court.now;
  if (!now) return null;
  if (now.stage === 'knockout') {
    const m = bracket?.matches.find((x) => x.matchNo === now.matchNo);
    return m?.roundName ? `본선 ${m.roundName}` : '본선';
  }
  // 순위결정전은 내부 조 번호(예: 19)를 쓰지 않는다 — liveStageLabel 과 같은 규칙.
  if (now.stage === 'placement') return '순위결정전';
  return now.groupNo !== null ? `예선 ${now.groupNo}조` : '예선';
}

export const teamNames = (slot: ArenaSlot): string[] =>
  slot.team ? [slot.team.player1Name, slot.team.player2Name] : [];

// ── 대진 좌표 ───────────────────────────────────────────────────────────────

export interface SigNode extends MirroredNode {
  /** 레인(64강 · 32강) 열인가. */
  lane: boolean;
  /** 16강 이상 — 팀마다 떨어진 알약으로 그린다. */
  inner: boolean;
}

export interface SigConnector {
  key: string;
  fromNodeKey: string;
  toNodeKey: string;
  side: MirrorSide;
  path: string;
  /** 자식 칸의 승자 자리(=목적지)에 팀이 저장돼 있는가 — 진출이 확정된 경로. */
  advanced: boolean;
}

export interface SigColumn {
  side: MirrorSide;
  column: number;
  roundName: string | null;
  x: number;
  width: number;
  lane: boolean;
}

export interface SigRect { x: number; y: number; width: number; height: number }

export interface SignatureGeometry {
  tier: SignatureTier;
  nodes: SigNode[];
  connectors: SigConnector[];
  columns: SigColumn[];
  /** 레인 판(열 하나 = 판 하나). */
  lanes: SigRect[];
  final: SigNode | null;
  trophy: SigRect | null;
  champion: (SigRect & { team: ArenaSlot['team'] }) | null;
  /** 배치 결과의 크기(본문 744 기준). */
  width: number;
  height: number;
  maxColumn: number;
  warnings: MirroredWarning[];
  empty: boolean;
}

const TROPHY_H = 62;
const TROPHY_GAP = 8;
const CHAMPION_H = 92;
const CHAMPION_GAP = 14;
/** 레인 판이 칸 위아래로 더 나가는 폭 — 배치 높이에는 넣지 않는다(리본 틈 · 아래 여백 안에 머문다). */
const LANE_PAD_Y = 5;

/** 배치 조건 — 기본값은 코트 포함(본문 744 · 일반 단계 · 안쪽 칸 92). */
export interface SignatureGeometryOptions {
  bodyHeight?: number;
  tiers?: SignatureTier[];
  innerNodeHeight?: number;
}

const layoutWith = (bracket: ArenaBracket | null, tier: SignatureTier): MirroredLayout =>
  layoutMirroredBracket(bracket, {
    cardWidth: SIG_COLUMNS.inner,
    cardHeight: tier.cardHeight,
    compactHeight: tier.compactHeight,
    rowGap: tier.rowGap,
    columnGap: SIG_COLUMNS.gap,
    padding: 0,
    finalWidth: SIG_COLUMNS.final,
    finalHeight: SIG_COLUMNS.finalHeight,
    // 우승 패널은 아래에서 직접 놓는다 — 배치 높이에 섞이지 않게 0 으로 둔다.
    championHeight: 0,
    championGap: 0,
  });

/** 큰 단계부터 본문 높이에 들어가는 첫 단계. 다 넘치면 가장 촘촘한 단계(그 뒤는 보드가 줄인다). */
function pickLayout(
  bracket: ArenaBracket | null, tiers: SignatureTier[], bodyHeight: number,
): { tier: SignatureTier; layout: MirroredLayout } {
  let last: { tier: SignatureTier; layout: MirroredLayout } | null = null;
  for (const tier of tiers) {
    const layout = layoutWith(bracket, tier);
    last = { tier, layout };
    if (layout.empty || layout.height <= bodyHeight) return last;
  }
  return last!;
}

export function buildSignatureGeometry(bracket: ArenaBracket | null, options: SignatureGeometryOptions = {}): SignatureGeometry {
  const bodyHeight = options.bodyHeight ?? SIG_LAYOUT.bodyHeight;
  const innerNodeHeight = options.innerNodeHeight ?? SIG_COLUMNS.innerNodeHeight;
  const { tier, layout } = pickLayout(bracket, options.tiers ?? SIG_TIERS, bodyHeight);
  const base: SignatureGeometry = {
    tier, nodes: [], connectors: [], columns: [], lanes: [], final: null, trophy: null, champion: null,
    width: 0, height: 0, maxColumn: 0, warnings: layout.warnings, empty: true,
  };
  if (layout.empty) return base;

  const maxColumn = layout.nodes.reduce((m, n) => Math.max(m, n.column), 0);
  const widthOf = (column: number): number =>
    column === maxColumn ? SIG_COLUMNS.outer
      : column === maxColumn - 1 ? SIG_COLUMNS.second
        : SIG_COLUMNS.inner;
  const isLane = (column: number): boolean => column >= 1 && column >= maxColumn - 1;

  // 가운데에서 바깥으로 열 위치를 쌓는다.
  const offsets: number[] = [0];   // offsets[c] = 결승 가장자리에서 c 열 안쪽 가장자리까지
  for (let c = 1; c <= maxColumn; c += 1) {
    offsets[c] = c === 1 ? SIG_COLUMNS.gap : offsets[c - 1] + widthOf(c - 1) + SIG_COLUMNS.gap;
  }
  const halfFinal = SIG_COLUMNS.final / 2;
  const reach = maxColumn === 0 ? 0 : offsets[maxColumn] + widthOf(maxColumn);
  const width = 2 * (halfFinal + reach);
  const cx = width / 2;

  const xOf = (side: MirrorSide, column: number): { x: number; width: number } => {
    if (side === 'center' || column === 0) return { x: cx - halfFinal, width: SIG_COLUMNS.final };
    const w = widthOf(column);
    const inward = halfFinal + offsets[column];
    return side === 'left' ? { x: cx - inward - w, width: w } : { x: cx + inward, width: w };
  };

  const nodes: SigNode[] = layout.nodes.map((n) => {
    const pos = xOf(n.side, n.column);
    const lane = isLane(n.column);
    const inner = n.column >= 1 && !lane;
    const height = inner && !n.compact ? innerNodeHeight : n.height;
    const centerY = n.y + n.height / 2;
    return { ...n, x: pos.x, width: pos.width, y: centerY - height / 2, height, lane, inner };
  });
  const byKey = new Map(nodes.map((n) => [n.key, n]));

  const connectors: SigConnector[] = layout.connectors.flatMap((c) => {
    const child = byKey.get(c.fromNodeKey);
    const parent = byKey.get(c.toNodeKey);
    if (!child || !parent) return [];
    const y1 = child.y + child.height / 2;
    const y2 = parent.y + parent.height / 2;
    const x1 = child.side === 'left' ? child.x + child.width : child.x;
    const x2 = child.side === 'left' ? parent.x : parent.x + parent.width;
    const mid = (x1 + x2) / 2;
    return [{
      key: `${c.fromNodeKey}->${c.toNodeKey}`,
      fromNodeKey: c.fromNodeKey,
      toNodeKey: c.toNodeKey,
      side: child.side,
      path: `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`,
      advanced: child.targetSlot.team !== null,
    }];
  });

  const columns: SigColumn[] = [];
  const seen = new Set<string>();
  nodes.forEach((n) => {
    const k = `${n.side}:${n.column}`;
    if (seen.has(k)) return;
    seen.add(k);
    columns.push({
      side: n.side, column: n.column, roundName: n.column === 0 ? '결승' : n.roundName,
      x: n.x, width: n.width, lane: n.lane,
    });
  });
  columns.sort((a, b) => a.x - b.x);

  // 레인 판 — 64강 · 32강 열마다 하나. 그 열 칸들의 위아래 끝을 덮는다.
  const lanes: SigRect[] = columns.filter((c) => c.lane).map((c) => {
    const inCol = nodes.filter((n) => n.side === c.side && n.column === c.column);
    const top = Math.min(...inCol.map((n) => n.y)) - LANE_PAD_Y;
    const bottom = Math.max(...inCol.map((n) => n.y + n.height)) + LANE_PAD_Y;
    return { x: c.x, y: top, width: c.width, height: bottom - top };
  });

  const final = nodes.find((n) => n.column === 0) ?? null;
  const trophy: SigRect | null = final
    ? { x: final.x, y: final.y - TROPHY_GAP - TROPHY_H, width: final.width, height: TROPHY_H }
    : null;
  const champSlot = layout.champion;
  // ⚠ 결승 전에는 우승 패널을 만들지 않는다 — 저장된 우승 자리에 팀이 있을 때만.
  const champion = final && champSlot && champSlot.decided && champSlot.team
    ? { x: final.x, y: final.y + final.height + CHAMPION_GAP, width: final.width, height: CHAMPION_H, team: champSlot.team }
    : null;

  // 세로 범위를 0 부터 시작하게 맞춘다(트로피가 위로 나갈 수 있다). 레인 판의 여유 폭은 범위에 넣지 않는다.
  const tops = [...nodes.map((n) => n.y), trophy ? trophy.y : Infinity];
  const bottoms = [...nodes.map((n) => n.y + n.height), champion ? champion.y + champion.height : -Infinity];
  const minY = Math.min(...tops);
  const maxY = Math.max(...bottoms);
  const dy = -minY;
  const shift = <T extends { y: number }>(r: T): T => ({ ...r, y: r.y + dy });
  const connectorsShifted = connectors.map((c) => ({
    ...c,
    path: c.path.replace(/^M (\S+) (\S+) H (\S+) V (\S+) H (\S+)$/,
      (_m, x1, y1, mid, y2, x2) => `M ${x1} ${Number(y1) + dy} H ${mid} V ${Number(y2) + dy} H ${x2}`),
  }));
  const shiftedNodes = nodes.map(shift);

  return {
    tier,
    nodes: shiftedNodes,
    connectors: connectorsShifted,
    columns,
    lanes: lanes.map(shift),
    final: final ? shiftedNodes.find((n) => n.key === final.key) ?? null : null,
    trophy: trophy ? shift(trophy) : null,
    champion: champion ? shift(champion) : null,
    width,
    height: maxY - minY,
    maxColumn,
    warnings: layout.warnings,
    empty: false,
  };
}
