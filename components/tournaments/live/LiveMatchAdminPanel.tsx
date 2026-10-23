'use client';

// LIVE 중계 경기 관리 패널 — 관제 화면 상단 · 관리자 LIVE 모니터가 함께 쓴다.
//
//   ⚠ 기본은 자동(LIVE 지정 코트의 진행 경기). 이 패널은 예외 조작(경기 고정 · 중계 경기 없음 · 자동 복귀)만 한다.
//   ⚠ CEO · ADMIN 만 보인다(현장 운영자 · 일반 회원 · 게스트에게는 아무것도 그리지 않는다).
//     최종 판정은 SQL(can_manage_tournaments)이 한다 — 화면 판정은 보조다.
//   ⚠ 관제 화면의 운영 상태 · 조작과 완전히 분리 — 경기 · 코트 · 점수 RPC 를 부르지 않는다(읽기 조회만).
//   ⚠ 영상 송출과 무관하다. 저장 실패 · 조회 실패도 방송에 영향이 없다.

import React from 'react';
import { Radio, RefreshCw, AlertTriangle, Pin, Ban, RotateCcw, Search, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import { fetchMatchBoard } from '@/lib/tournaments/matchAdminService';
import { fetchAdminBracket } from '@/lib/tournaments/bracketAdminService';
import { knockoutRoundNames } from '@/components/tournaments/control/controlModel';
import { liveCourtLabel } from '@/lib/tournaments/liveMatch';
import {
  buildPinCandidates, fetchLiveAdminState, filterPinCandidates, liveSaveMessage, pinCourtWarning, saveLiveMatch,
  type LiveAdminLoad, type LiveAdminMode, type LivePinCandidate,
} from '@/lib/tournaments/liveAdminService';

const INK = '#0F172A';
const INK_SOFT = '#334155';
const MUTED = '#64748B';
const LINE = '#E2E8F0';
const TEAL = '#0E8C80';
const TEAL_SOFT = '#E7F3F1';
const WARN_BG = '#FFF7ED';
const WARN_LINE = '#FDBA74';
const WARN_INK = '#9A3412';

/** 관리자 상태 갱신 주기 — 다른 관리자의 변경 · 자동 모드 경기 전환을 따라간다. */
const POLL_MS = 20_000;

const MODE_LABEL: Record<LiveAdminMode, string> = { auto: '자동 · LIVE 코트', manual: '수동 고정', none: '중계 경기 없음' };
const STATUS_LABEL: Record<string, string> = { playing: '진행 중', calling: '호명', waiting: '대기' };

const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 12px', minWidth: 0,
};
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 36, padding: '6px 11px',
  borderRadius: 9, border: `1px solid ${LINE}`, background: '#fff', color: INK_SOFT, fontFamily: 'inherit',
  fontSize: 12.5, fontWeight: 800, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};

type Notice = { tone: 'ok' | 'warn' | 'error'; text: string } | null;

function MatchSummary({ m }: { m: NonNullable<Extract<LiveAdminLoad, { kind: 'ok' }>['state']['onAir']> }) {
  const court = liveCourtLabel(m);
  return (
    <span style={{ minWidth: 0, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
      <strong style={{ color: TEAL }}>{m.stageLabel}{m.matchNo !== null ? ` · ${m.matchNo}경기` : ''}</strong>
      {court ? ` · ${court}` : ''} — {m.team1.player1Name} · {m.team1.player2Name} vs {m.team2.player1Name} · {m.team2.player2Name}
    </span>
  );
}

export default function LiveMatchAdminPanel({ slug, defaultOpen = false }: { slug: string; defaultOpen?: boolean }) {
  const { role } = useAuth();
  const allowed = isFullAdminRole(role);

  const [load, setLoad] = React.useState<LiveAdminLoad | null>(null);
  const [open, setOpen] = React.useState(defaultOpen);
  const [picking, setPicking] = React.useState(false);
  const [cands, setCands] = React.useState<LivePinCandidate[] | null>(null);
  const [candsError, setCandsError] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [chosen, setChosen] = React.useState<LivePinCandidate | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [notice, setNotice] = React.useState<Notice>(null);

  const reloadState = React.useCallback(async () => {
    const r = await fetchLiveAdminState(slug);
    setLoad(r);
    return r;
  }, [slug]);

  const reloadCandidates = React.useCallback(async () => {
    setCandsError(false);
    try {
      const [board, bracket] = await Promise.all([fetchMatchBoard(slug), fetchAdminBracket(slug)]);
      if (!board.ready || !board.board) { setCands([]); return; }
      setCands(buildPinCandidates(board.board.matches, knockoutRoundNames(bracket.ready ? bracket.data : null)));
    } catch {
      setCandsError(true);
    }
  }, [slug]);

  React.useEffect(() => {
    if (!allowed) return;
    let alive = true;
    void reloadState();
    const id = window.setInterval(() => {
      if (!alive || busyRef.current || document.visibilityState === 'hidden') return;
      void reloadState();
    }, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [allowed, reloadState]);

  if (!allowed) return null;

  const state = load?.kind === 'ok' ? load.state : null;
  const featureNo = state?.featureCourt?.courtNo ?? null;

  const save = async (mode: LiveAdminMode, matchId: string | null) => {
    if (busyRef.current || !state) return;       // 중복 클릭 방지(같은 틱의 두 번째 클릭도 막는다)
    busyRef.current = true; setBusy(true); setNotice(null);
    try {
      const r = await saveLiveMatch(slug, mode, matchId, state.version);
      if (r.kind === 'ok') {
        setNotice({ tone: 'ok', text: r.changed
          ? `저장했습니다 — ${MODE_LABEL[mode]}. 시청자 화면에는 약 25초 안에 반영됩니다.`
          : '이미 같은 설정입니다.' });
        setPicking(false); setChosen(null); setQuery('');
      } else if (r.kind === 'rejected') {
        setNotice({ tone: r.reason === 'stale_version' ? 'warn' : 'error', text: liveSaveMessage(r.reason) });
        if (r.reason === 'match_not_found' || r.reason === 'match_not_live') { setChosen(null); void reloadCandidates(); }
      } else if (r.kind === 'forbidden') {
        setNotice({ tone: 'error', text: 'CEO · ADMIN 만 변경할 수 있습니다.' });
      } else {
        setNotice({ tone: 'error', text: '저장하지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요. 방송에는 영향이 없습니다.' });
      }
      await reloadState();        // 성공 · 실패 모두 최신 상태로(버전 충돌 시 재조회 포함)
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  const openPicker = () => {
    setPicking(true); setChosen(null); setQuery(''); setNotice(null);
    void reloadCandidates();
  };

  const list = cands ? filterPinCandidates(cands, query) : [];
  const warning = chosen ? pinCourtWarning(chosen, featureNo) : null;

  return (
    <section data-live-admin={state ? state.mode : (load?.kind ?? 'loading')} aria-label="LIVE 중계 경기 관리" style={card}>
      {/* ── 한 줄 요약 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 900, color: INK }}>
          <Radio size={14} strokeWidth={2.6} color="#DC2626" />LIVE 중계 경기
        </span>
        {state && (
          <span data-live-admin-mode={state.mode} style={{
            padding: '2px 8px', borderRadius: 999, fontSize: 11.5, fontWeight: 800,
            color: state.mode === 'auto' ? TEAL : state.mode === 'manual' ? '#B45309' : MUTED,
            background: state.mode === 'auto' ? TEAL_SOFT : state.mode === 'manual' ? '#FEF3C7' : '#F1F5F9',
          }}>
            {MODE_LABEL[state.mode]}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          <button type="button" style={{ ...btn, minHeight: 30, padding: '4px 8px' }} aria-label="LIVE 중계 상태 새로고침"
            disabled={busy} onClick={() => { setNotice(null); void reloadState(); }}>
            <RefreshCw size={12} strokeWidth={2.4} />
          </button>
          {state && (
            <button type="button" data-live-admin-toggle style={{ ...btn, minHeight: 30, padding: '4px 10px' }}
              aria-expanded={open} onClick={() => { setOpen((v) => !v); setPicking(false); setChosen(null); }}>
              {open ? '닫기' : '관리'}
            </button>
          )}
        </span>
      </div>

      {load === null && <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 600, color: MUTED }}>LIVE 중계 상태 확인 중...</p>}
      {load?.kind === 'unavailable' && (
        <p data-live-admin-note="unavailable" style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 600, color: MUTED, lineHeight: 1.6, wordBreak: 'keep-all' }}>
          LIVE 중계 경기 설정을 사용할 수 없습니다(서버 설정 미적용). 방송 · 관제에는 영향이 없습니다.
        </p>
      )}
      {load?.kind === 'error' && (
        <p data-live-admin-note="error" style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 700, color: WARN_INK }}>
          LIVE 중계 상태를 불러오지 못했습니다. 새로고침을 눌러 다시 시도하세요.
        </p>
      )}
      {load?.kind === 'forbidden' && (
        <p data-live-admin-note="forbidden" style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 700, color: WARN_INK }}>
          CEO · ADMIN 만 LIVE 중계 경기를 관리할 수 있습니다.
        </p>
      )}

      {state && (
        <p data-live-admin-onair style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 600, color: INK_SOFT, lineHeight: 1.6 }}>
          {state.mode === 'none'
            ? '시청자 화면에 경기 정보를 표시하지 않습니다.'
            : state.onAir ? <MatchSummary m={state.onAir} /> : '다음 경기 준비 중(표시할 경기 없음)'}
        </p>
      )}

      {/* ── 펼친 관리 영역 ── */}
      {state && open && (
        <div style={{ marginTop: 9, paddingTop: 9, borderTop: `1px solid ${LINE}`, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: MUTED, lineHeight: 1.6, wordBreak: 'keep-all' }}>
            LIVE 지정 코트: <strong style={{ color: INK }}>{state.featureCourt ? (state.featureCourt.courtName ?? `${state.featureCourt.courtNo}번 코트`) : '지정 안 됨'}</strong>
            {' · '}경기 정보 설정은 영상 송출과 별개입니다.
          </p>
          {state.manualMissing && (
            <p data-live-admin-warn="missing" style={{ margin: 0, padding: '8px 10px', borderRadius: 9, background: WARN_BG, border: `1px solid ${WARN_LINE}`, color: WARN_INK, fontSize: 12, fontWeight: 700, lineHeight: 1.6, wordBreak: 'keep-all' }}>
              고정했던 경기가 대진에서 사라졌습니다. 자동 복귀하거나 다른 경기를 고정하세요.
            </p>
          )}
          {state.onAir && !state.onAirPublic && state.mode !== 'none' && (
            <p data-live-admin-warn="private" style={{ margin: 0, fontSize: 12, fontWeight: 700, color: WARN_INK, lineHeight: 1.6, wordBreak: 'keep-all' }}>
              DRAW 비공개 단계의 경기라 시청자 화면에는 선수 이름이 표시되지 않습니다(&apos;다음 경기 준비 중&apos;).
            </p>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" data-live-admin-action="pick" style={{ ...btn, borderColor: '#F59E0B', color: '#B45309' }}
              disabled={busy} onClick={openPicker}>
              <Pin size={13} strokeWidth={2.4} />경기 고정
            </button>
            <button type="button" data-live-admin-action="none" style={btn}
              disabled={busy || state.mode === 'none'} onClick={() => void save('none', null)}
              title="시상식 · 휴식 시간처럼 경기 정보를 띄우지 않을 때">
              <Ban size={13} strokeWidth={2.4} />중계 경기 없음
            </button>
            <button type="button" data-live-admin-action="auto" style={{ ...btn, borderColor: TEAL, color: TEAL }}
              disabled={busy || state.mode === 'auto'} onClick={() => void save('auto', null)}>
              <RotateCcw size={13} strokeWidth={2.4} />자동 복귀
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: MUTED, lineHeight: 1.6, wordBreak: 'keep-all' }}>
            중계 경기 없음 = 시상식 · 휴식 시간용. 자동 복귀 = LIVE 지정 코트에서 진행 중인 경기를 다시 자동 표시.
          </p>

          {/* ── 경기 고정: 기존 대진에서 고른다(대기 · 호명 · 진행 중만) ── */}
          {picking && (
            <div data-live-admin-picker style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, height: 40, padding: '0 6px 0 10px', border: `1px solid ${LINE}`, borderRadius: 9, boxSizing: 'border-box' }}>
                <Search size={14} color={MUTED} style={{ flexShrink: 0 }} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="선수 이름 · 경기 번호"
                  aria-label="고정할 경기 찾기" style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', fontFamily: 'inherit', fontSize: 16, background: 'transparent' }} />
                <button type="button" aria-label="경기 고정 취소" style={{ ...btn, minHeight: 30, padding: '4px 8px', border: 0 }}
                  onClick={() => { setPicking(false); setChosen(null); }}>
                  <X size={14} />
                </button>
              </label>
              {candsError && <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: WARN_INK }}>경기 목록을 불러오지 못했습니다. 다시 열어 주세요.</p>}
              {cands === null && !candsError && <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: MUTED }}>경기 목록 불러오는 중...</p>}
              {cands !== null && list.length === 0 && <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: MUTED }}>고정할 수 있는 경기가 없습니다(대기 · 호명 · 진행 중 경기만).</p>}
              {cands !== null && list.length > 0 && !chosen && (
                <div style={{ maxHeight: 320, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {list.map((c) => (
                    <button key={c.matchId} type="button" data-live-admin-candidate={c.matchNo}
                      onClick={() => setChosen(c)}
                      style={{ ...btn, display: 'block', textAlign: 'left', fontWeight: 600, padding: '8px 10px', minHeight: 44,
                        borderColor: state.onAirMatchId === c.matchId ? TEAL : LINE }}>
                      <span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: INK }}>
                        {c.matchNo}경기 · {c.stageLabel} · {STATUS_LABEL[c.status] ?? c.status}{c.courtNo !== null ? ` · ${c.courtNo}번 코트` : ''}
                      </span>
                      <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: INK_SOFT, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
                        {c.team1} vs {c.team2}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {chosen && (
                <div data-live-admin-confirm style={{ padding: '9px 10px', borderRadius: 9, border: `1px solid ${LINE}`, display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: INK, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
                    {chosen.matchNo}경기 · {chosen.stageLabel} — {chosen.team1} vs {chosen.team2}
                  </p>
                  {warning && (
                    <p data-live-admin-warn="court" style={{ margin: 0, display: 'flex', gap: 6, padding: '7px 9px', borderRadius: 8, background: WARN_BG, border: `1px solid ${WARN_LINE}`, color: WARN_INK, fontSize: 12, fontWeight: 700, lineHeight: 1.55, wordBreak: 'keep-all' }}>
                      <AlertTriangle size={14} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 2 }} />{warning}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" data-live-admin-action="confirm-pin" disabled={busy}
                      style={{ ...btn, background: '#B45309', borderColor: '#B45309', color: '#fff' }}
                      onClick={() => void save('manual', chosen.matchId)}>
                      {busy ? '저장 중...' : warning ? '그래도 고정' : '이 경기로 고정'}
                    </button>
                    <button type="button" style={btn} disabled={busy} onClick={() => setChosen(null)}>다른 경기 고르기</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {notice && (
        <p data-live-admin-notice={notice.tone} role="status" style={{
          margin: '8px 0 0', fontSize: 12, fontWeight: 700, lineHeight: 1.6, wordBreak: 'keep-all',
          color: notice.tone === 'ok' ? TEAL : WARN_INK,
        }}>
          {notice.text}
        </p>
      )}
    </section>
  );
}
