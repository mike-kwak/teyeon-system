'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { canManageFinance } from '@/lib/finance/getFinancePermissions';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import {
    fetchReceivablesByMonth,
    fetchAllMembers,
    bulkCreateMonthlyReceivables,
    fetchAnnualFeePaidSet,
    isMonthlyFeeTargetMember,
    type FinanceMember,
} from '@/lib/finance/duesService';
import { fetchAllLeaves, isMemberOnLeaveAtMonth } from '@/lib/finance/leavesService';
import { fetchFeeRule } from '@/lib/finance/feeRulesService';
import { summarizeReceivable } from '@/lib/finance/calculatePaymentStatus';
import { supabase } from '@/lib/supabase';
import {
    FinancePageHeader,
    YearMonthPicker,
    StatusBadge,
    FINANCE_PAGE_STYLE,
    FINANCE_CONTAINER_STYLE,
    FINANCE_CARD_STYLE,
} from '@/components/finance/FinanceCommon';
import type {
    FinanceDuesPayment,
    FinanceDuesReceivable,
    FinanceMemberLeave,
    PaymentDerivedStatus,
} from '@/types/finance';
import FinanceNoticeCreateModal from '@/components/finance/FinanceNoticeCreateModal';
import { Megaphone, ChevronRight } from 'lucide-react';

/**
 * /finance/payments — 월별 회원 납부 현황.
 *   - 상단: 연·월 + 인원 요약
 *   - 필터: 전체 / 미납 / 일부 / 완료 / 면제·비대상
 *   - row: 회원명 + 항목 + 남은 금액 + 상태
 *   - "이 달 receivable 생성" 헬퍼 — 회비 기준이 있는 월에 한 번에 만든다.
 */

type Filter = 'all' | 'pending' | 'partial' | 'paid' | 'exempt';

export default function FinancePaymentsPage() {
    const { role, isLoading } = useAuth();
    const isAdmin = canManageFinance(role);

    // URL query (?year=&month=) 우선. 화면에서 바뀌면 router.replace 로 같은 URL 에 반영
    // → 새로고침·뒤로가기·일괄 생성 후·회원 상세 갔다 돌아와도 선택값 유지.
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const today = new Date();
    const initYear = parseYearParam(searchParams?.get('year'), today.getFullYear());
    const initMonth = parseMonthParam(searchParams?.get('month'), today.getMonth() + 1);
    const [year, setYear] = React.useState(initYear);
    const [month, setMonth] = React.useState(initMonth);
    const [filter, setFilter] = React.useState<Filter>('all');

    const updateYearMonth = React.useCallback((y: number, m: number) => {
        setYear(y); setMonth(m);
        const sp = new URLSearchParams(searchParams?.toString() || '');
        sp.set('year', String(y));
        sp.set('month', String(m));
        router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    }, [router, pathname, searchParams]);

    const [members, setMembers] = React.useState<FinanceMember[]>([]);
    const [receivables, setReceivables] = React.useState<FinanceDuesReceivable[]>([]);
    const [payments, setPayments] = React.useState<FinanceDuesPayment[]>([]);
    const [leaves, setLeaves] = React.useState<FinanceMemberLeave[]>([]);
    const [annualPaidSet, setAnnualPaidSet] = React.useState<Set<string>>(new Set());
    const [loading, setLoading] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [showNoticeModal, setShowNoticeModal] = React.useState(false);

    const load = React.useCallback(async () => {
        setLoading(true);
        const [recv, mems, lvs] = await Promise.all([
            fetchReceivablesByMonth(year, month),
            fetchAllMembers(),
            fetchAllLeaves(),
        ]);
        const recvIds = recv.map((r) => r.id);
        const { data: payRows } = recvIds.length > 0
            ? await supabase.from('finance_dues_payments').select('*').in('receivable_id', recvIds)
            : { data: [] as FinanceDuesPayment[] };
        setMembers(mems);
        setReceivables(recv);
        setPayments((payRows || []) as FinanceDuesPayment[]);
        setLeaves(lvs);
        setLoading(false);
        // 연회비 완료 회원(선택 연도 기준) — 배지/공지에 사용. 본문 로딩과 분리(실패해도 화면 영향 없음).
        fetchAnnualFeePaidSet(year, mems, lvs)
            .then(setAnnualPaidSet)
            .catch(() => setAnnualPaidSet(new Set()));
    }, [year, month]);

    React.useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

    if (!isLoading && !isAdmin) {
        return (
            <main style={FINANCE_PAGE_STYLE}>
                <div style={{ ...FINANCE_CONTAINER_STYLE, paddingTop: 80, textAlign: 'center' }}>
                    <p style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>운영자만 접근할 수 있는 페이지입니다.</p>
                    <Link href="/finance" style={{ display: 'inline-block', marginTop: 12, fontSize: 12, fontWeight: 700, color: '#0E7C76' }}>
                        ← Finance
                    </Link>
                </div>
            </main>
        );
    }

    const memberById = React.useMemo(() => {
        const m: Record<string, FinanceMember> = {};
        for (const x of members) m[x.id] = x;
        return m;
    }, [members]);

    const rows = React.useMemo(() => {
        const enriched = receivables.map((r) => ({ r, s: summarizeReceivable(r, payments) }));
        return enriched.filter(({ s }) => {
            if (filter === 'all') return true;
            if (filter === 'pending') return s.derivedStatus === 'pending';
            if (filter === 'partial') return s.derivedStatus === 'partial';
            if (filter === 'paid')    return s.derivedStatus === 'paid';
            if (filter === 'exempt')  return s.derivedStatus === 'exempt' || s.derivedStatus === 'not_target';
            return true;
        });
    }, [receivables, payments, filter]);

    const counts = React.useMemo(() => {
        const c = { target: receivables.length, paid: 0, partial: 0, pending: 0, exempt: 0 };
        for (const r of receivables) {
            const s = summarizeReceivable(r, payments);
            if (s.derivedStatus === 'paid') c.paid++;
            else if (s.derivedStatus === 'partial') c.partial++;
            else if (s.derivedStatus === 'pending') c.pending++;
            else c.exempt++;
        }
        return c;
    }, [receivables, payments]);

    // 이번 달 휴회 회원 수 — 면제·비대상과 구분해 표시.
    const onLeaveCount = React.useMemo(() => {
        return members.filter((m) => isMemberOnLeaveAtMonth(leaves, m.id, year, month)).length;
    }, [members, leaves, year, month]);

    // 준회원·게스트 수 — 월회비 자동 제외 대상 표시용.
    const associateCount = React.useMemo(() => {
        return members.filter((m) => !isMonthlyFeeTargetMember(m.role)).length;
    }, [members]);

    // 일괄 생성 버튼은 "한 명이라도 누락된 회원이 있을 때" 항상 보인다.
    // 기존: receivables.length === 0 일 때만 노출 → 1건이라도 있으면 사라져 회귀 발생.
    const missingTargetCount = React.useMemo(() => {
        const taken = new Set(receivables.map((r) => r.member_id));
        return members.filter((m) =>
            !taken.has(m.id) &&
            !isMemberOnLeaveAtMonth(leaves, m.id, year, month) &&
            isMonthlyFeeTargetMember(m.role),
        ).length;
    }, [members, receivables, leaves, year, month]);

    // 회비 기준이 있는 월에 한 번에 receivable 생성 — UX helper.
    // 분류 우선순위 (한 회원은 정확히 1개 분류로 들어간다):
    //   1) 기존 청구 존재 (이미 receivables 에 row 있음)
    //   2) 휴회 (leaves 가 해당 월과 겹침)
    //   3) 준회원·게스트 (members.role 기준 — 신규 컬럼 추가 없이 기존 필드 재사용)
    //   4) 대상 (실제 INSERT 됨)
    // confirm 다이얼로그에 4종 카운트를 모두 노출해 운영진이 결과를 미리 확인.
    const handleSeed = async () => {
        const rule = await fetchFeeRule(year, month);
        if (!rule) {
            alert(`${year}년 ${month}월 회비 기준이 없습니다. 회비 기준 설정에서 먼저 등록해 주세요.`);
            return;
        }
        if (!(rule.default_amount > 0)) {
            const okZero = window.confirm(
                `${year}년 ${month}월 회비 기준 금액이 0원입니다.\n그래도 진행하시겠습니까?`,
            );
            if (!okZero) return;
        }

        const existingSet = new Set(receivables.map((r) => r.member_id));
        const buckets = {
            existing:  [] as FinanceMember[],
            onLeave:   [] as FinanceMember[],
            associate: [] as FinanceMember[],
            target:    [] as FinanceMember[],
        };
        for (const m of members) {
            if (existingSet.has(m.id)) { buckets.existing.push(m); continue; }
            if (isMemberOnLeaveAtMonth(leaves, m.id, year, month)) { buckets.onLeave.push(m); continue; }
            if (!isMonthlyFeeTargetMember(m.role)) { buckets.associate.push(m); continue; }
            buckets.target.push(m);
        }

        if (buckets.target.length === 0) {
            const exclusionLines = [
                buckets.existing.length  > 0 && `기존 청구 ${buckets.existing.length}명`,
                buckets.onLeave.length   > 0 && `휴회 ${buckets.onLeave.length}명`,
                buckets.associate.length > 0 && `준회원·게스트 ${buckets.associate.length}명`,
            ].filter(Boolean).join(' · ');
            alert(
                exclusionLines
                    ? `신규 생성 대상이 없습니다.\n(${exclusionLines})`
                    : '이번 달은 이미 모든 회원에게 청구가 생성되어 있습니다.',
            );
            return;
        }
        const lines = [
            `${year}년 ${month}월 회비 ${formatWon(rule.default_amount)}`,
            ``,
            `· 월회비 대상 ${buckets.target.length}명`,
            buckets.existing.length  > 0 ? `· 기존 청구 존재 ${buckets.existing.length}명` : '',
            buckets.onLeave.length   > 0 ? `· 휴회 제외 ${buckets.onLeave.length}명` : '',
            buckets.associate.length > 0 ? `· 준회원 제외 ${buckets.associate.length}명` : '',
            ``,
            `진행하시겠습니까?`,
        ].filter(Boolean).join('\n');
        const ok = window.confirm(lines);
        if (!ok) return;
        setBusy(true);
        try {
            const created = await bulkCreateMonthlyReceivables({
                memberIds: buckets.target.map((m) => m.id),
                year, month,
                amount: rule.default_amount,
                dueDate: rule.due_date,
            });
            await load();
            alert(`${created.length}건 생성 완료.`);
        } catch (e: any) {
            alert(e?.message || '생성에 실패했습니다.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <main style={FINANCE_PAGE_STYLE}>
            <div style={FINANCE_CONTAINER_STYLE}>
                <FinancePageHeader
                    eyebrow="TEYEON · FINANCE"
                    title="납부 현황"
                    subtitle="월별 회원 납부 상태를 확인합니다."
                    backHref="/finance"
                />

                <YearMonthPicker year={year} month={month} onChange={updateYearMonth} />

                {/* 카운트 요약 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11.5, fontWeight: 700, color: '#475569' }}>
                    <Tag>대상 {counts.target}</Tag>
                    <Tag tone="teal">완료 {counts.paid}</Tag>
                    <Tag tone="amber">일부 {counts.partial}</Tag>
                    <Tag tone="red">미납 {counts.pending}</Tag>
                    <Tag>면제·비대상 {counts.exempt}</Tag>
                    {onLeaveCount > 0 && <Tag>휴회 {onLeaveCount}</Tag>}
                    {associateCount > 0 && <Tag>준회원·게스트 {associateCount}</Tag>}
                </div>

                {/* 회원 공지 — 현재 (연·월) 미납·일부 납부 현황을 스냅샷 공개 링크로 생성 / 목록 관리. */}
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        type="button"
                        onClick={() => setShowNoticeModal(true)}
                        style={{
                            flex: 1, height: 40, borderRadius: 10, border: 'none', cursor: 'pointer',
                            backgroundColor: '#0F9F98', color: '#FFFFFF',
                            fontSize: 12.5, fontWeight: 800,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        }}
                    >
                        <Megaphone size={15} />
                        회원 공지 만들기
                    </button>
                    <Link
                        href="/finance/notices"
                        style={{
                            height: 40, paddingLeft: 12, paddingRight: 10, borderRadius: 10,
                            border: '1px solid rgba(15,23,42,0.12)', backgroundColor: '#FFFFFF', color: '#334155',
                            fontSize: 12, fontWeight: 800, textDecoration: 'none',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 2, flexShrink: 0,
                        }}
                    >
                        공지 목록
                        <ChevronRight size={14} />
                    </Link>
                </div>

                {/* 필터 — 가로 스크롤. */}
                <div style={{
                    display: 'flex', gap: 6, overflowX: 'auto',
                    paddingBottom: 4, paddingRight: 8,
                    WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
                }}>
                    {([
                        ['all',     '전체'],
                        ['pending', '미납'],
                        ['partial', '일부 납부'],
                        ['paid',    '납부 완료'],
                        ['exempt',  '면제·비대상'],
                    ] as [Filter, string][]).map(([k, label]) => (
                        <button
                            key={k}
                            type="button"
                            onClick={() => setFilter(k)}
                            style={{
                                height: 30, paddingLeft: 12, paddingRight: 12,
                                borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0,
                                backgroundColor: filter === k ? '#0F172A' : '#FFFFFF',
                                color: filter === k ? '#FFFFFF' : '#475569',
                                border: `1px solid ${filter === k ? '#0F172A' : 'rgba(15,23,42,0.10)'}`,
                                fontSize: 11.5, fontWeight: 800,
                                cursor: 'pointer',
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* seed 헬퍼 — 누락된 정회원이 있을 때 항상 표시.
                    이전: receivables.length === 0 일 때만 보여 1건이라도 생기면 사라지는 회귀가 있었음. */}
                {!loading && missingTargetCount > 0 && (
                    <section style={FINANCE_CARD_STYLE}>
                        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#0F172A' }}>
                            {receivables.length === 0
                                ? '이번 달 청구가 없습니다.'
                                : `누락된 회원 ${missingTargetCount}명`}
                        </p>
                        <p style={{ margin: '4px 0 10px', fontSize: 11, fontWeight: 600, color: '#64748B' }}>
                            회비 기준이 설정되어 있다면 휴회·준회원·기존 청구를 자동 제외하고 생성합니다.
                        </p>
                        <button
                            type="button"
                            onClick={handleSeed}
                            disabled={busy}
                            style={{
                                height: 36, paddingLeft: 14, paddingRight: 14,
                                borderRadius: 8,
                                backgroundColor: busy ? '#CBD5E1' : '#0F9F98',
                                color: '#FFFFFF', border: 'none',
                                fontSize: 12, fontWeight: 800,
                                cursor: busy ? 'wait' : 'pointer',
                            }}
                        >
                            {busy
                                ? '생성 중...'
                                : receivables.length === 0
                                    ? '월회비 일괄 생성'
                                    : `누락된 ${missingTargetCount}명에게 생성`}
                        </button>
                    </section>
                )}

                {loading && <p style={{ textAlign: 'center', fontSize: 12, color: '#94A3B8' }}>불러오는 중...</p>}

                {!loading && rows.length > 0 && (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {rows.map(({ r, s }) => (
                            <li key={r.id}>
                                <Link
                                    href={`/finance/members/${encodeURIComponent(r.member_id)}?year=${year}&month=${month}`}
                                    style={{
                                        ...FINANCE_CARD_STYLE,
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        textDecoration: 'none',
                                        padding: 12,
                                    }}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                            <p style={{
                                                margin: 0, fontSize: 12.5, fontWeight: 800, color: '#0F172A',
                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            }}>
                                                {memberById[r.member_id]?.nickname || '회원 정보 없음'}
                                            </p>
                                            {annualPaidSet.has(r.member_id) && (
                                                <span style={{
                                                    flexShrink: 0,
                                                    paddingTop: 1, paddingBottom: 1, paddingLeft: 6, paddingRight: 6,
                                                    borderRadius: 999, whiteSpace: 'nowrap',
                                                    backgroundColor: 'rgba(15,159,152,0.12)', color: '#0E7C76',
                                                    border: '1px solid rgba(15,159,152,0.28)',
                                                    fontSize: 9, fontWeight: 800,
                                                }}>
                                                    연회비 완료
                                                </span>
                                            )}
                                        </div>
                                        <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 600, color: '#64748B' }}>
                                            {r.title || `${year}년 ${month}월 회비`}
                                        </p>
                                        <p style={{ margin: '4px 0 0', fontSize: 10, fontWeight: 600, color: '#94A3B8' }}>
                                            기준 {formatWon(r.amount_due)} · 완료 {formatWon(s.amount_paid)}
                                            {s.latestPaidAt ? ` · ${s.latestPaidAt}` : ''}
                                        </p>
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <p style={{
                                            margin: 0, fontSize: 13, fontWeight: 900,
                                            color: s.remaining > 0 ? '#B91C1C' : '#0E7C76',
                                            whiteSpace: 'nowrap',
                                        }}>
                                            {formatWon(s.remaining)}
                                        </p>
                                        <div style={{ marginTop: 2 }}>
                                            <StatusBadge tone={mapTone(s.derivedStatus)}>
                                                {labelOf(s.derivedStatus)}
                                            </StatusBadge>
                                        </div>
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {showNoticeModal && (
                <FinanceNoticeCreateModal
                    year={year}
                    month={month}
                    members={members}
                    receivables={receivables}
                    payments={payments}
                    leaves={leaves}
                    annualPaidIds={annualPaidSet}
                    onClose={() => setShowNoticeModal(false)}
                />
            )}
        </main>
    );
}

function Tag({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'teal' | 'amber' | 'red' }) {
    const palette = {
        default: { bg: '#F1F5F9', color: '#475569', border: 'rgba(15,23,42,0.08)' },
        teal:    { bg: 'rgba(15,159,152,0.10)', color: '#0E7C76', border: 'rgba(15,159,152,0.24)' },
        amber:   { bg: 'rgba(245,158,11,0.10)', color: '#92400E', border: 'rgba(245,158,11,0.24)' },
        red:     { bg: 'rgba(220,38,38,0.10)',  color: '#B91C1C', border: 'rgba(220,38,38,0.28)' },
    }[tone];
    return (
        <span style={{
            paddingTop: 4, paddingBottom: 4, paddingLeft: 10, paddingRight: 10,
            borderRadius: 999, fontSize: 11, fontWeight: 800,
            backgroundColor: palette.bg, color: palette.color, border: `1px solid ${palette.border}`,
        }}>
            {children}
        </span>
    );
}

function mapTone(s: PaymentDerivedStatus): 'paid' | 'partial' | 'pending' | 'exempt' | 'not_target' {
    return s;
}
function labelOf(s: PaymentDerivedStatus): string {
    return s === 'paid' ? '납부 완료'
        : s === 'partial' ? '일부 납부'
        : s === 'pending' ? '미납'
        : s === 'exempt' ? '면제'
        : '비대상';
}

// URL query parser — /finance 와 동일 규칙. 페이지마다 인라인 복제.
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
