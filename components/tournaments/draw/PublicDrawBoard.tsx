'use client';

// 공개 DRAW — 예선 조별리그 메인 (참가자 · 관람객 · read-only).
//   "내 이름 검색 → 내 조 발견 → 조 상세" 가 폰에서 빠르게 되도록 한다.
//
//   ⚠⚠ 순위 · 진출을 계산하지 않는다(서버 값 그대로). 경기 전 조에는 순위를 표시하지 않는다.
//   ⚠ 운영 기능(새로고침 버튼 · 확인 필요 필터 · 공개 관리)을 두지 않는다.

import React from 'react';
import { Search, X as XIcon } from 'lucide-react';
import { TT } from '@/components/tournaments/tournamentTheme';
import {
  C, FILTERS, FILTER_LABEL, filterOf, normalizeQuery, phaseOf, placementDisplayNoFor, placementTitle,
  placementFilterOf, placementResultView, placementStatusView, progressSegments, progressText, rowMatches, type GroupFilter,
} from '@/components/tournaments/standings/presentation';
import {
  GroupCompactCard, LIST_CSS,
} from '@/components/tournaments/standings/primitives';
import type { PublicPreliminaryDraw } from '@/lib/tournaments/publicDrawTypes';
import { scheduleForGroup, type PublicGroupSchedule } from '@/lib/tournaments/groupScheduleService';
import { GroupScheduleLine } from './PublicScheduleInfo';
import { groupFirstMatch, isFirstUpcoming, placementFirstMatch } from '@/lib/tournaments/firstMatchModel';
import { FirstMatchLine, firstMarkFor } from './FirstMatchMarks';
import {
  publicCardStatus, publicCompactRow, publicGroupStarted, publicMatchStatus, teamKey,
} from './publicDrawView';

export default function PublicDrawBoard({
  slug, draw, schedule = null, basePath,
}: {
  slug: string; draw: PublicPreliminaryDraw;
  /** 조별 일정(예정 코트 · 순서 · 신고 마감). 없으면 카드에 일정 줄을 그리지 않는다. */
  schedule?: PublicGroupSchedule | null;
  /** 조 상세 링크의 기준 경로(관리자 미리보기용). 기본은 공개 DRAW. */
  basePath?: string;
}) {
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<GroupFilter>('all');
  const q = normalizeQuery(query);
  const base = basePath ?? `/tournaments/${slug}/draw`;

  const groups = draw.groups;
  const placement = draw.placement;
  // ⚠ 순위결정전은 일반 조가 1 ~ N 일 때만 N + 1조로 이어 붙이고, 아니면 '순위결정전' 으로만 보여준다(표시 전용 — 순위 계산과 무관).
  const counts = React.useMemo(() => {
    const c: Record<GroupFilter, number> = { all: groups.length + placement.length, live: 0, pre: 0, done: 0 };
    groups.forEach((g) => { c[filterOf(g, publicGroupStarted(g))] += 1; });
    placement.forEach((p) => { c[placementFilterOf(p.status)] += 1; });
    return c;
  }, [groups, placement]);
  const totals = groups.reduce(
    (a, g) => ({ done: a.done + g.completedMatches, all: a.all + g.generatedMatches }),
    { done: placement.filter((p) => p.status === 'completed').length, all: placement.length },
  );
  const pct = totals.all > 0 ? Math.round((totals.done / totals.all) * 100) : 0;
  // 첫 경기를 앞둔 조가 하나라도 있을 때만 노란 표시 범례를 보인다.
  const anyFirst = groups.some((g) => isFirstUpcoming(groupFirstMatch(g.matches, null)))
    || placement.some((p) => isFirstUpcoming(placementFirstMatch(p, null)));

  const visible = groups.filter((g) =>
    (filter === 'all' || filterOf(g, publicGroupStarted(g)) === filter) && (!q || g.standings.some((r) => rowMatches(r, q))));
  const visiblePlacement = placement
    .map((p, i) => ({ p, no: placementDisplayNoFor(groups.map((g) => g.groupNo), i) }))
    .filter(({ p }) => (filter === 'all' || placementFilterOf(p.status) === filter)
      && (!q || p.teams.some((t) => rowMatches(t, q))));

  return (
    <div className="tt-draw-board" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── 진행 현황 ───────────────────────────────────────────────────── */}
      <div style={{ background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 14, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: TT.muted }}>
            {groups.length + placement.length}개 조 · 조별 {draw.qualifyPerGroup}팀 본선 진출
          </span>
          <span style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: TT.muted }}>
            경기 <strong style={{ fontSize: 17, fontWeight: 800, color: TT.ink, fontVariantNumeric: 'tabular-nums' }}>{totals.done}</strong> / {totals.all}
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: '#E9EDF3', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: 6, borderRadius: 3, background: TT.teal }} />
        </div>
      </div>

      {/* ── 검색 ────────────────────────────────────────────────────────── */}
      <label style={{
        display: 'flex', alignItems: 'center', gap: 9, height: 48, boxSizing: 'border-box',
        padding: '0 6px 0 13px', background: TT.surface, border: '1px solid #DCE2EA', borderRadius: 12,
      }}>
        <Search size={17} color={TT.muted} strokeWidth={2.3} style={{ flexShrink: 0 }} />
        <input
          id="draw-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="선수명으로 검색"
          aria-label="선수명으로 검색"
          style={{
            flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent',
            fontFamily: 'inherit', fontSize: 16, color: TT.ink,
          }}
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="검색어 지우기"
            style={{
              flexShrink: 0, width: 36, height: 36, border: 0, borderRadius: 8, background: 'transparent',
              color: TT.subtle, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}>
            <XIcon size={16} strokeWidth={2.4} />
          </button>
        )}
      </label>

      {/* ── 상태 필터 ───────────────────────────────────────────────────── */}
      <div className="stg-filter" role="group" aria-label="조 상태 필터">
        {FILTERS.map((f) => {
          const on = filter === f;
          return (
            <button key={f} type="button" aria-pressed={on} onClick={() => setFilter(f)}
              style={{
                minHeight: 40, border: 0, borderRadius: 9, padding: '0 4px', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 700 : 600, whiteSpace: 'nowrap',
                color: on ? TT.ink : '#5B6B82', background: on ? '#fff' : 'transparent',
                boxShadow: on ? '0 1px 3px rgba(15,23,42,0.10)' : 'none',
              }}>
              {FILTER_LABEL[f]} <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}>{counts[f]}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', columnGap: 14, marginTop: -4 }}>
        {/* 노란 표시 = 그 조의 첫 경기에 나가는 팀(안내 전용 — 승패 · 진출과 무관). */}
        {anyFirst && <span data-first-legend style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: TT.muted, minHeight: 24 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: '#FFF1BF', boxShadow: 'inset 0 0 0 1.5px #E5B300' }} />
          첫 경기 출전
        </span>}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: TT.muted, minHeight: 24 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: TT.teal }} />
          본선 진출
        </span>
      </div>

      {/* ── 조 목록 ─────────────────────────────────────────────────────── */}
      {visible.length + visiblePlacement.length === 0 ? (
        <div style={{ background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 14, textAlign: 'center', padding: '26px 15px' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: TT.muted, lineHeight: 1.8 }}>
            {q ? '검색 결과가 없습니다. 선수 이름을 다시 확인해 주세요.' : '해당하는 조가 없습니다.'}
          </p>
        </div>
      ) : (
        <div className="stg-grid">
          {visible.map((g) => {
            const phase = phaseOf(g);
            const sched = scheduleForGroup(schedule, g.groupNo);
            // 첫 경기 — 실제 경기 행(조 안 순서가 가장 이른 경기)에서만. 경기가 없으면 '경기 순서 준비 중'.
            const fm = groupFirstMatch(g.matches, sched);
            return (
              <GroupCompactCard
                key={`g${g.groupNo}`}
                href={`${base}/groups/${g.groupNo}`}
                ariaLabel={`${g.groupNo}조 상세정보`}
                title={`${g.groupNo}조`}
                status={publicCardStatus(g)}
                progress={progressText(g)}
                segments={progressSegments(g)}
                rows={g.standings.map((r) => ({ ...publicCompactRow(r, phase, q), first: firstMarkFor(fm, r.teamNo) }))}
                extra={<>
                  <FirstMatchLine info={fm} pending={g.matches.length === 0} />
                  <GroupScheduleLine info={sched} done={phase === 'FINAL'} />
                </>}
              />
            );
          })}
          {/* 순위결정전 — 일반 조와 같은 카드로, 번호만 N + 1조로 이어 붙인다(작은 보조 라벨로 구분). */}
          {visiblePlacement.map(({ p, no }) => {
            const done = p.status === 'completed';
            const sched = scheduleForGroup(schedule, p.groupNo);
            const fm = placementFirstMatch(p, sched);
            return (
              <GroupCompactCard
                key={`p${p.matchNo}`}
                href={`${base}/placement`}
                ariaLabel={no === null ? '순위결정전 상세정보' : `${no}조 순위결정전 상세정보`}
                {...placementTitle(no)}
                status={p.status === 'cancelled'
                  ? publicMatchStatus({ status: 'cancelled', courtNo: null, courtName: null })
                  : placementStatusView(p.status)}
                progress={`${done ? 1 : 0} / 1`}
                segments={[done ? C.teal : C.line]}
                extra={<>
                  <FirstMatchLine info={fm} pending={false} />
                  <GroupScheduleLine info={sched} done={done} />
                </>}
                rows={p.teams.map((t, i) => {
                  // 순위결정전 결과 표시 — 공식 경기 점수 기준(일반 조 gameDiff 와 무관)
                  const rv = placementResultView(p, i === 0 ? 1 : 2, p.winnerSide);
                  return {
                    key: teamKey(t), p1: t.player1Name, p2: t.player2Name, rank: null,
                    tone: { bg: '#fff', fg: C.navy, bd: C.line },
                    record: rv ? rv.record : null,
                    diff: rv ? rv.diff : null,
                    diffColor: rv?.diffColor,
                    muted: done && p.winnerSide !== i + 1,
                    hit: rowMatches(t, q),
                    first: firstMarkFor(fm, t.teamNo),
                  };
                })}
              />
            );
          })}
        </div>
      )}

      <style>{LIST_CSS(C.teal)}</style>
      {/* 공개 화면 전용 — 휴대폰 폭(560px 미만)에서는 조 카드를 1열로 둔다.
          2열이면 카드 폭이 좁아 긴 이름(‘Alexander Maximilian’ · ‘남궁하늘빛바다’)이 단어 중간에서 끊긴다.
          ⚠ 관리자 순위 화면과 같이 쓰는 LIST_CSS 는 건드리지 않는다. */}
      <style>{`@media (max-width: 559px) { .tt-draw-board .stg-grid { grid-template-columns: minmax(0, 1fr); } }`}</style>
    </div>
  );
}
