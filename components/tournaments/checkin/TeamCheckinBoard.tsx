'use client';

// 현장 팀 체크인 화면 (현장 운영 1단계) — 본부(CEO/ADMIN)가 휴대폰으로 쓴다.
//
//   ⚠ 체크인은 팀 단위다. 본부가 두 선수 모두 도착한 것을 직접 확인한 뒤 누른다.
//   ⚠ 결과는 서버 응답(최종 상태)으로만 반영한다 — 누르는 순간 화면을 먼저 바꾸지 않는다.
//   ⚠ 조회가 실패해도 보던 목록을 지우지 않는다(안내 한 줄만). 다른 기기의 체크인은 15초마다 · 복귀 때 반영된다.
//   ⚠ 취소는 한 번 더 확인한다(실수 방지). 체크인/취소는 감사 로그에 남는다(서버).
//   ⚠ 순서 · 조 표시('3조 2번')는 본부 조편성 조회(get_admin_preliminary_draw)를 team_id 로 맞춘 표시 전용이다.
//     조편성을 못 읽으면 기존 순서(팀 번호)로 그리고 안내 한 줄 — 조 번호를 추측하지 않는다.

import React from 'react';
import { Check, RefreshCw, Search, X, AlertTriangle, UserCheck } from 'lucide-react';
import { useVisibilityResync } from '@/hooks/useRealtimeSync';
import {
  fetchTeamCheckins, setTeamCheckin, checkinActionMessage, isCheckinMissing,
} from '@/lib/tournaments/checkinService';
import { fetchPreliminaryDraw } from '@/lib/tournaments/drawAdminService';
import {
  applyCheckinResult, buildCheckinSeats, checkinSummary, matchesFilter, seatText, visibleTeams,
  type CheckinFilter, type CheckinSeat, type CheckinSeatMap, type TeamCheckinBoard as Board, type TeamCheckinRow,
} from '@/lib/tournaments/checkinModel';

const INK = '#0F172A';
const INK_SOFT = '#334155';
const MUTED = '#64748B';
const FAINT = '#94A3B8';
const LINE = '#E2E8F0';
const TEAL = '#0E8C80';
const TEAL_SOFT = '#E7F3F1';
const NAVY = '#102A3D';
const AMBER_INK = '#9A3412';
const AMBER_BG = '#FFF7ED';
const AMBER_BD = '#FDBA74';
const LABEL = 'var(--font-rajdhani), sans-serif';

const POLL_MS = 15_000;
const CONFIRM_MS = 5_000;

const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14,
};
const btnBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  minHeight: 44, padding: '8px 14px', borderRadius: 10, border: `1px solid ${LINE}`,
  background: '#fff', color: INK_SOFT, fontFamily: 'inherit', fontSize: 14, fontWeight: 800,
  cursor: 'pointer', WebkitTapHighlightColor: 'transparent', whiteSpace: 'nowrap',
};

const hhmm = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const hhmmss = (ms: number | null): string => {
  if (ms === null) return '-';
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, '0')).join(':');
};
/** 알림 문구의 팀 이름 — 자리('3조 2번')가 있으면 자리, 없으면 선수 이름. 내부 팀 번호는 쓰지 않는다. */
const teamName = (row: TeamCheckinRow, seat: CheckinSeat | undefined): string =>
  seatText(seat) ?? [row.player1Name, row.player2Name].filter(Boolean).join(' · ');

// ── 데이터 ──────────────────────────────────────────────────────────────────

type LoadState =
  | { kind: 'loading' }
  | { kind: 'denied' }           // 권한 없음 · 대회 없음(RPC null)
  | { kind: 'missing' }          // 서버에 체크인 SQL 미적용
  | { kind: 'failed' }           // 첫 조회 실패
  | { kind: 'ready' };

function useCheckinData(slug: string) {
  const [board, setBoard] = React.useState<Board | null>(null);
  const [state, setState] = React.useState<LoadState>({ kind: 'loading' });
  const [staleError, setStaleError] = React.useState('');
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const seq = React.useRef(0);
  const hasData = React.useRef(false);
  const mounted = React.useRef(true);

  const load = React.useCallback(async (manual = false) => {
    const my = ++seq.current;
    if (manual) setRefreshing(true);
    try {
      const r = await fetchTeamCheckins(slug);
      if (!mounted.current || my !== seq.current) return;
      if (!r.ready || !r.board) {
        if (!hasData.current) setState({ kind: 'denied' });
        else setStaleError('권한을 확인할 수 없습니다. 로그인이 만료되었다면 다시 로그인해 주세요.');
        return;
      }
      hasData.current = true;
      setBoard(r.board);
      setState({ kind: 'ready' });
      setStaleError('');
      setUpdatedAt(Date.now());
    } catch (e) {
      if (!mounted.current || my !== seq.current) return;
      if (!hasData.current) setState({ kind: isCheckinMissing(e) ? 'missing' : 'failed' });
      else setStaleError('최신 체크인 현황을 불러오지 못했습니다. 화면은 마지막으로 확인된 상태입니다.');
    } finally {
      if (mounted.current && manual) setRefreshing(false);
    }
  }, [slug]);

  React.useEffect(() => {
    mounted.current = true;
    void load();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => { mounted.current = false; window.clearInterval(t); };
  }, [load]);
  useVisibilityResync(() => { void load(); }, { enabled: !!slug });

  /** 쓰기 결과 반영 — 진행 중이던 조회 응답은 버린다(쓰기 전 상태로 되돌아가지 않게). */
  const applyResult = React.useCallback((teamId: string, checkedInAt: string | null) => {
    seq.current += 1;
    setBoard((b) => (b ? applyCheckinResult(b, teamId, checkedInAt) : b));
  }, []);

  return { board, state, staleError, updatedAt, refreshing, load, applyResult };
}

/**
 * 조편성 자리(team_id → '3조 2번') — 처음 한 번 · 새로고침 때 읽는다(확정 조편성은 대회 중 바뀌지 않는다).
 *   실패 · 조 없음 = seats null → 화면은 기존 순서 + 안내. 한 번 읽은 자리는 다음 조회가 실패해도 지우지 않는다.
 */
type SeatState = 'loading' | 'ready' | 'unavailable';
function useCheckinSeats(slug: string) {
  const [seats, setSeats] = React.useState<CheckinSeatMap | null>(null);
  const [seatState, setSeatState] = React.useState<SeatState>('loading');
  const seq = React.useRef(0);
  const loadSeats = React.useCallback(async () => {
    const my = ++seq.current;
    try {
      const r = await fetchPreliminaryDraw(slug);
      if (my !== seq.current) return;
      const map = r.ready && r.draw ? buildCheckinSeats(r.draw.groups) : null;
      if (map) { setSeats(map); setSeatState('ready'); } else setSeatState((s) => (s === 'ready' ? s : 'unavailable'));
    } catch {
      if (my === seq.current) setSeatState((s) => (s === 'ready' ? s : 'unavailable'));
    }
  }, [slug]);
  React.useEffect(() => { if (slug) void loadSeats(); }, [slug, loadSeats]);
  return { seats, seatState, loadSeats };
}

// ── 부품 ────────────────────────────────────────────────────────────────────

function Kpi({ board, updatedAt, refreshing, onReload }: {
  board: Board; updatedAt: number | null; refreshing: boolean; onReload: () => void;
}) {
  const s = checkinSummary(board);
  const done = s.total > 0 && s.pending === 0;
  return (
    <section data-checkin-kpi={`${s.checkedIn}/${s.total}`} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontFamily: LABEL, fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', color: FAINT }}>
            CHECKED IN
          </p>
          <p style={{ margin: '2px 0 0', fontFamily: LABEL, fontWeight: 800, color: INK, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ fontSize: 40, color: done ? TEAL : INK }}>{s.checkedIn}</span>
            <span style={{ fontSize: 22, color: FAINT }}> / {s.total}</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
          <span data-checkin-pending={s.pending} style={{
            padding: '5px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 800,
            color: s.pending > 0 ? AMBER_INK : TEAL, background: s.pending > 0 ? AMBER_BG : TEAL_SOFT,
            border: `1px solid ${s.pending > 0 ? AMBER_BD : TEAL}`,
          }}>
            미체크인 {s.pending}
          </span>
          {s.withdrawn > 0 && (
            <span style={{
              padding: '5px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 800,
              color: MUTED, background: '#F1F5F9', border: `1px solid ${LINE}`,
            }}>
              기권 {s.withdrawn}
            </span>
          )}
        </div>
      </div>
      <div aria-hidden style={{ height: 8, borderRadius: 999, background: '#EEF2F7', overflow: 'hidden' }}>
        <div style={{ width: `${s.percent}%`, height: '100%', background: TEAL, transition: 'width .3s' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>
          {done ? '모든 팀이 체크인했습니다.' : `${s.percent}% 완료`} · 마지막 갱신 {hhmmss(updatedAt)}
        </span>
        <button type="button" data-checkin-action="reload" onClick={onReload} disabled={refreshing}
          style={{ ...btnBase, minHeight: 34, padding: '5px 11px', fontSize: 12.5, marginLeft: 'auto', opacity: refreshing ? 0.55 : 1 }}>
          <RefreshCw size={13} strokeWidth={2.4} />
          {refreshing ? '조회 중' : '새로고침'}
        </button>
      </div>
    </section>
  );
}

function FilterTabs({ value, counts, searching, onChange }: {
  value: CheckinFilter; counts: Record<CheckinFilter, number>; searching: boolean;
  onChange: (f: CheckinFilter) => void;
}) {
  const items: Array<[CheckinFilter, string]> = [['pending', '미체크인'], ['done', '체크인'], ['all', '전체']];
  return (
    <div role="tablist" style={{
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, padding: 4,
      borderRadius: 12, background: '#F1F5F9', opacity: searching ? 0.5 : 1,
    }}>
      {items.map(([k, label]) => {
        const on = value === k && !searching;
        return (
          <button key={k} type="button" role="tab" aria-selected={on} data-checkin-filter={k}
            onClick={() => onChange(k)}
            style={{
              ...btnBase, minHeight: 40, border: 'none', borderRadius: 9, fontSize: 13.5,
              background: on ? '#fff' : 'transparent', color: on ? INK : MUTED,
              boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none', padding: '6px 4px',
            }}>
            {label} <span style={{ fontVariantNumeric: 'tabular-nums', color: on ? TEAL : FAINT }}>{counts[k]}</span>
          </button>
        );
      })}
    </div>
  );
}

function TeamCard({ row, seat, busy, confirming, error, onCheckin, onAskCancel, onCancel, onKeep }: {
  row: TeamCheckinRow; seat: CheckinSeat | undefined; busy: boolean; confirming: boolean; error: string;
  onCheckin: () => void; onAskCancel: () => void; onCancel: () => void; onKeep: () => void;
}) {
  const checked = row.checkedInAt !== null;
  const withdrawn = row.status === 'withdrawn';
  const state = withdrawn ? 'withdrawn' : checked ? 'done' : 'pending';
  const player = (name: string, club: string | null) => (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
      <span style={{
        fontSize: 15, fontWeight: 800, color: withdrawn ? FAINT : INK, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textDecoration: withdrawn ? 'line-through' : 'none',
      }}>{name || '—'}</span>
      {club && (
        <span style={{
          fontSize: 12, fontWeight: 600, color: FAINT, minWidth: 0, flexShrink: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{club}</span>
      )}
    </span>
  );

  return (
    <div data-checkin-team={row.teamNo} data-checkin-seat={seatText(seat) ?? ''} data-checkin-state={state} style={{
      ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
      borderColor: checked ? TEAL : LINE, background: checked ? '#F7FBFA' : '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {/* 자리 — '3조' / '2번'. 조편성을 모르면 '조 —'(번호를 추측하지 않는다). 내부 팀 번호는 그리지 않는다. */}
        <div data-checkin-seat-badge style={{
          flexShrink: 0, width: 56, padding: '5px 0', borderRadius: 9, textAlign: 'center',
          background: checked ? TEAL : withdrawn ? '#F1F5F9' : '#F8FAFC',
          border: `1px solid ${checked ? TEAL : LINE}`,
        }}>
          <span style={{
            display: 'block', fontSize: seat && seat.publicNo === null ? 11 : 17, fontWeight: 900, lineHeight: 1.15, letterSpacing: '-0.02em',
            color: checked ? '#fff' : withdrawn ? FAINT : INK, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
          }}>
            {seat ? seat.label : '조 —'}
          </span>
          <span style={{ display: 'block', marginTop: 2, fontSize: 12, fontWeight: 800, lineHeight: 1.1, color: checked ? '#D5F0EC' : MUTED, fontVariantNumeric: 'tabular-nums' }}>
            {seat ? `${seat.order}번` : '-'}
          </span>
        </div>
        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {player(row.player1Name, row.player1ClubName ?? row.clubName)}
          {player(row.player2Name, row.player2ClubName ?? row.clubName)}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 44 }}>
        {withdrawn && (
          <span style={{ fontSize: 12.5, fontWeight: 800, color: MUTED, padding: '4px 9px', borderRadius: 7, background: '#F1F5F9' }}>
            기권
          </span>
        )}
        {checked && (
          <span data-checkin-done-at={hhmm(row.checkedInAt)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13.5, fontWeight: 800, color: TEAL,
          }}>
            <Check size={16} strokeWidth={3} />
            체크인 {hhmm(row.checkedInAt)}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {!checked && !withdrawn && (
            <button type="button" data-checkin-action={`checkin-${row.teamNo}`} disabled={busy} onClick={onCheckin}
              style={{ ...btnBase, minWidth: 128, background: NAVY, borderColor: NAVY, color: '#fff', opacity: busy ? 0.6 : 1 }}>
              <UserCheck size={16} strokeWidth={2.4} />
              {busy ? '처리 중…' : '체크인'}
            </button>
          )}
          {checked && !confirming && (
            <button type="button" data-checkin-action={`cancel-${row.teamNo}`} disabled={busy} onClick={onAskCancel}
              style={{ ...btnBase, minHeight: 40, fontSize: 13, color: MUTED, opacity: busy ? 0.6 : 1 }}>
              {busy ? '처리 중…' : '체크인 취소'}
            </button>
          )}
          {checked && confirming && (
            <>
              <button type="button" data-checkin-action={`cancel-keep-${row.teamNo}`} disabled={busy} onClick={onKeep}
                style={{ ...btnBase, minHeight: 40, fontSize: 13 }}>
                유지
              </button>
              <button type="button" data-checkin-action={`cancel-confirm-${row.teamNo}`} disabled={busy} onClick={onCancel}
                style={{ ...btnBase, minHeight: 40, fontSize: 13, color: '#B91C1C', borderColor: '#FCA5A5', background: '#FEF2F2', opacity: busy ? 0.6 : 1 }}>
                {busy ? '처리 중…' : '취소 확정'}
              </button>
            </>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" data-checkin-error={row.teamNo} style={{
          margin: 0, display: 'flex', gap: 5, alignItems: 'flex-start',
          fontSize: 12.5, fontWeight: 700, color: AMBER_INK, wordBreak: 'keep-all',
        }}>
          <AlertTriangle size={14} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 2 }} />
          {error}
        </p>
      )}
    </div>
  );
}

function Quiet({ title, desc, onRetry }: { title: string; desc?: string; onRetry?: () => void }) {
  return (
    <section style={{ ...card, textAlign: 'center', padding: '26px 16px' }}>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: INK_SOFT }}>{title}</p>
      {desc && <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 600, color: MUTED, wordBreak: 'keep-all' }}>{desc}</p>}
      {onRetry && (
        <button type="button" data-checkin-action="retry" onClick={onRetry} style={{ ...btnBase, margin: '12px auto 0', minHeight: 38 }}>
          <RefreshCw size={13} strokeWidth={2.4} /> 다시 시도
        </button>
      )}
    </section>
  );
}

// ── 화면 ────────────────────────────────────────────────────────────────────

export default function TeamCheckinBoard({ slug }: { slug: string }) {
  const { board, state, staleError, updatedAt, refreshing, load, applyResult } = useCheckinData(slug);
  const { seats, seatState, loadSeats } = useCheckinSeats(slug);
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<CheckinFilter>('pending');
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState('');
  const toastTimer = React.useRef<number | null>(null);
  const confirmTimer = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
  }, []);

  const say = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  };

  const seatsRef = React.useRef(seats);
  seatsRef.current = seats;

  /** 보내는 중인 팀 — 상태(busy)는 다음 렌더에야 반영되므로, 같은 순간의 연타는 이 ref 로 막는다. */
  const inflight = React.useRef<Set<string>>(new Set());

  const write = React.useCallback(async (row: TeamCheckinRow, checked: boolean) => {
    if (inflight.current.has(row.teamId)) return;
    inflight.current.add(row.teamId);
    setBusy((b) => ({ ...b, [row.teamId]: true }));
    setErrors((e) => ({ ...e, [row.teamId]: '' }));
    try {
      const r = await setTeamCheckin(slug, row.teamId, checked);
      applyResult(row.teamId, r.checkedIn ? r.checkedInAt : null);
      setConfirming((c) => (c === row.teamId ? null : c));
      const name = teamName(row, seatsRef.current?.get(row.teamId));
      say(r.checkedIn ? `${name} 체크인 완료` : `${name} 체크인을 취소했습니다`);
    } catch (e) {
      setErrors((x) => ({ ...x, [row.teamId]: checkinActionMessage(e) }));
      // 응답을 잃었을 수 있다 — 서버 상태로 다시 맞춘다(체크인은 같은 값을 다시 보내도 안전하다).
      void load();
    } finally {
      inflight.current.delete(row.teamId);
      setBusy((b) => ({ ...b, [row.teamId]: false }));
    }
  }, [slug, applyResult, load]);

  const askCancel = (teamId: string) => {
    setConfirming(teamId);
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    // 확인을 누르지 않으면 잠시 뒤 원래대로 돌아간다(잘못 눌러 둔 상태가 남지 않게).
    confirmTimer.current = window.setTimeout(() => setConfirming((c) => (c === teamId ? null : c)), CONFIRM_MS);
  };

  if (state.kind === 'loading' && !board) return <Quiet title="불러오는 중…" />;
  if (state.kind === 'denied') {
    return <Quiet title="체크인 현황을 볼 수 없습니다." desc="CEO · ADMIN 계정으로 로그인했는지, 대회 주소가 맞는지 확인해 주세요." />;
  }
  if (state.kind === 'missing') {
    return <Quiet title="체크인 기능이 아직 서버에 적용되지 않았습니다." desc="체크인 SQL 적용 후 다시 열어 주세요. 경기 운영(Control Center)은 그대로 사용할 수 있습니다." />;
  }
  if (state.kind === 'failed' || !board) {
    return <Quiet title="체크인 현황을 불러오지 못했습니다." desc="네트워크 상태를 확인한 뒤 다시 시도해 주세요." onRetry={() => { void load(true); }} />;
  }

  const rows = visibleTeams(board.teams, query, filter, seats);
  const counts: Record<CheckinFilter, number> = {
    pending: board.teams.filter((t) => matchesFilter(t, 'pending')).length,
    done: board.teams.filter((t) => matchesFilter(t, 'done')).length,
    all: board.teams.length,
  };
  const searching = query.trim() !== '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Kpi board={board} updatedAt={updatedAt} refreshing={refreshing} onReload={() => { void load(true); void loadSeats(); }} />

      {seatState === 'unavailable' && (
        <p data-checkin-seat-note style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12.5, fontWeight: 700, color: AMBER_INK, wordBreak: 'keep-all' }}>
          <AlertTriangle size={14} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 2 }} />
          조편성 정보를 불러오지 못해 조 번호 없이 등록 순서로 표시합니다. 체크인은 그대로 할 수 있습니다.
        </p>
      )}

      {staleError && (
        <p data-checkin-stale style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12.5, fontWeight: 700, color: AMBER_INK, wordBreak: 'keep-all' }}>
          <AlertTriangle size={14} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 2 }} />
          {staleError}
        </p>
      )}

      <div style={{ position: 'relative' }}>
        <Search size={17} strokeWidth={2.4} color={FAINT} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input
          type="search" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
          data-checkin-search value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="조 · 선수 · 클럽 검색 (예: 3조)"
          aria-label="조, 선수 이름, 클럽 이름으로 검색"
          style={{
            width: '100%', boxSizing: 'border-box', minHeight: 48, padding: '10px 44px 10px 38px',
            borderRadius: 12, border: `1px solid ${LINE}`, background: '#fff',
            // ⚠ 16px 미만이면 iPhone 이 입력 때 화면을 확대한다.
            fontFamily: 'inherit', fontSize: 16, fontWeight: 600, color: INK, outline: 'none',
            WebkitAppearance: 'none',
          }}
        />
        {searching && (
          <button type="button" data-checkin-action="clear-search" aria-label="검색어 지우기" onClick={() => setQuery('')}
            style={{ ...btnBase, position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', minHeight: 40, width: 40, padding: 0, border: 'none', background: 'transparent' }}>
            <X size={18} strokeWidth={2.4} />
          </button>
        )}
      </div>

      <FilterTabs value={filter} counts={counts} searching={searching} onChange={(f) => { setFilter(f); setQuery(''); }} />

      {searching && (
        <p data-checkin-search-note style={{ margin: 0, fontSize: 12, fontWeight: 700, color: MUTED }}>
          전체 {board.teams.length}팀에서 검색 · {rows.length}팀
        </p>
      )}

      {board.teams.length === 0 ? (
        <Quiet title="등록된 참가팀이 없습니다." desc="팀 관리 화면에서 참가팀을 확정하면 이곳에 표시됩니다." />
      ) : seatState === 'loading' ? (
        // 조편성 순서가 오기 전에 다른 순서로 그렸다가 바뀌지 않게 잠깐 기다린다(실패하면 기존 순서 + 안내).
        <Quiet title="조편성 순서를 불러오는 중…" />
      ) : rows.length === 0 ? (
        <Quiet
          title={searching ? '검색 결과가 없습니다.' : filter === 'pending' ? '미체크인 팀이 없습니다.' : '해당하는 팀이 없습니다.'}
          desc={searching ? '조는 \'3조\' · \'3조 2번\', 이름은 일부만 입력해도 찾습니다.' : filter === 'pending' ? '모든 참가팀이 체크인했습니다.' : undefined}
        />
      ) : (
        <div className="checkin-grid" data-checkin-list={rows.length}>
          {rows.map((r) => (
            <TeamCard key={r.teamId} row={r} seat={seats?.get(r.teamId)}
              busy={!!busy[r.teamId]} confirming={confirming === r.teamId} error={errors[r.teamId] || ''}
              onCheckin={() => { void write(r, true); }}
              onAskCancel={() => askCancel(r.teamId)}
              onCancel={() => { void write(r, false); }}
              onKeep={() => setConfirming(null)} />
          ))}
        </div>
      )}

      <style>{`
        .checkin-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
        @media (min-width: 760px) { .checkin-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (min-width: 1240px) { .checkin-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
      `}</style>

      {toast && (
        <div role="status" data-checkin-toast style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)',
          bottom: 'calc(104px + env(safe-area-inset-bottom, 0px))',
          maxWidth: 'calc(100vw - 32px)', padding: '11px 16px', borderRadius: 10,
          background: INK, color: '#fff', fontSize: 13, fontWeight: 700, zIndex: 130,
          pointerEvents: 'none', textAlign: 'center', wordBreak: 'keep-all',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
