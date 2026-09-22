'use client';

// 예선 조별리그 메인 (운영진용) — "조를 빠르게 찾는 화면".
//
//   메인 카드에는 조 번호 · 상태 · 경기 수 · 팀 3개(+현재 순위 · 승패)만 둔다.
//   득실 · 경기별 점수 · 동률 · 합산연령 · 진출 배지는 조 상세에서 본다.
//
//   ⚠⚠ 순위를 클라이언트에서 계산하지 않는다 — standingsView.ts 참고.
//   ⚠ 경기 전 조에는 순위를 표시하지 않는다(서버 raw tie 는 운영 판단 대상이 아니다).
//   ⚠ 순위결정전(placement)은 일반 조와 섞지 않고 별도 섹션으로 둔다.
//   ⚠ Public 순위 화면이 아니다. CEO·ADMIN 전용.

import React from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, RefreshCw, Search, X as XIcon } from 'lucide-react';
import {
  C, FILTERS, FILTER_LABEL, PLACEMENT_TAG, adminCompactRow, anyMatchStarted, cardStatus, filterOf,
  groupMatches, needsAttention,
  normalizeQuery, phaseOf, placementDisplayNo, placementFilterOf, placementStatusView, progressSegments,
  progressText, rowMatches, useStandingsData, type GroupFilter,
} from '@/components/tournaments/standingsView';
import {
  GroupCompactCard, LIST_CSS, Toast,
} from '@/components/tournaments/standings/primitives';
import DrawPublishPanel from '@/components/tournaments/DrawPublishPanel';
import { PUBLIC_DRAW_ENABLED } from '@/lib/tournaments/publicDrawFlags';

export default function StandingsBoard({ slug }: { slug: string }) {
  const { standings, board, ready, loading, error, reload } = useStandingsData(slug);
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<GroupFilter>('all');
  const [attentionOnly, setAttentionOnly] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const say = React.useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(''), 4200);
  }, []);

  const groups = React.useMemo(() => standings?.groups ?? [], [standings]);
  const placement = standings?.placement ?? [];
  const q = normalizeQuery(query);
  // 조 경기 중 하나라도 시작됐는가 — 라벨 · 필터 표시 전용(서버 상태 불변). board 가 없으면 false.
  const started = React.useCallback(
    (groupNo: number) => anyMatchStarted(groupMatches(board, groupNo).map((m) => m.status)),
    [board],
  );

  // ⚠ 순위결정전은 DB 상 placement 그대로다. 목록에서만 일반 조 번호 흐름(N + 1조)에 이어 보여준다.
  const counts = React.useMemo(() => {
    const c: Record<GroupFilter, number> = { all: groups.length + placement.length, live: 0, pre: 0, done: 0 };
    groups.forEach((g) => { c[filterOf(g, started(g.groupNo))] += 1; });
    placement.forEach((p) => { c[placementFilterOf(p.status)] += 1; });
    return c;
  }, [groups, placement, started]);
  const attentionCount = groups.filter(needsAttention).length;

  const totals = groups.reduce(
    (a, g) => ({ done: a.done + g.completedMatches, all: a.all + g.generatedMatches }),
    { done: placement.filter((p) => p.status === 'completed').length, all: placement.length },
  );
  const pct = totals.all > 0 ? Math.round((totals.done / totals.all) * 100) : 0;

  const visible = groups.filter((g) =>
    (filter === 'all' || filterOf(g, started(g.groupNo)) === filter)
    && (!attentionOnly || needsAttention(g))
    && (!q || g.standings.some((r) => rowMatches(r, q))));

  const visiblePlacement = placement
    .map((p, i) => ({ p, no: placementDisplayNo(groups.length, i) }))
    .filter(({ p }) =>
      (filter === 'all' || placementFilterOf(p.status) === filter)
      && (!attentionOnly || p.status === 'cancelled')
      && (!q || p.teams.some((t) => rowMatches(t, q))));

  if (!ready) {
    return (
      <div style={{ ...card, background: C.amberTint, border: `1px solid ${C.amberLine}`, display: 'flex', gap: 9 }}>
        <AlertTriangle size={17} color={C.amber} style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.navy, lineHeight: 1.7 }}>
          {error || '순위를 불러올 수 없습니다.'}<br />
          <code style={{ fontSize: 11.5 }}>supabase/add_hosted_tournament_standings.sql</code> 적용 여부와 CEO·ADMIN 권한을 확인해 주세요.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── 진행 현황 ───────────────────────────────────────────────────── */}
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px 8px', flexWrap: 'wrap', flex: 1, minWidth: 0, fontSize: 12.5 }}>
            {/* ⚠ board 를 못 불러오면 '작성 중'으로 단정하지 않는다 — 아예 표시하지 않는다. */}
            {board && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700,
                color: board.drawStatus === 'locked' ? C.tealText : C.amber,
              }}>
                {board.drawStatus === 'locked'
                  ? <CheckCircle2 size={14} strokeWidth={2.4} />
                  : <AlertTriangle size={14} strokeWidth={2.4} />}
                조편성 {board.drawStatus === 'locked' ? '확정' : '작성 중'}
              </span>
            )}
            {standings && (
              <span style={{ color: C.muted, fontWeight: 600 }}>조별 {standings.qualifyPerGroup}팀 진출</span>
            )}
          </div>
          <span style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: C.muted }}>
            경기 <strong style={{ fontSize: 17, fontWeight: 800, color: C.navy, fontVariantNumeric: 'tabular-nums' }}>{totals.done}</strong> / {totals.all}
          </span>
          <button type="button" onClick={() => void reload()} disabled={loading} aria-label="새로고침"
            style={{
              flexShrink: 0, width: 36, height: 36, borderRadius: 9, border: `1px solid ${C.line}`,
              background: '#fff', color: C.body, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', opacity: loading ? 0.5 : 1,
            }}>
            <RefreshCw size={15} strokeWidth={2.3} />
          </button>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: '#E9EDF3', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: 6, borderRadius: 3, background: C.teal }} />
        </div>
      </div>

      {/* ── DRAW 공개 관리 — 기능 스위치가 켜진 뒤(migration 적용 후)에만 ───── */}
      {PUBLIC_DRAW_ENABLED && <DrawPublishPanel slug={slug} onChanged={() => void reload()} onMessage={say} />}

      {/* ── 검색 ────────────────────────────────────────────────────────── */}
      <label style={{
        display: 'flex', alignItems: 'center', gap: 9, height: 46, boxSizing: 'border-box',
        padding: '0 6px 0 13px', background: '#fff', border: '1px solid #DCE2EA', borderRadius: 12,
      }}>
        <Search size={17} color={C.muted} strokeWidth={2.3} style={{ flexShrink: 0 }} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="팀 번호, 선수명으로 검색"
          aria-label="팀 번호, 선수명으로 검색"
          style={{
            flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent',
            fontFamily: 'inherit', fontSize: 15, color: C.navy,
          }}
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="검색어 지우기"
            style={{
              flexShrink: 0, width: 34, height: 34, border: 0, borderRadius: 8, background: 'transparent',
              color: C.faint, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
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
                color: on ? C.navy : '#5B6B82', background: on ? '#fff' : 'transparent',
                boxShadow: on ? '0 1px 3px rgba(15,23,42,0.10)' : 'none',
              }}>
              {FILTER_LABEL[f]} <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}>{counts[f]}</span>
            </button>
          );
        })}
      </div>

      {/* ── 확인 필요 · 범례 ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: -4 }}>
        {attentionCount > 0 ? (
          <button type="button" aria-pressed={attentionOnly} onClick={() => setAttentionOnly((v) => !v)}
            style={{
              minHeight: 38, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px',
              marginLeft: -4, border: `1px solid ${attentionOnly ? C.amberLine : 'transparent'}`, borderRadius: 9,
              background: attentionOnly ? C.amberTint : 'transparent', fontFamily: 'inherit',
              fontSize: 12.5, fontWeight: 700, color: '#8A4B00', cursor: 'pointer',
            }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.amberDot }} />
            확인 필요 {attentionCount}개 조
            {attentionOnly ? <XIcon size={13} strokeWidth={2.6} /> : <ChevronRight size={14} strokeWidth={2.4} />}
          </button>
        ) : <span />}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: C.muted }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: C.teal }} />
          본선 진출
        </span>
      </div>

      {/* ── 조 목록 ─────────────────────────────────────────────────────── */}
      {visible.length + visiblePlacement.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '26px 15px' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.muted, lineHeight: 1.8 }}>
            {loading ? '불러오는 중…'
              : groups.length === 0 ? '예선 조가 없습니다. 조편성과 경기 생성을 먼저 진행해 주세요.'
              : q ? '검색 결과가 없습니다.' : '해당하는 조가 없습니다.'}
          </p>
        </div>
      ) : (
        <div className="stg-grid">
          {visible.map((g) => {
            const phase = phaseOf(g);
            return (
              <GroupCompactCard
                key={g.groupId}
                href={`/admin/tournaments/${slug}/standings/${g.groupNo}`}
                ariaLabel={`${g.groupNo}조 상세정보`}
                title={`${g.groupNo}조`}
                status={cardStatus(g, started(g.groupNo))}
                progress={progressText(g)}
                segments={progressSegments(g)}
                rows={g.standings.map((r) => adminCompactRow(r, phase, q))}
              />
            );
          })}
          {/* 순위결정전 — 일반 조와 같은 카드로, 번호만 N + 1조로 이어 붙인다(작은 보조 라벨로 구분). */}
          {visiblePlacement.map(({ p, no }) => {
            const done = p.status === 'completed';
            return (
              <GroupCompactCard
                key={p.matchId}
                href={`/admin/tournaments/${slug}/standings/placement`}
                ariaLabel={`${no}조 순위결정전 상세정보`}
                title={`${no}조`}
                tag={PLACEMENT_TAG}
                status={p.status === 'cancelled' ? { label: '확인 필요', color: C.amber } : placementStatusView(p.status)}
                progress={`${done ? 1 : 0} / 1`}
                segments={[done ? C.teal : p.status === 'cancelled' ? C.amberDot : C.line]}
                rows={p.teams.map((t) => ({
                  key: t.teamId, p1: t.player1Name, p2: t.player2Name, rank: null,
                  tone: { bg: '#fff', fg: C.navy, bd: C.line },
                  record: done ? (p.winnerTeamId === t.teamId ? '승' : '패') : null,
                  diff: null,   // 순위결정전은 일반 조 standings 가 아니다 — 득실 없음
                  muted: done && p.winnerTeamId !== t.teamId,
                  hit: rowMatches(t, q),
                }))}
              />
            );
          })}
        </div>
      )}

      <style>{LIST_CSS(C.teal)}</style>
      {toast && <Toast text={toast} />}
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '13px 14px',
};
