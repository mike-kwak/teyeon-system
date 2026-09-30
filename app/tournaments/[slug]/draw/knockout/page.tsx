'use client';

// 공개 DRAW — 본선 토너먼트 (/tournaments/[slug]/draw/knockout).
//   데이터는 공개 RPC get_public_knockout_bracket 하나만 쓴다(원본 테이블 접근 없음).
//   ⚠ 공개 여부는 서버가 판정한다. 비공개면 내부 구조(draft · locked · version)를 알려주지 않는다.
//   ⚠ 이번 단계는 최초 1회 조회만 한다. 자동 갱신(polling)은 다음 단계다.

import React from 'react';
import { useParams } from 'next/navigation';
import { CalendarClock } from 'lucide-react';
import {
  BackToHub, DrawHeading, DrawNotFound, DrawStageTabs, PublicDrawShell, useDrawEvent,
} from '@/components/tournaments/draw/PublicDrawShell';
import PublicKnockoutBracket from '@/components/tournaments/draw/PublicKnockoutBracket';
import { TT } from '@/components/tournaments/tournamentTheme';
import { usePublicKnockoutBracket } from '@/components/tournaments/draw/publicKnockoutView';

/** 안내 카드 — 공개 전 · 오류 모두 같은 틀을 쓴다(예선 DRAW 와 같은 형태). */
function Notice({ title, desc }: { title: string; desc?: string }) {
  return (
    <div style={{
      background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 14, padding: '26px 18px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center',
    }}>
      <CalendarClock size={26} color={TT.teal} strokeWidth={2} />
      <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: TT.ink, lineHeight: 1.5, wordBreak: 'keep-all' }}>
        {title}
      </p>
      {desc && (
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: TT.muted, lineHeight: 1.65, wordBreak: 'keep-all' }}>
          {desc}
        </p>
      )}
    </div>
  );
}

export default function TournamentKnockoutDrawPage() {
  const params = useParams<{ slug: string }>();
  const { event } = useDrawEvent(params?.slug);
  const slug = event ? event.slug : '';

  // ⚠ 45초 주기 갱신 + 화면 복귀 시 즉시 재조회. 배경 갱신은 화면을 비우지 않는다.
  const { bracket, loading, failed, updatedAt } = usePublicKnockoutBracket(slug);

  if (!event) return <DrawNotFound />;
  const hubHref = `/tournaments/${event.slug}`;

  return (
    <PublicDrawShell event={event} published={!!bracket}>
      <DrawHeading title="대진표" sub={event.titleFull} />
      <DrawStageTabs slug={event.slug} active="knockout" knockoutOpen />
      {loading ? (
        <Notice title="불러오는 중…" />
      ) : failed ? (
        // ⚠ DB 오류 원문을 보여주지 않는다.
        <Notice title="본선 대진 정보를 불러오지 못했습니다."
          desc="잠시 후 다시 확인해 주세요." />
      ) : bracket ? (
        <PublicKnockoutBracket bracket={bracket} updatedAt={updatedAt} />
      ) : (
        // ⚠ 비공개 사유(미확정 · 미공개 · 대회 비공개)를 구분해 알려주지 않는다.
        <Notice title="본선 대진은 아직 공개되지 않았습니다."
          desc="예선이 끝나고 본선 대진이 공개되면 이곳에서 바로 확인할 수 있습니다." />
      )}
      <BackToHub hubHref={hubHref} />
    </PublicDrawShell>
  );
}
