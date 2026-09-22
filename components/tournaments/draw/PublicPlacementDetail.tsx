'use client';

// 공개 DRAW — 순위결정전 상세 (read-only). 목록에서는 일반 조 번호 흐름에 이어 'N + 1조'로 보인다.
//   ⚠ 표시 번호만 이어 붙인다. 일반 예선 조가 아니며 조별 순위에 들어가지 않는다.
//   ⚠ 두 팀 모두 본선 진출, 결과는 본선 배치 순서에만 쓰인다.
//   ⚠ 서버가 준 두 팀 · 상태 · 점수 · 승자 쪽만 표시한다.

import React from 'react';
import { Info } from 'lucide-react';
import {
  PLACEMENT_NOTICE_BODY, PLACEMENT_NOTICE_HEAD, PLACEMENT_TAG, placementDisplayNo, placementResultView,
  placementStatusView,
  teamName,
} from '@/components/tournaments/standings/presentation';
import {
  BackLink, Callout, DetailHeader, Notice, PlacementDetailBlock, PrevNextNav,
} from '@/components/tournaments/standings/primitives';
import type { PublicPreliminaryDraw } from '@/lib/tournaments/publicDrawTypes';
import { publicMatchStatus, teamKey } from './publicDrawView';

export default function PublicPlacementDetail({ slug, draw }: { slug: string; draw: PublicPreliminaryDraw }) {
  const base = `/tournaments/${slug}/draw`;
  const last = draw.groups.length > 0 ? draw.groups[draw.groups.length - 1] : null;
  const displayNo = placementDisplayNo(draw.groups.length);
  const first = draw.placement[0] ?? null;
  const done = first?.status === 'completed';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ margin: '-6px 0 -6px' }}>
        <BackLink href={base} label="예선 조별리그" />
      </div>

      <DetailHeader
        title={first ? `${displayNo}조` : PLACEMENT_TAG}
        tag={first ? PLACEMENT_TAG : undefined}
        sub={`${PLACEMENT_TAG} · 2팀 · ${draw.placement.length || 1}경기`}
        status={first ? (first.status === 'cancelled' ? publicMatchStatus({ status: 'cancelled', courtNo: null, courtName: null }) : placementStatusView(first.status)) : null}
        progress={first ? `${done ? 1 : 0} / 1 경기` : null}
      />

      <Callout tone="blue" padding="13px 14px" icon={<Info size={17} color="#3D5A8F" style={{ flexShrink: 0, marginTop: 2 }} />}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.65, color: '#2E4266', wordBreak: 'keep-all' }}>
          <strong style={{ fontWeight: 800 }}>{PLACEMENT_NOTICE_HEAD}</strong> {PLACEMENT_NOTICE_BODY}
        </p>
      </Callout>

      {draw.placement.length === 0 ? (
        <Notice tone="info" text="이 대회에는 순위결정전이 없습니다." />
      ) : (
        draw.placement.map((p) => (
          <PlacementDetailBlock
            key={`p${p.matchNo}`}
            matchLabel="1경기"
            matchSub={null}
            status={publicMatchStatus({ status: p.status, courtNo: null, courtName: null })}
            teams={p.teams.map((t, i) => {
              const rv = placementResultView(p, i === 0 ? 1 : 2, p.status === 'completed' ? p.winnerSide : null);
              return {
                key: teamKey(t), teamNo: t.teamNo, name: teamName(t),
                record: rv ? rv.record : null, diff: rv ? rv.diff : null, diffColor: rv?.diffColor,
                won: p.status === 'completed' && p.winnerSide === i + 1,
              };
            })}
            score1={p.score1}
            score2={p.score2}
            winner={p.status === 'completed' ? p.winnerSide : null}
            done={p.status === 'completed'}
          />
        ))
      )}

      <PrevNextNav
        prev={last ? { href: `${base}/groups/${last.groupNo}`, label: `${last.groupNo}조` } : null}
        next={null}
      />
    </div>
  );
}
