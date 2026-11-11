'use client';

// TEYEON KDK FINAL REPORT — 공유 버튼(P4). 공개 페이지(COVER · CLOSING)와 운영진 편집기(발행 카드)가 함께 쓴다.
//   공유 시트(Web Share API)를 쓸 수 있으면 "공유하기", 아니면 "링크 복사". 결과 문구는 사실만(전송 완료라고 하지 않음).
//   지원 여부는 마운트 뒤에 판정한다(서버 렌더와 첫 화면이 같도록 — hydration 불일치 방지).

import React, { useEffect, useRef, useState } from 'react';
import { Copy, Share2 } from 'lucide-react';
import { copyText } from '../spotlight/spotlightClientApi';
import { SHARE_OUTCOME_TEXT, shareOrCopy, type ShareData, type ShareOutcome } from '@/lib/kdk/finalReport/finalReportShare';
import { FRV } from '@/lib/kdk/finalReport/finalReportView';

type Variant = 'cover' | 'closing' | 'editor';

export default function FinalReportShareButtons({ data, variant, disabled, disabledNote }: {
  data: ShareData; variant: Variant; disabled?: boolean; disabledNote?: string;
}) {
  const [native, setNative] = useState(false);
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    try { setNative(typeof navigator !== 'undefined' && typeof navigator.share === 'function'); } catch { setNative(false); }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  const run = async (preferCopy: boolean) => {
    if (disabled || busy) return;
    setBusy(true);
    const r = await shareOrCopy(data, typeof navigator !== 'undefined' ? (navigator as never) : null, copyText, { preferCopy });
    setBusy(false);
    setOutcome(r);
    if (timer.current) clearTimeout(timer.current);
    if (r === 'copied') timer.current = setTimeout(() => setOutcome(null), 4000);
  };

  const dark = variant !== 'editor';
  const base: React.CSSProperties = {
    minHeight: 46, padding: '0 16px', borderRadius: 14, fontSize: 14, fontWeight: 900, display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', gap: 7, cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: disabled ? 0.45 : 1,
    WebkitTapHighlightColor: 'transparent', boxSizing: 'border-box', fontFamily: 'inherit',
  };
  const primary: React.CSSProperties = dark
    ? { ...base, background: 'rgba(227,199,126,0.14)', color: FRV.goldSoft, border: `1px solid rgba(227,199,126,0.55)` }
    : { ...base, background: FRV.navy, color: '#FFFFFF', border: `1px solid ${FRV.navy}` };
  const secondary: React.CSSProperties = dark
    ? { ...base, background: 'transparent', color: FRV.onNavy, border: '1px solid rgba(255,255,255,0.3)' }
    : { ...base, background: '#FFFFFF', color: FRV.navy, border: `1px solid ${FRV.navy}` };

  const msg = outcome ? SHARE_OUTCOME_TEXT[outcome] : null;
  const showBoth = native && variant !== 'cover';
  return (
    <div data-fr-share={variant} style={{ width: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: showBoth ? '1fr 1fr' : '1fr', gap: 8 }}>
        {native ? (
          <button type="button" data-fr-share-btn="share" disabled={disabled || busy} onClick={() => run(false)} style={primary}>
            <Share2 size={16} /> 공유하기
          </button>
        ) : (
          <button type="button" data-fr-share-btn="copy" disabled={disabled || busy} onClick={() => run(true)} style={primary}>
            <Copy size={16} /> 링크 복사
          </button>
        )}
        {showBoth && (
          <button type="button" data-fr-share-btn="copy" disabled={disabled || busy} onClick={() => run(true)} style={secondary}>
            <Copy size={16} /> 링크 복사
          </button>
        )}
      </div>
      {disabled && disabledNote && (
        <p data-fr-share-note style={{ margin: '8px 0 0', fontSize: 12, fontWeight: 700, lineHeight: 1.5, color: dark ? FRV.onNavySub : FRV.muted, wordBreak: 'keep-all' }}>{disabledNote}</p>
      )}
      <div role="status" aria-live="polite" data-fr-share-msg={outcome || ''}>
        {msg && (
          <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 800, lineHeight: 1.5, color: dark ? FRV.goldSoft : FRV.teal, wordBreak: 'keep-all' }}>{msg}</p>
        )}
        {outcome === 'failed' && (
          <p data-fr-share-url style={{
            margin: '6px 0 0', padding: '8px 10px', borderRadius: 10, fontSize: 12, fontWeight: 700, overflowWrap: 'anywhere', userSelect: 'all', WebkitUserSelect: 'all',
            fontFamily: 'ui-monospace, monospace', background: dark ? 'rgba(255,255,255,0.08)' : '#F2F5F8', color: dark ? FRV.onNavy : FRV.ink,
          }}>{data.url}</p>
        )}
      </div>
    </div>
  );
}
