// 붙여넣기 → 본선 1라운드 배치 파서 (Batch 4B). **순수 함수만** 둔다.
//
//   ⚠⚠ 이 파일은 배치를 '결정'하지 않는다. 경기이사가 이미 정한 자리표를 읽어 들이는 것뿐이다.
//     · 빈 자리를 BYE 로 자동으로 채우지 않는다.
//     · 남는 팀을 아무 자리에나 넣지 않는다.
//     · 비슷한 이름을 골라 주지 않는다(완전 일치만 인정, 후보 2개 이상이면 AMBIGUOUS).
//   ⚠ DB · React 의존이 없다. 단독으로 검증할 수 있다.
//
//   입력 예 (구분자는 | , 탭, 쉼표 모두 허용):
//     1 | 김OO/박OO
//     2 | BYE
//     3 | 이OO · 최OO
//     4 |            ← 빈 자리(TBD)

export interface BracketMatchableTeam {
  teamId: string;
  teamNo: number;
  player1Name: string;
  player2Name: string;
  /** 진출팀으로 확정된 팀만 배치할 수 있다. */
  isEntrant: boolean;
  teamStatus: 'active' | 'withdrawn';
}

export type BracketRowKind = 'team' | 'bye' | 'tbd';
export type BracketRowStatus = 'matched' | 'ambiguous' | 'unmatched' | 'invalid';

export interface BracketParsedRow {
  lineNo: number;
  raw: string;
  position: number | null;
  kind: BracketRowKind;
  /** 숫자 셀로 들어온 팀 번호(있으면 1순위 식별자). */
  teamNoToken: number | null;
  /** 이름 셀 원문(정규화 전). */
  nameToken: string;
  status: BracketRowStatus;
  teamId: string | null;
  teamNo: number | null;
  candidates: BracketMatchableTeam[];
  /** 왜 이 상태인지 한 줄. */
  note: string;
}

export interface BracketPasteBlocker {
  code:
    | 'no_rows' | 'invalid_row' | 'unmatched' | 'ambiguous' | 'duplicate_position'
    | 'duplicate_team' | 'unknown_position' | 'missing_position' | 'not_entrant'
    | 'withdrawn_team';
  detail: string[];
}

export interface BracketPastePreview {
  rows: BracketParsedRow[];
  blockers: BracketPasteBlocker[];
  /** 저장 가능 여부(= blocker 0). */
  canApply: boolean;
  counts: { team: number; bye: number; tbd: number };
  /** 서버로 보낼 payload. canApply 일 때만 채운다. */
  payload: { position: number; type: BracketRowKind; teamId?: string | null }[] | null;
}

const BYE_TOKENS = ['bye', 'BYE', '부전승', '부전', '바이'];

/** 이름 비교용 정규화 — 공백/구분자 제거, 소문자. ⚠ 여기서 유사도 판단을 하지 않는다. */
const normalizeName = (s: string): string =>
  s.replace(/[\s·・/,\-_]/g, '').toLowerCase();

const teamKeys = (t: BracketMatchableTeam): string[] => {
  const a = normalizeName(t.player1Name);
  const b = normalizeName(t.player2Name);
  return [a + b, b + a];
};

const splitCells = (line: string): string[] =>
  line.split(/[|\t,]/).map((c) => c.trim()).filter((c, i, all) => !(c === '' && i === all.length - 1));

/**
 * 붙여넣기 텍스트를 1라운드 배치 미리보기로 바꾼다.
 *   firstRoundPositions = 현재 구조의 1라운드 자리 번호 전체(서버 구조 기준).
 */
export function parseBracketPaste(
  text: string,
  teams: BracketMatchableTeam[],
  firstRoundPositions: number[],
): BracketPastePreview {
  const rows: BracketParsedRow[] = [];
  const lines = (text || '').split(/\r?\n/);

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === '') return;
    const lineNo = i + 1;
    const cells = splitCells(line);
    const posToken = cells[0] ?? '';
    const position = /^\d+$/.test(posToken) ? Number(posToken) : null;
    const rest = cells.slice(1);
    const nameToken = rest.join(' ').trim();

    const base: BracketParsedRow = {
      lineNo, raw: line, position, kind: 'tbd', teamNoToken: null, nameToken,
      status: 'matched', teamId: null, teamNo: null, candidates: [], note: '',
    };

    if (position === null) {
      rows.push({ ...base, status: 'invalid', note: '자리 번호를 첫 칸에 숫자로 적어 주세요.' });
      return;
    }
    if (nameToken === '') {
      rows.push({ ...base, kind: 'tbd', note: '빈 자리(미정)로 둡니다.' });
      return;
    }
    if (BYE_TOKENS.some((b) => nameToken.toLowerCase() === b.toLowerCase())) {
      rows.push({ ...base, kind: 'bye', note: '부전승 자리입니다.' });
      return;
    }

    // 팀 번호로 직접 지정한 경우(예: "3 | 12")
    if (/^\d+$/.test(nameToken)) {
      const teamNo = Number(nameToken);
      const hit = teams.find((t) => t.teamNo === teamNo);
      if (!hit) {
        rows.push({ ...base, kind: 'team', teamNoToken: teamNo, status: 'unmatched',
          note: `팀 번호 ${teamNo} 을(를) 찾을 수 없습니다.` });
        return;
      }
      rows.push({ ...base, kind: 'team', teamNoToken: teamNo, status: 'matched',
        teamId: hit.teamId, teamNo: hit.teamNo, note: '' });
      return;
    }

    // 이름 완전 일치(순서 무관)
    const key = normalizeName(nameToken);
    const hits = teams.filter((t) => teamKeys(t).includes(key));
    if (hits.length === 1) {
      rows.push({ ...base, kind: 'team', status: 'matched',
        teamId: hits[0].teamId, teamNo: hits[0].teamNo, note: '' });
      return;
    }
    if (hits.length > 1) {
      rows.push({ ...base, kind: 'team', status: 'ambiguous', candidates: hits,
        note: '같은 이름의 팀이 여러 개입니다. 직접 골라 주세요.' });
      return;
    }
    rows.push({ ...base, kind: 'team', status: 'unmatched', candidates: [],
      note: '이름이 정확히 일치하는 팀이 없습니다.' });
  });

  // ── blocker 집계 ────────────────────────────────────────────────────────
  const blockers: BracketPasteBlocker[] = [];
  const push = (code: BracketPasteBlocker['code'], detail: string[]) => {
    if (detail.length > 0) blockers.push({ code, detail });
  };

  if (rows.length === 0) {
    blockers.push({ code: 'no_rows', detail: ['읽을 줄이 없습니다.'] });
  }

  push('invalid_row', rows.filter((r) => r.status === 'invalid').map((r) => `${r.lineNo}번째 줄: ${r.raw}`));
  push('unmatched', rows.filter((r) => r.status === 'unmatched').map((r) => `자리 ${r.position ?? '?'}: ${r.nameToken}`));
  push('ambiguous', rows.filter((r) => r.status === 'ambiguous').map((r) => `자리 ${r.position ?? '?'}: ${r.nameToken}`));

  const posSeen = new Map<number, number>();
  rows.forEach((r) => {
    if (r.position === null) return;
    posSeen.set(r.position, (posSeen.get(r.position) ?? 0) + 1);
  });
  push('duplicate_position', [...posSeen.entries()].filter(([, c]) => c > 1).map(([p]) => `자리 ${p}`));

  const teamSeen = new Map<string, { teamNo: number; count: number }>();
  rows.forEach((r) => {
    if (!r.teamId) return;
    const cur = teamSeen.get(r.teamId);
    teamSeen.set(r.teamId, { teamNo: r.teamNo ?? 0, count: (cur?.count ?? 0) + 1 });
  });
  push('duplicate_team', [...teamSeen.values()].filter((v) => v.count > 1).map((v) => `${v.teamNo}번 팀`));

  const allowed = new Set(firstRoundPositions);
  push('unknown_position', rows
    .filter((r) => r.position !== null && !allowed.has(r.position))
    .map((r) => `자리 ${r.position}`));
  push('missing_position', firstRoundPositions
    .filter((p) => !posSeen.has(p))
    .map((p) => `자리 ${p}`));

  const entrantById = new Map(teams.map((t) => [t.teamId, t]));
  push('not_entrant', rows
    .filter((r) => r.teamId && entrantById.get(r.teamId)?.isEntrant === false)
    .map((r) => `${r.teamNo}번 팀`));
  push('withdrawn_team', rows
    .filter((r) => r.teamId && entrantById.get(r.teamId)?.teamStatus === 'withdrawn')
    .map((r) => `${r.teamNo}번 팀`));

  const counts = {
    team: rows.filter((r) => r.kind === 'team' && r.status === 'matched').length,
    bye: rows.filter((r) => r.kind === 'bye').length,
    tbd: rows.filter((r) => r.kind === 'tbd').length,
  };

  const canApply = blockers.length === 0;

  return {
    rows,
    blockers,
    canApply,
    counts,
    payload: canApply
      ? rows
          .filter((r) => r.position !== null)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((r) => ({
            position: r.position as number,
            type: r.kind,
            teamId: r.kind === 'team' ? r.teamId : null,
          }))
      : null,
  };
}

export const BRACKET_PASTE_BLOCKER_TEXT: Record<BracketPasteBlocker['code'], string> = {
  no_rows: '읽을 내용이 없습니다.',
  invalid_row: '자리 번호를 읽을 수 없는 줄이 있습니다.',
  unmatched: '이름이 일치하는 팀을 찾지 못했습니다.',
  ambiguous: '같은 이름의 팀이 여러 개라 자동으로 고르지 않았습니다.',
  duplicate_position: '같은 자리 번호가 두 번 나옵니다.',
  duplicate_team: '같은 팀이 두 자리에 들어 있습니다.',
  unknown_position: '현재 구조에 없는 자리 번호입니다.',
  missing_position: '빠진 자리가 있습니다. 1라운드 모든 자리를 포함해 주세요(빈 자리는 번호만 적습니다).',
  not_entrant: '본선 진출팀으로 확정되지 않은 팀입니다.',
  withdrawn_team: '기권 처리된 팀입니다.',
};
