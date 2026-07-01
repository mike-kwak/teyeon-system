'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Plus, GraduationCap, RotateCcw } from 'lucide-react';
import { useTennisLogAccess } from '@/hooks/useTennisLogAccess';
import { listLessons } from '@/lib/tennisLogLessonService';
import type { TennisLessonRecord } from '@/types/tennisLog';

const NAVY = '#0F1B33';
const TEAL = '#0E7C76';
const INK = '#0F172A';
const SUB = '#64748B';
const FAINT = '#94A3B8';
const CARD_BORDER = 'rgba(0,0,0,0.06)';
const FIELD_BORDER = 'rgba(15,27,51,0.14)';

type FetchState = 'loading' | 'ready' | 'error';

function formatDate(d: string): string {
  const [y, m, day] = (d || '').split('-');
  if (!y || !m || !day) return d || '';
  return `${y}.${m}.${day}`;
}

export default function LessonListPage() {
  const router = useRouter();
  const access = useTennisLogAccess();
  const [isMounted, setIsMounted] = useState(false);
  const [state, setState] = useState<FetchState>('loading');
  const [records, setRecords] = useState<TennisLessonRecord[]>([]);
  const [year, setYear] = useState<number | 'all'>('all');

  useEffect(() => setIsMounted(true), []);

  useEffect(() => {
    if (access === 'unauthenticated') router.replace('/');
    else if (access === 'locked') router.replace('/tennis-log');
  }, [access, router]);

  const load = useMemo(
    () => async () => {
      setState('loading');
      const { data, error } = await listLessons();
      if (error || !data) {
        setState('error');
        return;
      }
      setRecords(data);
      setState('ready');
    },
    [],
  );

  useEffect(() => {
    if (access !== 'allowed') return;
    void load();
  }, [access, load]);

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const r of records) {
      const y = Number((r.lesson_date || '').slice(0, 4));
      if (y) set.add(y);
    }
    set.add(new Date().getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [records]);

  const filtered = useMemo(() => {
    if (year === 'all') return records;
    return records.filter((r) => Number((r.lesson_date || '').slice(0, 4)) === year);
  }, [records, year]);

  if (!isMounted || access === 'loading' || access !== 'allowed') return null;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 450,
        margin: '0 auto',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        // BottomNav clearance/safe-area 는 공통 GlobalMain(var(--page-bottom-safe))이 담당. 여기선 소량 여백만(safe-area 이중 방지).
        paddingBottom: 28,
      }}
    >
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
          onClick={() => router.push('/tennis-log')}
          aria-label="뒤로"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: NAVY }}
        >
          <ChevronLeft size={20} strokeWidth={2.2} />
          <span style={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap' }}>레슨일지</span>
        </button>
        <button
          type="button"
          onClick={() => router.push('/tennis-log/lessons/new')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '7px 12px',
            borderRadius: 999,
            border: 'none',
            backgroundColor: TEAL,
            color: '#FFFFFF',
            fontSize: 12.5,
            fontWeight: 800,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <Plus size={14} strokeWidth={2.6} />
          작성
        </button>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {state === 'ready' && records.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <FilterChip label="전체" selected={year === 'all'} onClick={() => setYear('all')} />
            {years.map((y) => (
              <FilterChip key={y} label={`${y}`} selected={year === y} onClick={() => setYear(y)} />
            ))}
          </div>
        )}

        {state === 'loading' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ height: 104, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.05)' }} className="animate-pulse" />
            ))}
          </div>
        )}

        {state === 'error' && <ErrorState onRetry={() => void load()} />}

        {state === 'ready' && records.length === 0 && (
          <EmptyState onAdd={() => router.push('/tennis-log/lessons/new')} />
        )}

        {state === 'ready' && records.length > 0 && filtered.length === 0 && (
          <p style={{ margin: '20px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: FAINT }}>
            선택한 연도의 레슨이 없어요.
          </p>
        )}

        {state === 'ready' &&
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => router.push(`/tennis-log/lessons/${r.id}`)}
              style={{
                textAlign: 'left',
                backgroundColor: '#FFFFFF',
                border: `1px solid ${CARD_BORDER}`,
                borderRadius: 14,
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                padding: '14px 15px',
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
                cursor: 'pointer',
                width: '100%',
                boxSizing: 'border-box',
              }}
              className="active:scale-[0.99]"
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: SUB, whiteSpace: 'nowrap' }}>
                  {formatDate(r.lesson_date)}
                  {r.coach_name ? ` · ${r.coach_name}` : ''}
                </span>
              </div>

              <span style={{ fontSize: 14.5, fontWeight: 800, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.lesson_topic}
              </span>

              {r.learned_points && <ClampText label="배운 점" text={r.learned_points} lines={2} />}
              {r.correction_points && <ClampText label="교정" text={r.correction_points} lines={1} />}
              {r.practice_tasks && <ClampText label="과제" text={r.practice_tasks} lines={1} />}
            </button>
          ))}
      </div>
    </div>
  );
}

function ClampText({ label, text, lines }: { label: string; text: string; lines: number }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 12,
        fontWeight: 500,
        color: '#586478',
        lineHeight: 1.55,
        display: '-webkit-box',
        WebkitLineClamp: lines,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        wordBreak: 'keep-all',
      }}
    >
      <span style={{ fontWeight: 700, color: FAINT }}>{label} · </span>
      {text}
    </p>
  );
}

function FilterChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: '0 0 auto',
        padding: '7px 14px',
        borderRadius: 999,
        border: selected ? `1px solid ${TEAL}` : `1px solid ${FIELD_BORDER}`,
        backgroundColor: selected ? TEAL : '#FFFFFF',
        color: selected ? '#FFFFFF' : SUB,
        fontSize: 12.5,
        fontWeight: 700,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      style={{
        backgroundColor: '#FFFFFF',
        border: `1px dashed rgba(15,27,51,0.14)`,
        borderRadius: 14,
        padding: '30px 18px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        textAlign: 'center',
      }}
    >
      <span
        style={{
          width: 46,
          height: 46,
          borderRadius: 13,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(15,27,51,0.05)',
          color: '#8595AD',
        }}
      >
        <GraduationCap size={22} strokeWidth={1.8} />
      </span>
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: INK }}>아직 작성한 레슨일지가 없습니다.</p>
      <p style={{ margin: 0, fontSize: 11.5, fontWeight: 500, color: FAINT, lineHeight: 1.5, wordBreak: 'keep-all' }}>
        오늘 배운 내용을 짧게 기록해 보세요.
      </p>
      <button
        type="button"
        onClick={onAdd}
        style={{
          marginTop: 4,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '10px 18px',
          borderRadius: 11,
          border: 'none',
          backgroundColor: TEAL,
          color: '#FFFFFF',
          fontSize: 13,
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        <Plus size={15} strokeWidth={2.6} />
        레슨일지 작성
      </button>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      style={{
        backgroundColor: '#FFFFFF',
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 14,
        padding: '26px 18px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        textAlign: 'center',
      }}
    >
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: INK }}>레슨일지를 불러오지 못했어요</p>
      <p style={{ margin: 0, fontSize: 11.5, fontWeight: 500, color: FAINT }}>네트워크 상태를 확인한 뒤 다시 시도해 주세요.</p>
      <button
        type="button"
        onClick={onRetry}
        style={{
          marginTop: 4,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '10px 18px',
          borderRadius: 11,
          border: `1px solid ${FIELD_BORDER}`,
          backgroundColor: '#FFFFFF',
          color: NAVY,
          fontSize: 13,
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        <RotateCcw size={15} strokeWidth={2.4} />
        다시 시도
      </button>
    </div>
  );
}
