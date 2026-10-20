// 대회 문자 안내 센터 — 순수 로직(화면 · 네트워크 없음).
//
//   ⚠ 문자를 보내지 않는다. 운영진이 번호 · 문구를 복사해 휴대폰 문자 앱으로 직접 보낸다.
//   ⚠ 참가 신청 원본을 바꾸지 않는다. 원본(관리자 RPC 결과)을 읽어 발송 후보를 계산할 뿐이다.
//   ⚠ 전화번호를 로그 · 콘솔에 남기지 않는다. 이 파일의 함수는 값을 돌려주기만 한다.
//   ⚠ 참가 규모(54팀 등)를 하드코딩하지 않는다 — 들어온 신청 수만큼 계산한다.

// ── 원본 입력 형태 ───────────────────────────────────────────────────────────
export type SmsRegistrationStatus = 'applied' | 'waitlisted' | 'confirmed' | 'cancelled' | 'rejected';

export interface SmsRegistration {
  id: string;
  sequenceNo: number;
  registrationNo: string;
  player1Name: string;
  player1Phone: string;
  player2Name: string;
  player2Phone: string;
  registrationStatus: SmsRegistrationStatus | string;
  paymentStatus: string;
}

export interface SmsTeam {
  registrationId: string | null;
  teamNo: number;
  status: 'active' | 'withdrawn' | string;
}

// ── 전화번호 정규화 · 검증 ─────────────────────────────────────────────────────
/**
 * ok        정상
 * empty     빈 번호
 * invalid   형식 오류(국내 휴대폰 번호가 아님)
 * temporary 명백한 임시 번호(010-0000-0000) — 발송에서 제외
 * review    수동 확인 필요(반복 · 연속 숫자, 옛 10자리 010 등) — 기본 제외, 관리자가 포함할 수 있다
 */
export type PhoneCheck = 'ok' | 'empty' | 'invalid' | 'temporary' | 'review';

export const PHONE_CHECK_LABEL: Record<PhoneCheck, string> = {
  ok: '정상',
  empty: '빈 번호',
  invalid: '형식 오류',
  temporary: '임시 번호',
  review: '확인 필요',
};

export interface NormalizedPhone {
  /** 숫자만(정상 · 확인 필요일 때만 값이 있다). */
  digits: string;
  /** 010-1234-5678 형식(digits 가 있을 때). 형식 오류면 원문을 그대로. */
  display: string;
  check: PhoneCheck;
  /** 확인 필요 사유(사람이 읽는 문장). */
  reason: string | null;
}

const SEQ_UP = '01234567890123';
const SEQ_DOWN = '98765432109876';

export function formatKrMobile(digits: string): string {
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
}

/**
 * 국내 휴대폰 번호 정규화. '01012345678' · '010-1234-5678' · '010 1234 5678' · '+82 10-1234-5678' → 같은 값.
 *   ⚠ 실제로 쓰일 수 있는 번호를 과하게 막지 않는다 — 애매하면 'review'(관리자 판단)로 둔다.
 */
export function normalizeKrMobile(raw: string | null | undefined): NormalizedPhone {
  const src = (raw ?? '').trim();
  if (!src) return { digits: '', display: '', check: 'empty', reason: null };
  // 숫자 · 공백 · 하이픈 · 점 · 괄호 · 맨 앞 + 만 허용. 그 밖의 글자가 있으면 형식 오류.
  if (!/^\+?[0-9\s\-.()]+$/.test(src)) return { digits: '', display: src, check: 'invalid', reason: null };
  let d = src.replace(/[^0-9]/g, '');
  if (src.startsWith('+82') || (d.startsWith('82') && d.length >= 11 && d.length <= 12 && d[2] === '1')) {
    d = '0' + d.slice(2);
  }
  if (!d) return { digits: '', display: '', check: 'empty', reason: null };
  if (!/^01[0-9]{8,9}$/.test(d)) return { digits: '', display: src, check: 'invalid', reason: null };
  const display = formatKrMobile(d);
  if (d === '01000000000') return { digits: '', display, check: 'temporary', reason: '임시 번호(010-0000-0000)' };
  const prefix = d.slice(0, 3);
  const rest = d.slice(3);
  const mid = d.length === 11 ? d.slice(3, 7) : d.slice(3, 6);
  const last = d.slice(-4);
  let reason: string | null = null;
  if (/^(\d)\1+$/.test(rest)) reason = '같은 숫자 반복';
  else if (SEQ_UP.includes(rest) || SEQ_DOWN.includes(rest)) reason = '연속 숫자';
  else if (/^0+$/.test(mid) || last === '0000') reason = '0000 포함';
  else if (prefix === '010' && d.length !== 11) reason = '010 번호가 10자리';
  else if (!['010', '011', '016', '017', '018', '019'].includes(prefix)) reason = `${prefix} 국번`;
  if (reason) return { digits: d, display, check: 'review', reason };
  return { digits: d, display, check: 'ok', reason: null };
}

/** 목록용 가림 — 010-****-5678. 원문은 '전체 번호 보기'에서만. */
export function maskKrMobile(display: string): string {
  const d = display.replace(/[^0-9]/g, '');
  if (d.length < 7) return display ? '***' : '';
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

// ── 주소록 ───────────────────────────────────────────────────────────────────
export type Participation = 'confirmed' | 'applied' | 'waitlisted' | 'cancelled' | 'rejected' | 'withdrawn' | 'unknown';

export const PARTICIPATION_LABEL: Record<Participation, string> = {
  confirmed: '참가확정',
  applied: '접수(미확정)',
  waitlisted: '대기',
  cancelled: '취소',
  rejected: '거절',
  withdrawn: '기권',
  unknown: '상태 미상',
};

export interface ContactEntry {
  /** `${registrationId}:${slot}` — 화면 · 스냅샷 공통 키. */
  key: string;
  registrationId: string;
  slot: 1 | 2;
  /** 화면 순번(1..N). */
  order: number;
  sequenceNo: number;
  registrationNo: string;
  teamNo: number | null;
  name: string;
  phone: NormalizedPhone;
  participation: Participation;
  paymentStatus: string;
  /** 같은 번호를 쓰는 다른 항목 키(본인 제외). 정상 · 확인 필요 번호만 비교한다. */
  sharedWith: string[];
}

export interface AddressBook {
  entries: ContactEntry[];
  byKey: Map<string, ContactEntry>;
  registrations: number;
  /** 상태별 신청 수. */
  statusCounts: Record<Participation, number>;
  checkCounts: Record<PhoneCheck, number>;
  /** 같은 번호를 2명 이상이 쓰는 묶음 수 · 관련 인원. */
  sharedGroups: number;
  sharedEntries: number;
}

const participationOf = (status: string, team: SmsTeam | undefined): Participation => {
  if (status === 'confirmed') return team && team.status === 'withdrawn' ? 'withdrawn' : 'confirmed';
  if (status === 'applied' || status === 'waitlisted' || status === 'cancelled' || status === 'rejected') return status;
  return 'unknown';
};

export function buildAddressBook(regs: SmsRegistration[], teams: SmsTeam[]): AddressBook {
  const teamByReg = new Map<string, SmsTeam>();
  teams.forEach((t) => { if (t.registrationId) teamByReg.set(t.registrationId, t); });
  const sorted = [...regs].sort((a, b) => {
    const ta = teamByReg.get(a.id)?.teamNo ?? Number.MAX_SAFE_INTEGER;
    const tb = teamByReg.get(b.id)?.teamNo ?? Number.MAX_SAFE_INTEGER;
    return ta - tb || a.sequenceNo - b.sequenceNo;
  });
  const entries: ContactEntry[] = [];
  const statusCounts = { confirmed: 0, applied: 0, waitlisted: 0, cancelled: 0, rejected: 0, withdrawn: 0, unknown: 0 } as Record<Participation, number>;
  for (const r of sorted) {
    const team = teamByReg.get(r.id);
    const participation = participationOf(String(r.registrationStatus), team);
    statusCounts[participation] += 1;
    ([1, 2] as const).forEach((slot) => {
      entries.push({
        key: `${r.id}:${slot}`,
        registrationId: r.id,
        slot,
        order: entries.length + 1,
        sequenceNo: r.sequenceNo,
        registrationNo: r.registrationNo,
        teamNo: team ? team.teamNo : null,
        name: (slot === 1 ? r.player1Name : r.player2Name) || '',
        phone: normalizeKrMobile(slot === 1 ? r.player1Phone : r.player2Phone),
        participation,
        paymentStatus: r.paymentStatus,
        sharedWith: [],
      });
    });
  }
  const byDigits = new Map<string, ContactEntry[]>();
  entries.forEach((e) => {
    if (!e.phone.digits) return;
    const list = byDigits.get(e.phone.digits) ?? [];
    list.push(e); byDigits.set(e.phone.digits, list);
  });
  let sharedGroups = 0; let sharedEntries = 0;
  byDigits.forEach((list) => {
    if (list.length < 2) return;
    sharedGroups += 1; sharedEntries += list.length;
    list.forEach((e) => { e.sharedWith = list.filter((x) => x !== e).map((x) => x.key); });
  });
  const checkCounts = { ok: 0, empty: 0, invalid: 0, temporary: 0, review: 0 } as Record<PhoneCheck, number>;
  entries.forEach((e) => { checkCounts[e.phone.check] += 1; });
  return {
    entries, byKey: new Map(entries.map((e) => [e.key, e])), registrations: regs.length,
    statusCounts, checkCounts, sharedGroups, sharedEntries,
  };
}

/** 상태 필터 때문에 대상에서 빠지는 신청(팀 단위) — 운영자가 누락을 알아차리게 한다. */
export interface AudienceGaps {
  /** 지금 고른 참가 상태에 들지 않는 접수(미확정) · 대기 신청 수. */
  applied: number;
  waitlisted: number;
  /** 참가팀 번호(DRAW)가 있는데 신청 상태가 참가확정이 아닌 신청 수 — 기권 제외. */
  teamNotConfirmed: number;
  /** 참가확정인데 참가팀 번호가 없는 신청 수(참가팀이 하나라도 있을 때만 센다). */
  confirmedNoTeam: number;
  unknown: number;
}

export function audienceGaps(book: AddressBook, statuses: Participation[]): AudienceGaps {
  const regs = new Map<string, ContactEntry>();
  book.entries.forEach((e) => { if (e.slot === 1) regs.set(e.registrationId, e); });
  const anyTeam = book.entries.some((e) => e.teamNo != null);
  const g: AudienceGaps = { applied: 0, waitlisted: 0, teamNotConfirmed: 0, confirmedNoTeam: 0, unknown: 0 };
  regs.forEach((e) => {
    const p = e.participation;
    if (p === 'applied' && !statuses.includes('applied')) g.applied += 1;
    if (p === 'waitlisted' && !statuses.includes('waitlisted')) g.waitlisted += 1;
    if (p === 'unknown') g.unknown += 1;
    if (e.teamNo != null && p !== 'confirmed' && p !== 'withdrawn' && !statuses.includes(p)) g.teamNotConfirmed += 1;
    if (anyTeam && e.teamNo == null && p === 'confirmed' && statuses.includes('confirmed')) g.confirmedNoTeam += 1;
  });
  return g;
}

/** 사람이 읽는 참가자 이름표 — '12번 팀 · 홍길동(선수 1)' / 팀 미배정이면 신청 번호. */
export function entryLabel(e: ContactEntry): string {
  const who = `${e.name || '(이름 없음)'}(선수 ${e.slot})`;
  return e.teamNo != null ? `${e.teamNo}번 팀 · ${who}` : `${e.registrationNo || `신청 ${e.sequenceNo}`} · ${who}`;
}

// ── 발송 대상 선택 ─────────────────────────────────────────────────────────────
export type AudienceMode = 'all' | 'p1' | 'p2' | 'teams' | 'custom';

export const AUDIENCE_LABEL: Record<AudienceMode, string> = {
  all: '전체',
  p1: '선수 1만',
  p2: '선수 2만',
  teams: '특정 팀',
  custom: '직접 선택',
};

export interface AudienceFilter {
  mode: AudienceMode;
  /** 포함할 참가 상태 — 기본은 참가확정만. */
  statuses: Participation[];
  /** mode = teams 일 때 팀 번호. */
  teamNos: number[];
  /** mode = custom 일 때 고른 항목 키. */
  pickedKeys: string[];
  /** 관리자가 직접 뺀 항목(모든 모드에 적용). */
  excludedKeys: string[];
  /** '확인 필요' 번호 중 관리자가 포함하기로 한 항목. */
  reviewIncludedKeys: string[];
}

export const DEFAULT_AUDIENCE: AudienceFilter = {
  mode: 'all', statuses: ['confirmed'], teamNos: [], pickedKeys: [], excludedKeys: [], reviewIncludedKeys: [],
};

export type RecipientState = 'included' | 'duplicate' | 'excluded' | 'error' | 'review';

export interface RecipientRow { entry: ContactEntry; state: RecipientState; dupOf: string | null }

export interface RecipientResult {
  rows: RecipientRow[];
  /** 최종 발송 번호(숫자만 · 중복 제거 · 화면 순서). */
  numbers: string[];
  counts: {
    candidates: number;
    valid: number;
    duplicateRemoved: number;
    errorRemoved: number;
    reviewHeld: number;
    manualExcluded: number;
    final: number;
  };
}

export function inAudienceScope(e: ContactEntry, f: AudienceFilter): boolean {
  if (f.mode === 'custom') return f.pickedKeys.includes(e.key);
  if (!f.statuses.includes(e.participation)) return false;
  if (f.mode === 'p1' && e.slot !== 1) return false;
  if (f.mode === 'p2' && e.slot !== 2) return false;
  if (f.mode === 'teams' && (e.teamNo == null || !f.teamNos.includes(e.teamNo))) return false;
  return true;
}

export function selectRecipients(book: AddressBook, f: AudienceFilter): RecipientResult {
  const excluded = new Set(f.excludedKeys);
  const reviewOk = new Set(f.reviewIncludedKeys);
  const seen = new Map<string, string>();
  const rows: RecipientRow[] = [];
  const numbers: string[] = [];
  const counts = { candidates: 0, valid: 0, duplicateRemoved: 0, errorRemoved: 0, reviewHeld: 0, manualExcluded: 0, final: 0 };
  for (const e of book.entries) {
    if (!inAudienceScope(e, f)) continue;
    counts.candidates += 1;
    if (excluded.has(e.key)) { counts.manualExcluded += 1; rows.push({ entry: e, state: 'excluded', dupOf: null }); continue; }
    const c = e.phone.check;
    if (c === 'empty' || c === 'invalid' || c === 'temporary') { counts.errorRemoved += 1; rows.push({ entry: e, state: 'error', dupOf: null }); continue; }
    if (c === 'review' && !reviewOk.has(e.key)) { counts.reviewHeld += 1; rows.push({ entry: e, state: 'review', dupOf: null }); continue; }
    counts.valid += 1;
    const first = seen.get(e.phone.digits);
    if (first) { counts.duplicateRemoved += 1; rows.push({ entry: e, state: 'duplicate', dupOf: first }); continue; }
    seen.set(e.phone.digits, e.key);
    numbers.push(e.phone.digits);
    rows.push({ entry: e, state: 'included', dupOf: null });
  }
  counts.final = numbers.length;
  return { rows, numbers, counts };
}

/** 대상 설명 — 발송 기록에 남긴다(번호 없음). */
export function audienceSummary(f: AudienceFilter): string {
  const st = f.mode === 'custom' ? '' : f.statuses.map((s) => PARTICIPATION_LABEL[s]).join('+');
  const base = f.mode === 'teams' ? `${AUDIENCE_LABEL.teams}(${f.teamNos.slice(0, 6).join(', ')}${f.teamNos.length > 6 ? ' …' : ''})`
    : f.mode === 'custom' ? `${AUDIENCE_LABEL.custom} ${f.pickedKeys.length}명` : AUDIENCE_LABEL[f.mode];
  return [st, base, f.excludedKeys.length ? `제외 ${f.excludedKeys.length}` : ''].filter(Boolean).join(' · ').slice(0, 120);
}

// ── 배치 · 복사 문자열 ─────────────────────────────────────────────────────────
export const BATCH_SIZES = [10, 20, 30, 50] as const;
export const DEFAULT_BATCH_SIZE = 20;

export interface Batch { index: number; total: number; from: number; to: number; numbers: string[]; label: string }

export function splitBatches(numbers: string[], size: number): Batch[] {
  const n = Math.max(1, Math.min(500, Math.floor(size) || DEFAULT_BATCH_SIZE));
  const total = Math.ceil(numbers.length / n);
  const out: Batch[] = [];
  for (let i = 0; i < total; i++) {
    const from = i * n + 1; const to = Math.min(numbers.length, (i + 1) * n);
    out.push({ index: i + 1, total, from, to, numbers: numbers.slice(from - 1, to), label: `${i + 1}/${total} (${from}–${to})` });
  }
  return out;
}

export type NumberSeparator = 'comma' | 'newline';

export function joinNumbers(numbers: string[], sep: NumberSeparator, hyphen = true): string {
  const list = numbers.map((d) => (hyphen ? formatKrMobile(d) : d));
  return list.join(sep === 'newline' ? '\n' : ', ');
}

// ── CSV ───────────────────────────────────────────────────────────────────────
const csvCell = (v: string | number | null | undefined): string => {
  let s = v === null || v === undefined ? '' : String(v);
  // 스프레드시트 수식 실행 방지(=, +, -, @, 탭, CR 로 시작하면 앞에 ' 를 붙인다).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const STATE_LABEL: Record<RecipientState, string> = {
  included: '발송 대상', duplicate: '중복 제외', excluded: '관리자 제외', error: '번호 오류 제외', review: '확인 필요(보류)',
};

/** 주소록 CSV(엑셀 한글용 BOM · CRLF). 번호는 010-0000-0000 형식(앞자리 0 보존). */
export function buildContactsCsv(book: AddressBook, result: RecipientResult | null): string {
  const stateByKey = new Map<string, RecipientRow>();
  result?.rows.forEach((r) => stateByKey.set(r.entry.key, r));
  const head = ['순번', '팀번호', '신청번호', '선수구분', '이름', '전화번호', '참가상태', '번호상태', '중복(같은 번호 공유)', '발송대상'];
  const lines = [head.map(csvCell).join(',')];
  for (const e of book.entries) {
    const row = stateByKey.get(e.key);
    lines.push([
      e.order, e.teamNo ?? '', e.registrationNo, `선수 ${e.slot}`, e.name,
      e.phone.digits ? formatKrMobile(e.phone.digits) : e.phone.display,
      PARTICIPATION_LABEL[e.participation], PHONE_CHECK_LABEL[e.phone.check],
      e.sharedWith.length ? `${e.sharedWith.length + 1}명 공유` : '',
      row ? STATE_LABEL[row.state] : '대상 아님',
    ].map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ── 안내 URL ──────────────────────────────────────────────────────────────────
export type SmsUrlKey = 'home' | 'draw' | 'my_match' | 'knockout' | 'live' | 'results' | 'video';

export const PUBLIC_SITE_ORIGIN = 'https://teyeon-system.vercel.app';

export const URL_DEFS: { key: SmsUrlKey; label: string; token: string; path: ((slug: string) => string) | null }[] = [
  { key: 'home', label: '대회 홈', token: '{대회홈URL}', path: (s) => `/tournaments/${s}` },
  { key: 'draw', label: '예선 대진표', token: '{대진표URL}', path: (s) => `/tournaments/${s}/draw` },
  { key: 'my_match', label: 'MY MATCH', token: '{MY_MATCH_URL}', path: (s) => `/tournaments/${s}/draw/my` },
  { key: 'knockout', label: '본선 대진표', token: '{본선URL}', path: (s) => `/tournaments/${s}/draw/knockout` },
  { key: 'live', label: 'LIVE 중계', token: '{LIVE_URL}', path: null },
  { key: 'results', label: '대회 결과', token: '{결과URL}', path: null },
  { key: 'video', label: '하이라이트 영상', token: '{영상URL}', path: null },
];

/** 서버(save_sms_url)와 같은 규칙 — https:// 만, 공백 · 따옴표 · 꺾쇠 · 제어문자 없음, 500자 이내. */
export function isSafeHttpsUrl(url: string): boolean {
  const u = url.trim();
  if (!u || u.length > 500) return false;
  return /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^\s<>"'`\u0000-\u001f\u007f]*)?$/.test(u);
}

export interface ResolvedUrl { key: SmsUrlKey; label: string; token: string; url: string; source: 'saved' | 'default' | 'none'; safe: boolean }

export function resolveUrls(slug: string, saved: Partial<Record<SmsUrlKey, string>>): ResolvedUrl[] {
  return URL_DEFS.map((d) => {
    const s = (saved[d.key] || '').trim();
    if (s) return { key: d.key, label: d.label, token: d.token, url: s, source: 'saved' as const, safe: isSafeHttpsUrl(s) };
    if (d.path) {
      const u = PUBLIC_SITE_ORIGIN + d.path(encodeURIComponent(slug));
      return { key: d.key, label: d.label, token: d.token, url: u, source: 'default' as const, safe: true };
    }
    return { key: d.key, label: d.label, token: d.token, url: '', source: 'none' as const, safe: false };
  });
}

// ── 템플릿 ───────────────────────────────────────────────────────────────────
export type SmsTemplateKey = 'draw_checkin' | 'day_notice' | 'live_qf' | 'results' | 'highlight';

export interface TemplateDefault { key: SmsTemplateKey; no: string; title: string; body: string; needsPublishedDraw: boolean }

export const DEFAULT_TEMPLATES: TemplateDefault[] = [
  {
    key: 'draw_checkin', no: '01', title: '예선 대진표 · 출전 신고', needsPublishedDraw: true,
    body: [
      '[{대회명}] 예선 대진표 안내',
      '{대회일} 대회의 예선 대진표가 공개되었습니다.',
      '',
      '▶ 예선 대진표: {대진표URL}',
      '▶ MY MATCH(내 경기 알림): {MY_MATCH_URL}',
      '',
      '■ 출전 신고 장소: {신고장소}',
      '■ 첫 번째 조: {첫조마감}까지 신고 · {첫조시작}',
      '■ 두 번째 조: {둘째조마감}까지 신고 · {둘째조시작}',
      '',
      '대진표에서 내 조의 코트와 신고 시간을 꼭 확인해 주세요.',
      '- TEYEON Tennis Club',
    ].join('\n'),
  },
  {
    key: 'day_notice', no: '02', title: '대회 당일 공지', needsPublishedDraw: true,
    body: [
      '[{대회명}] 대회 당일 안내',
      '오늘 대회가 열립니다. 도착하시면 {신고장소}에서 출전 신고를 해 주세요.',
      '',
      '■ 출전 신고 마감: 첫 번째 조 {첫조마감} · 두 번째 조 {둘째조마감}',
      '▶ 경기 진행 확인: {대진표URL}',
      '▶ 코트 변경 · 호출 확인(MY MATCH): {MY_MATCH_URL}',
      '',
      '현장 상황에 따라 코트가 바뀔 수 있으며, 현장 운영진의 안내가 우선합니다.',
      '- TEYEON Tennis Club',
    ].join('\n'),
  },
  {
    key: 'live_qf', no: '03', title: '8강 LIVE 중계', needsPublishedDraw: false,
    body: [
      '[{대회명}] 8강 LIVE 중계 시작',
      '8강 경기를 TEYEON 플랫폼에서 실시간으로 중계합니다.',
      '',
      '▶ LIVE 보기: {LIVE_URL}',
      '',
      '경기 상황을 실시간으로 확인해 주세요.',
      '- TEYEON Tennis Club',
    ].join('\n'),
  },
  {
    key: 'results', no: '04', title: '대회 결과', needsPublishedDraw: false,
    body: [
      '[{대회명}] 대회 결과 안내',
      '{대회명} 일정이 모두 끝났습니다. 참가해 주신 모든 분께 감사드립니다.',
      '',
      '▶ 최종 결과 · 우승 및 입상 확인: {결과URL}',
      '',
      '- TEYEON Tennis Club',
    ].join('\n'),
  },
  {
    key: 'highlight', no: '05', title: '하이라이트 영상', needsPublishedDraw: false,
    body: [
      '[{대회명}] 하이라이트 영상 공개',
      '대회 하이라이트 영상이 공개되었습니다.',
      '',
      '▶ 영상 보기: {영상URL}',
      '',
      '함께해 주셔서 감사합니다.',
      '- TEYEON Tennis Club',
    ].join('\n'),
  },
];

export const TEMPLATE_DEFAULT_BY_KEY = new Map(DEFAULT_TEMPLATES.map((t) => [t.key, t]));

export interface StoredTemplate { title: string | null; body: string | null; version: number; updatedAt: string | null }

export interface EffectiveTemplate extends TemplateDefault { isDefault: boolean; version: number; updatedAt: string | null }

export function effectiveTemplates(stored: Partial<Record<SmsTemplateKey, StoredTemplate>>): EffectiveTemplate[] {
  return DEFAULT_TEMPLATES.map((d) => {
    const s = stored[d.key];
    const custom = !!(s && s.title && s.body);
    return {
      ...d,
      title: custom ? (s!.title as string) : d.title,
      body: custom ? (s!.body as string) : d.body,
      isDefault: !custom,
      version: s ? s.version : 0,
      updatedAt: s ? s.updatedAt : null,
    };
  });
}

// ── 변수 치환 ────────────────────────────────────────────────────────────────
export interface VarDef { token: string; label: string }

/** 표준 변수 — 템플릿 본문에서 이 이름만 쓴다(중괄호 포함). */
export const TEMPLATE_VARS: VarDef[] = [
  { token: '{대회명}', label: '대회명' },
  { token: '{대회일}', label: '대회일' },
  ...URL_DEFS.map((d) => ({ token: d.token, label: `${d.label} URL` })),
  { token: '{신고장소}', label: '출전 신고 장소' },
  { token: '{첫조마감}', label: '첫 번째 조 신고 마감' },
  { token: '{둘째조마감}', label: '두 번째 조 신고 마감' },
  { token: '{첫조시작}', label: '첫 번째 조 시작' },
  { token: '{둘째조시작}', label: '두 번째 조 시작' },
];
const KNOWN = new Set(TEMPLATE_VARS.map((v) => v.token));

export interface RenderResult {
  text: string;
  /** 값이 비어 있는 변수(그대로 남는다). */
  missing: string[];
  /** 정의되지 않은 변수(오타 등 — 그대로 남는다). */
  unknown: string[];
  /** 본문에 쓰인 URL 중 안전하지 않은 값. */
  unsafeUrls: string[];
  ready: boolean;
}

export function renderTemplate(body: string, values: Record<string, string>, urlTokens: Set<string>): RenderResult {
  const missing = new Set<string>(); const unknown = new Set<string>(); const unsafe = new Set<string>();
  const text = body.replace(/\{[^{}\n]{1,24}\}/g, (tok) => {
    if (!KNOWN.has(tok)) { unknown.add(tok); return tok; }
    const v = (values[tok] ?? '').trim();
    if (!v) { missing.add(tok); return tok; }
    if (urlTokens.has(tok) && !isSafeHttpsUrl(v)) { unsafe.add(tok); return tok; }
    return v;
  });
  return { text, missing: [...missing], unknown: [...unknown], unsafeUrls: [...unsafe], ready: missing.size === 0 && unknown.size === 0 && unsafe.size === 0 };
}

export interface ScheduleValues {
  checkinPlace: string | null;
  session1Deadline: string | null;
  session1Start: string | null;
  session1Note: string | null;
  session2Deadline: string | null;
  session2Start: string | null;
  session2Note: string | null;
}

const startText = (time: string | null, note: string | null): string =>
  time ? `${time} 경기 시작` : (note || '');

/** 대회일 '2026년 10월 25일(일)'. */
export function koreanDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const w = '일월화수목금토'[d.getUTCDay()];
  return `${Number(m[1])}년 ${Number(m[2])}월 ${Number(m[3])}일(${w})`;
}

export function buildVarValues(opts: {
  title: string; eventDateISO: string; urls: ResolvedUrl[]; schedule: ScheduleValues | null;
}): Record<string, string> {
  const v: Record<string, string> = {
    '{대회명}': opts.title,
    '{대회일}': koreanDate(opts.eventDateISO),
  };
  opts.urls.forEach((u) => { v[u.token] = u.url; });
  const s = opts.schedule;
  v['{신고장소}'] = s?.checkinPlace || '';
  v['{첫조마감}'] = s?.session1Deadline || '';
  v['{둘째조마감}'] = s?.session2Deadline || '';
  v['{첫조시작}'] = s ? startText(s.session1Start, s.session1Note) : '';
  v['{둘째조시작}'] = s ? startText(s.session2Start, s.session2Note) : '';
  return v;
}

// ── 문자 길이 ────────────────────────────────────────────────────────────────
export interface MessageLength { chars: number; bytes: number; lines: number; hint: string }

/**
 * 글자 수 · 바이트(한글 등 2바이트 · 영문 · 숫자 1바이트 — 국내 문자에서 흔히 쓰는 계산) · 줄 수.
 *   ⚠ 단문 · 장문 구분과 요금은 통신사 · 문자 앱마다 다르다. 참고용 안내만 한다(요금 표시 없음).
 */
export function messageLength(text: string): MessageLength {
  const chars = Array.from(text).length;
  let bytes = 0;
  for (const ch of text) bytes += ch === '\n' ? 1 : (ch.codePointAt(0) as number) <= 0x7f ? 1 : 2;
  const lines = text ? text.split('\n').length : 0;
  const hint = bytes <= 90 ? '약 90바이트 이내 — 보통 단문으로 보내집니다'
    : bytes <= 2000 ? '90바이트 초과 — 보통 장문(LMS)으로 보내집니다'
      : '2,000바이트 초과 — 문자 앱에서 나뉘거나 잘릴 수 있습니다';
  return { chars, bytes, lines, hint };
}

// ── 주소록 스냅샷 ─────────────────────────────────────────────────────────────
export interface SnapshotEntry { r: string; s: 1 | 2; h: string; x: boolean }
export interface Snapshot { entries: SnapshotEntry[]; recipientCount: number; createdAt: string | null; createdByName: string | null }

// SHA-256(표준) — crypto.subtle 은 https(보안 컨텍스트)에서만 있다. 없으면 같은 결과를 내는 순수 구현을 쓴다.
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256HexSync(text: string): string {
  const msg = new TextEncoder().encode(text);
  const bitLen = msg.length * 8;
  const padLen = (((msg.length + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(padLen);
  buf.set(msg); buf[msg.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000)); dv.setUint32(padLen - 4, bitLen >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return Array.from(H).map((x) => x.toString(16).padStart(8, '0')).join('');
}

async function sha256Hex(text: string): Promise<string> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (subtle) {
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256HexSync(text);
}

/** 스냅샷에 저장하는 번호 지문 길이(hex 4자리 = 16비트).
 *  ⚠ 휴대폰 번호는 경우의 수가 1억 개 남짓이라 SHA-256 전체(64자리)를 저장하면 대입으로 번호를 되찾을 수 있다.
 *    앞 4자리만 남기면 한 지문에 약 1,500개 번호가 겹쳐 되찾을 수 없다. 변경을 놓칠 확률은 번호 하나당 1/65,536. */
export const PHONE_FINGERPRINT_HEX = 4;

/** 번호 지문(SHA-256 앞 4자리 hex) — 대회 slug 를 섞는다. 빈 번호는 ''. 번호 원문은 서버로 보내지 않는다. */
export async function hashPhone(slug: string, digits: string): Promise<string> {
  if (!digits) return '';
  return (await sha256Hex(`teyeon-sms:${slug}:${digits}`)).slice(0, PHONE_FINGERPRINT_HEX);
}

export async function hashBook(slug: string, book: AddressBook): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const e of book.entries) out.set(e.key, await hashPhone(slug, e.phone.digits));
  return out;
}

export function buildSnapshotEntries(book: AddressBook, hashes: Map<string, string>, excludedKeys: string[]): SnapshotEntry[] {
  const ex = new Set(excludedKeys);
  return book.entries.map((e) => ({ r: e.registrationId, s: e.slot, h: hashes.get(e.key) ?? '', x: ex.has(e.key) }));
}

export type SnapshotChange = 'same' | 'changed' | 'new';

export interface SnapshotDiff {
  byKey: Map<string, SnapshotChange>;
  changed: string[];
  added: string[];
  /** 스냅샷에는 있었는데 지금 원본에 없는 항목 수(신청 삭제 등). */
  removed: number;
  /** 스냅샷에 저장된 제외 목록(현재 원본에 있는 항목만). */
  excludedKeys: string[];
  hasChanges: boolean;
}

export function diffSnapshot(book: AddressBook, hashes: Map<string, string>, snap: Snapshot | null): SnapshotDiff | null {
  if (!snap) return null;
  const old = new Map(snap.entries.map((x) => [`${x.r}:${x.s}`, x]));
  const byKey = new Map<string, SnapshotChange>();
  const changed: string[] = []; const added: string[] = []; const excludedKeys: string[] = [];
  for (const e of book.entries) {
    const o = old.get(e.key);
    if (!o) { byKey.set(e.key, 'new'); added.push(e.key); continue; }
    if (o.x) excludedKeys.push(e.key);
    if ((hashes.get(e.key) ?? '') !== o.h) { byKey.set(e.key, 'changed'); changed.push(e.key); } else byKey.set(e.key, 'same');
  }
  const removed = snap.entries.filter((x) => !book.byKey.has(`${x.r}:${x.s}`)).length;
  return { byKey, changed, added, removed, excludedKeys, hasChanges: changed.length + added.length + removed > 0 };
}

// ── 발송 기록 키 ──────────────────────────────────────────────────────────────
/** 같은 배치를 같은 날 두 번 기록하지 않게 — 템플릿 · 대상 · 배치 · 받는 사람 묶음 지문 · 날짜(KST).
 *  ⚠ 전화번호가 아니라 참가자 키(신청 id:선수 번호)로 지문을 만든다 — 한 명짜리 배치에서 번호를 되찾을 수 없게. */
export async function logClientKey(parts: { templateKey: string; audience: string; batchLabel: string; memberKeys: string[]; dateKst: string }): Promise<string> {
  const hex = await sha256Hex([parts.templateKey, parts.audience, parts.batchLabel, parts.memberKeys.join(','), parts.dateKst].join('|'));
  return `${parts.dateKst}:${parts.templateKey}:${hex.slice(0, 32)}`;
}

export function kstDate(now: Date = new Date()): string {
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  return k.toISOString().slice(0, 10);
}
