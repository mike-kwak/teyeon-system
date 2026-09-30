// 본선 대진표 검색 · 진출 경로 추적 (Batch 4D-4) — **순수 함수만** 둔다.
//
//   ⚠⚠ 여기서 대진을 해석하거나 승자를 예측하지 않는다.
//     · 검색은 이미 받은 공개 payload 안에서만 한다(추가 조회 없음).
//     · '경로'는 저장된 연결(feeds)을 따라간 **자리의 길**이지, 그 팀이 이긴다는 뜻이 아니다.
//   ⚠ React · DOM 의존이 없다. 단독으로 검증할 수 있다.

import type { BracketLayout, BracketSide } from './layoutBracket';
import type { PublicKnockoutBracket } from './publicKnockoutTypes';

export interface BracketSearchResult {
  /** 이동 대상 카드(layout node key). */
  nodeKey: string;
  /** 검색에 걸린 자리(공개 키). */
  slotKey: string;
  /** 주 표시 — 팀명 또는 'N조 M위'. */
  title: string;
  /** 보조 — 반영된 자리의 출처. */
  subtitle: string | null;
  roundName: string;
  /** 경기가 아직 없으면 null. */
  matchNo: number | null;
  /** 사람이 읽는 상태 문구. */
  statusText: string;
}

const norm = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

const sideText = (side: BracketSide): string[] => {
  const out = [side.primary];
  if (side.source) out.push(side.source);
  if (side.teamNo != null) out.push(String(side.teamNo));
  return out;
};

const statusTextOf = (nodeMatchStatus: string | null, bye: boolean): string => {
  if (bye) return '부전승 진출';
  switch (nodeMatchStatus) {
    case 'playing':   return '경기 중';
    case 'calling':   return '호출 중';
    case 'completed': return '종료';
    case 'waiting':   return '대기';
    default:          return '경기 전';
  }
};

/**
 * 팀 · 선수 · 팀번호 · 'N조 M위' 로 찾는다(부분 일치 · 공백/대소문자 무시).
 *   ⚠ 빈 검색어면 아무 것도 돌려주지 않는다(전체 목록을 펼치지 않는다).
 */
export function searchBracket(
  bracket: PublicKnockoutBracket | null,
  layout: BracketLayout,
  query: string,
): BracketSearchResult[] {
  const q = norm(query || '');
  if (!bracket || q.length === 0 || layout.empty) return [];

  const roundName = new Map<number, string>(layout.columns.map((c) => [c.roundNo, c.name]));
  const out: BracketSearchResult[] = [];
  const seen = new Set<string>();

  for (const node of layout.nodes) {
    if (node.kind !== 'match') continue;
    const sides: [BracketSide | null, BracketSide | null] = [node.a, node.b];
    for (const side of sides) {
      if (!side) continue;
      if (side.kind === 'bye' || side.kind === 'tbd') continue;   // 찾을 대상이 아니다
      const hit = sideText(side).some((t) => norm(t).includes(q));
      if (!hit) continue;
      const key = `${node.key}:${side.slotKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        nodeKey: node.key,
        slotKey: side.slotKey,
        title: side.teamNo != null ? `${side.teamNo}. ${side.primary}` : side.primary,
        subtitle: side.source,
        roundName: roundName.get(node.roundNo) ?? `${node.roundNo}라운드`,
        matchNo: node.match ? node.match.matchNo : null,
        statusText: statusTextOf(node.match ? node.match.status : null, node.bye),
      });
    }
  }

  // 앞 라운드 → 뒤 라운드, 같은 라운드면 위에서 아래로.
  return out.sort((a, b) => {
    const na = layout.nodes.find((n) => n.key === a.nodeKey);
    const nb = layout.nodes.find((n) => n.key === b.nodeKey);
    return (na && nb) ? (na.roundNo - nb.roundNo) || (na.y - nb.y) : 0;
  });
}

export interface BracketPath {
  /** 강조할 카드 key. */
  nodes: Set<string>;
  /** 강조할 연결선 key(`from->to`). */
  connectors: Set<string>;
}

/**
 * 한 카드에서 이어지는 **대진 경로**(자리의 길)를 따라간다.
 *   ⚠ 이 팀이 진출한다는 뜻이 아니다. 저장된 연결을 그대로 따라갈 뿐이다.
 *   ⚠ 순환이 있어도 멈추도록 방문한 노드를 기억한다(구조 이상에서도 무한 루프 없음).
 */
export function downstreamPath(layout: BracketLayout, nodeKey: string): BracketPath {
  const nodes = new Set<string>();
  const connectors = new Set<string>();
  if (!nodeKey || layout.empty) return { nodes, connectors };

  const byFrom = new Map<string, string[]>();
  for (const c of layout.connectors) {
    const list = byFrom.get(c.from) ?? [];
    list.push(c.to);
    byFrom.set(c.from, list);
  }

  const queue: string[] = [nodeKey];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    if (nodes.has(cur)) continue;
    nodes.add(cur);
    for (const next of byFrom.get(cur) ?? []) {
      connectors.add(`${cur}->${next}`);
      if (!nodes.has(next)) queue.push(next);
    }
  }
  return { nodes, connectors };
}
