export type FinanceTransactionType = 'INCOME' | 'EXPENSE';

export type ClassificationStatus =
  | 'UNCLASSIFIED'
  | 'SUGGESTED'
  | 'NEEDS_REVIEW'
  | 'CONFIRMED';

export type FinanceMonthlyReportStatus = 'DRAFT' | 'CONFIRMED';

export type FinanceReceivableStatus = 'OPEN' | 'PAID' | 'WAIVED';

export type FinancePaymentStatus =
  | 'UNCONFIRMED'
  | 'UNPAID'
  | 'PARTIAL'
  | 'PAID'
  | 'WAIVED'
  | 'YEARLY_PAID';

export type FinanceFeeType = 'MONTHLY' | 'YEARLY';

export const FINANCE_CATEGORIES = [
  '월회비',
  '연회비',
  '게스트비',
  '벌금',
  '게스트비+벌금',
  '상금',
  '코트비',
  '공값/용품비',
  '식대/간식',
  '찬조금',
  '이자',
  '기타',
] as const;

export type FinanceCategory = typeof FINANCE_CATEGORIES[number];

export interface FinanceSettings {
  id?: string;
  monthly_fee_amount: number;
  yearly_fee_amount: number;
  guest_fee_amount: number;
  sojeong_guest_fee_amount: number;
  penalty_l1_amount: number;
  penalty_l2_amount: number;
  effective_from?: string;
  note?: string;
}

export interface FinanceTransaction {
  id?: string;
  transaction_date: string;
  transaction_time?: string;
  transaction_type: FinanceTransactionType;
  amount: number;
  balance_after?: number;
  transaction_method?: string;
  description: string;
  counterparty?: string;
  category?: FinanceCategory | null;
  suggested_category?: FinanceCategory | null;
  classification_status: ClassificationStatus;
  is_ambiguous: boolean;
  review_reason?: string;
  member_id?: string;
  payer_name?: string;
  related_player_name?: string;
  memo?: string;
  source?: string;
  source_file_name?: string;
  source_row_index?: number;
  source_hash: string;
  confirmed_by?: string;
  confirmed_at?: string;
  created_by?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FinanceImportPreviewRow extends FinanceTransaction {
  raw: Record<string, string>;
  row_number: number;
  parse_error?: string;
}

export interface FinanceImportResult {
  rows: FinanceImportPreviewRow[];
  errors: string[];
  detectedHeaderIndex: number;
}

export interface FinanceMonthlySummary {
  rowCount: number;
  incomeTotal: number;
  expenseTotal: number;
  netChange: number;
  needsReviewCount: number;
  unclassifiedCount: number;
  byCategory: Partial<Record<FinanceCategory | '미분류', number>>;
}

export interface FinanceMonthlyReportSnapshot {
  year: number;
  month: number;
  opening_balance: number;
  income_total: number;
  expense_total: number;
  closing_balance: number;
  status: FinanceMonthlyReportStatus;
  income_breakdown?: Array<{ category: FinanceCategory | string; amount: number; ratio?: number }>;
  expense_breakdown?: Array<{ category: FinanceCategory | string; amount: number; ratio?: number }>;
  top_expenses?: Array<{ date: string; category: FinanceCategory | string; amount: number; memo?: string }>;
  public_note?: string;
}

export interface FinanceCategoryBreakdown {
  category: FinanceCategory | string;
  amount: number;
  count: number;
  ratio: number;
}

export interface FinanceTopExpense {
  id?: string;
  date: string;
  description: string;
  category: FinanceCategory | string;
  amount: number;
}

export interface FinanceMonthlyDraftSummary {
  year: number;
  month: number;
  transactionCount: number;
  opening_balance: number;
  income_total: number;
  expense_total: number;
  net_change: number;
  closing_balance: number;
  needs_review_count: number;
  income_breakdown: FinanceCategoryBreakdown[];
  expense_breakdown: FinanceCategoryBreakdown[];
  top_expenses: FinanceTopExpense[];
}

export interface FinanceMonthlyReportRecord extends FinanceMonthlyReportSnapshot {
  id?: string;
  note?: string;
  confirmed_at?: string;
  confirmed_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FinanceReceivable {
  id?: string;
  member_id?: string;
  member_name?: string;
  player_name: string;
  amount: number;
  reason: string;
  category?: FinanceCategory | string;
  target_month?: string;
  kdk_archive_id?: string;
  status: FinanceReceivableStatus;
  is_public: boolean;
  is_confirmed: boolean;
  confirmed_by?: string;
  confirmed_at?: string;
  paid_at?: string;
  memo?: string;
}

export interface FinanceMemberPayment {
  id?: string;
  target_month: string;
  member_id: string;
  member_name: string;
  fee_type: FinanceFeeType;
  expected_amount: number;
  paid_amount: number;
  payment_status: FinancePaymentStatus;
  is_yearly_payer: boolean;
  matched_transaction_ids?: string[];
  is_public: boolean;
  is_confirmed: boolean;
  confirmed_by?: string;
  confirmed_at?: string;
  memo?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FinanceMemberPaymentRow {
  member_id: string;
  member_name: string;
  member_role?: string | null;
  target_month: string;
  expected_amount: number;
  paid_amount: number;
  payment_status: FinancePaymentStatus;
  is_yearly_payer: boolean;
  is_confirmed: boolean;
  matched_transaction_count: number;
  memo?: string;
}
