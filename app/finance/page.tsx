'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
    FileEdit, Users, Layers, Settings, ChevronRight, AlertCircle,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { canManageFinance } from '@/lib/finance/getFinancePermissions';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import {
    fetchReceivablesByMonth,
} from '@/lib/finance/duesService';
import { summarizeMonthlyDues, summarizeReceivable } from '@/lib/finance/calculatePaymentStatus';
import { supabase } from '@/lib/supabase';
import {
    FinancePageHeader,
    YearMonthPicker,
    KpiCard,
    StatusBadge,
    FINANCE_PAGE_STYLE,
    FINANCE_CONTAINER_STYLE,
    FINANCE_CARD_STYLE,
} from '@/components/finance/FinanceCommon';
import type {
    FinanceDuesPayment,
    FinanceDuesReceivable,
    MonthlyDuesOverview,
} from '@/types/finance';
import MemberFinanceView from '@/components/finance/MemberFinanceView';

/**
 * /finance — 역할 분기 진입점.
 *   - canManageFinance(role) === true  → 관리자 대시보드
 *   - 그 외 (일반 회원)                 → 본인 납부 현황 뷰
 *
 * RLS 가 1차 방어선 — UI gating 은 2차. 일반 회원이 URL 로 admin sub-route 에 직접
 * 진입해도 RLS 가 다른 회원 row 를 차단한다.
 */
export default function FinancePage() {
    const { user, role, isLoading } = useAuth();
    const isAdmin = canManageFinance(role);

    if (isLoading) {
        return (
            <main style={FINANCE_PAGE_STYLE}>
                <div style={{ ...FINANCE_CONTAINER_STYLE, paddingTop: 80, textAlign: 'center' }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8' }}>LOADING...</p>
                </div>
            </main>
        );
    }

    if (!user) {
        return (
            <main style={FINANCE_PAGE_STYLE}>
                <div style={{ ...FINANCE_CONTAINER_STYLE, paddingTop: 80, textAlign: 'center' }}>
                    <p style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>로그인이 필요합니다.</p>
                    <Link href="/" style={{ display: 'inline-block', marginTop: 12, fontSize: 12, fontWeight: 700, color: '#0E7C76' }}>
                        ← 홈으로
                    </Link>
                </div>
            </main>
        );
    }

    if (isAdmin) {
        return <AdminFinanceHome />;
    }
    return (
        <main style={FINANCE_PAGE_STYLE}>
            <div style={FINANCE_CONTAINER_STYLE}>
                <FinancePageHeader
                    eyebrow="TEYEON · FINANCE"
                    title="나의 납부 현황"
                    subtitle="본인의 납부 예정·완료 금액을 확인합니다."
                />
                <MemberFinanceView authUserId={user.id} />
            </div>
        </main>
    );
}

// ── 관리자 홈 ───────────────────────────────────────────────────────────────

function AdminFinanceHome() {
    // URL query (?year=&month=) 우선. 없으면 현재 연/월. 화면 내에서 바꾸면 router.replace 로
    // 동일 URL 에 반영해 새로고침·뒤로가기·다른 Finance 화면 이동 후 복귀에도 선택값 유지.
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const today = new Date();
    const initYear = parseYearParam(searchParams?.get('year'), today.getFullYear());
    const initMonth = parseMonthParam(searchParams?.get('month'), today.getMonth() + 1);
    const [year, setYear] = React.useState(initYear);
    const [month, setMonth] = React.useState(initMonth);

    const updateYearMonth = React.useCallback((y: number, m: number) => {
        setYear(y); setMonth(m);
        const sp = new URLSearchParams(searchParams?.toString() || '');
        sp.set('year', String(y));
        sp.set('month', String(m));
        router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    }, [router, pathname, searchParams]);

    const [overview, setOverview] = React.useState<MonthlyDuesOverview | null>(null);
    const [receivables, setReceivables] = React.useState<FinanceDuesReceivable[]>([]);
    const [payments, setPayments] = React.useState<FinanceDuesPayment[]>([]);
    const [memberNames, setMemberNames] = React.useState<Record<string, string>>({});
    const [latestUpdate, setLatestUpdate] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const recv = await fetchReceivablesByMonth(year, month);
                const recvIds = recv.map((r) => r.id);
                const { data: payRows } = recvIds.length > 0
                    ? await supabase.from('finance_dues_payments').select('*').in('receivable_id', recvIds)
                    : { data: [] as FinanceDuesPayment[] };
                const pays = (payRows || []) as FinanceDuesPayment[];

                const memberIds = Array.from(new Set(recv.map((r) => r.member_id)));
                const names: Record<string, string> = {};
                if (memberIds.length > 0) {
                    const { data: mRows } = await supabase
                        .from('members').select('id, nickname').in('id', memberIds);
                    for (const m of (mRows || []) as any[]) {
                        names[m.id] = m.nickname || '회원 정보 없음';
                    }
                }

                let latest: string | null = null;
                for (const p of pays) {
                    if (!p.updated_at) continue;
                    if (!latest || p.updated_at > latest) latest = p.updated_at;
                }

                if (cancelled) return;
                setReceivables(recv);
                setPayments(pays);
                setMemberNames(names);
                setOverview(summarizeMonthlyDues(year, month, recv, pays));
                setLatestUpdate(latest);
            } catch (e) {
                console.warn('[Finance/admin home]', e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [year, month]);

    // 처리 필요 — 미납 + 일부 납부, 최대 5건.
    const needsAction = React.useMemo(() => {
        return receivables
            .map((r) => ({ r, s: summarizeReceivable(r, payments) }))
            .filter(({ s }) => s.derivedStatus === 'pending' || s.derivedStatus === 'partial')
            .sort((a, b) => b.s.remaining - a.s.remaining)
            .slice(0, 5);
    }, [receivables, payments]);

    return (
        <main style={FINANCE_PAGE_STYLE}>
            <div style={FINANCE_CONTAINER_STYLE}>
                <FinancePageHeader
                    eyebrow="TEYEON · FINANCE"
                    title="TEYEON 재무"
                    subtitle="회비·납부 관리"
                />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <YearMonthPicker year={year} month={month} onChange={updateYearMonth} />
                    {latestUpdate && (
                        <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: '#94A3B8' }}>
                            최근 기록 {formatTs(latestUpdate)}
                        </p>
                    )}
                </div>

                {loading && (
                    <p style={{ margin: '24px 0', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>
                        불러오는 중...
                    </p>
                )}

                {!loading && overview && (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <KpiCard label="대상" value={`${overview.targetCount}명`} accent="default" />
                            <KpiCard label="완료" value={`${overview.paidCount}명`} accent="teal" sub={`${overview.paidRate}%`} />
                            <KpiCard label="일부 납부" value={`${overview.partialCount}명`} accent="amber" />
                            <KpiCard label="미납" value={`${overview.pendingCount}명`} accent="red" />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <KpiCard label="총 납부 대상" value={formatWon(overview.totalDue)} accent="default" />
                            <KpiCard label="총 납부 완료" value={formatWon(overview.totalPaid)} accent="teal" />
                        </div>
                        <KpiCard label="총 남은 금액" value={formatWon(overview.totalRemaining)} accent="red" />

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <QuickAction
                                href={`/finance/record?year=${year}&month=${month}`}
                                icon={<FileEdit size={18} />} label="납부 기록 등록" />
                            <QuickAction
                                href={`/finance/payments?year=${year}&month=${month}`}
                                icon={<Users size={18} />}    label="납부 현황" />
                            <QuickAction
                                href={`/finance/bulk?year=${year}&month=${month}`}
                                icon={<Layers size={18} />}   label="일괄 납부 처리" />
                            <QuickAction
                                href={`/finance/settings?year=${year}&month=${month}`}
                                icon={<Settings size={18} />} label="회비 기준 설정" />
                        </div>

                        <section style={FINANCE_CARD_STYLE}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                <AlertCircle size={14} style={{ color: '#B45309' }} />
                                <h3 style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0F172A' }}>
                                    처리 필요
                                </h3>
                                <Link
                                    href="/finance/payments"
                                    style={{
                                        marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: '#0E7C76',
                                        textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3,
                                    }}
                                >
                                    전체 보기 <ChevronRight size={11} />
                                </Link>
                            </div>
                            {needsAction.length === 0 ? (
                                <p style={{ margin: '8px 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8', textAlign: 'center' }}>
                                    처리 필요 항목이 없습니다.
                                </p>
                            ) : (
                                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {needsAction.map(({ r, s }) => (
                                        <li
                                            key={r.id}
                                            style={{
                                                borderTop: '1px dashed rgba(15,23,42,0.05)',
                                            }}
                                        >
                                            {/* 회원 상세 진입 — 휴회 처리 / 면제 / 메모를 같은 화면에서 한 번에.
                                                year/month 쿼리는 현재 선택값을 그대로 전달. */}
                                            <Link
                                                href={`/finance/members/${encodeURIComponent(r.member_id)}?year=${year}&month=${month}`}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 10,
                                                    paddingTop: 8, paddingBottom: 8,
                                                    textDecoration: 'none', color: 'inherit',
                                                }}
                                            >
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <p style={{
                                                        margin: 0, fontSize: 12.5, fontWeight: 800, color: '#0F172A',
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    }}>
                                                        {memberNames[r.member_id] || '회원 정보 없음'}
                                                    </p>
                                                    <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 600, color: '#64748B' }}>
                                                        {r.title || `${r.target_year}년 ${r.target_month}월 회비`}
                                                    </p>
                                                </div>
                                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                    <p style={{ margin: 0, fontSize: 12, fontWeight: 900, color: '#B91C1C', whiteSpace: 'nowrap' }}>
                                                        {formatWon(s.remaining)}
                                                    </p>
                                                    <div style={{ marginTop: 2 }}>
                                                        <StatusBadge tone={s.derivedStatus === 'partial' ? 'partial' : 'pending'}>
                                                            {s.derivedStatus === 'partial' ? '일부 납부' : '미납'}
                                                        </StatusBadge>
                                                    </div>
                                                </div>
                                                <ChevronRight size={14} style={{ color: '#CBD5E1', flexShrink: 0 }} />
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    </>
                )}
            </div>
        </main>
    );
}

function QuickAction({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
    return (
        <Link
            href={href}
            style={{
                ...FINANCE_CARD_STYLE,
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8,
                textDecoration: 'none', padding: 14,
            }}
        >
            <span style={{
                width: 32, height: 32, borderRadius: 8,
                backgroundColor: 'rgba(15,159,152,0.10)', color: '#0F9F98',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
                {icon}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.01em' }}>
                {label}
            </span>
        </Link>
    );
}

function formatTs(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}.${m}.${day} ${hh}:${mm}`;
}

// URL query parser — 잘못된 값(빈 문자열, 'NaN', '0', '13' 등) 은 fallback.
// Finance 전 페이지가 같은 규칙을 쓰도록 동일 형태를 다른 페이지에도 인라인 복제.
function parseYearParam(raw: string | null | undefined, fallback: number): number {
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 2020 || n > 2099) return fallback;
    return n;
}
function parseMonthParam(raw: string | null | undefined, fallback: number): number {
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 12) return fallback;
    return n;
}
