// Arena 조 순위 벽 — 격자 선택 (Batch 4E-2). **순수 함수만** 둔다.
//
//   조 개수에 따라 열·행을 고른다. 20칸을 고정해 두고 빈칸을 남기지 않는다.
//   ⚠ if (n === 20) 같은 하드코딩을 하지 않는다 — 개수와 보드 비율로 결정한다.
//   ⚠ React · DOM 의존이 없다. 단독으로 검증할 수 있다.
//
//   고르는 기준(작을수록 좋음)
//     1) 빈칸 — 20조를 6열로 두면 4칸이 비는데, 그건 벽이 아니라 격자 구멍처럼 보인다.
//     2) 칸 모양 — 팀 이름이 한 줄에 들어가려면 가로가 세로보다 넉넉해야 한다.
//     3) 너무 낮은 칸 — 조 머리말 + 세 팀 줄이 안 들어가는 높이는 아예 후보에서 뺀다.

export interface GroupGridInput {
  /** 조 개수. */
  count: number;
  /** 벽이 쓸 수 있는 영역(안쪽 여백을 뺀 값). */
  width: number;
  height: number;
  gap?: number;
  /** 조 하나가 필요로 하는 최소 크기. */
  minCellWidth?: number;
  minCellHeight?: number;
  /** 칸의 이상적인 가로/세로 비. 팀 이름 한 줄이 들어가는 쪽으로 약간 납작하게. */
  targetAspect?: number;
  /** 열 후보 상한. */
  maxColumns?: number;
}

export interface GroupGrid {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  /** 마지막 줄에 남는 빈 칸 수. */
  emptyCells: number;
}

const DEFAULTS = {
  gap: 14,
  minCellWidth: 230,
  minCellHeight: 112,
  targetAspect: 1.9,
  maxColumns: 8,
};

const sizeOf = (total: number, n: number, gap: number): number => (total - gap * (n - 1)) / n;

/**
 * 조 개수와 영역에 맞는 격자.
 *   조가 없으면 0×0 을 돌려준다(호출 측이 '아직 조가 없다'를 따로 보여 준다).
 */
export function chooseGroupGrid(input: GroupGridInput): GroupGrid {
  const o = { ...DEFAULTS, ...input };
  const { count, width, height } = o;

  if (count <= 0 || width <= 0 || height <= 0) {
    return { columns: 0, rows: 0, cellWidth: 0, cellHeight: 0, emptyCells: 0 };
  }

  interface Candidate extends GroupGrid { score: number }
  const all: Candidate[] = [];
  const fitting: Candidate[] = [];

  for (let columns = 1; columns <= Math.min(o.maxColumns, count); columns += 1) {
    const rows = Math.ceil(count / columns);
    const cellWidth = sizeOf(width, columns, o.gap);
    const cellHeight = sizeOf(height, rows, o.gap);
    if (cellWidth <= 0 || cellHeight <= 0) continue;

    const emptyCells = columns * rows - count;
    const aspect = cellWidth / cellHeight;
    // 비율 차이는 배수로 본다(2배 넓은 것과 2배 좁은 것을 같은 크기의 벌점으로).
    const aspectPenalty = Math.abs(Math.log(aspect / o.targetAspect));
    const score = emptyCells * 0.6 + aspectPenalty;

    const c: Candidate = { columns, rows, cellWidth, cellHeight, emptyCells, score };
    all.push(c);
    if (cellWidth >= o.minCellWidth && cellHeight >= o.minCellHeight) fitting.push(c);
  }

  // 최소 크기를 만족하는 후보가 하나도 없으면(아주 좁은 화면) 전체 후보에서 고른다.
  // ⚠ 비어 있는 격자를 돌려주지 않는다 — 조는 어떻게든 모두 보여야 한다.
  const pool = fitting.length > 0 ? fitting : all;
  if (pool.length === 0) {
    return { columns: count, rows: 1, cellWidth: width, cellHeight: height, emptyCells: 0 };
  }

  // 점수가 같으면 열이 적은 쪽(칸이 큰 쪽)을 쓴다 — 결과가 항상 같아야 한다.
  pool.sort((a, b) => (a.score - b.score) || (a.columns - b.columns));
  const best = pool[0];
  return {
    columns: best.columns, rows: best.rows,
    cellWidth: best.cellWidth, cellHeight: best.cellHeight,
    emptyCells: best.emptyCells,
  };
}
