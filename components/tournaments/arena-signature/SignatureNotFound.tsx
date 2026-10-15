'use client';

// Signature 운영 연결 — 알 수 없는 대회 주소 안내(조회를 하지 않는다). 운영 Arena 와 같은 문구.

import React from 'react';
import { SIG } from './signatureTheme';

export default function SignatureNotFound() {
  return (
    <div data-live-notice="not_found" style={{
      position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
      background: SIG.bg, color: SIG.inkSoft, fontSize: 16, fontWeight: 600,
    }}>
      대회를 찾을 수 없습니다.
    </div>
  );
}
