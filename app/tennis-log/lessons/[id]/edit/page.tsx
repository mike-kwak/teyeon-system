'use client';

export const dynamic = 'force-dynamic';

import { useParams } from 'next/navigation';
import LessonLogForm from '@/components/tennis-log/LessonLogForm';

// 레슨일지 수정 — mode='edit'. 삭제 진입은 수정 화면에서만 제공.
export default function LessonEditPage() {
  const params = useParams();
  const raw = params?.id;
  const id = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
  return <LessonLogForm mode="edit" recordId={id} />;
}
