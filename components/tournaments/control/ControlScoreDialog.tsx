'use client';

// Control Center 점수 입력 (Batch 4F-3 · 충돌 보호 4F-4a).
//
//   ⚠ 점수 규칙을 다시 쓰지 않는다 — isValidSetScore 하나만 쓴다(최종 판정은 서버).
//   ⚠ 승자를 서버로 보내지 않는다. 아래 '진출' 표시는 미리보기일 뿐이다.
//   ⚠ 진행 중 점수(게임 단위)를 다루지 않는다. 점수는 완료 때 한 번 받는다.
//   ⚠ 본선은 한 번 더 확인받는다 — 저장되는 순간 승자가 다음 자리로 올라가고
//     다음 경기까지 만들어지기 때문이다(되돌리려면 하류를 먼저 정리해야 한다).
//   ⚠ 배경 스크롤 잠금은 기존 공용 useBodyScrollLock 을 쓴다(새 구현 금지).
//   ⚠ 포커스도 기존 관행을 따른다 — 첫 칸 autoFocus + Escape 닫기. 자체 focus trap 을 만들지 않는다.
//   ⚠ match 는 모달을 **연 순간의 값**이다(부모가 고정한다). 재조회가 모달을 닫거나 바꾸지 않는다.
//     서버 상태가 달라지면 conflict 문구를 띄우고 저장만 막는다 — 입력값은 지우지 않는다.
//   ⚠ 저장 경로는 [경기 완료] 클릭 하나뿐이다. 닫기 · Escape · 배경 클릭 · 재조회는 아무 것도 저장하지 않는다.

import React from 'react';
import { isValidSetScore } from '@/lib/tournaments/matchTypes';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import type { ControlMatchRow } from './controlModel';

const INK = '#0F172A';
const INK_SOFT = '#334155';
const MUTED = '#64748B';
const FAINT = '#94A3B8';
const LINE = '#E2E8F0';
const LINE_SOFT = '#EEF2F7';
const TEAL = '#0E8C80';
const TEAL_SOFT = '#E7F3F1';
const NAVY = '#102A3D';
const LABEL = 'var(--font-rajdhani), sans-serif';

const teamText = (t: ControlMatchRow['team1']): string => {
  const names = [t.player1Name, t.player2Name].filter((x) => x.trim() !== '').join(' · ');
  return names || '—';
};

const headOf = (m: ControlMatchRow): string => (
  m.stage === 'knockout'
    ? (m.roundName ?? '본선')
    : m.groupNo !== null ? `${m.groupNo}조` : '순위결정전'
);

const btn: React.CSSProperties = {
  minHeight: 38, padding: '8px 16px', borderRadius: 9,
  fontSize: 13, fontWeight: 800, cursor: 'pointer',
  border: `1px solid ${LINE}`, background: '#fff', color: INK_SOFT,
};
const btnPrimary: React.CSSProperties = {
  ...btn, border: `1px solid ${NAVY}`, background: NAVY, color: '#fff',
};

/** 점수 한 줄 — 팀 이름과 입력칸. */
function ScoreLine({
  team, value, onChange, disabled, autoFocus,
}: {
  team: ControlMatchRow['team1']; value: string;
  onChange: (v: string) => void; disabled: boolean;
  /** 첫 줄만 true — 열리면 바로 점수를 칠 수 있게 한다. */
  autoFocus?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
      padding: '9px 0', borderBottom: `1px solid ${LINE_SOFT}`,
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{
          margin: 0, fontFamily: LABEL, fontSize: 10.5, fontWeight: 800,
          letterSpacing: '0.1em', color: FAINT,
        }}>
          TEAM {String(team.teamNo).padStart(2, '0')}
        </p>
        <p style={{
          margin: '1px 0 0', fontSize: 13.5, fontWeight: 700, color: INK, lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {teamText(team)}
        </p>
      </div>
      <input
        type="number" inputMode="numeric" min={0} max={6} value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`TEAM ${team.teamNo} 점수`}
        autoFocus={autoFocus}
        data-control-score={team.teamNo}
        style={{
          flexShrink: 0, width: 62, height: 42, textAlign: 'center',
          border: `1px solid ${LINE}`, borderRadius: 9, background: '#fff',
          fontFamily: LABEL, fontSize: 20, fontWeight: 800, color: INK,
        }}
      />
    </div>
  );
}

/** 확정 화면의 점수 한 줄(읽기 전용). */
function ConfirmLine({ team, score, win }: {
  team: ControlMatchRow['team1']; score: number; win: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
      padding: '8px 10px', borderRadius: 9,
      background: win ? TEAL_SOFT : '#F8FAFC',
    }}>
      <span style={{
        flexShrink: 0, fontFamily: LABEL, fontSize: 10.5, fontWeight: 800,
        letterSpacing: '0.1em', color: win ? TEAL : FAINT, minWidth: 54,
      }}>
        TEAM {String(team.teamNo).padStart(2, '0')}
      </span>
      <span style={{
        minWidth: 0, flex: 1, fontSize: 13, fontWeight: 700, color: win ? INK : INK_SOFT,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {teamText(team)}
      </span>
      <span style={{
        flexShrink: 0, fontFamily: LABEL, fontSize: 19, fontWeight: 800,
        color: win ? TEAL : MUTED, fontVariantNumeric: 'tabular-nums',
      }}>
        {score}
      </span>
    </div>
  );
}

export default function ControlScoreDialog({
  match, conflict, busy, onClose, onSubmit,
}: {
  match: ControlMatchRow;
  /** 모달을 연 뒤 서버에서 경기가 바뀌었으면 그 안내. null 이면 그대로다. */
  conflict: string | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (score1: number, score2: number) => void;
}) {
  const [s1, setS1] = React.useState('');
  const [s2, setS2] = React.useState('');
  // 본선 전용 2단계. 예선은 이 상태를 쓰지 않는다.
  const [confirming, setConfirming] = React.useState(false);

  // 이 모달은 열려 있을 때만 mount 된다(부모가 조건부로 그린다) → 항상 잠금.
  useBodyScrollLock(true);

  const n1 = Number(s1);
  const n2 = Number(s2);
  const filled = s1.trim() !== '' && s2.trim() !== '';
  const valid = filled && isValidSetScore(n1, n2);
  const knockout = match.stage === 'knockout';
  /** 저장 버튼을 막는 조건 — 충돌이 있으면 점수가 맞아도 보내지 않는다. */
  const blocked = busy || !valid || conflict !== null;

  // 승자 표시는 미리보기다 — 저장되는 승자는 서버가 점수에서 정한다.
  const winner = n1 > n2 ? match.team1 : match.team2;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div
      role="dialog" aria-modal="true" aria-label="경기 점수 입력"
      data-control-dialog={confirming ? 'confirm' : 'score'}
      style={{
        position: 'fixed', inset: 0, zIndex: 120,
        background: 'rgba(15,23,42,0.42)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          // ⚠ 100vh 가 아니라 100dvh — 모바일에서 키보드가 올라와도 [경기 완료] 가 잘리지 않아야 한다.
          //   넘치면 카드 안에서 스크롤된다(배경이 아니라 카드가 스크롤 주인이다).
          width: '100%', maxWidth: 390, maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto',
          background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14,
          padding: 18, display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        {/* 머리 — 어느 경기인지 먼저 확인시킨다. */}
        <div>
          <p style={{
            margin: 0, fontFamily: LABEL, fontSize: 11, fontWeight: 800,
            letterSpacing: '0.14em', color: FAINT,
          }}>
            {match.courtNo === null ? 'MATCH' : `COURT ${String(match.courtNo).padStart(2, '0')}`}
          </p>
          <p style={{ margin: '3px 0 0', fontSize: 15, fontWeight: 800, color: INK }}>
            {headOf(match)} · M{match.matchNo}
          </p>
        </div>

        {conflict !== null && (
          <p role="alert" data-control-score-conflict style={{
            margin: 0, padding: '9px 11px', borderRadius: 9,
            border: '1px solid #FDBA74', background: '#FFF7ED',
            fontSize: 12.5, fontWeight: 800, color: '#9A3412', lineHeight: 1.6,
          }}>
            {conflict}
          </p>
        )}

        {!confirming ? (
          <>
            <div>
              <ScoreLine team={match.team1} value={s1} onChange={setS1} disabled={busy} autoFocus />
              <ScoreLine team={match.team2} value={s2} onChange={setS2} disabled={busy} />
            </div>

            <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: MUTED, lineHeight: 1.6 }}>
              6:0 ~ 6:5 또는 0:6 ~ 5:6 만 입력할 수 있습니다.
              {' '}기권 · 노쇼는 상대팀 6:0 으로 입력합니다.
            </p>
            {filled && !valid && (
              <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#B91C1C' }}>
                입력한 점수로는 완료할 수 없습니다.
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} disabled={busy} style={btn}>
                취소
              </button>
              <button
                type="button"
                data-control-action={knockout ? 'score-next' : 'score-submit'}
                disabled={blocked}
                onClick={() => { if (knockout) setConfirming(true); else onSubmit(n1, n2); }}
                style={{
                  ...btnPrimary,
                  opacity: blocked ? 0.45 : 1,
                  cursor: blocked ? 'default' : 'pointer',
                }}
              >
                {knockout ? '다음' : '경기 완료'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: INK }}>
              {headOf(match)} 경기 완료
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <ConfirmLine team={match.team1} score={n1} win={n1 > n2} />
              <ConfirmLine team={match.team2} score={n2} win={n2 > n1} />
            </div>

            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: INK_SOFT, lineHeight: 1.6 }}>
              {match.isFinal
                ? '이 결과로 우승자가 확정됩니다.'
                : `TEAM ${String(winner.teamNo).padStart(2, '0')} 이(가) 다음 라운드로 진출합니다.`}
            </p>
            <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: MUTED, lineHeight: 1.6 }}>
              저장하면 승자가 다음 자리로 올라가고 이어지는 경기가 만들어집니다.
              되돌리려면 본선 대진 화면에서 정정해야 합니다.
            </p>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setConfirming(false)} disabled={busy} style={btn}>
                돌아가기
              </button>
              <button
                type="button"
                data-control-action="score-submit"
                disabled={blocked}
                onClick={() => onSubmit(n1, n2)}
                style={{
                  ...btnPrimary,
                  opacity: blocked ? 0.45 : 1,
                  cursor: blocked ? 'default' : 'pointer',
                }}
              >
                경기 완료
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
