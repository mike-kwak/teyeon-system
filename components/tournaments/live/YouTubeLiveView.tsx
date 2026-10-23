'use client';

// YouTube 소스 LIVE 화면 — 영상 · 지금 중계 경기 · 실시간 채팅 배치.
//
//   PC(≥1100px): 왼쪽 영상, 아래 경기 정보 / 오른쪽 채팅(영상 높이에 맞춘 고정 높이 · 채팅 안에서만 스크롤).
//   모바일: 영상 → 경기 정보 → 채팅(고정 높이 · 페이지를 밀어내지 않음) → YouTube 바로가기.
//   ⚠ 어떤 영상을 틀지(LIVE · 다시보기)는 부모가 정한다. 여기서는 배치만 한다.
//   ⚠ 각 iframe 은 memo 컴포넌트라 폴링으로 다시 그려져도 다시 붙지 않는다.

import React from 'react';
import YouTubeLivePlayer from './YouTubeLivePlayer';
import YouTubeLiveChat from './YouTubeLiveChat';
import type { YouTubeBroadcastStatus } from '@/lib/tournaments/liveTypes';

interface Props {
  /** 지금 플레이어에 띄울 영상(LIVE 또는 다시보기). */
  playId: string;
  autoplay: boolean;
  /** 채팅을 붙일 방송 ID. null 이면 채팅 칸 없음(다시보기 전용 영상 등). */
  chatId: string | null;
  status: YouTubeBroadcastStatus | null;
  /** 영상 아래 경기 정보(없으면 null). */
  match: React.ReactNode;
}

export default function YouTubeLiveView({ playId, autoplay, chatId, status, match }: Props) {
  return (
    <div className={`yt-live${chatId ? '' : ' yt-live--nochat'}`} data-yt-live>
      <div className="yt-live__video">
        <YouTubeLivePlayer videoId={playId} autoplay={autoplay} title={autoplay ? 'TEYEON OPEN LIVE' : 'TEYEON OPEN 다시보기'} />
      </div>
      {match && <div className="yt-live__match">{match}</div>}
      {chatId && (
        <div className="yt-live__chat">
          <YouTubeLiveChat videoId={chatId} status={status} />
        </div>
      )}
      <style>{`
        .yt-live { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); grid-template-areas: "video" "match" "chat"; min-width: 0; }
        .yt-live__video { grid-area: video; min-width: 0; }
        .yt-live__match { grid-area: match; min-width: 0; }
        .yt-live__chat  { grid-area: chat;  min-width: 0; }
        /* 모바일 채팅 — 화면을 다 덮지 않는 높이. 채팅 안에서만 스크롤된다. */
        .yt-live .yt-chat-box { height: min(420px, 60vh); min-height: 300px; }
        @media (min-width: 1100px) {
          .yt-live { grid-template-columns: minmax(0, 1fr) 360px; grid-template-areas: "video chat" "match chat"; grid-template-rows: auto 1fr; align-items: start; }
          .yt-live--nochat { grid-template-columns: minmax(0, 1fr); grid-template-areas: "video" "match"; }
          .yt-live .yt-chat-box { height: 560px; }
        }
      `}</style>
    </div>
  );
}
