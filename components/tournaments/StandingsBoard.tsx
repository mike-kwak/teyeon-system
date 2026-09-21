'use client';

// 예선 순위 보드 (Batch 3C-2) — 운영진용.
//
//   ⚠⚠ 순위를 클라이언트에서 계산하지 않는다.
//     rank · qualificationStatus · rankingStatus · policyRequired 는 전부
//     get_preliminary_standings 가 준 값을 **그대로** 표시한다.
//     화면이 "2팀 진출" 같은 규칙을 다시 구현하면 서버와 어긋나는 순간 사고가 난다.
//
//   ⚠⚠ 나이를 입력받지 않는다.
//     합산연령은 운영진이 현장에서 확인하고, 앱에는 **순서만** 저장한다.
//     DOB · 생년 · 나이 · 합산연령 입력란을 만들지 않는다.
//
//   ⚠ Realtime 없음. 모든 write 성공 후 authoritative full refetch.
//   ⚠ 표시 데이터는 hosted_tournament_teams 스냅샷뿐이다(접수 PII 미표시).
//   ⚠ Public 순위 화면이 아니다. CEO·ADMIN 전용.

import React from 'react';
import {
  RefreshCw, AlertTriangle, ListOrdered, Info, ArrowUp, ArrowDown,
  CheckCircle2, CircleDashed, Users, Trophy,
} from 'lucide-react';
import {
  fetchPreliminaryStandings, resolveGroupAgeTie, standingsActionMessage,
} from '@/lib/tournaments/standingsAdminService';
import {
  QUALIFICATION_LABEL, RANKING_STATUS_LABEL, GROUP_POLICY_LABEL,
  formatGameDiff, formatWinRate, isValidTieOrder, previewResolvedRanks, standingTeamName,
  type GroupStandings, type PreliminaryStandings, type QualificationStatus,
  type StandingRow, type TieGroup,
} from '@/lib/tournaments/standingsTypes';
import { fetchMatchBoard } from '@/lib/tournaments/matchAdminService';
import type { MatchBoard } from '@/lib/tournaments/matchTypes';

// ── 스타일 (Admin Tournament 기존 톤 — Cool Premium Light) ───────────────────
const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 15, marginBottom: 10,
};
const label: React.CSSProperties = {
  margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#94A3B8',
};
const btn = (tone: 'primary' | 'plain' | 'danger' = 'plain'): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  minHeight: 38, padding: '8px 13px', borderRadius: 9,
  border: `1px solid ${tone === 'primary' ? '#0E8C80' : tone === 'danger' ? '#FCA5A5' : '#E2E8F0'}`,
  background: tone === 'primary' ? '#0E8C80' : '#fff',
  color: tone === 'primary' ? '#fff' : tone === 'danger' ? '#B91C1C' : '#475569',
  fontFamily: 'inherit', fontSize: 13, fontWeight: 800, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent', whiteSpace: 'nowrap',
});
const input: React.CSSProperties = {
  minWidth: 0, width: '100%', boxSizing: 'border-box', minHeight: 38, padding: '8px 11px',
  borderRadius: 9, border: '1px solid #E2E8F0', background: '#fff',
  fontFamily: 'inherit', fontSize: 14, color: '#0F172A',
};

/** 조 상태 색. AGE CHECK 와 취소 잔존만 경고색을 쓴다(남발하지 않는다). */
const RANK_TONE = {
  FINAL:              { c: '#FFFFFF', bg: '#047857', b: '#047857' },
  PROVISIONAL:        { c: '#475569', bg: '#F1F5F9', b: '#CBD5E1' },
  AGE_CHECK_REQUIRED: { c: '#B45309', bg: '#FEF3C7', b: '#FCD34D' },
} as const;

const QUAL_TONE: Record<QualificationStatus, { c: string; bg: string; b: string }> = {
  QUALIFIED:     { c: '#047857', bg: '#ECFDF5', b: '#A7F3D0' },
  NOT_QUALIFIED: { c: '#94A3B8', bg: '#F8FAFC', b: '#EEF2F6' },
  PENDING:       { c: '#B45309', bg: '#FFFBEB', b: '#FDE68A' },
};

/** 순서 확정 다이얼로그 상태. ⚠ 나이가 아니라 '순서'만 들고 있다. */
type TieDialog = {
  group: GroupStandings;
  tie: TieGroup;
  order: string[];   // teamId 를 최종 순서대로
} | null;

const DEFAULT_REASON = '합산연령 현장 확인';

export default function StandingsBoard({ slug }: { slug: string }) {
  const [data, setData] = React.useState<PreliminaryStandings | null>(null);
  const [board, setBoard] = React.useState<MatchBoard | null>(null);
  const [ready, setReady] = React.useState(true);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState('');
  const [toast, setToast] = React.useState('');
  const [dlg, setDlg] = React.useState<TieDialog>(null);
  const [reason, setReason] = React.useState(DEFAULT_REASON);

  const say = React.useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(''), 4200);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      // 순위는 standings RPC 가, 조편성 상태는 match board 가 권위 있는 값이다.
      const [st, mb] = await Promise.all([
        fetchPreliminaryStandings(slug),
        fetchMatchBoard(slug).catch(() => ({ ready: false, board: null as MatchBoard | null })),
      ]);
      setReady(st.ready);
      setData(st.standings);
      setBoard(mb.board);
    } catch (err) {
      setReady(false);
      say(standingsActionMessage(err));
    } finally {
      setLoading(false);
    }
  }, [slug, say]);

  React.useEffect(() => { void load(); }, [load]);

  const closeDlg = () => { setDlg(null); setReason(DEFAULT_REASON); };

  /** 순서 확정 저장. ⚠ 성공/실패 모두 authoritative full refetch 로 끝난다. */
  const submitTie = async () => {
    if (!dlg || busy) return;
    setBusy('resolve');
    try {
      const r = await resolveGroupAgeTie(
        slug, dlg.group.groupNo, dlg.order, reason.trim(), dlg.group.resultsFingerprint,
      );
      setDlg(null);
      setReason(DEFAULT_REASON);
      await load();
      say(
        `${r.groupNo}조 ${r.tieRank}위 동률 ${r.tieSize}팀의 순서를 확정했습니다.`
        + (r.replacedResolutions > 0 ? ` (이전 확정 ${r.replacedResolutions}건은 무효 처리)` : ''),
      );
    } catch (err) {
      const rsn = (err as { reason?: string }).reason;
      // 서버가 최종 판정한다. 낙관적으로 화면을 고치지 않고 다시 불러온다.
      if (rsn === 'standings_changed' || rsn === 'tie_set_mismatch' || rsn === 'group_not_complete') {
        setDlg(null);
        setReason(DEFAULT_REASON);
        await load();
        say(rsn === 'standings_changed'
          ? '경기 결과가 변경되었습니다. 최신 순위를 다시 불러왔습니다.'
          : standingsActionMessage(err));
      } else {
        say(standingsActionMessage(err));
      }
    } finally {
      setBusy('');
    }
  };

  const move = (i: number, d: -1 | 1) => {
    setDlg((prev) => {
      if (!prev) return prev;
      const j = i + d;
      if (j < 0 || j >= prev.order.length) return prev;
      const next = [...prev.order];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...prev, order: next };
    });
  };

  const groups = data?.groups ?? [];
  const summary = React.useMemo(() => {
    let final = 0, prov = 0, age = 0, policy = 0, done = 0, total = 0;
    groups.forEach((g) => {
      if (g.rankingStatus === 'FINAL') final += 1;
      else if (g.rankingStatus === 'AGE_CHECK_REQUIRED') age += 1;
      else prov += 1;
      if (g.policyRequired) policy += 1;
      done += g.completedMatches;
      total += g.generatedMatches;
    });
    return { final, prov, age, policy, done, total, count: groups.length };
  }, [groups]);

  if (!ready) {
    return (
      <div style={{ ...card, background: '#FFFBEB', border: '1px solid #FDE68A', display: 'flex', gap: 9 }}>
        <AlertTriangle size={17} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.7 }}>
          순위를 불러올 수 없습니다.<br />
          <code style={{ fontSize: 11.5 }}>supabase/add_hosted_tournament_standings.sql</code> 적용 여부와 CEO·ADMIN 권한을 확인해 주세요.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* ── 요약 ────────────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* ⚠ board 를 못 불러왔으면 '작성 중'이라고 단정하지 않는다.
              '모른다'와 'draft'는 다른 상태다 — 배지를 아예 띄우지 않는다. */}
          {board && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px',
              borderRadius: 999, fontSize: 11.5, fontWeight: 800,
              color: board.drawStatus === 'locked' ? '#fff' : '#B45309',
              background: board.drawStatus === 'locked' ? '#047857' : '#FEF3C7',
              border: `1px solid ${board.drawStatus === 'locked' ? '#047857' : '#FCD34D'}`,
            }}>
              조편성 {board.drawStatus === 'locked' ? '확정' : '작성 중'}
            </span>
          )}
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#94A3B8' }}>
            경기 {summary.done} / {summary.total}
          </span>
          {data && (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#94A3B8' }}>
              조별 {data.qualifyPerGroup}팀 진출
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => void load()} style={btn()} disabled={!!busy}>
            <RefreshCw size={13} strokeWidth={2.4} />
            {loading ? '조회 중' : '새로고침'}
          </button>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(76px, 1fr))',
          gap: 7, marginTop: 12,
        }}>
          {([
            ['전체 조', summary.count, '#0F172A'],
            ['확정', summary.final, summary.final ? '#047857' : '#94A3B8'],
            ['진행 중', summary.prov, summary.prov ? '#475569' : '#94A3B8'],
            ['연령 확인', summary.age, summary.age ? '#B45309' : '#94A3B8'],
            ['취소 확인', summary.policy, summary.policy ? '#B91C1C' : '#94A3B8'],
          ] as [string, number, string][]).map(([k, v, c]) => (
            <div key={k} style={{ padding: '9px 10px', borderRadius: 10, background: '#F8FAFC' }}>
              <p style={{ ...label, fontSize: 10 }}>{k}</p>
              <p style={{ margin: '3px 0 0', fontSize: 17, fontWeight: 900, color: c, lineHeight: 1.2 }}>{v}</p>
            </div>
          ))}
        </div>

        {summary.age > 0 && (
          <div style={{
            display: 'flex', gap: 8, marginTop: 11, padding: '10px 12px', borderRadius: 10,
            background: '#FFFBEB', border: '1px solid #FDE68A',
          }}>
            <AlertTriangle size={15} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.7, wordBreak: 'keep-all' }}>
              <strong>{summary.age}개 조</strong>가 승률·게임 득실로 순위가 갈리지 않았습니다.
              현장에서 합산연령을 확인한 뒤 순서를 지정해 주세요.
            </p>
          </div>
        )}
      </div>

      {/* ── 조별 카드 ───────────────────────────────────────────────────── */}
      {groups.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '26px 15px' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#94A3B8', lineHeight: 1.8 }}>
            {loading ? '조회 중…' : '예선 조가 없습니다.'}
            {!loading && <><br />조편성과 경기 생성을 먼저 진행해 주세요.</>}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groups.map((g) => (
            <GroupCard
              key={g.groupId}
              g={g}
              busy={!!busy}
              onResolve={(tie) => {
                setReason(DEFAULT_REASON);
                setDlg({ group: g, tie, order: [...tie.teamIds] });
              }}
            />
          ))}
        </div>
      )}

      {/* ── placement — 일반 순위와 섞지 않는다 ─────────────────────────── */}
      {(data?.placement ?? []).length > 0 && (
        <div style={{ ...card, marginTop: 10 }}>
          <p style={label}>순위결정전</p>
          <p style={{ margin: '7px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', lineHeight: 1.7, wordBreak: 'keep-all' }}>
            두 팀 모두 본선에 진출합니다. 조별 순위와 별개이며 여기서 대진을 만들지 않습니다.
          </p>
          {(data?.placement ?? []).map((p) => (
            <div key={p.matchId} style={{
              marginTop: 9, padding: '11px 12px', borderRadius: 10,
              background: '#F8FAFC', border: '1px solid #EEF2F6',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: '#7C3AED' }}>{p.groupNo}조</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#94A3B8' }}>#{p.matchNo}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: p.status === 'completed' ? '#047857' : '#94A3B8' }}>
                  {p.status === 'completed' ? `결과 ${p.score1} : ${p.score2}` : '경기 전'}
                </span>
              </div>
              <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {p.teams.map((t) => (
                  <div key={t.teamId} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    {p.winnerTeamId === t.teamId
                      ? <Trophy size={12} strokeWidth={2.6} color="#047857" style={{ flexShrink: 0 }} />
                      : <span style={{ width: 12, flexShrink: 0 }} />}
                    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: '#94A3B8', minWidth: 24 }}>
                      {t.teamNo}
                    </span>
                    <span style={{ minWidth: 0, fontSize: 12.5, fontWeight: 700, color: '#0F172A', wordBreak: 'keep-all' }}>
                      {t.player1Name} · {t.player2Name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 순서 확정 다이얼로그 ────────────────────────────────────────── */}
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
              {dlg.group.groupNo}조 — 순서 확정
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 700, color: '#64748B' }}>
              {dlg.tie.rank}위 동률 {dlg.tie.size}팀
            </p>

            <div style={{
              display: 'flex', gap: 8, marginTop: 12, padding: '11px 12px', borderRadius: 10,
              background: '#FFFBEB', border: '1px solid #FDE68A',
            }}>
              <AlertTriangle size={15} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.75, wordBreak: 'keep-all' }}>
                승률과 게임 득실이 동일합니다. 현장에서 두 팀의 <strong>합산연령을 확인한 뒤</strong> 순서를 지정해 주세요.
              </p>
            </div>
            <p style={{ margin: '7px 0 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.7, wordBreak: 'keep-all' }}>
              나이나 생년월일은 입력하지 않습니다. 앱에는 확정된 <strong>순서만</strong> 저장됩니다.
            </p>

            {/* 순서 지정 — 위/아래 이동. 2팀·3팀 모두 같은 방식이다. */}
            <p style={{ ...label, marginTop: 14 }}>확정 순위</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 7 }}>
              {dlg.order.map((teamId, i) => {
                const row = dlg.group.standings.find((r) => r.teamId === teamId);
                const rank = previewResolvedRanks(dlg.tie)[i];
                return (
                  <div key={teamId} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '9px 10px', borderRadius: 10,
                    background: '#F8FAFC', border: '1px solid #E2E8F0',
                  }}>
                    <span style={{
                      flexShrink: 0, width: 30, height: 30, borderRadius: 8,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: '#0E8C80', color: '#fff', fontSize: 13, fontWeight: 900,
                    }}>
                      {rank}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0F172A', lineHeight: 1.45, wordBreak: 'keep-all' }}>
                        {row ? standingTeamName(row) : '-'}
                      </p>
                      <p style={{ margin: '1px 0 0', fontSize: 11, fontWeight: 700, color: '#94A3B8' }}>
                        {row ? `${row.teamNo}번` : ''}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button type="button" aria-label="위로" disabled={i === 0 || !!busy}
                        onClick={() => move(i, -1)}
                        style={{ ...btn(), minHeight: 34, width: 36, padding: 0, opacity: i === 0 ? 0.35 : 1 }}>
                        <ArrowUp size={14} strokeWidth={2.6} />
                      </button>
                      <button type="button" aria-label="아래로" disabled={i === dlg.order.length - 1 || !!busy}
                        onClick={() => move(i, 1)}
                        style={{ ...btn(), minHeight: 34, width: 36, padding: 0,
                                 opacity: i === dlg.order.length - 1 ? 0.35 : 1 }}>
                        <ArrowDown size={14} strokeWidth={2.6} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 12 }}>
              <p style={{ ...label, fontSize: 10 }}>확인 사유 (필수)</p>
              <input style={{ ...input, marginTop: 5 }} maxLength={120}
                value={reason} onChange={(e) => setReason(e.target.value)} />
              <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                사유는 운영 기록에 남습니다. 나이 숫자를 적지 말아 주세요.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 15 }}>
              <button type="button" onClick={closeDlg} style={{ ...btn(), flex: 1, minHeight: 44 }}>닫기</button>
              <button
                type="button"
                disabled={!!busy || reason.trim().length < 2 || !isValidTieOrder(dlg.tie, dlg.order)}
                onClick={() => void submitTie()}
                style={{
                  ...btn('primary'), flex: 2, minHeight: 44,
                  opacity: (reason.trim().length >= 2 && isValidTieOrder(dlg.tie, dlg.order)) ? 1 : 0.45,
                }}
              >
                {busy === 'resolve' ? '저장 중…' : '이 순서로 확정'}
              </button>
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

// ── 조 카드 ──────────────────────────────────────────────────────────────────

function GroupCard({
  g, busy, onResolve,
}: {
  g: GroupStandings;
  busy: boolean;
  onResolve: (tie: TieGroup) => void;
}) {
  const tone = RANK_TONE[g.rankingStatus];
  const unresolved = g.tieGroups.filter((t) => !t.resolved);

  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: 14,
      border: '1px solid #E2E8F0',
      borderLeft: `3px solid ${g.rankingStatus === 'FINAL' ? '#047857'
        : g.rankingStatus === 'AGE_CHECK_REQUIRED' ? '#F59E0B' : '#CBD5E1'}`,
    }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: '#0F172A' }}>{g.groupNo}조</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 999,
          color: tone.c, background: tone.bg, border: `1px solid ${tone.b}`,
        }}>
          {g.rankingStatus === 'FINAL' && <CheckCircle2 size={10} strokeWidth={3} />}
          {g.rankingStatus === 'AGE_CHECK_REQUIRED' && <AlertTriangle size={10} strokeWidth={3} />}
          {g.rankingStatus === 'PROVISIONAL' && <CircleDashed size={10} strokeWidth={3} />}
          {RANKING_STATUS_LABEL[g.rankingStatus]}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, fontWeight: 800, color: g.groupComplete ? '#047857' : '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
          {g.completedMatches} / {g.generatedMatches} 경기
        </span>
      </div>

      {/* 취소 경기 잔존 — 강한 경고 */}
      {g.policyRequired && (
        <div style={{
          display: 'flex', gap: 8, marginTop: 10, padding: '10px 11px', borderRadius: 10,
          background: '#FEF2F2', border: '1px solid #FECACA',
        }}>
          <AlertTriangle size={15} color="#B91C1C" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: '#B91C1C', lineHeight: 1.6, wordBreak: 'keep-all' }}>
              취소 경기 확인 필요 · {g.cancelledMatches}건
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 11.5, fontWeight: 600, color: '#475569', lineHeight: 1.7, wordBreak: 'keep-all' }}>
              {GROUP_POLICY_LABEL[g.policyRequired]} 경기 운영 화면에서 복구하거나 결과를 확정해 주세요.
            </p>
          </div>
        </div>
      )}

      {/* 동률 — 순서 확정 진입 */}
      {unresolved.map((t) => (
        <div key={`${g.groupId}-${t.rank}`} style={{
          display: 'flex', gap: 8, marginTop: 10, padding: '10px 11px', borderRadius: 10,
          background: '#FFFBEB', border: '1px solid #FDE68A', alignItems: 'flex-start',
        }}>
          <Users size={15} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: '#B45309', lineHeight: 1.6, wordBreak: 'keep-all' }}>
              {t.rank}위 {t.size}팀 동률 — 합산연령 확인 필요
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 11.5, fontWeight: 600, color: '#475569', lineHeight: 1.7, wordBreak: 'keep-all' }}>
              승률과 게임 득실이 같습니다. 현장에서 확인한 순서를 지정해 주세요.
            </p>
            <button type="button" disabled={busy || !g.groupComplete}
              onClick={() => onResolve(t)}
              style={{ ...btn('primary'), minHeight: 36, fontSize: 12.5, marginTop: 9,
                       opacity: g.groupComplete ? 1 : 0.45 }}>
              <ListOrdered size={13} strokeWidth={2.4} /> 순서 지정
            </button>
            {!g.groupComplete && (
              <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 700, color: '#94A3B8', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                조의 모든 경기가 끝나야 순서를 확정할 수 있습니다.
              </p>
            )}
          </div>
        </div>
      ))}

      {/* 팀 목록 — 표가 아니라 행 카드. 360px 에서도 가로 스크롤이 없다. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10 }}>
        {g.standings.map((r) => <TeamRow key={r.teamId} r={r} />)}
      </div>
    </div>
  );
}

function TeamRow({ r }: { r: StandingRow }) {
  const q = QUAL_TONE[r.qualificationStatus];
  const resolved = r.resolvedOrder !== null;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 9,
      padding: '9px 10px', borderRadius: 10,
      background: r.qualificationStatus === 'QUALIFIED' ? '#F6FDFA' : '#F8FAFC',
      border: `1px solid ${r.qualificationStatus === 'QUALIFIED' ? '#D5F2E6' : '#EEF2F6'}`,
    }}>
      {/* 순위 — null 이면 만들어내지 않고 '—' 로 둔다 */}
      <span style={{
        flexShrink: 0, width: 28, height: 28, borderRadius: 8, marginTop: 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
        color: r.rank === null ? '#B45309' : '#0F172A',
        background: r.rank === null ? '#FEF3C7' : '#fff',
        border: `1px solid ${r.rank === null ? '#FCD34D' : '#E2E8F0'}`,
      }}>
        {r.rank === null ? '—' : r.rank}
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: '#94A3B8' }}>
            {r.teamNo}번
          </span>
          <span style={{ minWidth: 0, fontSize: 13, fontWeight: 800, color: '#0F172A', lineHeight: 1.45, wordBreak: 'keep-all' }}>
            {standingTeamName(r)}
          </span>
          {r.teamStatus === 'withdrawn' && (
            <span style={{ fontSize: 10.5, fontWeight: 800, color: '#B91C1C' }}>기권</span>
          )}
        </div>

        {/* 숫자는 한 줄 표가 아니라 줄바꿈되는 목록으로 — 좁은 화면에서 잘리지 않는다 */}
        <p style={{
          margin: '4px 0 0', fontSize: 11.5, fontWeight: 700, color: '#475569',
          lineHeight: 1.7, wordBreak: 'keep-all', fontVariantNumeric: 'tabular-nums',
        }}>
          {r.played}경기 · {r.wins}승 {r.losses}패 · 승률 {formatWinRate(r.winRate)}
          <br />
          득실 {r.gamesFor}:{r.gamesAgainst} ({formatGameDiff(r.gameDiff)})
          {r.tieGroupRank !== null && (
            <span style={{ color: '#B45309', fontWeight: 800 }}>
              {' · '}{r.tieGroupRank}위 동률
            </span>
          )}
          {resolved && (
            <span style={{ color: '#0E8C80', fontWeight: 800 }}>{' · '}순서 확정</span>
          )}
        </p>

        {resolved && r.resolvedReason && (
          <p style={{ margin: '3px 0 0', fontSize: 11, fontWeight: 600, color: '#94A3B8', lineHeight: 1.6, wordBreak: 'keep-all' }}>
            <Info size={10} strokeWidth={2.6} style={{ verticalAlign: '-1px', marginRight: 3 }} />
            {r.resolvedReason}
          </p>
        )}
      </div>

      <span style={{
        flexShrink: 0, marginTop: 2, fontSize: 10.5, fontWeight: 800,
        padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap',
        color: q.c, background: q.bg, border: `1px solid ${q.b}`,
      }}>
        {QUALIFICATION_LABEL[r.qualificationStatus]}
      </span>
    </div>
  );
}
