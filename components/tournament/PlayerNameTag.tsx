import React from 'react';

// 공통 선수명 렌더러 — 순위표/LIVE COURT(경기 카드) 공용.
//   · 이름은 한 줄 유지(nowrap + ellipsis). 폰트 축소 후에도 공간이 부족할 때만 말줄임.
//   · 게스트 `(G)` 접미사는 문자열이 아니라 작은 G 배지로 분리(이름 본문에는 포함하지 않음).
//   · 폰트 크기는 게스트 여부가 아니라 "이름 길이" 기준으로 자연스럽게 축소(일반 회원·게스트 동일 규칙).
//   · 실제 저장 데이터/정산 이름은 변경하지 않는다. 마지막 `(G)` 접미사만 표시에서 분리한다.

const GUEST_BADGE_STYLE: React.CSSProperties = {
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 9,
  fontWeight: 700,
  lineHeight: 1,
  padding: '2px 4px',
  borderRadius: 999,
  background: '#FFF3DC',
  color: '#B86A00',
  border: '1px solid #F2C77F',
  letterSpacing: 0,
};

// LIVE COURT(좁은 2열 카드) 전용 컴팩트 배지 — 이름 영역을 최대한 확보.
// 360px 2열에서 3글자 게스트 이름이 한 줄로 들어가도록 헤드리스 실측으로 크기 확정.
const LIVE_GUEST_BADGE_STYLE: React.CSSProperties = {
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 11,
  height: 13,
  fontSize: 8,
  fontWeight: 700,
  lineHeight: 1,
  padding: '0 1px',
  borderRadius: 999,
  background: '#FFF3DC',
  color: '#B86A00',
  border: '1px solid #F2C77F',
  letterSpacing: 0,
};

/** 마지막 `(G)` 접미사만 안전하게 분리. 문자열 중간의 G 문자는 건드리지 않는다. */
export function splitGuestName(rawName?: string): { displayName: string; hasGuestSuffix: boolean } {
  const raw = String(rawName ?? '').trim();
  const hasGuestSuffix = /\(G\)\s*$/i.test(raw);
  const displayName = raw.replace(/\s*\(G\)\s*$/i, '').trim();
  return { displayName, hasGuestSuffix };
}

/**
 * 공백 제외 이름 길이 기준 폰트 크기.
 *   4자 이하: baseSize / 5~6자: baseSize-1 / 7자 이상: baseSize-2 / 최소 13px.
 */
export function nameLengthFontSize(displayName: string, baseSize: number): number {
  const len = String(displayName ?? '').replace(/\s/g, '').length;
  const size = len <= 4 ? baseSize : len <= 6 ? baseSize - 1 : baseSize - 2;
  return Math.max(13, size);
}

/**
 * LIVE COURT 전용 폰트 램프 — 좁은 2열 카드에서 한 줄 유지, ellipsis는 최후 수단.
 *   "게스트라서 작게"가 아니라, **이름 + G 배지의 총 표시 너비**가 길어질수록 축소한다.
 *   → 게스트는 배지 폭(≈3 글자 상당)을 visualLength 에 가산해 길이로 환산.
 *   visualLength = 공백제외 글자수 + (게스트면 3):
 *     ≤4: base / 5: base-1 / 6: base-2 / 7: base-3 / 8↑: base-4. 최소 12px.
 *   (일반 3글자 이름은 base(16px) 유지. 게스트 3글자는 base-2(14px) — 헤드리스 실측 기준.)
 */
export function liveCourtNameFontSize(displayName: string, isGuest = false, baseSize = 16): number {
  const len = String(displayName ?? '').replace(/\s/g, '').length;
  const v = len + (isGuest ? 3 : 0);
  let size = baseSize;
  if (v === 5) size = baseSize - 1;
  else if (v === 6) size = baseSize - 2;
  else if (v === 7) size = baseSize - 3;
  else if (v >= 8) size = baseSize - 4;
  return Math.max(12, size);
}

interface PlayerNameTagProps {
  /** 표시 이름(마지막 `(G)` 접미사가 포함되어 있어도 됨 — 내부에서 분리). */
  name: string;
  /** 명시적 게스트 플래그. 접미사가 없어도 이 값이 true 면 G 배지 표시. */
  isGuest?: boolean;
  /** 이름 길이 4자 이하일 때 기준 폰트 크기. */
  baseSize?: number;
  color?: string;
  weight?: number;
  /** 가로 정렬(경기 카드=center, 순위표 행=flex-start). */
  justify?: 'center' | 'flex-start';
  /** G 배지 노출 여부(기본 true). */
  showBadge?: boolean;
  /** LIVE COURT(좁은 2열 카드) 모드 — 더 촘촘한 폰트 램프(최소 12px) + 컴팩트 배지 + 좁은 gap. */
  live?: boolean;
}

export default function PlayerNameTag({
  name,
  isGuest,
  baseSize = 16,
  color = '#0F2747',
  weight = 800,
  justify = 'center',
  showBadge = true,
  live = false,
}: PlayerNameTagProps) {
  const { displayName, hasGuestSuffix } = splitGuestName(name);
  const guest = !!isGuest || hasGuestSuffix;
  // LIVE COURT: 이름 + G 배지 총 너비 기준 램프. 그 외(순위표): 길이 기준(최소 13px).
  const fontSize = live
    ? liveCourtNameFontSize(displayName, guest, baseSize)
    : nameLengthFontSize(displayName, baseSize);

  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: justify,
        gap: live ? 1 : 3,
        minWidth: 0,
        width: '100%',
      }}
    >
      <span
        style={{
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontSize,
          fontWeight: weight,
          color,
          letterSpacing: '-0.01em',
          lineHeight: 1.15,
        }}
      >
        {displayName}
      </span>
      {showBadge && guest && (
        <span aria-label="게스트" style={live ? LIVE_GUEST_BADGE_STYLE : GUEST_BADGE_STYLE}>
          G
        </span>
      )}
    </span>
  );
}
