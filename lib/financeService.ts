import { supabase } from '@/lib/supabase';
import {
  FinanceCategory,
  FinanceImportPreviewRow,
  FinanceTransaction,
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
    lowerMessage.includes('relation "public.finance_transactions" does not exist');

  if (isMissingFinanceTable) return '재무 테이블이 아직 생성되지 않았습니다. finance_schema.sql을 Supabase에 먼저 적용해주세요.';

  return message || '재무 거래 처리 중 오류가 발생했습니다.';
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
