'use client';

// Control Center — 미체크인 팀 코트 투입 경고 (현장 운영 1단계).
//
//   ⚠ 막지 않는다. CEO/ADMIN 이 [예외 허용]을 누르면 기존 투입(start_match) 그대로 진행한다.
//   ⚠ 이 대화상자는 아무 것도 저장하지 않는다. 체크인은 체크인 화면에서 한다(새 탭 — 관제 화면 상태를 잃지 않게).
//   ⚠ 배경 스크롤 잠금은 기존 공용 useBodyScrollLock 을 쓴다.

import React from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import type { ControlMatchRow } from './controlModel';
import { matchHeadLabel } from '@/lib/tournaments/matchTypes';

const INK = '#0F172A';
const INK_SOFT = '#334155';
const MUTED = '#64748B';
const LINE = '#E2E8F0';
const AMBER_INK = '#9A3412';
const AMBER_BG = '#FFF7ED';
const AMBER_BD = '#FDBA74';
const NAVY = '#102A3D';
const LABEL = 'var(--font-rajdhani), sans-serif';

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  minHeight: 46, padding: '9px 14px', borderRadius: 10, border: `1px solid ${LINE}`,
  background: '#fff', color: INK_SOFT, fontFamily: 'inherit', fontSize: 14, fontWeight: 800,
  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};
const tag = (n: number) => `TEAM ${String(n).padStart(2, '0')}`;

export default function ControlCheckinWarning({
  match, courtNo, teamNos, slug, busy, onClose, onOverride,
}: {
  match: ControlMatchRow; courtNo: number; teamNos: number[]; slug: string; busy: boolean;
  onClose: () => void; onOverride: () => void;
}) {
  useBodyScrollLock(true);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const teams = [match.team1, match.team2].filter((t) => teamNos.includes(t.teamNo));
  const head = matchHeadLabel(match);

  return (
    <div role="dialog" aria-modal="true" aria-label="미체크인 팀 투입 확인" data-control-dialog="checkin-warning"
      style={{
        position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(15,23,42,0.42)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 400, maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto',
        background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 18,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={18} strokeWidth={2.4} color={AMBER_INK} />
          <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: INK }}>
            체크인하지 않은 팀이 있습니다
          </p>
        </div>
        <p style={{ margin: 0, fontFamily: LABEL, fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: MUTED }}>
          {head} · M{match.matchNo} · {tag(match.team1.teamNo)} vs {tag(match.team2.teamNo)}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {teams.map((t) => (
            <div key={t.teamNo} data-checkin-warning-team={t.teamNo} style={{
              display: 'flex', alignItems: 'baseline', gap: 8, padding: '9px 11px', borderRadius: 10,
              background: AMBER_BG, border: `1px solid ${AMBER_BD}`, minWidth: 0,
            }}>
              <span style={{ flexShrink: 0, fontFamily: LABEL, fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', color: AMBER_INK }}>
                {tag(t.teamNo)}
              </span>
              <span style={{ fontSize: 14, fontWeight: 800, color: INK, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[t.player1Name, t.player2Name].filter((x) => x.trim() !== '').join(' · ') || '—'}
              </span>
            </div>
          ))}
        </div>

        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: INK_SOFT, lineHeight: 1.65, wordBreak: 'keep-all' }}>
          본부에서 두 선수 도착을 확인하지 않은 팀입니다. 선수가 코트에 와 있는지 확인한 뒤,
          예외로 허용하고 <b>{courtNo}번 코트</b>에 투입할 수 있습니다.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" data-control-action="checkin-warning-back" onClick={onClose}
            style={{ ...btn, flex: '1 1 120px' }}>
            돌아가기
          </button>
          <button type="button" data-control-action="checkin-warning-override" onClick={onOverride} disabled={busy}
            style={{ ...btn, flex: '2 1 200px', background: NAVY, borderColor: NAVY, color: '#fff', opacity: busy ? 0.55 : 1 }}>
            예외 허용 — {courtNo}번 코트 투입
          </button>
        </div>
        <a href={`/admin/tournaments/${slug}/checkin`} target="_blank" rel="noopener noreferrer"
          data-control-action="checkin-warning-open"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'center', fontSize: 12.5, fontWeight: 800, color: MUTED, textDecoration: 'none', padding: '6px 4px' }}>
          체크인 화면 열기(새 탭) <ExternalLink size={12} strokeWidth={2.4} />
        </a>
      </div>
    </div>
  );
}
