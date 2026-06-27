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
    buildRange, fetchAnalytics, fetchAgeDistribution,
    type RangeKey, type AnalyticsRange, type AnalyticsResult, type AgeResult,
} from '@/lib/analytics/analyticsService';
import { TrendChart, HBarList, VBars, Donut } from '@/components/admin/AnalyticsCharts';
import {
    BarChart3, Users, Activity, Repeat, Layers, PieChart, ListOrdered,
    Sparkles, Info, ShieldAlert, Monitor, Database, ArrowRight, CircleSlash,
} from 'lucide-react';

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
            const r = buildRange(rangeKey);
            const [a, ag] = await Promise.all([fetchAnalytics(r), fetchAgeDistribution()]);
            if (cancelled) return;
            setRange(r);
            setData(a);
            setAge(ag);
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
                        <MiniSummary label="식별 사용자" value={fetching ? '…' : `${data?.identifiedUsers ?? 0}`} />
                        <MiniSummary label="기록 이벤트" value={fetching ? '…' : `${data?.totalEvents ?? 0}`} />
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
                        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#0F1B33' }}>집계 기준 안내</p>
                        <p style={{ margin: '3px 0 0', fontSize: 12, fontWeight: 600, color: '#475569', lineHeight: 1.6 }}>
                            현재 앱에는 <b>페이지 방문 로그가 수집되지 않습니다.</b> 따라서 아래 수치는 “방문”이 아니라
                            공지·댓글·권한변경 등 <b>실제로 기록된 활동(이벤트)</b> 기준입니다.
                            고유 방문자·총 방문·재방문율·인기 조회 메뉴 등 방문 중심 지표는 가짜 숫자를 만들지 않고
                            <b> ‘수집 필요’</b>로 표시합니다. (방문 이벤트 수집 도입 시 정확 집계 가능)
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
                                    <QRow label="수집 중" tone="ok" items={['공지 작성/수정', '댓글 작성', '권한 변경(감사)', '회원 연령(members.age)']} />
                                    <QRow label="누락(수집 필요)" tone="warn" items={['페이지 방문(page view)', '익명 세션 식별자', '조회 이벤트(KDK/Archive/Guest 등)', '참석 체크 전환', '성별 정보']} />
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
