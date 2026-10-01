// Arena TV 전용 — 중앙 수렴형 본선 배치 (Batch 4E-0). **순수 함수만** 둔다.
//
//   LEFT BRACKET → CENTER FINAL ← RIGHT BRACKET
//   왼쪽 가지와 오른쪽 가지가 가운데 결승을 향해 모인다. 16:9 화면의 시선 종착점이 결승이다.
//
//   ⚠⚠ 이 파일은 대진을 '결정'하지 않는다. 저장된 topology 를 좌표로 옮길 뿐이다.
//     · 시드 · 대진 조합 · BYE 위치를 만들지 않는다.
//     · '32강/64강이면 이런 모양' 을 가정하지 않는다(2의 거듭제곱이 아니어도 된다).
//     · 좌우 깊이가 달라도 맞추려고 보정하지 않는다 — 저장된 그대로 보여 준다.
//     · 미래 승자를 계산하지 않는다.
//   ⚠ 공개 본선 배치(layoutBracket.ts)와 **완전히 분리**된 파일이다. 그쪽을 수정하지 않는다.
//   ⚠ 잘못된 연결(순환 · 없는 자리 · 갈래 3개 이상)이 들어와도 멈추지 않는다.
//     다만 **고치지 않는다** — 그릴 수 있는 만큼 그리고 warnings 에 남긴다.
//
//   좌표 모델
//     · '칸(node)' 하나 = 어떤 자리로 모이는 공급 자리들(보통 2개)의 묶음이다.
//       공개 배치와 같은 모델이라 두 화면의 의미가 어긋나지 않는다.
//     · column 0 = 가운데 결승 칸. 1, 2, 3 … 으로 갈수록 바깥(이른 라운드)이다.
//     · 왼쪽 가지는 column 이 커질수록 왼쪽으로, 오른쪽 가지는 오른쪽으로 간다.

import type { ArenaBracket, ArenaKnockoutMatch, ArenaSlot } from './arenaTypes';

export type MirrorSide = 'left' | 'right' | 'center';

export interface MirroredNodeFeeder {
  slot: ArenaSlot;
  /** 이 자리로 모이는 더 바깥 칸의 key. 없으면 이 자리가 가지의 끝이다. */
  fromNodeKey: string | null;
}

export interface MirroredNode {
  /** 목적지 자리 id 로 만든 안정 key. 데이터가 갱신돼도 같은 칸이면 같은 key 다. */
  key: string;
  side: MirrorSide;
  /** 가운데에서 몇 칸 떨어졌는가. 0 = 결승. */
  column: number;
  /** 이 칸의 공급 자리들이 속한 라운드. 공급 자리가 섞여 있으면 가장 작은 라운드. */
  roundNo: number;
  roundName: string | null;
  /** 승자가 올라갈 자리. */
  targetSlot: ArenaSlot;
  /** 보통 2개. 저장된 연결이 이상하면 1개이거나 3개 이상일 수도 있다(그대로 둔다). */
  feeders: MirroredNodeFeeder[];
  /** 이 칸에 해당하는 경기. BYE·미정이라 경기가 없으면 null. */
  match: ArenaKnockoutMatch | null;
  /** BYE 가 섞여 경기가 없는 칸 — 화면에서 낮게 그려도 되는 칸. */
  compact: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MirroredConnector {
  /** 바깥 칸(자식) → 안쪽 칸(부모). */
  fromNodeKey: string;
  toNodeKey: string;
  side: MirrorSide;
  /** SVG path. 가운데를 향해 꺾인다. */
  path: string;
}

export interface MirroredColumn {
  side: MirrorSide;
  column: number;
  roundNo: number;
  roundName: string | null;
  x: number;
  width: number;
}

export interface MirroredChampion {
  slot: ArenaSlot;
  /** 우승이 확정됐을 때만 값이 있다. ⚠ 결승 전에 예측해 채우지 않는다. */
  team: ArenaSlot['team'];
  decided: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 자동 보정을 하지 않는 대신, 이상한 구조를 여기에 남긴다(화면/로그 진단용). */
export type MirroredWarning =
  | 'empty_bracket'
  | 'no_final_slot'
  | 'multiple_terminal_slots'
  | 'final_feeder_missing'
  | 'final_feeder_incomplete'
  | 'extra_feeders'
  | 'cycle_detected'
  | 'unknown_feeds_target'
  | 'depth_limit'
  | 'node_limit'
  | 'detached_slots';

export interface MirroredLayout {
  width: number;
  height: number;
  /** 가운데 세로축(결승 칸의 중심). */
  centerX: number;
  nodes: MirroredNode[];
  connectors: MirroredConnector[];
  columns: MirroredColumn[];
  champion: MirroredChampion | null;
  warnings: MirroredWarning[];
  /** 그릴 것이 하나도 없는가. */
  empty: boolean;
}

export interface MirroredLayoutOptions {
  cardWidth?: number;
  cardHeight?: number;
  /** BYE 등으로 경기가 없는 칸의 높이. */
  compactHeight?: number;
  rowGap?: number;
  columnGap?: number;
  padding?: number;
  /** 결승 칸을 더 크게. */
  finalWidth?: number;
  finalHeight?: number;
  championHeight?: number;
  championGap?: number;
}

const DEFAULTS = {
  cardWidth: 208,
  cardHeight: 64,
  compactHeight: 44,
  rowGap: 10,
  columnGap: 34,
  padding: 24,
  finalWidth: 300,
  finalHeight: 128,
  championHeight: 96,
  championGap: 24,
} as const;

/** 구조가 아무리 이상해도 여기서 멈춘다 — 브라우저가 굳지 않게 하는 마지막 방어선. */
const MAX_DEPTH = 64;
const MAX_NODES = 4096;

export function layoutMirroredBracket(
  bracket: ArenaBracket | null,
  options: MirroredLayoutOptions = {},
): MirroredLayout {
  const o = { ...DEFAULTS, ...options };
  const warnings: MirroredWarning[] = [];
  const warn = (w: MirroredWarning): void => { if (!warnings.includes(w)) warnings.push(w); };

  const empty: MirroredLayout = {
    width: 0, height: 0, centerX: 0, nodes: [], connectors: [], columns: [],
    champion: null, warnings, empty: true,
  };

  if (!bracket || bracket.slots.length === 0) {
    warn('empty_bracket');
    return empty;
  }

  // ── 1. 색인 ───────────────────────────────────────────────────────────────
  const byId = new Map<string, ArenaSlot>();
  bracket.slots.forEach((s) => byId.set(s.id, s));

  const roundName = new Map<number, string>();
  bracket.rounds.forEach((r) => roundName.set(r.roundNo, r.name));

  /** 목적지 자리 → 그 자리로 모이는 공급 자리들. 저장된 position 순서를 그대로 쓴다. */
  const feedersOf = new Map<string, ArenaSlot[]>();
  bracket.slots.forEach((s) => {
    if (s.feedsSlotId === null) return;
    if (!byId.has(s.feedsSlotId)) { warn('unknown_feeds_target'); return; }  // ⚠ 고치지 않는다
    if (s.feedsSlotId === s.id) { warn('cycle_detected'); return; }          // 자기 자신 연결
    const list = feedersOf.get(s.feedsSlotId);
    if (list) list.push(s); else feedersOf.set(s.feedsSlotId, [s]);
  });
  feedersOf.forEach((list) => {
    list.sort((a, b) => (a.roundNo - b.roundNo) || (a.position - b.position));
  });

  /** 경기 ← 목적지 자리(라운드 · 번호)로만 잇는다. 그 외의 추측을 하지 않는다. */
  const matchByTarget = new Map<string, ArenaKnockoutMatch>();
  bracket.matches.forEach((m) => {
    const k = `${m.targetRoundNo}.${m.targetPosition}`;
    if (!matchByTarget.has(k)) matchByTarget.set(k, m);
  });
  const matchOf = (slot: ArenaSlot): ArenaKnockoutMatch | null =>
    matchByTarget.get(`${slot.roundNo}.${slot.position}`) ?? null;

  // ── 2. 우승 자리 찾기 ─────────────────────────────────────────────────────
  //   기준 1: rounds 의 isFinalSlot 라운드(서버가 알려 준 '우승 자리' 라운드).
  //   기준 2: 그게 없으면 다음 자리가 없는 자리(feedsSlotId = null).
  const finalRound = bracket.rounds.find((r) => r.isFinalSlot);
  const terminals = bracket.slots.filter((s) => s.feedsSlotId === null);
  let champSlot: ArenaSlot | null = null;

  if (finalRound) {
    const inFinal = bracket.slots
      .filter((s) => s.roundNo === finalRound.roundNo)
      .sort((a, b) => a.position - b.position);
    champSlot = inFinal[0] ?? null;
    if (inFinal.length > 1) warn('multiple_terminal_slots');
  } else {
    warn('no_final_slot');
    if (terminals.length > 1) warn('multiple_terminal_slots');
    // 여러 개면 가장 깊은 라운드의 가장 앞 자리 — 임의로 고르지 않도록 순서를 고정한다.
    champSlot = [...terminals]
      .sort((a, b) => (b.roundNo - a.roundNo) || (a.position - b.position))[0] ?? null;
  }

  if (!champSlot) { warn('empty_bracket'); return empty; }

  // ── 3. 칸 트리 만들기(순환 방어) ──────────────────────────────────────────
  interface Build {
    key: string;
    side: MirrorSide;
    column: number;
    targetSlot: ArenaSlot;
    feeders: ArenaSlot[];
    children: Build[];     // 더 바깥 칸들(공급 자리 중 자기 공급원이 있는 것)
    height: number;
    compact: boolean;
    y: number;
  }

  let nodeCount = 0;
  const visited = new Set<string>();

  const build = (targetSlot: ArenaSlot, side: MirrorSide, column: number, depth: number): Build | null => {
    if (depth > MAX_DEPTH) { warn('depth_limit'); return null; }
    if (nodeCount >= MAX_NODES) { warn('node_limit'); return null; }
    // 같은 자리를 두 번 지나면 순환이다. 끊고 기록만 한다(구조를 고치지 않는다).
    if (visited.has(targetSlot.id)) { warn('cycle_detected'); return null; }
    visited.add(targetSlot.id);

    const feeders = feedersOf.get(targetSlot.id) ?? [];
    if (feeders.length > 2) warn('extra_feeders');
    nodeCount += 1;

    const match = matchOf(targetSlot);
    const hasBye = feeders.some((f) => f.kind === 'bye');
    const compact = match === null && hasBye;

    const node: Build = {
      key: `n:${targetSlot.id}`,
      side,
      column,
      targetSlot,
      feeders,
      children: [],
      height: compact ? o.compactHeight : (column === 0 ? o.finalHeight : o.cardHeight),
      compact,
      y: 0,
    };

    feeders.forEach((f) => {
      if ((feedersOf.get(f.id) ?? []).length === 0) return;   // 가지의 끝 — 더 바깥 칸이 없다
      const child = build(f, side, column + 1, depth + 1);
      if (child) node.children.push(child);
    });

    return node;
  };

  // 결승 칸 = 우승 자리로 모이는 두 자리. 둘 중 앞 자리가 왼쪽, 뒤 자리가 오른쪽이다.
  const finalFeeders = feedersOf.get(champSlot.id) ?? [];
  if (finalFeeders.length === 0) warn('final_feeder_missing');
  else if (finalFeeders.length === 1) warn('final_feeder_incomplete');
  if (finalFeeders.length > 2) warn('extra_feeders');

  visited.add(champSlot.id);
  const finalMatch = matchOf(champSlot);
  const finalNode: Build = {
    key: `n:${champSlot.id}`,
    side: 'center',
    column: 0,
    targetSlot: champSlot,
    feeders: finalFeeders,
    children: [],
    height: o.finalHeight,
    compact: false,
    y: 0,
  };

  const sides: MirrorSide[] = ['left', 'right'];
  finalFeeders.slice(0, 2).forEach((f, i) => {
    if ((feedersOf.get(f.id) ?? []).length === 0) return;      // 한쪽 가지가 통째로 비어 있음
    const child = build(f, sides[i], 1, 1);
    if (child) finalNode.children.push(child);
  });
  // 결승 자리 셋 이상이 들어온 경우에도 남은 것을 버리지 않는다 — 왼쪽 가지에 이어 붙인다.
  finalFeeders.slice(2).forEach((f) => {
    if ((feedersOf.get(f.id) ?? []).length === 0) return;
    const child = build(f, 'left', 1, 1);
    if (child) finalNode.children.push(child);
  });

  // ── 4. 세로 배치 — 바깥(잎)부터 쌓고 부모는 자식들의 가운데 ───────────────
  const place = (node: Build, cursor: { y: number }): number => {
    if (node.children.length === 0) {
      node.y = cursor.y;
      cursor.y += node.height + o.rowGap;
      return node.y + node.height / 2;
    }
    const centers = node.children.map((c) => place(c, cursor));
    const mid = (Math.min(...centers) + Math.max(...centers)) / 2;
    node.y = mid - node.height / 2;
    return mid;
  };

  // 왼쪽 가지와 오른쪽 가지는 각자의 세로 흐름을 가진다(깊이가 달라도 서로를 끌어당기지 않는다).
  const leftRoots = finalNode.children.filter((c) => c.side === 'left');
  const rightRoots = finalNode.children.filter((c) => c.side === 'right');

  const leftCursor = { y: 0 };
  const leftCenters = leftRoots.map((c) => place(c, leftCursor));
  const rightCursor = { y: 0 };
  const rightCenters = rightRoots.map((c) => place(c, rightCursor));

  const avg = (xs: number[]): number | null =>
    xs.length === 0 ? null : (Math.min(...xs) + Math.max(...xs)) / 2;

  const leftMid = avg(leftCenters);
  const rightMid = avg(rightCenters);

  // 두 가지의 세로 길이가 다르면 짧은 쪽을 가운데에 맞춰 내린다(구조 보정이 아니라 보기 위치만).
  const leftHeight = leftCursor.y;
  const rightHeight = rightCursor.y;
  const bodyHeight = Math.max(leftHeight, rightHeight, o.finalHeight);
  const shiftOf = (h: number): number => (h === 0 ? 0 : (bodyHeight - h) / 2);
  const leftShift = shiftOf(leftHeight);
  const rightShift = shiftOf(rightHeight);

  const shiftTree = (node: Build, dy: number): void => {
    node.y += dy;
    node.children.forEach((c) => shiftTree(c, dy));
  };
  leftRoots.forEach((c) => shiftTree(c, leftShift));
  rightRoots.forEach((c) => shiftTree(c, rightShift));

  const finalCenter = (() => {
    const l = leftMid === null ? null : leftMid + leftShift;
    const r = rightMid === null ? null : rightMid + rightShift;
    if (l !== null && r !== null) return (l + r) / 2;
    if (l !== null) return l;
    if (r !== null) return r;
    return bodyHeight / 2;
  })();
  finalNode.y = finalCenter - finalNode.height / 2;

  // ── 5. 가로 배치 — 가운데에서 바깥으로 ────────────────────────────────────
  const flat: Build[] = [];
  const collect = (n: Build): void => { flat.push(n); n.children.forEach(collect); };
  collect(finalNode);

  const maxLeftCol = flat.filter((n) => n.side === 'left').reduce((m, n) => Math.max(m, n.column), 0);
  const maxRightCol = flat.filter((n) => n.side === 'right').reduce((m, n) => Math.max(m, n.column), 0);

  const step = o.cardWidth + o.columnGap;
  const halfFinal = o.finalWidth / 2;
  /**
   * 가운데 세로축.
   *   가장 바깥 왼쪽 칸의 왼쪽 가장자리가 정확히 padding 에 오도록 잡는다
   *   ( centerX - (halfFinal + columnGap + (maxLeftCol-1)*step) - cardWidth = padding ).
   *   ⚠ 이 값이 어긋나면 배치 상자의 한쪽에만 빈 띠가 생겨, 화면 가운데에 놓아도
   *     결승이 가운데에서 밀려 보인다.
   */
  const centerX = o.padding + maxLeftCol * step + halfFinal;

  const xOf = (side: MirrorSide, column: number): { x: number; width: number } => {
    if (side === 'center') return { x: centerX - halfFinal, width: o.finalWidth };
    const outward = halfFinal + o.columnGap + (column - 1) * step;
    return side === 'left'
      ? { x: centerX - outward - o.cardWidth, width: o.cardWidth }
      : { x: centerX + outward, width: o.cardWidth };
  };

  const nodes: MirroredNode[] = flat.map((n) => {
    const pos = xOf(n.side, n.column);
    const childKey = new Map<string, string>();
    n.children.forEach((c) => childKey.set(c.targetSlot.id, c.key));
    return {
      key: n.key,
      side: n.side,
      column: n.column,
      roundNo: n.feeders.length > 0 ? Math.min(...n.feeders.map((f) => f.roundNo)) : n.targetSlot.roundNo,
      roundName: null,       // 아래에서 채운다
      targetSlot: n.targetSlot,
      feeders: n.feeders.map((f) => ({ slot: f, fromNodeKey: childKey.get(f.id) ?? null })),
      match: matchOf(n.targetSlot),
      compact: n.compact,
      x: pos.x,
      y: n.y,
      width: pos.width,
      height: n.height,
    };
  });
  nodes.forEach((n) => { n.roundName = roundName.get(n.roundNo) ?? null; });

  // ── 6. 연결선 — 바깥 칸에서 가운데를 향해 ─────────────────────────────────
  const nodeByKey = new Map<string, MirroredNode>();
  nodes.forEach((n) => nodeByKey.set(n.key, n));

  const connectors: MirroredConnector[] = [];
  flat.forEach((parent) => {
    parent.children.forEach((child) => {
      const p = nodeByKey.get(parent.key);
      const c = nodeByKey.get(child.key);
      if (!p || !c) return;
      const cy1 = c.y + c.height / 2;
      const cy2 = p.y + p.height / 2;
      const x1 = child.side === 'left' ? c.x + c.width : c.x;            // 자식의 안쪽 가장자리
      const x2 = child.side === 'left' ? p.x : p.x + p.width;            // 부모의 바깥 가장자리
      const mid = (x1 + x2) / 2;
      connectors.push({
        fromNodeKey: c.key,
        toNodeKey: p.key,
        side: child.side,
        path: `M ${x1} ${cy1} H ${mid} V ${cy2} H ${x2}`,
      });
    });
  });

  // ── 7. 열 머리말 ──────────────────────────────────────────────────────────
  const columns: MirroredColumn[] = [];
  const seen = new Set<string>();
  nodes.forEach((n) => {
    const k = `${n.side}:${n.column}`;
    if (seen.has(k)) return;
    seen.add(k);
    const pos = xOf(n.side, n.column);
    columns.push({
      side: n.side, column: n.column, roundNo: n.roundNo, roundName: n.roundName,
      x: pos.x, width: pos.width,
    });
  });
  columns.sort((a, b) => a.x - b.x);

  // ── 8. CHAMPION — 결승이 끝나 우승 자리에 팀이 올라왔을 때만 ───────────────
  //   ⚠ 결승 전에는 decided=false 다. 승자를 예측해 채우지 않는다.
  const champion: MirroredChampion = {
    slot: champSlot,
    team: champSlot.team,
    decided: champSlot.team !== null,
    x: centerX - halfFinal,
    y: finalNode.y + finalNode.height + o.championGap,
    width: o.finalWidth,
    height: o.championHeight,
  };

  // 트리에 들어오지 못한 자리가 있으면(연결이 끊긴 구조) 기록만 한다.
  const placedSlots = new Set<string>();
  nodes.forEach((n) => {
    placedSlots.add(n.targetSlot.id);
    n.feeders.forEach((f) => placedSlots.add(f.slot.id));
  });
  if (bracket.slots.some((s) => !placedSlots.has(s.id))) warn('detached_slots');

  const right = Math.max(
    ...nodes.map((n) => n.x + n.width),
    champion.x + champion.width,
  );
  const bottom = Math.max(
    ...nodes.map((n) => n.y + n.height),
    champion.decided ? champion.y + champion.height : 0,
  );

  return {
    width: right + o.padding,
    height: bottom + o.padding,
    centerX,
    nodes,
    connectors,
    columns,
    champion,
    warnings,
    empty: nodes.length === 0,
  };
}

/** 미래 승자를 만들지 않았는지 호출 측에서 재확인할 수 있는 읽기 전용 헬퍼. */
export const isDecidedChampion = (layout: MirroredLayout): boolean =>
  layout.champion !== null && layout.champion.decided;
