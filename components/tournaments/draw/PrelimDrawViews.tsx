'use client';

// 예선 DRAW — '모바일 대진표 / 전체 조편성표' 전환.
//
//   ⚠ 두 화면은 여기서 한 번 만든 같은 entries(조 · 선수 · 소속 · 예정 코트 · 차수 · 신고)를 쓴다 — 서로 어긋날 수 없다.
//   ⚠ 소속은 공개 참가팀 목록(get_public_tournament_teams)에서 이름이 정확히 같은 페어에만 붙인다(실패하면 소속 없이).
//   ⚠ 공개 화면에서는 DRAW 가 공개됐을 때만 이 컴포넌트가 그려진다(공개 전에는 페이지가 '공개 전' 안내).
//     관리자 미리보기는 공개 전에도 본부 조회 데이터로 같은 컴포넌트를 그린다.

import React from 'react';
import { LayoutGrid, Table2 } from 'lucide-react';
import { TT } from '@/components/tournaments/tournamentTheme';
import type { PublicPreliminaryDraw } from '@/lib/tournaments/publicDrawTypes';
import type { PublicGroupSchedule } from '@/lib/tournaments/groupScheduleModel';
import { fetchPublicTournamentTeams } from '@/lib/tournaments/publicService';
import { buildClubIndex, buildEntries, drawProgress, sessionHeaders, sortEntries, type ClubIndex } from '@/lib/tournaments/officialDrawModel';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { PUBLIC_SITE_ORIGIN } from '@/lib/tournaments/smsModel';
import OfficialDrawBoard from './OfficialDrawBoard';
import DrawSheet from './DrawSheet';

/** 공개 참가팀 목록의 소속 — 한 번만 읽는다(실패하면 소속 없이 그린다). */
function useClubIndex(slug: string): ClubIndex | null {
  const [idx, setIdx] = React.useState<ClubIndex | null>(null);
  React.useEffect(() => {
    let live = true;
    if (!slug) return;
    void fetchPublicTournamentTeams(slug).then((r) => { if (live && r.ready) setIdx(buildClubIndex(r.teams.filter((t) => t.publicStatus === 'confirmed'))); });
    return () => { live = false; };
  }, [slug]);
  return idx;
}

type View = 'board' | 'sheet';

export default function PrelimDrawViews({ slug, draw, schedule = null, basePath, view: controlledView }: {
  slug: string; draw: PublicPreliminaryDraw; schedule?: PublicGroupSchedule | null; basePath?: string;
  /** 공개 화면 — 바깥 DRAW 메뉴(대진표 | 예선 | 본선)가 보기를 정한다. 주면 안쪽 탭을 그리지 않는다. */
  view?: View;
}) {
  // 기본 = 전체 조편성표. 모바일 대진표는 ?view=board 로 바로 열 수 있다(?view=sheet 도 그대로 조편성표 · 표시 전용).
  const [innerView, setView] = React.useState<View>('sheet');
  const view = controlledView ?? innerView;
  React.useEffect(() => {
    if (controlledView) return;   // 바깥 메뉴가 주소를 다룬다
    try { if (new URLSearchParams(window.location.search).get('view') === 'board') setView('board'); } catch { /* 무시 */ }
  }, [controlledView]);
  const choose = (v: View) => {
    setView(v);
    try {
      const u = new URL(window.location.href);
      if (v === 'board') u.searchParams.set('view', 'board'); else u.searchParams.delete('view');
      window.history.replaceState(window.history.state, '', u.toString());
    } catch { /* 무시 */ }
  };

  const base = basePath ?? `/tournaments/${slug}/draw`;
  const clubs = useClubIndex(slug);
  const all = React.useMemo(() => buildEntries(draw, schedule, clubs, base), [draw, schedule, clubs, base]);
  // 모바일 대진표 · 전체 조편성표 모두 공개 조 번호 순(1조 순위결정전 → 2조 → … → 18조). 코트별 보기는 같은 배열을 코트 카드로 묶는다.
  // 탭을 바꿔도 다시 조회하지 않는다.
  const byGroup = React.useMemo(() => sortEntries(all, 'group'), [all]);
  const sessions = React.useMemo(() => sessionHeaders(schedule), [schedule]);
  const event = getOfficialTournament(slug);
  const meta = React.useMemo(() => ({
    title: `${event ? event.titleFull : slug} 예선 조편성표`,
    subtitle: event ? `${event.eventDateLabel} · ${event.venueName}` : null,
    checkinPlace: schedule?.checkinPlace ?? null,
    sessions,
    liveUrl: `${PUBLIC_SITE_ORIGIN.replace(/^https?:\/\//, '')}/tournaments/${slug}/draw`,
    order: 'group' as const,
  }), [event, slug, schedule, sessions]);

  return (
    <div className="pv-wrap">
      {!controlledView && <div className="pv-tabs" role="tablist" aria-label="대진표 보기 방식">
        <button type="button" role="tab" aria-selected={view === 'sheet'} onClick={() => choose('sheet')} data-draw-view="sheet">
          <Table2 size={15} strokeWidth={2.4} />전체 조편성표
        </button>
        <button type="button" role="tab" aria-selected={view === 'board'} onClick={() => choose('board')} data-draw-view="board">
          <LayoutGrid size={15} strokeWidth={2.4} />모바일 대진표
        </button>
      </div>}
      {view === 'board'
        ? <OfficialDrawBoard entries={byGroup} sessions={sessions} checkinPlace={schedule?.checkinPlace ?? null} progress={drawProgress(draw)} />
        : <DrawSheet entries={byGroup} meta={meta} fileBase={slug} />}
      <style>{`
.pv-wrap { display: flex; flex-direction: column; gap: 12px; }
.pv-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 12px; background: #E8EDF2; }
.pv-tabs button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 42px; border: 0; border-radius: 9px; background: transparent;
  font-family: inherit; font-size: 14px; font-weight: 800; color: #5B6B82; cursor: pointer; }
.pv-tabs button[aria-selected="true"] { background: #fff; color: ${TT.ink}; box-shadow: 0 1px 3px rgba(15,23,42,0.12); }
      `}</style>
    </div>
  );
}
