'use client';

// LIVE 영상 소스 · YouTube 방송 주소 설정 — CEO · ADMIN 전용(Admin LIVE 모니터 안).
//
//   · YouTube 방송 주소(watch · youtu.be · live · embed · Studio)를 붙여 넣으면 video ID 를 뽑아 보여 주고 저장한다.
//   · 소스 전환: YouTube(기본) ↔ Cloudflare(백업). 수동 전환만 — 자동 장애 감지 · 자동 전환은 없다.
//   ⚠ 앱의 소스 전환은 '시청자 화면이 어떤 플레이어를 보여 줄지'만 바꾼다. 실제 송출은 현장 송출 앱(DJI Mimo)에서 따로 바꿔야 한다.
//   ⚠ 스트림 키 입력 칸은 없다(비밀 정보는 이 앱에 두지 않는다).
//   ⚠ 저장 결과 · 충돌은 서버 응답으로만 판단한다. 연타는 ref 로 막는다.

import React from 'react';
import { MonitorPlay as Youtube, Cloud, Save, RefreshCw, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import {
  LIVE_SOURCE_REJECT_TEXT, fetchLiveSourceAdmin, saveLiveSource, type LiveSourceAdminState,
} from '@/lib/tournaments/liveSourceAdminService';
import { YOUTUBE_PARSE_MESSAGE, parseYouTubeVideoId, youtubeWatchUrl } from '@/lib/tournaments/youtube';
import type { LiveSourceKind } from '@/lib/tournaments/liveTypes';

const INK = '#0F172A'; const MUTED = '#64748B'; const FAINT = '#94A3B8'; const LINE = '#E2E8F0';
const TEAL = '#0E8C80'; const NAVY = '#102A3D'; const AMBER = '#9A3412'; const AMBER_BG = '#FFF7ED'; const AMBER_BD = '#FDBA74';

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: 46, padding: '10px 12px', borderRadius: 10, border: `1px solid ${LINE}`,
  fontFamily: 'inherit', fontSize: 16, fontWeight: 600, color: INK, outline: 'none', background: '#fff',
};
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '9px 14px',
  borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', color: INK, fontFamily: 'inherit', fontSize: 13.5,
  fontWeight: 800, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};

type Parsed = { id: string | null; error: string | null };
const parseField = (v: string, required: boolean): Parsed => {
  if (v.trim() === '') return { id: null, error: required ? YOUTUBE_PARSE_MESSAGE.empty : null };
  const r = parseYouTubeVideoId(v);
  return r.ok ? { id: r.videoId, error: null } : { id: null, error: YOUTUBE_PARSE_MESSAGE[r.reason] };
};

export default function LiveSourceAdminPanel({ slug }: { slug: string }) {
  const [load, setLoad] = React.useState<'loading' | 'ok' | 'forbidden' | 'unavailable' | 'error'>('loading');
  const [state, setState] = React.useState<LiveSourceAdminState | null>(null);
  const [liveUrl, setLiveUrl] = React.useState('');
  const [replayUrl, setReplayUrl] = React.useState('');
  const [source, setSource] = React.useState<LiveSourceKind>('youtube');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const busyRef = React.useRef(false);

  const reload = React.useCallback(async () => {
    const r = await fetchLiveSourceAdmin(slug);
    setLoad(r.kind);
    if (r.kind === 'ok') {
      setState(r.state);
      setSource(r.state.source);
      setLiveUrl(r.state.youtubeVideoId ? youtubeWatchUrl(r.state.youtubeVideoId) : '');
      setReplayUrl(r.state.youtubeReplayVideoId ? youtubeWatchUrl(r.state.youtubeReplayVideoId) : '');
    }
  }, [slug]);
  React.useEffect(() => { void reload(); }, [reload]);

  const live = parseField(liveUrl, false);
  const replay = parseField(replayUrl, false);
  const needsYoutube = source === 'youtube' && !live.id && !replay.id;
  const dirty = !!state && (state.source !== source || state.youtubeVideoId !== live.id || state.youtubeReplayVideoId !== replay.id);
  const canSave = load === 'ok' && !!state && !busy && dirty && !live.error && !replay.error && !needsYoutube;

  const save = async () => {
    if (!state || busyRef.current) return;
    busyRef.current = true; setBusy(true); setMsg(null);
    try {
      const r = await saveLiveSource(slug, { source, youtubeVideoId: live.id, youtubeReplayVideoId: replay.id, expectedVersion: state.version });
      // ⚠ 서버 값을 다시 불러온 '뒤'에 안내한다 — 불러오는 동안 입력 · 선택이 잠겨 있어, 운영자가 그 사이 고른 값이 덮이지 않는다.
      if (r.kind === 'ok') {
        await reload();
        setMsg({ tone: 'ok', text: r.changed ? '저장했습니다. 시청자 화면에는 약 30초 안에 반영됩니다.' : '바뀐 내용이 없습니다.' });
      } else if (r.kind === 'rejected') {
        if (r.reason === 'stale_version') await reload();
        setMsg({ tone: 'warn', text: LIVE_SOURCE_REJECT_TEXT[r.reason] ?? `저장하지 못했습니다(${r.reason}).` });
      } else if (r.kind === 'forbidden') {
        setMsg({ tone: 'warn', text: 'CEO · ADMIN 권한이 필요합니다. 로그인이 만료되었다면 다시 로그인해 주세요.' });
      } else if (r.kind === 'unavailable') {
        setLoad('unavailable');
      } else {
        setMsg({ tone: 'warn', text: '저장하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.' });
      }
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  const sourceBtn = (k: LiveSourceKind, label: string, sub: string, Icon: typeof Youtube) => {
    const on = source === k;
    return (
      <button type="button" role="radio" aria-checked={on} data-live-source-option={k} disabled={busy} onClick={() => setSource(k)}
        style={{ ...btn, flex: '1 1 160px', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '10px 12px',
          borderColor: on ? TEAL : LINE, background: on ? '#E7F3F1' : '#fff', textAlign: 'left' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: on ? TEAL : INK }}>
          <Icon size={16} strokeWidth={2.3} />{label}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: MUTED }}>{sub}</span>
      </button>
    );
  };

  return (
    <section data-live-source-admin={load} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 15, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Youtube size={17} strokeWidth={2.3} color="#DC2626" />
        <p style={{ margin: 0, fontSize: 15, fontWeight: 900, color: INK }}>영상 소스 · YouTube 방송 주소</p>
        <button type="button" disabled={busy} onClick={() => void reload()} aria-label="다시 불러오기" style={{ ...btn, minHeight: 32, padding: '4px 9px', marginLeft: 'auto', fontSize: 12 }}>
          <RefreshCw size={12} strokeWidth={2.4} />새로고침
        </button>
      </div>

      {load === 'loading' && <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: MUTED }}>불러오는 중…</p>}
      {load === 'forbidden' && <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: AMBER }}>CEO · ADMIN 만 설정할 수 있습니다.</p>}
      {load === 'error' && <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: AMBER }}>설정을 불러오지 못했습니다. [새로고침]을 눌러 주세요.</p>}
      {load === 'unavailable' && (
        <div data-live-source-sql-missing style={{ padding: '11px 13px', borderRadius: 10, background: AMBER_BG, border: `1px solid ${AMBER_BD}` }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: AMBER, lineHeight: 1.6, wordBreak: 'keep-all' }}>
            방송 주소 저장 기능(SQL)이 아직 서버에 적용되지 않았습니다.
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 600, color: AMBER, lineHeight: 1.6, wordBreak: 'keep-all' }}>
            지금 시청자 화면은 배포 환경변수(TEYEON_YOUTUBE_LIVE_URL) 값을 씁니다. 아래 [SOURCE] 칸에서 현재 값을 확인하세요.
          </p>
        </div>
      )}

      {load === 'ok' && state && (
        <>
          <div data-live-source-current style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12.5, fontWeight: 700, color: MUTED }}>
            <span>현재 소스 <b style={{ color: INK }}>{state.source === 'youtube' ? 'YouTube' : 'Cloudflare(백업)'}</b></span>
            <span>방송 ID <b style={{ color: INK }}>{state.youtubeVideoId ?? '없음'}</b></span>
            {state.youtubeVideoId && (
              <a href={youtubeWatchUrl(state.youtubeVideoId)} target="_blank" rel="noopener noreferrer" style={{ color: TEAL, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                YouTube에서 확인<ExternalLink size={12} />
              </a>
            )}
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>YouTube 방송 주소</span>
            <input data-live-source-input="live" disabled={busy} value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} style={input}
              placeholder="https://youtube.com/live/… 또는 https://youtu.be/…" autoComplete="off" autoCorrect="off" spellCheck={false} />
            <span data-live-source-parse="live" style={{ fontSize: 12, fontWeight: 700, color: live.error ? AMBER : live.id ? TEAL : FAINT }}>
              {live.error ?? (live.id ? `영상 ID ${live.id}` : '방송마다 주소가 바뀌면 새 주소를 붙여 넣고 저장하세요.')}
            </span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>다시보기 주소 <span style={{ color: FAINT, fontWeight: 700 }}>(선택)</span></span>
            <input data-live-source-input="replay" disabled={busy} value={replayUrl} onChange={(e) => setReplayUrl(e.target.value)} style={input}
              placeholder="비워 두면 방송 종료 후 같은 방송 주소로 다시보기" autoComplete="off" autoCorrect="off" spellCheck={false} />
            <span data-live-source-parse="replay" style={{ fontSize: 12, fontWeight: 700, color: replay.error ? AMBER : replay.id ? TEAL : FAINT }}>
              {replay.error ?? (replay.id ? `영상 ID ${replay.id}` : '테스트 방송 주소는 넣지 마세요(공식 다시보기에만 사용).')}
            </span>
          </label>

          <div role="radiogroup" aria-label="시청자 화면 영상 소스" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {sourceBtn('youtube', 'YouTube', '기본 · 영상 + 실시간 채팅', Youtube)}
            {sourceBtn('cloudflare', 'Cloudflare', '백업 · 채팅 없음', Cloud)}
          </div>

          {state.source !== source && (
            <p data-live-source-warning style={{ margin: 0, display: 'flex', gap: 6, padding: '10px 12px', borderRadius: 10, background: AMBER_BG, border: `1px solid ${AMBER_BD}`, fontSize: 12.5, fontWeight: 700, color: AMBER, lineHeight: 1.6, wordBreak: 'keep-all' }}>
              <AlertTriangle size={15} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 2 }} />
              앱의 시청자 화면만 바뀝니다. 실제 영상이 나오려면 DJI Mimo 송출 대상도 {source === 'cloudflare' ? 'Cloudflare RTMPS' : 'YouTube'}로 직접 바꿔야 합니다.
            </p>
          )}
          {needsYoutube && (
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: AMBER }}>YouTube 로 보려면 방송 주소 또는 다시보기 주소가 필요합니다.</p>
          )}

          <button type="button" data-live-source-save disabled={!canSave} onClick={() => void save()}
            style={{ ...btn, background: canSave ? NAVY : '#F1F5F9', borderColor: canSave ? NAVY : LINE, color: canSave ? '#fff' : FAINT, cursor: canSave ? 'pointer' : 'default' }}>
            <Save size={15} strokeWidth={2.4} />{busy ? '저장 중…' : '저장'}
          </button>
        </>
      )}

      {msg && (
        <p role="status" data-live-source-msg={msg.tone} style={{ margin: 0, display: 'flex', gap: 6, fontSize: 12.5, fontWeight: 700, color: msg.tone === 'ok' ? TEAL : AMBER, lineHeight: 1.6, wordBreak: 'keep-all' }}>
          {msg.tone === 'ok' ? <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 2 }} /> : <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />}
          {msg.text}
        </p>
      )}
    </section>
  );
}
