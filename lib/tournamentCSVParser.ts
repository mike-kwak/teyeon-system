// Tournament Schedule 전용 CSV 파서.
// TODO: Club Schedule CSV 업로드가 필요해지면 clubCSVParser.ts 로 분리 — 이 파일은 tournament_events 전용으로 유지.
import {
  TournamentDivision,
  TournamentEvent,
  TournamentOrganizer,
  TournamentStatus,
} from './tournamentCalendarData';
import { TournamentEventInput } from './tournamentCalendarService';

// ─── Allowed values ────────────────────────────────────────────────────────────

export const ALLOWED_ORGANIZERS: TournamentOrganizer[] = [
  'KATO', 'KATA', 'KTA', '지역대회', '비랭킹',
];
export const ALLOWED_DIVISIONS: TournamentDivision[] = ['신인부', '오픈부', '단체전'];
export const ALLOWED_GRADES = ['MA', 'A', '1', '2', '3', '비랭킹'];
export const ALLOWED_STATUSES: TournamentStatus[] = [
  '접수예정', '접수중', '접수종료', '대회진행중', '대회종료', '대회취소',
];

// ─── CSV header → internal field key ──────────────────────────────────────────

const COLUMN_MAP: Record<string, string> = {
  '대회명': 'title',
  '대회구분': 'organizer',
  '부서': 'division',
  '등급': 'grade',
  '경기일': 'event_date',
  '접수시작일': 'registration_start',
  '접수마감일': '_registration_end', // skip – no DB column (TODO: registration_end 컬럼 추가 시 매핑)
  '장소': 'venue',
  '상태': 'status',
  '메모': 'memo',
  '링크': '_link',                   // skip – no DB column (TODO: external_url 컬럼 추가 시 매핑)
};

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CSVNormalizedRow {
  rowIndex: number;
  title: string;
  organizer: string;
  division: string;
  grade: string;
  event_date: string;
  registration_start: string;
  venue: string;
  status: string;
  memo: string;
}

export type RowStatus = 'valid' | 'error' | 'duplicate';

export interface CSVValidatedRow extends CSVNormalizedRow {
  rowStatus: RowStatus;
  errors: string[];
  duplicateKey: string;
  existingEventId?: string;
  duplicateAction: 'skip' | 'update';
}

export interface CSVParseResult {
  rows: CSVValidatedRow[];
  unknownColumns: string[];
  hasRegistrationEndColumn: boolean;
  hasLinkColumn: boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Normalize YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD → YYYY-MM-DD; null on failure
function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const n = s.replace(/[./]/g, '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(n)) {
    const d = new Date(`${n}T00:00:00`);
    if (!isNaN(d.getTime())) return n;
  }
  return null;
}

// 테연 기존 시트 날짜 정규화: M/D, MM/DD, M-D(단자리) → referenceYear-MM-DD
function normalizeTeyeonDate(raw: string, year: number): string | null {
  const s = raw.trim();
  if (!s) return null;

  // Standard YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD
  const std = normalizeDate(s);
  if (std) return std;

  // M/D or MM/DD
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const m = parseInt(slashMatch[1], 10);
    const d = parseInt(slashMatch[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const candidate = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!isNaN(new Date(`${candidate}T00:00:00`).getTime())) return candidate;
    }
  }

  // M-D (1-2 digit parts only; YYYY-MM-DD already caught above)
  const shortDashMatch = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (shortDashMatch) {
    const m = parseInt(shortDashMatch[1], 10);
    const d = parseInt(shortDashMatch[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const candidate = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!isNaN(new Date(`${candidate}T00:00:00`).getTime())) return candidate;
    }
  }

  return null;
}

function mapRawRow(raw: Record<string, string>): {
  fields: Record<string, string>;
  hasRegistrationEnd: boolean;
  hasLink: boolean;
} {
  const fields: Record<string, string> = {};
  let hasRegistrationEnd = false;
  let hasLink = false;

  for (const [key, val] of Object.entries(raw)) {
    const mapped = COLUMN_MAP[key.trim()];
    if (mapped === '_registration_end') {
      hasRegistrationEnd = true;
    } else if (mapped === '_link') {
      hasLink = true;
    } else if (mapped) {
      fields[mapped] = (val ?? '').trim();
    }
  }
  return { fields, hasRegistrationEnd, hasLink };
}

// ─── Duplicate key (title + event_date + organizer + division) ─────────────────

export function getRowDuplicateKey(row: {
  title: string;
  event_date: string;
  organizer: string;
  division: string;
}): string {
  return `${row.title}|${row.event_date}|${row.organizer}|${row.division}`;
}

export function getEventDuplicateKey(event: TournamentEvent): string {
  return `${event.title}|${event.date}|${event.organizer}|${event.division}`;
}

// ─── Validation ────────────────────────────────────────────────────────────────

function validateFields(row: CSVNormalizedRow): string[] {
  const errs: string[] = [];

  if (!row.title) errs.push('대회명 필수');

  if (!row.organizer) {
    errs.push('대회구분 필수');
  } else if (!(ALLOWED_ORGANIZERS as string[]).includes(row.organizer)) {
    errs.push(`대회구분 허용값 오류 (${row.organizer})`);
  }

  if (!row.division) {
    errs.push('부서 필수');
  } else if (!(ALLOWED_DIVISIONS as string[]).includes(row.division)) {
    errs.push(`부서 허용값 오류 (${row.division})`);
  }

  if (!row.event_date) {
    errs.push('경기일 필수');
  } else if (normalizeDate(row.event_date) === null) {
    errs.push(`경기일 날짜 형식 오류 (${row.event_date})`);
  }

  if (row.grade && !ALLOWED_GRADES.includes(row.grade)) {
    errs.push(`등급 허용값 오류 (${row.grade})`);
  }

  if (row.registration_start && normalizeDate(row.registration_start) === null) {
    errs.push(`접수시작일 날짜 형식 오류 (${row.registration_start})`);
  }

  if (row.status && !(ALLOWED_STATUSES as string[]).includes(row.status)) {
    errs.push(`상태 허용값 오류 (${row.status})`);
  }

  return errs;
}

// ─── Main parser ───────────────────────────────────────────────────────────────

export function parseAndValidateRows(
  rawRows: Record<string, string>[],
  existingEvents: TournamentEvent[],
  allHeaders: string[],
): CSVParseResult {
  const existingKeyMap = new Map<string, string>();
  for (const ev of existingEvents) {
    existingKeyMap.set(getEventDuplicateKey(ev), ev.id);
  }

  const unknownColumns: string[] = [];
  let hasRegistrationEndColumn = false;
  let hasLinkColumn = false;

  for (const h of allHeaders) {
    const k = h.trim();
    if (!k) continue;
    const mapped = COLUMN_MAP[k];
    if (mapped === '_registration_end') hasRegistrationEndColumn = true;
    else if (mapped === '_link') hasLinkColumn = true;
    else if (!mapped) unknownColumns.push(k);
  }

  const rows: CSVValidatedRow[] = rawRows.map((raw, idx) => {
    const { fields, hasRegistrationEnd, hasLink } = mapRawRow(raw);
    if (hasRegistrationEnd) hasRegistrationEndColumn = true;
    if (hasLink) hasLinkColumn = true;

    const rawEventDate = fields['event_date'] || '';
    const rawRegStart = fields['registration_start'] || '';

    const normalized: CSVNormalizedRow = {
      rowIndex: idx + 2, // row 1 = header
      title: fields['title'] || '',
      organizer: fields['organizer'] || '',
      division: fields['division'] || '',
      grade: fields['grade'] || '',
      event_date: normalizeDate(rawEventDate) ?? rawEventDate,
      registration_start: normalizeDate(rawRegStart) ?? '',
      venue: fields['venue'] || '',
      status: fields['status'] || '접수예정',
      memo: fields['memo'] || '',
    };

    const errors = validateFields(normalized);
    const dupKey = getRowDuplicateKey(normalized);
    const existingId = existingKeyMap.get(dupKey);
    const rowStatus: RowStatus =
      errors.length > 0 ? 'error' : existingId ? 'duplicate' : 'valid';

    return {
      ...normalized,
      rowStatus,
      errors,
      duplicateKey: dupKey,
      existingEventId: existingId,
      duplicateAction: 'skip',
    };
  });

  return { rows, unknownColumns, hasRegistrationEndColumn, hasLinkColumn };
}

// ─── TEYEON 기존 시트 파서 (A=대회일, B=대회명, C=등급) ─────────────────────────
// MVP: A~C열만 대회 일정으로 가져옴. D열 이후 페어입력 영역은 저장하지 않음.
// TODO: 추후 필요 시 페어 정보 연동 가능 (tournament_pairs 테이블 대상).

export function parseTeyeonSheetText(raw: string, referenceYear: number): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const text = raw.startsWith('﻿') ? raw.slice(1) : raw; // strip BOM
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };

  const firstColVal = (lines[0].split('\t')[0] ?? '').trim();
  // A열 첫 값이 날짜로 해석 불가 → 헤더 행으로 판단하고 건너뜀
  const startIdx =
    firstColVal !== '' && normalizeTeyeonDate(firstColVal, referenceYear) === null ? 1 : 0;

  // COLUMN_MAP 키와 일치하는 synthetic 헤더로 주입 → parseAndValidateRows 재사용
  const syntheticHeaders = ['경기일', '대회명', '등급', '대회구분', '부서'];
  const dataRows: Record<string, string>[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const rawDate = (cols[0] ?? '').trim();
    const rawTitle = (cols[1] ?? '').trim();
    const rawGrade = (cols[2] ?? '').trim();

    if (!rawDate && !rawTitle) continue; // 완전 빈 행 건너뜀

    const normalizedDate = normalizeTeyeonDate(rawDate, referenceYear) ?? rawDate;
    // 허용 등급 외 값은 빈칸 처리 — 등급은 선택 필드이므로 오류 행 방지
    const normalizedGrade = ALLOWED_GRADES.includes(rawGrade) ? rawGrade : '';

    dataRows.push({
      '경기일': normalizedDate,
      '대회명': rawTitle,
      '등급': normalizedGrade,
      '대회구분': 'KATO',  // 기본값
      '부서': '신인부',    // 기본값
    });
  }

  return { headers: syntheticHeaders, rows: dataRows };
}

// ─── Excel paste parser (tab-delimited) ────────────────────────────────────────

// 엑셀/구글시트에서 복사한 탭 구분 텍스트 → papaparse와 동일한 { headers, rows } 형태로 변환
export function parseTabDelimitedText(raw: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const text = raw.startsWith('﻿') ? raw.slice(1) : raw; // strip BOM
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0].split('\t').map((h) => h.trim());
  const dataRows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split('\t');
    if (vals.every((v) => !v.trim())) continue; // skip blank rows
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (vals[idx] ?? '').trim();
    });
    dataRows.push(row);
  }

  return { headers, rows: dataRows };
}

// ─── Row → TournamentEventInput ────────────────────────────────────────────────

export function rowToEventInput(row: CSVValidatedRow): TournamentEventInput {
  return {
    id: undefined,
    title: row.title,
    date: row.event_date,
    venue: row.venue,
    organizer: row.organizer as TournamentOrganizer,
    division: row.division as TournamentDivision,
    grade: row.grade || undefined,
    registrationStart: row.registration_start || undefined,
    status: row.status as TournamentStatus,
    memo: row.memo || undefined,
    pairs: [],
    partnerRequests: [],
  };
}
