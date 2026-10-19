// 테스트(리허설) 대회 표시 띠 — fixture-* 대회 화면 맨 위에 둔다(실제 대회와 헷갈리지 않게).
//   ⚠ 표시일 뿐이다. 공개 화면 차단은 서버(draft 대회는 공개 RPC 가 아무 것도 돌려주지 않음)가 한다.

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { isTestTournamentSlug } from '@/lib/tournaments/testTournament';

export default function TestTournamentBanner({ slug, style }: { slug: string; style?: React.CSSProperties }) {
  if (!isTestTournamentSlug(slug)) return null;
  return (
    <div data-test-tournament-banner role="note" style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 13px', borderRadius: 11,
      background: '#FEF3C7', border: '2px dashed #D97706', color: '#78350F', ...style,
    }}>
      <AlertTriangle size={16} strokeWidth={2.6} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 14, fontWeight: 900 }}>테스트 대회</span>
      <span style={{ fontSize: 12.5, fontWeight: 700, wordBreak: 'keep-all', minWidth: 0 }}>
        실제 대회가 아닙니다. 참가자 화면 · 전광판 · 공식 기록에 나오지 않습니다.
      </span>
    </div>
  );
}
