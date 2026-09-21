'use client';

// 예선 경기 운영 보드 (Batch 3C-1) — 경기 엔진 QA / 현장 운영 검증용.
//
//   ⚠ 최종 Control Center 디자인이 아니다. 상태가 분명하고 실수하기 어려운 것을 우선한다.
//   ⚠ 표시 데이터는 hosted_tournament_teams 스냅샷뿐이다(접수 PII 미표시).
//   ⚠ Realtime 없음. 모든 write 성공 후 authoritative full refetch.
//   ⚠ 기권·노쇼는 별도 상태가 아니라 6:0 경기 완료로 처리한다.
//   ⚠ stale(조편성 변경) 상태에서 서버는 어떤 동작도 막지 않는다.
//     그래서 여기서도 임의로 차단하지 않고 경고만 띄운다(정책을 UI 가 만들지 않는다).
//
//   Batch 3C-2 추가
//     · 취소 복구 — CANCELLED → WAITING 하나의 전이만. 서버가 최종 판정한다.
//     · 결과 수정으로 합산연령 순위 확정이 무효화되면 운영진에게 알린다.
//       ⚠ 순위를 여기서 계산하지 않는다. 서버가 알려준 건수를 전달할 뿐이다.

import React from 'react';
import Link from 'next/link';
import {
  RefreshCw, Search, AlertTriangle, Play, Check, X as XIcon, Megaphone,
  Pencil, Ban, Trophy, Info, RotateCcw, ListOrdered,
} from 'lucide-react';
import {
  fetchMatchBoard, generateMatches, callMatch, uncallMatch, startMatch,
  completeMatch, amendMatchScore, cancelMatch, restoreCancelledMatch, matchActionMessage,
} from '@/lib/tournaments/matchAdminService';
import {
  MATCH_STATUS_LABEL, isValidSetScore, matchCourtLabel, matchGroupLabel, matchTeamName,
  type MatchBoard, type MatchStatus, type TournamentMatch,
} from '@/lib/tournaments/matchTypes';

// ── 스타일 (기존 Admin 톤 재사용) ────────────────────────────────────────────
const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 15, marginBottom: 10,
};
const label: React.CSSProperties = {
  margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#94A3B8',
};
const btn = (tone: 'primary' | 'plain' | 'danger' | 'ghost' = 'plain'): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  minHeight: 38, padding: '8px 13px', borderRadius: 9,
  border: `1px solid ${tone === 'primary' ? '#0E8C80' : tone === 'danger' ? '#FCA5A5' : '#E2E8F0'}`,
  background: tone === 'primary' ? '#0E8C80' : tone === 'ghost' ? 'transparent' : '#fff',
  color: tone === 'primary' ? '#fff' : tone === 'danger' ? '#B91C1C' : '#475569',
  fontFamily: 'inherit', fontSize: 13, fontWeight: 800, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent', whiteSpace: 'nowrap',
});
const input: React.CSSProperties = {
  minWidth: 0, width: '100%', boxSizing: 'border-box', minHeight: 38, padding: '8px 11px',
  borderRadius: 9, border: '1px solid #E2E8F0', background: '#fff',
  fontFamily: 'inherit', fontSize: 14, color: '#0F172A',
};

const STATUS_TONE: Record<MatchStatus, { c: string; bg: string; b: string }> = {
  waiting:   { c: '#475569', bg: '#F1F5F9', b: '#CBD5E1' },
  calling:   { c: '#B45309', bg: '#FEF3C7', b: '#FCD34D' },
  playing:   { c: '#FFFFFF', bg: '#DC2626', b: '#DC2626' },
  completed: { c: '#FFFFFF', bg: '#047857', b: '#047857' },
  cancelled: { c: '#64748B', bg: '#F8FAFC', b: '#E2E8F0' },
};

type FilterKey = 'all' | MatchStatus;
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'waiting', label: '대기' },
  { key: 'calling', label: '호명' },
  { key: 'playing', label: '진행 중' },
  { key: 'completed', label: '완료' },
  { key: 'cancelled', label: '취소' },
];

/** 열려 있는 다이얼로그. */
type Dialog =
  | { kind: 'start'; m: TournamentMatch }
  | { kind: 'complete'; m: TournamentMatch }
  | { kind: 'amend'; m: TournamentMatch }
  | { kind: 'cancel'; m: TournamentMatch }
  | { kind: 'restore'; m: TournamentMatch }
  | null;

/** 6게임 규칙 빠른 선택(오입력 방지). 기권승도 여기 6:0 을 쓴다. */
const QUICK: [number, number][] = [
  [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
];

export default function MatchOpsBoard({ slug }: { slug: string }) {
  const [board, setBoard] = React.useState<MatchBoard | null>(null);
  const [ready, setReady] = React.useState(true);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState('');
  const [toast, setToast] = React.useState('');
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [q, setQ] = React.useState('');
  const [dlg, setDlg] = React.useState<Dialog>(null);
  const [s1, setS1] = React.useState('');
  const [s2, setS2] = React.useState('');
  const [reason, setReason] = React.useState('');
  // 결과 수정으로 동률 확정이 무효화됐을 때의 안내. 토스트는 사라지므로 따로 띄운다.
  const [tieNotice, setTieNotice] = React.useState('');

  const say = React.useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(''), 3800);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchMatchBoard(slug);
      setReady(r.ready);
      setBoard(r.board);
    } catch (err) {
      setReady(false);
      say(matchActionMessage(err));
    } finally {
      setLoading(false);
    }
  }, [slug, say]);

  React.useEffect(() => { void load(); }, [load]);

  /** write 공통 — 중복 클릭 방지 + 성공 후 authoritative full refetch. */
  const run = async (key: string, fn: () => Promise<string>) => {
    if (busy) return;
    setBusy(key);
    try {
      const msg = await fn();
      setDlg(null);
      await load();
      say(msg);
    } catch (err) {
      const rsn = (err as { reason?: string }).reason;
      if (rsn === 'version_conflict' || rsn === 'already_changed') {
        say(rsn === 'version_conflict'
          ? '다른 운영자가 먼저 변경했습니다. 최신 상태를 다시 불러왔습니다.'
          : '경기 상태가 이미 바뀌었습니다. 최신 상태를 다시 불러왔습니다.');
        setDlg(null);
        await load();
      } else {
        say(matchActionMessage(err));
      }
    } finally {
      setBusy('');
    }
  };

  const closeDlg = () => { setDlg(null); setS1(''); setS2(''); setReason(''); };

  const counts = React.useMemo(() => {
    const c: Record<string, number> = {
      all: 0, waiting: 0, calling: 0, playing: 0, completed: 0, cancelled: 0,
    };
    (board?.matches ?? []).forEach((m) => { c.all += 1; c[m.status] += 1; });
    return c;
  }, [board]);

  const filtered = React.useMemo(() => {
    const list = board?.matches ?? [];
    const k = q.trim().toLowerCase();
    return list.filter((m) => {
      if (filter !== 'all' && m.status !== filter) return false;
      if (!k) return true;
      return (
        String(m.matchNo).includes(k) ||
        String(m.groupNo ?? '').includes(k) ||
        matchGroupLabel(m).toLowerCase().includes(k) ||
        String(m.team1.teamNo).includes(k) || String(m.team2.teamNo).includes(k) ||
        m.team1.player1Name.toLowerCase().includes(k) || m.team1.player2Name.toLowerCase().includes(k) ||
        m.team2.player1Name.toLowerCase().includes(k) || m.team2.player2Name.toLowerCase().includes(k)
      );
    });
  }, [board, filter, q]);

  if (!ready) {
    return (
      <div style={{ ...card, background: '#FFFBEB', border: '1px solid #FDE68A', display: 'flex', gap: 9 }}>
        <AlertTriangle size={17} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.7 }}>
          경기 데이터를 불러올 수 없습니다.<br />
          <code style={{ fontSize: 11.5 }}>supabase/add_hosted_tournament_matches.sql</code> 적용 여부와 CEO·ADMIN 권한을 확인해 주세요.
        </p>
      </div>
    );
  }

  const activeCourts = (board?.courts ?? []).filter((c) => c.status === 'active');
  const busyCourts = activeCourts.filter((c) => c.busy).length;
  const canGenerate = !!board && !board.matchesGenerated && board.drawStatus === 'locked';

  return (
    <div>
      {/* ── stale 경고 (차단하지 않는다 — 서버가 막지 않으므로) ────────────── */}
      {board?.matchesStale && (
        <div style={{
          ...card, background: '#FEF2F2', border: '1px solid #FCA5A5',
          display: 'flex', gap: 9, alignItems: 'flex-start',
        }}>
          <AlertTriangle size={18} color="#B91C1C" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#B91C1C', lineHeight: 1.6 }}>
              조편성이 변경되어 현재 경기 목록과 일치하지 않습니다.
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 600, color: '#475569', lineHeight: 1.7, wordBreak: 'keep-all' }}>
              경기를 자동으로 지우거나 다시 만들지 않습니다. 조편성을 되돌리거나, 운영진이 직접 판단해 주세요.
            </p>
          </div>
        </div>
      )}

      {/* ── 결과 수정 → 합산연령 순위 확정 무효화 안내 (서버가 알려준 건수) ─ */}
      {tieNotice && (
        <div style={{
          ...card, background: '#FFFBEB', border: '1px solid #FDE68A',
          display: 'flex', gap: 9, alignItems: 'flex-start',
        }}>
          <AlertTriangle size={18} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#B45309', lineHeight: 1.6, wordBreak: 'keep-all' }}>
              {tieNotice}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 600, color: '#475569', lineHeight: 1.7, wordBreak: 'keep-all' }}>
              예선 순위 화면에서 해당 조의 순서를 다시 확인해 주세요.
            </p>
            <div style={{ display: 'flex', gap: 7, marginTop: 9, flexWrap: 'wrap' }}>
              <Link href={`/admin/tournaments/${slug}/standings`}
                    style={{ ...btn('primary'), minHeight: 34, fontSize: 12, textDecoration: 'none' }}>
                <ListOrdered size={13} strokeWidth={2.4} /> 예선 순위 확인
              </Link>
              <button type="button" onClick={() => setTieNotice('')}
                      style={{ ...btn(), minHeight: 34, fontSize: 12 }}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 요약 ────────────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px',
            borderRadius: 999, fontSize: 11.5, fontWeight: 800,
            color: board?.drawStatus === 'locked' ? '#fff' : '#B45309',
            background: board?.drawStatus === 'locked' ? '#047857' : '#FEF3C7',
            border: `1px solid ${board?.drawStatus === 'locked' ? '#047857' : '#FCD34D'}`,
          }}>
            조편성 {board?.drawStatus === 'locked' ? '확정' : '작성 중'}
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#94A3B8' }}>
            draw v{board?.drawVersion ?? '-'}
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: board?.matchesGenerated ? '#047857' : '#94A3B8' }}>
            {board?.matchesGenerated ? '경기 생성됨' : '경기 미생성'}
          </span>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => void load()} style={btn()} disabled={!!busy}>
            <RefreshCw size={13} strokeWidth={2.4} />
            {loading ? '조회 중' : '새로고침'}
          </button>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))',
          gap: 7, marginTop: 12,
        }}>
          {[
            ['전체', counts.all, '#0F172A'],
            ['대기', counts.waiting, '#475569'],
            ['호명', counts.calling, counts.calling ? '#B45309' : '#94A3B8'],
            ['진행 중', counts.playing, counts.playing ? '#DC2626' : '#94A3B8'],
            ['완료', counts.completed, counts.completed ? '#047857' : '#94A3B8'],
            ['취소', counts.cancelled, counts.cancelled ? '#B91C1C' : '#94A3B8'],
          ].map(([k, v, c]) => (
            <div key={k as string} style={{ padding: '9px 10px', borderRadius: 10, background: '#F8FAFC' }}>
              <p style={{ ...label, fontSize: 10 }}>{k}</p>
              <p style={{ margin: '3px 0 0', fontSize: 17, fontWeight: 900, color: c as string, lineHeight: 1.2 }}>{v}</p>
            </div>
          ))}
        </div>

        <p style={{ margin: '10px 0 0', fontSize: 12, fontWeight: 700, color: '#475569' }}>
          코트 · 사용 가능 {activeCourts.length}면 중 <strong>{busyCourts}면 사용 중</strong>
          {board && board.courts.length > activeCourts.length && (
            <span style={{ color: '#94A3B8', fontWeight: 600 }}>
              {' '}(중지 {board.courts.length - activeCourts.length}면)
            </span>
          )}
        </p>
      </div>

      {/* ── 경기 생성 ───────────────────────────────────────────────────── */}
      {board && !board.matchesGenerated && (
        <div style={card}>
          <p style={label}>경기 생성</p>
          {canGenerate ? (
            <>
              <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 700, color: '#0F172A', lineHeight: 1.7, wordBreak: 'keep-all' }}>
                현재 확정된 조편성을 기준으로 예선 경기를 생성합니다.
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', lineHeight: 1.7, wordBreak: 'keep-all' }}>
                일반 조는 3경기(라운드로빈), 순위결정전 조는 1경기가 만들어집니다.
                두 번 눌러도 중복 생성되지 않습니다.
              </p>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => {
                  if (!window.confirm('현재 확정된 조편성을 기준으로 예선 경기를 생성합니다.\n계속할까요?')) return;
                  void run('generate', async () => {
                    const r = await generateMatches(slug, board.drawVersion);
                    return `경기를 생성했습니다 — 예선 ${r.preliminaryMatches} · 순위결정전 ${r.placementMatches} · 총 ${r.totalMatches}경기`;
                  });
                }}
                style={{ ...btn('primary'), width: '100%', minHeight: 44, marginTop: 11 }}
              >
                {busy === 'generate' ? '생성 중…' : '예선 경기 생성'}
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
              <Info size={15} color="#94A3B8" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#475569', lineHeight: 1.7, wordBreak: 'keep-all' }}>
                조편성을 먼저 확정(잠금)해야 경기를 만들 수 있습니다. 조편성 화면에서 검증 후 확정해 주세요.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── 필터 / 검색 ─────────────────────────────────────────────────── */}
      {board && board.matches.length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FILTERS.map((f) => {
              const on = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  style={{
                    ...btn(on ? 'primary' : 'plain'), minHeight: 32, padding: '6px 11px', fontSize: 12,
                  }}
                >
                  {f.label} {counts[f.key]}
                </button>
              );
            })}
          </div>
          <div style={{ position: 'relative', marginTop: 9 }}>
            <Search size={14} color="#94A3B8" style={{ position: 'absolute', left: 11, top: 12 }} />
            <input
              style={{ ...input, paddingLeft: 32 }}
              placeholder="경기 번호 · 조 · 팀 번호 · 선수 이름 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* ── 경기 목록 ───────────────────────────────────────────────────── */}
      {board && board.matches.length === 0 ? null : filtered.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '26px 15px' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#94A3B8' }}>
            {loading ? '조회 중…' : '조건에 맞는 경기가 없습니다.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {filtered.map((m) => {
            const tone = STATUS_TONE[m.status];
            const mine = busy.endsWith(m.matchId);
            const done = m.status === 'completed';
            const w1 = done && m.winnerTeamId === m.team1.teamId;
            const w2 = done && m.winnerTeamId === m.team2.teamId;
            return (
              <div
                key={m.matchId}
                style={{
                  background: '#fff', borderRadius: 12, padding: 13,
                  border: '1px solid #E2E8F0',
                  borderLeft: `3px solid ${tone.b}`,
                  opacity: m.status === 'cancelled' ? 0.66 : 1,
                }}
              >
                {/* 헤더 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 900, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>
                    #{m.matchNo}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999,
                    color: m.stage === 'placement' ? '#7C3AED' : '#475569',
                    background: m.stage === 'placement' ? '#F5F3FF' : '#F1F5F9',
                  }}>
                    {matchGroupLabel(m)}
                  </span>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 999,
                    color: tone.c, background: tone.bg, border: `1px solid ${tone.b}`,
                  }}>
                    {m.status === 'calling' && <Megaphone size={10} strokeWidth={3} />}
                    {m.status === 'playing' && <Play size={10} strokeWidth={3} />}
                    {MATCH_STATUS_LABEL[m.status]}
                  </span>
                  {m.status === 'playing' && m.courtNo !== null && (
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: '#DC2626' }}>
                      {m.courtNo}번 코트
                    </span>
                  )}
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#CBD5E1' }}>v{m.version}</span>
                </div>

                {/* 팀 */}
                <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {[{ t: m.team1, s: m.score1, w: w1 }, { t: m.team2, s: m.score2, w: w2 }].map((row, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 9px', borderRadius: 8,
                      background: row.w ? '#ECFDF5' : '#F8FAFC',
                      border: `1px solid ${row.w ? '#A7F3D0' : '#EEF2F6'}`,
                    }}>
                      {row.w && <Trophy size={13} strokeWidth={2.6} color="#047857" style={{ flexShrink: 0 }} />}
                      <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 800, color: '#94A3B8', minWidth: 26 }}>
                        {row.t.teamNo}
                      </span>
                      <span style={{
                        minWidth: 0, flex: 1, fontSize: 13, fontWeight: row.w ? 900 : 700,
                        color: '#0F172A', lineHeight: 1.45, wordBreak: 'keep-all',
                      }}>
                        {matchTeamName(row.t)}
                        {row.t.teamStatus === 'withdrawn' && (
                          <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, color: '#B91C1C' }}>기권</span>
                        )}
                      </span>
                      {done && (
                        <span style={{
                          flexShrink: 0, fontSize: 18, fontWeight: 900,
                          color: row.w ? '#047857' : '#94A3B8', fontVariantNumeric: 'tabular-nums',
                        }}>
                          {row.s}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* 액션 */}
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  {m.status === 'waiting' && (
                    <>
                      <button type="button" disabled={!!busy}
                        onClick={() => void run(`call-${m.matchId}`, async () => {
                          await callMatch(m.matchId, m.version);
                          return `#${m.matchNo} 호명했습니다.`;
                        })}
                        style={btn()}>
                        <Megaphone size={13} strokeWidth={2.4} /> 호명
                      </button>
                      <button type="button" disabled={!!busy} onClick={() => setDlg({ kind: 'start', m })} style={btn('primary')}>
                        <Play size={13} strokeWidth={2.6} /> 경기 시작
                      </button>
                      <button type="button" disabled={!!busy} onClick={() => { setReason(''); setDlg({ kind: 'cancel', m }); }} style={btn('danger')}>
                        <Ban size={12} strokeWidth={2.4} /> 취소
                      </button>
                    </>
                  )}
                  {m.status === 'calling' && (
                    <>
                      <button type="button" disabled={!!busy}
                        onClick={() => void run(`uncall-${m.matchId}`, async () => {
                          await uncallMatch(m.matchId, m.version);
                          return `#${m.matchNo} 호명을 취소했습니다.`;
                        })}
                        style={btn()}>
                        <XIcon size={12} strokeWidth={2.6} /> 호명 취소
                      </button>
                      <button type="button" disabled={!!busy} onClick={() => setDlg({ kind: 'start', m })} style={btn('primary')}>
                        <Play size={13} strokeWidth={2.6} /> 경기 시작
                      </button>
                      <button type="button" disabled={!!busy} onClick={() => { setReason(''); setDlg({ kind: 'cancel', m }); }} style={btn('danger')}>
                        <Ban size={12} strokeWidth={2.4} /> 취소
                      </button>
                    </>
                  )}
                  {m.status === 'playing' && (
                    <>
                      <button type="button" disabled={!!busy}
                        onClick={() => { setS1(''); setS2(''); setDlg({ kind: 'complete', m }); }}
                        style={btn('primary')}>
                        <Check size={13} strokeWidth={2.8} /> 경기 완료
                      </button>
                      <button type="button" disabled={!!busy} onClick={() => { setReason(''); setDlg({ kind: 'cancel', m }); }} style={btn('danger')}>
                        <Ban size={12} strokeWidth={2.4} /> 취소
                      </button>
                    </>
                  )}
                  {m.status === 'completed' && (
                    <button type="button" disabled={!!busy}
                      onClick={() => { setS1(String(m.score1 ?? '')); setS2(String(m.score2 ?? '')); setReason(''); setDlg({ kind: 'amend', m }); }}
                      style={btn()}>
                      <Pencil size={12} strokeWidth={2.4} /> 결과 수정
                    </button>
                  )}
                  {m.status === 'cancelled' && (
                    <>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: '#94A3B8', alignSelf: 'center' }}>
                        공식 결과 없음 (취소됨)
                      </span>
                      <button type="button" disabled={!!busy}
                        onClick={() => { setReason(''); setDlg({ kind: 'restore', m }); }}
                        style={btn()}>
                        <RotateCcw size={12} strokeWidth={2.4} /> 취소 복구
                      </button>
                    </>
                  )}
                  {mine && <span style={{ fontSize: 11.5, fontWeight: 800, color: '#0E8C80', alignSelf: 'center' }}>처리 중…</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 다이얼로그 ──────────────────────────────────────────────────── */}
      {dlg && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={closeDlg}
          style={{
            position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,0.55)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            padding: 12, paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 440, maxHeight: 'calc(100dvh - 40px)', overflowY: 'auto',
              background: '#fff', borderRadius: 16, padding: 16,
            }}
          >
            <p style={{ margin: 0, fontSize: 15, fontWeight: 900, color: '#0F172A' }}>
              {dlg.kind === 'start' ? '경기 시작 — 코트 선택'
                : dlg.kind === 'complete' ? '경기 완료 — 점수 입력'
                : dlg.kind === 'amend' ? '결과 수정'
                : dlg.kind === 'restore' ? '취소 복구 — 대기 상태로 되돌리기'
                : '경기 취소'}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 700, color: '#64748B', wordBreak: 'keep-all' }}>
              #{dlg.m.matchNo} · {matchGroupLabel(dlg.m)} · {matchTeamName(dlg.m.team1)} vs {matchTeamName(dlg.m.team2)}
            </p>

            {/* start */}
            {dlg.kind === 'start' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 7, marginTop: 13 }}>
                  {(board?.courts ?? []).map((c) => {
                    const off = c.status !== 'active';
                    const taken = c.busy;
                    const sel = !off && !taken;
                    return (
                      <button
                        key={c.courtNo}
                        type="button"
                        disabled={!sel || !!busy}
                        onClick={() => void run(`start-${dlg.m.matchId}`, async () => {
                          await startMatch(dlg.m.matchId, c.courtNo, dlg.m.version);
                          return `#${dlg.m.matchNo} · ${c.courtNo}번 코트에서 시작했습니다.`;
                        })}
                        style={{
                          ...btn(sel ? 'primary' : 'plain'),
                          minHeight: 52, flexDirection: 'column', gap: 2,
                          opacity: sel ? 1 : 0.5, cursor: sel ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 900 }}>{matchCourtLabel(c)}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 700 }}>
                          {off ? '사용 중지' : taken ? '사용 중' : '사용 가능'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {(board?.courts ?? []).length === 0 && (
                  <p style={{ margin: '12px 0 0', fontSize: 12.5, fontWeight: 700, color: '#B45309' }}>
                    등록된 코트가 없습니다. 코트 관리에서 먼저 코트를 추가해 주세요.
                  </p>
                )}
              </>
            )}

            {/* complete / amend — 점수 */}
            {(dlg.kind === 'complete' || dlg.kind === 'amend') && (
              <>
                {dlg.kind === 'amend' && (
                  <p style={{ margin: '10px 0 0', padding: '9px 11px', borderRadius: 9, background: '#F1F5F9',
                              fontSize: 12.5, fontWeight: 800, color: '#475569' }}>
                    현재 점수 {dlg.m.score1} : {dlg.m.score2}
                  </p>
                )}
                <p style={{ ...label, marginTop: 13 }}>빠른 선택 (6게임 1세트)</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 5, marginTop: 7 }}>
                  {QUICK.map(([a, b]) => {
                    const on = s1 === String(a) && s2 === String(b);
                    return (
                      <button key={`${a}-${b}`} type="button"
                        onClick={() => { setS1(String(a)); setS2(String(b)); }}
                        style={{ ...btn(on ? 'primary' : 'plain'), minHeight: 36, padding: '6px 2px', fontSize: 12 }}>
                        {a}:{b}
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 11, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ ...label, fontSize: 10 }}>{matchTeamName(dlg.m.team1)}</p>
                    <input style={{ ...input, marginTop: 5, textAlign: 'center', fontSize: 20, fontWeight: 900 }}
                      inputMode="numeric" value={s1} maxLength={2}
                      onChange={(e) => setS1(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} />
                  </div>
                  <span style={{ fontSize: 18, fontWeight: 900, color: '#94A3B8', marginTop: 18 }}>:</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ ...label, fontSize: 10 }}>{matchTeamName(dlg.m.team2)}</p>
                    <input style={{ ...input, marginTop: 5, textAlign: 'center', fontSize: 20, fontWeight: 900 }}
                      inputMode="numeric" value={s2} maxLength={2}
                      onChange={(e) => setS2(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} />
                  </div>
                </div>

                {s1 !== '' && s2 !== '' && !isValidSetScore(Number(s1), Number(s2)) && (
                  <p style={{ margin: '8px 0 0', fontSize: 12, fontWeight: 800, color: '#B91C1C', lineHeight: 1.6 }}>
                    6:0~6:5 또는 0:6~5:6 만 입력할 수 있습니다. (6:6 · 7:5 · 4:2 불가)
                  </p>
                )}
                <p style={{ margin: '7px 0 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                  기권·노쇼는 별도 표기 없이 상대팀 <strong>6:0</strong> 승리로 입력합니다.
                </p>

                {dlg.kind === 'amend' && (
                  <div style={{ marginTop: 11 }}>
                    <p style={{ ...label, fontSize: 10 }}>수정 사유 (필수)</p>
                    <input style={{ ...input, marginTop: 5 }} maxLength={120}
                      placeholder="예: 점수 오입력 수정" value={reason}
                      onChange={(e) => setReason(e.target.value)} />
                    <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8' }}>
                      사유는 운영 기록에 남습니다.
                    </p>
                  </div>
                )}
              </>
            )}

            {/* cancel */}
            {dlg.kind === 'cancel' && (
              <>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, padding: '10px 12px', borderRadius: 9, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                  <AlertTriangle size={14} color="#B45309" style={{ flexShrink: 0, marginTop: 2 }} />
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#0F172A', lineHeight: 1.7, wordBreak: 'keep-all' }}>
                    취소는 <strong>공식 결과가 없는</strong> 경기를 뜻합니다.
                    기권·노쇼는 취소가 아니라 상대팀 <strong>6:0 완료</strong>로 처리해 주세요.
                  </p>
                </div>
                <div style={{ marginTop: 11 }}>
                  <p style={{ ...label, fontSize: 10 }}>취소 사유 (필수)</p>
                  <input style={{ ...input, marginTop: 5 }} maxLength={120}
                    placeholder="예: 조편성 오류로 경기 무효" value={reason}
                    onChange={(e) => setReason(e.target.value)} />
                </div>
              </>
            )}

            {/* restore — 취소 복구 (CANCELLED → WAITING 하나뿐) */}
            {dlg.kind === 'restore' && (
              <>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, padding: '10px 12px', borderRadius: 9, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                  <AlertTriangle size={14} color="#B45309" style={{ flexShrink: 0, marginTop: 2 }} />
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#0F172A', lineHeight: 1.7, wordBreak: 'keep-all' }}>
                    경기를 <strong>대기</strong> 상태로 되돌립니다.
                    <strong>재경기</strong>를 진행하거나 <strong>잘못된 취소</strong>를 바로잡을 때만 사용하세요.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, padding: '10px 12px', borderRadius: 9, background: '#F8FAFC', border: '1px solid #EEF2F6' }}>
                  <Info size={14} color="#94A3B8" style={{ flexShrink: 0, marginTop: 2 }} />
                  <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: '#475569', lineHeight: 1.7, wordBreak: 'keep-all' }}>
                    기권·노쇼는 이 기능의 대상이 아닙니다. 처음부터 상대팀 <strong>6:0 완료</strong>로 입력해 주세요.
                    복구하면 코트·호명·점수 기록이 모두 비워지고 경기를 처음부터 다시 진행합니다.
                  </p>
                </div>
                <div style={{ marginTop: 11 }}>
                  <p style={{ ...label, fontSize: 10 }}>복구 사유 (필수)</p>
                  <input style={{ ...input, marginTop: 5 }} maxLength={120}
                    placeholder="예: 취소 오입력 · 재경기 진행" value={reason}
                    onChange={(e) => setReason(e.target.value)} />
                  <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8' }}>
                    사유는 운영 기록에 남습니다.
                  </p>
                </div>
              </>
            )}

            {/* 다이얼로그 액션 */}
            <div style={{ display: 'flex', gap: 8, marginTop: 15 }}>
              <button type="button" onClick={closeDlg} style={{ ...btn(), flex: 1, minHeight: 44 }}>닫기</button>

              {dlg.kind === 'complete' && (
                <button type="button"
                  disabled={!!busy || !isValidSetScore(Number(s1), Number(s2))}
                  onClick={() => void run(`complete-${dlg.m.matchId}`, async () => {
                    await completeMatch(dlg.m.matchId, Number(s1), Number(s2), dlg.m.version);
                    return `#${dlg.m.matchNo} 완료 — ${s1}:${s2}`;
                  })}
                  style={{ ...btn('primary'), flex: 2, minHeight: 44,
                           opacity: isValidSetScore(Number(s1), Number(s2)) ? 1 : 0.45 }}>
                  경기 완료
                </button>
              )}

              {dlg.kind === 'amend' && (
                <button type="button"
                  disabled={!!busy || !isValidSetScore(Number(s1), Number(s2)) || reason.trim().length < 2}
                  onClick={() => void run(`amend-${dlg.m.matchId}`, async () => {
                    const r = await amendMatchScore(
                      dlg.m.matchId, Number(s1), Number(s2), reason.trim(), dlg.m.version,
                    );
                    // ⚠ 서버가 같은 트랜잭션에서 이미 무효화했다. 여기서 따로 호출하지 않는다.
                    if (r.invalidatedResolutions > 0) {
                      setTieNotice(
                        `점수가 수정되어 ${matchGroupLabel(dlg.m)}의 합산연령 순위 확정 `
                        + `${r.invalidatedResolutions}건이 무효화되었습니다.`,
                      );
                    }
                    return `#${dlg.m.matchNo} 결과를 ${s1}:${s2} 로 수정했습니다.`;
                  })}
                  style={{ ...btn('primary'), flex: 2, minHeight: 44,
                           opacity: (isValidSetScore(Number(s1), Number(s2)) && reason.trim().length >= 2) ? 1 : 0.45 }}>
                  수정 저장
                </button>
              )}

              {dlg.kind === 'cancel' && (
                <button type="button"
                  disabled={!!busy || reason.trim().length < 2}
                  onClick={() => void run(`cancel-${dlg.m.matchId}`, async () => {
                    await cancelMatch(dlg.m.matchId, reason.trim(), dlg.m.version);
                    return `#${dlg.m.matchNo} 경기를 취소했습니다.`;
                  })}
                  style={{ ...btn('danger'), flex: 2, minHeight: 44,
                           opacity: reason.trim().length >= 2 ? 1 : 0.45 }}>
                  경기 취소
                </button>
              )}

              {dlg.kind === 'restore' && (
                <button type="button"
                  disabled={!!busy || reason.trim().length < 2}
                  onClick={() => void run(`restore-${dlg.m.matchId}`, async () => {
                    const r = await restoreCancelledMatch(
                      dlg.m.matchId, reason.trim(), dlg.m.version,
                    );
                    return `#${r.matchNo} 경기를 대기 상태로 되돌렸습니다.`;
                  })}
                  style={{ ...btn('primary'), flex: 2, minHeight: 44,
                           opacity: reason.trim().length >= 2 ? 1 : 0.45 }}>
                  대기로 되돌리기
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)',
          // ⚠ Admin BottomNav(모바일, 약 54px + safe-area) 위로 띄운다.
          bottom: 'calc(68px + env(safe-area-inset-bottom))',
          maxWidth: 'calc(100vw - 32px)', padding: '11px 16px', borderRadius: 10,
          background: '#0F172A', color: '#fff', fontSize: 12.5, fontWeight: 700,
          lineHeight: 1.6, zIndex: 90, wordBreak: 'keep-all', textAlign: 'center',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
