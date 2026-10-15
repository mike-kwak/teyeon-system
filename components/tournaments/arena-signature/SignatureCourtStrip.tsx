'use client';

// Signature — 코트 10개 (/tournaments/arena-design/signature 전용).
//
//   두 가지 모양: 하단 확정안 = 'LIVE COURT STATUS' 방송 스트립 / 이전 상단 배치 = 떨어진 카드 10장.
//   COURT 번호 + 상태 탭. 경기 중인 코트만 Navy 머리띠 + Tennis Lime 탭 · 줄로 멀리서도 보인다(V4).
//   빈 코트 · 운영 중지는 밝고 조용하게 — 경계선과 COURT 번호만 또렷하다.
//   ⚠ 보여 주는 상태는 저장된 데이터에 있는 것뿐이다 — LIVE · 빈 코트 · 운영 중지.
//     '대기중' · '예정' · 진행 중 점수 · 세트는 코트 데이터에 없다 → 만들어 표시하지 않는다.
//   ⚠ 1~10 자리 배정은 운영 코트 줄과 같은 함수(arenaCourtSlots)를 그대로 쓴다.
//   ⚠ 코트 카드에서는 이름을 줄이지 않는다(축약은 대진 64강 · 32강에서만).

import React from 'react';
import { arenaCourtSlots } from '@/components/tournaments/arena/ArenaCourtStrip';
import type { ArenaBracket, ArenaCourt, ArenaTeam } from '@/lib/tournaments/arenaTypes';
import { courtStateOf, fitTeamName, stageLabel } from './signatureModel';
import type { CourtState } from './signatureModel';
import { SIG, SIG_FONT_BODY, SIG_FONT_DISPLAY, SIG_LAYOUT, courtCode } from './signatureTheme';

const NAME_WIDTH = 160;
const BAR_H = 32;
const FOOT_H = 24;

const namesOf = (t: ArenaTeam): string[] =>
  [t.player1Name, t.player2Name].filter((s) => s.trim() !== '').length > 0
    ? [t.player1Name, t.player2Name]
    : [t.teamNo !== null ? `${t.teamNo}번 팀` : '—'];

function TeamName({ team }: { team: ArenaTeam }) {
  const fit = fitTeamName(namesOf(team), NAME_WIDTH, { base: 19, min: 16, stackMax: 16 });
  return (
    <div data-sig-name="court" style={{
      height: 38, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      fontSize: fit.fontSize, fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.015em',
      color: SIG.ink, opacity: team.withdrawn ? 0.45 : 1, minWidth: 0,
    }}>
      {fit.lines.map((l, i) => (
        <span key={i} style={{ maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l}</span>
      ))}
    </div>
  );
}

/**
 * 상태 탭 — LIVE 만 강하게(Tennis Lime 면 + Navy 글자). 빈 코트 · 운영 중지는 테두리만 있는 조용한 표시.
 *   ⚠ V4: 파란 머리띠 면적을 줄였다 — Navy 머리띠는 경기 중인 코트에만 남는다.
 */
const TAB: Record<CourtState, { label: string; bg: string; color: string; border: string }> = {
  live: { label: 'LIVE', bg: SIG.live, color: SIG.liveInk, border: SIG.live },
  empty: { label: '빈 코트', bg: 'transparent', color: SIG.muted, border: SIG.line },
  closed: { label: '운영 중지', bg: '#EFEDE8', color: SIG.faint, border: '#E4E1DA' },
};

function CourtCard({ courtNo, court, bracket }: {
  courtNo: number; court: ArenaCourt | null; bracket: ArenaBracket | null;
}) {
  const state = courtStateOf(court);
  const live = state === 'live';
  const tab = TAB[state];
  const footer = [court?.displayName ?? null, court ? stageLabel(court, bracket) : null]
    .filter((s): s is string => s !== null);

  return (
    <div data-sig-court={courtNo} data-court-state={state} style={{
      position: 'relative', minWidth: 0, height: '100%', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', borderRadius: 8, overflow: 'hidden',
      background: live ? SIG.white : state === 'closed' ? 'rgba(250,248,243,0.7)' : 'rgba(255,255,255,0.9)',
      border: `1px solid ${live ? SIG.navy : SIG.line}`,
      boxShadow: live ? `0 0 0 1px ${SIG.navy}, ${SIG.shadowCard}` : SIG.shadowCard,
    }}>
      <div style={{
        position: 'relative', height: BAR_H, flexShrink: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 6, padding: '0 6px 0 9px',
        background: live ? SIG.navy : 'transparent',
        borderBottom: live ? 'none' : `1px solid ${SIG.lineSoft}`,
      }}>
        <span style={{
          fontFamily: SIG_FONT_DISPLAY, fontSize: 16, fontWeight: 800, letterSpacing: '0.03em',
          color: live ? '#FFFFFF' : state === 'closed' ? SIG.faint : SIG.navy, whiteSpace: 'nowrap',
        }}>
          COURT {courtCode(courtNo)}
        </span>
        <span data-sig-court-tab={state} style={{
          height: live ? 22 : 20, display: 'inline-flex', alignItems: 'center', gap: 5, padding: live ? '0 7px' : '0 6px',
          borderRadius: 4, background: tab.bg, border: `1px solid ${tab.border}`, boxSizing: 'border-box',
          fontFamily: live ? SIG_FONT_DISPLAY : SIG_FONT_BODY, fontStyle: live ? 'italic' : 'normal',
          fontSize: live ? 14 : 12, fontWeight: live ? 900 : 700, letterSpacing: live ? '0.05em' : 0,
          color: tab.color, whiteSpace: 'nowrap',
        }}>
          {tab.label}
        </span>
      </div>
      {live && <span aria-hidden style={{ height: 3, flexShrink: 0, background: SIG.live }} />}

      <div style={{
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 9px',
      }}>
        {live && court?.now ? (
          <>
            <TeamName team={court.now.team1} />
            <span style={{
              alignSelf: 'center', fontFamily: SIG_FONT_DISPLAY, fontStyle: 'italic', fontSize: 11, fontWeight: 800,
              letterSpacing: '0.14em', color: SIG.faint, lineHeight: 1,
            }}>
              VS
            </span>
            <TeamName team={court.now.team2} />
          </>
        ) : (
          <span style={{
            alignSelf: 'center', fontSize: 14, fontWeight: 700, color: state === 'closed' ? SIG.faint : SIG.muted,
          }}>
            {state === 'closed' ? '사용하지 않는 코트' : '진행 중인 경기 없음'}
          </span>
        )}
      </div>

      <div style={{
        height: FOOT_H, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: live ? SIG.sky : 'transparent', borderTop: live ? 'none' : `1px solid ${SIG.lineSoft}`,
        fontSize: 13, fontWeight: 800, color: live ? SIG.inkSoft : SIG.faint, whiteSpace: 'nowrap', overflow: 'hidden',
      }}>
        {footer.length > 0 ? footer.join(' · ') : ' '}
      </div>
    </div>
  );
}

/**
 * 코트 현황 — 방송 스트립형(코트 하단 확정안).
 *   한 줄의 이어진 정보면 + 왼쪽 'LIVE COURT STATUS' 머리 칸. 칸 사이는 얇은 구분선이다(떨어진 카드가 아니다).
 *   LIVE 칸 = 위쪽 노랑 줄 + 노랑 LIVE 표시 + 아주 옅은 노랑 바탕. 빈 코트 · 운영 중지는 조용하게.
 *   ⚠ 이름 맞춤 · 상태 판정 · 단계 이름은 카드형(위)과 같은 함수를 쓴다(이름 폭 160px · 기본 19px · 두 줄 16px).
 */
const STRIP_HEAD_W = 74;

function StripCell({ courtNo, court, bracket, first }: {
  courtNo: number; court: ArenaCourt | null; bracket: ArenaBracket | null; first: boolean;
}) {
  const state = courtStateOf(court);
  const live = state === 'live';
  const footer = [court?.displayName ?? null, court ? stageLabel(court, bracket) : null]
    .filter((x): x is string => x !== null);
  return (
    <div data-sig-court={courtNo} data-court-state={state} style={{
      position: 'relative', flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column',
      borderLeft: first ? 'none' : `1px solid ${SIG.lineSoft}`,
      background: live ? 'rgba(255, 217, 61, 0.10)' : state === 'closed' ? 'rgba(239, 237, 232, 0.55)' : 'transparent',
    }}>
      {live && <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 4, background: SIG.live }} />}
      <div style={{
        height: 34, flexShrink: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        padding: '0 8px 0 10px',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap' }}>
          <span style={{
            fontFamily: SIG_FONT_DISPLAY, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.16em',
            color: state === 'closed' ? SIG.faint : SIG.muted,
          }}>
            COURT
          </span>
          <span style={{
            fontFamily: SIG_FONT_DISPLAY, fontSize: 23, fontWeight: 900, lineHeight: 1,
            color: state === 'closed' ? SIG.faint : SIG.navy, fontVariantNumeric: 'tabular-nums',
          }}>
            {courtCode(courtNo)}
          </span>
        </span>
        <span data-sig-court-tab={state} style={{
          height: 21, display: 'inline-flex', alignItems: 'center', padding: live ? '0 8px' : '0 6px',
          borderRadius: 4, boxSizing: 'border-box', whiteSpace: 'nowrap',
          background: live ? SIG.live : state === 'closed' ? '#EFEDE8' : 'transparent',
          border: `1px solid ${live ? SIG.live : state === 'closed' ? '#E4E1DA' : SIG.line}`,
          fontFamily: live ? SIG_FONT_DISPLAY : SIG_FONT_BODY, fontStyle: live ? 'italic' : 'normal',
          fontSize: live ? 13.5 : 11.5, fontWeight: live ? 900 : 700, letterSpacing: live ? '0.06em' : 0,
          color: live ? SIG.liveInk : state === 'closed' ? SIG.faint : SIG.muted,
        }}>
          {live ? 'LIVE' : state === 'closed' ? '운영 중지' : '빈 코트'}
        </span>
      </div>
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 9px',
      }}>
        {live && court?.now ? (
          <>
            <TeamName team={court.now.team1} />
            <span style={{
              alignSelf: 'center', fontFamily: SIG_FONT_DISPLAY, fontStyle: 'italic', fontSize: 11, fontWeight: 800,
              letterSpacing: '0.14em', color: SIG.faint, lineHeight: 1,
            }}>
              VS
            </span>
            <TeamName team={court.now.team2} />
          </>
        ) : (
          <span style={{
            alignSelf: 'center', fontSize: 14, fontWeight: 700, color: state === 'closed' ? SIG.faint : SIG.muted,
          }}>
            {state === 'closed' ? '사용하지 않는 코트' : '진행 중인 경기 없음'}
          </span>
        )}
      </div>
      <div style={{
        height: 24, flexShrink: 0, margin: '0 8px', borderTop: `1px solid ${SIG.lineSoft}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 800, color: live ? SIG.inkSoft : SIG.faint, whiteSpace: 'nowrap', overflow: 'hidden',
      }}>
        {footer.length > 0 ? footer.join(' · ') : ' '}
      </div>
    </div>
  );
}

function CourtStatusStrip({ courts, bracket }: { courts: ArenaCourt[]; bracket: ArenaBracket | null }) {
  const cells = arenaCourtSlots(courts);
  const liveCount = cells.filter((c) => courtStateOf(c.court) === 'live').length;
  return (
    <section aria-label="LIVE COURT STATUS" data-sig-court-strip="1" style={{
      height: SIG_LAYOUT.courtHeight, display: 'flex', boxSizing: 'border-box', borderRadius: 10, overflow: 'hidden',
      background: 'rgba(255, 255, 255, 0.95)', border: `1px solid ${SIG.line}`, boxShadow: SIG.shadowCard,
    }}>
      <div data-sig-strip-head="1" style={{
        width: STRIP_HEAD_W, flexShrink: 0, background: SIG.navy,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
        fontFamily: SIG_FONT_DISPLAY, color: '#FFFFFF', textAlign: 'center',
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, fontStyle: 'italic', fontSize: 15, fontWeight: 900,
          letterSpacing: '0.04em', color: SIG.live, lineHeight: 1,
        }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: 4, background: SIG.live }} />LIVE
        </span>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.14em', lineHeight: 1.25 }}>COURT<br />STATUS</span>
        <span style={{ marginTop: 4, fontSize: 19, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {liveCount}<span style={{ fontSize: 12, fontWeight: 700, color: '#AEB8CC' }}>/{cells.length}</span>
        </span>
      </div>
      {cells.map((c, i) => (
        <StripCell key={c.key} courtNo={c.court?.courtNo ?? c.key} court={c.court} bracket={bracket} first={i === 0} />
      ))}
    </section>
  );
}

export default function SignatureCourtStrip({ courts, bracket, variant = 'cards' }: {
  courts: ArenaCourt[]; bracket: ArenaBracket | null;
  /** cards = 떨어진 카드 10장(이전 상단 배치) · strip = 방송 스트립(하단 확정안). */
  variant?: 'cards' | 'strip';
}) {
  if (variant === 'strip') return <CourtStatusStrip courts={courts} bracket={bracket} />;
  const cells = arenaCourtSlots(courts);
  return (
    <section aria-label="코트 현황" style={{
      height: SIG_LAYOUT.courtHeight, display: 'grid',
      gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`, columnGap: SIG_LAYOUT.courtColumnGap,
      padding: '2px 2px 0', boxSizing: 'border-box',
    }}>
      {cells.map((c) => <CourtCard key={c.key} courtNo={c.court?.courtNo ?? c.key} court={c.court} bracket={bracket} />)}
    </section>
  );
}
