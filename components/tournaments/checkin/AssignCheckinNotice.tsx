'use client';

// 코트 투입 경로 정리 — Control Center 밖의 투입 화면(예선 경기 운영 · 본선 대진)에 쓰는 작은 안내 부품.
//
//   ⚠ 막지 않는다. 기존 투입(start_match)은 그대로다. 대회 당일 공식 투입 경로는 Control Center 하나로 안내하고,
//     이 화면들에서 투입할 때도 미체크인 팀이면 '예외 허용' 확인을 한 번 받는다(Control Center 경고와 같은 정책).
//   ⚠ 체크인 정보를 모르면(조회 실패 · SQL 미적용) 아무 것도 띄우지 않는다 — 경고가 진행을 막지 않게.

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, Gauge } from 'lucide-react';

/** 화면 맨 위 한 줄 — 당일 코트 투입은 Control Center 에서. */
export function ControlCenterPathBanner({ slug }: { slug: string }) {
  return (
    <div data-assign-path-banner style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 13px', marginBottom: 10,
      borderRadius: 11, background: '#EEF6F5', border: '1px solid #A7D3CD', color: '#0F4C46',
    }}>
      <Gauge size={15} strokeWidth={2.4} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.6, wordBreak: 'keep-all', minWidth: 0, flex: '1 1 220px' }}>
        대회 당일 코트 투입은 <b>Control Center</b>에서 합니다. 이 화면의 코트 투입은 비상용입니다.
      </span>
      <Link href={`/admin/tournaments/${slug}/control`} data-assign-path-link style={{
        display: 'inline-flex', alignItems: 'center', minHeight: 32, padding: '5px 11px', borderRadius: 8,
        background: '#0E8C80', color: '#fff', fontSize: 12, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap',
      }}>
        Control Center 열기
      </Link>
    </div>
  );
}

/** 투입하려는 경기에 체크인 안 된 팀이 있을 때 — 확인란을 체크해야 코트 버튼이 열린다. */
export function UncheckedAssignNotice({
  teams, acknowledged, onToggle, name,
}: {
  teams: Array<{ teamNo: number; label: string }>;
  acknowledged: boolean;
  onToggle: (v: boolean) => void;
  /** QA 식별용(경기 번호 등). */
  name: string;
}) {
  if (teams.length === 0) return null;
  return (
    <div role="alert" data-assign-unchecked={name} style={{
      display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10, padding: '10px 12px', borderRadius: 10,
      background: '#FFF7ED', border: '1px solid #FDBA74', color: '#9A3412',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 900 }}>
        <AlertTriangle size={15} strokeWidth={2.4} />
        체크인하지 않은 팀이 있습니다
      </span>
      {teams.map((t) => (
        <span key={t.teamNo} style={{ fontSize: 12.5, fontWeight: 700, color: '#0F172A', wordBreak: 'keep-all' }}>
          TEAM {String(t.teamNo).padStart(2, '0')} · {t.label}
        </span>
      ))}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
        <input type="checkbox" data-assign-ack={name} checked={acknowledged}
          onChange={(e) => onToggle(e.target.checked)} style={{ width: 20, height: 20, accentColor: '#9A3412' }} />
        선수가 와 있는 것을 확인했습니다 — 예외로 투입
      </label>
    </div>
  );
}
