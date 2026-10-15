'use client';

// Signature 예선 — 조 순위 벽 (/tournaments/arena-design/signature/prelim 전용).
//
//   20개 조를 조 카드로 한 화면에 — 기본 5열 × 4행(조 수 · 영역에 따라 chooseGroupGrid 가 고른다).
//   조 카드: 조 번호 · 진행 상태(색으로 구분) · LIVE 코트 · 팀 줄(조당 2~3팀 — 순위 · 팀 번호 · 선수명 · 승패 · 득실).
//
//   ⚠ 순위 · 진출 · 동률을 여기서 계산하지 않는다.
//     rank · qualificationStatus · rankingStatus 는 서버(여기서는 서버를 흉내 낸 fixture)가 준 값 그대로다.
//     글자 · 단계 규칙은 Admin · 공개 화면 · 운영 Arena 와 같은 helper(standings/presentation)를 쓴다.
//   ⚠ LIVE 코트는 코트 데이터에서만 온다 — 그 코트에서 지금 진행 중(playing)인 예선 경기의 조 번호.
//     호명 · 다음 경기 · 순위결정전 LIVE 를 추측해 만들지 않는다.
//   ⚠ 선수명은 줄이지 않는다(축약 없음). 길면 선수별 두 줄로 끝까지 보인다.

import React from 'react';
import {
  displayStageOf, gameDiffView, isSettled, phaseOf, rankText,
} from '@/components/tournaments/standings/presentation';
import { chooseGroupGrid } from '@/lib/tournaments/arenaGroupGrid';
import type { ArenaCourt, ArenaGroup, ArenaStandingRow } from '@/lib/tournaments/arenaTypes';
import { fitTeamName } from './signatureModel';
import { SIG, SIG_FONT_BODY, SIG_FONT_DISPLAY } from './signatureTheme';

/** 조 카드 사이 틈. */
const GAP = 12;

/**
 * 조 카드 윤곽 — TV 실물 검수(10-16): 20개 조가 촘촘해 카드 경계가 약했다.
 *   외곽선을 한 단계 진하게 · 굵게(2px — 브라우저는 1.5px 를 1px 로 그린다), 머리띠(조 번호 줄)와 팀 목록 사이에도
 *   또렷한 경계를 둔다.
 *   2차(10-16): Premium Raised Card — 은은한 하단 그림자(SIG.shadowRaised)로 배경에서 살짝 떠 보이게, 본문은 불투명 흰색,
 *   머리띠 경계선을 한 단계 진하게 해 머리띠와 본문을 분리한다. glow · blur 없음.
 */
const CARD_BORDER = '#C8C0B0';
const HEAD_RULE = '#D5CDBD';

/**
 * 경기 진행 칸 — 조의 '예정 경기 수(서버 집계 expectedMatches)' 만큼 그린다(2팀 조 · 3팀 조가 다르다 — 3칸 고정이 아니다).
 *   완료(코발트 · 확정 조는 골드) · 취소(호박) · 남은 경기(흰 칸 + 진한 테두리). TV 에서 보이도록 8px → 16px 로 키웠다.
 */
const PIP = { size: 16, gap: 5, radius: 3 };

/** 진행 상태별 색 — 경기 전(회색) · 진행 중(코발트) · 순위 확인 필요(호박) · 순위 확정(골드). */
const PHASE_TONE = {
  pre: { label: '경기 전', fg: SIG.muted, bar: '#D6CFC1', head: '#F3F0E9' },
  live: { label: '진행 중', fg: SIG.royal, bar: SIG.royal, head: 'rgba(46, 90, 172, 0.06)' },
  check: { label: '순위 확인 필요', fg: '#9A5A00', bar: '#E0A43A', head: '#FFF6E2' },
  done: { label: '순위 확정', fg: SIG.goldDeep, bar: SIG.gold, head: SIG.goldSoft },
} as const;
type ToneKey = keyof typeof PHASE_TONE;

/** 조별 LIVE 코트 — 코트 데이터에서 지금 진행 중인 예선 경기의 조 번호만 읽는다. */
export function liveCourtsByGroup(courts: ArenaCourt[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  courts.forEach((c) => {
    const now = c.now;
    if (!now || now.stage !== 'preliminary' || now.groupNo === null) return;
    const list = map.get(now.groupNo) ?? [];
    list.push(c.courtNo);
    map.set(now.groupNo, list.sort((a, b) => a - b));
  });
  return map;
}

interface Metrics {
  headH: number;
  rankW: number;
  rankFont: number;
  noW: number;
  recordW: number;
  nameBase: number;
  nameMin: number;
  recordFont: number;
}

/** 칸 크기에 맞춘 치수 — 칸이 높으면(코트 미포함) 글자를 한 단계 키운다. */
function metricsFor(cellH: number, rows: number): Metrics {
  // 팀 줄 하나가 52px 이상 나오면(코트 미포함 · 2~3팀 조) 한 단계 크게.
  const roomy = (cellH - 54) / Math.max(rows, 1) >= 52;
  return roomy
    ? { headH: 46, rankW: 34, rankFont: 19, noW: 24, recordW: 70, nameBase: 21, nameMin: 17, recordFont: 18 }
    : { headH: 40, rankW: 30, rankFont: 17, noW: 22, recordW: 64, nameBase: 19, nameMin: 16, recordFont: 16 };
}

function TeamRow({ row, settled, m, width, height }: {
  row: ArenaStandingRow; settled: boolean; m: Metrics; width: number; height: number;
}) {
  const rank = rankText(row);
  const diff = gameDiffView(row);
  const qualified = settled && row.qualificationStatus === 'QUALIFIED';
  const out = settled && row.qualificationStatus === 'NOT_QUALIFIED';
  const tieOpen = settled && row.rank === null && !row.withdrawn;
  const padX = 10;
  const nameW = width - padX * 2 - m.rankW - m.noW - m.recordW - 8 * 3;
  const stackMax = Math.min(m.nameBase, Math.floor(((height - 4) / 2.12) * 2) / 2);
  const fit = fitTeamName([row.player1Name, row.player2Name], nameW, { base: m.nameBase, min: m.nameMin, stackMax });

  return (
    <div data-prelim-row={row.teamNo} data-rank={rank} data-qual={row.qualificationStatus}
      data-row-look={qualified ? 'qualified' : out ? 'out' : tieOpen ? 'tie' : 'normal'}
      style={{
        position: 'relative', height, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8,
        padding: `0 ${padX}px`, borderRadius: 6,
        background: qualified ? '#F2F6FD' : 'transparent',
        boxShadow: qualified ? `inset 3px 0 0 ${SIG.royal}` : 'none',
        opacity: row.withdrawn ? 0.45 : 1,
      }}>
      <span style={{
        width: m.rankW, height: m.rankW - 4, flexShrink: 0, borderRadius: 6, display: 'grid', placeItems: 'center',
        boxSizing: 'border-box', fontFamily: SIG_FONT_DISPLAY, fontSize: m.rankFont, fontWeight: 900,
        fontVariantNumeric: 'tabular-nums',
        background: qualified ? SIG.royal : out ? '#EFEFEC' : tieOpen ? '#FFF6E2' : '#FFFFFF',
        color: qualified ? '#FFFFFF' : out ? SIG.faint : tieOpen ? '#9A5A00' : rank === '–' ? SIG.faint : SIG.navy,
        border: `1.5px solid ${qualified ? SIG.royal : out ? '#EFEFEC' : tieOpen ? '#E0A43A' : SIG.line}`,
      }}>
        {rank}
      </span>
      <span style={{
        width: m.noW, flexShrink: 0, textAlign: 'right', fontFamily: SIG_FONT_DISPLAY, fontSize: 13, fontWeight: 800,
        color: SIG.faint, fontVariantNumeric: 'tabular-nums',
      }}>
        {row.teamNo}
      </span>
      <span data-sig-name="prelim" style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        fontSize: fit.fontSize, lineHeight: fit.lines.length > 1 ? 1.06 : 1.15, letterSpacing: '-0.015em',
        fontWeight: qualified ? 900 : out ? 600 : 700, color: out ? SIG.muted : SIG.ink,
      }}>
        {fit.lines.map((l, i) => (
          <span key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l}</span>
        ))}
      </span>
      <span style={{
        width: m.recordW, flexShrink: 0, display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 8,
        fontFamily: SIG_FONT_DISPLAY, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>
        {row.withdrawn ? (
          <span style={{ fontFamily: SIG_FONT_BODY, fontSize: 13, fontWeight: 800, color: SIG.muted }}>기권</span>
        ) : (
          <>
            <span style={{ fontSize: m.recordFont, fontWeight: 800, color: row.played === 0 ? SIG.faint : SIG.inkSoft }}>
              {row.played === 0 ? '0-0' : `${row.wins}-${row.losses}`}
            </span>
            <span style={{
              minWidth: 26, textAlign: 'right', fontSize: m.recordFont - 2, fontWeight: 800,
              color: !diff ? SIG.faint : row.gameDiff > 0 ? SIG.royal : SIG.muted,
            }}>
              {diff ? diff.text : '·'}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

function GroupCard({ group, live, width, height }: {
  group: ArenaGroup; live: number[]; width: number; height: number;
}) {
  const phase = phaseOf(group);
  const settled = isSettled(phase);
  const stage = displayStageOf(group, live.length > 0);
  const tone: ToneKey = phase === 'AGE_CHECK' ? 'check' : phase === 'FINAL' ? 'done' : stage === 'live' ? 'live' : 'pre';
  const t = PHASE_TONE[tone];
  const rows = group.rows.length;
  // 2팀 조도 3팀 조와 같은 줄 높이 · 글자 크기를 쓴다 — 옆 조와 줄이 가로로 맞고, 남는 칸은 비워 둔다
  //   (가짜 팀 · 빈 팀 줄을 그리지 않는다. 조당 2~3팀이 실제 대회 규칙).
  const slots = Math.max(rows, 3);
  const m = metricsFor(height, slots);
  const bodyH = height - m.headH - 6 - 8;      // 위 색 줄 · 아래 여백
  const rowH = bodyH / slots;
  const total = group.expectedMatches;

  return (
    <div data-prelim-group={group.groupNo} data-phase={tone} data-live-courts={live.join(',')}
      style={{
        position: 'relative', width, height, boxSizing: 'border-box', borderRadius: 10, overflow: 'hidden',
        background: SIG.white, border: `2px solid ${CARD_BORDER}`, boxShadow: SIG.shadowRaised,
        display: 'flex', flexDirection: 'column',
      }}>
      <span aria-hidden style={{ height: 4, flexShrink: 0, background: live.length > 0 ? SIG.live : t.bar }} />
      <div data-prelim-head="1" style={{
        height: m.headH, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 12px',
        background: t.head, borderBottom: `2px solid ${HEAD_RULE}`, minWidth: 0,
      }}>
        <span style={{ fontSize: m.headH >= 46 ? 25 : 23, fontWeight: 900, color: SIG.navy, letterSpacing: '-0.02em', lineHeight: 1 }}>
          {group.groupNo}<span style={{ fontSize: '0.78em', marginLeft: 1 }}>조</span>
        </span>
        <span data-prelim-status={tone} style={{
          fontSize: 13.5, fontWeight: 800, color: t.fg, whiteSpace: 'nowrap',
        }}>
          {tone === 'done' ? '✓ ' : ''}{t.label}
        </span>
        {/* 경기 진행 점 — 완료 · 취소 · 남은 경기 개수(서버 집계 그대로) */}
        <span data-prelim-pips={total} aria-label={`${group.completedMatches}/${total} 경기 완료`}
          style={{ display: 'inline-flex', gap: PIP.gap, marginLeft: 2, flexShrink: 0 }}>
          {Array.from({ length: total }, (_, i) => {
            const state = i < group.completedMatches ? 'done'
              : i < group.completedMatches + group.cancelledMatches ? 'cancelled' : 'open';
            return (
              <span key={i} data-prelim-pip={state} style={{
                width: PIP.size, height: PIP.size, borderRadius: PIP.radius, boxSizing: 'border-box',
                background: state === 'done' ? (tone === 'done' ? SIG.gold : SIG.royal)
                  : state === 'cancelled' ? '#E0A43A' : '#FFFFFF',
                border: state === 'open' ? '2px solid #B4AC9C' : 'none',
              }} />
            );
          })}
        </span>
        <span style={{ flex: 1 }} />
        {live.map((c) => (
          <span key={c} data-prelim-live={c} style={{
            height: 24, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 8px', borderRadius: 4,
            background: SIG.live, color: SIG.liveInk, fontFamily: SIG_FONT_DISPLAY, fontStyle: 'italic',
            fontSize: 13.5, fontWeight: 900, letterSpacing: '0.03em', whiteSpace: 'nowrap',
          }}>
            C{c} LIVE
          </span>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: '3px 0 5px', display: 'flex', flexDirection: 'column' }}>
        {group.rows.map((r) => (
          <TeamRow key={r.teamNo} row={r} settled={settled} m={m} width={width} height={rowH} />
        ))}
      </div>
    </div>
  );
}

export interface SignatureGroupWallProps {
  groups: ArenaGroup[];
  courts: ArenaCourt[];
  width: number;
  height: number;
}

export default function SignatureGroupWall({ groups, courts, width, height }: SignatureGroupWallProps) {
  const live = React.useMemo(() => liveCourtsByGroup(courts), [courts]);
  if (groups.length === 0) {
    return (
      <div data-arena-board="preliminary" style={{ width, height, display: 'grid', placeItems: 'center' }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: SIG.muted }}>예선 조가 아직 없습니다.</span>
      </div>
    );
  }
  // 열 · 행은 조 수와 영역 비율로 고른다(20조 → 5 × 4, 16조 → 4 × 4). 칸이 이름 한 줄을 담을 만큼 넓은 쪽.
  const grid = chooseGroupGrid({
    count: groups.length, width, height, gap: GAP, minCellWidth: 300, minCellHeight: 150, targetAspect: 1.8,
  });
  return (
    <div data-arena-board="preliminary" data-grid={`${grid.columns}x${grid.rows}`} style={{
      width, height, display: 'grid', gap: GAP,
      gridTemplateColumns: `repeat(${grid.columns}, ${grid.cellWidth}px)`,
      gridTemplateRows: `repeat(${grid.rows}, ${grid.cellHeight}px)`,
    }}>
      {groups.map((g) => (
        <GroupCard key={g.groupNo} group={g} live={live.get(g.groupNo) ?? []} width={grid.cellWidth} height={grid.cellHeight} />
      ))}
    </div>
  );
}
