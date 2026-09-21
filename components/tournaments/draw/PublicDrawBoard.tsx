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
  C, FILTERS, FILTER_LABEL, filterOf, normalizeQuery, phaseOf, progressSegments, progressText,
  rowMatches, teamName, type GroupFilter,
} from '@/components/tournaments/standings/presentation';
import {
  GroupCompactCard, LIST_CSS, PlacementCompactCard,
} from '@/components/tournaments/standings/primitives';
import type { PublicPreliminaryDraw } from '@/lib/tournaments/publicDrawTypes';
import { publicCardStatus, publicCompactRow, publicMatchStatus, teamKey } from './publicDrawView';

export default function PublicDrawBoard({ slug, draw }: { slug: string; draw: PublicPreliminaryDraw }) {
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<GroupFilter>('all');
  const q = normalizeQuery(query);
  const base = `/tournaments/${slug}/draw`;

  const groups = draw.groups;
  const counts = React.useMemo(() => {
    const c: Record<GroupFilter, number> = { all: groups.length, live: 0, pre: 0, done: 0 };
    groups.forEach((g) => { c[filterOf(g)] += 1; });
    return c;
  }, [groups]);
  const totals = groups.reduce(
    (a, g) => ({ done: a.done + g.completedMatches, all: a.all + g.generatedMatches }),
    { done: 0, all: 0 },
  );
  const pct = totals.all > 0 ? Math.round((totals.done / totals.all) * 100) : 0;

  const visible = groups.filter((g) =>
    (filter === 'all' || filterOf(g) === filter) && (!q || g.standings.some((r) => rowMatches(r, q))));
  const visiblePlacement = filter === 'all'
    ? draw.placement.filter((p) => !q || p.teams.some((t) => rowMatches(t, q)))
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── 진행 현황 ───────────────────────────────────────────────────── */}
      <div style={{ background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 14, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: TT.muted }}>
            {groups.length}개 조 · 조별 {draw.qualifyPerGroup}팀 본선 진출
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
          placeholder="팀 번호, 선수명으로 검색"
          aria-label="팀 번호, 선수명으로 검색"
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

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -4 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: TT.muted, minHeight: 24 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: TT.teal }} />
          본선 진출
        </span>
      </div>

      {/* ── 조 목록 ─────────────────────────────────────────────────────── */}
      {visible.length === 0 ? (
        <div style={{ background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 14, textAlign: 'center', padding: '26px 15px' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: TT.muted, lineHeight: 1.8 }}>
            {q ? '검색 결과가 없습니다. 팀 번호나 선수 이름을 다시 확인해 주세요.' : '해당하는 조가 없습니다.'}
          </p>
        </div>
      ) : (
        <div className="stg-grid">
          {visible.map((g) => {
            const phase = phaseOf(g);
            return (
              <GroupCompactCard
                key={`g${g.groupNo}`}
                href={`${base}/groups/${g.groupNo}`}
                ariaLabel={`${g.groupNo}조 상세정보`}
                title={`${g.groupNo}조`}
                status={publicCardStatus(g)}
                progress={progressText(g)}
                segments={progressSegments(g)}
                rows={g.standings.map((r) => publicCompactRow(r, phase, q))}
              />
            );
          })}
        </div>
      )}

      {/* ── 순위결정전 — 일반 조와 분리 ─────────────────────────────────── */}
      {visiblePlacement.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {visiblePlacement.map((p) => (
            <PlacementCompactCard
              key={`p${p.matchNo}`}
              href={`${base}/placement`}
              status={publicMatchStatus({ status: p.status, courtNo: null, courtName: null })}
              done={p.status === 'completed'}
              score1={p.score1}
              score2={p.score2}
              teams={p.teams.map((t, i) => ({
                key: teamKey(t), teamNo: t.teamNo, name: teamName(t),
                won: p.winnerSide === i + 1, hit: rowMatches(t, q),
              }))}
              note="경기 결과는 본선 배치 순서를 결정합니다."
            />
          ))}
        </div>
      )}

      <style>{LIST_CSS(C.teal)}</style>
    </div>
  );
}
