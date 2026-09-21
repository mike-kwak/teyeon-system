'use client';

// 예선 조 상세 (운영진용) — "조를 자세히 보는 화면".
//   현재 순위(또는 최종 순위) · 승패 · 득실 · 경기 결과 · 예외 처리(합산연령 · 취소 경기).
//
//   ⚠⚠ 순위 · 진출 · 동률을 계산하지 않는다.
//     동률 경고와 순서 지정은 서버가 AGE_CHECK_REQUIRED 로 판정한 조에서,
//     서버 tieGroups 중 resolved=false 인 묶음마다 그대로 띄운다(1위/2위 · 2팀/3팀 무관).
//   ⚠⚠ 나이를 입력받지 않는다. 합산연령은 현장 확인, 앱에는 순서만 저장한다.
//   ⚠ 취소 경기 복구는 여기서 하지 않는다 — 경기 운영 화면으로 보낸다.
//   ⚠ Realtime 없음. 모든 write 성공/충돌 후 authoritative full refetch.

import React from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowDown, ArrowUp, ChevronRight, Clock, ListOrdered, RefreshCw, XCircle,
} from 'lucide-react';
import {
  resolveGroupAgeTie, standingsActionMessage,
} from '@/lib/tournaments/standingsAdminService';
import {
  isValidTieOrder, previewResolvedRanks, standingTeamName,
  type GroupStandings, type TieGroup,
} from '@/lib/tournaments/standingsTypes';
import {
  C, adminRankRow, detailStatus, groupMatches, isSettled, matchStatusView, phaseOf,
  progressText, useStandingsData,
} from '@/components/tournaments/standingsView';
import {
  BackLink, Callout, DetailHeader, EntryRow, MatchResultCard, Notice, PrevNextNav, QualifiedHero,
  RankTable, SectionHead, Toast, sectionStyle,
} from '@/components/tournaments/standings/primitives';

/** 순서 확정 다이얼로그 상태. ⚠ 나이가 아니라 '순서'만 들고 있다. */
type TieDialog = { group: GroupStandings; tie: TieGroup; order: string[] } | null;

const DEFAULT_REASON = '합산연령 현장 확인';

export default function StandingsGroupDetail({ slug, groupNo }: { slug: string; groupNo: number }) {
  const { standings, board, ready, loading, error, reload } = useStandingsData(slug);
  const [busy, setBusy] = React.useState('');
  const [toast, setToast] = React.useState('');
  const [dlg, setDlg] = React.useState<TieDialog>(null);
  const [reason, setReason] = React.useState(DEFAULT_REASON);

  const say = React.useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(''), 4200);
  }, []);

  const groups = React.useMemo(
    () => [...(standings?.groups ?? [])].sort((a, b) => a.groupNo - b.groupNo),
    [standings],
  );
  const idx = groups.findIndex((x) => x.groupNo === groupNo);
  const g = idx >= 0 ? groups[idx] : null;
  const prev = idx > 0 ? groups[idx - 1] : null;
  const next = idx >= 0 && idx < groups.length - 1 ? groups[idx + 1] : null;

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
      await reload();
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
        await reload();
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
    setDlg((p) => {
      if (!p) return p;
      const j = i + d;
      if (j < 0 || j >= p.order.length) return p;
      const order = [...p.order];
      [order[i], order[j]] = [order[j], order[i]];
      return { ...p, order };
    });
  };

  const base = `/admin/tournaments/${slug}/standings`;

  if (!ready) {
    return <Notice tone="warn" icon={<AlertTriangle size={17} color={C.amber} style={{ flexShrink: 0, marginTop: 1 }} />} text={error || '순위를 불러올 수 없습니다. 순위 기능 적용 여부와 CEO·ADMIN 권한을 확인해 주세요.'} />;
  }
  if (!g) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <BackLink href={base} label="예선 조별리그" />
        <Notice tone="info" text={loading ? '불러오는 중…' : `${groupNo}조를 찾을 수 없습니다.`} />
      </div>
    );
  }

  const phase = phaseOf(g);
  const st = detailStatus(g);
  const settled = isSettled(phase);
  const matches = groupMatches(board, g.groupNo);
  const unresolved = phase === 'AGE_CHECK' ? g.tieGroups.filter((t) => !t.resolved) : [];
  const qualified = phase === 'FINAL' ? g.standings.filter((r) => r.qualificationStatus === 'QUALIFIED') : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '-4px 0 -6px' }}>
        <BackLink href={base} label="예선 조별리그" />
        <button type="button" onClick={() => void reload()} disabled={loading || !!busy} aria-label="새로고침"
          style={{
            width: 40, height: 40, border: 0, borderRadius: 10, background: 'transparent', color: C.body,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            opacity: loading ? 0.5 : 1,
          }}>
          <RefreshCw size={17} strokeWidth={2.3} />
        </button>
      </div>

      <DetailHeader
        title={`${g.groupNo}조 상세정보`}
        sub={`예선 조별리그 · ${g.members}팀 · ${g.expectedMatches}경기`}
        status={st}
        progress={`${progressText(g)} 경기`}
      />

      {/* ── 예외 — 서버 판정 그대로 (Admin 전용 행동) ───────────────────── */}
      {unresolved.map((t) => (
        <Callout key={`tie-${t.rank}`} tone="amber"
          icon={<AlertTriangle size={18} color={C.amber} style={{ flexShrink: 0, marginTop: 1 }} />}>
          <p style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: '#8A4B00', lineHeight: 1.45, wordBreak: 'keep-all' }}>
            {t.rank}위 {t.size}팀 동률 · 합산연령 확인 필요
          </p>
          <p style={{ margin: '5px 0 0', fontSize: 13, fontWeight: 500, lineHeight: 1.65, color: '#5B4A2E', wordBreak: 'keep-all' }}>
            승률과 게임 득실이 동일합니다. 현장에서 합산연령을 확인한 뒤 순서를 지정해 주세요.
          </p>
          <button type="button" disabled={!!busy}
            onClick={() => { setReason(DEFAULT_REASON); setDlg({ group: g, tie: t, order: [...t.teamIds] }); }}
            style={{ ...btnPrimary, width: '100%', marginTop: 12 }}>
            <ListOrdered size={16} strokeWidth={2.4} /> 순서 지정
          </button>
        </Callout>
      ))}

      {g.policyRequired && (
        <Callout tone="red" icon={<XCircle size={18} color={C.red} style={{ flexShrink: 0, marginTop: 1 }} />}>
          <p style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: C.red, lineHeight: 1.45 }}>
            취소 경기 확인 필요 · {g.cancelledMatches}건
          </p>
          <p style={{ margin: '5px 0 0', fontSize: 13, fontWeight: 500, lineHeight: 1.65, color: '#5A3B38', wordBreak: 'keep-all' }}>
            공식 결과가 없는 경기가 있어 이 조의 순위를 확정할 수 없습니다. 경기 운영에서 복구하거나 결과를 입력해 주세요.
          </p>
          <Link href={`/admin/tournaments/${slug}/matches`} style={{
            ...btnBase, width: '100%', marginTop: 12, boxSizing: 'border-box',
            border: '1px solid #E7C3BF', background: '#fff', color: '#8F1D14', textDecoration: 'none',
          }}>
            경기 운영으로 이동 <ChevronRight size={16} strokeWidth={2.4} />
          </Link>
        </Callout>
      )}

      {phase === 'NOT_STARTED' && (
        <Callout tone="info" icon={<Clock size={17} color={C.slate} style={{ flexShrink: 0, marginTop: 1 }} />}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.6, color: C.body, wordBreak: 'keep-all' }}>
            아직 경기 전입니다. 첫 경기가 끝나면 순위가 표시됩니다.
          </p>
        </Callout>
      )}

      {/* ── 본선 진출 (FINAL · 서버 qualificationStatus 기준) ──────────── */}
      <QualifiedHero rows={qualified.map((r) => ({
        key: r.teamId, rank: r.rank === null ? '–' : `${r.rank}위`, name: standingTeamName(r),
      }))} />

      {/* ── 순위 / 참가 팀 ─────────────────────────────────────────────── */}
      <section style={sectionStyle}>
        <SectionHead
          title={phase === 'NOT_STARTED' ? '참가 팀' : settled ? '최종 순위' : '현재 순위'}
          hint={phase === 'NOT_STARTED' ? '팀 번호순' : '승률 → 게임 득실'}
        />
        {phase === 'NOT_STARTED' ? (
          [...g.standings].sort((a, b) => a.teamNo - b.teamNo).map((r) => (
            <EntryRow key={r.teamId} teamNo={r.teamNo} name={standingTeamName(r)} withdrawn={r.teamStatus === 'withdrawn'} />
          ))
        ) : (
          <RankTable settled={settled} rows={g.standings.map((r) => adminRankRow(r, phase))} />
        )}
        {phase === 'IN_PROGRESS' && (
          <p style={{ margin: 0, padding: '10px 0 6px', borderTop: `1px solid ${C.lineSoft}`, fontSize: 12, lineHeight: 1.6, color: C.muted, wordBreak: 'keep-all' }}>
            남은 경기 결과에 따라 순위가 바뀔 수 있습니다. 본선 진출은 조 경기가 모두 끝나면 확정됩니다.
          </p>
        )}
      </section>

      {/* ── 경기 결과 ───────────────────────────────────────────────────── */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SectionHead title={phase === 'NOT_STARTED' ? '예정 경기' : '경기 결과'} hint="6게임 1세트 · 노애드" inCard={false} />
        {!board ? (
          <Notice tone="info" text="경기 정보를 불러오지 못했습니다. 새로고침해 주세요." />
        ) : matches.length === 0 ? (
          <Notice tone="info" text="아직 이 조의 경기가 생성되지 않았습니다." />
        ) : (
          matches.map((m) => (
            <MatchResultCard
              key={m.matchId}
              label={`${m.sequenceNo}경기`}
              sub={`#${m.matchNo}`}
              status={matchStatusView(m.status, m.courtNo)}
              left={`${m.team1.player1Name} · ${m.team1.player2Name}`}
              right={`${m.team2.player1Name} · ${m.team2.player2Name}`}
              score1={m.score1}
              score2={m.score2}
              winner={m.status === 'completed'
                ? (m.winnerTeamId === m.team1.teamId ? 1 : m.winnerTeamId === m.team2.teamId ? 2 : null)
                : null}
              done={m.status === 'completed'}
              cancelled={m.status === 'cancelled'}
            />
          ))
        )}
      </section>

      {/* ── 이전 조 / 다음 조 — 콘텐츠 끝에 자연스럽게. 순위결정전은 포함하지 않는다. ── */}
      <PrevNextNav
        prev={prev ? { href: `${base}/${prev.groupNo}`, label: `${prev.groupNo}조` } : null}
        next={next ? { href: `${base}/${next.groupNo}`, label: `${next.groupNo}조` } : null}
      />

      {/* ── 순서 확정 다이얼로그 (기존 계약 그대로) ─────────────────────── */}
      {dlg && (
        <div role="dialog" aria-modal="true" aria-label={`${dlg.group.groupNo}조 순서 확정`} onClick={closeDlg}
          style={{
            position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,0.55)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            padding: 12, paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
          }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 440, maxHeight: 'calc(100dvh - 40px)', overflowY: 'auto',
              background: '#fff', borderRadius: 16, padding: 16, boxSizing: 'border-box',
            }}>
            <p style={{ margin: 0, fontSize: 15.5, fontWeight: 800, color: C.navy }}>
              {dlg.group.groupNo}조 — 순서 확정
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 600, color: C.muted }}>
              {dlg.tie.rank}위 동률 {dlg.tie.size}팀
            </p>
            <div style={{ ...callout, marginTop: 12, padding: '11px 12px', background: C.amberTint, border: `1px solid ${C.amberLine}` }}>
              <AlertTriangle size={15} color={C.amber} style={{ flexShrink: 0, marginTop: 2 }} />
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: C.navy, lineHeight: 1.7, wordBreak: 'keep-all' }}>
                현장에서 <strong>합산연령을 확인한 뒤</strong> 위에서부터 순서대로 놓아 주세요.
              </p>
            </div>
            <p style={{ margin: '7px 0 0', fontSize: 11.5, fontWeight: 500, color: C.muted, lineHeight: 1.7, wordBreak: 'keep-all' }}>
              나이나 생년월일은 입력하지 않습니다. 앱에는 확정된 <strong>순서만</strong> 저장됩니다.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
              {dlg.order.map((teamId, i) => {
                const row = dlg.group.standings.find((r) => r.teamId === teamId);
                const rank = previewResolvedRanks(dlg.tie)[i];
                return (
                  <div key={teamId} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 10,
                    background: C.surface, border: `1px solid ${C.line}`,
                  }}>
                    <span style={{
                      flexShrink: 0, width: 30, height: 30, borderRadius: 8, background: C.teal, color: '#fff',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800,
                    }}>{rank}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.navy, lineHeight: 1.45, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
                        {row ? standingTeamName(row) : '-'}
                      </p>
                      <p style={{ margin: '1px 0 0', fontSize: 11, fontWeight: 600, color: C.muted }}>{row ? `${row.teamNo}번` : ''}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button type="button" aria-label="위로" disabled={i === 0 || !!busy} onClick={() => move(i, -1)}
                        style={{ ...iconBtn, opacity: i === 0 ? 0.35 : 1 }}>
                        <ArrowUp size={15} strokeWidth={2.6} />
                      </button>
                      <button type="button" aria-label="아래로" disabled={i === dlg.order.length - 1 || !!busy} onClick={() => move(i, 1)}
                        style={{ ...iconBtn, opacity: i === dlg.order.length - 1 ? 0.35 : 1 }}>
                        <ArrowDown size={15} strokeWidth={2.6} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <label style={{ display: 'block', marginTop: 12 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>확인 사유 (필수)</span>
              <input value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)}
                style={{
                  display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 42, marginTop: 5,
                  padding: '8px 11px', borderRadius: 9, border: `1px solid ${C.line}`, background: '#fff',
                  fontFamily: 'inherit', fontSize: 14, color: C.navy,
                }} />
            </label>
            <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 500, color: C.muted, lineHeight: 1.6, wordBreak: 'keep-all' }}>
              사유는 운영 기록에 남습니다. 나이 숫자를 적지 말아 주세요.
            </p>

            <div style={{ display: 'flex', gap: 8, marginTop: 15 }}>
              <button type="button" onClick={closeDlg}
                style={{ ...btnBase, flex: 1, border: `1px solid ${C.line}`, background: '#fff', color: C.body }}>
                닫기
              </button>
              <button type="button"
                disabled={!!busy || reason.trim().length < 2 || !isValidTieOrder(dlg.tie, dlg.order)}
                onClick={() => void submitTie()}
                style={{
                  ...btnPrimary, flex: 2,
                  opacity: reason.trim().length >= 2 && isValidTieOrder(dlg.tie, dlg.order) ? 1 : 0.45,
                }}>
                {busy === 'resolve' ? '저장 중…' : '이 순서로 확정'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast text={toast} />}
    </div>
  );
}

const callout: React.CSSProperties = {
  display: 'flex', gap: 10, alignItems: 'flex-start', borderRadius: 14, padding: 14,
};
const btnBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  minHeight: 44, padding: '0 14px', borderRadius: 11,
  fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = {
  ...btnBase, border: 0, background: C.teal, color: '#fff',
};
const iconBtn: React.CSSProperties = {
  width: 38, height: 38, borderRadius: 9, border: `1px solid ${C.line}`, background: '#fff', color: C.body,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
};
