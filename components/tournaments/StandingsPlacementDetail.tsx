'use client';

// 순위결정전 상세 (운영진용) — 목록에서는 일반 조 번호 흐름에 이어 'N + 1조'로 보인다.
//   ⚠ 표시 번호만 이어 붙인다. DB 는 group_type = 'placement' 그대로이며 예선 순위 계산에 들어가지 않는다.
//   ⚠ 두 팀 모두 본선 진출, 결과는 본선 배치 순서에만 쓰인다.
//   ⚠ get_preliminary_standings 의 placement 항목(팀 · 상태 · 점수 · 승자)만 표시한다.

import React from 'react';
import { AlertTriangle, Info, RefreshCw } from 'lucide-react';
import {
  C, PLACEMENT_NOTICE_BODY, PLACEMENT_NOTICE_HEAD, PLACEMENT_TAG, placementDisplayNo,
  placementResultView, placementStatusView, matchStatusView, teamName, useStandingsData,
} from '@/components/tournaments/standingsView';
import {
  BackLink, Callout, DetailHeader, Notice, PlacementDetailBlock, PrevNextNav,
} from '@/components/tournaments/standings/primitives';

export default function StandingsPlacementDetail({ slug }: { slug: string }) {
  const { standings, ready, loading, error, reload } = useStandingsData(slug);
  const base = `/admin/tournaments/${slug}/standings`;
  const list = standings?.placement ?? [];
  const groups = [...(standings?.groups ?? [])].sort((a, b) => a.groupNo - b.groupNo);
  const last = groups.length > 0 ? groups[groups.length - 1] : null;
  const displayNo = placementDisplayNo(groups.length);
  const first = list[0] ?? null;
  const done = first?.status === 'completed';

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

      <DetailHeader
        title={first ? `${displayNo}조` : PLACEMENT_TAG}
        tag={first ? PLACEMENT_TAG : undefined}
        sub={`${PLACEMENT_TAG} · 2팀 · ${list.length || 1}경기`}
        status={first ? (first.status === 'cancelled' ? { label: '확인 필요', color: C.amber } : placementStatusView(first.status)) : null}
        progress={first ? `${done ? 1 : 0} / 1 경기` : null}
      />

      <Callout tone="blue" padding="13px 14px" icon={<Info size={17} color="#3D5A8F" style={{ flexShrink: 0, marginTop: 2 }} />}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.65, color: '#2E4266', wordBreak: 'keep-all' }}>
          <strong style={{ fontWeight: 800 }}>{PLACEMENT_NOTICE_HEAD}</strong> {PLACEMENT_NOTICE_BODY}
        </p>
      </Callout>

      {list.length === 0 ? (
        <Notice tone="info" text={loading ? '불러오는 중…' : '이 대회에는 순위결정전이 없습니다.'} />
      ) : (
        list.map((p) => {
          const pDone = p.status === 'completed';
          const winner = !pDone ? null
            : p.winnerTeamId === p.teams[0]?.teamId ? 1
            : p.winnerTeamId === p.teams[1]?.teamId ? 2 : null;
          return (
            <PlacementDetailBlock
              key={p.matchId}
              matchLabel="1경기"
              matchSub={`#${p.matchNo}`}
              status={matchStatusView(p.status)}
              teams={p.teams.map((t, i) => {
                const rv = placementResultView(p, i === 0 ? 1 : 2, winner);
                return {
                  key: t.teamId, teamNo: t.teamNo, name: teamName(t),
                  record: rv ? rv.record : null, diff: rv ? rv.diff : null, diffColor: rv?.diffColor,
                  won: winner === i + 1,
                };
              })}
              score1={p.score1}
              score2={p.score2}
              winner={winner}
              done={pDone}
            />
          );
        })
      )}

      {/* 이전 조(마지막 예선 조) / 다음 조 없음 */}
      <PrevNextNav
        prev={last ? { href: `${base}/${last.groupNo}`, label: `${last.groupNo}조` } : null}
        next={null}
      />
    </div>
  );
}
