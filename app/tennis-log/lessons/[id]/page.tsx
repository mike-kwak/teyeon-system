'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react';
import { useTennisLogAccess } from '@/hooks/useTennisLogAccess';
import { getLesson, deleteLesson } from '@/lib/tennisLogLessonService';
import type { TennisLessonRecord } from '@/types/tennisLog';
import TennisLogConfirmDialog from '@/components/tennis-log/TennisLogConfirmDialog';

const NAVY = '#0F1B33';
const TEAL = '#0E7C76';
const INK = '#0F172A';
const SUB = '#64748B';
const FAINT = '#94A3B8';
const CARD_BORDER = 'rgba(0,0,0,0.06)';

type FetchState = 'loading' | 'ready' | 'notfound' | 'error';

function formatDate(d: string): string {
  const [y, m, day] = (d || '').split('-');
  if (!y || !m || !day) return d || '';
  return `${y}.${m}.${day}`;
}

const hasText = (v: string | null | undefined) => !!(v && v.trim());

export default function LessonDetailPage() {
  const router = useRouter();
  const params = useParams();
  const raw = params?.id;
  const id = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';

  const access = useTennisLogAccess();
  const [isMounted, setIsMounted] = useState(false);
  const [state, setState] = useState<FetchState>('loading');
  const [record, setRecord] = useState<TennisLessonRecord | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => setIsMounted(true), []);

  useEffect(() => {
    if (access === 'unauthenticated') router.replace('/');
    else if (access === 'locked') router.replace('/tennis-log');
  }, [access, router]);

  useEffect(() => {
    if (access !== 'allowed' || !id) return;
    let cancelled = false;
    setState('loading');
    (async () => {
      const { data, error } = await getLesson(id);
      if (cancelled) return;
      if (error) return setState('error');
      if (!data) return setState('notfound');
      setRecord(data);
      setState('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [access, id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleConfirmDelete() {
    if (!id || deleting) return;
    setDeleting(true);
    const { error } = await deleteLesson(id);
    setDeleting(false);
    if (error) {
      setConfirmDelete(false);
      setToast(error);
      return;
    }
    setConfirmDelete(false);
    setToast('레슨일지를 삭제했습니다.');
    router.replace('/tennis-log/lessons');
  }

  if (!isMounted || access === 'loading' || access !== 'allowed') return null;

  const Header = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '12px 14px',
        borderBottom: `1px solid ${CARD_BORDER}`,
        backgroundColor: '#FFFFFF',
      }}
    >
      <button
        type="button"
        onClick={() => router.push('/tennis-log/lessons')}
        aria-label="뒤로"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: NAVY }}
      >
        <ChevronLeft size={20} strokeWidth={2.2} />
        <span style={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap' }}>레슨 상세</span>
      </button>
      {state === 'ready' && (
        <button
          type="button"
          onClick={() => router.push(`/tennis-log/lessons/${id}/edit`)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: TEAL, fontSize: 13, fontWeight: 800 }}
        >
          <Pencil size={15} strokeWidth={2.4} />
          수정
        </button>
      )}
    </div>
  );

  const wrap = (children: React.ReactNode) => (
    <div style={{ width: '100%', maxWidth: 450, margin: '0 auto', boxSizing: 'border-box' }}>
      {Header}
      {children}
      {toast && <Toast text={toast} />}
    </div>
  );

  if (state === 'loading') {
    return wrap(
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: i === 0 ? 80 : 96, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.05)' }} className="animate-pulse" />
        ))}
      </div>,
    );
  }

  // 본인 기록이 아니거나 없는 id — 민감 차이 노출 없이 동일 처리.
  if (state === 'notfound' || state === 'error' || !record) {
    return wrap(
      <div style={{ minHeight: '50dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ textAlign: 'center', maxWidth: 320 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: NAVY }}>레슨 기록을 찾을 수 없습니다.</p>
          <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 600, color: SUB, lineHeight: 1.6 }}>
            이미 삭제되었거나 접근할 수 없는 기록입니다.
          </p>
          <button
            type="button"
            onClick={() => router.replace('/tennis-log/lessons')}
            style={{ marginTop: 18, height: 44, padding: '0 22px', borderRadius: 11, border: 'none', backgroundColor: TEAL, color: '#FFFFFF', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}
          >
            목록으로
          </button>
        </div>
      </div>,
    );
  }

  const r = record;
  const metaLine = [formatDate(r.lesson_date), r.coach_name].filter(Boolean).join(' · ');

  return wrap(
    <div
      style={{
        padding: '16px',
        paddingBottom: 'calc(110px + env(safe-area-inset-bottom))',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* 상단 — 주제 + 메타 (장식 최소) */}
      <div>
        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: TEAL, letterSpacing: '0.02em' }}>레슨 주제</p>
        <h1 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800, color: NAVY, lineHeight: 1.3, wordBreak: 'keep-all' }}>
          {r.lesson_topic}
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 600, color: SUB }}>{metaLine}</p>
      </div>

      {/* 1. 오늘 배운 점 — 가장 강조 */}
      <TextBlock title="오늘 배운 점" body={r.learned_points} emphasized />

      {/* 2. 다음 목표 */}
      {hasText(r.next_goal) && <TextBlock title="다음 목표" body={r.next_goal!} accent />}

      {/* 3. 교정 포인트 / 4. 연습 과제 / 5. 자유 메모 — 값 있는 것만 */}
      {hasText(r.correction_points) && <TextBlock title="교정 포인트" body={r.correction_points!} />}
      {hasText(r.practice_tasks) && <TextBlock title="연습 과제" body={r.practice_tasks!} />}
      {hasText(r.free_memo) && <TextBlock title="자유 메모" body={r.free_memo!} />}

      {/* 액션 */}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button
          type="button"
          onClick={() => router.push(`/tennis-log/lessons/${id}/edit`)}
          style={{
            flex: 1,
            height: 48,
            borderRadius: 12,
            border: `1px solid ${CARD_BORDER}`,
            backgroundColor: '#FFFFFF',
            color: NAVY,
            fontSize: 14,
            fontWeight: 800,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Pencil size={16} strokeWidth={2.2} />
          수정
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          aria-label="레슨일지 삭제"
          style={{
            flexShrink: 0,
            width: 56,
            height: 48,
            borderRadius: 12,
            border: '1px solid rgba(220,38,38,0.28)',
            backgroundColor: '#FFFFFF',
            color: '#DC2626',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Trash2 size={18} strokeWidth={2} />
        </button>
      </div>

      <TennisLogConfirmDialog
        open={confirmDelete}
        title="레슨일지를 삭제할까요?"
        body="삭제한 기록은 복구할 수 없습니다."
        confirmLabel="기록 삭제"
        cancelLabel="취소"
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => (deleting ? undefined : setConfirmDelete(false))}
      />
    </div>,
  );
}

// ── 보조 컴포넌트 ────────────────────────────────────────────────────────────

function TextBlock({
  title,
  body,
  emphasized,
  accent,
}: {
  title: string;
  body: string;
  emphasized?: boolean;
  accent?: boolean;
}) {
  return (
    <div>
      <p style={{ margin: '0 0 7px 2px', fontSize: 12.5, fontWeight: 800, color: accent ? TEAL : NAVY }}>{title}</p>
      <div
        style={{
          backgroundColor: '#FFFFFF',
          border: `1px solid ${accent ? 'rgba(14,124,118,0.22)' : CARD_BORDER}`,
          borderRadius: 12,
          padding: emphasized ? '15px 16px' : '13px 15px',
          ...(accent ? { backgroundColor: 'rgba(14,124,118,0.05)' } : null),
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: emphasized ? 14 : 13,
            fontWeight: emphasized ? 600 : 500,
            color: emphasized ? INK : '#334155',
            lineHeight: 1.75,
            whiteSpace: 'pre-wrap',
            wordBreak: 'keep-all',
          }}
        >
          {body}
        </p>
      </div>
    </div>
  );
}

function Toast({ text }: { text: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(96px + env(safe-area-inset-bottom))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        width: '92%',
        maxWidth: 420,
        backgroundColor: '#0F766E',
        borderRadius: 11,
        padding: '12px 18px',
        textAlign: 'center',
        fontSize: 13,
        fontWeight: 700,
        color: '#FFFFFF',
        boxShadow: '0 6px 24px rgba(13,148,136,0.28)',
        wordBreak: 'keep-all',
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  );
}
