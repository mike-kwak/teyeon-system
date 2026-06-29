'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react';
import { useTennisLogAccess } from '@/hooks/useTennisLogAccess';
import { getTournament, deleteTournament } from '@/lib/tennisLogTournamentService';
import {
  displayFinalResult,
  displayParticipationCategory,
  matchOutcomeLabel,
  type TournamentRecord,
} from '@/types/tennisLog';
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

export default function TournamentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const raw = params?.id;
  const id = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';

  const access = useTennisLogAccess();
  const [isMounted, setIsMounted] = useState(false);
  const [state, setState] = useState<FetchState>('loading');
  const [record, setRecord] = useState<TournamentRecord | null>(null);
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
      const { data, error } = await getTournament(id);
      if (cancelled) return;
      if (error) {
        setState('error');
        return;
      }
      if (!data) {
        setState('notfound');
        return;
      }
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
    const { error } = await deleteTournament(id);
    setDeleting(false);
    if (error) {
      setConfirmDelete(false);
      setToast(error);
      return;
    }
    setConfirmDelete(false);
    setToast('기록을 삭제했습니다.');
    router.replace('/tennis-log/tournaments');
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
        onClick={() => router.push('/tennis-log/tournaments')}
        aria-label="뒤로"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: NAVY }}
      >
        <ChevronLeft size={20} strokeWidth={2.2} />
        <span style={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap' }}>대회 상세</span>
      </button>
      {state === 'ready' && (
        <button
          type="button"
          onClick={() => router.push(`/tennis-log/tournaments/${id}/edit`)}
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
          <div key={i} style={{ height: i === 0 ? 110 : 72, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.05)' }} className="animate-pulse" />
        ))}
      </div>,
    );
  }

  // 본인 기록이 아니거나 존재하지 않는 id — 민감 차이 노출 없이 동일 처리.
  if (state === 'notfound' || state === 'error' || !record) {
    return wrap(
      <div style={{ minHeight: '50dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ textAlign: 'center', maxWidth: 320 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: NAVY }}>기록을 찾을 수 없습니다</p>
          <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 600, color: SUB, lineHeight: 1.6 }}>
            이미 삭제되었거나 접근할 수 없는 기록입니다.
          </p>
          <button
            type="button"
            onClick={() => router.replace('/tennis-log/tournaments')}
            style={{ marginTop: 18, height: 44, padding: '0 22px', borderRadius: 11, border: 'none', backgroundColor: TEAL, color: '#FFFFFF', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}
          >
            목록으로
          </button>
        </div>
      </div>,
    );
  }

  const r = record;
  const dateLine = [formatDate(r.tournament_date), r.region, r.venue].filter(Boolean).join(' · ');
  const participationLabel = displayParticipationCategory(r);

  return wrap(
    <div
      style={{
        padding: '14px 16px',
        paddingBottom: 'calc(110px + env(safe-area-inset-bottom))',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {/* Hero */}
      <section
        style={{
          borderRadius: 16,
          overflow: 'hidden',
          border: `1px solid ${CARD_BORDER}`,
          boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
          background: 'linear-gradient(135deg, #0E7E76 0%, #12968B 58%, #1EA89B 100%)',
          padding: '16px 18px 18px',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 9 }}>
          <Pill>{r.event_type}</Pill>
          <Pill>{displayFinalResult(r)}</Pill>
          {participationLabel && <Pill>{participationLabel}</Pill>}
        </div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em', color: '#FFFFFF', lineHeight: 1.25, wordBreak: 'keep-all' }}>
          {r.tournament_name}
        </h1>
        <p style={{ margin: '7px 0 0', fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,0.88)', wordBreak: 'keep-all' }}>
          {dateLine}
        </p>
      </section>

      {/* 기본 정보 */}
      <Card>
        <InfoRow label="종목" value={r.event_type} />
        {participationLabel && <InfoRow label="참가 구분" value={participationLabel} />}
        {hasText(r.partner_name) && <InfoRow label="파트너" value={r.partner_name!} />}
        <InfoRow label="최종 성적" value={displayFinalResult(r)} />
        {r.condition_rating != null && <InfoRow label="컨디션" value={`${r.condition_rating} / 5`} />}
      </Card>

      {/* 한 줄 회고 */}
      <TextSection title="한 줄 회고" body={r.one_line_review} />

      {/* 경기별 결과 */}
      {r.match_results.length > 0 && (
        <div>
          <SectionLabel>경기별 결과</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {r.match_results.map((m, idx) => {
              const score = [m.scoreFor, m.scoreAgainst].filter((s) => s && s.trim()).join(' : ');
              return (
                <div key={m.id || idx} style={{ backgroundColor: '#FFFFFF', border: `1px solid ${CARD_BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: INK, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[m.stage, m.opponent].filter((s) => s && s.trim()).join(' · ') || `경기 ${idx + 1}`}
                    </span>
                    <span
                      style={{
                        flexShrink: 0,
                        padding: '2px 9px',
                        borderRadius: 999,
                        backgroundColor: m.result === 'win' ? 'rgba(14,124,118,0.12)' : m.result === 'loss' ? 'rgba(220,38,38,0.10)' : 'rgba(100,116,139,0.12)',
                        color: m.result === 'win' ? TEAL : m.result === 'loss' ? '#DC2626' : SUB,
                        fontSize: 11,
                        fontWeight: 800,
                      }}
                    >
                      {matchOutcomeLabel(m.result)}
                    </span>
                  </div>
                  {score && <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 700, color: SUB }}>{score}</p>}
                  {hasText(m.memo) && (
                    <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 500, color: FAINT, lineHeight: 1.5, wordBreak: 'keep-all' }}>{m.memo}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 회고 상세 — 값 있는 것만 */}
      {hasText(r.good_points) && <TextSection title="잘된 점" body={r.good_points!} />}
      {hasText(r.improvements) && <TextSection title="아쉬운 점" body={r.improvements!} />}
      {hasText(r.next_goal) && <TextSection title="다음 개선 목표" body={r.next_goal!} />}
      {hasText(r.partner_memo) && <TextSection title="파트너 호흡 메모" body={r.partner_memo!} />}

      {/* 액션 */}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button
          type="button"
          onClick={() => router.push(`/tennis-log/tournaments/${id}/edit`)}
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
          aria-label="기록 삭제"
        >
          <Trash2 size={18} strokeWidth={2} />
        </button>
      </div>

      <TennisLogConfirmDialog
        open={confirmDelete}
        title="대회 기록을 삭제할까요?"
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

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 999,
        backgroundColor: 'rgba(255,255,255,0.18)',
        border: '1px solid rgba(255,255,255,0.28)',
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        backgroundColor: '#FFFFFF',
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 14,
        boxShadow: '0 1px 5px rgba(0,0,0,0.04)',
        padding: '6px 16px',
      }}
    >
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, padding: '10px 0', borderBottom: '1px solid rgba(15,27,51,0.05)' }}>
      <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: FAINT }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: INK, textAlign: 'right', wordBreak: 'keep-all', minWidth: 0 }}>{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '0 0 8px 2px', fontSize: 12.5, fontWeight: 800, color: NAVY }}>{children}</p>;
}

function TextSection({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <div style={{ backgroundColor: '#FFFFFF', border: `1px solid ${CARD_BORDER}`, borderRadius: 14, padding: '13px 15px' }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#334155', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'keep-all' }}>
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
