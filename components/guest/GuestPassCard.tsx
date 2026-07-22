'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
    CalendarDays,
    Clock,
    MapPin,
    LayoutGrid,
    CheckCircle2,
    Copy,
    Check,
    Info,
    Trophy,
    ShieldCheck,
    Timer,
    Wallet,
    RefreshCw,
    ListOrdered,
    Lock,
    HelpCircle,
    ChevronRight,
} from 'lucide-react';
import type {
    GuestPassData,
    GuestNoteEntry,
    CourtMode,
    GuestPassParticipation,
} from '@/lib/guestPassData';

// ─── 포맷 헬퍼 ─────────────────────────────────────────────────────────────

const formatDateKo = (date: string): string => {
    const [y, m, d] = date.split('-').map(Number);
    if (!y) return date;
    const dt = new Date(y, (m || 1) - 1, d || 1);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${y}년 ${m}월 ${d}일 (${days[dt.getDay()]})`;
};

const formatTimeAmPm = (t?: string): string => {
    if (!t) return '';
    const [hStr, mStr] = t.slice(0, 5).split(':');
    const h = Number(hStr); const mi = Number(mStr);
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 || 12;
    return `${ampm} ${String(h12).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
};

const formatTimeRange = (start?: string, end?: string): string => {
    if (!start && !end) return '';
    if (start && end) {
        const s = formatTimeAmPm(start);
        const e = formatTimeAmPm(end);
        // 같은 AM/PM이면 두 번째 prefix 생략
        const sPrefix = s.slice(0, 2);
        const ePrefix = e.slice(0, 2);
        if (sPrefix === ePrefix) return `${s} ~ ${e.slice(3)}`;
        return `${s} ~ ${e}`;
    }
    if (start) return `${formatTimeAmPm(start)} 시작`;
    return `~ ${formatTimeAmPm(end)}`;
};

const formatCourt = (mode: CourtMode, count?: number): string => {
    if (mode === 'fixed') return count && count > 0 ? `코트 ${count}면` : '코트 1면';
    if (mode === 'first_come') return '선착순 코트';
    if (mode === 'na') return '코트 N/A';
    return '코트 미정';
};

const participationLabel = (p: GuestPassParticipation): { text: string; tone: 'confirmed' | 'pending' | 'cancelled' } => {
    if (p === 'confirmed') return { text: '참여 확정', tone: 'confirmed' };
    if (p === 'cancelled') return { text: '정모 취소', tone: 'cancelled' };
    return { text: '운영진 확정 대기', tone: 'pending' };
};

const noteIcon = (icon?: GuestNoteEntry['icon']) => {
    const common = { size: 13, strokeWidth: 1.9 } as const;
    if (icon === 'rules')  return <ShieldCheck {...common} />;
    if (icon === 'trophy') return <Trophy {...common} />;
    if (icon === 'time')   return <Timer {...common} />;
    return <Info {...common} />;
};

// ─── 공통 카드 ────────────────────────────────────────────────────────────

const SectionCard = ({
    children,
    style,
}: {
    children: React.ReactNode;
    style?: React.CSSProperties;
}) => (
    <section
        style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 16,
            border: '1px solid rgba(0,0,0,0.06)',
            boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
            paddingTop: 16,
            paddingRight: 16,
            paddingBottom: 16,
            paddingLeft: 16,
            ...style,
        }}
    >
        {children}
    </section>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 4, height: 14, background: 'linear-gradient(180deg, #0E7E76, #1EA89B)', borderRadius: 2 }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em' }}>
            {children}
        </h3>
    </div>
);

const InfoRow = ({
    icon,
    label,
    value,
    multiline,
}: {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
    multiline?: boolean;   // 긴 장소명 등 — 2줄 wrap 허용
}) => (
    <div
        style={{
            display: 'flex',
            alignItems: multiline ? 'flex-start' : 'center',
            gap: 10,
            paddingTop: 8,
            paddingBottom: 8,
            borderBottom: '1px dashed rgba(15,23,42,0.06)',
        }}
    >
        <span
            style={{
                width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                backgroundColor: 'rgba(15,159,152,0.10)', color: '#0F9F98',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                marginTop: multiline ? 1 : 0,
            }}
        >
            {icon}
        </span>
        <span style={{
            fontSize: 11, fontWeight: 700, color: '#94A3B8', minWidth: 48,
            marginTop: multiline ? 5 : 0,
        }}>
            {label}
        </span>
        <span
            style={{
                flex: 1,
                fontSize: 13, fontWeight: 700, color: '#0F172A',
                letterSpacing: '-0.01em',
                wordBreak: 'keep-all',
                overflowWrap: 'break-word',
                lineHeight: multiline ? 1.5 : 1.3,
            }}
        >
            {value}
        </span>
    </div>
);

// ─── 본문 ──────────────────────────────────────────────────────────────────

interface GuestPassCardProps {
    data: GuestPassData;
    /** preview 화면에서 안내문 위에 표시할 작은 dev-only badge. 운영 라우트에서는 미사용. */
    previewBadge?: React.ReactNode;
    /** 본문 하단에 추가할 공개 CTA (예: "TEYEON 클럽 둘러보기", "공식 인스타그램"). */
    footerCta?: React.ReactNode;
}

export default function GuestPassCard({ data, previewBadge, footerCta }: GuestPassCardProps) {
    const [copied, setCopied] = React.useState(false);
    const participation = participationLabel(data.schedule.participation);

    const handleCopyAccount = async () => {
        const text = data.fee.bank.accountNumber;
        try {
            if (navigator.clipboard && window.isSecureContext !== false) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } catch {
            /* noop */
        }
    };

    return (
        <main
            style={{
                width: '100%',
                minHeight: '100dvh',
                backgroundColor: '#F2F4F7',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: 'env(safe-area-inset-top)',
                paddingBottom: 'calc(40px + env(safe-area-inset-bottom))',
            }}
        >
            <div
                style={{
                    width: '100%',
                    maxWidth: 430,
                    paddingTop: 16,
                    paddingLeft: 16,
                    paddingRight: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    boxSizing: 'border-box',
                }}
            >
                {previewBadge}

                {/* ── Hero — dark teal ─────────────────────────────────────── */}
                <section
                    style={{
                        position: 'relative',
                        borderRadius: 18,
                        overflow: 'hidden',
                        background: 'linear-gradient(135deg, #0E5A55 0%, #117268 55%, #1B8A7F 100%)',
                        boxShadow: '0 6px 20px rgba(14, 90, 85, 0.25)',
                        paddingTop: 22,
                        paddingRight: 20,
                        paddingBottom: 22,
                        paddingLeft: 20,
                        color: '#FFFFFF',
                    }}
                >
                    {/* 옅은 코트 라인 motif */}
                    <svg
                        aria-hidden
                        viewBox="0 0 120 120"
                        style={{
                            position: 'absolute',
                            right: -28, top: -28,
                            width: 180, height: 180,
                            opacity: 0.06,
                            pointerEvents: 'none',
                        }}
                    >
                        <circle cx="60" cy="60" r="44" fill="#FFFFFF" />
                        <path d="M 22 50 Q 60 24 98 50" fill="none" stroke="#FFFFFF" strokeWidth="2" />
                        <path d="M 22 70 Q 60 96 98 70" fill="none" stroke="#FFFFFF" strokeWidth="2" />
                    </svg>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                        <div
                            style={{
                                width: 56, height: 56, borderRadius: 14, flexShrink: 0,
                                backgroundColor: 'rgba(255,255,255,0.10)',
                                border: '1px solid rgba(255,255,255,0.18)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                        >
                            <Image
                                src="/logos/teyeon-logo-current.png"
                                alt="TEYEON"
                                width={44}
                                height={44}
                                priority
                                style={{ objectFit: 'contain' }}
                            />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <p style={{
                                margin: 0, fontFamily: 'var(--font-rajdhani), sans-serif',
                                fontSize: 9.5, fontWeight: 800, letterSpacing: '0.26em',
                                textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)',
                            }}>
                                TEYEON GUEST PASS
                            </p>
                            <p style={{
                                margin: '4px 0 0', fontSize: 13.5, fontWeight: 700, color: '#FFFFFF',
                                letterSpacing: '-0.01em', lineHeight: 1.25,
                            }}>
                                테니스로 이어진 인연.
                            </p>
                        </div>
                    </div>

                    <h1 style={{
                        margin: 0, fontSize: 22, fontWeight: 900,
                        letterSpacing: '-0.02em', lineHeight: 1.25,
                        color: '#FFFFFF',
                        wordBreak: 'keep-all',
                    }}>
                        TEYEON 정모에 초대합니다
                    </h1>
                    <p style={{
                        margin: '6px 0 0',
                        fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.78)',
                        lineHeight: 1.5,
                    }}>
                        {data.schedule.title}
                    </p>
                </section>

                {/* ── 일정 정보 ─────────────────────────────────────────────── */}
                <SectionCard>
                    <SectionTitle>일정 정보</SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <InfoRow
                            icon={<CalendarDays size={13} strokeWidth={1.9} />}
                            label="날짜"
                            value={formatDateKo(data.schedule.date)}
                        />
                        {(data.schedule.startTime || data.schedule.endTime) && (
                            <InfoRow
                                icon={<Clock size={13} strokeWidth={1.9} />}
                                label="시간"
                                value={formatTimeRange(data.schedule.startTime, data.schedule.endTime)}
                            />
                        )}
                        <InfoRow
                            icon={<MapPin size={13} strokeWidth={1.9} />}
                            label="장소"
                            value={data.schedule.location}
                            multiline
                        />
                        <InfoRow
                            icon={<LayoutGrid size={13} strokeWidth={1.9} />}
                            label="코트"
                            value={formatCourt(data.schedule.courtMode, data.schedule.courtCount)}
                        />
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            paddingTop: 12, marginTop: 4,
                            borderTop: '1px solid rgba(15,23,42,0.06)',
                        }}>
                            <span
                                style={{
                                    width: 8, height: 8, borderRadius: '50%',
                                    backgroundColor:
                                        participation.tone === 'confirmed' ? '#16A085' :
                                        participation.tone === 'cancelled' ? '#C0392B' : '#B7791F',
                                    animation: participation.tone === 'confirmed' ? 'gpi-status-pulse 1.6s ease-in-out 1' : undefined,
                                }}
                            />
                            <span style={{
                                fontSize: 12.5, fontWeight: 800,
                                color:
                                    participation.tone === 'confirmed' ? '#0F766E' :
                                    participation.tone === 'cancelled' ? '#991B1B' : '#92400E',
                            }}>
                                {participation.text}
                            </span>
                        </div>
                    </div>
                    {/* 참여 상태 점 1회 pulse — 인트로 끝난 후 단발 */}
                    <style>{`
                        @keyframes gpi-status-pulse {
                            0%   { box-shadow: 0 0 0 0 rgba(22, 160, 133, 0.40); }
                            60%  { box-shadow: 0 0 0 9px rgba(22, 160, 133, 0); }
                            100% { box-shadow: 0 0 0 0 rgba(22, 160, 133, 0); }
                        }
                    `}</style>
                </SectionCard>

                {/* ── 이 페이지에서 확인하세요 — 경기 전(대진표) / 경기 후(순위·정산) 안내 ──
                    실제 콘텐츠는 하단 'KDK 경기 안내' 영역에 표시됨을 명시(위치 모호 표현 제거).
                    우측 버튼은 실제로 해당 영역으로 스크롤 이동. */}
                <section
                    style={{
                        position: 'relative',
                        borderRadius: 16,
                        border: '1px solid rgba(15,159,152,0.30)',
                        background: 'linear-gradient(180deg, #F1FBF9 0%, #FFFFFF 62%)',
                        boxShadow: '0 2px 12px rgba(15,159,152,0.10)',
                        padding: 16,
                        overflow: 'hidden',
                    }}
                >
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #0E7E76, #1EA89B 55%, #1F5FB5)' }} />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2, marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <span style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,159,152,0.12)' }}>
                                <Info size={15} strokeWidth={2.4} style={{ color: '#0E8079' }} />
                            </span>
                            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em', wordBreak: 'keep-all' }}>이 페이지에서 확인하세요</h3>
                        </div>
                        <button
                            type="button"
                            onClick={() => document.getElementById('gp-kdk-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 10px', borderRadius: 999, background: 'rgba(31,95,181,0.10)', border: '1px solid rgba(31,95,181,0.22)', color: '#1F5FB5', fontSize: 10.5, fontWeight: 800, whiteSpace: 'nowrap', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                        >
                            <RefreshCw size={11} strokeWidth={2.6} /> 경기 안내로 이동
                        </button>
                    </div>

                    {/* 경기 전 — 대진표 확인 */}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 12px', borderRadius: 12, background: '#FFFFFF', border: '1px solid rgba(15,159,152,0.18)' }}>
                        <span style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,159,152,0.12)' }}>
                            <CalendarDays size={15} strokeWidth={2.2} style={{ color: '#0E8079' }} />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: '#0F172A', wordBreak: 'keep-all' }}>경기 전 — 대진표 확인</p>
                            <p style={{ margin: '3px 0 0', fontSize: 11.5, fontWeight: 600, color: '#475569', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                                운영진이 대진을 확정하면 <b style={{ color: '#0E8079' }}>아래 ‘KDK 경기 안내’ 영역</b>에 대진표가 표시됩니다. 경기 시작 전 이 링크를 다시 열어 확인해주세요.
                            </p>
                        </div>
                    </div>

                    {/* 경기 후 — 순위와 정산 확인 */}
                    <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 12px', borderRadius: 12, background: '#FFFFFF', border: '1px solid rgba(31,95,181,0.18)' }}>
                        <span style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(31,95,181,0.10)' }}>
                            <Trophy size={15} strokeWidth={2.2} style={{ color: '#1F5FB5' }} />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: '#0F172A', wordBreak: 'keep-all' }}>경기 후 — 순위와 정산 확인</p>
                            <p style={{ margin: '3px 0 0', fontSize: 11.5, fontWeight: 600, color: '#475569', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                                경기 종료 후 결과가 확정되면 <b style={{ color: '#1F5FB5' }}>같은 영역</b>에서 최종 순위와 게스트비·벌금 정산 내용을 확인할 수 있습니다.
                            </p>
                        </div>
                    </div>

                    <p style={{ margin: '12px 4px 0', fontSize: 11, fontWeight: 800, color: '#0E8079', lineHeight: 1.55, textAlign: 'center', wordBreak: 'keep-all' }}>
                        이 링크 하나로 <b>경기 전에는 대진표</b>, <b>경기 후에는 최종 순위와 정산 내용</b>을 확인할 수 있습니다.
                    </p>
                </section>

                {/* ── Guest Pass 도움말 — 게스트 핸드북(비로그인 공개) 가이드로 이동하는 보조 CTA.
                    핵심 정보(일정/게스트비)보다 위계를 낮게: 점선 테두리의 작은 help card. */}
                <Link
                    href="/handbook/invited-guest/guest-pass"
                    style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '12px 14px', borderRadius: 14,
                        backgroundColor: '#FFFFFF',
                        border: '1px dashed rgba(15,159,152,0.35)',
                        textDecoration: 'none',
                        WebkitTapHighlightColor: 'transparent',
                    }}
                >
                    <span style={{
                        width: 26, height: 26, borderRadius: 8, flexShrink: 0, marginTop: 1,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        backgroundColor: 'rgba(15,159,152,0.10)', color: '#0E8079',
                    }}>
                        <HelpCircle size={14} strokeWidth={2.2} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em', wordBreak: 'keep-all' }}>
                            Guest Pass가 처음인가요?
                        </span>
                        <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, fontWeight: 600, color: '#64748B', lineHeight: 1.55, wordBreak: 'keep-all' }}>
                            일정, 준비물, 경기 안내를 보는 방법을 짧게 확인할 수 있습니다.
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 7, fontSize: 11.5, fontWeight: 800, color: '#0E8079' }}>
                            Guest Pass 가이드 보기 <ChevronRight size={12} strokeWidth={2.6} />
                        </span>
                    </span>
                </Link>

                {/* ── 이번 정모 추가 공지 (운영진이 입력한 경우만) ─────────── */}
                {data.extraNotice && (
                    <SectionCard style={{ backgroundColor: '#FFFBEB', borderColor: 'rgba(245,158,11,0.30)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <Info size={14} strokeWidth={2} style={{ color: '#B45309', flexShrink: 0, marginTop: 2 }} />
                            <p style={{
                                margin: 0, fontSize: 12.5, fontWeight: 700, color: '#92400E',
                                lineHeight: 1.55, wordBreak: 'keep-all',
                            }}>
                                {data.extraNotice}
                            </p>
                        </div>
                    </SectionCard>
                )}

                {/* ── 순위 결정 안내 — TEYEON KDK 공식 기준(승수 → 득실 → 연소자 우위) ──
                    문구는 공식 comparator 규칙과 반드시 일치해야 함(임의 기준 생성 금지).
                    생년 정보: 출생연도만 · 순위 확인 목적 한정 · 공개 화면 비노출 · 미제공 시 동률 후순위 가능. */}
                <SectionCard>
                    <SectionTitle>순위 결정 안내</SectionTitle>
                    <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#334155', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                        최종 순위는 TEYEON KDK 공식 기준을 아래 순서대로 적용해 결정합니다.
                    </p>
                    <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {[
                            ['1', '승수', '많이 이긴 순서'],
                            ['2', '득실', '득점에서 실점을 뺀 값이 큰 순서'],
                            ['3', '동률 시 연소자 우위', '위 기준이 모두 같으면 나이가 어린 참가자가 우선'],
                        ].map(([n, title, desc]) => (
                            <li key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                                <span style={{
                                    width: 22, height: 22, borderRadius: 7, flexShrink: 0, marginTop: 1,
                                    backgroundColor: 'rgba(15,159,152,0.10)', color: '#0E8079',
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 11.5, fontWeight: 900,
                                }}>
                                    {n}
                                </span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: '#334155', lineHeight: 1.55, wordBreak: 'keep-all' }}>
                                    <b style={{ color: '#0F172A' }}>{title}</b> — {desc}
                                </span>
                            </li>
                        ))}
                    </ol>
                    <div style={{
                        marginTop: 12, padding: '9px 11px', borderRadius: 10,
                        background: 'rgba(15,159,152,0.07)', border: '1px solid rgba(15,159,152,0.20)',
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                    }}>
                        <ListOrdered size={13} strokeWidth={2.2} style={{ color: '#0E8079', flexShrink: 0, marginTop: 2 }} />
                        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 800, color: '#0E7C76', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                            동률 시 연소자 우위가 적용됩니다.
                        </p>
                    </div>

                    {/* 생년 정보 · 개인정보 안내 */}
                    <div style={{
                        marginTop: 10, paddingTop: 12,
                        borderTop: '1px solid rgba(15,23,42,0.06)',
                        display: 'flex', flexDirection: 'column', gap: 8,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                height: 22, padding: '0 9px', borderRadius: 999,
                                background: 'rgba(100,116,139,0.10)', border: '1px solid rgba(100,116,139,0.22)',
                                color: '#475569', fontSize: 10.5, fontWeight: 800, whiteSpace: 'nowrap',
                            }}>
                                <Lock size={11} strokeWidth={2.4} /> 순위 확인용 · 외부 비공개
                            </span>
                        </div>
                        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: '#475569', lineHeight: 1.65, wordBreak: 'keep-all' }}>
                            동률 순위 확인을 위해 게스트의 <b style={{ color: '#0F172A' }}>출생연도</b> 정보를 요청드릴 수 있습니다.
                            입력한 정보는 <b style={{ color: '#0F172A' }}>동률 시 순위 확인 목적으로만 사용</b>하며,
                            Guest Pass·대진표·전광판·결과표 등 공개 화면에는 표시하지 않고 다른 목적으로 사용하지 않습니다.
                        </p>
                        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: '#64748B', lineHeight: 1.65, wordBreak: 'keep-all' }}>
                            출생연도를 제공하지 않아도 경기 참여는 가능하지만, 완전 동률 상황에서는 후순위로 반영될 수 있습니다.
                        </p>
                    </div>
                </SectionCard>

                {/* ── 게스트비 + 계좌 ───────────────────────────────────────── */}
                <SectionCard>
                    <SectionTitle>게스트비 안내</SectionTitle>
                    {(() => {
                        // 게스트비는 KDK 세션 단일 출처. confirmed(0 포함)만 실제 금액, 그 외에는 안내 문구.
                        const status = data.fee.guestFeeStatus ?? 'unlinked';
                        const fee = data.fee.guestFee;
                        if (status === 'confirmed' && typeof fee === 'number') {
                            return (
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
                                    <Wallet size={15} strokeWidth={1.9} style={{ color: '#0F9F98', alignSelf: 'center' }} />
                                    {fee === 0 ? (
                                        <span style={{ fontSize: 22, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>무료</span>
                                    ) : (
                                        <>
                                            <span style={{ fontSize: 22, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>
                                                {fee.toLocaleString()}
                                            </span>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: '#64748B' }}>원</span>
                                        </>
                                    )}
                                </div>
                            );
                        }
                        const guideText =
                            status === 'unset' ? '게스트비 · 미설정'
                                : status === 'conflict' ? '게스트비 · 연결 확인 필요'
                                    : '게스트비 · 추후 안내';
                        return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                                <Wallet size={15} strokeWidth={1.9} style={{ color: '#0F9F98', alignSelf: 'center' }} />
                                <span style={{ fontSize: 15, fontWeight: 800, color: '#64748B', letterSpacing: '-0.01em' }}>
                                    {guideText}
                                </span>
                            </div>
                        );
                    })()}
                    {/* 정산 흐름 안내 — 게스트비/벌금 혼동 방지. 경기 전 선납 인상·벌금 상시 인상 금지. */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '0 0 12px', padding: '9px 11px', borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.22)' }}>
                        <Timer size={13} strokeWidth={2.2} style={{ color: '#B45309', flexShrink: 0, marginTop: 1 }} />
                        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#92400E', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                            게스트비는 <b>정모가 끝난 뒤 정산</b>됩니다. 벌금이 발생한 경우 최종 순위와 함께 이 화면에서 안내돼요.
                        </p>
                    </div>
                    {data.fee.note && (
                        <p style={{ margin: '0 0 12px', fontSize: 11.5, fontWeight: 600, color: '#475569', lineHeight: 1.5 }}>
                            {data.fee.note}
                        </p>
                    )}
                    {/* 계좌 영역 — 운영진이 비공개로 설정한 경우 숨김 (showBankAccount === false). 기본은 공개. */}
                    {data.showBankAccount !== false && (
                        <div
                            style={{
                                borderRadius: 12,
                                backgroundColor: '#F8FAFC',
                                border: '1px solid rgba(15,23,42,0.06)',
                                paddingTop: 12,
                                paddingRight: 14,
                                paddingBottom: 12,
                                paddingLeft: 14,
                            }}
                        >
                            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.02em' }}>
                                {data.fee.bank.bankName} · 예금주 {data.fee.bank.accountHolder}
                            </p>
                            <div style={{
                                marginTop: 8, display: 'flex', alignItems: 'center', gap: 8,
                                flexWrap: 'wrap',
                            }}>
                                <span style={{
                                    fontFamily: 'var(--font-rajdhani), monospace',
                                    fontSize: 16, fontWeight: 900, color: '#0F172A',
                                    letterSpacing: '0.04em',
                                    wordBreak: 'break-all',
                                    flex: 1, minWidth: 0,
                                }}>
                                    {data.fee.bank.accountNumber}
                                </span>
                                <button
                                    type="button"
                                    onClick={handleCopyAccount}
                                    style={{
                                        flexShrink: 0,
                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                        height: 32, paddingLeft: 10, paddingRight: 10,
                                        borderRadius: 8,
                                        border: '1px solid rgba(15,159,152,0.28)',
                                        backgroundColor: copied ? 'rgba(16,185,129,0.10)' : 'rgba(15,159,152,0.08)',
                                        color: copied ? '#0E7C5C' : '#0E8079',
                                        fontSize: 11, fontWeight: 800,
                                        cursor: 'pointer',
                                        WebkitTapHighlightColor: 'transparent',
                                        transition: 'background-color 0.15s, color 0.15s',
                                    }}
                                >
                                    {copied ? <Check size={12} /> : <Copy size={12} />}
                                    {copied ? '복사됨' : '계좌 복사'}
                                </button>
                            </div>
                        </div>
                    )}
                </SectionCard>

                {/* ── 준비사항 ───────────────────────────────────────────────── */}
                <SectionCard>
                    <SectionTitle>준비사항</SectionTitle>
                    <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {data.preparation.items.map((it) => (
                            <li key={it} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: '#1E293B' }}>
                                <CheckCircle2 size={13} strokeWidth={2} style={{ color: '#0F9F98', flexShrink: 0 }} />
                                {it}
                            </li>
                        ))}
                    </ul>
                    <div style={{
                        marginTop: 12, paddingTop: 10,
                        borderTop: '1px solid rgba(15,23,42,0.06)',
                        display: 'flex', flexDirection: 'column', gap: 6,
                    }}>
                        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: '#475569', lineHeight: 1.55 }}>
                            경기 시작 <strong style={{ color: '#0F172A' }}>{data.preparation.arrivalGuideMinutes}분 전</strong> 도착을 권장합니다.
                        </p>
                        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: '#64748B', lineHeight: 1.55, wordBreak: 'keep-all' }}>
                            {data.preparation.lateOrAbsentNotice}
                        </p>
                    </div>
                </SectionCard>

                {/* ── TEYEON GUEST NOTE ─────────────────────────────────────── */}
                <SectionCard>
                    <SectionTitle>TEYEON GUEST NOTE</SectionTitle>
                    <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {data.guestNote.map((n, idx) => (
                            <li key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                                <span
                                    style={{
                                        width: 22, height: 22, borderRadius: 7, flexShrink: 0,
                                        backgroundColor: 'rgba(15,159,152,0.08)', color: '#0F9F98',
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                        marginTop: 1,
                                    }}
                                >
                                    {noteIcon(n.icon)}
                                </span>
                                <span style={{
                                    fontSize: 12, fontWeight: 600, color: '#334155',
                                    lineHeight: 1.55, wordBreak: 'keep-all',
                                }}>
                                    {n.text}
                                </span>
                            </li>
                        ))}
                    </ul>
                </SectionCard>

                {/* ── KDK 경기 안내 ──────────────────────────────────────────
                    1차 MVP: 정적 안내만. COMING SOON 라벨 제거 — 미완성 인상 회피.
                    향후: data.match.actions[] 가 채워지면 같은 영역이 버튼 모드로 전환되도록
                    구조만 예약 (KDK 자동 연동/공개 토글은 이번 구현 X). */}
                <SectionCard style={{ scrollMarginTop: 12 } as React.CSSProperties}>
                    <div id="gp-kdk-section" style={{ scrollMarginTop: 16 }} />
                    <SectionTitle>{data.match.title}</SectionTitle>
                    <div
                        style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                            paddingTop: 18, paddingBottom: 20,
                            paddingLeft: 16, paddingRight: 16,
                            borderRadius: 14,
                            backgroundColor: '#F8FAFC',
                            border: '1px solid rgba(15,159,152,0.18)',
                        }}
                    >
                        <p style={{
                            margin: 0,
                            fontSize: 14.5, fontWeight: 900, color: '#0F172A',
                            letterSpacing: '-0.01em', textAlign: 'center',
                        }}>
                            {data.match.headline}
                        </p>
                        <p style={{
                            margin: '8px 0 0', fontSize: 11.5, fontWeight: 600, color: '#475569',
                            lineHeight: 1.6, textAlign: 'center', wordBreak: 'keep-all',
                            maxWidth: 320,
                        }}>
                            {data.match.body}
                        </p>
                        {/* 재확인 강조 — 게스트가 경기 전/후 다시 열어보도록. 상태 로직 변경 없음(정적). */}
                        <div style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, background: 'rgba(31,95,181,0.08)', border: '1px solid rgba(31,95,181,0.20)' }}>
                            <RefreshCw size={12} strokeWidth={2.6} style={{ color: '#1F5FB5', flexShrink: 0 }} />
                            <span style={{ fontSize: 11, fontWeight: 800, color: '#1F5FB5', wordBreak: 'keep-all', lineHeight: 1.5, textAlign: 'center' }}>
                                경기 전 · 경기 후 이 링크를 다시 열면 대진표와 결과를 확인할 수 있어요
                            </span>
                        </div>
                        {/* 향후 확장 — actions[] 채워지면 자동 노출. 1차는 비어있어 렌더 X. */}
                        {data.match.actions && data.match.actions.length > 0 && (
                            <div style={{
                                marginTop: 14, display: 'flex', flexDirection: 'column',
                                gap: 8, width: '100%', maxWidth: 280,
                            }}>
                                {data.match.actions.map((a) => (
                                    <a
                                        key={a.label}
                                        href={a.href}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                            height: 38, borderRadius: 10,
                                            backgroundColor: '#0F9F98', color: '#FFFFFF',
                                            fontSize: 12.5, fontWeight: 800,
                                            textDecoration: 'none',
                                            WebkitTapHighlightColor: 'transparent',
                                        }}
                                    >
                                        {a.label}
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                </SectionCard>

                {/* ── TEYEON 클럽 소개 ──────────────────────────────────────── */}
                <SectionCard>
                    <SectionTitle>{data.club.name} 클럽 소개</SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {data.club.paragraphs.map((p, idx) => (
                            <p key={idx} style={{
                                margin: 0, fontSize: 12.5, fontWeight: 600, color: '#475569',
                                lineHeight: 1.65, wordBreak: 'keep-all',
                            }}>
                                {p}
                            </p>
                        ))}
                    </div>
                </SectionCard>

                {/* ── 공개 CTA ──────────────────────────────────────────────
                    Guest Pass는 비로그인 외부 랜딩이므로 로그인/회원 전용 페이지로
                    이동시키지 않는다. 호출자가 disabled placeholder 또는 외부 공개
                    링크만 전달. */}
                {footerCta}

                {/* ── 문의 안내 ─────────────────────────────────────────────── */}
                <p
                    style={{
                        margin: '4px 6px 0',
                        fontSize: 11.5, fontWeight: 600, color: '#94A3B8',
                        lineHeight: 1.6, textAlign: 'center',
                        wordBreak: 'keep-all',
                    }}
                >
                    {data.contactNotice}
                </p>

                {/* 하단 brand mark */}
                <p
                    style={{
                        margin: '12px 0 4px',
                        textAlign: 'center',
                        fontFamily: 'var(--font-rajdhani), sans-serif',
                        fontSize: 9, fontWeight: 800, letterSpacing: '0.32em',
                        textTransform: 'uppercase', color: '#CBD5E1',
                    }}
                >
                    TEYEON TENNIS CLUB
                </p>
            </div>
        </main>
    );
}
