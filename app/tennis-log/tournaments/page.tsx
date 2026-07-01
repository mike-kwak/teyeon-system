'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Plus, Trophy, RotateCcw } from 'lucide-react';
import { useTennisLogAccess } from '@/hooks/useTennisLogAccess';
import { listTournaments } from '@/lib/tennisLogTournamentService';
import { displayFinalResult, type TournamentRecord } from '@/types/tennisLog';

const NAVY = '#0F1B33';
const TEAL = '#0E7C76';
const INK = '#0F172A';
const SUB = '#64748B';
const FAINT = '#94A3B8';
const CARD_BORDER = 'rgba(0,0,0,0.06)';
const FIELD_BORDER = 'rgba(15,27,51,0.14)';

type FetchState = 'loading' | 'ready' | 'error';

function formatDate(d: string): string {
  // 'YYYY-MM-DD' → 'YYYY.MM.DD'
  const [y, m, day] = (d || '').split('-');
  if (!y || !m || !day) return d || '';
  return `${y}.${m}.${day}`;
}

export default function TournamentListPage() {
  const router = useRouter();
  const access = useTennisLogAccess();
  const [isMounted, setIsMounted] = useState(false);
  const [state, setState] = useState<FetchState>('loading');
  const [records, setRecords] = useState<TournamentRecord[]>([]);
  const [year, setYear] = useState<number | 'all'>('all');

  useEffect(() => setIsMounted(true), []);

  useEffect(() => {
    if (access === 'unauthenticated') router.replace('/');
    else if (access === 'locked') router.replace('/tennis-log');
  }, [access, router]);

  const load = useMemo(
    () => async () => {
      setState('loading');
      const { data, error } = await listTournaments();
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
      const y = Number((r.tournament_date || '').slice(0, 4));
      if (y) set.add(y);
    }
    set.add(new Date().getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [records]);

  const filtered = useMemo(() => {
    if (year === 'all') return records;
    return records.filter((r) => Number((r.tournament_date || '').slice(0, 4)) === year);
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
          <span style={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap' }}>대회 기록</span>
        </button>
        <button
          type="button"
          onClick={() => router.push('/tennis-log/tournaments/new')}
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
          추가
        </button>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 연도 필터 */}
        {state === 'ready' && records.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <FilterChip label="전체" selected={year === 'all'} onClick={() => setYear('all')} />
            {years.map((y) => (
              <FilterChip key={y} label={`${y}`} selected={year === y} onClick={() => setYear(y)} />
            ))}
          </div>
        )}

        {/* 로딩 */}
        {state === 'loading' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ height: 96, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.05)' }} className="animate-pulse" />
            ))}
          </div>
        )}

        {/* 오류 */}
        {state === 'error' && (
          <ErrorState onRetry={() => void load()} />
        )}

        {/* 빈 상태 */}
        {state === 'ready' && records.length === 0 && (
          <EmptyState onAdd={() => router.push('/tennis-log/tournaments/new')} />
        )}

        {/* 필터 결과 없음 */}
        {state === 'ready' && records.length > 0 && filtered.length === 0 && (
          <p style={{ margin: '20px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: FAINT }}>
            선택한 연도의 기록이 없어요.
          </p>
        )}

        {/* 목록 */}
        {state === 'ready' &&
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => router.push(`/tennis-log/tournaments/${r.id}`)}
              style={{
                textAlign: 'left',
                backgroundColor: '#FFFFFF',
                border: `1px solid ${CARD_BORDER}`,
                borderRadius: 14,
                boxShadow: '0 1px 5px rgba(0,0,0,0.04)',
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
                  {formatDate(r.tournament_date)}
                  {r.region ? ` · ${r.region}` : ''}
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    padding: '3px 9px',
                    borderRadius: 999,
                    backgroundColor: 'rgba(14,124,118,0.10)',
                    color: TEAL,
                    fontSize: 11,
                    fontWeight: 800,
                    whiteSpace: 'nowrap',
                    maxWidth: '50%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {displayFinalResult(r)}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: TEAL, flexShrink: 0 }}>{r.event_type}</span>
                <span style={{ color: '#D5DCE6', flexShrink: 0 }}>·</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: INK, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.tournament_name}
                </span>
              </div>

              {r.partner_name && (
                <span style={{ fontSize: 11.5, fontWeight: 600, color: SUB, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  파트너 · {r.partner_name}
                </span>
              )}

              {r.one_line_review && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#586478',
                    lineHeight: 1.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    wordBreak: 'keep-all',
                  }}
                >
                  {r.one_line_review}
                </p>
              )}
            </button>
          ))}
      </div>
    </div>
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
        <Trophy size={22} strokeWidth={1.8} />
      </span>
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: INK }}>아직 기록한 대회가 없어요</p>
      <p style={{ margin: 0, fontSize: 11.5, fontWeight: 500, color: FAINT, lineHeight: 1.5, wordBreak: 'keep-all' }}>
        외부 대회 결과를 기록하면 이곳에 모여요.
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
        대회 기록 추가
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
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: INK }}>기록을 불러오지 못했어요</p>
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
