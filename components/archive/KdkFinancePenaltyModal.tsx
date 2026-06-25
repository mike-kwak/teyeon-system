'use client';

// KDK 공식 기록 → Finance 벌금 등록 미리보기/등록 모달.
//   진입: Archive 공식 기록 상세의 운영진 전용 'Finance 벌금 등록' 버튼.
//   흐름: 미리보기(대상·금액·연결 상태) → 운영진이 선택 → 'Finance에 등록' → 완료 요약.
//   자동 확정이 아니라 반자동(운영진 확인 후 반영). 금액은 settlement 스냅샷 그대로 사용.

import React from 'react';
import { X } from 'lucide-react';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import { fetchAllMembers, type FinanceMember } from '@/lib/finance/duesService';
import {
    buildKdkPenaltyPreview,
    fetchExistingKdkPenalties,
    registerKdkPenalties,
    type KdkPenaltyPreviewRow,
    type KdkSettlementEntry,
    type RegisterKdkPenaltiesResult,
} from '@/lib/finance/kdkPenaltyService';

export interface KdkFinancePenaltySession {
    id: string;
    title?: string;
    date?: string;
    venue?: string | null;
    is_official?: boolean;
    is_test?: boolean;
    participantCount?: number;
    settlementData?: KdkSettlementEntry[];
}

interface Props {
    session: KdkFinancePenaltySession;
    createdBy?: string | null;
    onClose: () => void;
    /** 등록이 1건이라도 성공하면 호출(Archive 상세의 등록 상태 갱신용). */
    onRegistered?: () => void;
}

const NAVY = '#0F2747';

export default function KdkFinancePenaltyModal({ session, createdBy, onClose, onRegistered }: Props) {
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [rows, setRows] = React.useState<KdkPenaltyPreviewRow[]>([]);
    const [selected, setSelected] = React.useState<Set<string>>(new Set());
    const [busy, setBusy] = React.useState(false);
    const [result, setResult] = React.useState<RegisterKdkPenaltiesResult | null>(null);

    const settlementData = React.useMemo<KdkSettlementEntry[]>(
        () => (Array.isArray(session.settlementData) ? session.settlementData : []),
        [session.settlementData],
    );

    // 행 식별 key — player_id 우선, 없으면 이름+인덱스.
    const rowKey = React.useCallback(
        (r: KdkPenaltyPreviewRow, idx: number) => `${r.playerId ?? 'noid'}__${r.playerName}__${idx}`,
        [],
    );

    const load = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const [members, existing] = await Promise.all([
                fetchAllMembers(),
                fetchExistingKdkPenalties(session.id),
            ]);
            const preview = buildKdkPenaltyPreview(settlementData, members as FinanceMember[], existing);
            setRows(preview);
            // 기본 선택: 등록 가능 행만.
            const next = new Set<string>();
            preview.forEach((r, idx) => {
                if (r.status === 'registerable') next.add(rowKey(r, idx));
            });
            setSelected(next);
        } catch (e: any) {
            setError(e?.message || '미리보기를 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    }, [session.id, settlementData, rowKey]);

    React.useEffect(() => { load(); }, [load]);

    const totalTargets = rows.length;
    const totalPenalty = rows.reduce((sum, r) => sum + r.amount, 0);
    const registerableRows = rows.filter((r) => r.status === 'registerable');
    const needsLinkCount = rows.filter((r) => r.status === 'needs_link').length;
    const registeredCount = rows.filter((r) => r.status === 'registered').length;

    const selectedRows = rows.filter((r, idx) => r.status === 'registerable' && selected.has(rowKey(r, idx)));
    const selectedAmount = selectedRows.reduce((sum, r) => sum + r.amount, 0);

    const toggle = (key: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const toggleAll = () => {
        const allKeys = rows
            .map((r, idx) => ({ r, key: rowKey(r, idx) }))
            .filter(({ r }) => r.status === 'registerable')
            .map(({ key }) => key);
        const allSelected = allKeys.every((k) => selected.has(k));
        setSelected(allSelected ? new Set() : new Set(allKeys));
    };

    const handleRegister = async () => {
        if (selectedRows.length === 0) return;
        const ok = window.confirm(`선택한 ${selectedRows.length}명의 벌금 ${formatWon(selectedAmount)}을 Finance에 등록하시겠습니까?`);
        if (!ok) return;
        setBusy(true);
        setError(null);
        try {
            const res = await registerKdkPenalties({
                sessionId: session.id,
                sessionDate: session.date,
                rows: selectedRows,
                createdBy,
            });
            setResult(res);
            if (res.newlyRegistered > 0) onRegistered?.();
            await load(); // 등록 상태 갱신(등록된 행은 '등록 완료'로 전환).
        } catch (e: any) {
            setError(e?.message || '등록 중 오류가 발생했습니다.');
        } finally {
            setBusy(false);
        }
    };

    const canRegister = session.is_official === true && session.is_test !== true;

    return (
        <div
            role="dialog"
            aria-modal="true"
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(15,23,42,0.55)',
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                padding: 0,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 480, maxHeight: '92dvh',
                    background: '#F4F7FB', borderTopLeftRadius: 22, borderTopRightRadius: 22,
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    boxShadow: '0 -10px 40px rgba(15,45,85,0.25)',
                }}
            >
                {/* HEADER */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '16px 16px 12px', background: '#FFFFFF', borderBottom: '1px solid #E3ECF6',
                }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 10.5, fontWeight: 900, letterSpacing: '0.18em', color: '#0E7C76' }}>
                            TEYEON · FINANCE
                        </p>
                        <h3 style={{ margin: '3px 0 0', fontSize: 16, fontWeight: 900, color: NAVY, wordBreak: 'keep-all' }}>
                            KDK 벌금 등록
                        </h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="닫기"
                        style={{
                            width: 32, height: 32, borderRadius: 10, border: '1px solid #DCE8F5',
                            background: '#FFFFFF', color: '#56729A', cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* SESSION SUMMARY */}
                    <section style={CARD}>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: NAVY, wordBreak: 'keep-all' }}>
                            {session.title || 'KDK 세션'}
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                            <Chip>{session.date || '날짜 미상'}</Chip>
                            {session.venue ? <Chip>{session.venue}</Chip> : null}
                            <Chip tone={canRegister ? 'teal' : 'amber'}>
                                {session.is_official ? (session.is_test ? '테스트' : '공식 기록') : '미확정'}
                            </Chip>
                            {typeof session.participantCount === 'number' && (
                                <Chip>참가 {session.participantCount}명</Chip>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                            <Stat label="벌금 대상" value={`${totalTargets}명`} />
                            <Stat label="총 벌금" value={formatWon(totalPenalty)} />
                            {registeredCount > 0 && <Stat label="등록 완료" value={`${registeredCount}명`} />}
                        </div>
                    </section>

                    {!canRegister && (
                        <p style={WARN_BOX}>공식 기록으로 확정된 KDK만 Finance에 반영할 수 있습니다.</p>
                    )}

                    {loading && <p style={{ textAlign: 'center', fontSize: 12, color: '#94A3B8' }}>불러오는 중...</p>}

                    {!loading && error && <p style={{ ...WARN_BOX, background: '#FEF2F2', borderColor: '#FCA5A5', color: '#B91C1C' }}>{error}</p>}

                    {!loading && !error && settlementData.length === 0 && (
                        <p style={WARN_BOX}>이 기록에는 정산 스냅샷이 없어 벌금을 불러올 수 없습니다.</p>
                    )}

                    {!loading && !error && settlementData.length > 0 && totalTargets === 0 && (
                        <p style={WARN_BOX}>이 세션에는 벌금 대상이 없습니다.</p>
                    )}

                    {/* COMPLETION SUMMARY */}
                    {result && (
                        <section style={{ ...CARD, background: '#E0F5EB', border: '1px solid #B6E2CB' }}>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#16A085' }}>KDK 벌금 등록 완료</p>
                            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, fontWeight: 700, color: '#27613F' }}>
                                <span>신규 등록 {result.newlyRegistered}건</span>
                                <span>기존 등록 {result.alreadyRegistered}건</span>
                                <span>회원 연결 필요 {result.skippedNeedsLink}건</span>
                                <span>총 등록 금액 {formatWon(result.totalAmount)}</span>
                            </div>
                        </section>
                    )}

                    {/* MEMBER LIST */}
                    {!loading && !error && totalTargets > 0 && (
                        <section style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '10px 14px', borderBottom: '1px solid #E3ECF6',
                            }}>
                                <span style={{ fontSize: 12, fontWeight: 900, color: NAVY }}>벌금 대상 ({totalTargets})</span>
                                {registerableRows.length > 0 && (
                                    <button type="button" onClick={toggleAll} style={LINK_BTN}>
                                        전체 선택/해제
                                    </button>
                                )}
                            </div>
                            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                {rows.map((r, idx) => {
                                    const key = rowKey(r, idx);
                                    const checked = selected.has(key);
                                    const selectable = r.status === 'registerable';
                                    return (
                                        <li
                                            key={key}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 10,
                                                padding: '11px 14px', borderTop: idx === 0 ? 'none' : '1px solid #EEF3F9',
                                                opacity: selectable ? 1 : 0.92,
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                disabled={!selectable || busy}
                                                onChange={() => toggle(key)}
                                                style={{ width: 17, height: 17, flexShrink: 0, accentColor: '#0F9F98', cursor: selectable ? 'pointer' : 'not-allowed' }}
                                            />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {r.memberNickname || r.playerName}
                                                    {r.isGuest && <span style={GUEST_TAG}>G</span>}
                                                </p>
                                                <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 700, color: '#8597AD' }}>
                                                    {linkLabel(r)}
                                                </p>
                                            </div>
                                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: NAVY, whiteSpace: 'nowrap' }}>
                                                    {formatWon(r.amount)}
                                                </p>
                                                <StatusPill status={r.status} />
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    )}
                    {needsLinkCount > 0 && !loading && (
                        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#8597AD', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                            회원 연결이 안 된 {needsLinkCount}명은 외부 게스트이거나 이름이 일치하지 않아 자동 등록되지 않습니다. 회원 상세에서 수동으로 등록해 주세요.
                        </p>
                    )}
                </div>

                {/* FOOTER */}
                <div style={{ padding: 14, background: '#FFFFFF', borderTop: '1px solid #E3ECF6' }}>
                    <button
                        type="button"
                        onClick={handleRegister}
                        disabled={!canRegister || busy || loading || selectedRows.length === 0}
                        style={{
                            width: '100%', height: 46, borderRadius: 12, border: 'none',
                            fontSize: 13.5, fontWeight: 900, cursor: (!canRegister || busy || selectedRows.length === 0) ? 'not-allowed' : 'pointer',
                            background: (!canRegister || busy || selectedRows.length === 0) ? '#CBD5E1' : 'linear-gradient(90deg, #0F9F98 0%, #16A085 100%)',
                            color: '#FFFFFF',
                        }}
                    >
                        {busy
                            ? '등록 중...'
                            : selectedRows.length > 0
                                ? `선택한 벌금 Finance에 등록 (${selectedRows.length}명 · ${formatWon(selectedAmount)})`
                                : '선택한 벌금 Finance에 등록'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function linkLabel(r: KdkPenaltyPreviewRow): string {
    if (r.status === 'registered') return '이미 등록됨';
    if (r.status === 'needs_link') return '회원 연결 필요';
    if (r.matchType === 'name') return '이름 일치 · 확인 필요';
    return '회원 연결됨';
}

function StatusPill({ status }: { status: KdkPenaltyPreviewRow['status'] }) {
    const map = {
        registerable: { label: '등록 가능', bg: 'rgba(15,159,152,0.12)', color: '#0E7C76' },
        registered: { label: '등록 완료', bg: '#EEF2F7', color: '#64748B' },
        needs_link: { label: '회원 연결 필요', bg: 'rgba(245,158,11,0.14)', color: '#B7791F' },
    }[status];
    return (
        <span style={{
            display: 'inline-block', marginTop: 3, padding: '2px 7px', borderRadius: 999,
            fontSize: 9.5, fontWeight: 900, background: map.bg, color: map.color, whiteSpace: 'nowrap',
        }}>
            {map.label}
        </span>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ flex: 1, background: '#F4F7FB', borderRadius: 12, padding: '8px 10px', border: '1px solid #E3ECF6' }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 800, color: '#8597AD' }}>{label}</p>
            <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 900, color: NAVY, whiteSpace: 'nowrap' }}>{value}</p>
        </div>
    );
}

function Chip({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'blue' | 'teal' | 'amber' }) {
    const palette = {
        blue: { bg: '#EEF5FB', border: '#DCE8F5', color: '#1F5FB5' },
        teal: { bg: '#E0F5EB', border: '#B6E2CB', color: '#16A085' },
        amber: { bg: '#FFF4DE', border: '#F4C979', color: '#B7791F' },
    }[tone];
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 999,
            background: palette.bg, border: `1px solid ${palette.border}`, color: palette.color,
            fontSize: 11, fontWeight: 800,
        }}>
            {children}
        </span>
    );
}

const CARD: React.CSSProperties = {
    background: '#FFFFFF', borderRadius: 16, border: '1px solid #E3ECF6', padding: 14,
};

const WARN_BOX: React.CSSProperties = {
    margin: 0, padding: '12px 14px', borderRadius: 12,
    background: '#FFF4DE', border: '1px solid #F4C979', color: '#B7791F',
    fontSize: 12, fontWeight: 800, lineHeight: 1.6, wordBreak: 'keep-all',
};

const LINK_BTN: React.CSSProperties = {
    background: 'none', border: 'none', color: '#0E7C76', fontSize: 11, fontWeight: 900, cursor: 'pointer', padding: 0,
};

const GUEST_TAG: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 13, height: 13, borderRadius: '50%', marginLeft: 5,
    background: '#FFF4DE', border: '1px solid #F4C979', color: '#B7791F',
    fontSize: 8, fontWeight: 900, lineHeight: 1, verticalAlign: 'middle',
};
