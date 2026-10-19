'use client';

// Control Center — 확인 필요 · 진행 중 · 대기 (Batch 4F-2 · 조작은 4F-3).
//
//   ⚠ 상태 판단은 전부 controlModel 의 순수 함수가 한다. 이 파일은 그리고 눌린 것을 올려 보낸다.
//   ⚠ 대기 목록은 '다음에 할 경기' 추천이 아니다 — 운영자가 보고 직접 고른다.
//     순서를 매기지 않고, 시스템이 코트를 고르거나 대신 호명하지 않는다.
//   ⚠ 진행 중 경기의 점수를 쓰지 않는다(점수는 완료 때 한 번 받는다).
//   ⚠ 조작은 한 번에 하나만 받는다(전역 busy). 돌고 있으면 모든 버튼이 꺼진다.
//   ⚠ 취소 · 복구 · 완료 결과 수정 버튼은 여기 두지 않는다(기존 경기 운영 · 본선 대진 화면).

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, Info, ChevronRight } from 'lucide-react';
import type { AttentionItem, ControlMatchRow, ControlWaiting } from './controlModel';
import { matchTimerState } from '@/lib/tournaments/matchTimer';
import MatchElapsedClock from '../MatchElapsedClock';
import type { CheckinLookup } from '@/lib/tournaments/checkinModel';

// 4F-1 과 같은 토큰을 쓴다(새 색 체계를 만들지 않는다).
const INK = '#0F172A';
const INK_SOFT = '#334155';
const MUTED = '#64748B';
const FAINT = '#94A3B8';
const LINE = '#E2E8F0';
const LINE_SOFT = '#EEF2F7';
const TEAL = '#0E8C80';
const TEAL_SOFT = '#E7F3F1';
const BLUE = '#2563A8';
const BLUE_SOFT = '#EAF1F8';
const AMBER_BD = '#FDE4B8';
const AMBER_BG = '#FFFBF2';
const AMBER_INK = '#9A3412';
const LABEL = 'var(--font-rajdhani), sans-serif';

const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 15,
};
const eyebrow: React.CSSProperties = {
  margin: 0, fontFamily: LABEL, fontSize: 11, fontWeight: 800,
  letterSpacing: '0.14em', color: FAINT,
};
const linkBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 2,
  fontSize: 11.5, fontWeight: 800, color: INK_SOFT, textDecoration: 'none', whiteSpace: 'nowrap',
};
const NAVY = '#102A3D';

/**
 * 줄 안의 작은 조작 버튼. primary 하나 + secondary 하나까지만 둔다(관제 화면은 조밀하다).
 *   accent = 진행 중 카드의 '경기 시작'(타이머) — 점수 입력(primary)과 구분되는 청록 테두리.
 */
function ActionButton({
  label, tone, disabled, onClick, name,
}: {
  label: string; tone: 'primary' | 'secondary' | 'accent'; disabled: boolean;
  onClick: () => void; name: string;
}) {
  const primary = tone === 'primary';
  const accent = tone === 'accent';
  return (
    <button
      type="button" data-control-action={name} disabled={disabled} onClick={onClick}
      style={{
        minHeight: 26, padding: '3px 10px', borderRadius: 7, whiteSpace: 'nowrap',
        fontSize: 11.5, fontWeight: 800,
        border: `1px solid ${primary ? NAVY : accent ? TEAL : LINE}`,
        background: primary ? NAVY : accent ? TEAL_SOFT : '#fff',
        color: primary ? '#fff' : accent ? TEAL : INK_SOFT,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

/**
 * 줄에서 쓸 수 있는 조작.
 *   ⚠ 여기서 어떤 경기를 먼저 할지 고르지 않는다 — 운영자가 누른 것을 그대로 올려 보낼 뿐이다.
 */
export interface ControlOps {
  /** 진행 중인 조작 키. '' 이 아니면 모든 버튼을 끈다. */
  busy: string;
  /** 투입할 경기로 고른 경기(코트 선택 대기). 없으면 null. */
  selectedMatchId: string | null;
  onCall: (m: ControlMatchRow) => void;
  onUncall: (m: ControlMatchRow) => void;
  /** 투입 선택 모드 진입 — 이 단계에서는 아무 것도 저장하지 않는다. */
  onPickCourt: (m: ControlMatchRow) => void;
  onCancelPick: () => void;
  onScore: (m: ControlMatchRow) => void;
  /** 경기 시작(타이머) — 코트 투입과 별개. 서버가 시작 시각을 기록한다. */
  onStartTimer: (m: ControlMatchRow) => void;
  /**
   * 서버 시계 보정값(ms) — 서버 시각 = 기기 시각 + offset.
   *   null 이면 서버가 타이머를 지원하지 않는다(타이머 SQL 이전) → 경기 시작 버튼 · 경과 시간을 모두 숨긴다.
   */
  clockOffset: number | null;
  /**
   * 팀 체크인 현황(팀 번호 → 체크인 여부) — 대기 줄의 '미체크인' 표시 전용.
   *   null 이면 모름(조회 실패 · 체크인 SQL 미적용) → 아무 표시도 하지 않는다. 투입 가능 여부와 무관하다.
   */
  checkin?: CheckinLookup | null;
}

const teamText = (t: ControlMatchRow['team1']): string => {
  const names = [t.player1Name, t.player2Name].filter((x) => x.trim() !== '').join(' · ');
  return names || '—';
};

/** 경기 구분 — 저장된 값만 쓴다. 본선 라운드 이름이 없으면 '본선' 으로 둔다(번호로 추측하지 않는다). */
const matchMeta = (m: ControlMatchRow): string => {
  const head = m.stage === 'knockout'
    ? (m.roundName ?? '본선')
    : m.groupNo !== null ? `${m.groupNo}조` : '순위결정전';
  return `${head} · M${m.matchNo}`;
};

// ── 확인 필요 ───────────────────────────────────────────────────────────────

export function ControlAttention({ items, slug }: { items: AttentionItem[]; slug: string }) {
  // ⚠ 0건이면 영역 자체를 그리지 않는다(빈 상자를 남기지 않는다).
  if (items.length === 0) return null;

  return (
    <section data-control-section="attention" style={{
      ...card, background: AMBER_BG, borderColor: AMBER_BD, padding: '13px 15px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 9 }}>
        <p style={{ ...eyebrow, color: AMBER_INK }}>ATTENTION NEEDED</p>
        <span style={{
          fontFamily: LABEL, fontSize: 12, fontWeight: 800, color: AMBER_INK,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {items.length}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {items.map((it) => (
          <div key={it.code} data-attention={it.code} style={{
            display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
          }}>
            <span style={{ flexShrink: 0, color: it.severity === 'warning' ? AMBER_INK : MUTED, display: 'flex' }}>
              {it.severity === 'warning'
                ? <AlertTriangle size={14} strokeWidth={2.4} />
                : <Info size={14} strokeWidth={2.4} />}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{
                margin: 0, fontSize: 12.5, fontWeight: 800, color: INK, lineHeight: 1.35,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {it.title}
              </p>
              <p style={{ margin: '1px 0 0', fontSize: 11.5, fontWeight: 600, color: MUTED }}>
                {it.detail}
              </p>
            </div>
            {it.link && (
              <Link href={`/admin/tournaments/${slug}/${it.link.path}`} style={linkBtn}>
                {it.link.label}
                <ChevronRight size={13} strokeWidth={2.4} />
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 경기 줄 ─────────────────────────────────────────────────────────────────

/** 대기 줄에서 체크인 안 된 팀인가 — 모르면(목록에 없음 · 조회 불가) false. 기권 팀은 표시하지 않는다. */
const isUnchecked = (lookup: CheckinLookup | null | undefined, teamNo: number): boolean => {
  const v = lookup?.get(teamNo);
  return v !== undefined && v.status === 'active' && !v.checkedIn;
};

function TeamLine({ team, unchecked = false }: { team: ControlMatchRow['team1']; unchecked?: boolean }) {
  return (
    <div data-team-line={team.teamNo} data-team-unchecked={unchecked ? '1' : undefined}
      style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
      <span style={{
        fontFamily: LABEL, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em',
        color: FAINT, flexShrink: 0, minWidth: 48,
      }}>
        TEAM {String(team.teamNo).padStart(2, '0')}
      </span>
      <span style={{
        fontSize: 12.5, fontWeight: 700, color: INK, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {teamText(team)}
      </span>
      {unchecked && (
        <span data-team-checkin-badge style={{
          flexShrink: 0, marginLeft: 'auto', padding: '1px 6px', borderRadius: 5,
          fontSize: 10.5, fontWeight: 800, color: AMBER_INK, background: AMBER_BG,
          border: `1px solid ${AMBER_BD}`, whiteSpace: 'nowrap',
        }}>
          미체크인
        </span>
      )}
    </div>
  );
}

/**
 * 진행 중 카드의 타이머 칸.
 *   시작 전 = [경기 시작] 버튼(코트 투입만으로는 흐르지 않는다) · 시작 후 = 서버 시작 시각부터 흐르는 경과 시간.
 *   ⚠ 버튼을 눌러도 바로 흐르지 않는다 — 서버 응답 뒤 재조회한 시작 시각이 오면 그때부터 보인다.
 */
function PlayingTimer({ m, ops }: { m: ControlMatchRow; ops: ControlOps }) {
  if (ops.clockOffset === null) return null;
  const t = matchTimerState(m);
  if (t.kind === 'running') {
    return (
      <MatchElapsedClock
        name={m.matchNo} startMs={t.startMs} offsetMs={ops.clockOffset}
        style={{ fontFamily: LABEL, fontSize: 17, fontWeight: 800, color: TEAL, lineHeight: 1.1 }}
      />
    );
  }
  const mine = ops.busy === `timer-${m.matchId}`;
  return (
    <ActionButton
      name={`timer-${m.matchNo}`} label={mine ? '시작 중…' : '경기 시작'} tone="accent"
      disabled={ops.busy !== ''} onClick={() => ops.onStartTimer(m)}
    />
  );
}

function PlayingRow({ m, ops }: { m: ControlMatchRow; ops: ControlOps }) {
  return (
    <div data-playing={m.matchNo} style={{
      display: 'flex', alignItems: 'center', gap: 11, minWidth: 0,
      padding: '9px 0', borderBottom: `1px solid ${LINE_SOFT}`,
    }}>
      <div style={{
        flexShrink: 0, width: 54, display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 1, padding: '4px 0', borderRadius: 8, background: TEAL_SOFT,
      }}>
        <span style={{ fontFamily: LABEL, fontSize: 9.5, fontWeight: 800, letterSpacing: '0.1em', color: TEAL }}>
          COURT
        </span>
        <span style={{
          fontFamily: LABEL, fontSize: 16, fontWeight: 800, color: TEAL, lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {m.courtNo === null ? '—' : String(m.courtNo).padStart(2, '0')}
        </span>
      </div>

      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{
          fontFamily: LABEL, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: FAINT,
        }}>
          {matchMeta(m)}
        </span>
        <TeamLine team={m.team1} />
        <TeamLine team={m.team2} />
      </div>

      <div style={{
        flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5,
      }}>
        <span style={{
          fontFamily: LABEL, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', color: TEAL,
        }}>
          PLAYING
        </span>
        <PlayingTimer m={m} ops={ops} />
        <ActionButton
          name={`score-${m.matchNo}`} label="점수 입력" tone="primary"
          disabled={ops.busy !== ''} onClick={() => ops.onScore(m)}
        />
      </div>
    </div>
  );
}

/**
 * 대기 한 줄.
 *   상태 · 경기 구분 · 조작은 윗줄에, 두 팀은 각자 한 줄씩 아래에 둔다.
 *   ⚠ 버튼을 팀 이름과 같은 줄에 두지 않는다 — 좁은 화면에서 이름이 먼저 잘리기 때문이다.
 */
function WaitingRow({ m, ops }: { m: ControlMatchRow; ops: ControlOps }) {
  const calling = m.status === 'calling';
  const picked = ops.selectedMatchId === m.matchId;
  const off = ops.busy !== '';

  return (
    <div
      data-waiting={m.matchNo}
      data-waiting-state={m.status}
      data-waiting-picked={picked ? '1' : undefined}
      style={{
        display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0,
        padding: picked ? '8px 9px' : '8px 0',
        borderBottom: `1px solid ${LINE_SOFT}`,
        background: picked ? TEAL_SOFT : undefined,
        borderRadius: picked ? 9 : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{
          flexShrink: 0, minWidth: 54, textAlign: 'center',
          fontFamily: LABEL, fontSize: 9.5, fontWeight: 800, letterSpacing: '0.08em',
          padding: '3px 6px', borderRadius: 6,
          color: calling ? BLUE : MUTED,
          background: calling ? BLUE_SOFT : '#F8FAFC',
        }}>
          {calling ? 'CALLING' : 'WAITING'}
        </span>
        <span style={{
          fontFamily: LABEL, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: FAINT,
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {matchMeta(m)}
        </span>

        <div style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', gap: 5 }}>
          {calling ? (
            <ActionButton
              name={`uncall-${m.matchNo}`} label="호명 취소" tone="secondary"
              disabled={off} onClick={() => ops.onUncall(m)}
            />
          ) : (
            <ActionButton
              name={`call-${m.matchNo}`} label="호명" tone="secondary"
              disabled={off} onClick={() => ops.onCall(m)}
            />
          )}
          {picked ? (
            <ActionButton
              name={`pick-cancel-${m.matchNo}`} label="선택 취소" tone="secondary"
              disabled={off} onClick={ops.onCancelPick}
            />
          ) : (
            <ActionButton
              name={`pick-${m.matchNo}`} label="투입" tone="primary"
              disabled={off} onClick={() => ops.onPickCourt(m)}
            />
          )}
        </div>
      </div>

      <TeamLine team={m.team1} unchecked={isUnchecked(ops.checkin, m.team1.teamNo)} />
      <TeamLine team={m.team2} unchecked={isUnchecked(ops.checkin, m.team2.teamNo)} />
    </div>
  );
}

// ── 진행 중 · 대기 ──────────────────────────────────────────────────────────

export function ControlOperations({
  playing, waiting, slug, allDone, ops,
}: {
  playing: ControlMatchRow[]; waiting: ControlWaiting; slug: string; allDone: boolean;
  ops: ControlOps;
}) {
  // 대회가 끝나 더 볼 것이 없으면 빈 상자 두 개를 만들지 않는다.
  if (allDone && playing.length === 0 && waiting.total === 0) {
    return (
      <section data-control-section="operations" style={{ ...card, textAlign: 'center', padding: '20px 15px' }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: INK_SOFT }}>
          모든 운영 경기가 종료되었습니다.
        </p>
      </section>
    );
  }

  return (
    <section data-control-section="operations" style={{
      ...card, display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap',
    }}>
      {/* 진행 중 */}
      <div style={{ flex: '1 1 380px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
          <p style={eyebrow}>NOW PLAYING</p>
          <span style={{
            fontFamily: LABEL, fontSize: 12.5, fontWeight: 800, color: playing.length ? TEAL : FAINT,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {playing.length}
          </span>
        </div>

        {playing.length === 0 ? (
          <p style={{ margin: '10px 0 2px', fontSize: 12.5, fontWeight: 600, color: FAINT }}>
            현재 진행 중인 경기가 없습니다.
          </p>
        ) : (
          <div data-playing-list>{playing.map((m) => <PlayingRow key={m.matchId} m={m} ops={ops} />)}</div>
        )}
      </div>

      {/* 대기 */}
      <div style={{ flex: '1 1 300px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
          <p style={eyebrow}>WAITING</p>
          <span style={{
            fontFamily: LABEL, fontSize: 12.5, fontWeight: 800, color: waiting.total ? INK : FAINT,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {waiting.total}
          </span>
          {waiting.calling > 0 && (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: BLUE }}>
              호명 {waiting.calling}
            </span>
          )}
        </div>

        {waiting.total === 0 ? (
          <p style={{ margin: '10px 0 2px', fontSize: 12.5, fontWeight: 600, color: FAINT }}>
            대기 중인 경기가 없습니다.
          </p>
        ) : (
          <>
            <div data-waiting-list>{waiting.rows.map((m) => <WaitingRow key={m.matchId} m={m} ops={ops} />)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
              {waiting.hidden > 0 && (
                <span style={{ fontSize: 11.5, fontWeight: 700, color: MUTED }}>
                  외 {waiting.hidden}경기
                </span>
              )}
              <Link href={`/admin/tournaments/${slug}/matches`} style={{ ...linkBtn, marginLeft: 'auto' }}>
                전체 대기 목록
                <ChevronRight size={13} strokeWidth={2.4} />
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
