'use client';

import React, { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  DEFAULT_FINANCE_SETTINGS,
  parseKakaoBankCsv,
  parseKakaoBankPastedText,
  summarizeFinancePreview,
} from '@/lib/financeImport';
import {
  fetchFinanceMembersForPayments,
  FinanceMemberForPayment,
  fetchFinanceTransactions,
  saveFinanceTransactions,
  SaveFinanceTransactionsResult,
  updateFinanceTransactionCategory,
} from '@/lib/financeService';
import {
  FINANCE_CATEGORIES,
  FinanceCategory,
  FinanceImportPreviewRow,
  FinanceMemberPaymentRow,
  FinanceReceivable,
  FinanceTransaction,
} from '@/lib/financeTypes';

type AdminFinanceTab = 'upload' | 'review' | 'ledger' | 'dues' | 'receivables' | 'reports' | 'settings';
type MemberFinanceTab = 'public-report' | 'public-receivables';
type FinanceInputMode = 'csv' | 'paste';

const adminTabs: Array<{ id: AdminFinanceTab; label: string }> = [
  { id: 'upload', label: '업로드' },
  { id: 'review', label: '확인 필요' },
  { id: 'ledger', label: '거래 원장' },
  { id: 'dues', label: '납부 현황' },
  { id: 'receivables', label: '미수금' },
  { id: 'reports', label: '월간 리포트' },
  { id: 'settings', label: '설정' },
];

const memberTabs: Array<{ id: MemberFinanceTab; label: string }> = [
  { id: 'public-report', label: '월간 리포트' },
  { id: 'public-receivables', label: '미납 현황' },
];

const emptyPublicReceivables: FinanceReceivable[] = [];

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function canManageFinance(role?: string | null) {
  return role === 'CEO' || role === 'ADMIN' || role === 'FINANCE_MANAGER';
}

function formatMoney(value: number) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toLocaleString()}원`;
}

function statusLabel(status: FinanceImportPreviewRow['classification_status']) {
  if (status === 'SUGGESTED') return '추천됨';
  if (status === 'NEEDS_REVIEW') return '확인 필요';
  if (status === 'CONFIRMED') return '수동 확정';
  return '미분류';
}

function statusClass(status: FinanceImportPreviewRow['classification_status']) {
  if (status === 'SUGGESTED') return 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200';
  if (status === 'NEEDS_REVIEW') return 'border-amber-300/35 bg-amber-300/10 text-amber-100';
  if (status === 'CONFIRMED') return 'border-[#D8BE78]/40 bg-[#D8BE78]/15 text-[#E8D18D]';
  return 'border-white/10 bg-white/5 text-white/45';
}

function readFileAsText(file: File, encoding: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, encoding);
  });
}

export default function FinancePage() {
  const { role, isLoading, user } = useAuth();
  const isFinanceManager = canManageFinance(role);
  const [adminTab, setAdminTab] = useState<AdminFinanceTab>('upload');
  const [memberTab, setMemberTab] = useState<MemberFinanceTab>('public-report');
  const [fileName, setFileName] = useState('');
  const [previewRows, setPreviewRows] = useState<FinanceImportPreviewRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [inputMode, setInputMode] = useState<FinanceInputMode>('csv');
  const [pastedText, setPastedText] = useState('');
  const [isSavingTransactions, setIsSavingTransactions] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveFinanceTransactionsResult | null>(null);
  const [ledgerRows, setLedgerRows] = useState<FinanceTransaction[]>([]);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [hasLoadedLedger, setHasLoadedLedger] = useState(false);
  const [duesMonth, setDuesMonth] = useState(getCurrentMonthKey());
  const [duesMonthlyFee, setDuesMonthlyFee] = useState(DEFAULT_FINANCE_SETTINGS.monthly_fee_amount);
  const [duesMembers, setDuesMembers] = useState<FinanceMemberForPayment[]>([]);
  const [isLoadingDuesMembers, setIsLoadingDuesMembers] = useState(false);
  const [duesError, setDuesError] = useState<string | null>(null);

  const summary = useMemo(() => summarizeFinancePreview(previewRows), [previewRows]);
  const reviewRows = useMemo(
    () => previewRows.filter((row) => row.classification_status === 'NEEDS_REVIEW'),
    [previewRows]
  );

  const actorId = user?.id || user?.email || undefined;

  const loadLedgerRows = async () => {
    if (!isFinanceManager) return;

    setIsLoadingLedger(true);
    setLedgerError(null);

    try {
      const rows = await fetchFinanceTransactions();
      setLedgerRows(rows);
      setHasLoadedLedger(true);
    } catch (error: any) {
      setLedgerRows([]);
      setHasLoadedLedger(true);
      setLedgerError(error?.message || '거래 원장을 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoadingLedger(false);
    }
  };

  useEffect(() => {
    if (isFinanceManager && adminTab === 'ledger') {
      void loadLedgerRows();
    }
  }, [adminTab, isFinanceManager]);

  const loadDuesMembers = async () => {
    if (!isFinanceManager) return;

    setIsLoadingDuesMembers(true);
    setDuesError(null);

    try {
      const members = await fetchFinanceMembersForPayments();
      setDuesMembers(members);
    } catch (error: any) {
      setDuesMembers([]);
      setDuesError(error?.message || '회원별 납부 현황을 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoadingDuesMembers(false);
    }
  };

  useEffect(() => {
    if (isFinanceManager && adminTab === 'dues') {
      void loadDuesMembers();
    }
  }, [adminTab, isFinanceManager]);

  const duesRows = useMemo<FinanceMemberPaymentRow[]>(() => {
    return duesMembers
      .filter((member) => member.role !== '게스트')
      .map((member) => ({
        member_id: member.id,
        member_name: member.nickname || '이름 없음',
        member_role: member.role,
        target_month: duesMonth,
        expected_amount: duesMonthlyFee,
        paid_amount: 0,
        payment_status: 'UNCONFIRMED',
        is_yearly_payer: false,
        is_confirmed: false,
        matched_transaction_count: 0,
        memo: '거래 매칭/수동 확정 전',
      }));
  }, [duesMembers, duesMonth, duesMonthlyFee]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setParseErrors([]);
    setNotice(null);
    setSaveResult(null);
    setIsParsing(true);

    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
      setPreviewRows([]);
      setNotice('XLSX 파일은 엑셀에서 열어 거래내역 표를 복사한 뒤 붙여넣기 모드를 사용해주세요. 직접 XLSX 업로드는 추후 지원 예정입니다.');
      setIsParsing(false);
      event.target.value = '';
      return;
    }

    if (!lowerName.endsWith('.csv')) {
      setPreviewRows([]);
      setNotice('CSV 파일만 업로드할 수 있습니다. XLSX 처리는 샘플 검증 후 다음 단계에서 진행합니다.');
      setIsParsing(false);
      event.target.value = '';
      return;
    }

    try {
      let text = await readFileAsText(file, 'utf-8');
      let result = parseKakaoBankCsv(text, file.name, DEFAULT_FINANCE_SETTINGS);

      if (result.rows.length === 0 && result.detectedHeaderIndex < 0) {
        text = await readFileAsText(file, 'euc-kr');
        result = parseKakaoBankCsv(text, file.name, DEFAULT_FINANCE_SETTINGS);
      }

      setPreviewRows(result.rows);
      setParseErrors(result.errors);
      setNotice(
        result.rows.length > 0
          ? `${result.rows.length}건을 읽었습니다. 자동 분류는 추천값이며 아직 저장되지 않습니다.`
          : '거래내역을 읽지 못했습니다. 카카오뱅크 CSV 컬럼을 확인해주세요.'
      );
      if (result.rows.length > 0) setAdminTab('review');
    } catch (error: any) {
      setPreviewRows([]);
      setParseErrors([error?.message || 'CSV 파일을 읽는 중 오류가 발생했습니다.']);
    } finally {
      setIsParsing(false);
      event.target.value = '';
    }
  };

  const handlePasteAnalyze = () => {
    setParseErrors([]);
    setNotice(null);
    setSaveResult(null);

    if (!pastedText.trim()) {
      setPreviewRows([]);
      setParseErrors(['붙여넣은 거래내역이 없습니다. 카카오뱅크 거래내역 표를 복사해 붙여넣어 주세요.']);
      return;
    }

    const result = parseKakaoBankPastedText(pastedText, DEFAULT_FINANCE_SETTINGS);
    setPreviewRows(result.rows);
    setParseErrors(result.errors);
    setFileName('붙여넣기 거래내역');
    setNotice(
      result.rows.length > 0
        ? `${result.rows.length}건을 분석했습니다. 기존 미리보기/월간 요약과 같은 방식으로 확인합니다.`
        : '거래일시로 시작하는 거래 행을 찾지 못했습니다. 카카오뱅크 거래내역 표를 복사해 붙여넣어 주세요.'
    );
    if (result.rows.length > 0) setAdminTab('review');
  };

  const handleSaveTransactions = async () => {
    if (!isFinanceManager) return;

    if (previewRows.length === 0) {
      setNotice('저장할 거래내역이 없습니다. CSV 업로드 또는 붙여넣기 분석을 먼저 진행해주세요.');
      return;
    }

    setIsSavingTransactions(true);
    setSaveResult(null);
    setParseErrors([]);

    try {
      const result = await saveFinanceTransactions(previewRows, { actorId });
      setSaveResult(result);
      setNotice(`저장 ${result.savedCount}건 · 중복 제외 ${result.skippedCount}건 · 실패 ${result.failedCount}건`);
      await loadLedgerRows();
      setAdminTab('ledger');
    } catch (error: any) {
      const message = error?.message || '거래내역 저장 중 오류가 발생했습니다.';
      setSaveResult({
        savedCount: 0,
        skippedCount: 0,
        failedCount: previewRows.length,
        savedHashes: [],
        skippedHashes: [],
        errorMessage: message,
      });
      setParseErrors([message]);
      setNotice(message);
    } finally {
      setIsSavingTransactions(false);
    }
  };

  const updateLedgerCategory = async (id: string, category: FinanceCategory | '') => {
    const previousRows = ledgerRows;

    setLedgerError(null);
    setLedgerRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              category: category || null,
              classification_status: category ? 'CONFIRMED' : 'UNCLASSIFIED',
            }
          : row
      )
    );

    try {
      const updated = await updateFinanceTransactionCategory(id, category || null, undefined, actorId);
      setLedgerRows((prev) => prev.map((row) => (row.id === id ? updated : row)));
    } catch (error: any) {
      setLedgerRows(previousRows);
      setLedgerError(error?.message || '카테고리 수정 중 오류가 발생했습니다.');
    }
  };

  const updateRowCategory = (rowNumber: number, category: FinanceCategory | '') => {
    setPreviewRows((prev) =>
      prev.map((row) =>
        row.row_number === rowNumber
          ? {
              ...row,
              category: category || null,
              classification_status: category
                ? 'CONFIRMED'
                : row.is_ambiguous
                  ? 'NEEDS_REVIEW'
                  : row.suggested_category
                    ? 'SUGGESTED'
                    : 'UNCLASSIFIED',
            }
          : row
      )
    );
  };

  if (isLoading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-[520px] items-center justify-center bg-[#151514] px-5 text-white">
        <p className="text-[12px] font-black uppercase tracking-[0.24em] text-[#D8BE78]/70">Loading Finance...</p>
      </main>
    );
  }

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col bg-[#151514] px-5 pt-7 text-white"
      style={{ paddingBottom: '250px' }}
    >
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.32em] text-[#D8BE78]/70">TEYEON FINANCE</p>
            <h1 className="mt-2 text-[30px] font-[1000] leading-none tracking-tight text-white">
              클럽 재무 <span className="text-[#D8BE78]">관리</span>
            </h1>
          </div>
          <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-white/55">
            {isFinanceManager ? 'MANAGER' : 'MEMBER'}
          </span>
        </div>
        <p className="mt-3 text-[12px] font-bold leading-relaxed text-white/45">
          재무 담당자는 거래를 업로드하고 확정합니다. 회원에게는 확정된 월간 리포트와 공개 미납 현황만 보여줍니다.
        </p>
      </header>

      {isFinanceManager ? (
        <AdminFinanceView
          adminTab={adminTab}
          setAdminTab={setAdminTab}
          fileName={fileName}
          previewRows={previewRows}
          reviewRows={reviewRows}
          ledgerRows={ledgerRows}
          summary={summary}
          parseErrors={parseErrors}
          ledgerError={ledgerError}
          hasLoadedLedger={hasLoadedLedger}
          duesMonth={duesMonth}
          duesMonthlyFee={duesMonthlyFee}
          duesRows={duesRows}
          duesError={duesError}
          isLoadingDuesMembers={isLoadingDuesMembers}
          notice={notice}
          isParsing={isParsing}
          isSavingTransactions={isSavingTransactions}
          isLoadingLedger={isLoadingLedger}
          saveResult={saveResult}
          inputMode={inputMode}
          pastedText={pastedText}
          setInputMode={setInputMode}
          setPastedText={setPastedText}
          setDuesMonth={setDuesMonth}
          setDuesMonthlyFee={setDuesMonthlyFee}
          handleFileChange={handleFileChange}
          handlePasteAnalyze={handlePasteAnalyze}
          handleSaveTransactions={handleSaveTransactions}
          refreshLedger={loadLedgerRows}
          updateRowCategory={updateRowCategory}
          updateLedgerCategory={updateLedgerCategory}
          refreshDuesMembers={loadDuesMembers}
        />
      ) : (
        <MemberFinanceView memberTab={memberTab} setMemberTab={setMemberTab} publicReceivables={emptyPublicReceivables} />
      )}

      <div className="h-10" />
    </main>
  );
}

function AdminFinanceView({
  adminTab,
  setAdminTab,
  fileName,
  previewRows,
  reviewRows,
  ledgerRows,
  summary,
  parseErrors,
  ledgerError,
  hasLoadedLedger,
  duesMonth,
  duesMonthlyFee,
  duesRows,
  duesError,
  isLoadingDuesMembers,
  notice,
  isParsing,
  isSavingTransactions,
  isLoadingLedger,
  saveResult,
  inputMode,
  pastedText,
  setInputMode,
  setPastedText,
  setDuesMonth,
  setDuesMonthlyFee,
  handleFileChange,
  handlePasteAnalyze,
  handleSaveTransactions,
  refreshLedger,
  updateRowCategory,
  updateLedgerCategory,
  refreshDuesMembers,
}: {
  adminTab: AdminFinanceTab;
  setAdminTab: (tab: AdminFinanceTab) => void;
  fileName: string;
  previewRows: FinanceImportPreviewRow[];
  reviewRows: FinanceImportPreviewRow[];
  ledgerRows: FinanceTransaction[];
  summary: ReturnType<typeof summarizeFinancePreview>;
  parseErrors: string[];
  ledgerError: string | null;
  hasLoadedLedger: boolean;
  duesMonth: string;
  duesMonthlyFee: number;
  duesRows: FinanceMemberPaymentRow[];
  duesError: string | null;
  isLoadingDuesMembers: boolean;
  notice: string | null;
  isParsing: boolean;
  isSavingTransactions: boolean;
  isLoadingLedger: boolean;
  saveResult: SaveFinanceTransactionsResult | null;
  inputMode: FinanceInputMode;
  pastedText: string;
  setInputMode: (mode: FinanceInputMode) => void;
  setPastedText: (value: string) => void;
  setDuesMonth: (value: string) => void;
  setDuesMonthlyFee: (value: number) => void;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handlePasteAnalyze: () => void;
  handleSaveTransactions: () => void;
  refreshLedger: () => void;
  updateRowCategory: (rowNumber: number, category: FinanceCategory | '') => void;
  updateLedgerCategory: (id: string, category: FinanceCategory | '') => void;
  refreshDuesMembers: () => void;
}) {
  return (
    <>
      <section className="mb-5 rounded-[28px] border border-[#D8BE78]/15 bg-[#242323]/90 p-3 shadow-[0_14px_34px_rgba(0,0,0,0.36)]">
        <div className="grid grid-cols-3 gap-2">
          {adminTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setAdminTab(tab.id)}
              className={`rounded-2xl px-2 py-3 text-[11px] font-black tracking-tight transition-all active:scale-95 ${
                adminTab === tab.id
                  ? 'border border-[#D8BE78]/55 bg-[#D8BE78]/15 text-[#F1E7C4] shadow-[0_10px_24px_rgba(216,190,120,0.12)]'
                  : 'border border-zinc-700/80 bg-zinc-950/70 text-zinc-300 hover:border-[#D8BE78]/35 hover:text-zinc-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {notice && <NoticeBox>{notice}</NoticeBox>}
      {parseErrors.length > 0 && (
        <div className="mb-4 rounded-[22px] border border-red-400/25 bg-red-400/10 px-4 py-3 text-[11px] font-bold leading-relaxed text-red-100">
          {parseErrors.slice(0, 4).map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}

      {adminTab === 'upload' && (
        <section className="space-y-4">
          <UploadPanel
            fileName={fileName}
            isParsing={isParsing}
            inputMode={inputMode}
            pastedText={pastedText}
            setInputMode={setInputMode}
            setPastedText={setPastedText}
            onFileChange={handleFileChange}
            onPasteAnalyze={handlePasteAnalyze}
          />
          {previewRows.length > 0 && (
            <PreviewSummaryCard
              summary={summary}
              isSaving={isSavingTransactions}
              saveResult={saveResult}
              onGoPreview={() => setAdminTab('review')}
              onSave={handleSaveTransactions}
            />
          )}
        </section>
      )}

      {adminTab === 'review' && (
        <section className="space-y-3">
          <SectionTitle eyebrow="NEEDS REVIEW" title="확인 필요 거래" count={`${reviewRows.length}건`} />
          {previewRows.length > 0 && (
            <SaveTransactionsBar
              isSaving={isSavingTransactions}
              saveResult={saveResult}
              onSave={handleSaveTransactions}
            />
          )}
          {reviewRows.length === 0 ? (
            <EmptyState
              title="확인 필요 거래가 없습니다"
              body="CSV를 업로드하면 애매한 거래가 이곳에 모입니다. 5,000원/10,000원 입금처럼 게스트비와 벌금, 월회비 후보가 겹칠 수 있는 거래를 우선 확인합니다."
            />
          ) : (
            <TransactionList rows={reviewRows} updateRowCategory={updateRowCategory} />
          )}
        </section>
      )}

      {adminTab === 'ledger' && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle eyebrow="LEDGER" title="거래 원장" count={`${ledgerRows.length}건`} />
            <button
              type="button"
              onClick={refreshLedger}
              disabled={isLoadingLedger}
              className="shrink-0 rounded-2xl border border-zinc-700/80 bg-zinc-950/70 px-3 py-2 text-[10px] font-black text-zinc-200 disabled:opacity-45"
            >
              {isLoadingLedger ? '불러오는 중' : '새로고침'}
            </button>
          </div>
          <div className="rounded-[22px] border border-[#D8BE78]/15 bg-[#D8BE78]/10 px-4 py-3 text-[10px] font-bold leading-relaxed text-[#F1E7C4]/65">
            원장은 Supabase DB에 저장된 거래만 표시합니다. 업로드/붙여넣기 미리보기 데이터는 저장 전까지 원장에 나오지 않습니다.
          </div>
          {ledgerError && (
            <div className="rounded-[22px] border border-red-400/25 bg-red-400/10 px-4 py-3 text-[11px] font-bold leading-relaxed text-red-100">
              {ledgerError}
            </div>
          )}
          {isLoadingLedger ? (
            <EmptyState title="거래 원장을 불러오는 중입니다" body="저장된 카카오뱅크 거래내역을 확인하고 있습니다." />
          ) : ledgerRows.length === 0 ? (
            <EmptyState
              title={ledgerError ? '거래 원장을 불러오지 못했습니다' : hasLoadedLedger ? '저장된 거래가 없습니다' : '거래 원장을 아직 불러오지 않았습니다'}
              body={
                ledgerError
                  ? '위 오류 메시지를 확인해주세요. finance_schema.sql 적용 또는 Supabase 권한 설정이 필요할 수 있습니다.'
                  : saveResult?.savedCount
                    ? '저장은 완료됐지만 조회 결과가 0건입니다. Supabase SELECT/RLS 정책 또는 현재 계정 권한을 확인해주세요.'
                    : '업로드 또는 붙여넣기로 거래내역을 분석한 뒤 거래내역 저장을 눌러 원장에 남길 수 있습니다. 현재는 전체 거래 기준으로 조회합니다.'
              }
            />
          ) : (
            <LedgerTransactionList rows={ledgerRows} updateLedgerCategory={updateLedgerCategory} />
          )}
        </section>
      )}

      {adminTab === 'dues' && (
        <MemberDuesPanel
          month={duesMonth}
          monthlyFee={duesMonthlyFee}
          rows={duesRows}
          isLoading={isLoadingDuesMembers}
          error={duesError}
          setMonth={setDuesMonth}
          setMonthlyFee={setDuesMonthlyFee}
          refresh={refreshDuesMembers}
        />
      )}

      {adminTab === 'receivables' && (
        <AdminPlaceholder
          eyebrow="RECEIVABLES"
          title="미수금 관리"
          body="확정된 미수금만 회원에게 공개합니다. 자동 추정 미납은 공개하지 않고, 재무 담당자가 직접 확정한 항목만 OPEN 상태로 관리합니다."
          items={['OPEN / PAID / WAIVED 상태 관리', 'is_public + is_confirmed 기준 공개', 'KDK Archive 연결은 2차 작업']}
        />
      )}

      {adminTab === 'reports' && (
        <section className="space-y-4">
          <AdminPlaceholder
            eyebrow="MONTHLY REPORT"
            title="월간 리포트 확정"
            body="회원에게 공개되는 재무 화면은 CONFIRMED 월간 리포트만 사용합니다. DRAFT 생성과 확정/해제는 다음 단계에서 연결합니다."
            items={['수입/지출/잔액 스냅샷', '카테고리별 비중', '주요 지출 TOP 3', '공개 미납 현황']}
          />
          <SummaryPanel summary={summary} />
        </section>
      )}

      {adminTab === 'settings' && (
        <AdminPlaceholder
          eyebrow="FINANCE SETTINGS"
          title="재무 설정"
          body="벌금은 기존 KDK L1/L2 기준을 유지하고, 코트 상황에 따라 달라지는 값은 게스트비 기준으로 분리합니다."
          items={[
            `월회비 기본값 ${DEFAULT_FINANCE_SETTINGS.monthly_fee_amount.toLocaleString()}원`,
            '월회비는 추후 20,000원으로 변경될 수 있음',
            `연회비 기본값 ${DEFAULT_FINANCE_SETTINGS.yearly_fee_amount.toLocaleString()}원`,
            `기본 게스트비 ${DEFAULT_FINANCE_SETTINGS.guest_fee_amount.toLocaleString()}원`,
            `소정코트 게스트비 ${DEFAULT_FINANCE_SETTINGS.sojeong_guest_fee_amount.toLocaleString()}원`,
            `벌금 L1 ${DEFAULT_FINANCE_SETTINGS.penalty_l1_amount.toLocaleString()}원 / L2 ${DEFAULT_FINANCE_SETTINGS.penalty_l2_amount.toLocaleString()}원`,
            '3,000원/5,000원/10,000원/13,000원/15,000원 입금은 후보로 추천하되 재무 담당자가 최종 확정',
          ]}
        />
      )}
    </>
  );
}

function MemberFinanceView({
  memberTab,
  setMemberTab,
  publicReceivables,
}: {
  memberTab: MemberFinanceTab;
  setMemberTab: (tab: MemberFinanceTab) => void;
  publicReceivables: FinanceReceivable[];
}) {
  return (
    <>
      <section className="mb-5 rounded-[28px] border border-[#D8BE78]/15 bg-[#242323]/90 p-3">
        <div className="grid grid-cols-2 gap-2">
          {memberTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMemberTab(tab.id)}
              className={`rounded-2xl px-2 py-3 text-[11px] font-black tracking-tight transition-all active:scale-95 ${
                memberTab === tab.id
                  ? 'border border-[#D8BE78]/55 bg-[#D8BE78]/15 text-[#F1E7C4]'
                  : 'border border-zinc-700/80 bg-zinc-950/70 text-zinc-300 hover:border-[#D8BE78]/35 hover:text-zinc-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {memberTab === 'public-report' && (
        <section className="space-y-4">
          <div className="rounded-[30px] border border-white/10 bg-[#242323]/90 p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#D8BE78]/70">PUBLIC REPORT</p>
                <h2 className="mt-1 text-[19px] font-black text-white">확정 월간 리포트</h2>
              </div>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[9px] font-black text-white/45">
                CONFIRMED ONLY
              </span>
            </div>

            <EmptyState
              title="아직 확정된 월간 재무 리포트가 없습니다"
              body="회원에게는 재무 담당자가 확정한 월간 리포트만 공개됩니다. 확인 필요 거래나 거래 원장은 공개되지 않습니다."
            />

            <div className="mt-4 grid grid-cols-2 gap-3">
              <PublicMetric label="수입 총액" value="-원" />
              <PublicMetric label="지출 총액" value="-원" />
              <PublicMetric label="현재 잔액" value="-원" />
              <PublicMetric label="주요 지출" value="준비중" />
            </div>
          </div>

          <PublicInfoCard />
        </section>
      )}

      {memberTab === 'public-receivables' && (
        <section className="space-y-4">
          <div className="rounded-[30px] border border-white/10 bg-[#242323]/90 p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#D8BE78]/70">PUBLIC RECEIVABLES</p>
            <h2 className="mt-1 text-[19px] font-black text-white">공개 미납 현황</h2>
            <p className="mt-2 text-[11px] font-bold leading-relaxed text-white/40">
              공개 조건: OPEN 상태, 공개 허용, 재무 담당자 확정 완료.
            </p>

            {publicReceivables.length === 0 ? (
              <EmptyState
                title="공개된 미납 항목이 없습니다"
                body="자동 추정 미납이나 확인 필요 거래는 회원에게 공개하지 않습니다."
              />
            ) : (
              <div className="mt-4 space-y-2">
                {publicReceivables.map((item) => (
                  <div key={item.id || `${item.player_name}-${item.amount}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-black text-white">{item.player_name}</span>
                      <span className="font-black text-red-200">{item.amount.toLocaleString()}원</span>
                    </div>
                    <p className="mt-1 text-[11px] font-bold text-white/40">
                      {item.reason} · {item.target_month || item.kdk_archive_id || '기준 미지정'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function UploadPanel({
  fileName,
  isParsing,
  inputMode,
  pastedText,
  setInputMode,
  setPastedText,
  onFileChange,
  onPasteAnalyze,
}: {
  fileName: string;
  isParsing: boolean;
  inputMode: FinanceInputMode;
  pastedText: string;
  setInputMode: (mode: FinanceInputMode) => void;
  setPastedText: (value: string) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPasteAnalyze: () => void;
}) {
  return (
    <div className="rounded-[30px] border border-white/10 bg-[#242323]/85 p-5">
      <div className="mb-5">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#D8BE78]/70">KAKAO BANK CSV</p>
        <h2 className="mt-1 text-[18px] font-black text-white">거래내역 입력</h2>
        <p className="mt-2 text-[11px] font-bold leading-relaxed text-white/40">
          필요 컬럼: 거래일시, 구분, 거래금액, 거래 후 잔액, 거래구분, 내용
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 rounded-[22px] border border-white/10 bg-black/20 p-1.5">
        <button
          type="button"
          onClick={() => setInputMode('csv')}
          className={`rounded-2xl px-3 py-2.5 text-[11px] font-black transition-all ${
            inputMode === 'csv'
              ? 'border border-[#D8BE78]/55 bg-[#D8BE78]/15 text-[#F1E7C4]'
              : 'border border-transparent text-zinc-300 hover:text-zinc-100'
          }`}
        >
          CSV 업로드
        </button>
        <button
          type="button"
          onClick={() => setInputMode('paste')}
          className={`rounded-2xl px-3 py-2.5 text-[11px] font-black transition-all ${
            inputMode === 'paste'
              ? 'border border-[#D8BE78]/55 bg-[#D8BE78]/15 text-[#F1E7C4]'
              : 'border border-transparent text-zinc-300 hover:text-zinc-100'
          }`}
        >
          붙여넣기
        </button>
      </div>

      {inputMode === 'csv' ? (
        <label className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center rounded-[26px] border border-dashed border-[#D8BE78]/35 bg-zinc-950/70 px-5 text-center transition-all hover:border-[#D8BE78]/60 hover:bg-[#D8BE78]/5">
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            className="sr-only"
            onChange={onFileChange}
            disabled={isParsing}
          />
          <span className="text-[13px] font-black text-[#F1E7C4]">
            {isParsing ? '파일 분석 중...' : 'CSV 파일 선택'}
          </span>
          <span className="mt-2 max-w-[330px] text-[10px] font-bold leading-relaxed text-white/35">
            XLSX 파일은 엑셀에서 열어 거래내역 표를 복사한 뒤 붙여넣기 모드를 사용해주세요. 직접 XLSX 업로드는 추후 지원 예정입니다.
          </span>
        </label>
      ) : (
        <div className="space-y-3">
          <textarea
            value={pastedText}
            onChange={(event) => setPastedText(event.target.value)}
            placeholder="카카오뱅크 거래내역 엑셀에서 거래일시~내용 영역을 복사해 붙여넣으세요."
            className="min-h-[210px] w-full resize-y rounded-[24px] border border-[#D8BE78]/25 bg-zinc-950/80 px-4 py-4 font-mono text-[12px] font-bold leading-relaxed text-zinc-100 caret-[#F1E7C4] outline-none placeholder:text-zinc-500 focus:border-[#D8BE78]/60 focus:bg-zinc-950"
          />
          <button
            type="button"
            onClick={onPasteAnalyze}
            className="w-full rounded-[22px] border border-[#D8BE78]/60 bg-[#D8BE78]/20 px-4 py-4 text-[12px] font-black text-[#F1E7C4] shadow-[0_12px_26px_rgba(216,190,120,0.12)] active:scale-[0.98]"
          >
            붙여넣기 내용 분석
          </button>
          <p className="text-[10px] font-bold leading-relaxed text-white/35">
            탭으로 복사된 엑셀 표를 우선 인식하고, 여러 공백으로 나뉜 표도 보조로 처리합니다.
          </p>
        </div>
      )}

      {fileName && (
        <p className="mt-4 truncate rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-[11px] font-bold text-white/55">
          최근 파일: {fileName}
        </p>
      )}
    </div>
  );
}

function TransactionList({
  rows,
  updateRowCategory,
}: {
  rows: FinanceImportPreviewRow[];
  updateRowCategory: (rowNumber: number, category: FinanceCategory | '') => void;
}) {
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <article
          key={`${row.source_hash}-${row.row_number}`}
          className="rounded-[26px] border border-white/10 bg-[#242323]/90 p-4 shadow-[0_12px_28px_rgba(0,0,0,0.28)]"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-black text-white">{row.description || '내용 없음'}</p>
              <p className="mt-1 text-[10px] font-bold text-white/35">
                {row.transaction_date} {row.transaction_time || ''} · {row.transaction_method || '거래'}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-[15px] font-black ${row.transaction_type === 'INCOME' ? 'text-emerald-200' : 'text-red-200'}`}>
                {formatMoney(row.amount)}
              </p>
              <p className="mt-1 text-[9px] font-bold text-white/30">잔액 {row.balance_after?.toLocaleString() || 0}</p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
            <div className={`rounded-2xl border px-3 py-2 ${statusClass(row.classification_status)}`}>
              <p className="text-[9px] font-black uppercase tracking-[0.16em]">{statusLabel(row.classification_status)}</p>
              <p className="mt-1 text-[11px] font-black">추천: {row.suggested_category || '없음'}</p>
              {row.review_reason && <p className="mt-1 text-[10px] font-bold leading-relaxed opacity-75">{row.review_reason}</p>}
            </div>

            <select
              value={row.category || ''}
              onChange={(event) => updateRowCategory(row.row_number, event.target.value as FinanceCategory | '')}
              className="h-full min-h-[58px] rounded-2xl border border-zinc-700/80 bg-zinc-950/90 px-3 text-[11px] font-black text-zinc-100 outline-none focus:border-[#D8BE78]/55"
            >
              <option value="" className="bg-zinc-950 text-zinc-100">수동 선택 안 함</option>
              {FINANCE_CATEGORIES.map((category) => (
                <option key={category} value={category} className="bg-zinc-950 text-zinc-100">
                  {category}
                </option>
              ))}
            </select>
          </div>
        </article>
      ))}
    </div>
  );
}

function SaveTransactionsBar({
  isSaving,
  saveResult,
  onSave,
}: {
  isSaving: boolean;
  saveResult: SaveFinanceTransactionsResult | null;
  onSave: () => void;
}) {
  return (
    <div className="rounded-[24px] border border-emerald-300/20 bg-emerald-300/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-black text-emerald-100">분석된 거래내역 저장</p>
          <p className="mt-1 text-[10px] font-bold text-emerald-100/55">
            추천/확인 필요 상태 그대로 저장하며, 직접 확정 전까지 CONFIRMED로 바꾸지 않습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="rounded-2xl border border-emerald-300/40 bg-emerald-300/10 px-4 py-3 text-[11px] font-black text-emerald-100 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isSaving ? '저장 중' : '거래내역 저장'}
        </button>
      </div>
      {saveResult && (
        <p className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-[10px] font-bold text-emerald-100/65">
          저장 {saveResult.savedCount}건 · 중복 제외 {saveResult.skippedCount}건 · 실패 {saveResult.failedCount}건
        </p>
      )}
    </div>
  );
}

function LedgerTransactionList({
  rows,
  updateLedgerCategory,
}: {
  rows: FinanceTransaction[];
  updateLedgerCategory: (id: string, category: FinanceCategory | '') => void;
}) {
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <article
          key={row.id || row.source_hash}
          className="rounded-[26px] border border-white/10 bg-[#242323]/90 p-4 shadow-[0_12px_28px_rgba(0,0,0,0.28)]"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-black text-white">{row.description || '내용 없음'}</p>
              <p className="mt-1 text-[10px] font-bold text-white/35">
                {row.transaction_date} {row.transaction_time || ''} · {row.transaction_method || '거래'}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-[15px] font-black ${row.transaction_type === 'INCOME' ? 'text-emerald-200' : 'text-red-200'}`}>
                {formatMoney(row.amount)}
              </p>
              <p className="mt-1 text-[9px] font-bold text-white/30">잔액 {row.balance_after?.toLocaleString() || 0}</p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
            <div className={`rounded-2xl border px-3 py-2 ${statusClass(row.classification_status)}`}>
              <p className="text-[9px] font-black uppercase tracking-[0.16em]">{statusLabel(row.classification_status)}</p>
              <p className="mt-1 text-[11px] font-black">추천: {row.suggested_category || '없음'}</p>
              <p className="mt-1 text-[10px] font-bold opacity-70">최종: {row.category || '미확정'}</p>
              {row.review_reason && <p className="mt-1 text-[10px] font-bold leading-relaxed opacity-75">{row.review_reason}</p>}
            </div>

            <select
              value={row.category || ''}
              onChange={(event) => row.id && updateLedgerCategory(row.id, event.target.value as FinanceCategory | '')}
              className="h-full min-h-[58px] rounded-2xl border border-zinc-700/80 bg-zinc-950/90 px-3 text-[11px] font-black text-zinc-100 outline-none focus:border-[#D8BE78]/55"
            >
              <option value="" className="bg-zinc-950 text-zinc-100">수동 선택 안 함</option>
              {FINANCE_CATEGORIES.map((category) => (
                <option key={category} value={category} className="bg-zinc-950 text-zinc-100">
                  {category}
                </option>
              ))}
            </select>
          </div>
        </article>
      ))}
    </div>
  );
}

function paymentStatusLabel(status: FinanceMemberPaymentRow['payment_status']) {
  if (status === 'PAID') return '완납';
  if (status === 'PARTIAL') return '부분납';
  if (status === 'UNPAID') return '미납';
  if (status === 'WAIVED') return '면제';
  if (status === 'YEARLY_PAID') return '연회비';
  return '확인 전';
}

function paymentStatusClass(status: FinanceMemberPaymentRow['payment_status']) {
  if (status === 'PAID' || status === 'YEARLY_PAID') return 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100';
  if (status === 'PARTIAL') return 'border-amber-300/30 bg-amber-300/10 text-amber-100';
  if (status === 'UNPAID') return 'border-red-300/25 bg-red-300/10 text-red-100';
  if (status === 'WAIVED') return 'border-sky-300/25 bg-sky-300/10 text-sky-100';
  return 'border-white/10 bg-white/5 text-white/45';
}

function MemberDuesPanel({
  month,
  monthlyFee,
  rows,
  isLoading,
  error,
  setMonth,
  setMonthlyFee,
  refresh,
}: {
  month: string;
  monthlyFee: number;
  rows: FinanceMemberPaymentRow[];
  isLoading: boolean;
  error: string | null;
  setMonth: (value: string) => void;
  setMonthlyFee: (value: number) => void;
  refresh: () => void;
}) {
  const confirmedRows = rows.filter((row) => row.is_confirmed);
  const paidRows = rows.filter((row) => row.payment_status === 'PAID' || row.payment_status === 'YEARLY_PAID');
  const unpaidRows = rows.filter((row) => row.payment_status === 'UNPAID');
  const expectedTotal = rows.reduce((sum, row) => sum + row.expected_amount, 0);

  return (
    <section className="space-y-4">
      <div className="rounded-[30px] border border-white/10 bg-[#242323]/90 p-5">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#D8BE78]/70">MEMBER DUES</p>
            <h2 className="mt-1 text-[19px] font-black text-white">회원별 월 납부 현황</h2>
            <p className="mt-2 text-[11px] font-bold leading-relaxed text-white/40">
              거래 원장과 별도로 재무 담당자가 월회비/연회비 납부 상태를 수동 확정하는 관리판입니다.
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={isLoading}
            className="rounded-2xl border border-zinc-700/80 bg-zinc-950/70 px-3 py-2 text-[10px] font-black text-zinc-200 disabled:opacity-45"
          >
            {isLoading ? '불러오는 중' : '회원 새로고침'}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">기준 월</span>
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="rounded-2xl border border-zinc-700/80 bg-zinc-950/90 px-4 py-3 text-[12px] font-black text-zinc-100 outline-none focus:border-[#D8BE78]/55"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">월별 기준 금액</span>
            <input
              type="number"
              min={0}
              step={1000}
              value={monthlyFee}
              onChange={(event) => setMonthlyFee(Number(event.target.value || 0))}
              className="rounded-2xl border border-zinc-700/80 bg-zinc-950/90 px-4 py-3 text-[12px] font-black text-zinc-100 outline-none focus:border-[#D8BE78]/55"
            />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <SummaryBox label="대상 회원" value={`${rows.length}명`} tone="review" />
          <SummaryBox label="예상 월회비" value={formatMoney(expectedTotal)} tone="income" />
          <SummaryBox label="수동 확정" value={`${confirmedRows.length}명`} tone="review" />
          <SummaryBox label="완납/연회비" value={`${paidRows.length}명`} tone="income" />
        </div>

        {error && (
          <div className="mt-4 rounded-[22px] border border-red-400/25 bg-red-400/10 px-4 py-3 text-[11px] font-bold leading-relaxed text-red-100">
            {error}
          </div>
        )}

        <div className="mt-4 rounded-[22px] border border-[#D8BE78]/15 bg-[#D8BE78]/10 px-4 py-3 text-[10px] font-bold leading-relaxed text-[#F1E7C4]/65">
          연회비 납부자는 월별 미납으로 잡히지 않도록 별도 상태로 관리합니다. 거래내역 자동 매칭은 추천만 하고, 최종 확정은 재무 담당자가 수행합니다.
        </div>
      </div>

      <div className="overflow-hidden rounded-[30px] border border-white/10 bg-[#242323]/90">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">PAYMENT BOARD</p>
            <h3 className="text-[15px] font-black text-white">월별 납부 현황표</h3>
          </div>
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[9px] font-black text-white/45">
            미납 {unpaidRows.length}명
          </span>
        </div>

        {isLoading ? (
          <EmptyState title="회원 목록을 불러오는 중입니다" body="멤버 목록을 기준으로 월 납부 현황표를 준비하고 있습니다." />
        ) : rows.length === 0 ? (
          <EmptyState title="표시할 회원이 없습니다" body="members 테이블의 회원 목록을 확인해주세요." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-left text-[11px]">
              <thead className="bg-black/35 text-[9px] font-black uppercase tracking-[0.14em] text-white/35">
                <tr>
                  <th className="px-4 py-3">회원</th>
                  <th className="px-4 py-3 text-right">월 기준액</th>
                  <th className="px-4 py-3 text-right">납부액</th>
                  <th className="px-4 py-3">상태</th>
                  <th className="px-4 py-3">거래 매칭</th>
                  <th className="px-4 py-3">확정</th>
                  <th className="px-4 py-3">메모</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {rows.map((row) => (
                  <tr key={row.member_id} className="bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <p className="font-black text-white">{row.member_name}</p>
                      <p className="mt-0.5 text-[9px] font-bold text-white/35">{row.member_role || '직책 없음'}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-black text-white/70">{row.expected_amount.toLocaleString()}원</td>
                    <td className="px-4 py-3 text-right font-black text-white/45">{row.paid_amount.toLocaleString()}원</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black ${paymentStatusClass(row.payment_status)}`}>
                        {paymentStatusLabel(row.payment_status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-white/45">
                      {row.matched_transaction_count > 0 ? `${row.matched_transaction_count}건` : '수동 매칭 예정'}
                    </td>
                    <td className="px-4 py-3 font-bold text-white/45">{row.is_confirmed ? '확정' : '미확정'}</td>
                    <td className="px-4 py-3 font-bold text-white/35">{row.memo || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function SummaryPanel({ summary }: { summary: ReturnType<typeof summarizeFinancePreview> }) {
  return (
    <section className="space-y-4">
      <div className="rounded-[30px] border border-white/10 bg-[#242323]/90 p-5">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#D8BE78]/70">UPLOAD SUMMARY</p>
        <h2 className="mt-1 text-[18px] font-black text-white">업로드 기준 요약</h2>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <SummaryBox label="입금 합계" value={formatMoney(summary.incomeTotal)} tone="income" />
          <SummaryBox label="출금 합계" value={formatMoney(-summary.expenseTotal)} tone="expense" />
          <SummaryBox label="순증감" value={formatMoney(summary.netChange)} tone={summary.netChange >= 0 ? 'income' : 'expense'} />
          <SummaryBox label="확인 필요" value={`${summary.needsReviewCount}건`} tone="review" />
        </div>
      </div>

      <div className="rounded-[30px] border border-white/10 bg-[#242323]/90 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[13px] font-black text-white">카테고리별 합계</h3>
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[9px] font-black text-white/40">
            {summary.rowCount}건
          </span>
        </div>

        <div className="space-y-2">
          {Object.entries(summary.byCategory).length === 0 ? (
            <p className="py-8 text-center text-[11px] font-bold text-white/30">업로드 데이터가 없습니다.</p>
          ) : (
            Object.entries(summary.byCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([category, total]) => (
                <div key={category} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <span className="text-[12px] font-black text-white/75">{category}</span>
                  <span className="text-[12px] font-black text-[#D8BE78]">{total.toLocaleString()}원</span>
                </div>
              ))
          )}
        </div>
      </div>
    </section>
  );
}

function PreviewSummaryCard({
  summary,
  isSaving,
  saveResult,
  onGoPreview,
  onSave,
}: {
  summary: ReturnType<typeof summarizeFinancePreview>;
  isSaving: boolean;
  saveResult: SaveFinanceTransactionsResult | null;
  onGoPreview: () => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-[26px] border border-[#D8BE78]/20 bg-[#D8BE78]/10 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-black text-[#F1E7C4]">{summary.rowCount}건 미리보기 준비</p>
          <p className="mt-1 text-[10px] font-bold text-[#F1E7C4]/60">
            확인 필요 {summary.needsReviewCount}건 · 미분류 {summary.unclassifiedCount}건
          </p>
        </div>
        <div className="grid shrink-0 gap-2">
          <button onClick={onGoPreview} className="rounded-2xl border border-[#D8BE78]/55 bg-[#D8BE78]/20 px-4 py-3 text-[11px] font-black text-[#F1E7C4]">
            확인하기
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="rounded-2xl border border-emerald-300/35 bg-emerald-300/10 px-4 py-3 text-[11px] font-black text-emerald-100 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isSaving ? '저장 중' : '거래내역 저장'}
          </button>
        </div>
      </div>
      {saveResult && (
        <p className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-[10px] font-bold text-[#F1E7C4]/70">
          저장 {saveResult.savedCount}건 · 중복 제외 {saveResult.skippedCount}건 · 실패 {saveResult.failedCount}건
        </p>
      )}
    </div>
  );
}

function AdminPlaceholder({
  eyebrow,
  title,
  body,
  items,
}: {
  eyebrow: string;
  title: string;
  body: string;
  items: string[];
}) {
  return (
    <section className="rounded-[30px] border border-white/10 bg-[#242323]/90 p-5">
      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#D8BE78]/70">{eyebrow}</p>
      <h2 className="mt-1 text-[19px] font-black text-white">{title}</h2>
      <p className="mt-3 text-[11px] font-bold leading-relaxed text-white/45">{body}</p>
      <div className="mt-5 space-y-2">
        {items.map((item) => (
          <div key={item} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-[11px] font-bold text-white/60">
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}

function PublicInfoCard() {
  return (
    <div className="rounded-[24px] border border-emerald-300/15 bg-emerald-300/5 p-4">
      <p className="text-[11px] font-black text-emerald-100">회원 공개 기준</p>
      <p className="mt-2 text-[11px] font-bold leading-relaxed text-emerald-100/60">
        DRAFT 리포트, 확인 필요 거래, 거래 원문은 공개하지 않습니다. 확정된 월간 리포트와 확정 공개 미수금만 표시합니다.
      </p>
    </div>
  );
}

function NoticeBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-[22px] border border-[#D8BE78]/20 bg-[#D8BE78]/10 px-4 py-3 text-[11px] font-bold leading-relaxed text-[#E8D18D]">
      {children}
    </div>
  );
}

function SectionTitle({ eyebrow, title, count }: { eyebrow: string; title: string; count?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/35">{eyebrow}</p>
        <h2 className="text-[17px] font-black text-white">{title}</h2>
      </div>
      {count && (
        <span className="rounded-full border border-[#D8BE78]/25 bg-[#D8BE78]/10 px-3 py-1 text-[10px] font-black text-[#D8BE78]">
          {count}
        </span>
      )}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4 rounded-[26px] border border-white/10 bg-black/20 px-5 py-10 text-center">
      <p className="text-[13px] font-black text-white/75">{title}</p>
      <p className="mx-auto mt-2 max-w-[340px] text-[11px] font-bold leading-relaxed text-white/35">{body}</p>
    </div>
  );
}

function PublicMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">{label}</p>
      <p className="mt-2 text-[16px] font-black tracking-tight text-[#D8BE78]">{value}</p>
    </div>
  );
}

function SummaryBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'income' | 'expense' | 'review';
}) {
  const color =
    tone === 'income'
      ? 'text-emerald-200'
      : tone === 'expense'
        ? 'text-red-200'
        : 'text-amber-100';

  return (
    <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">{label}</p>
      <p className={`mt-2 text-[18px] font-black tracking-tight ${color}`}>{value}</p>
    </div>
  );
}
