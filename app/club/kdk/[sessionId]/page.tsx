'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { useParams } from 'next/navigation';
import { Trophy, Clock, Play, Hammer, LayoutGrid, Users } from 'lucide-react';
import PublicHeader from '@/components/club/PublicHeader';
import {
    fetchPublicKdkSession,
    type PublicKdkSessionDetail,
    type PublicKdkSessionState,
    type PublicFinalRankingRow,
    type PublicMatchRow,
    type PublicRankingRow,
} from '@/lib/publicClubService';

/**
 * /club/kdk/[sessionId] — KDK 세션 공개 상세.
 * 상태별로 다른 카드 노출. 점수 입력 / 수정 / 확정 / 운영 버튼 절대 없음.
 *
 * 응답 DTO 는 public RPC 가 가공해 보내준 안전한 표시명 / 점수만 포함.
 * raw player_ids / member UUID / created_by 는 서버에서 이미 필터링 — 클라이언트도 추가 노출 X.
 */

const STATE_LABEL: Record<PublicKdkSessionState, string> = {
    preparing:   '준비 중',
    ready:       '대진 준비 완료',
    in_progress: '경기 진행 중',
    settling:    '경기 결과 정리 중',
    finished:    '공식 결과',
};

const STATE_TONE: Record<PublicKdkSessionState, { bg: string; color: string; border: string }> = {
    preparing:   { bg: 'rgba(100,116,139,0.10)', color: '#475569', border: 'rgba(100,116,139,0.22)' },
    ready:       { bg: 'rgba(13,148,136,0.10)',  color: '#0F766E', border: 'rgba(13,148,136,0.24)' },
    in_progress: { bg: 'rgba(239,68,68,0.10)',   color: '#B91C1C', border: 'rgba(239,68,68,0.28)' },
    settling:    { bg: 'rgba(245,158,11,0.10)',  color: '#92400E', border: 'rgba(245,158,11,0.24)' },
    finished:    { bg: 'rgba(15,159,152,0.10)',  color: '#0E7C76', border: 'rgba(15,159,152,0.24)' },
};

export default function ClubKdkSessionPublicPage() {
    const params = useParams<{ sessionId: string }>();
    const sessionId = params?.sessionId || '';

    const [data, setData] = React.useState<PublicKdkSessionDetail | null>(null);
    const [status, setStatus] = React.useState<'loading' | 'ok' | 'not_found'>('loading');

    React.useEffect(() => {
        if (!sessionId) {
            setStatus('not_found');
            return;
        }
        let cancelled = false;
        (async () => {
            const row = await fetchPublicKdkSession(sessionId);
            if (cancelled) return;
            if (!row) { setStatus('not_found'); return; }
            setData(row);
            setStatus('ok');
        })();
        return () => { cancelled = true; };
    }, [sessionId]);

    return (
        <main style={pageStyle}>
            <PublicHeader backHref="/club/kdk" />
            <div style={containerStyle}>
                {status === 'loading' && <Empty>불러오는 중...</Empty>}
                {status === 'not_found' && (
                    <Empty>
                        현재 공개된 경기 정보가 없습니다.
                        <br />운영진이 결과를 등록하면 이 페이지에서 확인할 수 있습니다.
                    </Empty>
                )}

                {status === 'ok' && data && (
                    <>
                        {/* ── 헤더 ─────────────────────────────────────────── */}
                        <section style={card()}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <StateBadge state={data.state} />
                                {data.isOfficial && <OfficialBadge />}
                            </div>
                            <h1 style={{
                                margin: 0, fontSize: 18, fontWeight: 900, color: '#0F172A',
                                letterSpacing: '-0.02em', wordBreak: 'keep-all',
                            }}>
                                {data.title}
                            </h1>
                            {data.createdAt && (
                                <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8' }}>
                                    {formatDateKo(data.createdAt)}
                                </p>
                            )}
                        </section>

                        {/* ── 상태별 본문 ──────────────────────────────────── */}
                        {data.state === 'finished'    && <FinishedView data={data} />}
                        {data.state === 'in_progress' && <InProgressView data={data} />}
                        {data.state === 'ready'       && <ReadyView data={data} />}
                        {data.state === 'settling'    && <SettlingView />}
                        {data.state === 'preparing'   && <PreparingView />}
                    </>
                )}
            </div>
        </main>
    );
}

// ── State badges ────────────────────────────────────────────────────────────

const StateBadge = ({ state }: { state: PublicKdkSessionState }) => {
    const tone = STATE_TONE[state];
    return (
        <span style={{
            fontSize: 9.5, fontWeight: 800, letterSpacing: '0.04em',
            paddingTop: 2, paddingBottom: 2, paddingLeft: 7, paddingRight: 7,
            borderRadius: 4,
            backgroundColor: tone.bg, color: tone.color,
            border: `1px solid ${tone.border}`,
        }}>
            {STATE_LABEL[state]}
        </span>
    );
};

const OfficialBadge = () => (
    <span style={{
        fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
        paddingTop: 2, paddingBottom: 2, paddingLeft: 6, paddingRight: 6,
        borderRadius: 4,
        backgroundColor: 'rgba(15,159,152,0.10)',
        color: '#0E7C76',
        border: '1px solid rgba(15,159,152,0.22)',
    }}>
        공식
    </span>
);

// ── Section title ──────────────────────────────────────────────────────────

const SectionTitle = ({ icon, children, count }: { icon: React.ReactNode; children: React.ReactNode; count?: number }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color: '#0F9F98', display: 'inline-flex' }}>{icon}</span>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em' }}>
            {children}
        </h3>
        {typeof count === 'number' && (
            <span style={{
                marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: '#475569',
            }}>
                {count}건
            </span>
        )}
    </div>
);

// ── Match row (공통) ──────────────────────────────────────────────────────
// raw player_id 노출 절대 금지 — playerNames 만 사용. 안전 표시명 그대로.

const MatchRow = ({
    matchNo, round, court, group, playerNames, status, score1, score2,
    showScore = false,
}: PublicMatchRow & { showScore?: boolean }) => {
    const names = (playerNames || []).filter((n): n is string => !!n && typeof n === 'string');
    const team1 = names.slice(0, 2).join(' · ');
    const team2 = names.slice(2, 4).join(' · ');
    return (
        <div
            style={{
                display: 'flex', alignItems: 'stretch', gap: 10,
                paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12,
                borderRadius: 10,
                backgroundColor: '#F8FAFC',
                border: '1px solid rgba(15,23,42,0.05)',
                minWidth: 0,
            }}
        >
            <div style={{
                width: 50, flexShrink: 0, textAlign: 'center',
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
            }}>
                {matchNo != null && (
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em', lineHeight: 1.1 }}>
                        #{matchNo}
                    </p>
                )}
                {round != null && (
                    <p style={{ margin: '3px 0 0', fontSize: 8.5, fontWeight: 800, color: '#64748B', lineHeight: 1.1 }}>
                        ROUND {round}
                    </p>
                )}
                {court != null && (
                    <p style={{ margin: '3px 0 0', fontSize: 8.5, fontWeight: 800, color: '#64748B', lineHeight: 1.1 }}>
                        COURT {court}
                    </p>
                )}
                {group && (
                    <p style={{ margin: '3px 0 0', fontSize: 8.5, fontWeight: 800, color: '#0E7C76', lineHeight: 1.1 }}>
                        {formatGroup(group)}
                    </p>
                )}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5 }}>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: showScore ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)',
                    alignItems: 'center',
                    gap: 8,
                }}>
                    <span style={{
                        minWidth: 0, fontSize: 12, fontWeight: 800, color: '#0F172A',
                        lineHeight: 1.35, overflowWrap: 'anywhere', wordBreak: 'keep-all',
                    }}>
                        {team1 || '—'}
                    </span>
                    {showScore && (
                        <span style={{ fontSize: 15, fontWeight: 900, color: (score1 ?? 0) >= (score2 ?? 0) ? '#0F172A' : '#94A3B8', minWidth: 22, textAlign: 'right' }}>
                            {score1 ?? 0}
                        </span>
                    )}
                </div>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: showScore ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)',
                    alignItems: 'center',
                    gap: 8,
                }}>
                    <span style={{
                        minWidth: 0, fontSize: 12, fontWeight: 800, color: '#0F172A',
                        lineHeight: 1.35, overflowWrap: 'anywhere', wordBreak: 'keep-all',
                    }}>
                        {team2 || '—'}
                    </span>
                    {showScore && (
                        <span style={{ fontSize: 15, fontWeight: 900, color: (score2 ?? 0) >= (score1 ?? 0) ? '#0F172A' : '#94A3B8', minWidth: 22, textAlign: 'right' }}>
                            {score2 ?? 0}
                        </span>
                    )}
                </div>
            </div>
            {status && !showScore && (
                <span style={{
                    flexShrink: 0,
                    alignSelf: 'center',
                    fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
                    paddingTop: 1, paddingBottom: 1, paddingLeft: 5, paddingRight: 5,
                    borderRadius: 4,
                    backgroundColor: status === 'playing' ? 'rgba(239,68,68,0.10)' :
                                     status === 'waiting' ? 'rgba(100,116,139,0.10)' :
                                     'rgba(15,159,152,0.10)',
                    color: status === 'playing' ? '#B91C1C' :
                           status === 'waiting' ? '#475569' :
                           '#0E7C76',
                }}>
                    {status === 'playing' ? '진행' : status === 'waiting' ? '대기' : '완료'}
                </span>
            )}
        </div>
    );
};

// ── ready: 대진표 ──────────────────────────────────────────────────────────

const ReadyView = ({ data }: { data: PublicKdkSessionDetail }) => {
    const bracket = data.bracket || [];
    return (
        <section style={card()}>
            <SectionTitle icon={<LayoutGrid size={14} strokeWidth={1.8} />} count={bracket.length}>
                대진표
            </SectionTitle>
            {bracket.length === 0 ? (
                <p style={{ margin: 0, textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>
                    아직 등록된 대진이 없습니다.
                </p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {bracket.map((m, i) => (
                        <MatchRow key={`${m.matchNo}-${i}`} {...m} />
                    ))}
                </div>
            )}
        </section>
    );
};

// ── in_progress: 현재 + 대기 + 순위 ───────────────────────────────────────

const InProgressView = ({ data }: { data: PublicKdkSessionDetail }) => {
    const now = data.nowPlaying || [];
    const waiting = data.waiting || [];
    const ranking = data.ranking || [];
    return (
        <>
            <section style={card()}>
                <SectionTitle icon={<Play size={14} strokeWidth={1.8} />} count={now.length}>
                    현재 경기
                </SectionTitle>
                {now.length === 0 ? (
                    <p style={{ margin: 0, textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>
                        진행 중인 경기가 없습니다.
                    </p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {now.map((m, i) => (
                            <MatchRow key={`now-${i}`} {...m} showScore />
                        ))}
                    </div>
                )}
            </section>

            {waiting.length > 0 && (
                <section style={card()}>
                    <SectionTitle icon={<Clock size={14} strokeWidth={1.8} />} count={waiting.length}>
                        다음 대기
                    </SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {waiting.slice(0, 10).map((m, i) => (
                            <MatchRow key={`wait-${i}`} {...m} />
                        ))}
                    </div>
                </section>
            )}

            {ranking.length > 0 && (
                <section style={card()}>
                    <SectionTitle icon={<Users size={14} strokeWidth={1.8} />}>
                        실시간 순위
                    </SectionTitle>
                    <RankingTable rows={ranking} />
                </section>
            )}
        </>
    );
};

// ── preparing / settling ──────────────────────────────────────────────────

const PreparingView = () => (
    <section style={card({ alignCenter: true })}>
        <span style={{
            width: 40, height: 40, borderRadius: 10,
            backgroundColor: 'rgba(100,116,139,0.10)', color: '#475569',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 10,
        }}>
            <Clock size={18} strokeWidth={1.8} />
        </span>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em' }}>
            대진을 준비하고 있습니다
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 600, color: '#64748B', lineHeight: 1.55, maxWidth: 320, wordBreak: 'keep-all' }}>
            대진표가 확정되면 이 페이지에서 확인할 수 있습니다.
        </p>
    </section>
);

const SettlingView = () => (
    <section style={card({ alignCenter: true })}>
        <span style={{
            width: 40, height: 40, borderRadius: 10,
            backgroundColor: 'rgba(245,158,11,0.10)', color: '#B45309',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 10,
        }}>
            <Hammer size={18} strokeWidth={1.8} />
        </span>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em' }}>
            경기 결과 정리 중입니다
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 600, color: '#64748B', lineHeight: 1.55, maxWidth: 320, wordBreak: 'keep-all' }}>
            운영진이 공식 결과를 등록하면 이 페이지에서 확인할 수 있습니다.
        </p>
    </section>
);

// ── finished ──────────────────────────────────────────────────────────────

const FinishedView = ({ data }: { data: PublicKdkSessionDetail }) => {
    const finalRanking = Array.isArray(data.finalRanking) ? data.finalRanking : [];
    const matches = Array.isArray(data.matches) ? data.matches : [];
    return (
        <>
            {finalRanking.length > 0 && (
                <section style={card()}>
                    <SectionTitle icon={<Trophy size={14} strokeWidth={1.8} />}>
                        최종 순위
                    </SectionTitle>
                    <FinalRankingTable rows={finalRanking} />
                </section>
            )}

            {matches.length > 0 && (
                <section style={card()}>
                    <SectionTitle icon={<LayoutGrid size={14} strokeWidth={1.8} />} count={matches.length}>
                        공식 경기 결과
                    </SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {matches.map((match, index) => (
                            <MatchRow key={`finished-${match.matchNo ?? index}`} {...match} showScore />
                        ))}
                    </div>
                </section>
            )}

            {finalRanking.length === 0 && matches.length === 0 && (
                <section style={card({ alignCenter: true })}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#64748B' }}>
                        공개 가능한 공식 결과가 없습니다.
                    </p>
                </section>
            )}
        </>
    );
};

// ── ranking table ─────────────────────────────────────────────────────────

const FinalRankingTable = ({ rows }: { rows: PublicFinalRankingRow[] }) => (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {rows.map((row) => (
            <li
                key={`${row.rank}-${row.name}`}
                style={{
                    display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr)', columnGap: 10, rowGap: 2,
                    alignItems: 'center',
                    paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10,
                    borderRadius: 8,
                    backgroundColor: row.rank === 1 ? 'rgba(245,158,11,0.06)' : 'transparent',
                    border: row.rank === 1 ? '1px solid rgba(245,158,11,0.20)' : '1px solid rgba(15,23,42,0.04)',
                    minWidth: 0,
                }}
            >
                <RankBadge rank={row.rank} />
                <span style={{
                    minWidth: 0, fontSize: 12.5, fontWeight: 800, color: '#0F172A',
                    lineHeight: 1.35, overflowWrap: 'anywhere', wordBreak: 'keep-all',
                }}>
                    {row.name}
                    {row.group && (
                        <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: '#0E7C76' }}>
                            {formatGroup(row.group)}
                        </span>
                    )}
                </span>
                <span style={{ minWidth: 0, fontSize: 10.5, fontWeight: 700, color: '#475569', lineHeight: 1.35 }}>
                    {row.wins}승 {row.losses}패 · 득실 {formatSigned(row.diff)}
                </span>
            </li>
        ))}
    </ol>
);

const RankingTable = ({ rows }: { rows: PublicRankingRow[] }) => (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {rows.map((r) => (
            <li
                key={`${r.rank}-${r.name}`}
                style={{
                    display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr)', columnGap: 10, rowGap: 2,
                    alignItems: 'center',
                    paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10,
                    borderRadius: 8,
                    backgroundColor: r.rank === 1 ? 'rgba(245,158,11,0.06)' : 'transparent',
                    border: r.rank === 1 ? '1px solid rgba(245,158,11,0.20)' : '1px solid rgba(15,23,42,0.04)',
                    minWidth: 0,
                }}
            >
                <RankBadge rank={r.rank} />
                <span style={{
                    minWidth: 0, fontSize: 12.5, fontWeight: 800, color: '#0F172A',
                    lineHeight: 1.35, overflowWrap: 'anywhere', wordBreak: 'keep-all',
                }}>
                    {r.name}
                </span>
                <span style={{ minWidth: 0, fontSize: 10.5, fontWeight: 700, color: '#475569', lineHeight: 1.35 }}>
                    {r.wins}승 {r.losses}패 · {r.pointsFor}-{r.pointsAgainst} · 득실 {formatSigned(r.pointsFor - r.pointsAgainst)}
                </span>
            </li>
        ))}
    </ol>
);

const RankBadge = ({ rank }: { rank: number }) => (
    <span style={{
        width: 22, height: 22, borderRadius: 6,
        backgroundColor: rank === 1 ? '#C79A32' : '#0F172A',
        color: '#FFFFFF',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 900,
        gridRow: 'span 2',
    }}>
        {rank}
    </span>
);

// ── helpers ────────────────────────────────────────────────────────────────

function formatGroup(group: string): string {
    const value = group.trim();
    if (!value) return '';
    return /조$/u.test(value) ? value : `${value}조`;
}

function formatSigned(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}

function formatDateKo(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

const Empty = ({ children }: { children: React.ReactNode }) => (
    <p style={{ margin: '40px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.6 }}>
        {children}
    </p>
);

const card = (opts?: { alignCenter?: boolean }): React.CSSProperties => ({
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    padding: 16,
    ...(opts?.alignCenter
        ? { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }
        : null),
});

const pageStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '100dvh',
    backgroundColor: '#F2F4F7',
    paddingBottom: 'calc(36px + env(safe-area-inset-bottom))',
};

const containerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 430,
    margin: '0 auto',
    paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16,
    display: 'flex', flexDirection: 'column', gap: 12,
    boxSizing: 'border-box',
};
