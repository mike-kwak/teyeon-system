'use client';

// Control Center — 확인 필요 · 진행 중 · 대기 (Batch 4F-2).
//
//   ⚠ 여기도 읽기 전용이다. 호명 · 투입 · 점수 · 완료 버튼을 두지 않는다(4F-3).
//   ⚠ 상태 판단은 전부 controlModel 의 순수 함수가 한다. 이 파일은 그린다.
//   ⚠ 대기 목록은 '다음에 할 경기' 추천이 아니다 — 운영자가 보고 직접 고른다.
//   ⚠ 진행 중 경기의 점수를 쓰지 않는다(점수는 완료 때 한 번 받는다).

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, Info, ChevronRight } from 'lucide-react';
import type { AttentionItem, ControlMatchRow, ControlWaiting } from './controlModel';

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

function TeamLine({ team }: { team: ControlMatchRow['team1'] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
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
    </div>
  );
}

function PlayingRow({ m }: { m: ControlMatchRow }) {
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

      <span style={{
        flexShrink: 0, fontFamily: LABEL, fontSize: 10.5, fontWeight: 800,
        letterSpacing: '0.1em', color: TEAL,
      }}>
        PLAYING
      </span>
    </div>
  );
}

function WaitingRow({ m }: { m: ControlMatchRow }) {
  const calling = m.status === 'calling';
  return (
    <div data-waiting={m.matchNo} data-waiting-state={m.status} style={{
      display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
      padding: '8px 0', borderBottom: `1px solid ${LINE_SOFT}`,
    }}>
      <span style={{
        flexShrink: 0, minWidth: 54, textAlign: 'center',
        fontFamily: LABEL, fontSize: 9.5, fontWeight: 800, letterSpacing: '0.08em',
        padding: '3px 6px', borderRadius: 6,
        color: calling ? BLUE : MUTED,
        background: calling ? BLUE_SOFT : '#F8FAFC',
      }}>
        {calling ? 'CALLING' : 'WAITING'}
      </span>

      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{
          fontFamily: LABEL, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: FAINT,
        }}>
          {matchMeta(m)}
        </span>
        <span style={{
          fontSize: 12.5, fontWeight: 700, color: INK_SOFT, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          <span style={{ fontFamily: LABEL, fontSize: 10.5, fontWeight: 800, color: FAINT, marginRight: 5 }}>
            {String(m.team1.teamNo).padStart(2, '0')}
          </span>
          {teamText(m.team1)}
          <span style={{ color: FAINT, margin: '0 6px' }}>vs</span>
          <span style={{ fontFamily: LABEL, fontSize: 10.5, fontWeight: 800, color: FAINT, marginRight: 5 }}>
            {String(m.team2.teamNo).padStart(2, '0')}
          </span>
          {teamText(m.team2)}
        </span>
      </div>
    </div>
  );
}

// ── 진행 중 · 대기 ──────────────────────────────────────────────────────────

export function ControlOperations({
  playing, waiting, slug, allDone,
}: {
  playing: ControlMatchRow[]; waiting: ControlWaiting; slug: string; allDone: boolean;
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
          <div data-playing-list>{playing.map((m) => <PlayingRow key={m.matchId} m={m} />)}</div>
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
            <div data-waiting-list>{waiting.rows.map((m) => <WaitingRow key={m.matchId} m={m} />)}</div>
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
