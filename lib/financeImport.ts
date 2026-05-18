import {
  ClassificationStatus,
  FinanceCategory,
  FinanceImportPreviewRow,
  FinanceImportResult,
  FinanceMonthlySummary,
  FinanceSettings,
} from './financeTypes';

const KAKAO_REQUIRED_HEADERS = ['거래일시', '구분', '거래금액', '거래 후 잔액', '거래구분', '내용'];

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  monthly_fee_amount: 10000,
  yearly_fee_amount: 120000,
  guest_fee_amount: 10000,
  default_penalty_amount: 5000,
  sojeong_penalty_amount: 10000,
  penalty_l1_amount: 3000,
  penalty_l2_amount: 5000,
  effective_from: '2026-01-01',
  note: '초기 기본값입니다. 실제 회비 정책에 맞춰 조정 예정.',
};

type CategorySuggestion = {
  suggestedCategory: FinanceCategory | null;
  status: ClassificationStatus;
  isAmbiguous: boolean;
  reviewReason?: string;
};

function normalizeHeader(value: string) {
  return value.replace(/^\uFEFF/, '').trim();
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parsePastedRows(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (KAKAO_REQUIRED_HEADERS.every((header) => line.includes(header))) {
        return KAKAO_REQUIRED_HEADERS;
      }

      if (line.includes('\t')) {
        return line.split(/\t+/).map((cell) => cell.trim());
      }

      const multiSpaceCells = line.split(/\s{2,}/).map((cell) => cell.trim()).filter(Boolean);
      if (multiSpaceCells.length >= KAKAO_REQUIRED_HEADERS.length) {
        return multiSpaceCells;
      }

      const looseMatch = line.match(
        /^(.+?\d{1,2}:\d{2}(?::\d{2})?)\s+(입금|출금)\s+([\d,()원₩-]+)\s+([\d,()원₩-]+)\s+(\S+)\s+(.+)$/
      );
      if (looseMatch) {
        return looseMatch.slice(1).map((cell) => cell.trim());
      }

      return multiSpaceCells.length > 0 ? multiSpaceCells : [line];
    });
}

function findHeaderIndex(rows: string[][]) {
  return rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    const joined = normalized.join(' ');
    return KAKAO_REQUIRED_HEADERS.every((header) => normalized.includes(header) || joined.includes(header));
  });
}

function normalizeHeaderlessTransactionRow(row: string[]) {
  const joined = row.map((cell) => cell.trim()).filter(Boolean).join(' ');
  const match = joined.match(
    /^(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(입금|출금)\s+(-?[\d,()원₩]+)\s+(-?[\d,()원₩]+)\s+(\S+)\s+(.+)$/
  );

  if (!match) return null;

  const [, datePart, timePart, typeRaw, amountRaw, balanceRaw, method, description] = match;

  return {
    dateTimeRaw: `${datePart} ${timePart}`,
    typeRaw,
    amountRaw,
    balanceRaw,
    method,
    description,
  };
}

function parseMoney(value?: string) {
  const normalized = String(value || '')
    .replace(/[,\s원₩]/g, '')
    .replace(/[()]/g, '')
    .trim();

  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateTime(value: string) {
  const raw = value.trim();
  const match = raw.match(/(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})[일\s]*(.*)/);

  if (!match) {
    return { date: '', time: '' };
  }

  const [, y, m, d, timePart] = match;
  const date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const timeMatch = String(timePart || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const time = timeMatch
    ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}${timeMatch[3] ? `:${timeMatch[3]}` : ''}`
    : '';

  return { date, time };
}

function createSourceHash(parts: string[], sourcePrefix = 'kb') {
  const input = parts.join('|');
  let hash = 2166136261;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return `${sourcePrefix}_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function looksLikeNameOnly(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (/[0-9]/.test(text)) return false;
  if (/[./,_:;|]/.test(text)) return false;
  if (/(회비|게스트|벌금|패널티|상금|코트|소정|gs|지에스|음료|공구입|공값|헤드|찬조|이자|kdk)/i.test(text)) {
    return false;
  }
  return /^[가-힣a-zA-Z\s()]+$/.test(text) && text.length <= 12;
}

export function suggestFinanceCategory(
  params: {
    description: string;
    transactionMethod?: string;
    amount: number;
    transactionType: 'INCOME' | 'EXPENSE';
  },
  settings: FinanceSettings = DEFAULT_FINANCE_SETTINGS
): CategorySuggestion {
  const text = `${params.description || ''} ${params.transactionMethod || ''}`.toLowerCase();
  const absAmount = Math.abs(params.amount);

  const suggested = (category: FinanceCategory): CategorySuggestion => ({
    suggestedCategory: category,
    status: 'SUGGESTED',
    isAmbiguous: false,
  });

  if (/연회비|년회비/.test(text)) return suggested('연회비');
  if (/게\.벌|게스트\s*벌|게스트비\s*\+?\s*벌/.test(text)) return suggested('게스트비+벌금');
  if (/게스트|게스트비/.test(text)) return suggested('게스트비');
  if (/벌금|패널티|4패/.test(text)) return suggested('벌금');
  if (/회비|월회비/.test(text)) return suggested('월회비');
  if (/(kdk|1등|2등|상금)/i.test(text) && params.transactionType === 'EXPENSE') return suggested('상금');
  if (/코트비|소정/.test(text)) return suggested('코트비');
  if (/gs25|지에스|음료/i.test(text)) return suggested('식대/간식');
  if (/공구입|공값|테니스공|볼|헤드/.test(text)) return suggested('공값/용품비');
  if (/찬조금|찬조/.test(text)) return suggested('찬조금');
  if (/예금이자|이자/.test(text)) return suggested('이자');

  const kdkCandidateAmounts = [
    settings.guest_fee_amount,
    settings.guest_fee_amount + settings.penalty_l1_amount,
    settings.guest_fee_amount + settings.penalty_l2_amount,
    settings.default_penalty_amount,
    settings.sojeong_penalty_amount,
  ];
  const isFeeCandidate = absAmount === settings.monthly_fee_amount || absAmount === settings.yearly_fee_amount;
  const isKdkCandidate = kdkCandidateAmounts.includes(absAmount);
  const isPenaltyCandidate =
    absAmount === settings.default_penalty_amount ||
    absAmount === settings.sojeong_penalty_amount;

  if (params.transactionType === 'INCOME' && looksLikeNameOnly(params.description) && (isFeeCandidate || isKdkCandidate)) {
    const category =
      absAmount === settings.guest_fee_amount + settings.penalty_l1_amount ||
      absAmount === settings.guest_fee_amount + settings.penalty_l2_amount
        ? '게스트비+벌금'
        : absAmount === settings.guest_fee_amount
          ? '게스트비'
          : isPenaltyCandidate
            ? '벌금'
            : '월회비';

    return {
      suggestedCategory: category,
      status: 'NEEDS_REVIEW',
      isAmbiguous: true,
      reviewReason: `${absAmount.toLocaleString()}원 입금은 월회비, 게스트비, 벌금 후보가 겹칠 수 있어 확인이 필요합니다.`,
    };
  }

  if (params.transactionType === 'INCOME' && isKdkCandidate) {
    return {
      suggestedCategory:
        absAmount === settings.guest_fee_amount
          ? '게스트비'
          : isPenaltyCandidate
            ? '벌금'
            : '게스트비+벌금',
      status: 'NEEDS_REVIEW',
      isAmbiguous: true,
      reviewReason: 'KDK 직후 입금일 수 있으므로 게스트비/벌금 여부를 확인해 주세요.',
    };
  }

  return {
    suggestedCategory: null,
    status: 'UNCLASSIFIED',
    isAmbiguous: false,
    reviewReason: text.trim() ? '추천 규칙과 맞는 키워드를 찾지 못했습니다.' : '내용이 비어 있습니다.',
  };
}

function parseKakaoBankRows(
  rows: string[][],
  sourceName: string,
  source: 'kakaobank_upload' | 'kakaobank_paste',
  settings: FinanceSettings
): FinanceImportResult {
  const headerIndex = findHeaderIndex(rows);
  const errors: string[] = [];

  if (headerIndex < 0) {
    return {
      rows: [],
      errors: ['거래일시, 구분, 거래금액, 거래 후 잔액, 거래구분, 내용 헤더가 포함된 표를 붙여넣어 주세요.'],
      detectedHeaderIndex: -1,
    };
  }

  const headers = rows[headerIndex].map(normalizeHeader);
  const indexByHeader = new Map(headers.map((header, index) => [header, index]));
  const getCell = (row: string[], header: string) => row[indexByHeader.get(header) ?? -1]?.trim() || '';

  const parsedRows: FinanceImportPreviewRow[] = [];

  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const rowNumber = headerIndex + offset + 2;
    const dateTimeRaw = getCell(row, '거래일시');
    const typeRaw = getCell(row, '구분');
    const amountRaw = getCell(row, '거래금액');
    const balanceRaw = getCell(row, '거래 후 잔액');
    const method = getCell(row, '거래구분');
    const description = getCell(row, '내용');

    if (![dateTimeRaw, typeRaw, amountRaw, balanceRaw, method, description].some(Boolean)) return;

    const { date, time } = parseDateTime(dateTimeRaw);
    if (!date) {
      errors.push(`${rowNumber}행 거래일시를 해석하지 못했습니다.`);
      return;
    }

    const type = typeRaw.includes('출금') ? 'EXPENSE' : 'INCOME';
    const rawAmount = parseMoney(amountRaw);
    const amount = type === 'EXPENSE' ? -Math.abs(rawAmount) : Math.abs(rawAmount);
    const balanceAfter = parseMoney(balanceRaw);
    const suggestion = suggestFinanceCategory(
      { description, transactionMethod: method, amount, transactionType: type },
      settings
    );

    parsedRows.push({
      row_number: rowNumber,
      transaction_date: date,
      transaction_time: time,
      transaction_type: type,
      amount,
      balance_after: balanceAfter,
      transaction_method: method,
      description,
      counterparty: description,
      category: null,
      suggested_category: suggestion.suggestedCategory,
      classification_status: suggestion.status,
      is_ambiguous: suggestion.isAmbiguous,
      review_reason: suggestion.reviewReason,
      source,
      source_file_name: sourceName,
      source_row_index: rowNumber,
      source_hash: createSourceHash([source, dateTimeRaw, amountRaw, balanceRaw, description], source === 'kakaobank_paste' ? 'kp' : 'kb'),
      raw: {
        거래일시: dateTimeRaw,
        구분: typeRaw,
        거래금액: amountRaw,
        '거래 후 잔액': balanceRaw,
        거래구분: method,
        내용: description,
      },
    });
  });

  return {
    rows: parsedRows,
    errors,
    detectedHeaderIndex: headerIndex,
  };
}

function parseHeaderlessKakaoBankRows(
  rows: string[][],
  sourceName: string,
  settings: FinanceSettings
): FinanceImportResult {
  const parsedRows: FinanceImportPreviewRow[] = [];
  const errors: string[] = [];

  rows.forEach((row, index) => {
    const normalized = normalizeHeaderlessTransactionRow(row);
    if (!normalized) return;

    const rowNumber = index + 1;
    const { dateTimeRaw, typeRaw, amountRaw, balanceRaw, method, description } = normalized;
    const { date, time } = parseDateTime(dateTimeRaw);

    if (!date) {
      errors.push(`${rowNumber}행 거래일시를 해석하지 못했습니다.`);
      return;
    }

    const type = typeRaw.includes('출금') ? 'EXPENSE' : 'INCOME';
    const rawAmount = parseMoney(amountRaw);
    const amount = type === 'EXPENSE' ? -Math.abs(rawAmount) : Math.abs(rawAmount);
    const balanceAfter = parseMoney(balanceRaw);
    const suggestion = suggestFinanceCategory(
      { description, transactionMethod: method, amount, transactionType: type },
      settings
    );

    parsedRows.push({
      row_number: rowNumber,
      transaction_date: date,
      transaction_time: time,
      transaction_type: type,
      amount,
      balance_after: balanceAfter,
      transaction_method: method,
      description,
      counterparty: description,
      category: null,
      suggested_category: suggestion.suggestedCategory,
      classification_status: suggestion.status,
      is_ambiguous: suggestion.isAmbiguous,
      review_reason: suggestion.reviewReason,
      source: 'kakaobank_paste',
      source_file_name: sourceName,
      source_row_index: rowNumber,
      source_hash: createSourceHash(['kakaobank_paste', dateTimeRaw, amountRaw, balanceRaw, description], 'kp'),
      raw: {
        거래일시: dateTimeRaw,
        구분: typeRaw,
        거래금액: amountRaw,
        '거래 후 잔액': balanceRaw,
        거래구분: method,
        내용: description,
      },
    });
  });

  if (parsedRows.length === 0) {
    return {
      rows: [],
      errors: ['거래일시로 시작하는 거래 행을 찾지 못했습니다. 카카오뱅크 거래내역 표를 복사해 붙여넣어 주세요.'],
      detectedHeaderIndex: -1,
    };
  }

  return {
    rows: parsedRows,
    errors,
    detectedHeaderIndex: -1,
  };
}

export function parseKakaoBankCsv(
  text: string,
  fileName = '',
  settings: FinanceSettings = DEFAULT_FINANCE_SETTINGS
): FinanceImportResult {
  return parseKakaoBankRows(parseCsvRows(text), fileName, 'kakaobank_upload', settings);
}

export function parseKakaoBankPastedText(
  text: string,
  settings: FinanceSettings = DEFAULT_FINANCE_SETTINGS
): FinanceImportResult {
  const rows = parsePastedRows(text);
  const result = parseKakaoBankRows(rows, 'pasted_text', 'kakaobank_paste', settings);

  if (result.detectedHeaderIndex < 0) {
    return parseHeaderlessKakaoBankRows(rows, 'pasted_text', settings);
  }

  if (result.detectedHeaderIndex >= 0 && result.rows.length === 0 && result.errors.length === 0) {
    return {
      ...result,
      errors: ['분석 가능한 거래가 없습니다. 헤더 아래 거래 행까지 함께 붙여넣어 주세요.'],
    };
  }

  return result;
}

export function summarizeFinancePreview(rows: FinanceImportPreviewRow[]): FinanceMonthlySummary {
  const incomeTotal = rows
    .filter((row) => row.transaction_type === 'INCOME')
    .reduce((sum, row) => sum + Math.abs(row.amount), 0);
  const expenseTotal = rows
    .filter((row) => row.transaction_type === 'EXPENSE')
    .reduce((sum, row) => sum + Math.abs(row.amount), 0);
  const byCategory: FinanceMonthlySummary['byCategory'] = {};

  rows.forEach((row) => {
    const key = row.category || row.suggested_category || '미분류';
    byCategory[key] = (byCategory[key] || 0) + Math.abs(row.amount);
  });

  return {
    rowCount: rows.length,
    incomeTotal,
    expenseTotal,
    netChange: incomeTotal - expenseTotal,
    needsReviewCount: rows.filter((row) => row.classification_status === 'NEEDS_REVIEW').length,
    unclassifiedCount: rows.filter((row) => row.classification_status === 'UNCLASSIFIED').length,
    byCategory,
  };
}
