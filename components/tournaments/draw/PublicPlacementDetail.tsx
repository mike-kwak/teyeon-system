'use client';

// 공개 DRAW — 순위결정전 상세 (read-only).
//   ⚠ 일반 예선 조가 아니다. 두 팀 모두 본선 진출이며 결과는 본선 배치 순서만 정한다.
//   ⚠ 서버가 준 두 팀 · 상태 · 점수 · 승자 쪽만 표시한다.

import React from 'react';
import { Info } from 'lucide-react';
import { teamName } from '@/components/tournaments/standings/presentation';
import {
  BackLink, Callout, DetailHeader, Notice, PlacementDetailBlock,
} from '@/components/tournaments/standings/primitives';
import type { PublicPreliminaryDraw } from '@/lib/tournaments/publicDrawTypes';
import { publicMatchStatus, teamKey } from './publicDrawView';

export default function PublicPlacementDetail({ slug, draw }: { slug: string; draw: PublicPreliminaryDraw }) {
  const base = `/tournaments/${slug}/draw`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ margin: '-6px 0 -6px' }}>
        <BackLink href={base} label="예선 조별리그" />
      </div>

      <DetailHeader title="순위결정전" sub={`예선 · 2팀 · ${draw.placement.length || 1}경기`} status={null} progress={null} />

      <Callout tone="blue" padding="13px 14px" icon={<Info size={17} color="#3D5A8F" style={{ flexShrink: 0, marginTop: 2 }} />}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.65, color: '#2E4266', wordBreak: 'keep-all' }}>
          <strong style={{ fontWeight: 800 }}>두 팀 모두 본선에 진출합니다.</strong> 경기 결과는 본선 배치 순서를 결정합니다.
        </p>
      </Callout>

      {draw.placement.length === 0 ? (
        <Notice tone="info" text="이 대회에는 순위결정전이 없습니다." />
      ) : (
        draw.placement.map((p) => (
          <PlacementDetailBlock
            key={`p${p.matchNo}`}
            matchNo={p.matchNo}
            status={publicMatchStatus({ status: p.status, courtNo: null, courtName: null })}
            teams={p.teams.map((t) => ({ key: teamKey(t), teamNo: t.teamNo, name: teamName(t) }))}
            score1={p.score1}
            score2={p.score2}
            winner={p.status === 'completed' ? p.winnerSide : null}
            done={p.status === 'completed'}
          />
        ))
      )}
    </div>
  );
}
