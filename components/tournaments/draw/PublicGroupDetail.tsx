'use client';

// 공개 DRAW — 조 상세 (read-only).
//   경기 전: 참가 팀 + 경기 일정 / 진행 중: 현재 순위 + 경기 결과 /
//   완료: 최종 순위 + 본선 진출 · 예선 탈락(서버 qualificationStatus) + 경기 결과.
//
//   ⚠⚠ 순위 · 진출 · 동률을 계산하지 않는다(rank <= 2 같은 판단 금지).
//   ⚠ 합산연령 · 나이 · 순서 지정 · 경기 운영 · 복구를 노출하지 않는다.

import React from 'react';
import { Clock, Info } from 'lucide-react';
import { TT } from '@/components/tournaments/tournamentTheme';
import {
  C, NO_RESULT_YET_NOTICE, isSettled, phaseOf, placementDisplayNo, progressText, teamName,
} from '@/components/tournaments/standings/presentation';
import {
  BackLink, Callout, DetailHeader, EntryRow, MatchResultCard, Notice, PrevNextNav, QualifiedHero,
  RankTable, SectionHead, sectionStyle,
} from '@/components/tournaments/standings/primitives';
import type { PublicPreliminaryDraw } from '@/lib/tournaments/publicDrawTypes';
import {
  publicDetailStatus, publicMatchStatus, publicNotice, publicRankRow, teamKey,
} from './publicDrawView';

export default function PublicGroupDetail({
  slug, draw, groupNo,
}: { slug: string; draw: PublicPreliminaryDraw; groupNo: number }) {
  const base = `/tournaments/${slug}/draw`;
  const idx = draw.groups.findIndex((x) => x.groupNo === groupNo);
  const g = idx >= 0 ? draw.groups[idx] : null;

  if (!g) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <BackLink href={base} label="예선 조별리그" />
        <Notice tone="info" text={`${groupNo}조를 찾을 수 없습니다.`} />
      </div>
    );
  }

  const prev = idx > 0 ? draw.groups[idx - 1] : null;
  const next = idx < draw.groups.length - 1 ? draw.groups[idx + 1] : null;
  const phase = phaseOf(g);
  const settled = isSettled(phase);
  const notice = publicNotice(g);
  const qualified = phase === 'FINAL' ? g.standings.filter((r) => r.qualificationStatus === 'QUALIFIED') : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ margin: '-6px 0 -6px' }}>
        <BackLink href={base} label="예선 조별리그" />
      </div>

      <DetailHeader
        title={`${g.groupNo}조`}
        sub={`예선 조별리그 · ${g.members}팀 · ${g.expectedMatches}경기`}
        status={publicDetailStatus(g)}
        progress={`${progressText(g)} 경기`}
      />

      {/* ── 확인 중 안내 — 서버 상태를 참가자 언어로만 ─────────────────── */}
      {notice === 'RANK_CHECK' && (
        <Callout tone="blue" icon={<Info size={17} color="#3D5A8F" style={{ flexShrink: 0, marginTop: 2 }} />}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#2E4266', lineHeight: 1.45 }}>순위 확인 중</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 500, lineHeight: 1.65, color: '#2E4266', wordBreak: 'keep-all' }}>
            승률과 게임 득실이 같아 최종 순위를 확인하고 있습니다.
          </p>
        </Callout>
      )}
      {notice === 'RESULT_CHECK' && (
        <Callout tone="blue" icon={<Info size={17} color="#3D5A8F" style={{ flexShrink: 0, marginTop: 2 }} />}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#2E4266', lineHeight: 1.45 }}>결과 확인 중</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 500, lineHeight: 1.65, color: '#2E4266', wordBreak: 'keep-all' }}>
            일부 경기 결과를 확인하고 있습니다.
          </p>
        </Callout>
      )}
      {phase === 'NOT_STARTED' && (
        <Callout tone="info" icon={<Clock size={17} color={C.slate} style={{ flexShrink: 0, marginTop: 1 }} />}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.6, color: C.body, wordBreak: 'keep-all' }}>
            {NO_RESULT_YET_NOTICE}
          </p>
        </Callout>
      )}

      <QualifiedHero rows={qualified.map((r) => ({
        key: teamKey(r), rank: r.rank === null ? '–' : `${r.rank}위`, name: teamName(r),
      }))} />

      <section style={sectionStyle}>
        <SectionHead
          title={phase === 'NOT_STARTED' ? '참가 팀' : settled ? '최종 순위' : '현재 순위'}
          hint={phase === 'NOT_STARTED' ? '팀 번호순' : '승률 → 게임 득실'}
        />
        {phase === 'NOT_STARTED' ? (
          [...g.standings].sort((a, b) => a.teamNo - b.teamNo).map((r) => (
            <EntryRow key={teamKey(r)} teamNo={r.teamNo} name={teamName(r)} withdrawn={r.withdrawn} />
          ))
        ) : (
          <RankTable settled={settled} rows={g.standings.map((r) => publicRankRow(r, phase))} />
        )}
        {phase === 'IN_PROGRESS' && (
          <p style={{ margin: 0, padding: '10px 0 6px', borderTop: `1px solid ${C.lineSoft}`, fontSize: 12, lineHeight: 1.6, color: C.muted, wordBreak: 'keep-all' }}>
            남은 경기 결과에 따라 순위가 바뀔 수 있습니다. 본선 진출은 조 경기가 모두 끝나면 확정됩니다.
          </p>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SectionHead title={phase === 'NOT_STARTED' ? '경기 일정' : '경기 결과'} hint="6게임 1세트 · 노애드" inCard={false} />
        {g.matches.length === 0 ? (
          <Notice tone="info" text="경기 일정이 아직 정해지지 않았습니다." />
        ) : (
          g.matches.map((m) => (
            <MatchResultCard
              key={`m${m.matchNo}`}
              label={`${m.sequenceNo}경기`}
              sub={null}
              status={publicMatchStatus(m)}
              left={teamName(m.team1)}
              right={teamName(m.team2)}
              score1={m.score1}
              score2={m.score2}
              winner={m.winnerSide}
              done={m.status === 'completed'}
              cancelled={m.status === 'cancelled'}
            />
          ))
        )}
      </section>

      <PrevNextNav
        prev={prev ? { href: `${base}/groups/${prev.groupNo}`, label: `${prev.groupNo}조` } : null}
        next={next ? { href: `${base}/groups/${next.groupNo}`, label: `${next.groupNo}조` }
          // 마지막 예선 조 다음은 순위결정전(N + 1조) — 표시 번호만 이어 붙인다.
          : idx === draw.groups.length - 1 && draw.placement.length > 0
            ? { href: `${base}/placement`, label: `${placementDisplayNo(draw.groups.length)}조` }
            : null}
      />

      <p style={{ margin: '2px 2px 0', fontSize: 11.5, fontWeight: 600, color: TT.subtle, lineHeight: 1.7, wordBreak: 'keep-all' }}>
        순위는 승률 → 게임 득실 순으로 정합니다. 조별 상위 {draw.qualifyPerGroup}팀이 본선에 진출합니다.
      </p>
    </div>
  );
}
