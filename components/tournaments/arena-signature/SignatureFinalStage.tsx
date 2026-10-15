'use client';

// Signature — 가운데 결승 (/tournaments/arena-design/signature 전용).
//
//   트로피(작게) → 아이보리 · Soft Gold 육각 FINAL 배지(V4) → (우승 확정 시) CHAMPION 패널.
//   ⚠ 결승 칸의 두 자리 · 경기는 배치 함수가 준 그대로다. 승자를 예측하지 않는다.
//   ⚠ 우승 패널은 저장된 우승 자리에 팀이 올라왔을 때만 보인다.
//   ⚠ 결승 · 우승 패널에서는 이름을 줄이지 않는다(축약은 64강 · 32강에서만).

import React from 'react';
import { Trophy } from 'lucide-react';
import type { ArenaSlot } from '@/lib/tournaments/arenaTypes';
import { fitTeamName, sideOf, teamNames } from './signatureModel';
import type { SigNode, SigRect } from './signatureModel';
import { SIG, SIG_FONT_DISPLAY } from './signatureTheme';

const HEX = 'polygon(16px 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 16px 100%, 0 50%)';
const ROW_H = 34;
const CHIP_W = 28;

/**
 * 결승 무대 빛(장식) — 트로피 뒤 후광 → 트로피와 배지를 잇는 빛 → 배지 아래 받침 빛.
 *   배경의 가운데 빛기둥(위 → 네트)과 같은 세로축(x = 960)에 놓여 하나의 무대처럼 이어진다.
 *   ⚠ 정보가 아니다 — 화면 읽기에서 숨기고 누를 수 없다. 칸 좌표는 바꾸지 않는다.
 */
export function SignatureFinalAura({ final, trophy }: { final: SigNode; trophy: SigRect }) {
  // V4: 후광은 작게, 골드 고리 · 받침 빛은 아주 옅게 — 결승이 화면의 유일한 주인공처럼 보이지 않게.
  const cx = final.x + final.width / 2;
  const tcy = trophy.y + trophy.height * 0.45;
  const bottom = final.y + final.height;
  const decor: React.CSSProperties = { position: 'absolute', pointerEvents: 'none' };
  return (
    <div aria-hidden data-sig-aura="1">
      <span style={{
        ...decor, left: cx - 60, top: tcy - 60, width: 120, height: 120, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,246,222,0.7) 0%, rgba(255,246,222,0.25) 40%, rgba(255,255,255,0) 70%)',
      }} />
      <span style={{
        ...decor, left: cx - final.width / 2 - 30, top: bottom - 16, width: final.width + 60, height: 34, borderRadius: '50%',
        background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 70%)',
      }} />
    </div>
  );
}

/** 결승 위 트로피 — 직접 그린 벡터(크게 키우지 않는다). */
export function SignatureTrophy({ rect }: { rect: SigRect }) {
  const h = rect.height;
  return (
    <div aria-hidden data-sig-trophy="1" style={{
      position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: h,
      display: 'flex', justifyContent: 'center', alignItems: 'flex-end', pointerEvents: 'none',
    }}>
      <svg width={h * 1.05} height={h} viewBox="0 0 84 80">
        <defs>
          <linearGradient id="sig-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFE9A3" />
            <stop offset="0.45" stopColor="#E6B43C" />
            <stop offset="1" stopColor="#A9770F" />
          </linearGradient>
          <linearGradient id="sig-base" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1B3D93" />
            <stop offset="1" stopColor="#0A1F55" />
          </linearGradient>
        </defs>
        {/* 손잡이 */}
        <path d="M22 12 H10 Q4 12 5 20 Q7 34 26 38" fill="none" stroke="url(#sig-gold)" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M62 12 H74 Q80 12 79 20 Q77 34 58 38" fill="none" stroke="url(#sig-gold)" strokeWidth="4.5" strokeLinecap="round" />
        {/* 컵 */}
        <path d="M20 6 H64 Q64 40 46 48 L45 56 H39 L38 48 Q20 40 20 6 Z" fill="url(#sig-gold)" />
        <path d="M27 10 Q27 32 38 40" fill="none" stroke="#FFF6D2" strokeOpacity="0.7" strokeWidth="2.5" strokeLinecap="round" />
        {/* 받침 */}
        <path d="M33 56 H51 L53 62 H31 Z" fill="url(#sig-gold)" />
        <rect x="24" y="62" width="36" height="14" rx="2" fill="url(#sig-base)" />
        <rect x="30" y="66" width="24" height="2" rx="1" fill="#E6B43C" opacity="0.8" />
      </svg>
    </div>
  );
}

function FinalRow({ slot, index, node }: { slot: ArenaSlot; index: number; node: SigNode }) {
  const { score, winner, loser } = sideOf(node.match, index);
  const isTeam = slot.team !== null;
  const names = isTeam ? teamNames(slot)
    : slot.kind === 'qualifier' ? [slot.sourceLabel ?? '예선 진출']
      : slot.kind === 'bye' ? ['BYE'] : ['TBD'];
  const width = node.width - 24 - CHIP_W - 6;
  const fit = fitTeamName(names, width, { base: 17, min: 14.5, stackMax: 15 });
  return (
    <div data-sig-slot={slot.id} data-slot-kind={slot.kind} data-row-result={winner ? 'win' : loser ? 'lose' : 'none'}
      style={{ height: ROW_H, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', opacity: slot.team?.withdrawn ? 0.45 : 1 }}>
      <span data-sig-name="final" style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
        fontSize: fit.fontSize, fontWeight: winner ? 900 : 800, lineHeight: fit.lines.length > 1 ? 1.04 : 1.1,
        letterSpacing: '-0.015em',
        // ⚠ 노랑은 LIVE 전용 — 결승 승자는 흰 글자 + 골드 점수 칩으로만 구분한다.
        color: !isTeam ? SIG.faint : loser ? SIG.muted : SIG.ink,
        fontFamily: isTeam ? undefined : SIG_FONT_DISPLAY,
      }}>
        {fit.lines.map((l, i) => (
          <span key={i} style={{ maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l}</span>
        ))}
      </span>
      <span style={{
        width: CHIP_W, height: 24, flexShrink: 0, borderRadius: 4, display: 'grid', placeItems: 'center',
        background: score === null ? 'transparent' : winner ? SIG.gold : SIG.loserChip,
        color: winner ? SIG.navyDeep : SIG.muted,
        fontFamily: SIG_FONT_DISPLAY, fontSize: 16, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
      }}>
        {score ?? ''}
      </span>
    </div>
  );
}

export function SignatureFinalBadge({ node }: { node: SigNode }) {
  const match = node.match;
  const playing = match?.status === 'playing';
  return (
    <div data-knockout-node={node.key} data-side={node.side} data-column={0}
      data-status={match ? match.status : 'none'} data-target-slot={node.targetSlot.id}
      style={{ position: 'absolute', left: node.x, top: node.y, width: node.width, height: node.height }}>
      {/* V4: Soft Gold 테두리 → 아이보리 면(시각적 무게를 줄였다 — 크기는 그대로) */}
      <div style={{
        position: 'absolute', inset: 0, clipPath: HEX,
        background: `linear-gradient(135deg, #E8D3A0 0%, ${SIG.gold} 50%, #B58D3A 100%)`,
        filter: 'drop-shadow(0 4px 10px rgba(20,35,74,0.12))',
      }} />
      <div style={{
        position: 'absolute', inset: 2, clipPath: HEX,
        background: 'linear-gradient(180deg, #FFFEFA 0%, #FBF6EA 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'stretch',
      }}>
        <div style={{ height: 40, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <span style={{
            fontFamily: SIG_FONT_DISPLAY, fontStyle: 'italic', fontSize: 32, fontWeight: 900, lineHeight: 1,
            letterSpacing: '0.04em', color: SIG.goldDeep,
          }}>
            FINAL
          </span>
        </div>
        <div aria-hidden style={{ height: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <span style={{ width: 52, height: 2, background: SIG.gold }} />
          <span style={{ width: 6, height: 6, background: SIG.gold, transform: 'rotate(45deg)' }} />
          <span style={{ width: 52, height: 2, background: SIG.gold }} />
        </div>
        {node.feeders.map((f, i) => (
          <React.Fragment key={f.slot.id}>
            {i > 0 && (
              <span style={{
                alignSelf: 'center', height: 12, lineHeight: '12px', fontFamily: SIG_FONT_DISPLAY, fontStyle: 'italic',
                fontSize: 10, fontWeight: 800, letterSpacing: '0.16em', color: SIG.faint,
              }}>
                VS
              </span>
            )}
            <FinalRow slot={f.slot} index={i} node={node} />
          </React.Fragment>
        ))}
      </div>
      {playing && match && (
        <span data-sig-live="final" style={{
          position: 'absolute', left: '50%', bottom: -12, transform: 'translateX(-50%)', height: 24, padding: '0 10px',
          display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 4, background: SIG.navy,
          boxShadow: `${SIG.shadowPill}, inset 0 -2px 0 ${SIG.live}`, whiteSpace: 'nowrap',
          fontFamily: SIG_FONT_DISPLAY, fontStyle: 'italic', fontSize: 13, fontWeight: 900, color: SIG.live,
          letterSpacing: '0.06em',
        }}>
          LIVE{match.courtNo !== null ? ` · C${match.courtNo}` : ''}
        </span>
      )}
    </div>
  );
}

/** 우승 — 저장된 우승 자리에 팀이 올라왔을 때만. 긴 이름은 선수별 두 줄로 끝까지 보인다. */
export function SignatureChampion({ rect, team }: { rect: SigRect; team: NonNullable<ArenaSlot['team']> }) {
  const fit = fitTeamName([team.player1Name, team.player2Name], rect.width - 24, { base: 20, min: 16, stackMax: 18 });
  return (
    <div data-knockout-champion="1" style={{
      position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
      padding: '8px 12px', borderRadius: 10, background: SIG.white, border: `1.5px solid ${SIG.gold}`,
      boxShadow: SIG.shadowCard, overflow: 'hidden',
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: SIG_FONT_DISPLAY, fontSize: 12.5,
        fontWeight: 900, letterSpacing: '0.3em', color: SIG.goldDeep,
      }}>
        <Trophy size={14} strokeWidth={2.5} />CHAMPION
      </span>
      <span data-sig-name="champion" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '100%',
        fontSize: fit.fontSize, fontWeight: 900, color: SIG.navy, lineHeight: 1.1, letterSpacing: '-0.015em',
      }}>
        {fit.lines.map((l, i) => (
          <span key={i} style={{ maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l}</span>
        ))}
      </span>
    </div>
  );
}
