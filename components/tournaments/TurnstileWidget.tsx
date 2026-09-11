'use client';

// Cloudflare Turnstile 위젯 — 참가신청 폼 전용.
//
//   ⚠ 이 컴포넌트가 하는 일은 '토큰을 받아 부모에게 넘기는 것'뿐이다.
//     통과 여부 판정은 전적으로 서버(/api/tournaments/[slug]/register)가 한다.
//   ⚠ site key 는 공개값이라 NEXT_PUBLIC_ 로 노출되어도 된다. secret 은 절대 여기 오지 않는다.
//   ⚠ site key 가 없으면 위젯을 렌더하지 않는다. 그 경우 토큰이 비어 제출 버튼이 잠기고,
//     서버도 not_configured 로 차단한다(fail-closed 일관).

import React from 'react';
import { TT } from './tournamentTheme';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SCRIPT_ID = 'cf-turnstile-script';

/** 서버 검증과 반드시 같은 값 — lib/tournaments/server/turnstile.ts TURNSTILE_ACTION */
const ACTION = 'tournament_register';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('no window'));
    if (window.turnstile) return resolve();
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('load failed')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.id = SCRIPT_ID;
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('load failed'));
    document.head.appendChild(s);
  });
}

export interface TurnstileHandle {
  /** 제출 실패 후 토큰을 새로 받기 위해 위젯을 초기화한다(토큰은 1회용). */
  reset: () => void;
}

interface Props {
  /** 토큰 발급/만료 알림. 만료·오류 시 null 이 온다. */
  onToken: (token: string | null) => void;
}

const TurnstileWidget = React.forwardRef<TurnstileHandle, Props>(function TurnstileWidget(
  { onToken },
  ref,
) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const widgetIdRef = React.useRef<string | null>(null);
  const onTokenRef = React.useRef(onToken);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  React.useImperativeHandle(ref, () => ({
    reset: () => {
      try {
        if (window.turnstile && widgetIdRef.current) window.turnstile.reset(widgetIdRef.current);
      } catch {
        // 위젯이 이미 정리된 경우 — 무시.
      }
      onTokenRef.current(null);
    },
  }));

  React.useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !hostRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(hostRef.current, {
          sitekey: siteKey,
          action: ACTION,
          theme: 'light',
          size: 'flexible',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'timeout-callback': () => onTokenRef.current(null),
          'error-callback': () => {
            onTokenRef.current(null);
            setFailed(true);
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      try {
        if (window.turnstile && widgetIdRef.current) window.turnstile.remove(widgetIdRef.current);
      } catch {
        // no-op
      }
      widgetIdRef.current = null;
    };
  }, [siteKey]);

  const notice = (text: string) => (
    <p
      style={{
        margin: '8px 0 0',
        fontSize: 12,
        fontWeight: 700,
        color: TT.muted,
        lineHeight: 1.6,
        wordBreak: 'keep-all',
      }}
    >
      {text}
    </p>
  );

  return (
    <div style={{ marginTop: 18 }}>
      <div ref={hostRef} style={{ minHeight: siteKey ? 66 : 0 }} />
      {!siteKey && notice('보안 확인을 준비 중입니다. 잠시 후 다시 시도하거나 대회 운영본부로 문의해 주세요.')}
      {siteKey && failed && notice('보안 확인을 불러오지 못했습니다. 네트워크를 확인한 뒤 새로고침해 주세요.')}
    </div>
  );
});

export default TurnstileWidget;
