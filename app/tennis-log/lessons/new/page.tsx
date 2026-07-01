'use client';

export const dynamic = 'force-dynamic';

import LessonLogForm from '@/components/tennis-log/LessonLogForm';

// 레슨일지 작성(신규) — 삭제 버튼 미노출. 수정 화면은 동일 컴포넌트에 mode='edit' 사용.
export default function LessonNewPage() {
  return <LessonLogForm mode="new" />;
}
