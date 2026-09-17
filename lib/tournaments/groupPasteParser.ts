// 엑셀 붙여넣기 → 예선 조편성 파서 (Batch 2B-2). **순수 함수만** 둔다.
//
//   ⚠⚠ 이 파일은 조편성을 '결정'하지 않는다. 경기이사가 이미 엑셀에서 완성한 결과를
//     읽어 들이는 것뿐이다. 팀을 임의로 조에 넣거나, 남는 팀을 어딘가에 채워 넣거나,
//     비슷한 이름을 골라 주는 동작이 없다.
//
//   ⚠ 이름 매칭은 '완전 일치'만 인정한다. contains/부분일치로 자동 확정하지 않는다.
//     후보가 2개 이상이면 AMBIGUOUS, 0개면 UNMATCHED 로 두고 운영자가 직접 고른다.
//
//   ⚠ DB 접근·React 의존이 없다. 그래서 fixture 로 단독 검증할 수 있다.

export type GroupKind = 'preliminary' | 'placement';

/** 매칭 대상 팀(= hosted_tournament_teams 스냅샷 일부). PII 없음. */
export interface MatchableTeam {
  teamId: string;
  teamNo: number;
  player1Name: string;
  player2Name: string;
  teamStatus: 'active' | 'withdrawn';
}

export type RowStatus = 'matched' | 'ambiguous' | 'unmatched';

export interface ParsedRow {
  lineNo: number;
  raw: string;
  /** 붙여넣기에 적힌 조 표기 원문. */
  groupLabel: string;
  groupNo: number | null;   // placement 는 null
  kind: GroupKind;
  /** 숫자 셀로 들어온 팀 번호(있으면 1순위 식별자). */
  teamNoToken: number | null;
  /** 이름 셀(정규화 전 원문). */
  names: string[];
}

export interface MatchedRow extends ParsedRow {
  status: RowStatus;
  teamId: string | null;
  teamNo: number | null;
  /** AMBIGUOUS 일 때 운영자가 고를 후보. */
  candidates: MatchableTeam[];
  /** 왜 이 상태인지 한 줄. */
  note: string;
}

export interface ParseError {
  lineNo: number;
  raw: string;
  code: 'unknown_group_label' | 'no_group_context' | 'no_team_info';
}

export interface PreviewGroup {
  key: string;
  groupNo: number | null;
  kind: GroupKind;
  expectedSize: number;
  rows: MatchedRow[];
}

export interface PreviewBlocker {
  code:
    | 'parse_error' | 'unmatched' | 'ambiguous' | 'duplicate_team'
    | 'group_size_mismatch' | 'placement_size_mismatch' | 'multiple_placement'
    | 'withdrawn_team' | 'missing_active_teams' | 'no_rows';
  /** 화면에 그대로 보여줄 상세(팀 번호·조 번호 등 운영 식별자만). */
  detail: string[];
}

/** 서버 bulk RPC 에 넘길 최종 payload. 차단 조건이 하나라도 있으면 만들지 않는다. */
export interface BulkAssignmentGroup {
  groupNo: number | null;   // placement 는 null → 서버가 번호를 정한다
  groupType: GroupKind;
  teamIds: string[];
}

export interface PastePreview {
  groups: PreviewGroup[];
  errors: ParseError[];
  summary: {
    inputRows: number;
    matched: number;
    unmatched: number;
    ambiguous: number;
    duplicates: number;
    preliminaryGroups: number;
    placementGroups: number;
    missingActiveTeams: number;
  };
  blockers: PreviewBlocker[];
  canApply: boolean;
  payload: BulkAssignmentGroup[] | null;
}

const PRELIMINARY_SIZE = 3;
const PLACEMENT_SIZE = 2;

/** 순위결정전로 인정하는 표기. ⚠ 모호한 문자열을 추론하지 않는다 — 이 목록이 전부다. */
const PLACEMENT_ALIASES = ['순위결정전', '순위결정', 'placement'];

/** 이름 정규화: 앞뒤 공백 제거 + 내부 공백 1칸 + 유니코드 정규화 + 라틴 소문자. */
export function normalizeName(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 두 선수 이름을 순서와 무관한 키로. (김민수/이정훈 == 이정훈/김민수) */
export function pairKey(a: string, b: string): string {
  return [normalizeName(a), normalizeName(b)].sort().join('|');
}

/** 한 줄을 셀로 나눈다. TAB 우선, 없으면 2칸 이상 공백. */
function splitCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t');
  if (/ {2,}/.test(line)) return line.split(/ {2,}/);
  return [line];
}

/** 조 표기 해석. 숫자 조만 인정한다(문자 조 라벨은 지원하지 않는다). */
function parseGroupLabel(raw: string): { groupNo: number | null; kind: GroupKind } | null {
  const s = raw.normalize('NFC').replace(/\s+/g, '').trim();
  if (s === '') return null;
  if (PLACEMENT_ALIASES.includes(s.toLowerCase())) return { groupNo: null, kind: 'placement' };
  // '1조' / '1' / '조1'
  const m = /^(?:조)?(\d{1,2})(?:조)?$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1) return { groupNo: n, kind: 'preliminary' };
  }
  return null;
}

/** 이름 셀을 개별 이름으로. '김민수/이정훈' 같은 한 칸 표기를 풀어 준다. */
function splitNames(cells: string[]): string[] {
  const out: string[] = [];
  cells.forEach((c) => {
    c.split(/[/·,]/).forEach((n) => {
      const t = n.trim();
      if (t !== '') out.push(t);
    });
  });
  return out;
}

/**
 * 붙여넣기 텍스트 → 행 목록.
 *   · 첫 셀이 비어 있으면 직전 조를 이어받는다(Excel 병합 복사 형태).
 *   · 조 표기만 있고 팀 정보가 없는 줄은 '조 헤더'로 보고 행을 만들지 않는다.
 */
export function parseGroupPaste(text: string): { rows: ParsedRow[]; errors: ParseError[] } {
  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];
  let carry: { groupNo: number | null; kind: GroupKind; label: string } | null = null;

  text.split(/\r?\n/).forEach((line, idx) => {
    const lineNo = idx + 1;
    if (line.trim() === '') return;

    const cells = splitCells(line);
    const first = (cells[0] ?? '').trim();
    let rest = cells.slice(1).map((c) => c.trim()).filter((c) => c !== '');

    let ctx = carry;
    if (first !== '') {
      const g = parseGroupLabel(first);
      if (!g) {
        // 조 표기가 아니면서 앞 칸이 채워져 있다 → 헤더 행이거나 오타.
        errors.push({ lineNo, raw: line, code: 'unknown_group_label' });
        return;
      }
      ctx = { groupNo: g.groupNo, kind: g.kind, label: first };
      carry = ctx;
    } else if (rest.length === 0) {
      return; // 완전 빈 행
    }

    if (!ctx) {
      errors.push({ lineNo, raw: line, code: 'no_group_context' });
      return;
    }
    // 조 표기만 있는 줄 = 헤더. 다음 줄부터 carry 로 이어진다.
    if (rest.length === 0) return;

    // 첫 셀이 순수 숫자면 팀 번호로 본다(1순위 식별자).
    let teamNoToken: number | null = null;
    if (/^\d{1,3}$/.test(rest[0])) {
      teamNoToken = Number(rest[0]);
      rest = rest.slice(1);
    }
    const names = splitNames(rest);

    if (teamNoToken === null && names.length === 0) {
      errors.push({ lineNo, raw: line, code: 'no_team_info' });
      return;
    }

    rows.push({
      lineNo, raw: line,
      groupLabel: ctx.label, groupNo: ctx.groupNo, kind: ctx.kind,
      teamNoToken, names,
    });
  });

  return { rows, errors };
}

/**
 * 행 → 팀 매칭.
 *   1순위 team_no 완전 일치 · 2순위 선수 2명 이름 완전 일치(순서 무관).
 *   ⚠ 부분일치 없음. 후보가 여럿이면 ambiguous 로 남긴다.
 */
export function matchRows(rows: ParsedRow[], teams: MatchableTeam[]): MatchedRow[] {
  const byNo = new Map<number, MatchableTeam>();
  const byPair = new Map<string, MatchableTeam[]>();
  teams.forEach((t) => {
    byNo.set(t.teamNo, t);
    const k = pairKey(t.player1Name, t.player2Name);
    const arr = byPair.get(k);
    if (arr) arr.push(t); else byPair.set(k, [t]);
  });

  return rows.map((r) => {
    const base = { ...r, candidates: [] as MatchableTeam[] };

    if (r.teamNoToken !== null) {
      const t = byNo.get(r.teamNoToken);
      if (t) {
        return { ...base, status: 'matched' as const, teamId: t.teamId, teamNo: t.teamNo,
                 note: `팀 번호 ${t.teamNo} 일치` };
      }
      return { ...base, status: 'unmatched' as const, teamId: null, teamNo: null,
               note: `${r.teamNoToken}번 팀이 없습니다` };
    }

    if (r.names.length < 2) {
      return { ...base, status: 'unmatched' as const, teamId: null, teamNo: null,
               note: '선수 2명이 필요합니다' };
    }
    if (r.names.length > 2) {
      return { ...base, status: 'unmatched' as const, teamId: null, teamNo: null,
               note: '선수가 3명 이상으로 읽혔습니다' };
    }

    const hits = byPair.get(pairKey(r.names[0], r.names[1])) ?? [];
    if (hits.length === 1) {
      return { ...base, status: 'matched' as const, teamId: hits[0].teamId, teamNo: hits[0].teamNo,
               note: '선수 이름 일치' };
    }
    if (hits.length > 1) {
      return { ...base, status: 'ambiguous' as const, teamId: null, teamNo: null,
               candidates: hits, note: `같은 이름 조합이 ${hits.length}팀 있습니다` };
    }
    return { ...base, status: 'unmatched' as const, teamId: null, teamNo: null,
             note: '일치하는 팀을 찾지 못했습니다' };
  });
}

/**
 * 미리보기 + 적용 가능 여부 판정.
 *   ⚠ 문제를 '표시'만 한다. 자동으로 고치거나 팀을 채워 넣지 않는다.
 *   ⚠ 하나라도 막히면 payload 를 만들지 않는다 — 부분 저장은 허용하지 않는다.
 */
export function buildPastePreview(text: string, teams: MatchableTeam[]): PastePreview {
  const { rows, errors } = parseGroupPaste(text);
  const matched = matchRows(rows, teams);

  // 조별 묶기 — 등장 순서를 유지하되 preliminary 는 조 번호 오름차순으로 정렬한다.
  const map = new Map<string, PreviewGroup>();
  matched.forEach((r) => {
    const key = r.kind === 'placement' ? 'placement' : `g${r.groupNo}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key, groupNo: r.groupNo, kind: r.kind,
        expectedSize: r.kind === 'placement' ? PLACEMENT_SIZE : PRELIMINARY_SIZE,
        rows: [],
      };
      map.set(key, g);
    }
    g.rows.push(r);
  });

  const groups = [...map.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'placement' ? 1 : -1;
    return (a.groupNo ?? 0) - (b.groupNo ?? 0);
  });

  // ── 집계 ──────────────────────────────────────────────────────────────────
  const unmatched = matched.filter((r) => r.status === 'unmatched');
  const ambiguous = matched.filter((r) => r.status === 'ambiguous');

  const seen = new Map<string, number>();
  matched.forEach((r) => {
    if (r.teamId) seen.set(r.teamId, (seen.get(r.teamId) ?? 0) + 1);
  });
  const dupTeams = [...seen.entries()].filter(([, n]) => n > 1)
    .map(([id]) => teams.find((t) => t.teamId === id))
    .filter((t): t is MatchableTeam => !!t);

  const activeTeams = teams.filter((t) => t.teamStatus === 'active');
  const usedIds = new Set(matched.filter((r) => r.teamId).map((r) => r.teamId as string));
  const missing = activeTeams.filter((t) => !usedIds.has(t.teamId));
  const withdrawnUsed = matched
    .filter((r) => r.teamId && teams.find((t) => t.teamId === r.teamId)?.teamStatus === 'withdrawn')
    .map((r) => r.teamNo as number);

  const prelimGroups = groups.filter((g) => g.kind === 'preliminary');
  const placeGroups = groups.filter((g) => g.kind === 'placement');
  const badSize = prelimGroups.filter((g) => g.rows.length !== PRELIMINARY_SIZE);
  const badPlacement = placeGroups.filter((g) => g.rows.length !== PLACEMENT_SIZE);

  // ── 차단 조건 ─────────────────────────────────────────────────────────────
  const blockers: PreviewBlocker[] = [];
  const push = (code: PreviewBlocker['code'], detail: string[]) => {
    if (detail.length > 0 || code === 'no_rows') blockers.push({ code, detail });
  };

  if (matched.length === 0) push('no_rows', []);
  push('parse_error', errors.map((e) => `${e.lineNo}행: ${
    e.code === 'unknown_group_label' ? '조 표기를 알 수 없습니다'
      : e.code === 'no_group_context' ? '조 표기 없이 시작했습니다'
      : '팀 정보가 없습니다'} — ${e.raw.trim().slice(0, 40)}`));
  push('unmatched', unmatched.map((r) => `${r.lineNo}행 (${r.groupLabel}) — ${r.note}`));
  push('ambiguous', ambiguous.map((r) => `${r.lineNo}행 (${r.groupLabel}) — ${r.note}`));
  push('duplicate_team', dupTeams.map((t) => `${t.teamNo}번 팀이 여러 번 나옵니다`));
  push('group_size_mismatch', badSize.map((g) => `${g.groupNo}조 — ${g.rows.length} / ${PRELIMINARY_SIZE}`));
  push('placement_size_mismatch', badPlacement.map((g) => `순위결정전 — ${g.rows.length} / ${PLACEMENT_SIZE}`));
  if (placeGroups.length > 1) push('multiple_placement', [`순위결정전이 ${placeGroups.length}개입니다`]);
  push('withdrawn_team', withdrawnUsed.map((n) => `${n}번 팀은 기권 상태입니다`));
  push('missing_active_teams', missing.map((t) => `${t.teamNo}번 팀이 입력에 없습니다`));

  const canApply = blockers.length === 0;

  return {
    groups,
    errors,
    summary: {
      inputRows: matched.length,
      matched: matched.filter((r) => r.status === 'matched').length,
      unmatched: unmatched.length,
      ambiguous: ambiguous.length,
      duplicates: dupTeams.length,
      preliminaryGroups: prelimGroups.length,
      placementGroups: placeGroups.length,
      missingActiveTeams: missing.length,
    },
    blockers,
    canApply,
    payload: canApply
      ? groups.map((g) => ({
          groupNo: g.kind === 'placement' ? null : g.groupNo,
          groupType: g.kind,
          teamIds: g.rows.map((r) => r.teamId as string),
        }))
      : null,
  };
}

/** 차단 코드 → 운영자용 제목. */
export const PASTE_BLOCKER_LABEL: Record<PreviewBlocker['code'], string> = {
  no_rows: '읽어 들인 행이 없습니다.',
  parse_error: '읽을 수 없는 행이 있습니다.',
  unmatched: '매칭되지 않은 행이 있습니다.',
  ambiguous: '어느 팀인지 확정할 수 없는 행이 있습니다.',
  duplicate_team: '같은 팀이 두 번 이상 들어갔습니다.',
  group_size_mismatch: '인원이 3팀이 아닌 조가 있습니다.',
  placement_size_mismatch: '순위결정전 인원이 2팀이 아닙니다.',
  multiple_placement: '순위결정전 조가 두 개 이상입니다.',
  withdrawn_team: '기권 팀이 포함돼 있습니다.',
  missing_active_teams: '입력에서 빠진 참가팀이 있습니다.',
};
