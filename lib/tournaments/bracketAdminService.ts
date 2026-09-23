// 본선 Bracket — 운영진 RPC 래퍼 (Batch 4B).
//
//   ⚠ 이 파일은 구조를 만들지 않는다. 화면이 만든 payload 를 서버로 넘기고 결과를 되받을 뿐이다.
//     진출팀 자동 산출 · 자동 시딩 · BYE 자동 배치 · 자동 topology 는 여기에도 서버에도 없다.
//   ⚠ 저장 뒤에는 로컬 상태를 믿지 않고 fetchAdminBracket 으로 다시 읽는다(authoritative refetch).
//   ⚠ 사용자에게 UUID · Postgres 원문 오류를 그대로 보여주지 않는다 — bracketActionMessage 로 번역한다.

import { supabase } from '@/lib/supabase';
import type {
  AdminBracket, Bracket, BracketDrift, BracketEntrant, BracketIssue, BracketRound,
  BracketSlot, BracketSummary, BracketValidation, EntrantInput, KnockoutMatch,
  KnockoutMatchTeam, SlotAssignmentInput, StructureInput,
} from './bracketTypes';

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isMissingRelation = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = str(e?.code);
  const msg = str(e?.message);
  return code === '42P01' || code === 'PGRST202' || code === 'PGRST205'
    || (/hosted_tournament_bracket|_bracket\b/.test(msg) && /does not exist|schema cache|Could not find/.test(msg));
};

/** RPC 응답의 {ok:false, reason} 을 예외로 올린다(reason · payload 를 그대로 붙여 화면이 상세를 쓸 수 있게). */
function unwrap(data: unknown): Record<string, unknown> {
  const o = rec(data);
  if (o.ok === false) {
    const err = new Error(str(o.reason) || 'UNKNOWN') as Error & {
      reason?: string;
      payload?: Record<string, unknown>;
    };
    err.reason = str(o.reason);
    err.payload = o;
    throw err;
  }
  return o;
}

// ── 조회 ────────────────────────────────────────────────────────────────────

const mapBracket = (o: Record<string, unknown>): Bracket => ({
  id: str(o.id),
  title: strOrNull(o.title),
  status: (str(o.status) || 'draft') as Bracket['status'],
  version: num(o.version),
  declaredEntrantCount: numOrNull(o.declaredEntrantCount),
  lockedAt: strOrNull(o.lockedAt),
  publishedAt: strOrNull(o.publishedAt),
  completedAt: strOrNull(o.completedAt),
});

const mapIssues = (v: unknown): BracketIssue[] =>
  arr(v).map((i) => ({
    code: str(i.code),
    severity: str(i.severity) === 'warning' ? 'warning' : 'error',
    detail: i,
  }));

const mapSummary = (v: unknown): BracketSummary => {
  const o = rec(v);
  return {
    entrants: num(o.entrants),
    rounds: num(o.rounds),
    slots: num(o.slots),
    firstRoundSlots: num(o.firstRoundSlots),
    byes: num(o.byes),
    unassigned: num(o.unassigned),
    matchesToCreate: num(o.matchesToCreate),
    byeAdvances: num(o.byeAdvances),
  };
};

const mapValidation = (v: unknown): BracketValidation | null => {
  const o = rec(v);
  if (o.ok === undefined) return null;
  return { ok: o.ok === true, issues: mapIssues(o.issues), summary: mapSummary(o.summary) };
};

const mapMatchTeam = (v: unknown): KnockoutMatchTeam => {
  const o = rec(v);
  return {
    teamNo: numOrNull(o.teamNo),
    player1Name: strOrNull(o.player1Name),
    player2Name: strOrNull(o.player2Name),
    teamStatus: (strOrNull(o.teamStatus) as KnockoutMatchTeam['teamStatus']) ?? null,
  };
};

export async function fetchAdminBracket(slug: string): Promise<{ ready: boolean; data: AdminBracket }> {
  const empty: AdminBracket = {
    bracket: null, rounds: [], slots: [], entrants: [], matches: [],
    entrantDrift: [], validation: null,
  };
  try {
    const { data, error } = await supabase.rpc('get_admin_bracket', { p_slug: slug });
    if (error) throw error;
    const o = unwrap(data);
    const b = rec(o.bracket);
    return {
      ready: true,
      data: {
        bracket: o.bracket ? mapBracket(b) : null,
        rounds: arr(o.rounds).map((r): BracketRound => ({
          id: str(r.id),
          roundNo: num(r.roundNo),
          name: str(r.name),
          isFinalSlot: r.isFinalSlot === true,
          slotCount: num(r.slotCount),
        })),
        slots: arr(o.slots).map((s): BracketSlot => ({
          id: str(s.id),
          roundNo: num(s.roundNo),
          position: num(s.position),
          slotType: (str(s.slotType) || 'tbd') as BracketSlot['slotType'],
          teamId: strOrNull(s.teamId),
          teamNo: numOrNull(s.teamNo),
          player1Name: strOrNull(s.player1Name),
          player2Name: strOrNull(s.player2Name),
          teamStatus: (strOrNull(s.teamStatus) as BracketSlot['teamStatus']) ?? null,
          feedsSlotId: strOrNull(s.feedsSlotId),
        })),
        entrants: arr(o.entrants).map((e): BracketEntrant => ({
          id: str(e.id),
          teamId: str(e.teamId),
          teamNo: num(e.teamNo),
          player1Name: str(e.player1Name),
          player2Name: str(e.player2Name),
          teamStatus: (str(e.teamStatus) || 'active') as BracketEntrant['teamStatus'],
          source: (str(e.source) || 'manual') as BracketEntrant['source'],
          sourceGroupNo: numOrNull(e.sourceGroupNo),
          sourceRank: numOrNull(e.sourceRank),
          seedNo: numOrNull(e.seedNo),
          note: strOrNull(e.note),
          placed: e.placed === true,
        })),
        matches: arr(o.matches).map((m): KnockoutMatch => ({
          id: str(m.id),
          matchNo: num(m.matchNo),
          roundNo: num(m.roundNo),
          roundName: strOrNull(m.roundName),
          targetRoundNo: num(m.targetRoundNo),
          targetPosition: num(m.targetPosition),
          status: (str(m.status) || 'waiting') as KnockoutMatch['status'],
          version: num(m.version),
          courtNo: numOrNull(m.courtNo),
          courtName: strOrNull(m.courtName),
          score1: numOrNull(m.score1),
          score2: numOrNull(m.score2),
          winnerTeamNo: numOrNull(m.winnerTeamNo),
          team1: mapMatchTeam(m.team1),
          team2: mapMatchTeam(m.team2),
        })),
        entrantDrift: arr(o.entrantDrift).map((d): BracketDrift => ({
          code: str(d.code),
          teamNo: numOrNull(d.teamNo),
        })),
        validation: mapValidation(o.validation),
      },
    };
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, data: empty };
    throw err;
  }
}

export async function validateBracket(slug: string): Promise<BracketValidation> {
  const { data, error } = await supabase.rpc('validate_bracket', { p_slug: slug });
  if (error) throw error;
  const o = unwrap(data);
  return { ok: o.ok === true, issues: mapIssues(o.issues), summary: mapSummary(o.summary) };
}

// ── 쓰기 ────────────────────────────────────────────────────────────────────

export async function createBracket(
  slug: string,
  title: string | null,
  declaredEntrantCount: number | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_bracket', {
    p_slug: slug,
    p_title: title,
    p_declared_entrant_count: declaredEntrantCount,
  });
  if (error) throw error;
  unwrap(data);
  return '본선 대진표를 만들었습니다.';
}

/** 진출팀 전량 스냅샷 저장. ⚠ 예선 결과를 서버가 읽어 채우지 않는다 — 이 목록이 전부다. */
export async function setBracketEntrants(
  slug: string,
  entrants: EntrantInput[],
  expectedVersion: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('set_bracket_entrants', {
    p_slug: slug,
    p_entrants: entrants.map((e) => ({
      teamId: e.teamId,
      source: e.source,
      sourceGroupNo: e.sourceGroupNo ?? null,
      sourceRank: e.sourceRank ?? null,
      seedNo: e.seedNo ?? null,
      note: e.note ?? null,
    })),
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  const o = unwrap(data);
  return `진출팀 ${num(o.entrantCount)}팀을 확정했습니다.`;
}

/** 라운드 · 자리 수 · 연결 전량 교체. 연결은 화면이 만든 값을 그대로 보낸다(서버 추론 없음). */
export async function setBracketStructure(
  slug: string,
  structure: StructureInput,
  expectedVersion: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('set_bracket_structure', {
    p_slug: slug,
    p_structure: {
      rounds: structure.rounds.map((r) => ({
        roundNo: r.roundNo,
        name: r.name,
        slots: r.slots,
        isFinalSlot: r.isFinalSlot === true,
      })),
      connections: structure.connections,
    },
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  const o = unwrap(data);
  return `구조를 저장했습니다. 라운드 ${num(o.rounds)}개 · 자리 ${num(o.slots)}개.`;
}

/** 1라운드 자리 1개 수정. 2라운드 이후는 서버가 거부한다. */
export async function assignBracketSlot(
  slug: string,
  slotId: string,
  slotType: SlotAssignmentInput['type'],
  teamId: string | null,
  expectedVersion: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('assign_bracket_slot', {
    p_slug: slug,
    p_slot_id: slotId,
    p_slot_type: slotType,
    p_team_id: slotType === 'team' ? teamId : null,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  unwrap(data);
  return slotType === 'team' ? '자리에 팀을 놓았습니다.'
    : slotType === 'bye' ? '자리를 부전승으로 두었습니다.'
    : '자리를 비웠습니다.';
}

/** 1라운드 전량 교체(붙여넣기). 전량 검증 후 전량 반영 — 부분 저장이 없다. */
export async function replaceBracketSlots(
  slug: string,
  assignments: SlotAssignmentInput[],
  expectedVersion: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('replace_bracket_slots', {
    p_slug: slug,
    p_assignments: assignments.map((a) => ({
      position: a.position,
      type: a.type,
      teamId: a.type === 'team' ? (a.teamId ?? null) : null,
    })),
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  const o = unwrap(data);
  return `1라운드 배치를 저장했습니다. 팀 ${num(o.assigned)} · 부전승 ${num(o.byes)} · 빈자리 ${num(o.cleared)}.`;
}

export async function lockBracket(slug: string, expectedVersion: number): Promise<string> {
  const { data, error } = await supabase.rpc('lock_bracket', {
    p_slug: slug,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  const o = unwrap(data);
  const s = mapSummary(o.summary);
  return `대진을 확정(잠금)했습니다. 만들 경기 ${s.matchesToCreate} · 부전승 진출 ${s.byeAdvances}`
    + ' — 이제 본선 경기 운영에서 경기를 만들 수 있습니다.';
}

export async function unlockBracket(
  slug: string,
  reason: string,
  expectedVersion: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('unlock_bracket', {
    p_slug: slug,
    p_reason: reason,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  unwrap(data);
  return '잠금을 해제했습니다. 사유는 변경 이력에 남았습니다.';
}

// ── 본선 경기 운영 (4C) ─────────────────────────────────────────────────────
//
//   ⚠ 완료는 반드시 completeKnockoutMatch 하나로 한다.
//     '완료' 와 '승자 전달' 을 화면이 두 번 나눠 호출하면 중간에 끊겼을 때 승자가 사라진다.
//   ⚠ 호명 · 호명취소 · 코트 배정은 예선과 같은 RPC(call/uncall/start_match)를 그대로 쓴다.
//     본선 전용으로 다시 만들지 않는다.

/** 확정된 대진 → 본선 경기 생성 + 부전승 진출. 여러 번 눌러도 안전하다(서버가 멱등). */
export async function materializeBracketMatches(
  slug: string,
  expectedVersion: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('materialize_bracket_matches', {
    p_slug: slug,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  const o = unwrap(data);
  const created = num(o.created);
  const byes = num(o.byeAdvanced);
  if (created === 0 && byes === 0) return '새로 만들 경기가 없습니다. (이미 모두 생성됨)';
  return `경기 ${created}개를 만들었습니다.` + (byes > 0 ? ` 부전승 ${byes}팀이 다음 라운드로 올라갔습니다.` : '');
}

/** 본선 경기 완료 — 점수 저장 · 승자 전달 · 다음 경기 생성이 한 번에 일어난다. */
export async function completeKnockoutMatch(
  matchId: string,
  score1: number,
  score2: number,
  expectedVersion: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('complete_knockout_match', {
    p_match_id: matchId,
    p_score1: score1,
    p_score2: score2,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  const o = unwrap(data);
  if (o.bracketCompleted === true) return '결승 결과를 저장했습니다. 본선이 완료됐습니다.';
  const created = num(o.createdMatches);
  return '결과를 저장하고 승자를 다음 자리로 올렸습니다.'
    + (created > 0 ? ` 다음 경기 ${created}개가 만들어졌습니다.` : '');
}

/** 본선 완료 결과 수정. 승자가 바뀌면 하위 진행 상태에 따라 서버가 거부할 수 있다. */
export async function amendKnockoutMatchScore(
  matchId: string,
  score1: number,
  score2: number,
  reason: string,
  expectedVersion: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('amend_knockout_match_score', {
    p_match_id: matchId,
    p_score1: score1,
    p_score2: score2,
    p_reason: reason,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  const o = unwrap(data);
  if (o.winnerChanged !== true) return '점수를 정정했습니다. 사유는 변경 이력에 남았습니다.';
  return '승자를 정정하고 다음 라운드 자리를 다시 맞췄습니다.'
    + (o.replacedMatch === true ? ' 다음 경기의 팀도 교체했습니다.' : '');
}

// ── 오류 문구 ───────────────────────────────────────────────────────────────

/**
 * RPC reason · Postgres 오류 → 운영자용 한국어.
 *   ⚠ UUID · 원문 오류를 그대로 노출하지 않는다. 모르는 값은 일반 문구로 덮는다.
 */
export function bracketActionMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown; reason?: unknown } | null;
  const code = str(e?.code);
  const reason = str(e?.reason);
  const msg = str(e?.message);
  const key = reason || msg;

  if (code === '42501' || /not authorized/i.test(msg)) return '권한이 없습니다. (CEO·ADMIN 전용)';
  if (isMissingRelation(err)) return '본선 테이블이 아직 적용되지 않았습니다. (migration 대기)';

  switch (key) {
    case 'tournament_not_found':      return '대회를 찾을 수 없습니다.';
    case 'bracket_not_found':         return '본선 대진표가 아직 없습니다. 먼저 만들어 주세요.';
    case 'already_exists':            return '이 대회에는 이미 본선 대진표가 있습니다.';
    case 'version_required':          return '저장 정보를 다시 불러온 뒤 시도해 주세요.';
    case 'version_conflict':
      return '다른 곳에서 먼저 저장했습니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.';
    case 'bracket_locked':
      return '확정(잠금)된 대진입니다. 수정하려면 먼저 잠금을 해제해 주세요.';
    case 'already_locked':            return '이미 확정된 대진입니다.';
    case 'not_locked':                return '확정 상태가 아닙니다.';
    case 'validation_failed':
      return '검증을 통과하지 못했습니다. 아래 오류 목록을 확인해 주세요.';
    case 'knockout_matches_exist':
      return '본선 경기가 이미 있어 잠금을 해제할 수 없습니다. 경기 운영에서 먼저 정리해 주세요.';
    case 'reason_required':           return '잠금 해제 사유를 입력해 주세요.';
    case 'reason_too_long':           return '사유가 너무 깁니다. 200자 이내로 줄여 주세요.';

    // 진출팀
    case 'invalid_payload':           return '입력값을 확인해 주세요.';
    case 'empty_payload':             return '진출팀이 비어 있습니다.';
    case 'invalid_source':            return '진출 경로 값이 올바르지 않습니다.';
    case 'duplicate_entrant':         return '같은 팀이 두 번 들어 있습니다.';
    case 'team_not_found':            return '이 대회의 팀이 아닙니다.';
    case 'entrant_in_use':
      return '이미 자리에 놓인 팀은 진출팀에서 뺄 수 없습니다. 먼저 그 자리를 비워 주세요.';

    // 구조
    case 'connections_required':      return '라운드 연결 정보가 필요합니다.';
    case 'invalid_round_no':          return '라운드 번호가 올바르지 않습니다.';
    case 'invalid_round_name':        return '라운드 이름을 입력해 주세요.';
    case 'duplicate_round_no':        return '라운드 번호가 중복됐습니다.';
    case 'duplicate_round_name':      return '라운드 이름이 중복됐습니다.';
    case 'invalid_slot_count':        return '자리 수는 1 이상이어야 합니다.';
    case 'round_gap':                 return '라운드 번호는 1부터 연속이어야 합니다.';
    case 'final_round_invalid':
      return '마지막 라운드는 우승 자리 1개여야 하고 맨 뒤에 있어야 합니다.';
    case 'invalid_connection':        return '연결 대상 자리가 올바르지 않습니다.';
    case 'duplicate_connection':      return '같은 자리에 연결이 두 번 지정됐습니다.';
    case 'connection_count_mismatch': return '연결 수가 자리 수와 맞지 않습니다.';
    case 'slots_in_use':
      return '이미 배치된 자리가 있어 구조를 바꿀 수 없습니다. 1라운드 배치를 먼저 비워 주세요.';

    // 자리 배치
    case 'structure_missing':         return '먼저 본선 구조를 저장해 주세요.';
    case 'slot_not_found':            return '자리를 찾을 수 없습니다.';
    case 'slot_not_editable':
      return '2라운드 이후 자리는 직접 편집할 수 없습니다. 승자가 올라오는 자리입니다.';
    case 'invalid_slot_type':         return '자리 종류가 올바르지 않습니다.';
    case 'team_not_entrant':          return '본선 진출팀으로 확정되지 않은 팀입니다.';
    case 'team_already_placed':       return '이 팀은 이미 다른 자리에 놓여 있습니다.';
    case 'duplicate_position':        return '같은 자리 번호가 두 번 들어 있습니다.';
    case 'duplicate_team':            return '같은 팀이 두 자리에 들어 있습니다.';
    case 'unknown_position':          return '없는 자리 번호가 들어 있습니다.';
    case 'position_count_mismatch':
      return '1라운드 자리 수와 입력 줄 수가 다릅니다. 모든 자리를 포함해 주세요.';

    // 본선 경기 운영 (4C)
    case 'bracket_not_locked':
      return '대진을 먼저 확정(잠금)해 주세요. 확정 전에는 경기를 만들지 않습니다.';
    case 'bracket_completed':
      return '이미 끝난 본선입니다. 우승 결과를 바꾸려면 운영 책임자와 먼저 상의해 주세요.';
    case 'bracket_link_missing':
      return '이 경기가 대진의 어느 자리로 이어지는지 확인할 수 없습니다. 대진을 다시 불러와 주세요.';
    case 'not_knockout_match':      return '본선 경기가 아닙니다.';
    case 'knockout_requires_bracket_rpc':
      return '본선 경기는 본선 화면에서만 처리할 수 있습니다.';
    case 'knockout_cancel_not_supported':
      return '본선 경기는 취소할 수 없습니다. 자리가 비면 대진이 끊깁니다.';
    case 'match_not_found':         return '경기를 찾을 수 없습니다.';
    case 'match_not_completed':     return '아직 완료된 경기가 아닙니다.';
    case 'already_changed':
      return '이미 상태가 바뀐 경기입니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.';
    case 'invalid_score':           return '점수는 6 대 0~5 로 입력해 주세요.';
    case 'slot_occupied':
      return '올라갈 자리에 이미 다른 팀이 있습니다. 대진 상태를 먼저 확인해 주세요.';
    case 'downstream_calling':
      return '다음 경기가 이미 호명됐습니다. 그 경기를 호명 취소한 뒤 다시 시도해 주세요.';
    case 'downstream_playing':
      return '다음 경기가 진행 중입니다. 먼저 그 경기를 정리한 뒤 다시 시도해 주세요.';
    case 'downstream_completed':
      return '다음 경기가 이미 끝났습니다. 뒤쪽 결과부터 바로잡아야 합니다.';
    case 'court_not_found':         return '없는 코트 번호입니다.';
    case 'court_disabled':          return '사용 중지된 코트입니다.';
    case 'court_conflict':          return '그 코트에서 다른 경기가 진행 중입니다.';
    case 'team_busy':               return '해당 팀이 다른 경기를 진행 중입니다.';
    default:
      break;
  }
  if (/duplicate key|unique/i.test(msg)) return '이미 사용 중인 값이라 저장하지 못했습니다.';
  if (/permission denied/i.test(msg)) return '권한이 없습니다. (CEO·ADMIN 전용)';
  return '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}
