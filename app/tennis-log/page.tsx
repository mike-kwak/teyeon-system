'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  GraduationCap,
  Lock,
  NotebookPen,
  Plus,
  Target,
  Trophy,
} from 'lucide-react';
import {
  TENNIS_LOG_LOCKED_TITLE,
  TENNIS_LOG_LOCKED_BODY,
} from '@/lib/tennisLogAccess';
import { useTennisLogAccess } from '@/hooks/useTennisLogAccess';
import { countTournamentsByYear, getRecentTournaments } from '@/lib/tennisLogTournamentService';
import { displayFinalResult, type TournamentRecord } from '@/types/tennisLog';

// Cool Premium Light 토큰
const NAVY = '#0F1B33';
const TEAL = '#0E7C76';
const AQUA = '#4B9DB6';
const INK = '#0F172A';
const SUB = '#64748B';
const FAINT = '#94A3B8';
const CARD_BORDER = 'rgba(0,0,0,0.06)';

const NEXT_STEP_TOAST = '다음 단계에서 제공될 기능입니다.';
const PRIVATE_NOTE = 'TENNIS LOG 기록은 본인만 확인할 수 있습니다.';

export default function TennisLogPage() {
  const router = useRouter();
  const access = useTennisLogAccess();
  const [isMounted, setIsMounted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 올해 요약 — 외부 대회는 실제 DB 연동. 레슨은 이번 작업 범위 밖(0 유지).
  const currentYear = new Date().getFullYear();
  const [yearlyTournamentCount, setYearlyTournamentCount] = useState<number | null>(null);
  const [recentTournaments, setRecentTournaments] = useState<TournamentRecord[]>([]);
  const [yearlyLessonCount] = useState<number>(0);
  const [practiceGoal] = useState<string | null>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // 홈 실제 데이터 — 회원 접근 허용 시에만 조회.
  useEffect(() => {
    if (access !== 'allowed') return;
    let cancelled = false;
    (async () => {
      const [countRes, recentRes] = await Promise.all([
        countTournamentsByYear(currentYear),
        getRecentTournaments(2),
      ]);
      if (cancelled) return;
      setYearlyTournamentCount(countRes.error ? 0 : countRes.data ?? 0);
      setRecentTournaments(recentRes.error ? [] : recentRes.data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [access, currentYear]);

  // 미로그인은 NavigationGuard 가 '/'로 보내지만, 안전하게 한 번 더 가드.
  useEffect(() => {
    if (access === 'unauthenticated') {
      router.replace('/');
    }
  }, [access, router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // 조회 중/미로그인 — 정상 접근으로 보이지 않도록 렌더하지 않음(안전한 기본값).
  if (!isMounted || access === 'loading') return null;
  if (access === 'unauthenticated') return null;

  // 게스트/준회원 → 회원 전용 안내 + 메인으로 복귀
  if (access === 'locked') {
    return (
      <div
        style={{
          width: '100%',
          maxWidth: 450,
          margin: '0 auto',
          padding: '0 16px',
          minHeight: '60dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 340,
            backgroundColor: '#FFFFFF',
            border: `1px solid ${CARD_BORDER}`,
            borderRadius: 16,
            boxShadow: '0 2px 14px rgba(0,0,0,0.05)',
            padding: '28px 22px 24px',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              margin: '0 auto',
              borderRadius: '50%',
              backgroundColor: 'rgba(100,116,139,0.10)',
              color: '#475569',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Lock size={22} strokeWidth={2.2} />
          </div>
          <h1 style={{ margin: '14px 0 0', fontSize: 17, fontWeight: 900, color: NAVY, wordBreak: 'keep-all' }}>
            {TENNIS_LOG_LOCKED_TITLE}
          </h1>
          <p style={{ margin: '10px 0 0', fontSize: 13, fontWeight: 600, color: SUB, lineHeight: 1.6, wordBreak: 'keep-all' }}>
            {TENNIS_LOG_LOCKED_BODY}
          </p>
          <button
            type="button"
            onClick={() => router.replace('/')}
            style={{
              marginTop: 20,
              width: '100%',
              height: 46,
              borderRadius: 12,
              border: 'none',
              backgroundColor: TEAL,
              color: '#FFFFFF',
              fontSize: 14,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            메인으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  // ── allowed: TENNIS LOG 홈 ──────────────────────────────────────────────
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 450,
        margin: '0 auto',
        padding: '0 16px',
        paddingBottom: 'calc(28px + env(safe-area-inset-bottom))',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <section
        style={{
          marginTop: 14,
          marginBottom: 14,
          borderRadius: 16,
          overflow: 'hidden',
          border: `1px solid ${CARD_BORDER}`,
          boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
          background: 'linear-gradient(135deg, #0E7E76 0%, #12968B 58%, #1EA89B 100%)',
        }}
      >
        <div style={{ position: 'relative', padding: '16px 18px 18px' }}>
          <NotebookPen
            aria-hidden
            size={120}
            strokeWidth={1.2}
            style={{ position: 'absolute', right: -18, top: -14, color: '#FFFFFF', opacity: 0.08, pointerEvents: 'none' }}
          />
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <p
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-rajdhani), sans-serif',
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: '0.28em',
                  textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.78)',
                }}
              >
                TEYEON · PRIVATE
              </p>
              <h1 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: '#FFFFFF', lineHeight: 1.15 }}>
                TENNIS LOG
              </h1>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,0.86)' }}>
                나만의 테니스 기록
              </p>
            </div>
            {/* 나만 보기 — 표시 전용. 탭하면 안내 노트. */}
            <button
              type="button"
              onClick={() => setToast(PRIVATE_NOTE)}
              aria-label="나만 보기 — 기록은 본인만 확인할 수 있습니다"
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 10px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.30)',
                backgroundColor: 'rgba(255,255,255,0.14)',
                color: '#FFFFFF',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <Lock size={12} strokeWidth={2.4} />
              나만 보기
            </button>
          </div>
        </div>
      </section>

      {/* 올해 요약 */}
      <SectionTitle>올해 요약</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
        <SummaryCard
          icon={<Trophy size={18} strokeWidth={1.9} />}
          accent={TEAL}
          label={`${currentYear} 외부 대회`}
          count={yearlyTournamentCount ?? 0}
          loading={yearlyTournamentCount === null}
        />
        <SummaryCard
          icon={<GraduationCap size={18} strokeWidth={1.9} />}
          accent={AQUA}
          label={`${currentYear} 레슨`}
          count={yearlyLessonCount}
        />
      </div>

      {/* 현재 연습 목표 */}
      <SectionTitle>현재 연습 목표</SectionTitle>
      <div
        style={{
          marginBottom: 18,
          backgroundColor: '#FFFFFF',
          border: `1px solid ${CARD_BORDER}`,
          borderRadius: 14,
          boxShadow: '0 1px 5px rgba(0,0,0,0.04)',
          padding: '18px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 13,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            minWidth: 40,
            borderRadius: 11,
            backgroundColor: 'rgba(14,124,118,0.10)',
            color: TEAL,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Target size={19} strokeWidth={1.9} />
        </div>
        <div style={{ minWidth: 0 }}>
          {practiceGoal ? (
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: INK, lineHeight: 1.5 }}>{practiceGoal}</p>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: INK }}>아직 설정한 목표가 없어요</p>
              <p style={{ margin: '3px 0 0', fontSize: 11.5, fontWeight: 500, color: FAINT, lineHeight: 1.5 }}>
                이번 시즌의 연습 목표를 기록해 보세요.
              </p>
            </>
          )}
        </div>
      </div>

      {/* 빠른 액션 */}
      <SectionTitle>빠른 액션</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
        <QuickAction
          icon={<Trophy size={17} strokeWidth={1.9} />}
          accent={TEAL}
          label="대회 기록 추가"
          onClick={() => router.push('/tennis-log/tournaments/new')}
        />
        <QuickAction
          icon={<GraduationCap size={17} strokeWidth={1.9} />}
          accent={AQUA}
          label="레슨일지 작성"
          onClick={() => setToast(NEXT_STEP_TOAST)}
        />
      </div>

      {/* 최근 대회 — 실제 DB 연동 */}
      <SectionHeaderRow title="최근 대회" onViewAll={() => router.push('/tennis-log/tournaments')} />
      {recentTournaments.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {recentTournaments.map((r) => (
            <RecentTournamentCard
              key={r.id}
              record={r}
              onClick={() => router.push(`/tennis-log/tournaments/${r.id}`)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Trophy size={20} strokeWidth={1.8} />}
          title="아직 기록한 대회가 없어요"
          body="외부 대회 결과를 기록하면 이곳에 모여요."
        />
      )}

      {/* 최근 레슨 */}
      <div style={{ height: 18 }} />
      <SectionHeaderRow title="최근 레슨" onViewAll={() => setToast(NEXT_STEP_TOAST)} />
      <EmptyState
        icon={<GraduationCap size={20} strokeWidth={1.8} />}
        title="아직 작성한 레슨일지가 없어요"
        body="레슨 내용을 남기면 이곳에서 다시 볼 수 있어요."
      />

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 88,
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
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ── 보조 컴포넌트 ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: '0 0 9px 2px', fontSize: 12.5, fontWeight: 800, color: NAVY, letterSpacing: '-0.01em' }}>
      {children}
    </p>
  );
}

function SectionHeaderRow({ title, onViewAll }: { title: string; onViewAll: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 2px 9px' }}>
      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: NAVY, letterSpacing: '-0.01em' }}>{title}</p>
      <button
        type="button"
        onClick={onViewAll}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          background: 'none',
          border: 'none',
          padding: '2px 2px 2px 6px',
          cursor: 'pointer',
          fontSize: 11.5,
          fontWeight: 700,
          color: SUB,
        }}
      >
        전체 보기
        <ChevronRight size={13} strokeWidth={2.2} style={{ color: '#CBD5E1' }} />
      </button>
    </div>
  );
}

function SummaryCard({
  icon,
  accent,
  label,
  count,
  loading,
}: {
  icon: React.ReactNode;
  accent: string;
  label: string;
  count: number;
  loading?: boolean;
}) {
  return (
    <div
      style={{
        backgroundColor: '#FFFFFF',
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 14,
        boxShadow: '0 1px 5px rgba(0,0,0,0.04)',
        padding: '15px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        minWidth: 0,
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${accent}1A`,
          color: accent,
        }}
      >
        {icon}
      </span>
      <p
        style={{
          margin: 0,
          fontSize: 11.5,
          fontWeight: 600,
          color: FAINT,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </p>
      <p style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 2, minHeight: 22 }}>
        {loading ? (
          <span style={{ width: 26, height: 18, borderRadius: 5, backgroundColor: 'rgba(0,0,0,0.07)', display: 'inline-block' }} className="animate-pulse" />
        ) : (
          <span style={{ fontSize: 22, fontWeight: 800, color: INK, letterSpacing: '-0.02em', lineHeight: 1 }}>
            {count}
          </span>
        )}
        <span style={{ fontSize: 12, fontWeight: 700, color: SUB }}>회</span>
      </p>
    </div>
  );
}

function RecentTournamentCard({ record, onClick }: { record: TournamentRecord; onClick: () => void }) {
  const dateLabel = (() => {
    const [y, m, d] = (record.tournament_date || '').split('-');
    return y && m && d ? `${y}.${m}.${d}` : record.tournament_date || '';
  })();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        width: '100%',
        boxSizing: 'border-box',
        backgroundColor: '#FFFFFF',
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 14,
        boxShadow: '0 1px 5px rgba(0,0,0,0.04)',
        padding: '13px 15px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        cursor: 'pointer',
      }}
      className="active:scale-[0.99]"
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: SUB, whiteSpace: 'nowrap' }}>
          {dateLabel}
          {record.partner_name ? ` · ${record.partner_name}` : ''}
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
            maxWidth: '52%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {displayFinalResult(record)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: TEAL, flexShrink: 0 }}>{record.event_type}</span>
        <span style={{ color: '#D5DCE6', flexShrink: 0 }}>·</span>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: INK, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {record.tournament_name}
        </span>
      </div>
      {record.one_line_review && (
        <p
          style={{
            margin: 0,
            fontSize: 11.5,
            fontWeight: 500,
            color: '#586478',
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 1,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            wordBreak: 'keep-all',
          }}
        >
          {record.one_line_review}
        </p>
      )}
    </button>
  );
}

function QuickAction({
  icon,
  accent,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  accent: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#FFFFFF',
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 14,
        boxShadow: '0 1px 5px rgba(0,0,0,0.04)',
        padding: '14px 13px',
        cursor: 'pointer',
        textAlign: 'left',
        minWidth: 0,
      }}
      className="active:scale-[0.98]"
    >
      <span
        style={{
          width: 32,
          height: 32,
          minWidth: 32,
          borderRadius: 9,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${accent}1A`,
          color: accent,
          position: 'relative',
        }}
      >
        {icon}
        <Plus
          size={11}
          strokeWidth={3}
          style={{ position: 'absolute', right: -3, bottom: -3, color: accent, backgroundColor: '#FFFFFF', borderRadius: '50%' }}
        />
      </span>
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 700,
          color: INK,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </button>
  );
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div
      style={{
        backgroundColor: '#FFFFFF',
        border: `1px dashed rgba(15,27,51,0.14)`,
        borderRadius: 14,
        padding: '22px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        textAlign: 'center',
      }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(15,27,51,0.05)',
          color: '#8595AD',
        }}
      >
        {icon}
      </span>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: INK }}>{title}</p>
      <p style={{ margin: 0, fontSize: 11.5, fontWeight: 500, color: FAINT, lineHeight: 1.5, wordBreak: 'keep-all' }}>
        {body}
      </p>
    </div>
  );
}
