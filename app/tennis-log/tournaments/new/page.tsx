'use client';

export const dynamic = 'force-dynamic';

import TournamentLogForm from '@/components/tennis-log/TournamentLogForm';

// 대회 기록 추가(신규) — 삭제 버튼 미노출. 수정 화면은 동일 컴포넌트에 mode='edit' 사용.
export default function TournamentLogNewPage() {
  return <TournamentLogForm mode="new" />;
}
