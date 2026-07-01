'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Lock, Trash2, Check } from 'lucide-react';
import { useTennisLogAccess } from '@/hooks/useTennisLogAccess';
import type { TennisLessonRecord, TennisLessonInput } from '@/types/tennisLog';
import { getLesson, createLesson, updateLesson, deleteLesson } from '@/lib/tennisLogLessonService';
import TennisLogConfirmDialog from './TennisLogConfirmDialog';

// Cool Premium Light 토큰 (기록장 느낌 — 장식 최소)
const NAVY = '#0F1B33';
const TEAL = '#0E7C76';
const INK = '#0F172A';
const SUB = '#64748B';
const FAINT = '#94A3B8';
const CARD_BORDER = 'rgba(0,0,0,0.06)';
const FIELD_BORDER = 'rgba(15,27,51,0.14)';

function todayString(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

type LoadState = 'loading' | 'ready' | 'notfound' | 'error';

export default function LessonLogForm({ mode, recordId }: { mode: 'new' | 'edit'; recordId?: string }) {
  const router = useRouter();
  const access = useTennisLogAccess();
  const [isMounted, setIsMounted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [loadState, setLoadState] = useState<LoadState>(mode === 'edit' ? 'loading' : 'ready');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 입력 상태
  const [date, setDate] = useState<string>(todayString());
  const [coach, setCoach] = useState('');
  const [topic, setTopic] = useState('');
  const [learned, setLearned] = useState('');
  const [correction, setCorrection] = useState('');
  const [tasks, setTasks] = useState('');
  const [goal, setGoal] = useState('');
  const [memo, setMemo] = useState('');

  useEffect(() => setIsMounted(true), []);

  useEffect(() => {
    if (access === 'unauthenticated') router.replace('/');
    else if (access === 'locked') router.replace('/tennis-log');
  }, [access, router]);

  useEffect(() => {
    if (mode !== 'edit' || !recordId || access !== 'allowed') return;
    let cancelled = false;
    setLoadState('loading');
    (async () => {
      const { data, error } = await getLesson(recordId);
      if (cancelled) return;
      if (error) return setLoadState('error');
      if (!data) return setLoadState('notfound');
      hydrate(data);
      setLoadState('ready');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, recordId, access]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  function hydrate(r: TennisLessonRecord) {
    setDate(r.lesson_date);
    setCoach(r.coach_name ?? '');
    setTopic(r.lesson_topic);
    setLearned(r.learned_points);
    setCorrection(r.correction_points ?? '');
    setTasks(r.practice_tasks ?? '');
    setGoal(r.next_goal ?? '');
    setMemo(r.free_memo ?? '');
  }

  if (!isMounted || access === 'loading' || access !== 'allowed') return null;

  if (mode === 'edit' && loadState !== 'ready') {
    return (
      <StatusScreen
        title={
          loadState === 'loading'
            ? '레슨 기록을 불러오는 중…'
            : loadState === 'notfound'
              ? '레슨 기록을 찾을 수 없습니다.'
              : '레슨 기록을 불러오지 못했습니다.'
        }
        body={
          loadState === 'loading'
            ? undefined
            : loadState === 'notfound'
              ? '이미 삭제되었거나 접근할 수 없는 기록입니다.'
              : '잠시 후 다시 시도해 주세요.'
        }
        showBack={loadState !== 'loading'}
        onBack={() => router.replace('/tennis-log/lessons')}
      />
    );
  }

  function validate(): string | null {
    if (!date) return '레슨 날짜를 입력해 주세요.';
    if (!topic.trim()) return '레슨 주제를 입력해 주세요.';
    if (!learned.trim()) return '오늘 배운 점을 입력해 주세요.';
    return null;
  }

  function collectInput(): TennisLessonInput {
    return {
      lesson_date: date,
      coach_name: coach,
      lesson_topic: topic,
      learned_points: learned,
      correction_points: correction,
      practice_tasks: tasks,
      next_goal: goal,
      free_memo: memo,
    };
  }

  async function handleSave() {
    if (saving) return;
    const err = validate();
    if (err) {
      setToast(err);
      return;
    }
    setSaving(true);
    try {
      const input = collectInput();
      if (mode === 'edit' && recordId) {
        const { data, error } = await updateLesson(recordId, input);
        if (error || !data) {
          setToast(error || '저장하지 못했습니다.');
          return;
        }
        setToast('수정했습니다.');
        router.push(`/tennis-log/lessons/${recordId}`);
      } else {
        const { data, error } = await createLesson(input);
        if (error || !data) {
          setToast(error || '저장하지 못했습니다.');
          return;
        }
        setToast('레슨일지를 저장했습니다.');
        router.push(`/tennis-log/lessons/${data.id}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!recordId || deleting) return;
    setDeleting(true);
    const { error } = await deleteLesson(recordId);
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

  return (
    <div style={{ width: '100%', maxWidth: 450, margin: '0 auto', boxSizing: 'border-box' }}>
      {/* 헤더 바 */}
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
          onClick={() =>
            router.push(mode === 'edit' && recordId ? `/tennis-log/lessons/${recordId}` : '/tennis-log')
          }
          aria-label="뒤로"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: NAVY, minWidth: 0 }}
        >
          <ChevronLeft size={20} strokeWidth={2.2} />
          <span style={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap' }}>
            {mode === 'edit' ? '레슨일지 수정' : '레슨일지 작성'}
          </span>
        </button>
        <span
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 9px',
            borderRadius: 999,
            border: `1px solid ${FIELD_BORDER}`,
            color: SUB,
            fontSize: 10.5,
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          <Lock size={11} strokeWidth={2.4} />
          나만 보기
        </span>
      </div>

      {/* 본문 — 노트 작성 느낌(섹션 라벨 + 입력, 과한 카드 분절 지양) */}
      <div
        style={{
          padding: '16px',
          paddingBottom: 'calc(104px + env(safe-area-inset-bottom))',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {/* 기본 정보 */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <GroupTitle required>기본 정보</GroupTitle>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="레슨 날짜" required>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="코치명">
              <input
                type="text"
                value={coach}
                onChange={(e) => setCoach(e.target.value)}
                placeholder="예: 김코치"
                style={inputStyle}
              />
            </Field>
          </div>

          <Field label="레슨 주제" required>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="예: 백핸드 슬라이스"
              style={inputStyle}
            />
          </Field>

          <Field label="오늘 배운 점" required>
            <textarea
              value={learned}
              onChange={(e) => setLearned(e.target.value)}
              placeholder="오늘 레슨에서 배운 핵심 내용을 적어 보세요."
              rows={4}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 96, lineHeight: 1.6 }}
            />
          </Field>
        </section>

        {/* 상세 기록 (선택) */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <GroupTitle>
            상세 기록 <span style={{ color: FAINT, fontWeight: 600 }}>(선택)</span>
          </GroupTitle>

          <Field label="교정 포인트">
            <textarea
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              placeholder="자세·동작에서 교정할 점."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 80, lineHeight: 1.6 }}
            />
          </Field>

          <Field label="연습 과제">
            <textarea
              value={tasks}
              onChange={(e) => setTasks(e.target.value)}
              placeholder="다음 레슨 전까지 연습할 내용."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 80, lineHeight: 1.6 }}
            />
          </Field>

          <Field label="다음 목표">
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="예: 백핸드 슬라이스 안정화"
              style={inputStyle}
            />
          </Field>

          <Field label="자유 메모">
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="그 외 자유롭게 남기고 싶은 메모."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 80, lineHeight: 1.6 }}
            />
          </Field>
        </section>
      </div>

      {/* 하단 저장 바 — 신규엔 삭제 없음, 수정에만 삭제 진입 */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 600,
          width: '100%',
          maxWidth: 450,
          boxSizing: 'border-box',
          backgroundColor: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderTop: `1px solid ${CARD_BORDER}`,
          boxShadow: '0 -2px 16px rgba(0,0,0,0.06)',
          padding: '12px 16px',
          paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {mode === 'edit' && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={saving}
            aria-label="레슨일지 삭제"
            style={{
              flexShrink: 0,
              width: 52,
              height: 50,
              borderRadius: 12,
              border: '1px solid rgba(220,38,38,0.28)',
              backgroundColor: '#FFFFFF',
              color: '#DC2626',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
          >
            <Trash2 size={19} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1,
            height: 50,
            borderRadius: 12,
            border: 'none',
            backgroundColor: NAVY,
            color: '#FFFFFF',
            fontSize: 15,
            fontWeight: 800,
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.7 : 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
          }}
        >
          {saving ? (
            '저장 중…'
          ) : (
            <>
              <Check size={18} strokeWidth={2.6} />
              저장
            </>
          )}
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

      {toast && <Toast text={toast} />}
    </div>
  );
}

// ── 보조 컴포넌트 ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '11px 13px',
  borderRadius: 11,
  border: `1px solid ${FIELD_BORDER}`,
  backgroundColor: '#FFFFFF',
  fontSize: 14,
  fontWeight: 600,
  color: INK,
  outline: 'none',
  fontFamily: 'inherit',
};

function GroupTitle({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: NAVY, display: 'flex', alignItems: 'center', gap: 6 }}>
      {children}
      {required && (
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            letterSpacing: '0.04em',
            color: '#DC2626',
            backgroundColor: 'rgba(220,38,38,0.08)',
            border: '1px solid rgba(220,38,38,0.20)',
            borderRadius: 5,
            padding: '1px 5px',
          }}
        >
          필수
        </span>
      )}
    </p>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: SUB,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
        {required && <span style={{ color: '#DC2626' }}>*</span>}
      </span>
      {children}
    </label>
  );
}

function StatusScreen({
  title,
  body,
  showBack,
  onBack,
}: {
  title: string;
  body?: string;
  showBack?: boolean;
  onBack?: () => void;
}) {
  return (
    <div style={{ width: '100%', maxWidth: 450, margin: '0 auto', padding: '0 16px', minHeight: '60dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: NAVY, wordBreak: 'keep-all' }}>{title}</p>
        {body && (
          <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 600, color: SUB, lineHeight: 1.6, wordBreak: 'keep-all' }}>{body}</p>
        )}
        {showBack && onBack && (
          <button
            type="button"
            onClick={onBack}
            style={{ marginTop: 18, height: 44, padding: '0 22px', borderRadius: 11, border: 'none', backgroundColor: TEAL, color: '#FFFFFF', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}
          >
            목록으로
          </button>
        )}
      </div>
    </div>
  );
}

function Toast({ text }: { text: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(86px + env(safe-area-inset-bottom))',
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
