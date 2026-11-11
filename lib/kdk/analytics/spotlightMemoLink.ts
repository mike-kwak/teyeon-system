// MATCH SPOTLIGHT 운영진 관전 포인트 — 메모 → 경기 자동 연결 · 공개 문구 검증(순수 계산 · 네트워크 · DB · 외부 AI 없음).
//
//   1) linkInstructions : 운영진 관전 메모(여러 경기) → 메모 조각별 경기 연결(규칙 기반).
//      "2번 경기" · "3경기" · "R2 1코트" · 선수 이름. 모호하면 자동 확정하지 않는다(확인 · 선택 요청).
//      ⚠ SPOTLIGHT 번호(matchNo)는 라운드 → 코트 순 내부 번호다. KDK 대진 화면에는 전체 경기 번호가 없으므로
//        "N번" 메모는 항상 운영진 확인을 받는다(confirm). 라운드+코트 · 선수 이름이 하나로 정해질 때만 자동 연결.
//   2) checkPublicText : 운영진이 쓴 공개 문구 검증(길이 · 꺾쇠 · 다른 경기 선수 · 개인정보).
//      작성 지시처럼 보이는 표현 경고는 spotlightOperator.detectOperatorInstruction(P0)이 맡는다.
//   메모 원문은 공개 문구로 복사하지 않는다 — 공개되는 것은 운영진이 직접 쓴 공개 문구뿐이다.

import {
  findNames, linkOperatorNotes, nameKey, sanitizeOperatorText,
  OPERATOR_NOTE_MAX, OPERATOR_NOTES_MAX, OPERATOR_POINT_MAX,
} from './spotlightOperator';
import type { PublicMatchAnalysis, PublicSpotlightPayload } from './publicSpotlight';
import type { SpotlightType } from './spotlight';

export const MEMO_MAX = 1000;                    // 메모 전체 글자 수
export const MEMO_PIECE_MAX = OPERATOR_NOTE_MAX; // 경기별 메모 조각 200자
export const MEMO_LINKS_MAX = OPERATOR_NOTES_MAX; // 한 번에 연결하는 최대 경기 수(8)

// ── 경기 정보(관리자 화면) ────────────────────────────────────────────────────
export interface SpotlightMatchInfo {
  matchNo: number;
  round: number;
  court: number | null;
  group: string;
  teamA: [string, string];
  teamB: [string, string];
  badge: SpotlightType | null;
  inTop: boolean;
  /** 현재 경기 상태(waiting · playing · complete …). 모르면 ''. */
  status: string;
}

export const matchInfoLabel = (m: Pick<SpotlightMatchInfo, 'round' | 'court' | 'group' | 'matchNo' | 'teamA' | 'teamB'>): string =>
  `R${m.round}${m.court ? ` · ${m.court}코트` : ''}${m.group ? ` · ${m.group}조` : ''} · ${m.matchNo}경기 — `
  + `${m.teamA.filter(Boolean).join('·')} vs ${m.teamB.filter(Boolean).join('·')}`;

// ── 1) 메모 분리 · 경기 연결 ──────────────────────────────────────────────────
export type InstructionStatus =
  | 'linked'    // 확실(라운드+코트 · 선수 이름이 한 경기로 정해짐 · 번호와 이름 일치)
  | 'confirm'   // 후보 1개지만 확인 필요(번호만 · 성 뺀 이름 추정)
  | 'choose'    // 후보 여러 경기
  | 'conflict'  // 번호와 선수 이름이 서로 다른 경기를 가리킴
  | 'missing'   // 그 번호 · 코트의 경기가 없음
  | 'none';     // 경기 단서 없음

export interface InstructionLink {
  index: number;
  instruction: string;      // 정리된 메모 조각(비공개)
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

/** 메모 → 조각. 줄 · 문장(. ! ? 。 — 소수점 제외) 단위로 나누고, 한 문장에 경기 단서가 여럿이면 단서마다 나눈다. */
export function splitInstructions(memo: string): InstructionPiece[] {
  const text = String(memo || '').slice(0, MEMO_MAX);
  const out: InstructionPiece[] = [];
  for (const line of text.split(/\r?\n+/)) {
    // 경기 단서(번호 · 코트)가 없는 줄은 줄 전체가 조각 하나(기존 메모 연결과 같음 — 호흡 · 라이벌 단서 유지).
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
  return out.map((p) => ({ ...p, text: [...p.text].slice(0, MEMO_PIECE_MAX).join('') }));
}

/** 경기 정보 목록 → 이름 연결용 최소 payload(linkOperatorNotes 재사용). */
function asPayload(matches: readonly SpotlightMatchInfo[]): PublicSpotlightPayload {
  const pm: PublicMatchAnalysis[] = matches.map((m) => ({
    matchNo: m.matchNo, round: m.round, group: m.group, teamA: m.teamA, teamB: m.teamB, badge: m.badge,
    prediction: { kind: 'insufficient' }, confidence: '데이터 부족', sampleRange: null, unanalyzedPlayers: 0,
  }));
  return { schema: 1, modelVersion: '', title: '', date: '', items: [], matches: pm, disclaimer: '' };
}

/**
 * 운영진 메모 → 조각별 경기 연결 제안.
 * 결과는 제안일 뿐 — linked 외에는 운영진 확인 · 선택 전까지 적용에 쓰지 않는다(편집기 규칙).
 */
export function linkInstructions(memo: string, matches: readonly SpotlightMatchInfo[]): InstructionLink[] {
  const pieces = splitInstructions(memo);
  const payload = asPayload(matches);
  const byNo = new Map(matches.map((m) => [m.matchNo, m]));
  const links: InstructionLink[] = [];
  for (const piece of pieces) {
    const instruction = piece.text;
    const refs = findRefs(instruction);
    const nameLink = linkOperatorNotes([instruction], payload)[0];
    // 단서도 선수 이름도 없는 이어지는 문장(예: "2번은 오픈부. 정말 기대돼.")은 바로 앞 조각에 붙인다.
    if (piece.continues && refs.length === 0 && (!nameLink || nameLink.status === 'none') && links.length) {
      const prev = links[links.length - 1];
      prev.instruction = [...`${prev.instruction} ${instruction}`].slice(0, MEMO_PIECE_MAX).join('');
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
  // 같은 경기 조각을 자동으로 합치지 않는다 — 편집기가 "같은 경기 두 개 · 하나로 합쳐 주세요"로 안내한다.
  return links.slice(0, MEMO_LINKS_MAX).map((l, i) => ({ ...l, index: i }));
}

// ── 2) 공개 문구 검증(결정적) ─────────────────────────────────────────────────
export type TextIssueCode = 'too_long' | 'html' | 'other_player' | 'pii';
export interface TextIssue { code: TextIssueCode; severity: 'block' | 'warn'; detail?: string }

export const TEXT_ISSUE_TEXT: Record<TextIssueCode, string> = {
  too_long: `${OPERATOR_POINT_MAX}자를 넘습니다. 줄여 주세요.`,
  html: '< > 기호는 쓸 수 없습니다.',
  other_player: '이 경기 선수가 아닌 이름이 들어 있습니다',
  pii: '연락처 · 이메일 · 계좌 같은 개인정보로 보이는 내용이 있습니다.',
};

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/;
// 계좌 · 카드 같은 긴 숫자: 숫자만 10자리 이상(날짜 2026-11-08 · 점수 6-4 는 제외)
const LONG_DIGITS = /\d[\d\s-]{8,}\d/g;
const hasLongDigits = (t: string): boolean => (t.match(LONG_DIGITS) || []).some((m) => m.replace(/\D/g, '').length >= 10);
const PII_WORDS = /계좌|비밀번호|주민\s*번호|카톡\s*아이디|전화\s*번호/;

/**
 * 공개 문구 검증. 빈 문구는 검증하지 않는다(빈 경기는 관전 포인트 없이 공개).
 *   own: 이 경기 선수 표시명 · all: 세션 전체 선수 표시명(다른 경기 선수 판정용).
 *   approved=true(이미 공개 중인 같은 문구)면 차단 대신 경고로만 표시 — 기존 승인 문구를 새 규칙으로 막지 않는다.
 */
export function checkPublicText(text: string, own: readonly string[], all: readonly string[], approved = false): TextIssue[] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const issues: TextIssue[] = [];
  if ([...t].length > OPERATOR_POINT_MAX) issues.push({ code: 'too_long', severity: 'block', detail: String([...t].length) });
  if (/[<>]/.test(t)) issues.push({ code: 'html', severity: 'block' });
  const ownKeys = own.map(nameKey).filter(Boolean);
  const allKeys = [...new Set([...all, ...own].map(nameKey).filter(Boolean))];
  const others = findNames(t, allKeys).filter((k) => !ownKeys.includes(k));
  if (others.length) issues.push({ code: 'other_player', severity: 'block', detail: others.join(', ') });
  if (EMAIL.test(t) || PHONE.test(t) || hasLongDigits(t) || PII_WORDS.test(t)) issues.push({ code: 'pii', severity: 'block' });
  return approved ? issues.map((x) => ({ ...x, severity: 'warn' as const })) : issues;
}

export const blockingIssues = (xs: readonly TextIssue[]): TextIssue[] => xs.filter((x) => x.severity === 'block');
export const issueText = (x: TextIssue): string => `${TEXT_ISSUE_TEXT[x.code]}${x.detail && x.code !== 'too_long' ? `: ${x.detail}` : ''}`;
export const allNamesOf = (matches: readonly SpotlightMatchInfo[]): string[] =>
  [...new Set(matches.flatMap((m) => [...m.teamA, ...m.teamB]).filter(Boolean))];
