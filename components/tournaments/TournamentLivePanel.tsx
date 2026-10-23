'use client';

// LIVE 패널 — 상태 / 플레이어 / 시청자 수 / 다시보기.
//   공개 테스트 페이지와 Admin 모니터가 이 컴포넌트 하나를 공유한다(표시 항목만 prop 으로 다르다).
//
//   ⚠ 여기서 Cloudflare 를 직접 부르지 않는다. 항상 /api/tournaments/[slug]/live 를 통한다.
//   ⚠ 조회가 실패해도 throw 하지 않는다. 상태만 'unavailable' 로 두고 화면은 계속 살아 있어야 한다.
//   ⚠ 첫 응답 전에는 '확인 중' 이다. 아직 모르는 것을 'UNAVAILABLE · 미연결' 로 단정하지 않는다
//     (첫 조회가 실패했을 때만 실패 안내, 응답이 configured:false 일 때만 미설정 안내).
//   ⚠ 지금 중계 경기 카드는 방송 중(LIVE · 복구 중)에만 보인다. 경기 정보 조회 실패 · '중계 경기 없음' 지정 ·
//     다시보기 재생 중이면 카드만 숨기고 영상 · 상태 · 다시보기는 그대로 둔다.
//   ⚠ 시청자 수는 Provider 실측값이다. 값이 없으면 '—' 로 두고 0 이나 페이지 조회 수로 대체하지 않는다.
//   ⚠ 영상 소스(응답 source): YouTube(기본)면 YouTube 플레이어 + 실시간 채팅 + 경기 정보, Cloudflare(백업)면 기존 화면 그대로.
//     소스가 없거나(이전 응답 · 조회 실패) YouTube 주소가 없으면 Cloudflare 화면이다 — 빈 YouTube 화면을 만들지 않는다.
//     Cloudflare 로 바꾸면 YouTube 채팅은 사라진다. ⚠ 실제 송출 전환은 현장 송출 앱에서 따로 해야 한다.

import React from 'react';
import { RefreshCw, Users, PlayCircle, ArrowLeft } from 'lucide-react';
import { TT, FONT_LABEL } from './tournamentTheme';
import LivePlayer from './LivePlayer';
import LiveMatchCard from './LiveMatchCard';
import YouTubeLiveView from './live/YouTubeLiveView';
import { youtubePlan } from '@/lib/tournaments/liveSourcePlan';
import { formatClock, liveCourtLabel } from '@/lib/tournaments/liveMatch';
import {
  LIVE_POLL_MS,
  LIVE_STATE_LABEL,
  LIVE_STATE_NOTE,
  type LiveMatchReplay,
  type LivePayload,
  type LiveReplay,
  type LiveVideoState,
  type LiveSourceInfo,
  type YouTubeBroadcastStatus,
} from '@/lib/tournaments/liveTypes';

interface Props {
  slug: string;
  /** Admin 모니터에서만 Provider 원문 상태·갱신 시각을 노출한다. */
  showProviderDetail?: boolean;
}

/** 상태 배지 톤. LIVE 만 solid red — 방송 관례를 따른다. */
const TONE: Record<LiveVideoState, { c: string; bg: string; b: string }> = {
  offline:     { c: '#475569', bg: '#F1F5F9', b: '#CBD5E1' },
  connecting:  { c: '#B45309', bg: '#FEF3C7', b: '#FCD34D' },
  live:        { c: '#FFFFFF', bg: '#DC2626', b: '#DC2626' },
  recovering:  { c: '#B45309', bg: '#FEF3C7', b: '#FCD34D' },
  ended:       { c: '#475569', bg: '#F1F5F9', b: '#CBD5E1' },
  error:       { c: '#B91C1C', bg: '#FEE2E2', b: '#FCA5A5' },
  unavailable: { c: '#64748B', bg: '#F8FAFC', b: '#E2E8F0' },
};

const label: React.CSSProperties = {
  margin: 0,
  fontFamily: FONT_LABEL,
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: '0.16em',
  color: TT.subtle,
};

function formatDuration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}분 ${String(s).padStart(2, '0')}초`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** YouTube 상태 배지 — 상태를 모르면(Data API 키 없음) 'YOUTUBE LIVE' 로만 쓴다(방송 중이라고 단정하지 않는다). */
const YT_BADGE: Record<YouTubeBroadcastStatus | 'unknown', { text: string; tone: { c: string; bg: string; b: string }; dot: boolean }> = {
  live:     { text: 'LIVE',        tone: TONE.live,        dot: true },
  upcoming: { text: '방송 전',      tone: TONE.connecting,  dot: false },
  ended:    { text: '방송 종료',    tone: TONE.ended,       dot: false },
  none:     { text: '다시보기',     tone: TONE.ended,       dot: false },
  unknown:  { text: 'YOUTUBE LIVE', tone: TONE.offline,     dot: false },
};

export default function TournamentLivePanel({ slug, showProviderDetail = false }: Props) {
  const [data, setData] = React.useState<LivePayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  /** 마지막 조회가 실패했는지. 응답을 한 번도 못 받았을 때만 화면 문구에 쓰인다(받은 뒤 실패는 직전 상태 유지). */
  const [failed, setFailed] = React.useState(false);
  /** 사용자가 고른 다시보기. null 이면 LIVE 를 본다. startSec 이 있으면 그 위치부터(경기별 다시보기). */
  const [replay, setReplay] = React.useState<(LiveReplay & { startSec?: number; matchKey?: string }) | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/tournaments/${encodeURIComponent(slug)}/live`, { cache: 'no-store' });
      const json = (await res.json()) as LivePayload;
      setData(json);
      setFailed(false);
    } catch {
      // 네트워크 실패 — 직전 상태를 유지한다. 화면을 깨뜨리지 않는다.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  React.useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      // 탭이 백그라운드면 Provider 를 부르지 않는다(불필요한 API 호출 억제).
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void load();
    };
    void load();
    const id = window.setInterval(tick, LIVE_POLL_MS);
    // 탭으로 돌아오면 즉시 한 번 갱신한다.
    document.addEventListener('visibilitychange', tick);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  const state: LiveVideoState = data?.state ?? 'unavailable';
  /** 첫 응답 전 — 아직 아무것도 모른다. */
  const checking = data === null && !failed;
  const tone = checking ? TONE.offline : TONE[state];
  const note = checking
    ? 'LIVE 상태 확인 중...'
    : data === null
      ? 'LIVE 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
      : !data.configured
        ? 'LIVE Provider가 아직 연결되지 않았습니다.'
        : LIVE_STATE_NOTE[state];
  const liveMatch = data?.liveMatch;
  const showMatch = !checking && !replay && (state === 'live' || state === 'recovering')
    && !!liveMatch?.available && liveMatch.mode !== 'none';
  const yt = youtubePlan(data?.source);

  if (yt) {
    const badge = YT_BADGE[yt.status ?? 'unknown'];
    // YouTube 방송 중(또는 상태 모름)이면 경기 정보 — 방송 종료 · 다시보기에서는 숨긴다.
    const ytMatch = yt.autoplay && !!liveMatch?.available && liveMatch.mode !== 'none'
      ? <LiveMatchCard match={liveMatch.match} /> : null;
    return (
      <div data-live-source="youtube" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span data-live-badge={`yt-${yt.status ?? 'unknown'}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999,
            fontFamily: FONT_LABEL, fontSize: 12, fontWeight: 800, letterSpacing: '0.1em',
            color: badge.tone.c, backgroundColor: badge.tone.bg, border: `1px solid ${badge.tone.b}`,
          }}>
            {badge.dot && <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#FFFFFF', flexShrink: 0 }} />}
            {badge.text}
          </span>
          {!yt.autoplay && (
            <span style={{ fontSize: 12.5, fontWeight: 700, color: TT.muted }}>방송이 끝났습니다 · 다시보기를 재생합니다</span>
          )}
        </div>
        <YouTubeLiveView playId={yt.playId} autoplay={yt.autoplay} chatId={yt.chatId} status={yt.status} match={ytMatch} />
        {showProviderDetail && <SourceDetail src={data!.source!} cloudflare={data!} />}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── 상태 ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <span
          data-live-badge={checking ? 'checking' : state}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 11px',
            borderRadius: 999,
            fontFamily: FONT_LABEL,
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.1em',
            color: tone.c,
            backgroundColor: tone.bg,
            border: `1px solid ${tone.b}`,
          }}
        >
          {!checking && state === 'live' && (
            <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#FFFFFF', flexShrink: 0 }} />
          )}
          {checking ? 'CHECKING' : LIVE_STATE_LABEL[state]}
        </span>

        <button
          type="button"
          onClick={() => void load()}
          aria-label="LIVE 상태 새로고침"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            minHeight: 32,
            padding: '6px 10px',
            borderRadius: 8,
            border: `1px solid ${TT.line}`,
            backgroundColor: TT.surface,
            color: TT.muted,
            fontFamily: 'inherit',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <RefreshCw size={12} strokeWidth={2.4} />
          {loading ? '조회 중' : '새로고침'}
        </button>
      </div>

      {/* ── 플레이어 ─────────────────────────────────────────────────────── */}
      <LivePlayer
        playbackUrl={replay ? replay.playbackUrl : (data?.playbackUrl ?? null)}
        state={state}
        note={note}
        replay={!!replay}
        startSec={replay?.startSec ?? null}
      />

      {showMatch && <LiveMatchCard match={liveMatch!.match} />}

      {replay && (
        <button
          type="button"
          onClick={() => setReplay(null)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            width: '100%',
            minHeight: 42,
            borderRadius: 9,
            border: `1px solid ${TT.line}`,
            backgroundColor: TT.surface,
            color: TT.inkSoft,
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <ArrowLeft size={14} strokeWidth={2.4} />
          LIVE 화면으로 돌아가기
        </button>
      )}

      {showProviderDetail && data?.source && <SourceDetail src={data.source} cloudflare={data} />}

      {/* ── 시청자 수 ────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '13px 15px',
          borderRadius: 12,
          backgroundColor: TT.surface,
          border: `1px solid ${TT.line}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Users size={15} strokeWidth={2.2} color={TT.teal} style={{ flexShrink: 0 }} />
          <p style={label}>CURRENT VIEWERS</p>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 900,
            color: data?.viewers === null || data?.viewers === undefined ? TT.subtle : TT.ink,
            lineHeight: 1.2,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {data?.viewers ?? '—'}
        </p>
      </div>
      <p style={{ margin: '-6px 0 0', fontSize: 11.5, fontWeight: 600, color: TT.subtle, lineHeight: 1.6, wordBreak: 'keep-all' }}>
        Cloudflare Stream이 보고한 동시 시청자 수입니다. 페이지 조회 수가 아니며, 약 {LIVE_POLL_MS / 1000}초마다 갱신됩니다.
      </p>

      {/* ── Provider 상세 (Admin 전용) ───────────────────────────────────── */}
      {showProviderDetail && (
        <div
          style={{
            padding: '13px 15px',
            borderRadius: 12,
            backgroundColor: TT.tint,
            border: `1px solid ${TT.line}`,
          }}
        >
          <p style={label}>PROVIDER</p>
          <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              ['Provider', 'Cloudflare Stream'],
              ['Input 상태(원문)', data?.providerStatus ?? '미보고'],
              ['설정', data?.configured ? '연결됨' : '환경변수 미설정'],
              ['갱신', formatTime(data?.fetchedAt ?? null) || '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span style={{ flexShrink: 0, minWidth: 104, fontSize: 11.5, fontWeight: 700, color: TT.subtle }}>{k}</span>
                <span style={{ minWidth: 0, fontSize: 13, fontWeight: 800, color: TT.ink, wordBreak: 'break-all' }}>{v}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 11.5, fontWeight: 600, color: TT.muted, lineHeight: 1.65, wordBreak: 'keep-all' }}>
            bitrate · 해상도 · stream health는 Provider가 이 API로 제공하지 않으므로 표시하지 않습니다.
          </p>
        </div>
      )}

      {/* ── 경기별 다시보기(관리자 확정 구간만) — 기존 원본 다시보기 목록은 아래에 그대로 둔다 ── */}
      {(data?.matchReplays?.length ?? 0) > 0 && (
        <div data-live-match-replays>
          <p style={label}>MATCH REPLAY</p>
          <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data!.matchReplays!.filter((r) => !!r.playbackUrl).map((r: LiveMatchReplay) => {
              const key = `${r.videoUid}:${r.startSec}`;
              const active = replay?.matchKey === key;
              const court = liveCourtLabel(r.match);
              return (
                <button
                  key={key}
                  type="button"
                  data-live-match-replay={key}
                  onClick={() => setReplay({ id: r.videoUid, durationSec: null, createdAt: r.recordedAt, playbackUrl: r.playbackUrl!, startSec: r.startSec, matchKey: key })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '11px 13px', borderRadius: 10,
                    border: `1px solid ${active ? TT.teal : TT.line}`, backgroundColor: active ? TT.tealSoft : TT.surface,
                    color: TT.ink, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <PlayCircle size={17} strokeWidth={2.2} color={TT.teal} style={{ flexShrink: 0 }} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: TT.teal, lineHeight: 1.45, wordBreak: 'keep-all' }}>
                      {r.title ?? `${r.match.stageLabel}${r.match.matchNo !== null ? ` · ${r.match.matchNo}경기` : ''}`}{court ? ` · ${court}` : ''}
                    </span>
                    <span style={{ display: 'block', marginTop: 2, fontSize: 13, fontWeight: 700, lineHeight: 1.5, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
                      {r.match.team1.player1Name} · {r.match.team1.player2Name} vs {r.match.team2.player1Name} · {r.match.team2.player2Name}
                    </span>
                    <span style={{ display: 'block', marginTop: 2, fontSize: 12, fontWeight: 600, color: TT.muted }}>
                      녹화 {formatClock(r.startSec)} ~ {formatClock(r.endSec)} 구간
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {replay?.matchKey && (
            <p style={{ margin: '7px 0 0', fontSize: 11.5, fontWeight: 600, color: TT.subtle, lineHeight: 1.6, wordBreak: 'keep-all' }}>
              경기 시작 지점부터 재생합니다. 경기가 끝나도 녹화는 이어서 재생됩니다.
            </p>
          )}
        </div>
      )}

      {/* ── 다시보기 ─────────────────────────────────────────────────────── */}
      {(data?.replays.length ?? 0) > 0 && (
        <div>
          <p style={label}>REPLAY</p>
          <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data!.replays.map((r) => {
              const active = replay?.id === r.id && !replay?.matchKey;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setReplay(r)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    width: '100%',
                    padding: '11px 13px',
                    borderRadius: 10,
                    border: `1px solid ${active ? TT.teal : TT.line}`,
                    backgroundColor: active ? TT.tealSoft : TT.surface,
                    color: TT.ink,
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <PlayCircle size={17} strokeWidth={2.2} color={TT.teal} style={{ flexShrink: 0 }} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 800, lineHeight: 1.45 }}>
                      {formatTime(r.createdAt) || '다시보기'}
                    </span>
                    {formatDuration(r.durationSec) && (
                      <span style={{ display: 'block', marginTop: 2, fontSize: 12, fontWeight: 600, color: TT.muted }}>
                        {formatDuration(r.durationSec)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** 관리자 모니터 전용 — 지금 시청자 화면의 소스와 설정 출처. */
function SourceDetail({ src, cloudflare }: { src: LiveSourceInfo; cloudflare: LivePayload }) {
  const origin = src.origin === 'db' ? '운영진 설정' : src.origin === 'env' ? '서버 환경변수(비상용)' : '설정 없음(기본값)';
  const rows: Array<[string, string]> = [
    ['시청자 화면 소스', src.source === 'youtube' ? 'YouTube LIVE' : 'Cloudflare Stream(백업)'],
    ['설정 출처', origin],
    ['YouTube 방송 ID', src.youtubeVideoId ?? '없음'],
    ['YouTube 다시보기 ID', src.youtubeReplayVideoId ?? '없음'],
    ['YouTube 방송 상태', src.youtubeStatus === null ? '확인 안 함(API 키 없음)' : YT_BADGE[src.youtubeStatus].text],
    ['Cloudflare 백업', cloudflare.configured ? LIVE_STATE_LABEL[cloudflare.state] : '환경변수 미설정'],
  ];
  return (
    <div data-live-source-detail style={{ padding: '13px 15px', borderRadius: 12, backgroundColor: TT.tint, border: `1px solid ${TT.line}` }}>
      <p style={label}>SOURCE</p>
      <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span style={{ flexShrink: 0, minWidth: 118, fontSize: 11.5, fontWeight: 700, color: TT.subtle }}>{k}</span>
            <span style={{ minWidth: 0, fontSize: 13, fontWeight: 800, color: TT.ink, wordBreak: 'break-all' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
