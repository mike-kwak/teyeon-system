'use client';

// YouTube LIVE CHAT — 공식 채팅 임베드(youtube.com/live_chat?v={id}&embed_domain={host}) + YouTube 바로가기.
//
//   ⚠ 채팅 iframe 은 영상 iframe 과 완전히 따로다. 채팅이 실패해도 영상은 그대로 재생된다.
//   ⚠ 동작한다고 가정하지 않는다: 채팅 읽기 · 로그인 · 입력은 YouTube 정책과 브라우저(서드파티 쿠키 · 인앱 브라우저)에 달렸다.
//     그래서 'YouTube에서 채팅 참여하기' 바로가기를 항상 함께 보여 준다. 카카오톡이면 외부 브라우저로 여는 버튼도 준다.
//   ⚠ embed_domain 은 서버가 짐작하지 않는다 — 브라우저에서 location.hostname 을 읽은 뒤(마운트 후) iframe 을 만든다.
//   ⚠ TEYEON 자체 채팅 · 메시지 저장은 하지 않는다.

import React from 'react';
import { MessageSquare, ExternalLink } from 'lucide-react';
import { TT, FONT_LABEL } from '../tournamentTheme';
import {
  embedDomainOf, inAppBrowserName, kakaoExternalUrl, youtubeChatEmbedUrl, youtubeWatchUrl,
} from '@/lib/tournaments/youtube';
import type { YouTubeBroadcastStatus } from '@/lib/tournaments/liveTypes';

interface Props {
  videoId: string;
  /** 방송 상태(모르면 null). 종료 · 일반 영상이면 채팅 iframe 을 만들지 않는다. */
  status: YouTubeBroadcastStatus | null;
}

const linkBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '10px 14px',
  borderRadius: 10, fontSize: 13.5, fontWeight: 800, textDecoration: 'none', boxSizing: 'border-box',
  WebkitTapHighlightColor: 'transparent', textAlign: 'center',
};

function YouTubeLiveChatImpl({ videoId, status }: Props) {
  // 마운트 후에만 아는 값 — 서버 렌더와 어긋나지 않게 처음엔 null.
  const [env, setEnv] = React.useState<{ domain: string | null; inApp: string | null; kakao: string | null } | null>(null);
  React.useEffect(() => {
    const ua = navigator.userAgent;
    setEnv({ domain: embedDomainOf(window.location.hostname), inApp: inAppBrowserName(ua), kakao: kakaoExternalUrl(youtubeWatchUrl(videoId), ua) });
  }, [videoId]);

  const closed = status === 'ended' || status === 'none';
  const watch = youtubeWatchUrl(videoId);

  return (
    <section data-yt-chat={videoId} data-yt-chat-state={closed ? 'closed' : env?.domain ? 'embed' : 'pending'} className="yt-chat"
      style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <MessageSquare size={15} strokeWidth={2.3} color={TT.teal} />
        <p style={{ margin: 0, fontFamily: FONT_LABEL, fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: TT.subtle }}>LIVE CHAT</p>
      </div>

      {closed ? (
        <div className="yt-chat-box" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, borderRadius: 12,
          background: TT.surface, border: `1px solid ${TT.line}`, textAlign: 'center',
        }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: TT.muted, lineHeight: 1.7, wordBreak: 'keep-all' }}>
            실시간 채팅은 방송 중에만 열립니다.
          </p>
        </div>
      ) : env?.domain ? (
        <div className="yt-chat-box" style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: `1px solid ${TT.line}`, background: '#fff' }}>
          <iframe
            data-yt-chat-frame
            src={youtubeChatEmbedUrl(videoId, env.domain)}
            title="YouTube 실시간 채팅"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <div className="yt-chat-box" style={{ borderRadius: 12, background: TT.surface, border: `1px solid ${TT.line}` }} />
      )}

      {!closed && (
        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: TT.subtle, lineHeight: 1.6, wordBreak: 'keep-all' }}>
          {env?.inApp
            ? `${env.inApp} 앱 안에서는 채팅 입력이 제한될 수 있습니다. 아래 버튼으로 YouTube에서 참여해 주세요.`
            : '채팅 입력에는 YouTube 로그인이 필요합니다. 입력이 안 되면 아래 버튼으로 YouTube에서 참여해 주세요.'}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a href={watch} target="_blank" rel="noopener noreferrer" data-yt-chat-link
          style={{ ...linkBtn, flex: '1 1 180px', background: TT.navy, color: '#fff', border: `1px solid ${TT.navy}` }}>
          {closed ? 'YouTube에서 보기' : 'YouTube에서 채팅 참여하기'}
          <ExternalLink size={14} strokeWidth={2.4} />
        </a>
        {env?.kakao && (
          <a href={env.kakao} data-yt-kakao-external
            style={{ ...linkBtn, flex: '1 1 140px', background: TT.surface, color: TT.inkSoft, border: `1px solid ${TT.line}` }}>
            외부 브라우저로 열기
          </a>
        )}
      </div>
    </section>
  );
}

const YouTubeLiveChat = React.memo(YouTubeLiveChatImpl, (a, b) => a.videoId === b.videoId && a.status === b.status);
export default YouTubeLiveChat;
