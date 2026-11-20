// KDK 누적 벌금 현황 — 조회 service(읽기 전용).
//
//   - 쓰기(INSERT/UPDATE/DELETE/RPC) 없음. 신규 테이블/View/RPC 없음 — 기존 테이블 SELECT 만.
//   - 권한: 기존 RLS 그대로(finance_dues_* = 본인 또는 is_finance_manager, kdk_guest_penalty_payments =
//     is_finance_manager). 화면은 canManageFinance 일 때만 이 함수를 호출한다.
//   - 필요한 컬럼만 선택(전화번호·이메일 등 개인정보 미조회. members 는 id·nickname 만).
//   - Supabase 기본 행 제한(1,000) 때문에 과거 기록이 잘리지 않도록 모든 조회를 range 페이지네이션한다.
//   - 어느 한 조회라도 실패하면 예외를 던진다 — 일부만 받은 결과를 전체 합계처럼 보여주지 않는다.
//     (게스트 저장소 미적용(테이블 없음)만 예외: 세션 정산 화면과 같이 게스트를 '확인 필요'로 표시.)

import { supabase } from '../supabase';
import {
    buildPenaltyHistory,
    type HistoryGuestPaymentInput,
    type HistorySessionInput,
    type PenaltyHistory,
    type PenaltyHistoryDataset,
} from './kdkPenaltyHistoryModel';
import type { FinanceDuesPayment, FinanceDuesReceivable } from '@/types/finance';
import type { KdkSettlementEntry } from './kdkPenaltyService';

const PAGE_SIZE = 1000;
/** 안전 상한(페이지 수). 넘으면 잘린 결과로 합계를 내지 않도록 예외. */
const MAX_PAGES = 200;
/** receivable_id IN (...) 한 번에 보낼 id 수(URL 길이 제한 대비). */
const ID_CHUNK = 100;

interface PostgrestLikeError { code?: string; message?: string; details?: string; hint?: string }
type PageFetcher = (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: PostgrestLikeError | null }>;

/** 조회 실패 — 원본 PostgREST 오류를 cause 로 보존(게스트 저장소 미적용 판정용). */
export class HistoryFetchError extends Error {
    readonly pgError: PostgrestLikeError;
    constructor(message: string, pgError: PostgrestLikeError) {
        super(message);
        this.name = 'HistoryFetchError';
        this.pgError = pgError;
    }
}

/** range 페이지네이션으로 전부 받는다. 실패 시 예외(부분 결과 반환 금지). */
export async function fetchAllPages<T>(label: string, fetchPage: PageFetcher, pageSize = PAGE_SIZE): Promise<T[]> {
    const out: T[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
        const from = page * pageSize;
        const { data, error } = await fetchPage(from, from + pageSize - 1);
        if (error) {
            console.warn(`[Finance/kdkPenaltyHistory/${label}]`, error?.message ?? error);
            throw new HistoryFetchError(`${label} 조회에 실패했습니다. ${error?.message || ''}`.trim(), error);
        }
        const rows = (data || []) as T[];
        out.push(...rows);
        if (rows.length < pageSize) return out;
    }
    throw new Error(`${label} 기록이 너무 많아 한 번에 집계할 수 없습니다.`);
}

function toDate(raw: unknown, createdAt: unknown): string | null {
    const s = String(raw || '').trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const c = String(createdAt || '');
    return /^\d{4}-\d{2}-\d{2}/.test(c) ? c.slice(0, 10) : null;
}

/** 공식 · 비테스트 · KDK 세션(정산 스냅샷만). kdkSessionListService 와 같은 포함 기준. */
async function fetchOfficialSessions(): Promise<HistorySessionInput[]> {
    interface ArchiveListRow {
        id: string; created_at: string | null; is_official: boolean | null; is_test: boolean | null;
        archive_type: string | null; date: string | null; title: string | null; settlement: unknown;
    }
    const rows = await fetchAllPages<ArchiveListRow>('KDK 세션', (from, to) => supabase
        .from('teyeon_archive_v1')
        .select('id, created_at, is_official, is_test, archive_type, date:raw_data->>date, title:raw_data->>title, settlement:raw_data->settlement_data')
        .eq('is_official', true)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to));
    const out: HistorySessionInput[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        if (row?.is_official !== true || row?.is_test === true) continue;
        if (String(row?.archive_type || 'kdk').toLowerCase() !== 'kdk') continue;
        const id = String(row.id);
        if (seen.has(id)) continue; // 페이지 경계 중복 방어.
        seen.add(id);
        out.push({
            id,
            date: toDate(row?.date, row?.created_at),
            title: String(row?.title || '').trim() || 'KDK 세션',
            settlementData: Array.isArray(row?.settlement) ? (row.settlement as KdkSettlementEntry[]) : null,
        });
    }
    return out;
}

async function fetchMembersMinimal(): Promise<{ id: string; nickname: string | null }[]> {
    return fetchAllPages('회원', (from, to) => supabase
        .from('members')
        .select('id, nickname')
        .order('id', { ascending: true })
        .range(from, to));
}

const RECV_COLS = 'id, member_id, receivable_type, title, amount_due, status, related_kdk_session_id, created_at';
const PAY_COLS = 'id, member_id, receivable_id, payment_type, amount, paid_at, is_voided, created_at';

async function fetchPenaltyReceivables(): Promise<FinanceDuesReceivable[]> {
    return fetchAllPages('벌금 청구', (from, to) => supabase
        .from('finance_dues_receivables')
        .select(RECV_COLS)
        .eq('receivable_type', 'penalty')
        .order('id', { ascending: true })
        .range(from, to));
}

async function fetchPaymentsForReceivables(ids: string[]): Promise<FinanceDuesPayment[]> {
    const out: FinanceDuesPayment[] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const chunk = ids.slice(i, i + ID_CHUNK);
        const rows = await fetchAllPages<FinanceDuesPayment>('벌금 납부', (from, to) => supabase
            .from('finance_dues_payments')
            .select(PAY_COLS)
            .in('receivable_id', chunk)
            .order('id', { ascending: true })
            .range(from, to));
        out.push(...rows);
    }
    return out;
}

async function fetchUnlinkedPenaltyPayments(): Promise<FinanceDuesPayment[]> {
    return fetchAllPages('미연결 벌금 납부', (from, to) => supabase
        .from('finance_dues_payments')
        .select(PAY_COLS)
        .eq('payment_type', 'penalty')
        .is('receivable_id', null)
        .order('id', { ascending: true })
        .range(from, to));
}

/** kdkGuestPenaltyService.isMissingObject 와 같은 판정(테이블 미적용 → 기능 비활성). */
function isMissingGuestTable(error: PostgrestLikeError | undefined): boolean {
    const code = String(error?.code || '');
    if (['42P01', 'PGRST205'].includes(code)) return true;
    const msg = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
    return /kdk_guest_penalty/i.test(msg) && /(does not exist|not find|schema cache|relation)/i.test(msg);
}

async function fetchGuestPayments(): Promise<{ available: boolean; rows: HistoryGuestPaymentInput[] }> {
    try {
        const rows = await fetchAllPages<HistoryGuestPaymentInput>('게스트 벌금 납부', (from, to) => supabase
            .from('kdk_guest_penalty_payments')
            .select('id, session_id, participant_id, amount, status, paid_at')
            .eq('charge_type', 'penalty')
            .order('id', { ascending: true })
            .range(from, to));
        return { available: true, rows };
    } catch (e) {
        if (e instanceof HistoryFetchError && isMissingGuestTable(e.pgError)) return { available: false, rows: [] };
        throw e;
    }
}

export async function loadPenaltyHistoryDataset(): Promise<PenaltyHistoryDataset> {
    const [sessions, members, receivables, unlinkedPayments, guest] = await Promise.all([
        fetchOfficialSessions(),
        fetchMembersMinimal(),
        fetchPenaltyReceivables(),
        fetchUnlinkedPenaltyPayments(),
        fetchGuestPayments(),
    ]);
    const payments = await fetchPaymentsForReceivables(receivables.map((r) => r.id));
    return {
        sessions, members, receivables, payments, unlinkedPayments,
        guestAvailable: guest.available, guestPayments: guest.rows,
    };
}

// ── 짧은 메모리 캐시: 목록 ↔ 회원 상세 이동 시 같은 조회를 반복하지 않는다(쓰기 화면이 아니므로 안전). ──
const CACHE_TTL_MS = 60_000;
let cache: { at: number; userKey: string; promise: Promise<PenaltyHistory> } | null = null;

export interface LoadedPenaltyHistory {
    history: PenaltyHistory;
    loadedAt: number;
}

/** userKey: 로그인 사용자 id — 계정이 바뀌면 캐시를 쓰지 않는다. */
export async function loadPenaltyHistory(opts: { force?: boolean; userKey: string }): Promise<LoadedPenaltyHistory> {
    const now = Date.now();
    if (!opts.force && cache && cache.userKey === opts.userKey && now - cache.at < CACHE_TTL_MS) {
        return { history: await cache.promise, loadedAt: cache.at };
    }
    const entry = { at: now, userKey: opts.userKey, promise: loadPenaltyHistoryDataset().then(buildPenaltyHistory) };
    cache = entry;
    try {
        return { history: await entry.promise, loadedAt: entry.at };
    } catch (e) {
        if (cache === entry) cache = null; // 실패 결과는 캐시하지 않는다.
        throw e;
    }
}
