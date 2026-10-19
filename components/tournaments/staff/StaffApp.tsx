'use client';

// 현장 운영자 휴대폰 화면 (현장 운영 4단계).
//
//   상태: 로그인 전 → (로그인) → 권한 없음 · 요청 → 승인 대기 → 승인(경기판) · 만료 · 회수 · 대회 종료 · 본부 계정
//   ⚠ 권한은 서버가 판정한다. 경기판 조회가 null 을 주거나 조작이 42501 이면 곧바로 내 상태를 다시 읽어 화면을 바꾼다
//     (회수 · 만료는 다음 갱신 — 5초 안 — 에 반영된다).
//   ⚠ 현장 운영자가 하는 일: 예선 · 본선 경기 시작(타이머) · 점수 입력과 완료(본선은 승자 진출까지 서버가 처리).
//     체크인 · 코트 투입 · 호명 · 취소 · 점수 정정 버튼은 없다(서버도 막는다).
//   ⚠ 결과는 서버 응답 뒤 다시 읽어 반영한다. 응답을 잃으면(네트워크) 다시 읽어 실제로 반영됐는지 확인한다.
//   ⚠ 점수창은 기존 Control Center 점수창(ControlScoreDialog)을 그대로 쓴다(점수 규칙 · 입력 방식 동일).

import React from 'react';
import Link from 'next/link';
import { RefreshCw, AlertTriangle, LogIn, Clock3, ShieldCheck, ShieldX, Hourglass } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useVisibilityResync } from '@/hooks/useRealtimeSync';
import {
  fetchMyStaff, fetchStaffBoard, isStaffMissing, requestStaff, staffActionMessage,
  type MyStaffState, type StaffBoard, type StaffMatch,
} from '@/lib/tournaments/staffService';
import {
  doneMatches, nextMatches, playingMatches, staffCanOperate, staffMatchHead, staffScoreConflict, toControlRow,
  type StaffTab,
} from '@/lib/tournaments/staffModel';
import { completeMatch, startHostedMatchTimer } from '@/lib/tournaments/matchAdminService';
import { completeKnockoutMatch } from '@/lib/tournaments/bracketAdminService';
import { clockOffset, formatElapsed, matchTimerState, timeMs } from '@/lib/tournaments/matchTimer';
import MatchElapsedClock from '../MatchElapsedClock';
import ControlScoreDialog from '../control/ControlScoreDialog';
import TestTournamentBanner from '../TestTournamentBanner';

const INK = '#0F172A';
const INK_SOFT = '#334155';
const MUTED = '#64748B';
const FAINT = '#94A3B8';
const LINE = '#E2E8F0';
const TEAL = '#0E8C80';
const TEAL_SOFT = '#E7F3F1';
const NAVY = '#102A3D';
const BLUE = '#2563A8';
const BLUE_SOFT = '#EAF1F8';
const AMBER_INK = '#9A3412';
const LABEL = 'var(--font-rajdhani), sans-serif';

const POLL_MS = 5_000;
const PENDING_POLL_MS = 8_000;
const STALE_MS = 30_000;

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14 };
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, padding: '10px 16px',
  borderRadius: 12, border: `1px solid ${LINE}`, background: '#fff', color: INK_SOFT, fontFamily: 'inherit',
  fontSize: 15, fontWeight: 800, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', whiteSpace: 'nowrap',
};
const pad2 = (n: number) => String(n).padStart(2, '0');
const when = (iso: string | null): string => {
  const t = timeMs(iso);
  if (t === null) return '-';
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const hhmmss = (ms: number | null) => {
  if (ms === null) return '-';
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};
const teamText = (t: StaffMatch['team1']) => [t.player1Name, t.player2Name].filter((x) => x.trim() !== '').join(' · ') || '—';

// ── 공용 틀 ─────────────────────────────────────────────────────────────────

function Shell({ slug, title, children }: { slug: string; title?: string; children: React.ReactNode }) {
  return (
    // ⚠ 폭을 100% 로 고정한다 — 바깥 앱 셸이 가운데 정렬(flex)이라 폭을 주지 않으면 내용(코트 칩 줄)만큼 넓어져 양옆이 잘린다.
    <div data-staff-app style={{ minHeight: '100dvh', background: '#F3F5F8', width: '100%', maxWidth: '100vw', boxSizing: 'border-box' }}>
      <div style={{
        width: '100%', maxWidth: 560, margin: '0 auto', boxSizing: 'border-box', minWidth: 0,
        padding: 'calc(14px + env(safe-area-inset-top, 0px)) 16px calc(28px + env(safe-area-inset-bottom, 0px))',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div>
          <p style={{ margin: 0, fontFamily: LABEL, fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: FAINT }}>
            TEYEON OPEN · FIELD STAFF
          </p>
          <h1 style={{ margin: '2px 0 0', fontSize: 21, fontWeight: 900, color: INK, letterSpacing: '-0.02em', overflowWrap: 'anywhere' }}>
            {title || '현장 운영자'}
          </h1>
        </div>
        <TestTournamentBanner slug={slug} />
        {children}
      </div>
    </div>
  );
}

function StateCard({ icon, title, desc, children, name }: {
  icon: React.ReactNode; title: string; desc?: React.ReactNode; children?: React.ReactNode; name: string;
}) {
  return (
    <section data-staff-state={name} style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <p style={{ margin: 0, fontSize: 17, fontWeight: 900, color: INK }}>{title}</p>
      </div>
      {desc && <div style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: INK_SOFT, lineHeight: 1.7, wordBreak: 'keep-all' }}>{desc}</div>}
      {children}
    </section>
  );
}

// ── 화면 ────────────────────────────────────────────────────────────────────

export default function StaffApp({ slug }: { slug: string }) {
  const { user, isLoading, signInWithKakao } = useAuth();
  if (isLoading) return <Shell slug={slug}><StateCard name="loading" icon={<Hourglass size={18} color={MUTED} />} title="불러오는 중…" /></Shell>;
  if (!user) {
    return (
      <Shell slug={slug}>
        <StateCard name="login" icon={<LogIn size={18} color={NAVY} />} title="카카오로 로그인해 주세요"
          desc={<>대회 본부가 승인한 현장 운영자만 예선 · 본선 경기 시작 · 점수 입력을 할 수 있습니다. 임원진도 같은 방법으로 신청합니다. TEYEON 회원이 아니어도 됩니다.</>}>
          <button type="button" data-staff-action="login" onClick={() => { void signInWithKakao(); }}
            style={{ ...btn, background: '#FEE500', borderColor: '#FEE500', color: '#191600', width: '100%' }}>
            카카오 로그인
          </button>
        </StateCard>
      </Shell>
    );
  }
  return <StaffGate slug={slug} />;
}

function StaffGate({ slug }: { slug: string }) {
  const [me, setMe] = React.useState<MyStaffState | null>(null);
  const [phase, setPhase] = React.useState<'loading' | 'ready' | 'missing' | 'notfound' | 'failed'>('loading');
  const seq = React.useRef(0);

  const loadMe = React.useCallback(async () => {
    const my = ++seq.current;
    try {
      const r = await fetchMyStaff(slug);
      if (my !== seq.current) return;
      setMe(r); setPhase('ready');
    } catch (e) {
      if (my !== seq.current) return;
      const reason = (e as { reason?: string }).reason;
      if (reason === 'tournament_not_found') setPhase('notfound');
      else if (isStaffMissing(e)) setPhase('missing');
      else setPhase((p) => (p === 'ready' ? 'ready' : 'failed'));
    }
  }, [slug]);

  React.useEffect(() => { void loadMe(); }, [loadMe]);
  useVisibilityResync(() => { void loadMe(); }, { enabled: !!slug });
  // 승인 대기 중이면 주기적으로 다시 본다(본부가 승인하면 자동으로 경기판으로 넘어간다).
  React.useEffect(() => {
    if (me?.status !== 'pending') return undefined;
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void loadMe(); }, PENDING_POLL_MS);
    return () => window.clearInterval(t);
  }, [me?.status, loadMe]);

  if (phase === 'loading') return <Shell slug={slug}><StateCard name="loading" icon={<Hourglass size={18} color={MUTED} />} title="불러오는 중…" /></Shell>;
  if (phase === 'notfound') return <Shell slug={slug}><StateCard name="notfound" icon={<ShieldX size={18} color={AMBER_INK} />} title="대회를 찾을 수 없습니다" desc="본부에서 받은 주소가 맞는지 확인해 주세요." /></Shell>;
  if (phase === 'missing') return <Shell slug={slug}><StateCard name="missing" icon={<Clock3 size={18} color={MUTED} />} title="아직 준비 중입니다" desc="현장 운영자 기능이 서버에 적용되지 않았습니다. 본부에 알려 주세요." /></Shell>;
  if (phase === 'failed' || !me) {
    return (
      <Shell slug={slug}>
        <StateCard name="failed" icon={<AlertTriangle size={18} color={AMBER_INK} />} title="연결할 수 없습니다" desc="네트워크 상태를 확인한 뒤 다시 시도해 주세요.">
          <button type="button" data-staff-action="retry-me" onClick={() => { void loadMe(); }} style={btn}>
            <RefreshCw size={15} strokeWidth={2.4} /> 다시 시도
          </button>
        </StateCard>
      </Shell>
    );
  }

  if (me.status === 'approved' || me.status === 'manager') {
    return <StaffBoardView slug={slug} me={me} onLost={() => { void loadMe(); }} />;
  }
  return <Shell slug={slug} title={me.title || undefined}><RequestView slug={slug} me={me} onChanged={loadMe} /></Shell>;
}

// ── 권한 요청 · 대기 · 만료 · 회수 · 종료 ─────────────────────────────────────

function RequestView({ slug, me, onChanged }: { slug: string; me: MyStaffState; onChanged: () => Promise<void> }) {
  const [name, setName] = React.useState(me.displayName ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [checking, setChecking] = React.useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await requestStaff(slug, name.trim()); await onChanged(); }
    catch (e) { setError(staffActionMessage(e)); }
    finally { setBusy(false); }
  };
  const recheck = async () => { setChecking(true); try { await onChanged(); } finally { setChecking(false); } };

  if (me.status === 'closed') {
    return <StateCard name="closed" icon={<ShieldX size={18} color={MUTED} />} title="종료된 대회입니다" desc="대회가 끝나 현장 운영자 권한이 더 이상 유효하지 않습니다. 감사합니다." />;
  }
  if (me.status === 'pending') {
    return (
      <StateCard name="pending" icon={<Hourglass size={18} color={BLUE} />} title="승인 대기 중"
        desc={<>본부에 <b>{me.displayName}</b> 이름으로 요청했습니다. 본부가 승인하면 이 화면이 자동으로 바뀝니다.</>}>
        {me.verifyCode && (
          <div data-staff-verify-code={me.verifyCode} style={{
            border: `1.5px dashed ${BLUE}`, borderRadius: 12, padding: '12px 14px', textAlign: 'center', background: '#F8FAFC',
          }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: MUTED }}>본인 확인 코드</p>
            <p style={{ margin: '4px 0 2px', fontSize: 34, fontWeight: 900, color: INK, letterSpacing: '0.18em', fontVariantNumeric: 'tabular-nums' }}>{me.verifyCode}</p>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: INK_SOFT, wordBreak: 'keep-all' }}>
              본부에 이 화면을 보여 주세요. 본부 화면의 숫자와 같아야 승인됩니다.
            </p>
          </div>
        )}
        <button key="recheck" type="button" data-staff-action="recheck" onClick={() => { void recheck(); }} disabled={checking} style={btn}>
          <RefreshCw size={15} strokeWidth={2.4} /> {checking ? '확인 중…' : '상태 다시 확인'}
        </button>
      </StateCard>
    );
  }
  const head = me.status === 'revoked' ? { t: '권한이 회수되었습니다', d: '본부가 권한을 회수했거나 요청을 거절했습니다. 필요하면 다시 요청할 수 있습니다.', icon: <ShieldX size={18} color={AMBER_INK} /> }
    : me.status === 'expired' ? { t: '권한이 만료되었습니다', d: '승인 기간이 지났습니다. 계속 도와주시려면 다시 요청해 주세요.', icon: <Clock3 size={18} color={AMBER_INK} /> }
    : { t: '현장 운영 권한 요청', d: '본부가 알아볼 수 있도록 이름을 적고 요청해 주세요. 승인되면 예선 · 본선 경기 시작 · 점수 입력을 할 수 있습니다.', icon: <ShieldCheck size={18} color={NAVY} /> };
  return (
    <StateCard name={me.status} icon={head.icon} title={head.t} desc={head.d}>
      <input data-staff-name value={name} onChange={(e) => setName(e.target.value)} maxLength={20}
        placeholder="이름 (예: 홍길동)" aria-label="현장 운영자 이름" autoComplete="name" enterKeyHint="send"
        style={{
          width: '100%', boxSizing: 'border-box', minHeight: 50, padding: '10px 14px', borderRadius: 12,
          border: `1px solid ${LINE}`, fontFamily: 'inherit', fontSize: 16, fontWeight: 700, color: INK, outline: 'none',
        }} />
      <button key="request" type="button" data-staff-action="request" disabled={busy || name.trim() === ''} onClick={() => { void submit(); }}
        style={{ ...btn, width: '100%', background: NAVY, borderColor: NAVY, color: '#fff', opacity: busy || name.trim() === '' ? 0.55 : 1 }}>
        {busy ? '요청 중…' : me.status === 'none' ? '권한 요청' : '다시 요청'}
      </button>
      {error && <p role="alert" data-staff-error="request" style={{ margin: 0, fontSize: 13, fontWeight: 700, color: AMBER_INK }}>{error}</p>}
    </StateCard>
  );
}

// ── 경기판(승인됨) ───────────────────────────────────────────────────────────

const COURT_KEY = (slug: string) => `teyeon-staff-courts:${slug}`;
const readCourts = (slug: string): number[] => {
  try { const v = JSON.parse(localStorage.getItem(COURT_KEY(slug)) || '[]'); return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : []; }
  catch { return []; }
};
const writeCourts = (slug: string, v: number[]) => { try { localStorage.setItem(COURT_KEY(slug), JSON.stringify(v)); } catch { /* 저장 못 해도 동작은 같다 */ } };

function StaffBoardView({ slug, me, onLost }: { slug: string; me: MyStaffState; onLost: () => void }) {
  const [board, setBoard] = React.useState<StaffBoard | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [staleError, setStaleError] = React.useState('');
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const [refreshing, setRefreshing] = React.useState(false);
  const [tab, setTab] = React.useState<StaffTab>('playing');
  const [courts, setCourts] = React.useState<number[]>([]);
  const [busy, setBusy] = React.useState('');
  const [scoreFor, setScoreFor] = React.useState<StaffMatch | null>(null);
  const [toast, setToast] = React.useState('');
  const [cardError, setCardError] = React.useState<Record<string, string>>({});
  const seq = React.useRef(0);
  const failStreak = React.useRef(0);
  const lock = React.useRef('');
  const mounted = React.useRef(true);
  const boardRef = React.useRef<StaffBoard | null>(null);

  React.useEffect(() => { setCourts(readCourts(slug)); }, [slug]);

  const load = React.useCallback(async (manual = false): Promise<StaffBoard | null> => {
    const my = ++seq.current;
    if (manual) setRefreshing(true);
    try {
      const r = await fetchStaffBoard(slug);
      if (!mounted.current || my !== seq.current) return boardRef.current;
      if (!r.ready || !r.board) { onLost(); return null; }        // 권한이 사라졌다(회수 · 만료 · 종료) → 상태 화면으로
      failStreak.current = 0;
      boardRef.current = r.board;
      setBoard(r.board); setFailed(false); setStaleError(''); setUpdatedAt(Date.now()); setNow(Date.now());
      return r.board;
    } catch (e) {
      if (!mounted.current || my !== seq.current) return boardRef.current;
      failStreak.current += 1;
      const code = String((e as { code?: unknown }).code || '');
      if (code === '42501' || code === 'PGRST301') { onLost(); return null; }
      if (!boardRef.current) setFailed(true);
      else setStaleError('연결이 불안정합니다. 화면은 마지막으로 확인된 상태입니다.');
      return boardRef.current;
    } finally {
      if (mounted.current && manual) setRefreshing(false);
    }
  }, [slug, onLost]);

  // 5초마다(보일 때만) · 실패가 이어지면 10 → 20 → 30초. 복귀(visible · focus · online) 때 바로 한 번.
  React.useEffect(() => {
    mounted.current = true;
    let t: number | null = null;
    const loop = () => {
      const delay = failStreak.current === 0 ? POLL_MS : Math.min(30_000, POLL_MS * 2 ** Math.min(failStreak.current, 3));
      t = window.setTimeout(async () => {
        if (document.visibilityState === 'visible' && !lock.current) await load();
        if (mounted.current) loop();
      }, delay);
    };
    void load().then(() => { if (mounted.current) loop(); });
    const clock = window.setInterval(() => { if (document.visibilityState === 'visible') setNow(Date.now()); }, 5_000);
    return () => { mounted.current = false; if (t !== null) window.clearTimeout(t); window.clearInterval(clock); };
  }, [load]);
  useVisibilityResync(() => { if (!lock.current) void load(); }, { enabled: !!slug });

  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast((x) => (x === m ? '' : x)), 2800); };
  const offset = board ? clockOffset(timeMs(board.serverNow), board.receivedAt) : null;
  const courtSet = React.useMemo(() => new Set(courts), [courts]);

  const toggleCourt = (n: number | null) => {
    const next = n === null ? [] : courts.includes(n) ? courts.filter((x) => x !== n) : [...courts, n].sort((a, b) => a - b);
    setCourts(next); writeCourts(slug, next);
  };

  // ── 조작 ──
  const startTimer = async (m: StaffMatch) => {
    if (lock.current) return;
    lock.current = `timer-${m.matchId}`; setBusy(lock.current);
    setCardError((x) => ({ ...x, [m.matchId]: '' }));
    try {
      await startHostedMatchTimer(m.matchId);
      say(`M${m.matchNo} 경기 시작`);
    } catch (e) {
      const code = String((e as { code?: unknown }).code || '');
      if (code === '42501') { lock.current = ''; setBusy(''); onLost(); return; }
      const reason = (e as { reason?: string }).reason;
      if (!reason) {
        // 응답을 잃었을 수 있다 — 다시 읽어 시작이 기록됐는지 본다(시작은 여러 번 눌러도 안전하다).
        lock.current = '';
        const b = await load();
        const x = b?.matches.find((y) => y.matchId === m.matchId);
        if (x && matchTimerState(x).kind === 'running') { say(`M${m.matchNo} 경기 시작(확인됨)`); setBusy(''); return; }
      }
      setCardError((y) => ({ ...y, [m.matchId]: staffActionMessage(e) }));
    } finally {
      lock.current = ''; setBusy('');
      void load();
    }
  };

  const submitScore = async (s1: number, s2: number) => {
    const m = scoreFor;
    if (!m || lock.current) return;
    if (staffScoreConflict(m, boardRef.current)) return;
    lock.current = `score-${m.matchId}`; setBusy(lock.current);
    try {
      if (m.stage === 'knockout') {
        // 본선 — 완료와 승자 진출을 서버가 한 번에 처리한다(다음 경기 생성 · 대진 완료 포함).
        const msg = await completeKnockoutMatch(m.matchId, s1, s2, m.version);
        setScoreFor(null);
        say(`M${m.matchNo} ${s1}:${s2} — ${msg}`);
      } else {
        await completeMatch(m.matchId, s1, s2, m.version);
        setScoreFor(null);
        say(`M${m.matchNo} ${s1}:${s2} 완료`);
      }
    } catch (e) {
      const code = String((e as { code?: unknown }).code || '');
      if (code === '42501') { setScoreFor(null); lock.current = ''; setBusy(''); onLost(); return; }
      const reason = (e as { reason?: string }).reason;
      lock.current = '';
      const b = await load();
      const x = b?.matches.find((y) => y.matchId === m.matchId);
      if (!reason && x && x.status === 'completed' && x.score1 === s1 && x.score2 === s2) {
        setScoreFor(null); say(`M${m.matchNo} ${s1}:${s2} 완료(확인됨)`);
      } else if (x && x.status === 'completed') {
        setScoreFor(null);
        say(`이미 다른 기기에서 완료된 경기입니다${x.score1 !== null ? ` (${x.score1}:${x.score2})` : ''}`);
      } else {
        // 창과 입력값은 그대로 두고 안내만 한다 — 저장 버튼을 막지 않는다(다시 누를 수 있어야 한다).
        say(staffActionMessage(e));
      }
    } finally {
      lock.current = ''; setBusy('');
      void load();
    }
  };

  if (!board) {
    return (
      <Shell slug={slug} title={me.title || undefined}>
        {failed ? (
          <StateCard name="board-failed" icon={<AlertTriangle size={18} color={AMBER_INK} />} title="경기 정보를 불러오지 못했습니다" desc="네트워크 상태를 확인한 뒤 다시 시도해 주세요.">
            <button type="button" data-staff-action="retry-board" onClick={() => { void load(true); }} style={btn}>
              <RefreshCw size={15} strokeWidth={2.4} /> 다시 시도
            </button>
          </StateCard>
        ) : <StateCard name="loading" icon={<Hourglass size={18} color={MUTED} />} title="불러오는 중…" />}
      </Shell>
    );
  }

  const playing = playingMatches(board, courtSet);
  const allPlaying = board.matches.filter((m) => m.status === 'playing').length;
  const next = nextMatches(board);
  const done = doneMatches(board);
  const stale = updatedAt !== null && now - updatedAt > STALE_MS;
  const courtNos = board.courts.filter((c) => c.status === 'active').map((c) => c.courtNo);
  const conflict = scoreFor ? staffScoreConflict(scoreFor, board) : null;
  const scoreLatest = scoreFor ? board.matches.find((m) => m.matchId === scoreFor.matchId) ?? null : null;
  const scoreTimer = scoreLatest && offset !== null ? matchTimerState(scoreLatest) : null;

  return (
    <Shell slug={slug} title={board.title || me.title || undefined}>
      {/* 머리 — 누가 · 언제까지 · 마지막 갱신 */}
      <section data-staff-head style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span data-staff-role={board.role} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999,
            fontSize: 12.5, fontWeight: 900, color: board.role === 'manager' ? NAVY : TEAL,
            background: board.role === 'manager' ? '#E8EEF3' : TEAL_SOFT,
          }}>
            <ShieldCheck size={14} strokeWidth={2.6} />
            {board.role === 'manager' ? '본부 계정' : `현장 운영자${me.displayName ? ` · ${me.displayName}` : ''}`}
          </span>
          {board.role === 'staff' && board.expiresAt && (
            <span data-staff-expiry style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>권한 {when(board.expiresAt)}까지</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>마지막 갱신 {hhmmss(updatedAt)}</span>
          <button type="button" data-staff-action="refresh" onClick={() => { void load(true); }} disabled={refreshing}
            style={{ ...btn, minHeight: 36, padding: '6px 12px', fontSize: 13, marginLeft: 'auto', opacity: refreshing ? 0.55 : 1 }}>
            <RefreshCw size={14} strokeWidth={2.4} /> {refreshing ? '조회 중' : '새로고침'}
          </button>
        </div>
        {board.role === 'manager' && (
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: MUTED, wordBreak: 'keep-all' }}>
            본부 계정은 체크인 · 코트 투입 · 취소 · 정정을 <Link href={`/admin/tournaments/${slug}/control`} style={{ color: TEAL }}>Control Center</Link>에서 합니다.
          </p>
        )}
      </section>

      {(staleError || stale) && (
        <p data-staff-stale style={{ margin: 0, display: 'flex', gap: 6, fontSize: 12.5, fontWeight: 700, color: AMBER_INK, wordBreak: 'keep-all' }}>
          <AlertTriangle size={14} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 2 }} />
          {staleError || `마지막 정상 갱신 ${hhmmss(updatedAt)} — 30초 넘게 새 정보를 받지 못했습니다.`}
        </p>
      )}

      {/* 탭 */}
      <div role="tablist" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, padding: 4, borderRadius: 12, background: '#E6EAF0' }}>
        {([['playing', '진행 중', allPlaying], ['next', '다음 경기', next.length], ['done', '완료', done.length]] as Array<[StaffTab, string, number]>).map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-staff-tab={k} onClick={() => setTab(k)}
            style={{ ...btn, minHeight: 44, border: 'none', borderRadius: 9, fontSize: 14, padding: '6px 4px',
              background: tab === k ? '#fff' : 'transparent', color: tab === k ? INK : MUTED,
              boxShadow: tab === k ? '0 1px 2px rgba(15,23,42,.12)' : 'none' }}>
            {label} <span style={{ color: tab === k ? TEAL : FAINT, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
          </button>
        ))}
      </div>

      {tab === 'playing' && courtNos.length > 0 && (
        <div data-staff-courts style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, WebkitOverflowScrolling: 'touch', minWidth: 0, maxWidth: '100%' }}>
          <button type="button" data-staff-court="all" onClick={() => toggleCourt(null)}
            style={{ ...btn, minHeight: 38, padding: '6px 12px', fontSize: 13, flexShrink: 0,
              background: courts.length === 0 ? NAVY : '#fff', color: courts.length === 0 ? '#fff' : INK_SOFT, borderColor: courts.length === 0 ? NAVY : LINE }}>
            전체 코트
          </button>
          {courtNos.map((n) => {
            const on = courtSet.has(n);
            return (
              <button key={n} type="button" data-staff-court={n} aria-pressed={on} onClick={() => toggleCourt(n)}
                style={{ ...btn, minHeight: 38, minWidth: 46, padding: '6px 10px', fontSize: 13, flexShrink: 0,
                  background: on ? TEAL : '#fff', color: on ? '#fff' : INK_SOFT, borderColor: on ? TEAL : LINE }}>
                {n}번
              </button>
            );
          })}
        </div>
      )}

      {tab === 'playing' && (
        playing.length === 0 ? (
          <StateCard name="empty-playing" icon={<Clock3 size={18} color={MUTED} />}
            title={courts.length > 0 && allPlaying > 0 ? '선택한 코트에 진행 중 경기가 없습니다' : '진행 중인 경기가 없습니다'}
            desc="본부가 코트에 경기를 투입하면 여기에 나타납니다." />
        ) : playing.map((m) => (
          <PlayingCard key={m.matchId} m={m} role={board.role} offset={offset} busy={busy} error={cardError[m.matchId] || ''}
            onStart={() => { void startTimer(m); }}
            onScore={() => setScoreFor(m)} />
        ))
      )}

      {tab === 'next' && (
        <section style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: MUTED, wordBreak: 'keep-all' }}>
            코트 투입 · 호명은 본부가 합니다. 이 목록은 보기 전용입니다.
          </p>
          {next.length === 0 ? <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: INK_SOFT }}>대기 중인 경기가 없습니다.</p>
            : next.map((m) => <ListRow key={m.matchId} m={m} />)}
        </section>
      )}

      {tab === 'done' && (
        <section style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {done.length === 0 ? <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: INK_SOFT }}>아직 완료된 경기가 없습니다.</p>
            : done.map((m) => <ListRow key={m.matchId} m={m} />)}
        </section>
      )}

      {scoreFor && (
        <ControlScoreDialog
          key={scoreFor.matchId}
          match={toControlRow(scoreFor)}
          conflict={conflict}
          busy={busy !== ''}
          onClose={() => { if (!busy) setScoreFor(null); }}
          onSubmit={(a, b) => { void submitScore(a, b); }}
          timer={scoreTimer && offset !== null
            ? scoreTimer.kind === 'running'
              ? <MatchElapsedClock name={`staff-score-${scoreFor.matchNo}`} startMs={scoreTimer.startMs} offsetMs={offset} />
              : scoreTimer.kind === 'not_started' ? '시작 기록 없음' : null
            : null}
        />
      )}

      {toast && (
        <div role="status" data-staff-toast style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
          maxWidth: 'calc(100vw - 32px)', padding: '12px 16px', borderRadius: 12, background: INK, color: '#fff',
          fontSize: 14, fontWeight: 800, zIndex: 130, pointerEvents: 'none', textAlign: 'center', wordBreak: 'keep-all',
        }}>{toast}</div>
      )}
    </Shell>
  );
}

function PlayingCard({ m, role, offset, busy, error, onStart, onScore }: {
  m: StaffMatch; role: StaffBoard['role']; offset: number | null; busy: string; error: string;
  onStart: () => void; onScore: () => void;
}) {
  const t = matchTimerState(m);
  const can = staffCanOperate(m, role);
  const knockout = m.stage === 'knockout';
  const off = busy !== '';
  return (
    <section data-staff-playing={m.matchNo} data-staff-court-no={m.courtNo ?? ''} style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <div style={{ flexShrink: 0, width: 74, background: TEAL, color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '10px 0' }}>
          <span style={{ fontFamily: LABEL, fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', opacity: 0.85 }}>COURT</span>
          <span style={{ fontFamily: LABEL, fontSize: 34, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {m.courtNo === null ? '—' : pad2(m.courtNo)}
          </span>
        </div>
        <div style={{ minWidth: 0, flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: LABEL, fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: FAINT }}>
              {staffMatchHead(m)} · M{m.matchNo}
            </span>
            {knockout && (
              <span data-staff-knockout-badge style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 800, color: BLUE, background: BLUE_SOFT, padding: '2px 7px', borderRadius: 6 }}>
                본선
              </span>
            )}
          </div>
          {[m.team1, m.team2].map((tm) => (
            <div key={tm.teamNo} style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
              <span style={{ fontFamily: LABEL, fontSize: 11.5, fontWeight: 800, color: FAINT, flexShrink: 0, minWidth: 52 }}>TEAM {pad2(tm.teamNo)}</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: INK, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamText(tm)}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${LINE}`, padding: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {offset !== null && t.kind === 'running' && (
          <span data-staff-elapsed={m.matchNo} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Clock3 size={16} strokeWidth={2.4} color={TEAL} />
            <MatchElapsedClock name={`staff-${m.matchNo}`} startMs={t.startMs} offsetMs={offset}
              style={{ fontFamily: LABEL, fontSize: 26, fontWeight: 800, color: TEAL, lineHeight: 1 }} />
          </span>
        )}
        {offset !== null && t.kind === 'not_started' && !can && (
          <span style={{ fontSize: 13, fontWeight: 700, color: MUTED }}>시작 대기</span>
        )}
        {can ? (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', flex: '1 1 auto' }}>
            {offset !== null && t.kind === 'not_started' && (
              <button type="button" data-staff-action={`start-${m.matchNo}`} disabled={off} onClick={onStart}
                style={{ ...btn, flex: '1 1 130px', background: '#fff', color: TEAL, borderColor: TEAL, borderWidth: 2, opacity: off ? 0.55 : 1 }}>
                {busy === `timer-${m.matchId}` ? '시작 중…' : '경기 시작'}
              </button>
            )}
            <button type="button" data-staff-action={`score-${m.matchNo}`} disabled={off} onClick={onScore}
              style={{ ...btn, flex: '1 1 130px', background: NAVY, borderColor: NAVY, color: '#fff', opacity: off ? 0.55 : 1 }}>
              점수 입력
            </button>
          </div>
        ) : (
          <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: MUTED }}>본부에서 처리합니다</span>
        )}
      </div>
      {error && (
        <p role="alert" data-staff-card-error={m.matchNo} style={{ margin: 0, padding: '0 12px 10px', fontSize: 13, fontWeight: 700, color: AMBER_INK, display: 'flex', gap: 5 }}>
          <AlertTriangle size={14} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 2 }} />{error}
        </p>
      )}
    </section>
  );
}

function ListRow({ m }: { m: StaffMatch }) {
  const t = matchTimerState(m);
  const calling = m.status === 'calling';
  const doneRow = m.status === 'completed';
  return (
    <div data-staff-row={m.matchNo} data-staff-row-status={m.status} style={{ padding: '9px 0', borderBottom: `1px solid #EEF2F7`, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {!doneRow && (
          <span style={{ fontFamily: LABEL, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', padding: '2px 7px', borderRadius: 6,
            color: calling ? BLUE : MUTED, background: calling ? BLUE_SOFT : '#F1F5F9' }}>
            {calling ? 'CALLING' : 'WAITING'}
          </span>
        )}
        <span style={{ fontFamily: LABEL, fontSize: 12, fontWeight: 800, color: FAINT }}>{staffMatchHead(m)} · M{m.matchNo}</span>
        {doneRow && (
          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: MUTED }}>
            {t.kind === 'finished' ? `소요 ${formatElapsed(t.durationMs)}` : '소요 기록 없음'}
          </span>
        )}
      </div>
      {[[m.team1, m.score1], [m.team2, m.score2]].map(([tm, sc], i) => {
        const team = tm as StaffMatch['team1']; const score = sc as number | null;
        const win = doneRow && m.score1 !== null && m.score2 !== null && (i === 0 ? m.score1 > m.score2 : m.score2 > m.score1);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
            <span style={{ fontFamily: LABEL, fontSize: 11, fontWeight: 800, color: FAINT, flexShrink: 0, minWidth: 50 }}>TEAM {pad2(team.teamNo)}</span>
            <span style={{ fontSize: 13.5, fontWeight: win ? 900 : 700, color: win ? TEAL : INK, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamText(team)}</span>
            {doneRow && score !== null && <span style={{ fontFamily: LABEL, fontSize: 18, fontWeight: 800, color: win ? TEAL : MUTED }}>{score}</span>}
          </div>
        );
      })}
    </div>
  );
}
