// 본선 대진표 배치 계산 (Batch 4D-3) — **순수 함수만** 둔다.
//
//   ⚠⚠ 이 파일은 대진을 '결정'하지 않는다. 저장된 topology 를 좌표로 옮길 뿐이다.
//     · 시드 · BYE 위치 · 대진 조합을 만들지 않는다.
//     · '32강이면 이런 모양' 같은 형태를 가정하지 않는다(2의 거듭제곱이 아니어도 된다).
//     · 라운드 수 · 자리 수 · 연결은 전부 서버가 준 값이다.
//   ⚠ React · DOM · 서버 의존이 없다. 단독으로 검증할 수 있다.
//
//   좌표 모델
//     · 열(column) r 은 '라운드 r 의 경기'를 그린다 → 그 경기의 승자는 라운드 r+1 자리로 간다.
//       그래서 목적지 자리 S(라운드 r+1)를 가진 경기 카드는 열 r 에 놓인다.
//     · 마지막 열은 우승 자리 하나(경기가 아니라 결과 표시)다.
//     · 세로 위치는 1라운드 자리 순서에서 출발해, 위 라운드는 두 출발 자리의 중간에 놓는다.

import type {
  PublicKnockoutBracket, PublicKnockoutMatch, PublicKnockoutSlot,
} from './publicKnockoutTypes';

export interface BracketLayoutOptions {
  /** 카드 폭. 이름이 읽히는 최소 폭을 지킨다(축소 금지). */
  cardWidth?: number;
  /** 카드 높이(두 팀 + 상태 줄). */
  cardHeight?: number;
  /** 1라운드 자리 하나가 차지하는 세로 간격. */
  slotPitch?: number;
  /** 열 사이 가로 간격(연결선이 지나갈 공간). */
  columnGap?: number;
  /** 라운드 이름 머리 높이. */
  headerHeight?: number;
  /** 표면 바깥 여백. */
  padding?: number;
}

const DEFAULTS: Required<BracketLayoutOptions> = {
  cardWidth: 208,
  cardHeight: 78,
  slotPitch: 52,
  columnGap: 46,
  headerHeight: 30,
  padding: 12,
};

/** 카드 한쪽에 들어가는 참가자 한 줄. 서버가 준 표시값만 담는다. */
export interface BracketSide {
  slotKey: string;
  kind: 'team' | 'qualifier' | 'bye' | 'tbd';
  /** 주 표시 — 팀명 또는 '1조 1위' 또는 '부전승' / '승자 대기'. */
  primary: string;
  /** 보조 표시 — 반영된 자리의 출처('1조 1위'). ⚠ 주 표시를 덮어쓰지 않는다. */
  source: string | null;
  teamNo: number | null;
  teamPublicKey: string | null;
  withdrawn: boolean;
}

export interface BracketNode {
  /** 'm:r2p1'(경기) 또는 'c:r4p1'(우승). 화면 key · 하이라이트 대상. */
  key: string;
  kind: 'match' | 'champion';
  /** 이 노드가 속한 열(=라운드 번호). 우승 노드는 마지막 라운드. */
  roundNo: number;
  /** 승자가 들어갈 자리(경기 노드) 또는 우승 자리(우승 노드). */
  targetSlotKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 경기 노드만. 위/아래 참가자. */
  a: BracketSide | null;
  b: BracketSide | null;
  /** 실제 경기가 만들어졌을 때만. 없으면 아직 경기가 아니다(부전승 · 미정). */
  match: PublicKnockoutMatch | null;
  /** 한쪽이 부전승이라 경기 없이 올라가는 자리. */
  bye: boolean;
  /** 우승 노드만. */
  champion: BracketSide | null;
}

export interface BracketConnector {
  /** 출발 노드 key → 도착 노드 key. */
  from: string;
  to: string;
  /** SVG path(엘보). 카드 오른쪽 가운데 → 다음 카드 왼쪽 가운데. */
  path: string;
}

export interface BracketColumn {
  roundNo: number;
  name: string;
  x: number;
  width: number;
  /** 우승 자리 열(경기 열이 아니다). */
  isFinal: boolean;
}

export interface BracketLayout {
  width: number;
  height: number;
  columns: BracketColumn[];
  nodes: BracketNode[];
  connectors: BracketConnector[];
  /** 배치할 수 없는 구조였는가(구조가 비어 있음). 화면은 빈 상태로 처리한다. */
  empty: boolean;
}

const sideOf = (slot: PublicKnockoutSlot | undefined): BracketSide | null => {
  if (!slot) return null;
  if (slot.slotType === 'bye') {
    return { slotKey: slot.publicKey, kind: 'bye', primary: '부전승', source: null,
      teamNo: null, teamPublicKey: null, withdrawn: false };
  }
  if (slot.team) {
    return {
      slotKey: slot.publicKey,
      kind: 'team',
      primary: `${slot.team.player1Name} · ${slot.team.player2Name}`,
      // ⚠ 반영된 자리의 출처는 버리지 않는다('1조 1위' 를 보조로 남긴다).
      source: slot.sourceKind === 'group_rank' ? slot.sourceLabel : null,
      teamNo: slot.team.teamNo,
      teamPublicKey: slot.team.publicKey,
      withdrawn: slot.team.withdrawn,
    };
  }
  if (slot.slotType === 'qualifier') {
    return { slotKey: slot.publicKey, kind: 'qualifier', primary: slot.sourceLabel ?? '예선 진출', source: null,
      teamNo: null, teamPublicKey: null, withdrawn: false };
  }
  return { slotKey: slot.publicKey, kind: 'tbd', primary: '승자 대기', source: null,
    teamNo: null, teamPublicKey: null, withdrawn: false };
};

/**
 * 저장된 topology 를 좌표로 옮긴다.
 *   ⚠ 여기서 구조를 보정하거나 추측하지 않는다. 연결이 없으면 그 자리는 그냥 비어 보인다.
 */
export function layoutBracket(
  bracket: PublicKnockoutBracket | null,
  options: BracketLayoutOptions = {},
): BracketLayout {
  const o = { ...DEFAULTS, ...options };
  const empty: BracketLayout = {
    width: 0, height: 0, columns: [], nodes: [], connectors: [], empty: true,
  };
  if (!bracket || bracket.rounds.length === 0 || bracket.slots.length === 0) return empty;

  const rounds = [...bracket.rounds].sort((a, b) => a.roundNo - b.roundNo);
  const slots = [...bracket.slots].sort((a, b) => (a.roundNo - b.roundNo) || (a.position - b.position));
  const byKey = new Map<string, PublicKnockoutSlot>(slots.map((s) => [s.publicKey, s]));

  // 목적지 자리 → 그 자리로 올라오는 출발 자리들(저장된 연결 그대로).
  const feeders = new Map<string, PublicKnockoutSlot[]>();
  for (const s of slots) {
    if (!s.feedsSlotPublicKey) continue;
    const list = feeders.get(s.feedsSlotPublicKey) ?? [];
    list.push(s);
    feeders.set(s.feedsSlotPublicKey, list);
  }
  for (const list of feeders.values()) list.sort((a, b) => a.position - b.position);

  // ── 세로 위치: 1라운드는 순서대로, 위 라운드는 출발 자리들의 가운데 ──────────
  const centerY = new Map<string, number>();
  const firstRound = slots.filter((s) => s.roundNo === rounds[0].roundNo);
  firstRound.forEach((s, i) => {
    centerY.set(s.publicKey, o.padding + o.headerHeight + o.slotPitch / 2 + i * o.slotPitch);
  });
  for (const r of rounds.slice(1)) {
    const inRound = slots.filter((s) => s.roundNo === r.roundNo);
    inRound.forEach((s, i) => {
      const fs = feeders.get(s.publicKey) ?? [];
      const ys = fs.map((f) => centerY.get(f.publicKey)).filter((v): v is number => typeof v === 'number');
      // 연결이 없으면 순서대로 둔다(구조를 지어내지 않고, 보이기만 하게).
      const y = ys.length > 0
        ? ys.reduce((a, b) => a + b, 0) / ys.length
        : o.padding + o.headerHeight + o.slotPitch / 2 + i * o.slotPitch;
      centerY.set(s.publicKey, y);
    });
  }

  // ── 열 ────────────────────────────────────────────────────────────────────
  const columnX = (index: number): number => o.padding + index * (o.cardWidth + o.columnGap);
  const columns: BracketColumn[] = rounds.map((r, i) => ({
    roundNo: r.roundNo,
    name: r.name,
    x: columnX(i),
    width: o.cardWidth,
    isFinal: r.isFinalRound,
  }));

  // ── 노드 ──────────────────────────────────────────────────────────────────
  const matchByTarget = new Map<string, PublicKnockoutMatch>();
  for (const m of bracket.matches) {
    if (m.targetSlotPublicKey) matchByTarget.set(m.targetSlotPublicKey, m);
  }

  const roundIndex = new Map<number, number>(rounds.map((r, i) => [r.roundNo, i]));
  const nodes: BracketNode[] = [];

  for (const target of slots) {
    const fs = feeders.get(target.publicKey) ?? [];
    if (fs.length === 0) continue;                       // 출발 자리가 없으면 경기 카드가 아니다
    const col = roundIndex.get(target.roundNo);
    if (col === undefined || col === 0) continue;        // 목적지는 2라운드 이상이어야 한다
    const a = sideOf(fs[0]);
    const b = sideOf(fs[1]);
    const y = centerY.get(target.publicKey) ?? 0;
    nodes.push({
      key: `m:${target.publicKey}`,
      kind: 'match',
      roundNo: target.roundNo - 1,
      targetSlotKey: target.publicKey,
      x: columnX(col - 1),
      y: y - o.cardHeight / 2,
      width: o.cardWidth,
      height: o.cardHeight,
      a,
      b,
      match: matchByTarget.get(target.publicKey) ?? null,
      bye: a?.kind === 'bye' || b?.kind === 'bye',
      champion: null,
    });
  }

  // 우승 자리(마지막 라운드의 자리) — 경기가 아니라 결과 칸이다.
  const finalRound = rounds.find((r) => r.isFinalRound) ?? rounds[rounds.length - 1];
  const finalIdx = roundIndex.get(finalRound.roundNo) ?? rounds.length - 1;
  for (const s of slots.filter((x) => x.roundNo === finalRound.roundNo)) {
    const y = centerY.get(s.publicKey) ?? 0;
    nodes.push({
      key: `c:${s.publicKey}`,
      kind: 'champion',
      roundNo: finalRound.roundNo,
      targetSlotKey: s.publicKey,
      x: columnX(finalIdx),
      y: y - o.cardHeight / 2,
      width: o.cardWidth,
      height: o.cardHeight,
      a: null,
      b: null,
      match: null,
      bye: false,
      // ⚠ 우승은 서버가 우승자를 확정했을 때만 채운다(결승 진행 중 앞선 팀을 우승으로 보이지 않게).
      champion: bracket.champion && bracket.bracketStatus === 'completed' ? sideOf(s) : null,
    });
  }

  // ── 연결선 ────────────────────────────────────────────────────────────────
  const nodeByKey = new Map<string, BracketNode>(nodes.map((n) => [n.key, n]));
  const connectors: BracketConnector[] = [];
  for (const n of nodes) {
    if (n.kind !== 'match') continue;
    const target = byKey.get(n.targetSlotKey);
    if (!target) continue;
    const nextKey = target.feedsSlotPublicKey
      ? `m:${target.feedsSlotPublicKey}`
      : `c:${target.publicKey}`;
    const next = nodeByKey.get(nextKey);
    if (!next) continue;
    const x1 = n.x + n.width;
    const y1 = n.y + n.height / 2;
    const x2 = next.x;
    const y2 = next.y + next.height / 2;
    const mid = x1 + (x2 - x1) / 2;
    connectors.push({
      from: n.key,
      to: next.key,
      path: `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`,
    });
  }

  const maxRight = nodes.reduce((m, n) => Math.max(m, n.x + n.width), 0);
  const maxBottom = nodes.reduce((m, n) => Math.max(m, n.y + n.height), 0);

  return {
    width: maxRight + o.padding,
    height: maxBottom + o.padding,
    columns,
    nodes,
    connectors,
    empty: nodes.length === 0,
  };
}
