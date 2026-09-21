'use client';

// 순위결정전 상세 (운영진용).
//   ⚠ 일반 예선 조가 아니다. 두 팀 모두 본선 진출이며, 결과는 본선 배치 순서에만 쓰인다.
//   ⚠ get_preliminary_standings 의 placement 항목(팀 · 상태 · 점수 · 승자)만 표시한다.
//     순위 · 진출을 여기서 만들지 않고, 본선 slot 도 만들지 않는다.

import React from 'react';
import { AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { C, matchStatusView, teamName, useStandingsData } from '@/components/tournaments/standingsView';
import {
  BackLink, Callout, DetailHeader, Notice, PlacementDetailBlock,
} from '@/components/tournaments/standings/primitives';

export default function StandingsPlacementDetail({ slug }: { slug: string }) {
  const { standings, ready, loading, error, reload } = useStandingsData(slug);
  const base = `/admin/tournaments/${slug}/standings`;
  const list = standings?.placement ?? [];

  if (!ready) {
    return (
      <Notice tone="warn" icon={<AlertTriangle size={17} color={C.amber} style={{ flexShrink: 0, marginTop: 1 }} />}
        text={error || '순위를 불러올 수 없습니다. 순위 기능 적용 여부와 CEO·ADMIN 권한을 확인해 주세요.'} />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '-4px 0 -6px' }}>
        <BackLink href={base} label="예선 조별리그" />
        <button type="button" onClick={() => void reload()} disabled={loading} aria-label="새로고침"
          style={{
            width: 40, height: 40, border: 0, borderRadius: 10, background: 'transparent', color: C.body,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            opacity: loading ? 0.5 : 1,
          }}>
          <RefreshCw size={17} strokeWidth={2.3} />
        </button>
      </div>

      <DetailHeader title="순위결정전" sub={`예선 · 2팀 · ${list.length || 1}경기`} status={null} progress={null} />

      <Callout tone="blue" padding="13px 14px" icon={<Info size={17} color="#3D5A8F" style={{ flexShrink: 0, marginTop: 2 }} />}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.65, color: '#2E4266', wordBreak: 'keep-all' }}>
          <strong style={{ fontWeight: 800 }}>두 팀 모두 본선에 진출합니다.</strong> 이 경기는 일반 조 순위와 별개이며,
          결과는 본선 배치 순서를 정하는 데에만 쓰입니다.
        </p>
      </Callout>

      {list.length === 0 ? (
        <Notice tone="info" text={loading ? '불러오는 중…' : '이 대회에는 순위결정전이 없습니다.'} />
      ) : (
        list.map((p) => {
          const done = p.status === 'completed';
          const winner = !done ? null
            : p.winnerTeamId === p.teams[0]?.teamId ? 1
            : p.winnerTeamId === p.teams[1]?.teamId ? 2 : null;
          return (
            <PlacementDetailBlock
              key={p.matchId}
              matchNo={p.matchNo}
              status={matchStatusView(p.status)}
              teams={p.teams.map((t) => ({ key: t.teamId, teamNo: t.teamNo, name: teamName(t) }))}
              score1={p.score1}
              score2={p.score2}
              winner={winner}
              done={done}
            />
          );
        })
      )}
    </div>
  );
}
