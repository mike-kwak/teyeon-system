import { supabase } from '@/lib/supabase';
import {
  FinanceCategory,
  FinanceCategoryBreakdown,
  FinanceImportPreviewRow,
  FinanceMonthlyDraftSummary,
  FinanceMonthlyReportRecord,
  FinanceReceivable,
  FinanceReceivableInput,
  FinanceTopExpense,
  FinanceTransaction,
  FinanceTransactionMonthOption,
} from '@/lib/financeTypes';

export interface SaveFinanceTransactionsResult {
  savedCount: number;
  skippedCount: number;
  failedCount: number;
  savedHashes: string[];
  skippedHashes: string[];
  errorMessage?: string;
}

interface FinanceSaveOptions {
  actorId?: string;
}

export interface FinanceMemberForPayment {
  id: string;
  nickname: string;
  role?: string | null;
}

function normalizeFinanceError(error: any) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  const lowerMessage = message.toLowerCase();
  const isMissingFinanceTable =
    code === '42P01' ||
    lowerMessage.includes('could not find the table') ||
    lowerMessage.includes('relation "finance_transactions" does not exist') ||
    lowerMessage.includes('relation "public.finance_transactions" does not exist') ||
    lowerMessage.includes('relation "finance_monthly_reports" does not exist') ||
    lowerMessage.includes('relation "public.finance_monthly_reports" does not exist') ||
    lowerMessage.includes('relation "finance_receivables" does not exist') ||
    lowerMessage.includes('relation "public.finance_receivables" does not exist');

  if (isMissingFinanceTable) return '재무 테이블이 아직 생성되지 않았습니다. finance_schema.sql을 Supabase에 먼저 적용해주세요.';

  return message || '재무 거래 처리 중 오류가 발생했습니다.';
}

function parseTransactionTimestamp(row: FinanceTransaction) {
  return `${row.transaction_date || '0000-00-00'}T${row.transaction_time || '00:00:00'}`;
}

function getFinanceCategory(row: FinanceTransaction) {
  return row.category || row.suggested_category || '미분류';
}

function getAbsoluteAmount(row: FinanceTransaction) {
  return Math.abs(Number(row.amount || 0));
}

function getSignedAmount(row: FinanceTransaction) {
  const amount = getAbsoluteAmount(row);
  return row.transaction_type === 'EXPENSE' ? -amount : amount;
}

function toBreakdown(
  totals: Map<string, { amount: number; count: number }>,
  baseTotal: number
): FinanceCategoryBreakdown[] {
  return Array.from(totals.entries())
    .map(([category, value]) => ({
      category,
      amount: value.amount,
      count: value.count,
      ratio: baseTotal > 0 ? Math.round((value.amount / baseTotal) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

function getNextMonthStart(month: string) {
  const [year, monthIndex] = month.split('-').map(Number);
  if (!year || !monthIndex) return null;

  const nextMonth = monthIndex === 12 ? 1 : monthIndex + 1;
  const nextYear = monthIndex === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

function toInsertPayload(row: FinanceImportPreviewRow, actorId?: string) {
  return {
    transaction_date: row.transaction_date,
    transaction_time: row.transaction_time || null,
    transaction_type: row.transaction_type,
    amount: row.amount,
    balance_after: row.balance_after ?? null,
    transaction_method: row.transaction_method || null,
    description: row.description || '',
    counterparty: row.counterparty || null,
    category: row.category || null,
    suggested_category: row.suggested_category || null,
    classification_status: row.classification_status,
    is_ambiguous: row.is_ambiguous,
    review_reason: row.review_reason || null,
    member_id: row.member_id || null,
    payer_name: row.payer_name || null,
    related_player_name: row.related_player_name || null,
    memo: row.memo || null,
    source: row.source || 'kakaobank_upload',
    source_file_name: row.source_file_name || null,
    source_row_index: row.source_row_index ?? row.row_number,
    source_hash: row.source_hash,
    created_by: actorId || null,
    updated_by: actorId || null,
  };
}

export async function saveFinanceTransactions(
  rows: FinanceImportPreviewRow[],
  options: FinanceSaveOptions = {}
): Promise<SaveFinanceTransactionsResult> {
  const invalidRows = rows.filter((row) => !row.source_hash);
  const seenHashes = new Set<string>();
  const duplicateBatchHashes: string[] = [];
  const uniqueRows = rows.filter((row) => {
    if (!row.source_hash) return false;
    if (seenHashes.has(row.source_hash)) {
      duplicateBatchHashes.push(row.source_hash);
      return false;
    }
    seenHashes.add(row.source_hash);
    return true;
  });

  if (uniqueRows.length === 0) {
    return {
      savedCount: 0,
      skippedCount: duplicateBatchHashes.length,
      failedCount: invalidRows.length,
      savedHashes: [],
      skippedHashes: duplicateBatchHashes,
    };
  }

  const hashes = uniqueRows.map((row) => row.source_hash);
  const { data: existingRows, error: existingError } = await supabase
    .from('finance_transactions')
    .select('source_hash')
    .in('source_hash', hashes);

  if (existingError) {
    throw new Error(normalizeFinanceError(existingError));
  }

  const existingHashes = new Set(
    (existingRows || [])
      .map((row: { source_hash?: string | null }) => row.source_hash)
      .filter(Boolean) as string[]
  );
  const rowsToInsert = uniqueRows.filter((row) => !existingHashes.has(row.source_hash));
  const skippedHashes = [
    ...duplicateBatchHashes,
    ...uniqueRows.filter((row) => existingHashes.has(row.source_hash)).map((row) => row.source_hash),
  ];

  if (rowsToInsert.length === 0) {
    return {
      savedCount: 0,
      skippedCount: skippedHashes.length,
      failedCount: invalidRows.length,
      savedHashes: [],
      skippedHashes,
    };
  }

  const payload = rowsToInsert.map((row) => toInsertPayload(row, options.actorId));
  const { data: insertedRows, error: insertError } = await supabase
    .from('finance_transactions')
    .insert(payload)
    .select('source_hash');

  if (insertError) {
    throw new Error(normalizeFinanceError(insertError));
  }

  const savedHashes = (insertedRows || [])
    .map((row: { source_hash?: string | null }) => row.source_hash)
    .filter(Boolean) as string[];

  return {
    savedCount: savedHashes.length || rowsToInsert.length,
    skippedCount: skippedHashes.length,
    failedCount: invalidRows.length,
    savedHashes,
    skippedHashes,
  };
}

export async function fetchFinanceTransactions(month?: string): Promise<FinanceTransaction[]> {
  let query = supabase
    .from('finance_transactions')
    .select('*')
    .order('transaction_date', { ascending: false })
    .order('transaction_time', { ascending: false });

  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const start = `${month}-01`;
    const nextStart = getNextMonthStart(month);
    if (nextStart) {
      query = query.gte('transaction_date', start).lt('transaction_date', nextStart);
    }
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(normalizeFinanceError(error));
  }

  return (data || []) as FinanceTransaction[];
}

export async function fetchFinanceTransactionMonths(): Promise<FinanceTransactionMonthOption[]> {
  const { data, error } = await supabase
    .from('finance_transactions')
    .select('transaction_date')
    .order('transaction_date', { ascending: false })
    .limit(5000);

  if (error) {
    throw new Error(normalizeFinanceError(error));
  }

  const monthCounts = new Map<string, number>();

  (data || []).forEach((row: { transaction_date?: string | null }) => {
    if (!row.transaction_date) return;
    const monthKey = row.transaction_date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return;
    monthCounts.set(monthKey, (monthCounts.get(monthKey) || 0) + 1);
  });

  return Array.from(monthCounts.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, count]) => {
      const [year, monthNumber] = monthKey.split('-').map(Number);
      return {
        month: monthKey,
        year,
        monthNumber,
        count,
        label: `${year}년 ${monthNumber}월 · ${count}건`,
      };
    });
}

export function buildFinanceMonthlyDraftSummary(
  rows: FinanceTransaction[],
  year: number,
  month: number
): FinanceMonthlyDraftSummary {
  const sortedAsc = [...rows].sort((a, b) => parseTransactionTimestamp(a).localeCompare(parseTransactionTimestamp(b)));
  const sortedDesc = [...rows].sort((a, b) => parseTransactionTimestamp(b).localeCompare(parseTransactionTimestamp(a)));
  const incomeTotals = new Map<string, { amount: number; count: number }>();
  const expenseTotals = new Map<string, { amount: number; count: number }>();

  let incomeTotal = 0;
  let expenseTotal = 0;
  let needsReviewCount = 0;

  rows.forEach((row) => {
    const amount = getAbsoluteAmount(row);
    const category = getFinanceCategory(row);

    if (row.classification_status === 'NEEDS_REVIEW') {
      needsReviewCount += 1;
    }

    if (row.transaction_type === 'INCOME') {
      incomeTotal += amount;
      const prev = incomeTotals.get(category) || { amount: 0, count: 0 };
      incomeTotals.set(category, { amount: prev.amount + amount, count: prev.count + 1 });
    } else {
      expenseTotal += amount;
      const prev = expenseTotals.get(category) || { amount: 0, count: 0 };
      expenseTotals.set(category, { amount: prev.amount + amount, count: prev.count + 1 });
    }
  });

  const firstRow = sortedAsc.find((row) => typeof row.balance_after === 'number');
  const lastRow = sortedDesc.find((row) => typeof row.balance_after === 'number');
  const netChange = incomeTotal - expenseTotal;
  const openingBalance =
    firstRow && typeof firstRow.balance_after === 'number'
      ? Number(firstRow.balance_after) - getSignedAmount(firstRow)
      : 0;
  const closingBalance =
    lastRow && typeof lastRow.balance_after === 'number'
      ? Number(lastRow.balance_after)
      : openingBalance + netChange;

  const topExpenses: FinanceTopExpense[] = rows
    .filter((row) => row.transaction_type === 'EXPENSE')
    .sort((a, b) => getAbsoluteAmount(b) - getAbsoluteAmount(a))
    .slice(0, 3)
    .map((row) => ({
      id: row.id,
      date: row.transaction_date,
      description: row.description || row.counterparty || '내용 없음',
      category: getFinanceCategory(row),
      amount: getAbsoluteAmount(row),
    }));

  return {
    year,
    month,
    transactionCount: rows.length,
    opening_balance: openingBalance,
    income_total: incomeTotal,
    expense_total: expenseTotal,
    net_change: netChange,
    closing_balance: closingBalance,
    needs_review_count: needsReviewCount,
    income_breakdown: toBreakdown(incomeTotals, incomeTotal),
    expense_breakdown: toBreakdown(expenseTotals, expenseTotal),
    top_expenses: topExpenses,
  };
}

export async function fetchFinanceMonthlyReport(
  year: number,
  month: number
): Promise<FinanceMonthlyReportRecord | null> {
  const { data, error } = await supabase
    .from('finance_monthly_reports')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();

  if (error) {
    throw new Error(normalizeFinanceError(error));
  }

  return (data || null) as FinanceMonthlyReportRecord | null;
}

export async function fetchMonthlyReport(
  year: number,
  month: number
): Promise<FinanceMonthlyReportRecord | null> {
  return fetchFinanceMonthlyReport(year, month);
}

export async function fetchConfirmedMonthlyReports(): Promise<FinanceMonthlyReportRecord[]> {
  const { data, error } = await supabase
    .from('finance_monthly_reports')
    .select('*')
    .eq('status', 'CONFIRMED')
    .order('year', { ascending: false })
    .order('month', { ascending: false });

  if (error) {
    throw new Error(normalizeFinanceError(error));
  }

  return (data || []) as FinanceMonthlyReportRecord[];
}

export async function confirmMonthlyReport(id: string, userLabel?: string): Promise<FinanceMonthlyReportRecord> {
  const { data, error } = await supabase
    .from('finance_monthly_reports')
    .update({
      status: 'CONFIRMED',
      confirmed_at: new Date().toISOString(),
      confirmed_by: userLabel || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(normalizeFinanceError(error));
  }

  return data as FinanceMonthlyReportRecord;
}

export async function unconfirmMonthlyReport(id: string): Promise<FinanceMonthlyReportRecord> {
  const { data, error } = await supabase
    .from('finance_monthly_reports')
    .update({
      status: 'DRAFT',
      confirmed_at: null,
      confirmed_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(normalizeFinanceError(error));
  }

  return data as FinanceMonthlyReportRecord;
}

export async function saveFinanceMonthlyDraft(
  summary: FinanceMonthlyDraftSummary,
  options: { actorId?: string; publicNote?: string } = {}
): Promise<FinanceMonthlyReportRecord> {
  const existingReport = await fetchFinanceMonthlyReport(summary.year, summary.month);

  if (existingReport?.status === 'CONFIRMED') {
    throw new Error('이미 확정된 월간 리포트입니다. 수정하려면 확정 해제가 필요합니다.');
  }

  const now = new Date().toISOString();
  const payload = {
    year: summary.year,
    month: summary.month,
    opening_balance: summary.opening_balance,
    income_total: summary.income_total,
    expense_total: summary.expense_total,
    closing_balance: summary.closing_balance,
    status: 'DRAFT',
    income_breakdown: summary.income_breakdown,
    expense_breakdown: summary.expense_breakdown,
    top_expenses: summary.top_expenses,
    public_note: options.publicNote || null,
    note:
      summary.needs_review_count > 0
        ? `확인 필요 거래 ${summary.needs_review_count}건 포함`
        : null,
    updated_at: now,
  };

  if (existingReport?.id) {
    const { data, error } = await supabase
      .from('finance_monthly_reports')
      .update(payload)
      .eq('id', existingReport.id)
      .select('*')
      .single();

    if (error) {
      throw new Error(normalizeFinanceError(error));
    }

    return data as FinanceMonthlyReportRecord;
  }

  const { data, error } = await supabase
    .from('finance_monthly_reports')
    .insert({
      ...payload,
      created_at: now,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(normalizeFinanceError(error));
  }

  return data as FinanceMonthlyReportRecord;
}

export async function updateFinanceTransactionCategory(
  id: string,
  category: FinanceCategory | null,
  memo?: string,
  actorId?: string
): Promise<FinanceTransaction> {
  const payload: Record<string, any> = {
    category,
    classification_status: category ? 'CONFIRMED' : 'UNCLASSIFIED',
    confirmed_at: category ? new Date().toISOString() : null,
    confirmed_by: category ? actorId || null : null,
    updated_by: actorId || null,
    updated_at: new Date().toISOString(),
  };

  if (memo !== undefined) {
    payload.memo = memo || null;
  }

  const { data, error } = await supabase
    .from('finance_transactions')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(normalizeFinanceError(error));
  }

  return data as FinanceTransaction;
}

export async function fetchFinanceMembersForPayments(): Promise<FinanceMemberForPayment[]> {
  const { data, error } = await supabase
    .from('members')
    .select('id, nickname, role')
    .order('nickname', { ascending: true });

  if (error) {
    throw new Error(error?.message || '회원 목록을 불러오는 중 오류가 발생했습니다.');
  }

  return (data || []) as FinanceMemberForPayment[];
}

export async function fetchPublicReceivables(): Promise<FinanceReceivable[]> {
  const { data, error } = await supabase
    .from('finance_receivables')
    .select('*')
    .eq('status', 'OPEN')
    .eq('is_public', true)
    .eq('is_confirmed', true)
    .order('target_month', { ascending: false });

  if (error) {
    throw new Error(normalizeFinanceError(error));
  }

  return (data || []) as FinanceReceivable[];
}

export async function fetchReceivables(status?: FinanceReceivable['status'] | 'ALL'): Promise<FinanceReceivable[]> {
  let query = supabase
    .from('finance_receivables')
    .select('*')
    .order('created_at', { ascending: false });

  if (status && status !== 'ALL') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(normalizeFinanceError(error));
  }

  return (data || []) as FinanceReceivable[];
}

function toReceivablePayload(input: FinanceReceivableInput) {
  return {
    member_id: input.member_id || null,
    member_name: input.member_name || null,
    player_name: input.player_name,
    amount: Number(input.amount || 0),
    reason: input.reason,
    category: input.category || null,
    target_month: input.target_month || null,
    kdk_archive_id: input.kdk_archive_id || null,
    status: input.status || 'OPEN',
    is_public: Boolean(input.is_public),
    is_confirmed: Boolean(input.is_confirmed),
    confirmed_by: input.is_confirmed ? input.confirmed_by || null : null,
    confirmed_at: input.is_confirmed ? input.confirmed_at || new Date().toISOString() : null,
    paid_at: input.paid_at || null,
    memo: input.memo || null,
    updated_at: new Date().toISOString(),
  };
}

export async function createReceivable(input: FinanceReceivableInput): Promise<FinanceReceivable> {
  const { data, error } = await supabase
    .from('finance_receivables')
    .insert({
      ...toReceivablePayload(input),
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(normalizeFinanceError(error));
  }

  return data as FinanceReceivable;
}

export async function updateReceivable(id: string, input: FinanceReceivableInput): Promise<FinanceReceivable> {
  const { data, error } = await supabase
    .from('finance_receivables')
    .update(toReceivablePayload(input))
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(normalizeFinanceError(error));
  }

  return data as FinanceReceivable;
}

export async function markReceivablePaid(id: string): Promise<FinanceReceivable> {
  const { data, error } = await supabase
    .from('finance_receivables')
    .update({
      status: 'PAID',
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(normalizeFinanceError(error));
  }

  return data as FinanceReceivable;
}

export async function waiveReceivable(id: string): Promise<FinanceReceivable> {
  const { data, error } = await supabase
    .from('finance_receivables')
    .update({
      status: 'WAIVED',
      paid_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(normalizeFinanceError(error));
  }

  return data as FinanceReceivable;
}
