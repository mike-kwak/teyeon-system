'use client';

// TEYEON Admin Analytics — PC 웹 전용 사용 분석.
//   접근: Admin shell(서버 middleware CEO/ADMIN) + 페이지 게이트(hasPermission('stats')).
//   데이터 원칙: 가짜/추정 금지. app_logs(실제 기록 이벤트)와 members.age(실제 나이)만 사용.
//   현재 page-view 로깅이 없어 "방문" 지표는 신뢰 불가 → "수집 필요"로 명시(빈 차트에 0 채우지 않음).
//   모바일은 별도 차트 구현하지 않고 PC 권장 안내 + 읽기 전용 요약만 제공.

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
    buildRangeKST, fetchAnalytics, fetchAgeDistribution, fetchVisitorAnalytics,
    type RangeKey, type AnalyticsRange, type AnalyticsResult, type AgeResult, type VisitorAnalytics, type VisitorStatus,
} from '@/lib/analytics/analyticsService';
import { TrendChart, VisitorTrendChart, HBarList, VBars, Donut } from '@/components/admin/AnalyticsCharts';
import {
    BarChart3, Users, Activity, Repeat, Layers, PieChart, ListOrdered,
    Sparkles, Info, ShieldAlert, Monitor, Database, ArrowRight, CircleSlash,
    Eye, MousePointerClick, Footprints, UserCheck,
} from 'lucide-react';

const USER_TYPE_META: Record<string, { label: string; color: string; desc: string }> = {
    MEMBER: { label: '회원(MEMBER)', color: '#2563EB', desc: '로그인한 일반 회원' },
    GUEST: { label: '게스트(GUEST)', color: '#0E7C76', desc: '로그인한 게스트 역할' },
    PUBLIC: { label: '공개(PUBLIC)', color: '#94A3B8', desc: '비로그인 익명 방문자' },
    UNKNOWN: { label: '미상(UNKNOWN)', color: '#CBD5E1', desc: '유형 판정 불가' },
};

const RANGES: { key: RangeKey; label: string }[] = [
    { key: 'today', label: '오늘' },
    { key: '7d', label: '7일' },
    { key: '30d', label: '30일' },
    { key: 'month', label: '이번 달' },
];

export default function AdminAnalyticsPage() {
    const { role, hasPermission, isLoading } = useAuth();
    const router = useRouter();
    const [rangeKey, setRangeKey] = React.useState<RangeKey>('30d');
    const [range, setRange] = React.useState<AnalyticsRange | null>(null);
    const [data, setData] = React.useState<AnalyticsResult | null>(null);
    const [age, setAge] = React.useState<AgeResult | null>(null);
    const [fetching, setFetching] = React.useState(true);
    const [fetchedAt, setFetchedAt] = React.useState<string | null>(null);
    const [visitor, setVisitor] = React.useState<VisitorAnalytics | null>(null); // 방문 Analytics(analytics_events)

    const allowed = role === 'CEO' || hasPermission('stats') === 'WRITE';

    React.useEffect(() => {
        if (!isLoading && hasPermission('stats') === 'HIDE' && role !== 'CEO') {
            router.replace('/');
        }
    }, [isLoading, role, hasPermission, router]);

    React.useEffect(() => {
        if (isLoading) return;
        if (!allowed) { setFetching(false); return; }
        let cancelled = false;
        (async () => {
            setFetching(true);
            const r = buildRangeKST(rangeKey);
            const [a, ag, v] = await Promise.all([fetchAnalytics(r), fetchAgeDistribution(), fetchVisitorAnalytics(r)]);
            if (cancelled) return;
            setRange(r);
            setData(a);
            setAge(ag);
            setVisitor(v);
            const now = new Date();
            setFetchedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
            setFetching(false);
        })();
        return () => { cancelled = true; };
    }, [rangeKey, isLoading, allowed]);

    if (!isLoading && !allowed) {
        return (
            <div style={{ maxWidth: 1280, margin: '0 auto' }}>
                <Section icon={<ShieldAlert size={16} />} title="사용 분석">
                    <Empty>사용 분석은 회장(CEO) 계정만 열람할 수 있습니다.</Empty>
                </Section>
            </div>
        );
    }

    const hasEvents = (data?.totalEvents ?? 0) > 0;

    return (
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
            {/* 헤더 */}
            <header style={{ marginBottom: 18 }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-rajdhani), sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.26em', color: '#2563EB' }}>
                    TEYEON ANALYTICS
                </p>
                <h1 style={{ margin: '3px 0 0', fontSize: 24, fontWeight: 900, color: '#0F1B33', letterSpacing: '-0.02em' }}>사용 분석</h1>
                <p style={{ margin: '5px 0 0', fontSize: 12.5, fontWeight: 600, color: '#64748B' }}>
                    TEYEON 앱이 실제로 얼마나 사용되는지 집계합니다. 모든 수치는 가짜·추정 없이 실제 로그 기준입니다.
                </p>
            </header>

            {/* 모바일: PC 권장 안내 + 읽기 전용 요약 */}
            <div className="lg:hidden" style={{ marginBottom: 14 }}>
                <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: 'rgba(37,99,235,0.08)', color: '#2563EB', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Monitor size={17} />
                        </span>
                        <div>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0F1B33' }}>PC 화면 권장</p>
                            <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 600, color: '#64748B' }}>사용 분석 차트는 PC 관리자 화면에 최적화되어 있습니다.</p>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {visitor?.status === 'ok' ? (
                            <>
                                <MiniSummary label="고유 방문자" value={fetching ? '…' : `${visitor.uniqueVisitors}`} />
                                <MiniSummary label="페이지 조회" value={fetching ? '…' : `${visitor.pageViews}`} />
                            </>
                        ) : (
                            <>
                                <MiniSummary label="식별 사용자" value={fetching ? '…' : `${data?.identifiedUsers ?? 0}`} />
                                <MiniSummary label="기록 이벤트" value={fetching ? '…' : `${data?.totalEvents ?? 0}`} />
                            </>
                        )}
                    </div>
                    <p style={{ margin: 0, fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>
                        {range?.label || ''} 기준 · 자세한 분석은 PC에서 열어 주세요.
                    </p>
                </div>
            </div>

            {/* 데스크톱 전용 전체 분석 */}
            <div className="hidden lg:block">
                {/* 데이터 수집 안내 배너 */}
                <div style={{ ...CARD, display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 14, borderLeft: '3px solid #2563EB', backgroundColor: '#F8FAFF' }}>
                    <Info size={18} style={{ color: '#2563EB', flexShrink: 0, marginTop: 1 }} />
                    <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#0F1B33' }}>집계 기준 안내</p>
                            <StatusChip status={visitor?.status ?? null} />
                        </div>
                        <p style={{ margin: '3px 0 0', fontSize: 12, fontWeight: 600, color: '#475569', lineHeight: 1.6 }}>
                            {visitor?.status === 'ok' ? (
                                <>방문 이벤트(<b>analytics_events</b>) 수집이 활성화되어 <b>방문 Analytics</b>(고유 방문자·페이지 조회·세션·재방문율)를 실제 데이터로 표시합니다.
                                아래 <b>운영 활동 로그</b>는 공지·댓글·권한변경 등 app_logs 기반으로 별도 구분됩니다. 모든 수치는 Asia/Seoul 기준입니다.</>
                            ) : visitor?.status === 'empty' ? (
                                <>방문 이벤트 수집은 <b>활성</b>이나 선택 기간에 적재된 데이터가 아직 없습니다. 방문이 쌓이면 <b>방문 Analytics</b>가 자동 표시됩니다.
                                아래는 기존 app_logs 기반 <b>운영 활동 로그</b>입니다.</>
                            ) : visitor?.status === 'error' ? (
                                <><b>방문 이벤트 조회 오류</b>가 발생했습니다(RLS/네트워크 확인 필요). 아래 <b>운영 활동 로그</b>(app_logs)는 정상 표시됩니다.</>
                            ) : (
                                <>방문 이벤트 수집이 <b>아직 적용되지 않았습니다(migration 대기).</b> 따라서 아래 수치는 “방문”이 아니라
                                공지·댓글·권한변경 등 <b>실제로 기록된 활동(이벤트)</b> 기준이며, 방문 중심 지표는 가짜 숫자 없이
                                <b> ‘수집 필요’</b>로 표시합니다. (analytics_events migration 적용 시 방문 Analytics 활성화)</>
                            )}
                        </p>
                    </div>
                </div>

                {/* 기간 선택 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#64748B' }}>기간</span>
                    <div style={{ display: 'inline-flex', backgroundColor: '#FFFFFF', border: '1px solid #E3E9F2', borderRadius: 10, padding: 3, gap: 2 }}>
                        {RANGES.map((r) => {
                            const active = rangeKey === r.key;
                            return (
                                <button key={r.key} type="button" onClick={() => setRangeKey(r.key)}
                                    style={{
                                        height: 32, paddingLeft: 14, paddingRight: 14, borderRadius: 8, border: 'none', cursor: 'pointer',
                                        backgroundColor: active ? '#2563EB' : 'transparent', color: active ? '#FFFFFF' : '#475569',
                                        fontSize: 12.5, fontWeight: 800,
                                    }}>
                                    {r.label}
                                </button>
                            );
                        })}
                    </div>
                    {range && <span style={{ fontSize: 11.5, fontWeight: 600, color: '#94A3B8' }}>{range.start.toLocaleDateString()} ~ {range.label}</span>}
                </div>

                {/* ── 방문 Analytics (analytics_events) ─────────────────────────── */}
                {visitor?.status === 'ok' && (
                    <div style={{ marginBottom: 20 }}>
                        <SectionHeading title="방문 Analytics" sub="실제 페이지 방문 기준 · Asia/Seoul · 관리자(INTERNAL)·전광판 제외" />
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
                            <Kpi icon={<Eye size={18} />} tone="blue" label="고유 방문자" value={`${visitor.uniqueVisitors}`} sub="로그인 ID 또는 익명 ID 기준" />
                            <Kpi icon={<MousePointerClick size={18} />} tone="teal" label="페이지 조회" value={`${visitor.pageViews}`} sub="page_view 총 건수" />
                            <Kpi icon={<Footprints size={18} />} tone="blue" label="세션 수" value={`${visitor.sessions}`} sub={`30분 비활성 기준${visitor.avgPagesPerSession != null ? ` · 평균 ${visitor.avgPagesPerSession.toFixed(1)}p/세션` : ''}`} />
                            {visitor.returningRate != null
                                ? <Kpi icon={<UserCheck size={18} />} tone="teal" label="재방문율" value={`${Math.round(visitor.returningRate * 100)}%`} sub={visitor.returningLowConfidence ? '수집 기간 짧음 · 정확도 낮음' : '기간 시작 이전 방문 이력 보유'} />
                                : <Kpi icon={<UserCheck size={18} />} tone="muted" label="재방문율" needsData sub="이전 방문 데이터 부족" />}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12, marginBottom: 14 }}>
                            <Section icon={<BarChart3 size={16} />} title="방문 추이" hint="일별 고유 방문자·페이지 조회·세션">
                                {visitor.pageViews === 0 && visitor.uniqueVisitors === 0
                                    ? <Empty>선택 기간에 방문 데이터가 없습니다.</Empty>
                                    : <VisitorTrendChart data={visitor.daily} />}
                            </Section>
                            <Section icon={<PieChart size={16} />} title="사용자 유형" hint="INTERNAL 제외">
                                <Donut segments={visitor.userTypes.map((t) => ({ label: USER_TYPE_META[t.type]?.label || t.type, value: t.count, color: USER_TYPE_META[t.type]?.color || '#CBD5E1' }))} />
                                <Note>MEMBER=로그인 회원 · GUEST=로그인 게스트 · PUBLIC=비로그인 익명 · UNKNOWN=판정 불가. GUEST 데이터가 없으면 0으로 표시하며 MEMBER로 합치지 않습니다.</Note>
                            </Section>
                        </div>
                        <Section icon={<ListOrdered size={16} />} title="인기 메뉴 (방문)" hint="normalized_path 기준 · 원시 경로/토큰 미노출">
                            {visitor.topMenus.length === 0
                                ? <Empty>방문 경로 데이터가 없습니다.</Empty>
                                : <HBarList rows={visitor.topMenus.map((m) => ({ label: m.label, count: m.count }))} accent="#0E7C76" />}
                        </Section>
                    </div>
                )}

                {(visitor?.status === 'ok' || visitor?.status === 'empty') && (
                    <SectionHeading title="운영 활동 로그" sub="app_logs 기반 · 공지·댓글·권한 변경 (방문 Analytics 와 분리)" />
                )}

                {data?.blocked ? (
                    <Section icon={<ShieldAlert size={16} />} title="활동 로그">
                        <Empty>활동 로그를 조회할 수 없습니다. (보안 정책 RLS 확인 필요 — CEO 계정으로 접근해 주세요.)</Empty>
                    </Section>
                ) : (
                    <>
                        {/* KPI */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
                            <Kpi icon={<Users size={18} />} tone="blue" label="식별 사용자" value={fetching ? '…' : `${data?.identifiedUsers ?? 0}`} sub="로그인(user_id) 기준 고유" />
                            <Kpi icon={<Activity size={18} />} tone="teal" label="기록 이벤트" value={fetching ? '…' : `${data?.totalEvents ?? 0}`} sub="방문 아님 · 활동 로그 기준" />
                            <Kpi icon={<Repeat size={18} />} tone="muted" label="재방문율" needsData sub="방문 로깅 도입 후 집계" />
                            <Kpi icon={<Layers size={18} />} tone="blue" label="평균 활동 메뉴" value={fetching ? '…' : data?.avgMenusPerUser != null ? data.avgMenusPerUser.toFixed(1) : '—'} sub="식별 사용자 1인당" />
                        </div>

                        {/* 추이 + 사용자 구성 */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12, marginBottom: 14 }}>
                            <Section icon={<BarChart3 size={16} />} title="활동 추이" hint="일별 기록 이벤트 (방문 아님)">
                                {fetching ? <Empty>불러오는 중...</Empty> : !hasEvents ? (
                                    <Empty>선택한 기간에 기록된 활동이 없습니다. <Hint>활동(공지·댓글·권한변경)이 발생하면 표시됩니다.</Hint></Empty>
                                ) : <TrendChart data={data!.daily} />}
                            </Section>
                            <Section icon={<PieChart size={16} />} title="사용자 구성" hint="식별 vs 공개(미식별)">
                                {fetching ? <Empty>불러오는 중...</Empty> : !hasEvents ? (
                                    <Empty>데이터가 부족합니다.</Empty>
                                ) : (
                                    <>
                                        <Donut segments={[
                                            { label: '로그인(식별)', value: data!.identifiedEvents, color: '#2563EB' },
                                            { label: '공개(미식별)', value: data!.anonymousEvents, color: '#94A3B8' },
                                        ]} />
                                        <Note>MEMBER·GUEST(게스트 패스) 구분은 현재 로그로 불가 → 향후 수집 필요. 공개 사용자는 식별자가 없어 개별 구분되지 않습니다.</Note>
                                    </>
                                )}
                            </Section>
                        </div>

                        {/* 인기 메뉴 + 주요 기능 */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                            <Section icon={<ListOrdered size={16} />} title="활동 경로 TOP 5" hint="관리자 경로 제외 · 동적 ID 묶음">
                                {fetching ? <Empty>불러오는 중...</Empty> : !data?.topMenus.length ? (
                                    <Empty>집계된 활동 경로가 없습니다.</Empty>
                                ) : (
                                    <>
                                        <HBarList rows={data.topMenus.map((m) => ({ label: m.menu, count: m.count }))} />
                                        <Note>“방문수”가 아니라 활동이 기록된 경로 기준입니다. 정확한 인기 메뉴는 방문 로깅 필요.</Note>
                                    </>
                                )}
                            </Section>
                            <Section icon={<Sparkles size={16} />} title="주요 기능 사용량">
                                {fetching ? <Empty>불러오는 중...</Empty> : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                                        {(data?.featureUsage || []).map((f) => (
                                            <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid #F1F5FA' }}>
                                                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: '#334155' }}>{f.label}</span>
                                                {f.tracked
                                                    ? <span style={{ fontSize: 13, fontWeight: 900, color: '#0F1B33' }}>{f.count}</span>
                                                    : <NeedChip />}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </Section>
                        </div>

                        {/* 회원 구성 (연령대 / 성별) */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                            <Section icon={<Users size={16} />} title="연령대 분포" hint="members.age 실제값">
                                {!age?.ok ? (
                                    <Empty>회원 연령 데이터를 불러올 수 없습니다.</Empty>
                                ) : age.total === 0 ? (
                                    <Empty>등록된 회원이 없습니다.</Empty>
                                ) : (
                                    <>
                                        <VBars rows={age.buckets} />
                                        <Note>전체 {age.total}명 중 {age.filled}명 입력 · 미입력 {age.total - age.filled}명 ({age.total ? Math.round(((age.total - age.filled) / age.total) * 100) : 0}%)</Note>
                                    </>
                                )}
                            </Section>
                            <Section icon={<PieChart size={16} />} title="성별 분포">
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '24px 12px', textAlign: 'center' }}>
                                    <CircleSlash size={26} style={{ color: '#CBD5E1' }} />
                                    <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#64748B' }}>현재 회원 프로필에 성별 정보가 없어 집계할 수 없습니다.</p>
                                    <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>후속: members 에 성별 컬럼 추가 후 입력 시 집계 가능합니다.</p>
                                </div>
                            </Section>
                        </div>

                        {/* 활동 종류 / 데이터 품질 */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <Section icon={<Activity size={16} />} title="활동 종류" hint="관리자 감사 ⊥ 일반 활동 구분">
                                {fetching ? <Empty>불러오는 중...</Empty> : !data?.eventTypes.length ? (
                                    <Empty>기록된 활동이 없습니다.</Empty>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {data.eventTypes.map((e) => (
                                            <div key={e.action} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid #F1F5FA' }}>
                                                {e.audit
                                                    ? <span style={{ fontSize: 9.5, fontWeight: 800, color: '#92400E', backgroundColor: 'rgba(146,64,14,0.10)', padding: '2px 7px', borderRadius: 999 }}>관리자</span>
                                                    : <span style={{ fontSize: 9.5, fontWeight: 800, color: '#0E7C76', backgroundColor: 'rgba(15,124,118,0.10)', padding: '2px 7px', borderRadius: 999 }}>사용</span>}
                                                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: '#334155' }}>{e.label}</span>
                                                <span style={{ fontSize: 12.5, fontWeight: 900, color: '#0F1B33' }}>{e.count}</span>
                                            </div>
                                        ))}
                                        <Note>관리자 감사 이벤트({data.auditEvents}건)는 일반 사용량 해석에서 분리해야 합니다.</Note>
                                    </div>
                                )}
                            </Section>
                            <Section icon={<Database size={16} />} title="데이터 품질">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {visitor?.status === 'ok' || visitor?.status === 'empty' ? (
                                        <>
                                            <QRow label="수집 중" tone="ok" items={['페이지 방문(page_view)', '세션·익명 ID', '참석 저장(attendance_submit)', '공지/댓글/권한(app_logs)', '회원 연령(members.age)']} />
                                            <QRow label="누락(수집 필요)" tone="warn" items={['조회 세부 전환(정모→참석)', '성별 정보']} />
                                        </>
                                    ) : (
                                        <>
                                            <QRow label="수집 중" tone="ok" items={['공지 작성/수정', '댓글 작성', '권한 변경(감사)', '회원 연령(members.age)']} />
                                            <QRow label="누락(수집 필요)" tone="warn" items={['페이지 방문(page view)', '익명 세션 식별자', '조회 이벤트(KDK/Archive/Guest 등)', '참석 체크 전환', '성별 정보']} />
                                        </>
                                    )}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid #F1F5FA' }}>
                                        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#64748B' }}>마지막 집계</span>
                                        <span style={{ fontSize: 11.5, fontWeight: 800, color: '#0F1B33' }}>{fetchedAt || '—'}</span>
                                    </div>
                                    <Link href="/admin/stats" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, color: '#2563EB', textDecoration: 'none' }}>
                                        상세 로그 보기(방문 로그) <ArrowRight size={13} />
                                    </Link>
                                </div>
                            </Section>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ── UI helpers ────────────────────────────────────────────────────────────────
const CARD: React.CSSProperties = { backgroundColor: '#FFFFFF', borderRadius: 14, border: '1px solid #E3E9F2', boxShadow: '0 1px 3px rgba(15,27,51,0.05)', padding: 16 };

function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
    return (
        <section style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                <span style={{ color: '#2563EB', display: 'inline-flex' }}>{icon}</span>
                <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 900, color: '#0F1B33' }}>{title}</h3>
                {hint && <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, color: '#94A3B8' }}>{hint}</span>}
            </div>
            {children}
        </section>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return <p style={{ margin: '20px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.6 }}>{children}</p>;
}
function SectionHeading({ title, sub }: { title: string; sub: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '2px 0 12px', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0F1B33', letterSpacing: '-0.01em' }}>{title}</h2>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>{sub}</span>
        </div>
    );
}
const STATUS_CHIP: Record<VisitorStatus, { t: string; c: string; bg: string }> = {
    ok: { t: '방문 이벤트 수집: 활성', c: '#0E7C76', bg: 'rgba(15,124,118,0.10)' },
    empty: { t: '방문 이벤트 수집: 활성 · 데이터 없음', c: '#2563EB', bg: 'rgba(37,99,235,0.10)' },
    not_ready: { t: '방문 이벤트 수집: 대기(migration 미적용)', c: '#92400E', bg: 'rgba(146,64,14,0.10)' },
    error: { t: '방문 이벤트 조회 오류', c: '#B91C1C', bg: 'rgba(185,28,28,0.10)' },
};
function StatusChip({ status }: { status: VisitorStatus | null }) {
    if (!status) return null;
    const m = STATUS_CHIP[status];
    return <span style={{ fontSize: 10, fontWeight: 800, color: m.c, backgroundColor: m.bg, padding: '3px 8px', borderRadius: 999 }}>{m.t}</span>;
}
function Hint({ children }: { children: React.ReactNode }) {
    return <span style={{ display: 'block', marginTop: 4, fontSize: 11, fontWeight: 600, color: '#B6C0CE' }}>{children}</span>;
}
function Note({ children }: { children: React.ReactNode }) {
    return <p style={{ margin: '12px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.55 }}>{children}</p>;
}
function NeedChip() {
    return <span style={{ fontSize: 10, fontWeight: 800, color: '#92400E', backgroundColor: 'rgba(146,64,14,0.10)', padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>수집 필요</span>;
}

const TONE: Record<string, { bg: string; color: string }> = {
    blue: { bg: 'rgba(37,99,235,0.08)', color: '#2563EB' },
    teal: { bg: 'rgba(15,124,118,0.08)', color: '#0E7C76' },
    muted: { bg: 'rgba(100,116,139,0.10)', color: '#64748B' },
};
function Kpi({ icon, tone, label, value, sub, needsData }: { icon: React.ReactNode; tone: keyof typeof TONE; label: string; value?: string; sub: string; needsData?: boolean }) {
    const t = TONE[tone];
    return (
        <div style={{ ...CARD, padding: 14, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: t.bg, color: t.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: '#64748B' }}>{label}</span>
            </div>
            {needsData
                ? <p style={{ margin: '12px 0 0', fontSize: 14, fontWeight: 800, color: '#92400E' }}>수집 필요</p>
                : <p style={{ margin: '10px 0 0', fontSize: 24, fontWeight: 900, color: '#0F1B33', whiteSpace: 'nowrap' }}>{value}</p>}
            <p style={{ margin: '3px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>{sub}</p>
        </div>
    );
}
function MiniSummary({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ padding: '10px 12px', borderRadius: 10, backgroundColor: '#F6F8FC', border: '1px solid #E3E9F2' }}>
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>{label}</p>
            <p style={{ margin: '3px 0 0', fontSize: 18, fontWeight: 900, color: '#0F1B33' }}>{value}</p>
        </div>
    );
}
function QRow({ label, tone, items }: { label: string; tone: 'ok' | 'warn'; items: string[] }) {
    const c = tone === 'ok' ? { color: '#0E7C76', bg: 'rgba(15,124,118,0.10)' } : { color: '#92400E', bg: 'rgba(146,64,14,0.10)' };
    return (
        <div>
            <span style={{ fontSize: 10, fontWeight: 800, color: c.color, backgroundColor: c.bg, padding: '3px 8px', borderRadius: 999 }}>{label}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
                {items.map((it) => (
                    <span key={it} style={{ fontSize: 11, fontWeight: 700, color: '#475569', backgroundColor: '#F6F8FC', border: '1px solid #E3E9F2', padding: '4px 9px', borderRadius: 8 }}>{it}</span>
                ))}
            </div>
        </div>
    );
}
