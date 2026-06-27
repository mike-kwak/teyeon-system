'use client';

// TEYEON Admin Dashboard (1차 골격).
//   - 실제 데이터: 다음 정모(club_schedules) + 참석/게스트(club_schedule_attendance) + 최근 로그(app_logs, 안전 시).
//   - 연결 못한 항목은 가짜 숫자 없이 빈 상태로 표시.
//   - 접근 제어는 middleware(서버) + admin layout(클라이언트 2차) 가 담당.

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { fetchClubSchedules } from '@/lib/clubScheduleService';
import { fetchAttendancesWithMembers } from '@/lib/clubScheduleAttendanceService';
import { buildClubScheduleAttendanceGuideText } from '@/lib/clubScheduleShare';
import { copyTextSafe } from '@/lib/clubScheduleShare';
import {
    formatTimeRangeAmPm,
    formatCourtLabel,
    type ClubSchedule,
} from '@/lib/clubScheduleData';
import {
    CalendarDays, Users, UserPlus, ListChecks, ArrowRight, ExternalLink,
    Plus, Copy, Check, Swords, ClipboardList,
} from 'lucide-react';

interface NextMeetingData {
    schedule: ClubSchedule;
    attending: number;
    notAttending: number;
    guests: number;
}

const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function AdminDashboardPage() {
    const { role } = useAuth();
    const [loading, setLoading] = React.useState(true);
    const [next, setNext] = React.useState<NextMeetingData | null>(null);
    const [thisMonthCount, setThisMonthCount] = React.useState<number | null>(null);
    const [upcomingCount, setUpcomingCount] = React.useState<number | null>(null);
    const [logs, setLogs] = React.useState<{ action: string; path: string; created_at: string }[] | null>(null);
    const [logsBlocked, setLogsBlocked] = React.useState(false);
    const [copied, setCopied] = React.useState(false);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            // 1) 일정 — 다음 정모 + 이번 달/예정 수.
            try {
                const all = await fetchClubSchedules();
                if (!cancelled) {
                    const today = todayStr();
                    const ym = today.slice(0, 7);
                    const future = all
                        .filter((s) => s.schedule_date >= today)
                        .sort((a, b) => a.schedule_date.localeCompare(b.schedule_date) || (a.start_time || '').localeCompare(b.start_time || ''));
                    setUpcomingCount(future.length);
                    setThisMonthCount(all.filter((s) => s.schedule_date.slice(0, 7) === ym).length);
                    const n = future[0] || null;
                    if (n) {
                        let attending = 0, notAttending = 0, guests = 0;
                        try {
                            const rows = await fetchAttendancesWithMembers(n.id);
                            for (const r of rows) {
                                if (r.attendance_status === 'attending') attending++;
                                else if (r.attendance_status === 'not_attending') notAttending++;
                                if (r.is_guest) guests++;
                            }
                        } catch { /* 참석 데이터 실패 → 0 유지 */ }
                        if (!cancelled) setNext({ schedule: n, attending, notAttending, guests });
                    } else if (!cancelled) {
                        setNext(null);
                    }
                }
            } catch {
                if (!cancelled) { setUpcomingCount(null); setThisMonthCount(null); setNext(null); }
            }
            // 2) 최근 변경 내역 — app_logs (RLS/스키마 안전 시에만).
            try {
                const { data, error } = await supabase
                    .from('app_logs')
                    .select('action, path, created_at')
                    .order('created_at', { ascending: false })
                    .limit(6);
                if (cancelled) return;
                if (error) { setLogsBlocked(true); setLogs(null); }
                else setLogs((data || []) as { action: string; path: string; created_at: string }[]);
            } catch {
                if (!cancelled) { setLogsBlocked(true); setLogs(null); }
            }
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, []);

    const handleCopyGuide = async () => {
        if (!next) return;
        const text = buildClubScheduleAttendanceGuideText(next.schedule, { includeUrl: true });
        const ok = await copyTextSafe(text);
        if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
    };

    // 처리 필요 — 현재 안전하게 판단 가능한 항목만.
    const tasks: { label: string; meta: string; href: string }[] = [];
    if (next && next.guests > 0) {
        tasks.push({ label: '게스트 확인 필요', meta: `${next.schedule.title} · 게스트 ${next.guests}명`, href: `/club-schedule/${next.schedule.id}` });
    }

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            {/* A. 헤더 */}
            <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-rajdhani), sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.26em', color: '#2563EB' }}>
                        TEYEON ADMIN
                    </p>
                    <h1 style={{ margin: '3px 0 0', fontSize: 24, fontWeight: 900, color: '#0F1B33', letterSpacing: '-0.02em' }}>
                        운영 대시보드
                    </h1>
                    <p style={{ margin: '5px 0 0', fontSize: 12.5, fontWeight: 600, color: '#64748B' }}>
                        클럽 운영 현황을 한눈에 확인하고 관리합니다. {role && <span style={{ color: '#2563EB', fontWeight: 800 }}>· {role}</span>}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Link href="/club/schedule" style={primaryBtn}>
                        <Plus size={15} /> 새 정모 일정
                    </Link>
                    <Link href="/" style={ghostBtn}>
                        일반 앱으로 <ExternalLink size={13} />
                    </Link>
                </div>
            </header>

            {/* B. 요약 카드 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
                <SummaryCard
                    icon={<CalendarDays size={18} />} tone="blue" label="다음 정모"
                    value={loading ? '…' : next ? formatMonthDay(next.schedule.schedule_date) : '—'}
                    sub={loading ? '' : next ? next.schedule.title : '예정된 정모 없음'}
                />
                <SummaryCard
                    icon={<Users size={18} />} tone="teal" label="참석 확정"
                    value={loading ? '…' : next ? `${next.attending}명` : '—'}
                    sub={next ? '다음 정모 기준' : '데이터 연결 전'}
                />
                <SummaryCard
                    icon={<UserPlus size={18} />} tone="amber" label="게스트"
                    value={loading ? '…' : next ? `${next.guests}명` : '—'}
                    sub={next ? '다음 정모 기준' : '데이터 연결 전'}
                />
                <SummaryCard
                    icon={<ListChecks size={18} />} tone="red" label="처리 필요"
                    value={loading ? '…' : `${tasks.length}건`}
                    sub={tasks.length === 0 ? '확인할 항목 없음' : '아래 목록 확인'}
                />
            </div>

            {/* 2단: 다음 정모 / (처리 필요 + 최근 변경) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
                {/* C. 다음 정모 */}
                <Card>
                    <CardTitle icon={<CalendarDays size={16} />}>다음 정모</CardTitle>
                    {loading ? (
                        <Empty>불러오는 중...</Empty>
                    ) : !next ? (
                        <Empty>예정된 정모가 없습니다.</Empty>
                    ) : (
                        <div>
                            <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0F1B33', wordBreak: 'keep-all' }}>{next.schedule.title}</p>
                            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#475569' }}>
                                <InfoLine k="날짜" v={formatFullDate(next.schedule.schedule_date)} />
                                <InfoLine k="시간" v={formatTimeRangeAmPm(next.schedule.start_time, next.schedule.end_time) || '미정'} />
                                <InfoLine k="장소" v={next.schedule.location || '미정'} />
                                <InfoLine k="코트" v={formatCourtLabel(next.schedule.court_mode, next.schedule.court_count) || '미정'} />
                            </div>
                            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <Stat label="참석" value={next.attending} color="#0E7C76" />
                                <Stat label="불참" value={next.notAttending} color="#B91C1C" />
                                <Stat label="게스트" value={next.guests} color="#92400E" />
                            </div>
                            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <Link href={`/club-schedule/${next.schedule.id}`} style={miniAction}>참석 현황</Link>
                                <Link href="/club/schedule" style={miniAction}>정모 관리</Link>
                                <Link href="/kdk" style={miniAction}><Swords size={12} /> KDK 준비</Link>
                                <button type="button" onClick={handleCopyGuide} style={{ ...miniAction, cursor: 'pointer' }}>
                                    {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? '복사됨' : '안내문 복사'}
                                </button>
                            </div>
                        </div>
                    )}
                </Card>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* D. 처리 필요 */}
                    <Card id="tasks">
                        <CardTitle icon={<ListChecks size={16} />}>처리 필요</CardTitle>
                        {loading ? (
                            <Empty>불러오는 중...</Empty>
                        ) : tasks.length === 0 ? (
                            <Empty>지금 확인할 항목이 없습니다.</Empty>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {tasks.map((t, i) => (
                                    <Link key={i} href={t.href} style={taskRow}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#0F1B33' }}>{t.label}</p>
                                            <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.meta}</p>
                                        </div>
                                        <ArrowRight size={14} style={{ color: '#CBD5E1', flexShrink: 0 }} />
                                    </Link>
                                ))}
                            </div>
                        )}
                        <p style={{ margin: '10px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.5 }}>
                            KDK 확정 대기 · 미응답 집계는 다음 단계에서 연결 예정입니다.
                        </p>
                    </Card>

                    {/* E. 최근 변경 내역 */}
                    <Card>
                        <CardTitle icon={<ClipboardList size={16} />}>최근 변경 내역</CardTitle>
                        {loading ? (
                            <Empty>불러오는 중...</Empty>
                        ) : logsBlocked || logs === null ? (
                            <Empty>최근 활동 연결 예정 · 보안 정책(RLS) 확인 필요</Empty>
                        ) : logs.length === 0 ? (
                            <Empty>최근 활동이 없습니다.</Empty>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {logs.map((l, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: i === 0 ? 'none' : '1px dashed #EEF2F6' }}>
                                        <span style={{ fontSize: 10, fontWeight: 800, color: '#2563EB', backgroundColor: 'rgba(37,99,235,0.08)', padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{l.action || 'log'}</span>
                                        <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.path || '/'}</span>
                                        <span style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', whiteSpace: 'nowrap' }}>{formatTime(l.created_at)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                </div>
            </div>

            {/* F. 이번 달 운영 */}
            <Card style={{ marginTop: 12 }}>
                <CardTitle icon={<CalendarDays size={16} />}>이번 달 운영</CardTitle>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                    <MiniStat label="이번 달 정모" value={thisMonthCount === null ? '—' : `${thisMonthCount}회`} />
                    <MiniStat label="예정된 정모" value={upcomingCount === null ? '—' : `${upcomingCount}건`} />
                    <MiniStat label="KDK 세션" value="연결 예정" muted />
                    <MiniStat label="게스트 누적" value="연결 예정" muted />
                </div>
                <p style={{ margin: '10px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.5 }}>
                    KDK 세션·게스트 누적·공식 기록 확정은 데이터 구조 확인 후 다음 단계에서 `4/4 세션`처럼 기준과 함께 연결합니다.
                </p>
            </Card>
        </div>
    );
}

// ── 표시 helper ──────────────────────────────────────────────────────────────
function formatMonthDay(date: string) { const [, m, d] = date.split('-'); return `${Number(m)}/${Number(d)}`; }
function formatFullDate(date: string) {
    const [y, m, d] = date.split('-').map(Number);
    const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()];
    return `${y}년 ${m}월 ${d}일 (${wd})`;
}
function formatTime(iso: string) { const dt = new Date(iso); return Number.isNaN(dt.getTime()) ? '' : `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`; }

const CARD: React.CSSProperties = { backgroundColor: '#FFFFFF', borderRadius: 14, border: '1px solid #E3E9F2', boxShadow: '0 1px 3px rgba(15,27,51,0.05)', padding: 16 };
function Card({ children, style, id }: { children: React.ReactNode; style?: React.CSSProperties; id?: string }) {
    return <section id={id} style={{ ...CARD, ...style }}>{children}</section>;
}
function CardTitle({ children, icon }: { children: React.ReactNode; icon: React.ReactNode }) {
    return <h3 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 900, color: '#0F1B33' }}><span style={{ color: '#2563EB' }}>{icon}</span>{children}</h3>;
}
function Empty({ children }: { children: React.ReactNode }) {
    return <p style={{ margin: '8px 0', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>{children}</p>;
}
function InfoLine({ k, v }: { k: string; v: string }) {
    return <div style={{ display: 'flex', gap: 8 }}><span style={{ width: 38, flexShrink: 0, color: '#94A3B8', fontWeight: 700 }}>{k}</span><span style={{ flex: 1, minWidth: 0, color: '#334155', wordBreak: 'keep-all' }}>{v}</span></div>;
}
function Stat({ label, value, color }: { label: string; value: number; color: string }) {
    return <div style={{ flex: '1 1 80px', minWidth: 70, textAlign: 'center', padding: '8px 4px', borderRadius: 10, backgroundColor: '#F6F8FC', border: '1px solid #E3E9F2' }}><p style={{ margin: 0, fontSize: 18, fontWeight: 900, color }}>{value}</p><p style={{ margin: '1px 0 0', fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>{label}</p></div>;
}
function MiniStat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
    return <div style={{ padding: '12px 12px', borderRadius: 10, backgroundColor: '#F6F8FC', border: '1px solid #E3E9F2' }}><p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#64748B' }}>{label}</p><p style={{ margin: '4px 0 0', fontSize: muted ? 12 : 18, fontWeight: 900, color: muted ? '#94A3B8' : '#0F1B33', whiteSpace: 'nowrap' }}>{value}</p></div>;
}

const TONE: Record<string, { bg: string; color: string }> = {
    blue: { bg: 'rgba(37,99,235,0.08)', color: '#2563EB' },
    teal: { bg: 'rgba(15,124,118,0.08)', color: '#0E7C76' },
    amber: { bg: 'rgba(146,64,14,0.08)', color: '#92400E' },
    red: { bg: 'rgba(185,28,28,0.08)', color: '#B91C1C' },
};
function SummaryCard({ icon, tone, label, value, sub }: { icon: React.ReactNode; tone: keyof typeof TONE; label: string; value: string; sub: string }) {
    const t = TONE[tone];
    return (
        <div style={{ ...CARD, padding: 14, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: t.bg, color: t.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: '#64748B' }}>{label}</span>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 22, fontWeight: 900, color: '#0F1B33', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 600, color: '#94A3B8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</p>
        </div>
    );
}

const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 38, paddingLeft: 14, paddingRight: 14, borderRadius: 10, backgroundColor: '#2563EB', color: '#FFFFFF', fontSize: 12.5, fontWeight: 800, textDecoration: 'none' };
const ghostBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, height: 38, paddingLeft: 14, paddingRight: 14, borderRadius: 10, backgroundColor: '#FFFFFF', color: '#334155', border: '1px solid #D9E1EC', fontSize: 12.5, fontWeight: 800, textDecoration: 'none' };
const miniAction: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, height: 32, paddingLeft: 11, paddingRight: 11, borderRadius: 8, backgroundColor: '#F6F8FC', color: '#334155', border: '1px solid #E3E9F2', fontSize: 11.5, fontWeight: 800, textDecoration: 'none' };
const taskRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, backgroundColor: '#FBFCFE', border: '1px solid #E3E9F2', textDecoration: 'none' };
