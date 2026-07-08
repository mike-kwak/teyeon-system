'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { useParams } from 'next/navigation';
import { Trophy, Clock, Play, Hammer, LayoutGrid, Users, Wallet, Copy, Check } from 'lucide-react';
import PublicHeader from '@/components/club/PublicHeader';
import {
    fetchPublicKdkSession,
    type PublicKdkSessionDetail,
    type PublicKdkSessionState,
    type PublicFinalRankingRow,
    type PublicMatchRow,
    type PublicRankingRow,
    type PublicGuestSettlement,
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

    // Guest Pass 복귀 — ?gp=<token> 이 있으면 같은 일정의 Guest Pass 로 돌아가는 버튼 제공.
    //   내부 경로(/guest/pass/<token>)만 복원하며 임의 URL returnTo 는 허용하지 않는다(오픈 리다이렉트 방지).
    //   token 형식이 아니면 무시(기본 /club/kdk 뒤로가기 유지). 잘못된/만료 token 은
    //   Guest Pass 페이지 자체가 안전 안내 화면을 보여준다. URL query 라 새로고침·새 탭에서도 유지.
    const [guestPassToken, setGuestPassToken] = React.useState<string | null>(null);
    React.useEffect(() => {
        try {
            const gp = new URLSearchParams(window.location.search).get('gp') || '';
            setGuestPassToken(/^[A-Za-z0-9_-]{4,128}$/.test(gp) ? gp : null);
        } catch {
            setGuestPassToken(null);
        }
    }, []);
    const guestPassHref = guestPassToken ? `/guest/pass/${encodeURIComponent(guestPassToken)}` : null;

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
            {/* 게스트패스 경유 진입이면 헤더 ← 도 Guest Pass 로 복귀(기존: /club/kdk 목록으로 이탈) */}
            <PublicHeader backHref={guestPassHref || '/club/kdk'} />
            <div style={containerStyle}>
                {/* ── Guest Pass 복귀(상단) — history 와 무관하게 항상 노출되는 명시적 버튼 ── */}
                {guestPassHref && (
                    <a
                        href={guestPassHref}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            minHeight: 44, borderRadius: 12,
                            backgroundColor: 'rgba(15,159,152,0.10)',
                            border: '1px solid rgba(15,159,152,0.30)',
                            color: '#0E7C76', fontSize: 13, fontWeight: 800,
                            textDecoration: 'none', WebkitTapHighlightColor: 'transparent',
                            wordBreak: 'keep-all',
                        }}
                    >
                        ← 게스트패스로 돌아가기
                    </a>
                )}

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

                {/* ── Guest Pass 복귀(하단 보조) — 긴 화면을 끝까지 본 뒤 바로 복귀 ── */}
                {guestPassHref && status !== 'loading' && (
                    <a
                        href={guestPassHref}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            minHeight: 46, borderRadius: 12,
                            backgroundColor: '#0F9F98',
                            color: '#FFFFFF', fontSize: 13, fontWeight: 800,
                            textDecoration: 'none', WebkitTapHighlightColor: 'transparent',
                            boxShadow: '0 3px 10px rgba(15,159,152,0.25)',
                            wordBreak: 'keep-all',
                        }}
                    >
                        경기 안내·정산 정보 확인하기
                    </a>
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

// ── ready: 대진표 (조 → 라운드 → 경기 카드) ─────────────────────────────────
// 공개 DTO 의 group / round / matchNo / court / playerNames / status 만 사용.
// 임의 조 추정·이름 기반 자동 분류 없음. 그룹 없는 경기는 "조 미지정" 으로 노출.

interface BracketItem extends PublicMatchRow {
    _index: number;            // 원본 저장 순서 — 번호 없을 때 정렬 안정성 확보.
    _round: number | null;     // 문자열 라운드도 숫자로 정규화.
    _groupKey: string | null;  // 'A' | 'B' | 그 외 | null(미지정).
}

interface BracketRound { round: number | null; matches: BracketItem[]; }
interface BracketGroup { key: string | null; matches: BracketItem[]; rounds: BracketRound[]; }

const ReadyView = ({ data }: { data: PublicKdkSessionDetail }) => {
    const bracket = data.bracket || [];

    if (bracket.length === 0) {
        return (
            <section style={card()}>
                <SectionTitle icon={<LayoutGrid size={14} strokeWidth={1.8} />}>대진표</SectionTitle>
                <p style={{ margin: 0, textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>
                    아직 등록된 대진이 없습니다.
                </p>
            </section>
        );
    }

    const items: BracketItem[] = bracket.map((m, i) => ({
        ...m,
        _index: i,
        _round: normalizeRound(m.round),
        _groupKey: groupKey(m.group),
    }));

    const groups = groupBracket(items);
    const aCount = items.filter((it) => it._groupKey === 'A').length;
    const bCount = items.filter((it) => it._groupKey === 'B').length;

    const summary = [`총 ${items.length}경기`]
        .concat(aCount > 0 ? [`A조 ${aCount}경기`] : [])
        .concat(bCount > 0 ? [`B조 ${bCount}경기`] : [])
        .join(' · ');

    return (
        <>
            <section style={card()}>
                <SectionTitle icon={<LayoutGrid size={14} strokeWidth={1.8} />}>대진표</SectionTitle>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#475569', letterSpacing: '-0.01em' }}>
                    {summary}
                </p>
            </section>

            {groups.map((g) => (
                <GroupSection key={g.key ?? '__none__'} group={g} />
            ))}
        </>
    );
};

const GroupSection = ({ group }: { group: BracketGroup }) => {
    const accent = groupAccent(group.key);
    return (
        <section style={card()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ width: 6, height: 18, borderRadius: 3, backgroundColor: accent.color, flexShrink: 0 }} />
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em' }}>
                    {accent.label}
                </h3>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: accent.color }}>
                    총 {group.matches.length}경기
                </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {group.rounds.map((r, ri) => (
                    <div key={`round-${ri}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {r.round != null && <RoundHeader round={r.round} />}
                        {r.matches.map((m) => (
                            <BracketCard key={`${m.matchNo ?? 'x'}-${m._index}`} match={m} accent={accent} />
                        ))}
                    </div>
                ))}
            </div>
        </section>
    );
};

const RoundHeader = ({ round }: { round: number }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#64748B', letterSpacing: '0.06em' }}>
            ROUND {round}
        </span>
        <span style={{ flex: 1, height: 1, backgroundColor: 'rgba(15,23,42,0.07)' }} />
    </div>
);

// 경기 카드 — 선수명 영역을 최대로 확보. 번호/라운드/코트/상태는 상단에 가로 배치.
const BracketCard = ({ match, accent }: { match: BracketItem; accent: GroupAccent }) => {
    const { matchNo, _round, court, playerNames, status } = match;
    const names = (playerNames || []).filter((n): n is string => !!n && typeof n === 'string');
    const team1 = names.slice(0, 2).join(' · ');
    const team2 = names.slice(2, 4).join(' · ');
    return (
        <div style={{
            display: 'flex', flexDirection: 'column', gap: 6,
            paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12,
            borderRadius: 10,
            backgroundColor: '#F8FAFC',
            border: '1px solid rgba(15,23,42,0.06)',
            borderLeft: `3px solid ${accent.color}`,
            minWidth: 0,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {matchNo != null && (
                    <span style={{ fontSize: 12.5, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em', flexShrink: 0 }}>
                        #{matchNo}
                    </span>
                )}
                {_round != null && (
                    <span style={{ fontSize: 9.5, fontWeight: 800, color: '#64748B', letterSpacing: '0.05em', flexShrink: 0 }}>
                        ROUND {_round}
                    </span>
                )}
                <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    <MatchStatusBadge status={status} />
                </span>
            </div>
            {court != null && (
                <span style={{ fontSize: 9.5, fontWeight: 800, color: '#94A3B8', letterSpacing: '0.05em' }}>
                    COURT {court}
                </span>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={playerLineStyle}>{team1 || '—'}</span>
                <span style={playerLineStyle}>{team2 || '—'}</span>
            </div>
        </div>
    );
};

const MatchStatusBadge = ({ status }: { status?: string }) => {
    if (!status) return null;
    const label = status === 'playing' ? '진행 중' : status === 'complete' ? '완료' : '대기';
    const tone = status === 'playing'
        ? { bg: 'rgba(239,68,68,0.10)', color: '#B91C1C' }
        : status === 'complete'
            ? { bg: 'rgba(15,159,152,0.10)', color: '#0E7C76' }
            : { bg: 'rgba(100,116,139,0.10)', color: '#475569' };
    return (
        <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
            paddingTop: 2, paddingBottom: 2, paddingLeft: 6, paddingRight: 6,
            borderRadius: 4,
            backgroundColor: tone.bg, color: tone.color,
            whiteSpace: 'nowrap',
        }}>
            {label}
        </span>
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

            <GuestSettlementView data={data} />

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

// ── finished: 게스트 정산 안내 ──────────────────────────────────────────────
// 공식 확정 스냅샷(settlement_data) 기반 게스트 납부액만 표시. 금액은 공개 DTO(양수) 그대로.

const GuestSettlementView = ({ data }: { data: PublicKdkSessionDetail }) => {
    const [copied, setCopied] = React.useState(false);
    const guests = data.guestSettlements;
    const pending = !!data.guestSettlementPending;
    const account = data.account;

    // RPC 미배포/필드 없음 → 섹션 미표시 (기존 동작 보존).
    if (guests === undefined && !pending) return null;

    // 정산 근거 없음 → 안내만, 금액 추정 금지.
    if (pending && (!guests || guests.length === 0)) {
        return (
            <section style={card()}>
                <SectionTitle icon={<Wallet size={14} strokeWidth={1.8} />}>게스트 정산 안내</SectionTitle>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#64748B', lineHeight: 1.6 }}>
                    운영진 정산 확인 중입니다.
                </p>
            </section>
        );
    }

    if (!guests || guests.length === 0) return null; // 게스트 없음 → 섹션 숨김

    const total = data.guestSettlementTotal ?? guests.reduce((sum, g) => sum + g.totalAmount, 0);

    const handleCopyAccount = async () => {
        const text = account?.accountNumber;
        if (!text) return;
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
            /* 복사 실패 — 조용히 무시 */
        }
    };

    return (
        <section style={card()}>
            <SectionTitle icon={<Wallet size={14} strokeWidth={1.8} />}>게스트 정산 안내</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {guests.map((g, i) => (
                    <GuestSettlementCard key={`${g.name}-${i}`} g={g} />
                ))}
            </div>

            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(15,23,42,0.08)',
            }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: '#475569' }}>전체 게스트 납부 합계</span>
                <strong style={{ fontSize: 16, fontWeight: 900, color: '#0F766E', whiteSpace: 'nowrap' }}>
                    {formatWon(total)}
                </strong>
            </div>

            {account?.accountNumber && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(15,23,42,0.06)' }}>
                    <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: '#64748B' }}>
                        {account.bankName}{account.accountHolder ? ` · 예금주 ${account.accountHolder}` : ''}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                            flex: 1, minWidth: 0, fontSize: 13, fontWeight: 900, color: '#0F172A',
                            overflowWrap: 'anywhere', wordBreak: 'keep-all',
                        }}>
                            {account.accountNumber}
                        </span>
                        <button
                            type="button"
                            onClick={handleCopyAccount}
                            style={{
                                flexShrink: 0,
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                height: 32, paddingLeft: 12, paddingRight: 12,
                                borderRadius: 8,
                                backgroundColor: copied ? 'rgba(15,159,152,0.12)' : '#0F9F98',
                                color: copied ? '#0E7C76' : '#FFFFFF',
                                border: copied ? '1px solid rgba(15,159,152,0.30)' : 'none',
                                fontSize: 11.5, fontWeight: 800,
                                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                            }}
                        >
                            {copied ? <Check size={13} strokeWidth={2.4} /> : <Copy size={13} strokeWidth={2.2} />}
                            {copied ? '복사됨' : '계좌번호 복사'}
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
};

const GuestSettlementCard = ({ g }: { g: PublicGuestSettlement }) => {
    const hasPenalty = g.penaltyAmount > 0;
    return (
        <div style={{
            borderRadius: 10,
            backgroundColor: '#F8FAFC',
            border: '1px solid rgba(15,23,42,0.06)',
            paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12,
        }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em' }}>
                {g.name}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <SettlementRow label="게스트비" value={formatWon(g.guestFeeAmount)} />
                <SettlementRow
                    label={`벌금${hasPenalty && g.penaltyLabel ? ` (${g.penaltyLabel})` : ''}`}
                    value={hasPenalty ? formatWon(g.penaltyAmount) : '없음'}
                    valueColor={hasPenalty ? '#B45309' : '#94A3B8'}
                />
                <SettlementRow label="최종 납부액" value={formatWon(g.totalAmount)} emphasize />
            </div>
        </div>
    );
};

const SettlementRow = ({ label, value, valueColor, emphasize }: {
    label: string; value: string; valueColor?: string; emphasize?: boolean;
}) => (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{
            fontSize: emphasize ? 12.5 : 12, fontWeight: emphasize ? 800 : 700,
            color: emphasize ? '#0F172A' : '#64748B',
        }}>
            {label}
        </span>
        <strong style={{
            fontSize: emphasize ? 15 : 12.5,
            fontWeight: emphasize ? 900 : 800,
            color: emphasize ? '#0F766E' : (valueColor || '#0F172A'),
            whiteSpace: 'nowrap',
        }}>
            {value}
        </strong>
    </div>
);

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

// ── ready 대진표 그룹/정렬 helpers ───────────────────────────────────────────

interface GroupAccent { label: string; color: string; }

// A조: blue/teal · B조: mint/cyan · 그 외/미지정: 회색. 과한 네온·그라데이션 배제.
function groupAccent(key: string | null): GroupAccent {
    if (key === 'A') return { label: 'A조', color: '#0E7490' };
    if (key === 'B') return { label: 'B조', color: '#0D9488' };
    if (key === null) return { label: '조 미지정', color: '#64748B' };
    return { label: `${key}조`, color: '#64748B' };
}

// 그룹명 정규화: 'A조' / 'a' / 'A' → 'A'. 값이 없으면 null(미지정).
function groupKey(group: string | null | undefined): string | null {
    if (!group) return null;
    const v = group.trim();
    if (!v) return null;
    const stripped = v.replace(/조$/u, '').trim().toUpperCase();
    return stripped || null;
}

// 'ROUND 1' / '1R' / 'Round 1' / 1 → 1. 숫자를 못 찾으면 null.
function normalizeRound(raw: unknown): number | null {
    if (raw == null) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const m = String(raw).match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
}

// 그룹 등장 순서 보존 → A → B → 그 외(등장순) → 미지정(null) 마지막.
function groupBracket(items: BracketItem[]): BracketGroup[] {
    const order: (string | null)[] = [];
    const map = new Map<string, BracketItem[]>();
    const idOf = (k: string | null) => (k === null ? ' null' : k);
    for (const it of items) {
        const id = idOf(it._groupKey);
        if (!map.has(id)) { map.set(id, []); order.push(it._groupKey); }
        map.get(id)!.push(it);
    }
    const rank = (k: string | null): number => {
        if (k === 'A') return 0;
        if (k === 'B') return 1;
        if (k === null) return Number.MAX_SAFE_INTEGER;
        return 2 + order.indexOf(k);
    };
    const keys = [...order].sort((a, b) => rank(a) - rank(b));
    return keys.map((k) => {
        const matches = [...map.get(idOf(k))!].sort(compareBracket);
        return { key: k, matches, rounds: partitionRounds(matches) };
    });
}

// 라운드 오름차순 → 경기번호 오름차순 → 저장 순서(번호 없을 때). 라운드/번호 없으면 뒤로.
function compareBracket(a: BracketItem, b: BracketItem): number {
    const ra = a._round ?? Infinity;
    const rb = b._round ?? Infinity;
    if (ra !== rb) return ra - rb;
    const ma = a.matchNo ?? Infinity;
    const mb = b.matchNo ?? Infinity;
    if (ma !== mb) return ma - mb;
    return a._index - b._index;
}

// 정렬된 매치를 라운드 단위로 묶는다(라운드 헤더 렌더용).
function partitionRounds(sorted: BracketItem[]): BracketRound[] {
    const rounds: BracketRound[] = [];
    for (const m of sorted) {
        const last = rounds[rounds.length - 1];
        if (last && last.round === m._round) last.matches.push(m);
        else rounds.push({ round: m._round, matches: [m] });
    }
    return rounds;
}

const playerLineStyle: React.CSSProperties = {
    minWidth: 0,
    fontSize: 12.5, fontWeight: 800, color: '#0F172A',
    lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'keep-all',
};

function formatSigned(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}

function formatWon(value: number): string {
    return `${(value || 0).toLocaleString()}원`;
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
