// MATCH SPOTLIGHT 운영진 정보 보강(B1 · 규칙 기반, AI 미사용) — 순수 계산.
//
//   1) linkOperatorNotes : 운영진 메모(원문, 비공개) → 메모 속 선수 이름으로 관련 경기 후보를 찾는다(운영진 확인용 제안).
//   2) sanitizeOperatorText / validateOperatorInput : 운영진이 승인한 "관전 포인트" 문구 · 운영진 PICK 입력 검증.
//   3) applyOperatorInput : 공개 직전 payload 에 승인 문구(operatorPoint)와 운영진 PICK(operatorPick)을 반영.
//   4) detectOperatorInstruction : 공개 문구에 남은 작성 지시 감지(편집기 경고 전용 · 서버 검증 아님).
//
//   원칙
//     - 문구는 운영진이 쓴 글 그대로(공백 · 제어문자만 정리). 경력 · 전적 · 실력을 만들어 내지 않는다.
//     - 공식 분석(헤드라인 · 관전 포인트 · 예측 라벨 · 표본)은 바꾸지 않는다. 운영진 문구는 별도 필드.
//     - 원문 메모는 공개 데이터에 넣지 않는다(이 파일의 출력 payload 에는 승인 문구만 들어간다).
//     - 운영진 PICK: 저장된 예측(생성 때 DB 가 시작 전임을 증명한 경기)만 · 공식 유형 배지가 있는 경기만 ·
//       비공개 회원이 메인 근거면 불가. 자동 분석 점수 · 순서 비교자는 바꾸지 않고 자리만 교체한다.

import type { SpotlightPredictionSnapshot } from './spotlightEngine';
import {
  describeSpotlight, toPublicMatch,
  type PublicMatchAnalysis, type PublicSpotlightItem, type PublicSpotlightPayload,
} from './publicSpotlight';

export const OPERATOR_POINT_MAX = 120;
export const OPERATOR_NOTE_MAX = 200;
export const OPERATOR_NOTES_MAX = 8;
export const OPERATOR_POINTS_MAX = 8;
export const SPOTLIGHT_ITEMS_MAX = 5;

export interface OperatorPointInput { matchNo: number; text: string }
export interface OperatorPickInput { matchNo: number; replace: number | null }
export interface OperatorInput { points: OperatorPointInput[]; pick: OperatorPickInput | null }

export type OperatorRejectReason =
  | 'operator_invalid'        // 형식 오류
  | 'operator_too_many'       // 문구 개수 초과
  | 'operator_text_empty'
  | 'operator_text_too_long'
  | 'operator_html'           // <, > 포함
  | 'operator_unknown_match'  // 없는 경기
  | 'operator_duplicate_match'
  | 'operator_player_mismatch' // 그 경기 선수가 아닌 이름 언급
  | 'pick_unknown_match'
  | 'pick_already_selected'
  | 'pick_no_analysis'        // 공식 유형 배지 없는 경기(공개 카드 구조상 불가)
  | 'pick_private'            // 비공개 회원이 메인 근거
  | 'pick_not_waiting'        // 이미 시작(또는 대기 아님)
  | 'pick_replace_required'
  | 'pick_replace_invalid';

// ── 문구 정리 ────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;

/** 운영진 문구 정리: 제어 · 방향 제어 문자 제거, 공백 1칸, 앞뒤 공백 제거. HTML 꺾쇠는 거부(조용히 바꾸지 않는다). */
export function sanitizeOperatorText(v: unknown, max = OPERATOR_POINT_MAX):
  { ok: true; text: string } | { ok: false; reason: OperatorRejectReason } {
  if (typeof v !== 'string') return { ok: false, reason: 'operator_invalid' };
  if (/[<>]/.test(v)) return { ok: false, reason: 'operator_html' };
  const text = v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, reason: 'operator_text_empty' };
  if ([...text].length > max) return { ok: false, reason: 'operator_text_too_long' };
  return { ok: true, text };
}

// ── 이름 찾기 ────────────────────────────────────────────────────────────────
/** 표시 이름 → 비교용 이름("(G)" · 말줄임 제거, 공백 제거). 2자 미만은 비교하지 않는다(오탐 방지). */
export function nameKey(display: string): string {
  return String(display || '').replace(/…?\s*\(G\)\s*$/i, '').replace(/…/g, '').replace(/\s+/g, '').trim();
}

/** 3자 한글 이름의 성 뺀 이름(예: 김영호 → 영호). 운영진 메모 연결 "추정"에만 쓴다. */
function givenName(key: string): string | null {
  return /^[가-힣]{3}$/.test(key) ? key.slice(1) : null;
}

/**
 * 문장 속 이름 찾기 — 긴 이름 우선 · 겹침 없음. 공백은 무시하고 비교한다.
 * names: 비교용 이름(nameKey) 목록. 반환: 찾은 이름(중복 없이, 처음 나온 순서).
 */
export function findNames(text: string, names: readonly string[]): string[] {
  const hay = String(text || '').replace(/\s+/g, '');
  const sorted = [...new Set(names.filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  const taken: boolean[] = new Array(hay.length).fill(false);
  const found: Array<{ name: string; at: number }> = [];
  for (const n of sorted) {
    let from = 0;
    for (;;) {
      const i = hay.indexOf(n, from);
      if (i < 0) break;
      let free = true;
      for (let k = i; k < i + n.length; k++) if (taken[k]) { free = false; break; }
      if (free) {
        for (let k = i; k < i + n.length; k++) taken[k] = true;
        if (!found.some((f) => f.name === n)) found.push({ name: n, at: i });
      }
      from = i + 1;
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.name);
}

// 메모 속 관계 단서(후보 경기가 여러 개일 때만 사용 · 문구는 바꾸지 않는다)
const PARTNER_CUE = /호흡|파트너|듀오|콤비|조합|짝꿍|짝|한\s*팀|같은\s*팀/;
const RIVAL_CUE = /라이벌|맞대결|대결|천적|설욕|상대|\bvs\b/i;

const playersOf = (m: PublicMatchAnalysis): string[] => [...m.teamA, ...m.teamB].map(nameKey).filter(Boolean);

// ── 1) 메모 → 경기 연결 제안(운영진 확인용) ─────────────────────────────────────
export type NoteLinkStatus = 'linked' | 'guess' | 'choose' | 'none';
export interface NoteLink {
  index: number;
  note: string;              // 정리된 메모(비공개 · 편집기 초기값)
  status: NoteLinkStatus;    // linked=확실 · guess=이름만 일치(추정) · choose=후보 여러 개 · none=이름 없음
  matchNo: number | null;    // 제안 경기(choose/none 이면 null)
  candidates: number[];      // 후보 경기 번호
  mentioned: string[];       // 찾은 선수(표시 이름)
  relation: 'partners' | 'opponents' | 'single' | 'mixed' | null;
  inTop: boolean;            // 제안 경기가 현재 TOP 에 있는가
}

/**
 * 운영진 메모를 경기에 연결한다(제안만 — 최종 선택은 운영진).
 *   - 두 명 이상 언급 → 언급된 선수를 가장 많이 포함하는 경기. 1개면 확정, 여러 개면 choose.
 *   - 한 명 언급 → 그 선수의 경기. 1개면 확정, 여러 개면 choose(라운드 · 경기 번호로 운영진 선택).
 *   - 성 없는 이름(영호)만 맞으면 guess.
 */
export function linkOperatorNotes(notes: readonly string[], payload: PublicSpotlightPayload): NoteLink[] {
  const matches = payload.matches;
  const topNos = new Set(payload.items.map((i) => i.matchNo));
  const display = new Map<string, string>();
  for (const m of matches) for (const d of [...m.teamA, ...m.teamB]) { const k = nameKey(d); if (k) display.set(k, d); }
  const fullKeys = [...display.keys()];
  // 성 뺀 이름 → 전체 이름(유일할 때만)
  const givenMap = new Map<string, string | null>();
  for (const k of fullKeys) {
    const g = givenName(k);
    if (!g) continue;
    givenMap.set(g, givenMap.has(g) ? null : k);
  }

  return notes.slice(0, OPERATOR_NOTES_MAX).map((raw, index) => {
    const note = String(raw || '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, OPERATOR_NOTE_MAX);
    let mentioned = findNames(note, fullKeys);
    let guessed = false;
    if (mentioned.length === 0) {
      const gs = findNames(note, [...givenMap.keys()].filter((g) => givenMap.get(g)));
      mentioned = gs.map((g) => givenMap.get(g) as string);
      guessed = mentioned.length > 0;
    }
    const base = { index, note, mentioned: mentioned.map((k) => display.get(k) || k) };
    if (mentioned.length === 0) {
      return { ...base, status: 'none' as const, matchNo: null, candidates: [], relation: null, inTop: false };
    }
    const scored = matches
      .map((m) => ({ m, hit: mentioned.filter((k) => playersOf(m).includes(k)).length }))
      .filter((x) => x.hit > 0);
    const best = Math.max(0, ...scored.map((x) => x.hit));
    const cands = scored.filter((x) => x.hit === best).map((x) => x.m);
    function relationOf(m: PublicMatchAnalysis): NoteLink['relation'] {
      if (mentioned.length < 2) return 'single';
      const a = m.teamA.map(nameKey); const b = m.teamB.map(nameKey);
      const inA = mentioned.filter((k) => a.includes(k)).length;
      const inB = mentioned.filter((k) => b.includes(k)).length;
      if (inA >= 2 || inB >= 2) return inA && inB ? 'mixed' : 'partners';
      return inA && inB ? 'opponents' : 'single';
    };
    // 후보가 여러 경기면 메모의 단서(호흡 · 듀오 = 같은 팀 / 라이벌 · 맞대결 = 상대)로 관계가 맞는 경기 하나만 남긴다.
    if (cands.length > 1 && mentioned.length >= 2) {
      const want = PARTNER_CUE.test(note) ? 'partners' : RIVAL_CUE.test(note) ? 'opponents' : null;
      const fit = want ? cands.filter((m) => relationOf(m) === want) : [];
      if (fit.length === 1) cands.splice(0, cands.length, fit[0]);
    }
    if (cands.length === 1) {
      const m = cands[0];
      return { ...base, status: guessed ? 'guess' as const : 'linked' as const, matchNo: m.matchNo, candidates: [m.matchNo],
        relation: relationOf(m), inTop: topNos.has(m.matchNo) };
    }
    return { ...base, status: 'choose' as const, matchNo: null, candidates: cands.map((m) => m.matchNo).sort((x, y) => x - y),
      relation: null, inTop: false };
  });
}

/**
 * 편집기: 메모 연결 결과를 기존 행에 합친다(덮어쓰지 않음).
 *   - 공개 문구가 있는 기존 행(공개본 복원 · 직접 작성)은 그대로 유지. 같은 경기 메모가 오면 메모 칸이 비어 있을 때만 채운다.
 *   - 공개 문구가 빈 기존 행(이전 연결에서 메모만 있던 행)은 새 연결로 대체.
 *   - 새 행의 공개 문구는 항상 빈 칸 — 메모 원문(작성 지시일 수 있음)을 공개 문구로 복사하지 않는다.
 */
export function mergeLinkedRows<R extends { matchNo: number | null; note: string; text: string }>(
  prev: readonly R[], links: readonly NoteLink[], makeRow: (l: NoteLink) => Omit<R, 'text'>,
): R[] {
  const kept = prev.filter((r) => r.text.trim()).map((r) => ({ ...r }));
  const added: R[] = [];
  for (const l of links) {
    const same = l.matchNo ? kept.find((r) => r.matchNo === l.matchNo) : undefined;
    if (same) { if (!same.note) same.note = l.note; continue; }
    added.push({ ...makeRow(l), text: '' } as R);
  }
  return [...kept, ...added];
}

// ── 2) 입력 형식 검증(서버) ────────────────────────────────────────────────────
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 10000;

/** 요청 body 의 operator 필드 → 정리된 입력. 없으면 빈 입력(기존 자동 SPOTLIGHT 그대로). */
export function parseOperatorInput(v: unknown):
  { ok: true; input: OperatorInput } | { ok: false; reason: OperatorRejectReason; matchNo?: number } {
  if (v == null) return { ok: true, input: { points: [], pick: null } };
  if (typeof v !== 'object' || Array.isArray(v)) return { ok: false, reason: 'operator_invalid' };
  const o = v as Record<string, unknown>;
  const rawPoints = o.points == null ? [] : o.points;
  if (!Array.isArray(rawPoints)) return { ok: false, reason: 'operator_invalid' };
  if (rawPoints.length > OPERATOR_POINTS_MAX) return { ok: false, reason: 'operator_too_many' };
  const points: OperatorPointInput[] = [];
  const seen = new Set<number>();
  for (const p of rawPoints) {
    if (!p || typeof p !== 'object') return { ok: false, reason: 'operator_invalid' };
    const r = p as Record<string, unknown>;
    if (!isInt(r.matchNo)) return { ok: false, reason: 'operator_invalid' };
    if (seen.has(r.matchNo)) return { ok: false, reason: 'operator_duplicate_match', matchNo: r.matchNo };
    const t = sanitizeOperatorText(r.text);
    if (!t.ok) return { ok: false, reason: t.reason, matchNo: r.matchNo };
    seen.add(r.matchNo);
    points.push({ matchNo: r.matchNo, text: t.text });
  }
  let pick: OperatorPickInput | null = null;
  if (o.pick != null) {
    const k = o.pick as Record<string, unknown>;
    if (typeof k !== 'object' || !isInt(k.matchNo) || !(k.replace == null || isInt(k.replace))) {
      return { ok: false, reason: 'operator_invalid' };
    }
    pick = { matchNo: k.matchNo, replace: k.replace == null ? null : (k.replace as number) };
  }
  return { ok: true, input: { points, pick } };
}

// ── 3) 공개 payload 에 반영(서버 · 미리보기 공통) ──────────────────────────────
export interface ApplyOperatorContext {
  /** 공개 대상 예측 snapshot(무효 · 제외 반영 후). PICK 카드 생성용. */
  eligible: readonly SpotlightPredictionSnapshot[];
  /** 비공개 회원이 메인 근거인가(공개 규칙과 같은 판정). */
  usesRestricted: (s: SpotlightPredictionSnapshot) => boolean;
  /** 현재 경기 상태(matchNo → status). 없으면 PICK 시작 여부 확인 불가 → 거부. */
  currentStatus: ReadonlyMap<number, string> | null;
}

export function applyOperatorInput(
  payload: PublicSpotlightPayload,
  input: OperatorInput,
  ctx: ApplyOperatorContext,
): { ok: true; payload: PublicSpotlightPayload } | { ok: false; reason: OperatorRejectReason; matchNo?: number } {
  if (input.points.length === 0 && !input.pick) return { ok: true, payload };
  const byNo = new Map(payload.matches.map((m) => [m.matchNo, m]));
  const allNames = [...new Set(payload.matches.flatMap(playersOf))];

  // 관전 포인트: 있는 경기 · 그 경기 선수만 언급
  const pointByNo = new Map<number, string>();
  for (const p of input.points) {
    const m = byNo.get(p.matchNo);
    if (!m) return { ok: false, reason: 'operator_unknown_match', matchNo: p.matchNo };
    const own = playersOf(m);
    const mentioned = findNames(p.text, allNames);
    if (mentioned.some((k) => !own.includes(k))) return { ok: false, reason: 'operator_player_mismatch', matchNo: p.matchNo };
    pointByNo.set(p.matchNo, p.text);
  }

  let items: PublicSpotlightItem[] = payload.items.map((it) => ({ ...it }));
  if (input.pick) {
    const { matchNo, replace } = input.pick;
    const snap = ctx.eligible.find((s) => s.matchNo === matchNo);
    if (!snap || !byNo.has(matchNo)) return { ok: false, reason: 'pick_unknown_match', matchNo };
    if (items.some((it) => it.matchNo === matchNo)) return { ok: false, reason: 'pick_already_selected', matchNo };
    const d = snap.mainType ? describeSpotlight(snap) : null;
    if (!snap.mainType || !d) return { ok: false, reason: 'pick_no_analysis', matchNo };
    if (ctx.usesRestricted(snap)) return { ok: false, reason: 'pick_private', matchNo };
    if (!ctx.currentStatus || ctx.currentStatus.get(matchNo) !== 'waiting') return { ok: false, reason: 'pick_not_waiting', matchNo };
    const picked: PublicSpotlightItem = { ...toPublicMatch(snap), badge: snap.mainType, headline: d.headline, viewpoint: d.viewpoint, operatorPick: true };
    if (replace == null) {
      if (items.length >= SPOTLIGHT_ITEMS_MAX) return { ok: false, reason: 'pick_replace_required', matchNo };
      items.push(picked);
    } else {
      const at = items.findIndex((it) => it.matchNo === replace);
      if (at < 0) return { ok: false, reason: 'pick_replace_invalid', matchNo: replace };
      items[at] = picked;
    }
  }

  const withPoint = <T extends PublicMatchAnalysis>(m: T): T => {
    const t = pointByNo.get(m.matchNo);
    if (!t) return m;
    return { ...m, operatorPoint: t };
  };
  items = items.map(withPoint);
  return { ok: true, payload: { ...payload, items, matches: payload.matches.map(withPoint) } };
}

// ── 4) 지시문 감지(편집기 경고 전용) ───────────────────────────────────────────
//   운영진 메모는 "작성 지시"(예: 2번 경기는 오픈부라 강조해 줘)일 수 있다. 이 지시가 공개 문구에 그대로 남지 않도록
//   편집기에서 경고만 한다. ⚠ 서버 검증(parseOperatorInput · applyOperatorInput)에는 쓰지 않는다
//   → 이미 공개된 승인 문구가 새 규칙 때문에 재공개에서 막히지 않는다. (향후 AI 초안 결과에도 같은 경고를 쓴다.)
export type InstructionWarning = 'same_as_note' | 'request' | 'meta' | 'match_ref';

export const INSTRUCTION_WARNING_TEXT: Record<InstructionWarning, string> = {
  same_as_note: '운영진 메모 원문과 같습니다.',
  request: '작성 지시(예: "강조해 줘", "소개해 주세요")가 들어 있습니다.',
  meta: '문구 · 포스터 · 관전 포인트 등 작성 대상을 가리키는 말이 들어 있습니다.',
  match_ref: '"2번 경기는"처럼 경기 번호로 지시하는 표현이 들어 있습니다.',
};

// 작성 · 노출 동사(관람객에게 하는 말이 아니라 문구를 만드는 쪽에 하는 말)
const WRITE_VERB = '(?:강조|부각|언급|소개|작성|표시|반영|추가|정리|홍보|어필|넣어|써|적어|올려|띄워|다뤄|빼)';
// 반말 요청(공개 문구에는 거의 쓰지 않는다) — 어떤 동사 뒤든 경고
const CASUAL_REQUEST = /(?:해|해서|게|어|아|워|와|줘|봐)\s*(?:줘|줘요|줄래|주라|줄\s*수\s*있어)(?![가-힣])|(?:해|게)\s*달라/;
// 정중한 요청 · 의무 표현은 작성 동사와 함께일 때만(응원해 주세요 · 많은 관심 부탁드립니다 같은 공개 문장은 허용)
const POLITE_REQUEST = new RegExp(`${WRITE_VERB}\\s*(?:해|해서|하게|되게|시켜)?\\s*(?:주세요|주시고|주십시오|주면|줬으면|달라|부탁|바람|바랍니다|하도록|되도록|할\\s*것|해야|하면\\s*좋겠|했으면)`);
const META = /(?:관전\s*포인트|공개\s*문구|문구|포스터|프리뷰|멘트|소개글|홍보글|AI)\s*(?:에|에서|로|으로|를|을|은|는)(?![가-힣])/i;
const MATCH_REF = /(?:^|[\s,·(])\d{1,2}\s*번\s*(?:경기|매치|게임|코트)?\s*(?:은|는|도|이|가|에|에서)(?![가-힣])/;

/** 공개 문구가 작성 지시처럼 보이면 사유 목록을 돌려준다(빈 배열 = 경고 없음). 차단하지 않는다. */
export function detectOperatorInstruction(text: string, note = ''): InstructionWarning[] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out: InstructionWarning[] = [];
  const n = String(note || '').replace(/\s+/g, ' ').trim();
  if (n && n === t) out.push('same_as_note');
  if (CASUAL_REQUEST.test(t) || POLITE_REQUEST.test(t)) out.push('request');
  if (META.test(t)) out.push('meta');
  if (MATCH_REF.test(t)) out.push('match_ref');
  return out;
}

/** 운영진 입력이 같은가(재공개 필요 판정용). */
export function sameOperatorInput(a: OperatorInput, b: OperatorInput): boolean {
  const key = (x: OperatorInput) => JSON.stringify({
    points: [...x.points].sort((p, q) => p.matchNo - q.matchNo).map((p) => [p.matchNo, p.text]),
    pick: x.pick ? [x.pick.matchNo, x.pick.replace] : null,
  });
  return key(a) === key(b);
}

/** 공개된 payload → 그 안에 반영된 운영진 입력(편집기 초기값). PICK 의 교체 대상은 알 수 없으므로 null. */
export function operatorInputFromPayload(p: PublicSpotlightPayload): OperatorInput {
  const points = p.matches.filter((m) => m.operatorPoint).map((m) => ({ matchNo: m.matchNo, text: m.operatorPoint as string }));
  const pk = p.items.find((i) => i.operatorPick);
  return { points, pick: pk ? { matchNo: pk.matchNo, replace: null } : null };
}
