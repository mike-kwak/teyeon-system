'use client';

// YouTube LIVE 플레이어 — 공식 iframe 임베드(youtube.com/embed/{id}).
//
//   ⚠ 다시 붙이지 않는다: 20초 폴링으로 부모가 다시 그려져도 videoId · autoplay 가 같으면 iframe 은 그대로다(React.memo).
//     iframe 이 다시 붙으면 시청자의 재생 · 소리 · 전체 화면이 끊긴다.
//   ⚠ 자동재생은 음소거와 함께(모바일 정책). 그래도 막히면 YouTube 플레이어의 재생 버튼을 직접 누르면 된다.
//   ⚠ referrerPolicy 를 명시한다 — YouTube 임베드는 요청 출처(Referer)가 없으면 재생을 거부할 수 있다.
//   ⚠ playsinline=1 — iPhone 에서 누르자마자 전체 화면으로 튀지 않고 페이지 안에서 재생한다(전체 화면 버튼은 그대로).

import React from 'react';
import { TT } from '../tournamentTheme';
import { youtubeEmbedUrl } from '@/lib/tournaments/youtube';

interface Props {
  videoId: string;
  /** LIVE 는 음소거 자동재생, 다시보기는 사용자가 누를 때 재생. */
  autoplay: boolean;
  title: string;
}

function YouTubeLivePlayerImpl({ videoId, autoplay, title }: Props) {
  const src = youtubeEmbedUrl(videoId, { autoplay });
  return (
    <div
      data-yt-player={videoId}
      style={{
        position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden',
        backgroundColor: TT.navy,
      }}
    >
      <iframe
        src={src}
        title={title}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

const YouTubeLivePlayer = React.memo(
  YouTubeLivePlayerImpl,
  (a, b) => a.videoId === b.videoId && a.autoplay === b.autoplay && a.title === b.title,
);
export default YouTubeLivePlayer;
