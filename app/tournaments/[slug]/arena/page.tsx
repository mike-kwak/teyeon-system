'use client';

export const dynamic = 'force-dynamic';

// Arena TV — 현장 상시 표시 화면 (/tournaments/[slug]/arena).
//
//   HQ 노트북의 두 번째 화면(32인치 TV)에 띄워 두는 **운영 화면**이다.
//   ⚠ 공개 화면이 아니다 — Control Center 와 같은 운영 RPC 를 쓴다.
//     권한이 없으면 RPC 가 아무 것도 주지 않는다(화면도 데이터를 보여 주지 않는다).
//   ⚠ 공개 DRAW · 공개 본선의 공개 여부와 무관하게 동작한다.
//   ⚠ 예선 ↔ 본선을 자동으로 바꾸지 않는다. 운영자가 고른다(?mode=prelim | knockout).

import React from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import ArenaShell from '@/components/tournaments/arena/ArenaShell';
import ArenaBoardPlaceholder from '@/components/tournaments/arena/ArenaBoardPlaceholder';
import ArenaGroupWall from '@/components/tournaments/arena/ArenaGroupWall';
import { arenaBoardHeight, arenaBoardWidth } from '@/components/tournaments/arena/arenaTheme';
import { useArenaData } from '@/components/tournaments/arena/arenaView';
import type { ArenaMode } from '@/lib/tournaments/arenaTypes';

/** 주소에 쓰는 짧은 이름 ↔ 내부 mode. */
const MODE_PARAM: Record<ArenaMode, string> = { preliminary: 'prelim', knockout: 'knockout' };
const modeFromParam = (v: string | null): ArenaMode =>
  v === 'knockout' ? 'knockout' : 'preliminary';

export default function TournamentArenaPage() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const router = useRouter();

  const slug = typeof params?.slug === 'string'
    ? params.slug
    : Array.isArray(params?.slug) ? params!.slug[0] : '';
  const event = getOfficialTournament(slug);

  const mode = modeFromParam(search?.get('mode') ?? null);
  const state = useArenaData(event ? slug : '', mode);

  const onModeChange = React.useCallback((next: ArenaMode) => {
    // 주소에 남겨 둔다 — 새 창으로 열어도 같은 화면이 뜬다.
    router.replace(`/tournaments/${slug}/arena?mode=${MODE_PARAM[next]}`);
  }, [router, slug]);

  if (!event) {
    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
        background: '#F7F9FB', color: '#2F4A60', fontSize: 16, fontWeight: 600,
      }}>
        대회를 찾을 수 없습니다.
      </div>
    );
  }

  return (
    <ArenaShell
      title={event.titleFull}
      mode={mode}
      onModeChange={onModeChange}
      state={state}
    >
      {mode === 'preliminary' && state.snapshot ? (
        <ArenaGroupWall
          groups={state.snapshot.groups}
          qualifyPerGroup={state.snapshot.qualifyPerGroup}
          width={arenaBoardWidth()}
          height={arenaBoardHeight()}
        />
      ) : (
        // 본선 보드는 4E-3 에서 채운다.
        <ArenaBoardPlaceholder mode={mode} />
      )}
    </ArenaShell>
  );
}
