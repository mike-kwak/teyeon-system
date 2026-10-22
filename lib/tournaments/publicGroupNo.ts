// 참가자에게 보이는 조 번호(표시 전용) — 내부 group_no · group_type 과 분리한다. 순수 함수.
//
//   ⚠ 표시 전용이다. DB 의 group_no(예: 19) · group_type = 'placement' · 경기 수 · 진출 규칙은 그대로다.
//     저장 · 조회 · 링크(/draw/placement, /groups/{group_no}) · 운영 진단에는 내부 번호를 쓴다.
//   규칙(번호를 하드코딩하지 않고 일반 조 번호에서만 정한다):
//     · 일반 조가 2 ~ N + 1 로 빈틈없이 이어지고 1조가 비어 있으면 → 순위결정전(첫 번째)은 '1조'   (TEYEON OPEN 2026: 2 ~ 18조 → 1조)
//     · 일반 조가 1 ~ N 으로 빈틈없이 이어지면 → 순위결정전은 'N + 1조'
//     · 그 밖(중간이 비는 등) → 번호 없이 '순위결정전'(null) — 실제 조 번호와 겹칠 수 있는 번호는 만들지 않는다.

export type PlacementSlot = 'lead' | 'tail';

/** 순위결정전 표시 번호와 위치(lead = 1조로 맨 앞, tail = N + 1조로 맨 뒤). 번호를 정할 수 없으면 null. */
export function placementPublicSlot(groupNos: number[], index = 0): { no: number; at: PlacementSlot } | null {
  const sorted = [...new Set(groupNos)].sort((a, b) => a - b);
  if (sorted.length !== groupNos.length) return null;
  if (sorted.length > 0 && sorted.every((n, i) => n === i + 2)) return index === 0 ? { no: 1, at: 'lead' } : null;
  if (sorted.every((n, i) => n === i + 1)) return { no: sorted.length + index + 1, at: 'tail' };
  return null;
}

/** 순위결정전 표시 번호(없으면 null — 화면은 '순위결정전' 으로 쓴다). */
export const placementPublicNo = (groupNos: number[], index = 0): number | null =>
  placementPublicSlot(groupNos, index)?.no ?? null;

export const PLACEMENT_NAME = '순위결정전';

/** 순위결정전 조 라벨 — 번호가 있으면 'N조', 없으면 '순위결정전'. ⚠ 내부 group_no 는 어떤 경우에도 쓰지 않는다. */
export const placementPublicLabel = (no: number | null): string => (no === null ? PLACEMENT_NAME : `${no}조`);
