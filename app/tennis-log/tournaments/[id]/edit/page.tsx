'use client';

export const dynamic = 'force-dynamic';

import { useParams } from 'next/navigation';
import TournamentLogForm from '@/components/tennis-log/TournamentLogForm';

// 대회 기록 수정 — mode='edit'. 삭제 진입은 수정 화면에서만 제공.
export default function TournamentLogEditPage() {
  const params = useParams();
  const raw = params?.id;
  const id = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
  return <TournamentLogForm mode="edit" recordId={id} />;
}
