'use client';

// 관리자 LIVE 모니터 — 녹화 ↔ 경기 구간(경기별 다시보기) 관리.
//
//   ⚠ CEO · ADMIN 만 보인다. 최종 판정은 SQL(can_manage_tournaments)이 한다.
//   ⚠ Cloudflare 녹화를 지우거나 바꾸지 않는다. 기존 원본 다시보기 목록(시청자 화면의 REPLAY)도 그대로다.
//   ⚠ 시청자에게는 여기서 '공개 확정'한 구간만 경기별 다시보기로 나간다(DRAW 공개 조건도 SQL 이 적용).
//   ⚠ 자동 계산 구간(auto)과 관리자 보정(adjusted)은 따로 저장된다. '자동값으로'는 보정만 지운다.
//   ⚠ Cloudflare 플레이어는 시작 위치만 지원한다 — 미리보기도 시작 지점부터 재생하고 끝에서 멈추지 않는다.

import React from 'react';
import { Film, RefreshCw, Eye, EyeOff, CheckCircle2, RotateCcw, Save, Play, X, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import LivePlayer from '@/components/tournaments/LivePlayer';
import { formatClock, liveCourtLabel, parseClock } from '@/lib/tournaments/liveMatch';
import {
  adjustLiveClip, clipEffectiveEnd, clipEffectiveStart, fetchLiveClips, groupByRecording, liveClipMessage,
  setLiveClipStatus, syncLiveRecordings,
  type LiveAdminClip, type LiveAdminSave, type LiveClipStatus, type LiveClipsLoad,
  type LiveRecordingGroupRow as Row, type LiveRecordingSummary, type LiveSyncResult,
} from '@/lib/tournaments/liveAdminService';

const INK = '#0F172A';
const INK_SOFT = '#334155';
const MUTED = '#64748B';
const LINE = '#E2E8F0';
const TEAL = '#0E8C80';
const WARN_INK = '#9A3412';

const STATUS_UI: Record<LiveClipStatus, { label: string; c: string; bg: string }> = {
  draft: { label: '미확정(비공개)', c: '#B45309', bg: '#FEF3C7' },
  confirmed: { label: '공개 중', c: '#FFFFFF', bg: TEAL },
  hidden: { label: '숨김', c: MUTED, bg: '#F1F5F9' },
};

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 34, padding: '5px 10px',
  borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: INK_SOFT, fontFamily: 'inherit',
  fontSize: 12, fontWeight: 800, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};
const input: React.CSSProperties = {
  width: 92, minWidth: 0, height: 34, boxSizing: 'border-box', padding: '0 8px', border: `1px solid ${LINE}`, borderRadius: 8,
  fontFamily: 'inherit', fontSize: 16, color: INK, background: '#fff',
};

type Notice = { tone: 'ok' | 'warn' | 'error'; text: string } | null;

const kst = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : iso;
};
const effStart = clipEffectiveStart;
const effEnd = clipEffectiveEnd;

function ClipRow({ row, busy, onSave, previewing, onPreview }: {
  row: Row; busy: boolean; previewing: boolean;
  onSave: (kind: 'adjust' | 'reset' | LiveClipStatus, clip: LiveAdminClip, range?: { s: number; e: number }) => void;
  onPreview: () => void;
}) {
  const { clip, segment } = row;
  const [s, setS] = React.useState(formatClock(effStart(clip)));
  const [e, setE] = React.useState(formatClock(effEnd(clip)));
  React.useEffect(() => { setS(formatClock(effStart(clip))); setE(formatClock(effEnd(clip))); }, [clip]);
  const ui = STATUS_UI[clip.status];
  const m = segment.match;
  const court = m ? liveCourtLabel(m) : null;
  const ps = parseClock(s); const pe = parseClock(e);
  const rangeError = ps === null || pe === null ? 'm:ss 형식으로 입력하세요(예: 12:30).'
    : pe <= ps ? '끝이 시작보다 뒤여야 합니다.'
      : pe > clip.recordingDurationSec ? `녹화 길이(${formatClock(clip.recordingDurationSec)})를 넘을 수 없습니다.` : null;
  const adjusted = clip.adjustedStartSec !== null;

  return (
    <div data-live-clip={clip.id} data-live-clip-status={clip.status} style={{ padding: '10px 11px', border: `1px solid ${LINE}`, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800, color: ui.c, background: ui.bg }}>{ui.label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>{segment.source === 'manual' ? '수동 고정 구간' : '자동(LIVE 코트) 구간'}</span>
        {adjusted && <span data-live-clip-adjusted style={{ fontSize: 11, fontWeight: 800, color: '#B45309' }}>보정됨</span>}
      </div>
      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: TEAL, wordBreak: 'keep-all' }}>
        {m ? `${m.stageLabel}${m.matchNo !== null ? ` · ${m.matchNo}경기` : ''}${court ? ` · ${court}` : ''}` : '경기 정보 없음'}
      </p>
      {m && (
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: INK, lineHeight: 1.5, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
          {m.team1.player1Name} · {m.team1.player2Name} vs {m.team2.player1Name} · {m.team2.player2Name}
        </p>
      )}
      {segment.matchMissing && (
        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: WARN_INK }}>원래 경기가 대진에서 사라졌습니다 — 기록 당시 정보로 표시합니다.</p>
      )}
      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: MUTED }}>
        자동 계산 {formatClock(clip.autoStartSec)} ~ {formatClock(clip.autoEndSec)}
        {adjusted ? ` · 공개 구간 ${formatClock(effStart(clip))} ~ ${formatClock(effEnd(clip))}` : ''}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <input aria-label="구간 시작(분:초)" value={s} onChange={(ev) => setS(ev.target.value)} style={input} inputMode="numeric" />
        <span style={{ color: MUTED, fontWeight: 700 }}>~</span>
        <input aria-label="구간 끝(분:초)" value={e} onChange={(ev) => setE(ev.target.value)} style={input} inputMode="numeric" />
        <button type="button" data-live-clip-action="adjust" style={btn} disabled={busy || !!rangeError}
          onClick={() => ps !== null && pe !== null && onSave('adjust', clip, { s: ps, e: pe })}>
          <Save size={12} strokeWidth={2.4} />보정 저장
        </button>
        <button type="button" data-live-clip-action="reset" style={btn} disabled={busy || !adjusted} onClick={() => onSave('reset', clip)}>
          <RotateCcw size={12} strokeWidth={2.4} />자동값으로
        </button>
      </div>
      {rangeError && <p data-live-clip-range-error style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: WARN_INK }}>{rangeError}</p>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {clip.status !== 'confirmed' && (
          <button type="button" data-live-clip-action="confirm" style={{ ...btn, borderColor: TEAL, color: TEAL }} disabled={busy} onClick={() => onSave('confirmed', clip)}>
            <CheckCircle2 size={12} strokeWidth={2.4} />공개 확정
          </button>
        )}
        {clip.status !== 'draft' && (
          <button type="button" data-live-clip-action="draft" style={btn} disabled={busy} onClick={() => onSave('draft', clip)}>
            <EyeOff size={12} strokeWidth={2.4} />미확정으로
          </button>
        )}
        {clip.status !== 'hidden' && (
          <button type="button" data-live-clip-action="hide" style={btn} disabled={busy} onClick={() => onSave('hidden', clip)}>
            <X size={12} strokeWidth={2.4} />숨김
          </button>
        )}
        <button type="button" data-live-clip-action="preview" style={btn} onClick={onPreview} aria-pressed={previewing}>
          {previewing ? <Eye size={12} strokeWidth={2.4} /> : <Play size={12} strokeWidth={2.4} />}{previewing ? '미리보기 닫기' : '시작 지점 미리보기'}
        </button>
      </div>
    </div>
  );
}

export default function LiveReplayAdminPanel({ slug }: { slug: string }) {
  const { role } = useAuth();
  const allowed = isFullAdminRole(role);
  const [load, setLoad] = React.useState<LiveClipsLoad | null>(null);
  const [recordings, setRecordings] = React.useState<LiveRecordingSummary[]>([]);
  const [lastSync, setLastSync] = React.useState<LiveSyncResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [notice, setNotice] = React.useState<Notice>(null);
  const [preview, setPreview] = React.useState<{ uid: string; startSec: number } | null>(null);
  const [refUrl, setRefUrl] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => { setLoad(await fetchLiveClips(slug)); }, [slug]);

  React.useEffect(() => {
    if (!allowed) return;
    void reload();
    // 미리보기 재생 URL 기준(customer 주소)은 공개 LIVE 응답의 재생 주소에서 얻는다(서버 토큰 없음).
    fetch(`/api/tournaments/${encodeURIComponent(slug)}/live`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { playbackUrl?: string | null; replays?: { playbackUrl?: string }[] }) => setRefUrl(j.playbackUrl ?? j.replays?.[0]?.playbackUrl ?? null))
      .catch(() => {});
  }, [allowed, reload, slug]);

  if (!allowed) return null;

  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    try { await fn(); } finally { busyRef.current = false; setBusy(false); }
  };

  const doSync = () => run(async () => {
    const r = await syncLiveRecordings(slug);
    if (r.kind === 'ok') {
      setRecordings(r.recordings); setLastSync(r.sync);
      const s = r.sync;
      setNotice({ tone: (s.clipsNeedReview ?? 0) > 0 ? 'warn' : 'ok', text:
        `녹화 ${r.recordings.length}개 확인 · 연결 시작 전 녹화 ${s.recordingsBeforeLinking ?? 0}개 제외 · 구간 작성/갱신 ${s.clipsWritten ?? 0}개`
        + ((s.clipsNeedReview ?? 0) > 0 ? ` · 재확인 필요 ${s.clipsNeedReview}개(공개 중이던 구간이 바뀌어 비공개로 돌렸습니다)` : '') });
    } else if (r.kind === 'rejected') setNotice({ tone: 'error', text: liveClipMessage(r.reason) });
    else if (r.kind === 'forbidden') setNotice({ tone: 'error', text: 'CEO · ADMIN 만 녹화를 연결할 수 있습니다.' });
    else setNotice({ tone: 'error', text: '녹화를 불러오지 못했습니다. 잠시 후 다시 시도하세요. 방송에는 영향이 없습니다.' });
    await reload();
  });

  const save = (kind: 'adjust' | 'reset' | LiveClipStatus, clip: LiveAdminClip, range?: { s: number; e: number }) => run(async () => {
    let r: LiveAdminSave;
    if (kind === 'adjust' && range) r = await adjustLiveClip(clip.id, range.s, range.e, clip.version);
    else if (kind === 'reset') r = await adjustLiveClip(clip.id, null, null, clip.version);
    else r = await setLiveClipStatus(clip.id, kind as LiveClipStatus, clip.version);
    if (r.kind === 'ok') {
      setNotice({ tone: 'ok', text: kind === 'adjust' ? '보정 구간을 저장했습니다.' : kind === 'reset' ? '자동 계산값으로 되돌렸습니다.'
        : kind === 'confirmed' ? '공개 확정했습니다 — 시청자 화면 경기별 다시보기에 약 15초 안에 나타납니다.'
          : kind === 'hidden' ? '숨겼습니다(시청자 화면에서 빠짐).' : '미확정으로 돌렸습니다(시청자 화면에서 빠짐).' });
    } else if (r.kind === 'rejected') setNotice({ tone: r.reason === 'stale_version' ? 'warn' : 'error', text: liveClipMessage(r.reason) });
    else if (r.kind === 'forbidden') setNotice({ tone: 'error', text: 'CEO · ADMIN 만 변경할 수 있습니다.' });
    else setNotice({ tone: 'error', text: '저장하지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.' });
    await reload();
  });

  const groups = load?.kind === 'ok' ? groupByRecording(load.segments, recordings) : [];
  const previewUrl = preview && refUrl ? refUrl.replace(/\/[a-f0-9]{32}\/iframe$/, `/${preview.uid}/iframe`) : null;

  return (
    <section data-live-replay-admin={load?.kind ?? 'loading'} aria-label="경기별 다시보기 관리"
      style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 15, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 900, color: INK }}>
          <Film size={15} strokeWidth={2.4} color={TEAL} />경기별 다시보기 관리
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" data-live-replay-action="sync" style={{ ...btn, borderColor: TEAL, color: TEAL }} disabled={busy} onClick={() => void doSync()}>
            <RefreshCw size={12} strokeWidth={2.4} />{busy ? '처리 중...' : 'Cloudflare 녹화 불러와 연결'}
          </button>
        </span>
      </div>
      <p style={{ margin: '7px 0 0', fontSize: 11.5, fontWeight: 600, color: MUTED, lineHeight: 1.65, wordBreak: 'keep-all' }}>
        방송이 끝난 뒤 녹화를 불러오면 그 시간의 중계 경기 구간이 자동으로 연결됩니다. 시청자에게는 &apos;공개 확정&apos;한 구간만 보입니다.
        구간 시작 지점부터 재생되며, 끝 지점에서 자동으로 멈추지는 않습니다. 원본 녹화는 바뀌지 않습니다.
      </p>

      {load === null && <p style={{ margin: '10px 0 0', fontSize: 12, color: MUTED }}>불러오는 중...</p>}
      {load?.kind === 'unavailable' && <p data-live-replay-note="unavailable" style={{ margin: '10px 0 0', fontSize: 12, fontWeight: 600, color: MUTED }}>다시보기 관리 기능을 사용할 수 없습니다(서버 설정 미적용).</p>}
      {load?.kind === 'error' && <p data-live-replay-note="error" style={{ margin: '10px 0 0', fontSize: 12, fontWeight: 700, color: WARN_INK }}>목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.</p>}
      {load?.kind === 'forbidden' && <p data-live-replay-note="forbidden" style={{ margin: '10px 0 0', fontSize: 12, fontWeight: 700, color: WARN_INK }}>CEO · ADMIN 만 사용할 수 있습니다.</p>}

      {notice && (
        <p data-live-replay-notice={notice.tone} role="status" style={{ margin: '10px 0 0', display: 'flex', gap: 6, fontSize: 12, fontWeight: 700, lineHeight: 1.6, wordBreak: 'keep-all', color: notice.tone === 'ok' ? TEAL : WARN_INK }}>
          {notice.tone !== 'ok' && <AlertTriangle size={13} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 3 }} />}{notice.text}
        </p>
      )}

      {load?.kind === 'ok' && groups.length === 0 && (
        <p style={{ margin: '10px 0 0', fontSize: 12.5, fontWeight: 600, color: MUTED }}>
          {lastSync ? '연결된 녹화가 없습니다.' : '아직 연결된 경기 구간이 없습니다. 방송이 끝난 뒤 녹화를 불러오세요.'}
        </p>
      )}

      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {groups.map((g) => (
          <div key={g.uid} data-live-recording={g.uid} style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: INK_SOFT }}>
              녹화 {kst(g.startedAt)} · 길이 {formatClock(g.durationSec)}
              <span style={{ marginLeft: 6, fontWeight: 600, color: MUTED }}>{g.rows.length > 0 ? `경기 구간 ${g.rows.length}개` : '연결된 경기 구간 없음'}</span>
            </p>
            {g.rows.length === 0 && (
              <p data-live-recording-empty style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 600, color: MUTED, lineHeight: 1.6, wordBreak: 'keep-all' }}>
                연결 시작 전 녹화(테스트 녹화 등)이거나, 이 시간에 중계 경기 구간이 없습니다. 자동으로 연결하지 않습니다.
              </p>
            )}
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {g.rows.map((row) => {
                const isPrev = preview?.uid === row.clip.videoUid && preview.startSec === effStart(row.clip);
                return (
                  <React.Fragment key={row.clip.id}>
                    <ClipRow row={row} busy={busy} onSave={save} previewing={isPrev}
                      onPreview={() => setPreview(isPrev ? null : { uid: row.clip.videoUid, startSec: effStart(row.clip) })} />
                    {isPrev && (
                      previewUrl
                        ? <div data-live-clip-preview><LivePlayer playbackUrl={previewUrl} state="ended" note="" replay startSec={effStart(row.clip)} /></div>
                        : <p style={{ margin: 0, fontSize: 12, color: WARN_INK }}>재생 주소를 확인할 수 없어 미리보기를 열 수 없습니다.</p>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
