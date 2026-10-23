// LIVE 화면 — YouTube 소스에서 무엇을 틀지 정하는 순수 함수(클라이언트 · 테스트 공용).

import type { LiveSourceInfo, YouTubeBroadcastStatus } from './liveTypes';

export interface YouTubePlan { playId: string; autoplay: boolean; chatId: string | null; status: YouTubeBroadcastStatus | null }

/**
 * YouTube 화면에서 무엇을 틀지.
 *   · 방송 종료 · 일반 영상 → 다시보기 ID(있으면) 아니면 같은 방송 ID(YouTube 가 다시보기로 바꿔 준다) · 자동재생 없음 · 채팅 닫힘
 *   · 그 밖(방송 전 · 중 · 모름) → 방송 ID · 음소거 자동재생 · 채팅
 *   · 방송 ID 없이 다시보기 ID 만 있으면 다시보기.
 *   null = YouTube 로 보여 줄 영상이 없음 → Cloudflare 화면.
 */
export function youtubePlan(src: LiveSourceInfo | undefined): YouTubePlan | null {
  if (!src || src.source !== 'youtube') return null;
  const live = src.youtubeVideoId; const replay = src.youtubeReplayVideoId;
  const over = src.youtubeStatus === 'ended' || src.youtubeStatus === 'none';
  if (live && !over) return { playId: live, autoplay: true, chatId: live, status: src.youtubeStatus };
  if (replay || live) return { playId: (replay ?? live)!, autoplay: false, chatId: live, status: live ? (src.youtubeStatus ?? 'ended') : 'none' };
  return null;
}
