// Signature — 장식 레이어 (/tournaments/arena-design/signature 전용).
//
//   L1 경기장 그림(public/arena-signature/stadium-blue.svg, v3 낮 경기장) → L2 정보 보호막 → L3 코트 바닥 글자.
//   ⚠ 전부 장식이다. 화면 읽기 프로그램에 숨기고(aria-hidden) 누를 수 없다(pointer-events: none).
//   ⚠ 보호막은 옅게 둔다 — 선수 이름 뒤는 레인 판(SignatureKnockoutBoard)이 지키고,
//     여기서는 머리말 뒤와 양쪽 끝만 살짝 밝혀 경기장 공간감이 보이게 한다.
//   ⚠ TV 브라우저 부담을 줄이려고 backdrop-filter 를 쓰지 않는다.

import React from 'react';
import { SIG_FONT_DISPLAY } from './signatureTheme';
import type { SignatureCourtPosition } from './signatureTheme';

export const SIG_BACKDROP_SRC = '/arena-signature/stadium-blue.svg';

// V4: 따뜻한 아이보리 보호막.
const VEIL = 'rgba(250, 247, 240, A)';
const veil = (a: number): string => VEIL.replace('A', String(a));

/**
 * @param courtPosition 코트 현황 위치. B안(bottom)에서는 대진이 위로 올라오므로 대진 보호막도 위에서 시작하고,
 *   코트 카드 뒤로 숨는 바닥 글자는 그리지 않는다(카드 사이 틈으로 조각만 비치지 않게).
 */
export default function SignatureBackdrop({ courtPosition = 'bottom' }: { courtPosition?: SignatureCourtPosition }) {
  const bottom = courtPosition === 'bottom';
  return (
    <div aria-hidden data-sig-decor="1" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', userSelect: 'none' }}>
      {/* L1 경기장 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img data-sig-backdrop src={SIG_BACKDROP_SRC} alt="" width={1920} height={1080}
        style={{ position: 'absolute', inset: 0, width: 1920, height: 1080 }} />

      {/* L2 보호막 — 머리말 뒤(지붕 철골 · 빛줄기가 글자 뒤로 비치지 않게 위쪽만 밝힌다) */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 0, height: 120,
        background: `linear-gradient(180deg, ${veil(0.7)} 0%, ${veil(0.45)} 70%, ${veil(0)} 100%)`,
      }} />
      {/* L2 보호막 — 대진 본문. 레인 판이 이름 뒤를 지키므로 여기서는 옅게만 —
          경기장(관중석 · 철골 · 빛)이 레인 사이와 가운데에서 보이게 한다. */}
      <div data-sig-veil="board" style={{
        position: 'absolute', left: 0, right: 0, top: bottom ? 110 : 270, bottom: 0,
        background: `linear-gradient(90deg,
          ${veil(0.44)} 0%, ${veil(0.36)} 19%, ${veil(0.14)} 28%, ${veil(0.04)} 38%,
          ${veil(0)} 46%, ${veil(0)} 54%,
          ${veil(0.04)} 62%, ${veil(0.14)} 72%, ${veil(0.36)} 81%, ${veil(0.44)} 100%)`,
      }} />

      {/* L2 보호막 — 아래 양쪽 모서리(가까운 관중석이 가장 진한 곳 = 64강 · 32강 레인 아래쪽 뒤) */}
      {(['left', 'right'] as const).map((side) => (
        <div key={side} style={{
          position: 'absolute', [side]: 0, width: 400, top: 820, bottom: 0,
          background: `linear-gradient(0deg, ${veil(0.55)} 0%, ${veil(0.3)} 45%, ${veil(0)} 100%)`,
        }} />
      ))}

      {!bottom && (<>
      {/* L3 코트 바닥 글자 — V4: 아이보리 코트 위에 아주 옅게(머리말 대회명과 겹치는 존재감을 줄였다). 슬로건 줄은 뺐다. */}
      <div style={{
        position: 'absolute', left: 600, width: 720, top: 1000, height: 76,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transform: 'perspective(520px) rotateX(36deg)', transformOrigin: '50% 100%',
      }}>
        <span style={{
          fontFamily: SIG_FONT_DISPLAY, fontStyle: 'italic', fontWeight: 900, fontSize: 72, lineHeight: 1,
          letterSpacing: '0.1em', color: 'rgba(255, 255, 255, 0.75)', whiteSpace: 'nowrap',
          textShadow: '0 1px 0 rgba(120, 132, 152, 0.18)',
        }}>
          TEYEON OPEN
        </span>
      </div>
      </>)}
    </div>
  );
}
