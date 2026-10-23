// YouTube LIVE — 주소 해석 · 임베드 주소 (순수 함수, 클라이언트 · 서버 공용).
//
//   ⚠ video ID(11자)는 공개 시청 식별자다. 스트림 키(송출용 비밀값)와 다르다 — 스트림 키는 이 앱 어디에도 두지 않는다.
//   ⚠ 공식 임베드만 쓴다: 플레이어 = youtube.com/embed/{id} · 채팅 = youtube.com/live_chat?v={id}&embed_domain={host}.
//     채팅 embed_domain 은 '채팅을 품은 페이지의 호스트명'이어야 한다 — 서버가 짐작하지 않고 브라우저의 location.hostname 을 쓴다.

export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export type YouTubeParse =
  | { ok: true; videoId: string }
  | { ok: false; reason: 'empty' | 'not_youtube' | 'no_video_id' | 'channel_url' };

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

/**
 * 운영진이 붙여 넣은 주소 → video ID.
 *   지원: youtube.com/watch?v=ID · youtu.be/ID · youtube.com/live/ID · youtube.com/embed/ID · youtube.com/shorts/ID
 *         · studio.youtube.com/video/ID/livestreaming · ID 11자만.
 *   ⚠ 채널 주소(/channel/… · /@handle · /c/…)는 방송마다 바뀌는 video ID 가 없으므로 받지 않는다(이유를 돌려준다).
 */
export function parseYouTubeVideoId(input: string): YouTubeParse {
  const raw = (input ?? '').trim();
  if (raw === '') return { ok: false, reason: 'empty' };
  if (YOUTUBE_ID_RE.test(raw)) return { ok: true, videoId: raw };

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: 'not_youtube' };
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  const pick = (v: string | null | undefined): YouTubeParse =>
    v && YOUTUBE_ID_RE.test(v) ? { ok: true, videoId: v } : { ok: false, reason: 'no_video_id' };

  if (host === 'youtu.be') return pick(parts[0]);
  if (host === 'studio.youtube.com') return parts[0] === 'video' ? pick(parts[1]) : { ok: false, reason: 'no_video_id' };
  if (!YT_HOSTS.has(host)) return { ok: false, reason: 'not_youtube' };

  if (parts[0] === 'watch') return pick(url.searchParams.get('v'));
  if (['live', 'embed', 'shorts', 'v'].includes(parts[0] ?? '')) return pick(parts[1]);
  if (url.searchParams.get('v')) return pick(url.searchParams.get('v'));
  if (parts[0] === 'channel' || parts[0] === 'c' || parts[0] === 'user' || (parts[0] ?? '').startsWith('@')) {
    return { ok: false, reason: 'channel_url' };
  }
  return { ok: false, reason: 'no_video_id' };
}

export const YOUTUBE_PARSE_MESSAGE: Record<Exclude<YouTubeParse, { ok: true }>['reason'], string> = {
  empty: 'YouTube 방송 주소를 입력해 주세요.',
  not_youtube: 'YouTube 주소가 아닙니다. youtube.com 또는 youtu.be 주소를 붙여 넣어 주세요.',
  no_video_id: '주소에서 방송 영상 ID를 찾지 못했습니다. YouTube 방송 페이지의 [공유] 주소를 붙여 넣어 주세요.',
  channel_url: '채널 주소가 아니라 이번 방송의 주소(watch · live · youtu.be)가 필요합니다.',
};

/** 공식 플레이어 임베드 주소. 자동재생은 음소거와 함께여야 모바일에서 동작한다(차단되면 사용자가 직접 재생). */
export function youtubeEmbedUrl(videoId: string, opts: { autoplay?: boolean } = {}): string {
  const q = new URLSearchParams({ playsinline: '1', rel: '0', modestbranding: '1' });
  if (opts.autoplay) { q.set('autoplay', '1'); q.set('mute', '1'); }
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${q.toString()}`;
}

/**
 * 공식 실시간 채팅 임베드 주소. embedDomain = 이 페이지의 호스트명(포트 · 스킴 없이).
 *   ⚠ 채팅 embed 는 방송이 실시간이고 채팅이 켜져 있어야 내용이 나온다. 로그인 · 입력은 YouTube 세션(서드파티 쿠키)에 달렸다.
 */
export function youtubeChatEmbedUrl(videoId: string, embedDomain: string): string {
  const q = new URLSearchParams({ v: videoId, embed_domain: embedDomain });
  return `https://www.youtube.com/live_chat?${q.toString()}`;
}

/** YouTube 에서 직접 시청 · 채팅(앱 또는 웹). */
export const youtubeWatchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

/** 채팅만 새 창(팝아웃). */
export const youtubeChatPopoutUrl = (videoId: string): string =>
  `https://www.youtube.com/live_chat?is_popout=1&v=${encodeURIComponent(videoId)}`;

/** 채팅 iframe 의 embed_domain — 호스트명만(포트 제거). 비어 있으면 null(채팅 iframe 을 만들지 않는다). */
export function embedDomainOf(hostname: string | null | undefined): string | null {
  const h = (hostname ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  return h === '' ? null : h;
}

/**
 * 채팅 iframe 이 잘 안 되는 것으로 알려진 브라우저(실제 확인 전 '가정'이 아니라 '바로가기 링크를 크게 보여 줄지' 판단용).
 *   카카오톡 · 네이버 · 인스타그램 · 페이스북 · 라인 인앱 브라우저는 서드파티 쿠키 · 팝업이 제한된다.
 *   ⚠ iframe 은 그래도 띄운다(읽기는 될 수 있다). 이 값은 안내 문구 · 버튼 강조에만 쓴다.
 */
export function inAppBrowserName(ua: string | null | undefined): string | null {
  const s = ua ?? '';
  if (/KAKAOTALK/i.test(s)) return '카카오톡';
  if (/NAVER\(inapp|NAVER/i.test(s) && /inapp/i.test(s)) return '네이버';
  if (/Instagram/i.test(s)) return '인스타그램';
  if (/FBAN|FBAV/i.test(s)) return '페이스북';
  if (/\bLine\//i.test(s)) return '라인';
  return null;
}

/** 카카오톡 인앱 브라우저에서 외부 브라우저로 여는 공식 스킴. 카카오톡이 아니면 null. */
export function kakaoExternalUrl(url: string, ua: string | null | undefined): string | null {
  return /KAKAOTALK/i.test(ua ?? '') ? `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}` : null;
}
