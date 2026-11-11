// MATCH SPOTLIGHT AI 운영진 관전 포인트 v2 — 순수 계산(네트워크 · DB · AI 호출 없음).
//
//   1) linkInstructions : 운영진 메모(여러 경기 지시) → 지시별 경기 연결(규칙 기반 · AI 미사용).
//      "2번 경기" · "3경기" · "R2 1코트" · 선수 이름. 모호하면 자동 확정하지 않는다(확인 · 선택 요청).
//      ⚠ SPOTLIGHT 번호(matchNo)는 라운드 → 코트 순 내부 번호다. KDK 대진 화면에는 전체 경기 번호가 없으므로
//        "N번" 지시는 항상 운영진 확인을 받는다(confirm). 라운드+코트 · 선수 이름이 하나로 정해질 때만 자동 연결.
//   2) (서버 전용 spotlightAiPrompt.buildDraftPrompt) AI 입력(최소 데이터) — 경기 키(M1…)는 요청마다 새로 만든 불투명 키, 서버가 matchId 로 되돌린다.
//   3) parseAiDraftResponse · assembleDrafts : AI 출력(JSON) 파싱 · 경기별 검증. 실패한 카드만 "수정 필요".
//   4) validateDraftText : 결정적 검증(길이 · 꺾쇠 · 다른 경기 선수 · 근거 없는 숫자 · 근거 없는 경력/관계 ·
//      지시문 노출 · 개인정보). 의미적 과장은 모두 잡지 못한다 — 운영진 최종 승인이 필수 안전장치.

import {
  detectOperatorInstruction, findNames, linkOperatorNotes, nameKey, sanitizeOperatorText,
  OPERATOR_NOTE_MAX, OPERATOR_NOTES_MAX, OPERATOR_POINT_MAX,
} from './spotlightOperator';
import type { PublicMatchAnalysis, PublicSpotlightPayload } from './publicSpotlight';
import type { SpotlightType } from './spotlight';

export const AI_MEMO_MAX = 1000;          // 메모 전체 글자 수
export const AI_INSTRUCTION_MAX = OPERATOR_NOTE_MAX; // 경기별 지시 200자
export const AI_ITEMS_MAX = OPERATOR_NOTES_MAX;      // 한 번 생성 요청 최대 경기 수(8)
export const AI_REGENERATE_MAX = 5;       // 경기별 재생성 최대 횟수(회차 단위)
export const AI_DRAFT_TARGET = 90;        // AI 에 요청하는 길이(검증 한도는 120)

// ── 경기 정보(관리자 화면 · AI 입력 공통) ─────────────────────────────────────────
export interface AiMatchInfo {
  matchNo: number;
  /** 안정 식별자(matches.id) — 회차 안 matchNo ↔ matchId 는 생성 때 고정. 서버가 다시 확인한다. */
  ref: string;
  round: number;
  court: number | null;
  group: string;
  teamA: [string, string];
  teamB: [string, string];
  badge: SpotlightType | null;
  inTop: boolean;
  /** 공식 헤드라인 · 관전 포인트(TOP 경기만 · 공개 payload 와 같은 값). 없으면 ''. */
  official: string;
  /** 현재 경기 상태(waiting · playing · complete …). 모르면 ''. */
  status: string;
}

export const matchInfoLabel = (m: Pick<AiMatchInfo, 'round' | 'court' | 'group' | 'matchNo' | 'teamA' | 'teamB'>): string =>
  `R${m.round}${m.court ? ` · ${m.court}코트` : ''}${m.group ? ` · ${m.group}조` : ''} · ${m.matchNo}경기 — `
  + `${m.teamA.filter(Boolean).join('·')} vs ${m.teamB.filter(Boolean).join('·')}`;

const playerKeys = (m: Pick<AiMatchInfo, 'teamA' | 'teamB'>): string[] => [...m.teamA, ...m.teamB].map(nameKey).filter(Boolean);

// ── 1) 지시 분리 · 경기 연결 ──────────────────────────────────────────────────
export type InstructionStatus =
  | 'linked'    // 확실(라운드+코트 · 선수 이름이 한 경기로 정해짐 · 번호와 이름 일치)
  | 'confirm'   // 후보 1개지만 확인 필요(번호만 · 코트만 · 성 뺀 이름 추정)
  | 'choose'    // 후보 여러 경기
  | 'conflict'  // 번호와 선수 이름이 서로 다른 경기를 가리킴
  | 'missing'   // 그 번호 · 코트의 경기가 없음
  | 'none';     // 경기 단서 없음

export interface InstructionLink {
  index: number;
  instruction: string;      // 정리된 지시(비공개)
  status: InstructionStatus;
  matchNo: number | null;   // 제안 경기(확인 전에는 제안일 뿐)
  candidates: number[];
  refText: string;          // 찾은 번호 · 코트 표현(예: "2번", "R2 1코트")
  mentioned: string[];      // 찾은 선수
}

type Ref = { kind: 'no'; no: number } | { kind: 'rc'; round: number; court: number } | { kind: 'court'; court: number };
interface RefHit { at: number; end: number; ref: Ref; text: string }

// 라운드+코트: "R2 1코트" · "2R 1코트" · "2라운드 1코트" · "2라운드 1번 코트"
const RE_RC = /(?:R\s*(\d{1,2})|(\d{1,2})\s*(?:R|라운드))\s*[,·\-]?\s*(\d{1,2})\s*번?\s*코트/gi;
// 코트만: "1코트" · "1번 코트"
const RE_COURT = /(\d{1,2})\s*번?\s*코트/g;
// 경기 번호: "2번" · "2번 경기" · "3경기" · "2번째 경기" (뒤에 조사 · 공백 · 문장부호 · 끝)
const RE_NO = /(\d{1,2})\s*(?:번째\s*경기|번(?:\s*(?:경기|매치|게임))?|경기)(?=\s|[은는이가도에의과와랑만부,.!?·)]|하고|부터|까지|$)/g;

function findRefs(s: string): RefHit[] {
  const hits: RefHit[] = [];
  const taken = (a: number, b: number) => hits.some((h) => a < h.end && b > h.at);
  for (const m of s.matchAll(RE_RC)) {
    const at = m.index ?? 0; const end = at + m[0].length;
    hits.push({ at, end, text: m[0].trim(), ref: { kind: 'rc', round: Number(m[1] || m[2]), court: Number(m[3]) } });
  }
  for (const m of s.matchAll(RE_COURT)) {
    const at = m.index ?? 0; const end = at + m[0].length;
    if (!taken(at, end)) hits.push({ at, end, text: m[0].trim(), ref: { kind: 'court', court: Number(m[1]) } });
  }
  for (const m of s.matchAll(RE_NO)) {
    const at = m.index ?? 0; const end = at + m[0].length;
    // "3연승" 같은 숫자는 패턴상 제외됨. 앞 글자가 숫자 · 영문이면(예: R2) 번호로 보지 않는다.
    if (at > 0 && /[0-9A-Za-z]/.test(s[at - 1])) continue;
    if (!taken(at, end)) hits.push({ at, end, text: m[0].trim(), ref: { kind: 'no', no: Number(m[1]) } });
  }
  return hits.sort((a, b) => a.at - b.at);
}

const clean = (s: string): string => {
  const r = sanitizeOperatorText(String(s || '').replace(/[<>]/g, ' '), 10000);
  return r.ok ? r.text : '';
};
// 조각 끝 연결어 · 쉼표 정리("강조하고," → "강조하고")
const trimJoint = (s: string): string => s.replace(/^[\s,·]*(?:그리고|또|또한|및)\s+/, '').replace(/[\s,·]*(?:그리고|또|및)?[\s,·]*$/, '').trim();

export interface InstructionPiece { text: string; hasRef: boolean; /** 같은 줄에서 앞 조각에 이어지는 단서 없는 문장 */ continues: boolean }

/** 메모 → 지시 조각. 줄 · 문장(. ! ? 。 — 소수점 제외) 단위로 나누고, 한 문장에 경기 단서가 여럿이면 단서마다 나눈다. */
export function splitInstructions(memo: string): InstructionPiece[] {
  const text = String(memo || '').slice(0, AI_MEMO_MAX);
  const out: InstructionPiece[] = [];
  for (const line of text.split(/\r?\n+/)) {
    // 경기 단서(번호 · 코트)가 없는 줄은 줄 전체가 지시 하나(기존 메모 연결과 같음 — 호흡 · 라이벌 단서 유지).
    const whole = clean(line);
    if (!whole) continue;
    if (findRefs(whole).length === 0) { const t = trimJoint(whole); if (t) out.push({ text: t, hasRef: false, continues: false }); continue; }
    const sentences = line.split(/(?<=[!?。]|[^0-9]\.)\s+/).map(clean).filter(Boolean);
    let first = true;
    for (const sen of sentences) {
      const refs = findRefs(sen);
      if (refs.length <= 1) {
        const t = trimJoint(sen);
        if (t) out.push({ text: t, hasRef: refs.length === 1, continues: !first && refs.length === 0 });
      } else {
        for (let i = 0; i < refs.length; i += 1) {
          const from = i === 0 ? 0 : refs[i].at;
          const to = i + 1 < refs.length ? refs[i + 1].at : sen.length;
          const t = trimJoint(sen.slice(from, to));
          if (t) out.push({ text: t, hasRef: true, continues: false });
        }
      }
      first = false;
    }
  }
  return out.map((p) => ({ ...p, text: [...p.text].slice(0, AI_INSTRUCTION_MAX).join('') }));
}

/** 경기 정보 목록 → 이름 연결용 최소 payload(linkOperatorNotes 재사용). */
function asPayload(matches: readonly AiMatchInfo[]): PublicSpotlightPayload {
  const pm: PublicMatchAnalysis[] = matches.map((m) => ({
    matchNo: m.matchNo, round: m.round, group: m.group, teamA: m.teamA, teamB: m.teamB, badge: m.badge,
    prediction: { kind: 'insufficient' }, confidence: '데이터 부족', sampleRange: null, unanalyzedPlayers: 0,
  }));
  return { schema: 1, modelVersion: '', title: '', date: '', items: [], matches: pm, disclaimer: '' };
}

/**
 * 운영진 메모 → 지시별 경기 연결 제안. 같은 경기로 확정 · 제안된 지시는 하나로 합친다(카드 중복 방지).
 * 결과는 제안일 뿐 — linked 외에는 운영진 확인 · 선택 전까지 생성 · 적용에 쓰지 않는다(편집기 규칙).
 */
export function linkInstructions(memo: string, matches: readonly AiMatchInfo[]): InstructionLink[] {
  const pieces = splitInstructions(memo);
  const payload = asPayload(matches);
  const byNo = new Map(matches.map((m) => [m.matchNo, m]));
  const links: InstructionLink[] = [];
  for (const piece of pieces) {
    const instruction = piece.text;
    const refs = findRefs(instruction);
    const nameLink = linkOperatorNotes([instruction], payload)[0];
    // 단서도 선수 이름도 없는 이어지는 문장(예: "2번은 오픈부. 정말 기대돼.")은 바로 앞 지시에 붙인다.
    if (piece.continues && refs.length === 0 && (!nameLink || nameLink.status === 'none') && links.length) {
      const prev = links[links.length - 1];
      prev.instruction = [...`${prev.instruction} ${instruction}`].slice(0, AI_INSTRUCTION_MAX).join('');
      continue;
    }
    const nameCands = nameLink && nameLink.status !== 'none' ? (nameLink.matchNo ? [nameLink.matchNo] : nameLink.candidates) : [];
    const mentioned = nameLink?.mentioned || [];
    const base = { index: links.length, instruction, mentioned, refText: refs[0]?.text || '' };
    if (refs.length === 0) {
      const st = nameLink?.status;
      if (st === 'linked') links.push({ ...base, status: 'linked', matchNo: nameLink.matchNo, candidates: nameCands });
      else if (st === 'guess') links.push({ ...base, status: 'confirm', matchNo: nameLink.matchNo, candidates: nameCands });
      else if (st === 'choose') links.push({ ...base, status: 'choose', matchNo: null, candidates: nameCands });
      else links.push({ ...base, status: 'none', matchNo: null, candidates: [] });
      continue;
    }
    const r = refs[0].ref;
    const refCands = r.kind === 'no' ? (byNo.has(r.no) ? [r.no] : [])
      : matches.filter((m) => m.court === r.court && (r.kind === 'court' || m.round === r.round)).map((m) => m.matchNo);
    const strong = r.kind === 'rc'; // 라운드+코트는 화면에 보이는 정보
    if (refCands.length === 0) {
      links.push({ ...base, status: 'missing', matchNo: null, candidates: nameCands });
      continue;
    }
    if (nameCands.length > 0) {
      const both = refCands.filter((n) => nameCands.includes(n));
      if (both.length === 1) links.push({ ...base, status: 'linked', matchNo: both[0], candidates: both });
      else if (both.length > 1) links.push({ ...base, status: 'choose', matchNo: null, candidates: both });
      else links.push({ ...base, status: 'conflict', matchNo: null, candidates: [...new Set([...refCands, ...nameCands])].sort((a, b) => a - b) });
      continue;
    }
    if (refCands.length === 1) links.push({ ...base, status: strong ? 'linked' : 'confirm', matchNo: refCands[0], candidates: refCands });
    else links.push({ ...base, status: 'choose', matchNo: null, candidates: refCands.sort((a, b) => a - b) });
  }
  // 같은 경기 지시를 자동으로 합치지 않는다 — 편집기가 "같은 경기 두 개 · 하나로 합쳐 주세요"로 안내한다.
  return links.slice(0, AI_ITEMS_MAX).map((l, i) => ({ ...l, index: i }));
}

// ── 4) 결정적 검증 ────────────────────────────────────────────────────────────
export type DraftIssueCode =
  | 'empty' | 'too_long' | 'html' | 'other_player' | 'pii' | 'copies_instruction'   // block
  | 'instruction_like' | 'unsupported_number' | 'unsupported_claim'                // warn(확인 필요)
  | 'operator_fact';                                                                // info(운영진 제공 정보)
export interface DraftIssue { code: DraftIssueCode; severity: 'block' | 'warn' | 'info'; detail?: string }

export const DRAFT_ISSUE_TEXT: Record<DraftIssueCode, string> = {
  empty: '문구가 비어 있습니다.',
  too_long: `${OPERATOR_POINT_MAX}자를 넘습니다. 줄여 주세요.`,
  html: '< > 기호는 쓸 수 없습니다.',
  other_player: '이 경기 선수가 아닌 이름이 들어 있습니다',
  pii: '연락처 · 이메일 · 계좌 같은 개인정보로 보이는 내용이 있습니다.',
  copies_instruction: '운영진 지시문을 그대로 옮긴 문장입니다.',
  instruction_like: '작성 지시처럼 보이는 표현이 있습니다',
  unsupported_number: '지시 · 공식 기록에 없는 숫자입니다',
  unsupported_claim: '지시 · 공식 기록에 없는 경력 · 전적 · 관계 표현입니다',
  operator_fact: '운영진이 제공한 정보입니다(공식 기록 아님)',
};

// 근거가 필요한 표현 — 지시나 공식 문구에 같은 말이 없으면 경고.
const CLAIMS = ['우승', '준우승', '챔피언', '입상', '랭킹', '순위', '등급', '레벨', '선출', '선수 출신', '국가대표', '국대', '프로 출신',
  '전적', '맞대결', '연승', '연패', '승률', '천적', '라이벌', '설욕', '리턴 매치', '상승세', '하락세', '전성기', 'MVP',
  '오픈부', '신인부', '국화부', '개나리부', '부부', '형제', '자매', '남매', '가족', '친구', '동창', '사제', '커플', '연인'];
const RANK = /\d+\s*위(?![가-힣])/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/;
const LONG_DIGITS = /\d[\d-]{8,}\d/;
const PII_WORDS = /계좌|비밀번호|주민\s*번호|카톡\s*아이디|전화\s*번호/;

const norm = (s: string): string => String(s || '').replace(/\s+/g, '').toLowerCase();

export interface DraftCheckContext {
  instruction: string;
  /** 이 경기 선수(표시명). */
  own: readonly string[];
  /** 세션 전체 선수(표시명) — 다른 경기 선수 판정용. */
  all: readonly string[];
  /** 공식 헤드라인 · 관전 포인트(TOP 경기). */
  official: string;
  round: number;
  court: number | null;
  matchNo: number;
}

export function validateDraftText(text: string, ctx: DraftCheckContext): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [{ code: 'empty', severity: 'block' }];
  if ([...t].length > OPERATOR_POINT_MAX) issues.push({ code: 'too_long', severity: 'block', detail: String([...t].length) });
  if (/[<>]/.test(t)) issues.push({ code: 'html', severity: 'block' });
  const ownKeys = ctx.own.map(nameKey).filter(Boolean);
  const allKeys = [...new Set([...ctx.all, ...ctx.own].map(nameKey).filter(Boolean))];
  const others = findNames(t, allKeys).filter((k) => !ownKeys.includes(k));
  if (others.length) issues.push({ code: 'other_player', severity: 'block', detail: others.join(', ') });
  if (EMAIL.test(t) || PHONE.test(t) || LONG_DIGITS.test(t) || PII_WORDS.test(t)) issues.push({ code: 'pii', severity: 'block' });
  const ins = norm(ctx.instruction);
  if (ins.length >= 8 && (norm(t).includes(ins) || norm(t) === ins)) issues.push({ code: 'copies_instruction', severity: 'block' });
  const like = detectOperatorInstruction(t, ctx.instruction);
  if (like.length) issues.push({ code: 'instruction_like', severity: 'warn', detail: like.join(',') });
  // 숫자: 지시 · 공식 문구 · 라운드 · 코트 · 경기 번호에 있는 숫자만 허용
  const allowedNums = new Set([
    ...(`${ctx.instruction} ${ctx.official}`.match(/\d+/g) || []),
    String(ctx.round), String(ctx.matchNo), ...(ctx.court ? [String(ctx.court)] : []),
  ]);
  const badNums = [...new Set((t.match(/\d+/g) || []).filter((n) => !allowedNums.has(n)))];
  if (badNums.length) issues.push({ code: 'unsupported_number', severity: 'warn', detail: badNums.join(', ') });
  // 경력 · 전적 · 관계 표현
  const src = norm(`${ctx.instruction} ${ctx.official}`);
  const opSrc = norm(ctx.instruction);
  const offSrc = norm(ctx.official);
  const found = CLAIMS.filter((w) => norm(t).includes(norm(w)));
  if (RANK.test(t)) found.push('순위(N위)');
  const unsupported = found.filter((w) => !src.includes(norm(w)) && !(w === '순위(N위)' && RANK.test(`${ctx.instruction} ${ctx.official}`)));
  if (unsupported.length) issues.push({ code: 'unsupported_claim', severity: 'warn', detail: unsupported.join(', ') });
  const opFacts = found.filter((w) => opSrc.includes(norm(w)) && !offSrc.includes(norm(w)));
  if (opFacts.length) issues.push({ code: 'operator_fact', severity: 'info', detail: opFacts.join(', ') });
  return issues;
}

export const blockingIssues = (xs: readonly DraftIssue[]): DraftIssue[] => xs.filter((x) => x.severity === 'block');
export const warningIssues = (xs: readonly DraftIssue[]): DraftIssue[] => xs.filter((x) => x.severity === 'warn');
export const issueText = (x: DraftIssue): string => `${DRAFT_ISSUE_TEXT[x.code]}${x.detail && x.code !== 'too_long' && x.code !== 'instruction_like' ? `: ${x.detail}` : ''}`;

export function checkContextFor(m: AiMatchInfo, instruction: string, allNames: readonly string[]): DraftCheckContext {
  return { instruction, own: [...m.teamA, ...m.teamB].filter(Boolean), all: allNames, official: m.official, round: m.round, court: m.court, matchNo: m.matchNo };
}
export const allNamesOf = (matches: readonly AiMatchInfo[]): string[] =>
  [...new Set(matches.flatMap((m) => [...m.teamA, ...m.teamB]).filter(Boolean))];

// ── 2) AI 요청 경기(프롬프트 본문은 서버 전용 lib/kdk/server/spotlightAiPrompt.ts) ────────────────────────────────────────────────────────────
export interface DraftRequestItem { key: string; match: AiMatchInfo; instruction: string }

// ── 3) AI 출력 파싱 · 경기별 조립 ──────────────────────────────────────────────
export interface RawDraft { matchKey: string; text: string; usedFacts: string[] }

/** 문자열(코드 펜스 허용) 또는 객체 → drafts. 형식 오류면 null. */
export function parseAiDraftResponse(raw: unknown): RawDraft[] | null {
  let v: unknown = raw;
  if (typeof v === 'string') {
    const s = v.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const a = s.indexOf('{'); const b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { v = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  }
  if (!v || typeof v !== 'object' || !Array.isArray((v as any).drafts)) return null;
  const out: RawDraft[] = [];
  for (const d of (v as any).drafts.slice(0, 32)) {
    if (!d || typeof d !== 'object' || typeof d.matchKey !== 'string' || typeof d.text !== 'string') continue;
    out.push({ matchKey: d.matchKey.slice(0, 16), text: d.text.slice(0, 1000),
      usedFacts: Array.isArray(d.usedFacts) ? d.usedFacts.filter((x: unknown) => typeof x === 'string').slice(0, 8).map((x: string) => x.slice(0, 80)) : [] });
  }
  return out;
}

export type DraftCardStatus = 'ok' | 'review' | 'needs_fix' | 'missing';
export interface DraftCard {
  matchNo: number;
  ref: string;
  text: string;            // 검증 전 원문을 바꾸지 않는다(잘라내지 않음 — 수정은 운영진이)
  status: DraftCardStatus; // ok=문제 없음 · review=경고 확인 · needs_fix=차단 문제 · missing=AI 가 이 경기를 쓰지 않음
  issues: DraftIssue[];
}

/** AI 출력 → 요청 경기별 카드. 요청에 없는 키 · 중복 키는 버리고(ignoredKeys) 다른 카드에 영향을 주지 않는다. */
export function assembleDrafts(
  raw: unknown, items: readonly DraftRequestItem[], allNames: readonly string[],
): { ok: true; cards: DraftCard[]; ignoredKeys: string[] } | { ok: false; reason: 'ai_bad_output' } {
  const drafts = parseAiDraftResponse(raw);
  if (!drafts) return { ok: false, reason: 'ai_bad_output' };
  const byKey = new Map<string, RawDraft>();
  const ignoredKeys: string[] = [];
  const wanted = new Set(items.map((i) => i.key));
  for (const d of drafts) {
    if (!wanted.has(d.matchKey) || byKey.has(d.matchKey)) { ignoredKeys.push(d.matchKey); continue; }
    byKey.set(d.matchKey, d);
  }
  const cards = items.map((it): DraftCard => {
    const d = byKey.get(it.key);
    if (!d) return { matchNo: it.match.matchNo, ref: it.match.ref, text: '', status: 'missing', issues: [] };
    const text = d.text.replace(/\s+/g, ' ').trim();
    const issues = validateDraftText(text, checkContextFor(it.match, it.instruction, allNames));
    const status: DraftCardStatus = blockingIssues(issues).length ? 'needs_fix' : warningIssues(issues).length ? 'review' : 'ok';
    return { matchNo: it.match.matchNo, ref: it.match.ref, text, status, issues };
  });
  return { ok: true, cards, ignoredKeys };
}

/** 요청별 불투명 키(M1…) — 경기 번호 · id 를 AI 에 노출하지 않는다. */
export const draftKey = (i: number): string => `M${i + 1}`;
