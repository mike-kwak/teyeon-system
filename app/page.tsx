'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Layout,
  Lock,
  MapPin,
  NotebookPen,
  Settings,
  Swords,
  Trophy,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { fetchClubSchedules } from '@/lib/clubScheduleService';
// 메인은 다음 일정 계산에 id/title/date/status 만 쓰므로 경량 요약 조회를 사용
//   (fetchTournamentEvents 는 캘린더 전용 대진/파트너 신청까지 2요청을 추가로 발생시킴).
import { fetchTournamentEventSummariesForHome } from '@/lib/tournamentCalendarService';
import {
  TENNIS_LOG_LOCKED_TITLE,
  TENNIS_LOG_LOCKED_BODY,
} from '@/lib/tennisLogAccess';
import { useTennisLogAccess } from '@/hooks/useTennisLogAccess';
import LuckyVickySpotlight from '@/components/home/LuckyVickySpotlight';

// ─── 다음 일정 선정 ───────────────────────────────────────────────────────
// Club Schedule + Tournament Schedule을 단일 비교 구조로 변환해 가장 가까운 1건 선정.
// - 현재 시각 이후 일정만 대상
// - 취소/종료 상태 제외
// - 시작 일시 오름차순 (동일 시각이면 Club 우선)

type NextScheduleItem = {
    id: string;
    type: 'club' | 'tournament';
    title: string;
    startsAt: Date;
    href: string;
};

const buildDate = (date: string, time?: string | null): Date => {
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d) return new Date(NaN);
    const t = (time || '').slice(0, 5);
    const [hh, mm] = t.split(':').map(Number);
    return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
};

const formatNextScheduleValue = (item: NextScheduleItem): string => {
    const m = item.startsAt.getMonth() + 1;
    const d = item.startsAt.getDate();
    const dateLabel = `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    return `${dateLabel} ${item.title}`;
};


/**
 * TEYEON 메인 — F · Club Board Premium (최종)
 * - 기존 slim ticker 제거 → Header(전역) 바로 아래 Hero가 이어짐
 * - Hero: 상단 teal/aqua band(TEYEON TENNIS CLUB / 테니스로 이어진 인연.)
 *          + 하단 3분할 통계(활동 회원 / 누적 KDK / 다음 일정)
 * - 첫 메뉴 카드(대진 생성)는 얇은 teal border + 좌측 accent line으로 약하게 강조
 * - Notice bar는 렌더하지 않음. 향후 공지 노출 시 NoticeBar slot에 조건부 삽입 가능.
 * - 360px / 390px 반응형 — Hero 내부 gap/typography 축소, 카드 잘림 방지
 * - 데이터 로직(activeMemberCount, totalKdkCount), Link href, Auth 흐름 미수정.
 */

export default function Home() {
  const { user, signInWithKakao, isLoading, systemMessage, role } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  // 권한 없는 제한 메뉴 클릭 시 안내(제목+내용). 프론트 UX 전용 — 실제 보호는 각 페이지/RLS 유지.
  const [permAlert, setPermAlert] = useState<{ title: string; body: string } | null>(null);
  // 기존 role 판별 재사용. 메뉴 카드는 user 로그인 + 로딩 완료 후에만 렌더되므로 role 은 확정 상태.
  //   재무: 게스트만 차단 — 일반 회원(MEMBER)은 기존처럼 /finance 의 '나의 납부 현황' 진입 유지.
  //   관리자 설정: CEO/ADMIN 만 진입(그 외 MEMBER/게스트 차단). 실제 보호는 각 페이지/RLS 가 유지.
  const canFinance = role !== 'GUEST';
  const canAdmin = role === 'CEO' || role === 'ADMIN';
  // TENNIS LOG(회원 전용 개인 기록): 실제 클럽 회원 자격(members.role) 기준 공통 판정.
  //   조회 중(loading)에는 'allowed'가 아니므로 카드가 정상 접근으로 보이지 않음(안전한 잠금 기본값).
  const tennisLogStatus = useTennisLogAccess();
  const [isMounted, setIsMounted] = useState(false);
  // null = 조회 전(— 표시). 과거에 24를 초기값으로 박아둬 실제 인원과 다른 숫자가
  // 정적 HTML/첫 렌더에 잔상으로 노출됐다 — 숫자는 조회 완료 후에만 표시한다.
  const [activeMemberCount, setActiveMemberCount] = useState<number | null>(null);
  const [totalKdkCount, setTotalKdkCount] = useState<number | null>(null);
  const [nextSchedule, setNextSchedule] = useState<NextScheduleItem | null>(null);

  const CURRENT_VERSION = 'v5.0 Guest Fix';

  // 향후 조건부 공지 노출 슬롯 — 값이 truthy 일 때만 NoticeBar 렌더링.
  // 예: useState로 server fetch 결과를 받거나, props/context로 주입.
  // 기본은 null이라 빈 영역/여백이 남지 않음.
  const noticeMessage: string | null = null;

  useEffect(() => {
    // 활동 회원 = 정회원 + 준회원 (role 기준); role = '게스트' 제외
    //   select('*') 금지 — members 는 column-level GRANT(안전 컬럼만)라 '*' 는 permission denied.
    //   count 전용(head:true)이라 GRANT 된 최소 컬럼 id 만 지정한다.
    const CLUB_ID = process.env.NEXT_PUBLIC_CLUB_ID || '512d047d-a076-4080-97e5-6bb5a2c07819';
    supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', CLUB_ID)
      .neq('role', '게스트')
      .then(({ count, error }) => {
        if (error) {
          console.warn('[Home] 활동 회원 count 조회 실패 — placeholder(—) 유지:', error.message);
          return;
        }
        if (count !== null) setActiveMemberCount(count); // 실제 0명 성공 조회면 0명으로 표시
      });

    // 공식 KDK 세션 수
    supabase
      .from('teyeon_archive_v1')
      .select('*', { count: 'exact', head: true })
      .eq('is_official', true)
      .eq('is_test', false)
      .then(({ count, error }) => {
        if (error) {
          console.warn('[Home] KDK count 조회 실패 — placeholder(—) 유지:', error.message);
          return;
        }
        if (count !== null) setTotalKdkCount(count); // 실제 0건 성공 조회면 0회로 표시
      });

    // 다음 일정 선정 — Club + Tournament 합쳐 가장 가까운 1건.
    // 기존 fetch 함수 재사용 (별도 쿼리 작성 X). 두 fetch 중 하나가 실패해도 다른 쪽으로 폴백.
    (async () => {
      try {
        const now = new Date();
        const [clubResult, tournamentResult] = await Promise.allSettled([
          fetchClubSchedules(),
          fetchTournamentEventSummariesForHome(),
        ]);

        const items: NextScheduleItem[] = [];

        if (clubResult.status === 'fulfilled') {
          for (const cs of clubResult.value) {
            // demo 데이터(id startsWith 'demo-') 제외
            if (!cs.id || cs.id.startsWith('demo-')) continue;
            const startsAt = buildDate(cs.schedule_date, cs.start_time);
            if (Number.isNaN(startsAt.getTime())) continue;
            if (startsAt.getTime() <= now.getTime()) continue;
            const typeShort =
              cs.schedule_type === '정모' || cs.schedule_type === '번개' ||
              cs.schedule_type === '회식' || cs.schedule_type === '기타'
                ? cs.schedule_type
                : '단체전';
            items.push({
              id: cs.id,
              type: 'club',
              title: typeShort,
              startsAt,
              href: cs.schedule_type === '정모' ? `/club-schedule/${cs.id}` : '/tournament-calendar',
            });
          }
        } else {
          console.warn('[Home] Club schedule fetch failed:', clubResult.reason);
        }

        if (tournamentResult.status === 'fulfilled') {
          const CANCELLED_OR_DONE = new Set(['대회취소', '대회종료']);
          for (const ev of tournamentResult.value) {
            if (!ev.date || !ev.id) continue;
            if (CANCELLED_OR_DONE.has(ev.status)) continue;
            const startsAt = buildDate(ev.date);
            if (Number.isNaN(startsAt.getTime())) continue;
            if (startsAt.getTime() <= now.getTime()) continue;
            items.push({
              id: ev.id,
              type: 'tournament',
              title: ev.title || '대회',
              startsAt,
              href: '/tournament-calendar',
            });
          }
        } else {
          console.warn('[Home] Tournament fetch failed:', tournamentResult.reason);
        }

        if (items.length === 0) {
          setNextSchedule(null);
          return;
        }

        // 정렬: 시작 시각 오름차순. 동일 시각이면 Club 우선.
        items.sort((a, b) => {
          const dt = a.startsAt.getTime() - b.startsAt.getTime();
          if (dt !== 0) return dt;
          if (a.type === b.type) return 0;
          return a.type === 'club' ? -1 : 1;
        });

        setNextSchedule(items[0]);
      } catch (err) {
        console.warn('[Home] Next schedule selection failed:', err);
        setNextSchedule(null);
      }
    })();
  }, []);

  useEffect(() => {
    setIsMounted(true);

    const savedVersion = localStorage.getItem('teyeon_pwa_version');
    if (savedVersion && savedVersion !== CURRENT_VERSION) {
      console.log(`[PWA] Version Mismatch: ${savedVersion} -> ${CURRENT_VERSION}. Forcing hard sync.`);
      localStorage.setItem('teyeon_pwa_version', CURRENT_VERSION);
      window.location.reload();
    } else {
      localStorage.setItem('teyeon_pwa_version', CURRENT_VERSION);
    }

    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // ─── 메뉴 accent 그룹 시스템 (3색) ──────────────────────────────────────
  // 메뉴 성격에 따라 3개 그룹으로 정돈. 색은 카테고리 식별 도구이며 카드 자체는
  // 모두 white + 동일 shadow/radius/padding으로 시스템 일관성 유지.
  //
  // teal: 경기/운영 (대진 생성, 스페셜 매치)
  // aqua: 일정/회원/게스트 (대회 캘린더, 멤버 프로필, GUEST JOIN)
  // gold: 관리/재무 (클럽 재무, 관리자 설정) — pale gold만 사용, 카드 누렁 방지
  //
  // line color는 icon color보다 약하게 (icon 100% 대비 ≈ 55~70% 강도) →
  // 정렬 가이드 느낌을 유지.
  const ACCENT_GROUPS = {
    teal: {
      icon:    '#0F9F98',
      iconBg:  'rgba(15,159,152,0.10)',
      line:    'rgba(15,159,152,0.30)',
      badgeBg: 'rgba(15,159,152,0.09)',
      badgeFg: '#0E8079',
      badgeBd: 'rgba(15,159,152,0.22)',
    },
    aqua: {
      icon:    '#4B9DB6',
      iconBg:  'rgba(75,157,182,0.10)',
      line:    'rgba(75,157,182,0.32)',
      badgeBg: 'rgba(75,157,182,0.09)',
      badgeFg: '#386F82',
      badgeBd: 'rgba(75,157,182,0.24)',
    },
    gold: {
      icon:    '#C79A32',
      iconBg:  'rgba(199,154,50,0.10)',
      line:    'rgba(199,154,50,0.32)',
      badgeBg: 'rgba(199,154,50,0.10)',
      badgeFg: '#8E6B17',
      badgeBd: 'rgba(199,154,50,0.24)',
    },
  } as const;
  type AccentGroup = keyof typeof ACCENT_GROUPS;

  const MenuCard = ({
    label,
    description,
    icon,
    path,
    comingSoon,
    badge,
    accent = 'teal',
    locked = false,
    lockedBadge = '권한 필요',
    deniedTitle,
    deniedBody,
  }: {
    label: string;
    description?: string;
    icon: React.ReactNode;
    path: string;
    comingSoon?: boolean;
    badge?: string;
    accent?: AccentGroup;
    /** 권한 없는 사용자에게만 true — Link 대신 클릭 시 권한 안내(permAlert) 표시. */
    locked?: boolean;
    /** 잠금 배지 문구. 기본 '권한 필요' — 회원 전용 메뉴는 '회원 전용' 등으로 지정. */
    lockedBadge?: string;
    deniedTitle?: string;
    deniedBody?: string;
  }) => {
    const c = ACCENT_GROUPS[accent];
    const showDenied = () =>
      setPermAlert({ title: deniedTitle || '접근 권한이 없습니다', body: deniedBody || '' });
    const cardStyle: React.CSSProperties = {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      borderRadius: 14,
      backgroundColor: '#FFFFFF',
      border: '1px solid rgba(0,0,0,0.06)',
      boxShadow: '0 1px 5px rgba(0,0,0,0.05)',
      padding: '13px 16px 13px 16px',
      textDecoration: 'none',
      transition: 'box-shadow 0.18s',
      // 잠금 카드도 과한 회색 처리 금지 — 살짝만 낮춰 사전 인지 정도로만.
      opacity: comingSoon ? 0.68 : locked ? 0.94 : 1,
      overflow: 'hidden',
      color: 'inherit',
      cursor: 'pointer',
    };
    const inner = (
      <>
      {/* 좌측 accent line — 모든 카드 공통 정렬 가이드.
          두께/시작점/끝점은 모든 카드 동일. 색은 그룹별로 다름. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 8,
          bottom: 8,
          width: 2,
          borderRadius: 2,
          backgroundColor: c.line,
        }}
      />

      {/* Icon container */}
      <div
        style={{
          width: 42,
          height: 42,
          minWidth: 42,
          borderRadius: 11,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.iconBg,
          color: c.icon,
        }}
      >
        {icon}
      </div>

      {/* Text block */}
      <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            flexWrap: 'nowrap',
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#1E293B',
              letterSpacing: '-0.01em',
              lineHeight: 1.3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </span>
          {badge && !comingSoon && !locked && (
            <span
              style={{
                flexShrink: 0,
                fontSize: 8,
                fontWeight: 800,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: 5,
                backgroundColor: c.badgeBg,
                color: c.badgeFg,
                border: `1px solid ${c.badgeBd}`,
              }}
            >
              {badge}
            </span>
          )}
          {comingSoon && (
            <span
              style={{
                flexShrink: 0,
                fontSize: 8,
                fontWeight: 800,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: 5,
                backgroundColor: 'rgba(239,68,68,0.08)',
                color: '#EF4444',
                border: '1px solid rgba(239,68,68,0.18)',
              }}
            >
              SOON
            </span>
          )}
          {locked && !comingSoon && (
            <span
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 8,
                fontWeight: 800,
                letterSpacing: '0.08em',
                padding: '2px 6px',
                borderRadius: 5,
                backgroundColor: 'rgba(100,116,139,0.10)',
                color: '#64748B',
                border: '1px solid rgba(100,116,139,0.22)',
              }}
            >
              <Lock size={8} strokeWidth={2.6} />
              {lockedBadge}
            </span>
          )}
        </div>
        {description && (
          <p
            style={{
              marginTop: 3,
              fontSize: 11,
              fontWeight: 500,
              color: '#94A3B8',
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {description}
          </p>
        )}
      </div>

      {/* Chevron */}
      <ChevronRight
        size={14}
        style={{ flexShrink: 0, color: '#CBD5E1', marginLeft: 4 }}
      />
      </>
    );

    // 권한 없는 사용자: navigation 차단 + 권한 안내. (pointer-events:none 미사용 — 클릭 안내 필요)
    if (locked) {
      return (
        <div
          role="button"
          tabIndex={0}
          aria-label={`${label} — 접근 권한 없음`}
          onClick={showDenied}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDenied(); }
          }}
          style={cardStyle}
          className="active:scale-[0.982]"
        >
          {inner}
        </div>
      );
    }

    // 권한 있는 사용자: 기존 Link/navigation 그대로 유지.
    return (
      <Link href={path} style={cardStyle} className="active:scale-[0.982]">
        {inner}
      </Link>
    );
  };

  if (!isMounted) return null;

  return (
    <main
      style={{
        position: 'relative',
        width: '100%',
        // minHeight:100dvh 제거: 이 <main> 이 뷰포트 높이(640)로 고정되면 콘텐츠(868)가 박스를 시각적으로
        //   넘쳐(visible overflow) GlobalMain 하단 clearance 가 실제 콘텐츠 아래에 적용되지 않는다.
        //   뷰포트 높이/스크롤은 GlobalMain 이 담당하고, 이 <main> 은 콘텐츠 높이만 갖는다.
        backgroundColor: '#F2F4F7',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        // overflowX 는 clip 사용: 'hidden' 은 overflow-y 를 auto 로 코어싱해 이 <main> 이 중첩 스크롤러가 된다.
        overflowX: 'clip',
        // 하단 BottomNav 여백은 공통 GlobalMain(var(--page-bottom-safe))이 단 한 번만 적용.
        // 페이지에서 BottomNav 높이/safe-area를 다시 계산하지 않는다(이중 패딩 방지).
      }}
    >
      {/* ─── 향후 조건부 NoticeBar 슬롯 ──────────────────────────────────────
          공지가 있을 때만 렌더링. 현재는 noticeMessage = null → 빈 여백 없음.
          공지 노출이 필요해지면 noticeMessage에 값 채우는 것만으로 활성화. */}
      {noticeMessage && (
        <div
          style={{
            width: '100%',
            maxWidth: 430,
            margin: '12px 16px 0',
            padding: '8px 12px',
            borderRadius: 10,
            backgroundColor: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.20)',
            color: '#B91C1C',
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1.4,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ flexShrink: 0 }}>● 공지</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {noticeMessage}
          </span>
        </div>
      )}

      {/* Page content — Header 바로 아래 Hero가 자연스럽게 이어지도록 marginTop 12px */}
      <div
        style={{
          width: '100%',
          maxWidth: 430,
          padding: '0 16px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ─── Club Board Hero ─────────────────────────────────────────────
            상단: teal band — TEYEON TENNIS CLUB / 테니스로 이어진 인연.
            하단: 3분할 통계 — 활동 회원 / 누적 KDK / 다음 일정              */}
        <section
          style={{
            marginTop: 12,
            marginBottom: 16,
            borderRadius: 16,
            backgroundColor: '#FFFFFF',
            border: '1px solid rgba(0,0,0,0.06)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
            overflow: 'hidden',
          }}
        >
          {/* 상단 teal band — 채도를 한 단계 낮춘 premium teal.
              gradient 색 차이는 미세하게만(끝점이 aqua-bright로 튀지 않도록). */}
          <div
            style={{
              position: 'relative',
              background:
                'linear-gradient(135deg, #0E7E76 0%, #12968B 60%, #1EA89B 100%)',
              paddingTop: 14,
              paddingRight: 18,
              paddingBottom: 16,
              paddingLeft: 18,
              overflow: 'hidden',
            }}
          >
            {/* 우측 은은한 tennis ball / court line motif — opacity 한 단계 낮춤. */}
            <svg
              aria-hidden
              viewBox="0 0 120 120"
              style={{
                position: 'absolute',
                right: -22,
                top: -18,
                width: 150,
                height: 150,
                opacity: 0.07,
                pointerEvents: 'none',
              }}
            >
              <circle cx="60" cy="60" r="42" fill="#FFFFFF" />
              <path
                d="M 26 50 Q 60 28 94 50"
                fill="none"
                stroke="#0D9488"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M 26 70 Q 60 92 94 70"
                fill="none"
                stroke="#0D9488"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>

            <p
              style={{
                fontFamily: 'var(--font-rajdhani), sans-serif',
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.78)',
                margin: 0,
              }}
            >
              TEYEON TENNIS CLUB
            </p>
            <h1
              style={{
                marginTop: 6,
                marginBottom: 0,
                fontSize: 20,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: '#FFFFFF',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',         // 한 줄 유지
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              테니스로 이어진 인연.
            </h1>
          </div>

          {/* 하단 3분할 통계 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              backgroundColor: '#FFFFFF',
            }}
          >
            <StatCell
              icon={<Users size={14} strokeWidth={1.8} />}
              value={activeMemberCount === null ? '—' : `${activeMemberCount}`}
              unit={activeMemberCount === null ? undefined : '명'}
              label="활동 회원"
              divider="right"
              href="/members"
              ariaLabel={activeMemberCount === null ? 'TEYEON 멤버 보기' : `TEYEON 멤버 ${activeMemberCount}명 보기`}
              hint
            />
            <StatCell
              icon={<Trophy size={14} strokeWidth={1.8} />}
              value={totalKdkCount === null ? '—' : `${totalKdkCount}`}
              unit={totalKdkCount === null ? undefined : '회'}
              label="누적 KDK"
              divider="right"
              href="/archive"
              ariaLabel={totalKdkCount === null ? 'TEYEON 공식 기록 보기' : `TEYEON 누적 KDK ${totalKdkCount}회 공식 기록 보기`}
              hint
            />
            <StatCell
              icon={<MapPin size={14} strokeWidth={1.8} />}
              value={nextSchedule ? formatNextScheduleValue(nextSchedule) : '일정 없음'}
              label="다음 일정"
              valueIsText
              href={nextSchedule?.href}
            />
          </div>

          {/* Culture Spotlight — 러키비키. 회원(allowed) + active 회차일 때만 노출(없으면 divider/여백 없음). */}
          {tennisLogStatus === 'allowed' && <LuckyVickySpotlight />}
        </section>

        {/* Loading skeleton */}
        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                style={{
                  height: 68,
                  borderRadius: 14,
                  backgroundColor: 'rgba(0,0,0,0.055)',
                }}
                className="animate-pulse"
              />
            ))}
          </div>
        )}

        {/* Not logged in */}
        {!isLoading && !user && (
          <div
            style={{
              borderRadius: 14,
              backgroundColor: '#FFFFFF',
              border: '1px solid rgba(0,0,0,0.06)',
              boxShadow: '0 2px 14px rgba(0,0,0,0.055)',
              padding: '28px 20px 24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <p
              style={{
                fontFamily: 'var(--font-rajdhani), sans-serif',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.20em',
                textTransform: 'uppercase',
                color: '#64748B',
                textAlign: 'center',
                lineHeight: 1.5,
              }}
            >
              TEYEON에 오신 것을 환영합니다
            </p>
            <button
              onClick={() => signInWithKakao()}
              style={{
                width: '100%',
                maxWidth: 260,
                padding: '13px 0',
                borderRadius: 99,
                backgroundColor: '#0D9488',
                border: 'none',
                fontFamily: 'var(--font-rajdhani), sans-serif',
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: '#FFFFFF',
                cursor: 'pointer',
                boxShadow: '0 3px 14px rgba(13,148,136,0.24)',
                transition: 'all 0.18s',
              }}
              className="active:scale-[0.97] hover:brightness-105"
            >
              카카오 계정으로 접속
            </button>
            <span
              style={{
                fontFamily: 'var(--font-rajdhani), sans-serif',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.26em',
                textTransform: 'uppercase',
                color: '#94A3B8',
              }}
            >
              Authorized Personnel Only
            </span>
          </div>
        )}

        {/* Logged in */}
        {!isLoading && user && (
          <>
            {/* Menu card stack */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {/* 그룹 1 — 경기/운영 (teal) */}
              <MenuCard
                label="대진 생성"
                description="KDK 대진표 생성 및 실시간 운영."
                icon={<Swords size={21} strokeWidth={1.7} />}
                path="/kdk"
                badge="KDK"
                accent="teal"
              />
              {/* 그룹 2 — 일정/회원/게스트 (aqua) */}
              <MenuCard
                label="TEYEON 일정"
                description="정모·번개·대회 일정과 참석 현황을 한곳에서 확인합니다."
                icon={<CalendarDays size={21} strokeWidth={1.7} />}
                path="/tournament-calendar"
                badge="SCHEDULE"
                accent="aqua"
              />
              {/* 그룹 1 — 경기/운영 (teal) */}
              <MenuCard
                label="스페셜 매치"
                description="수동 매치 운영 및 결과 기록."
                icon={<Layout size={21} strokeWidth={1.7} />}
                path="/special-match"
                badge="MANUAL"
                accent="teal"
              />
              {/* 그룹 2 — 일정/회원/게스트 (aqua) */}
              <MenuCard
                label="멤버 프로필"
                description="클럽 멤버 프로필 및 랭킹을 조회합니다."
                icon={<Users size={21} strokeWidth={1.7} />}
                path="/members"
                accent="aqua"
              />
              {/* RANKING — 시즌·월간·누적·FINAL·Awards·상대/파트너 전적 독립 영역 (aqua) */}
              <MenuCard
                label="RANKING"
                description="랭킹 · 어워즈 · 상대전적"
                icon={<Trophy size={21} strokeWidth={1.7} />}
                path="/ranking"
                accent="aqua"
              />
              {/* 그룹 3 — 관리/재무 (gold) */}
              <MenuCard
                label="TEYEON 재무"
                description="회비 납부 현황과 미납 내역을 확인합니다."
                icon={<CircleDollarSign size={21} strokeWidth={1.7} />}
                path="/finance"
                badge="FINANCE"
                accent="gold"
                locked={!isLoading && !canFinance}
                deniedTitle="접근 권한이 없습니다"
                deniedBody="재무 담당자 또는 관리자 권한이 필요한 메뉴입니다."
              />
              {/* 그룹 2 — 일정/회원/게스트 (aqua) */}
              <MenuCard
                label="GUEST JOIN"
                description="TEYEON 게스트 참여 신청"
                icon={<UserPlus size={21} strokeWidth={1.7} />}
                path="/guest"
                badge="OPEN"
                accent="aqua"
              />
              {/* TENNIS LOG — 회원 전용 개인 테니스 기록 (teal).
                  정회원/운영진은 진입, 게스트/준회원(=GUEST)은 잠금 + 회원 전용 안내. */}
              <MenuCard
                label="TENNIS LOG"
                description="나만의 테니스 기록 · 외부 대회와 레슨을 기록하세요"
                icon={<NotebookPen size={21} strokeWidth={1.7} />}
                path="/tennis-log"
                accent="teal"
                locked={tennisLogStatus !== 'allowed'}
                lockedBadge="회원 전용"
                deniedTitle={TENNIS_LOG_LOCKED_TITLE}
                deniedBody={TENNIS_LOG_LOCKED_BODY}
              />
              {/* 그룹 3 — 관리/재무 (gold) */}
              <MenuCard
                label="관리자 설정"
                description="멤버, 권한, 운영 기준을 관리합니다."
                icon={<Settings size={21} strokeWidth={1.7} />}
                path="/admin"
                badge="ADMIN"
                accent="gold"
                locked={!isLoading && !canAdmin}
                deniedTitle="접근 권한이 없습니다"
                deniedBody="관리자 권한이 필요한 메뉴입니다."
              />
            </div>
          </>
        )}
        {/* 하단 스크롤 spacer — 실제 흐름 요소(flexShrink:0 고정 높이)라 부모의 min-height/border-box에
            흡수되지 않고 항상 scrollHeight 를 늘린다. 모바일 동적 뷰포트(dvh)에서 마지막 메뉴 카드가
            BottomNav 뒤로 깔리지 않도록 카드 아래 실제 빈 공간(64px)을 보장한다. */}
        <div data-home-content-end aria-hidden style={{ height: 64, flexShrink: 0 }} />
      </div>

      {/* Toast */}
      {(toast || systemMessage) && (
        <div
          style={{
            position: 'fixed',
            bottom: 'calc(var(--bottom-nav-area) + 12px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2000,
            width: '92%',
            maxWidth: 420,
            backgroundColor: '#0F766E',
            borderRadius: 11,
            padding: '12px 20px',
            textAlign: 'center',
            fontFamily: 'var(--font-rajdhani), sans-serif',
            fontSize: 13,
            fontWeight: 900,
            letterSpacing: '0.06em',
            color: '#FFFFFF',
            boxShadow: '0 6px 24px rgba(13,148,136,0.28)',
          }}
        >
          {toast || systemMessage}
        </div>
      )}

      {/* 권한 안내 — 작은 Alert Modal(닫기 가능). 제한 메뉴 클릭 시 무반응 방지 + 명확한 안내.
          프론트 UX 전용 — 실제 접근 제어는 각 페이지/RLS 가 유지. */}
      {permAlert && (
        <div
          onClick={() => setPermAlert(null)}
          role="dialog"
          aria-modal="true"
          aria-label={permAlert.title}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(15,23,42,0.45)',
            backdropFilter: 'blur(4px)',
            padding: 20,
            paddingTop: 'calc(20px + env(safe-area-inset-top))',
            paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
            boxSizing: 'border-box',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 320,
              backgroundColor: '#FFFFFF',
              borderRadius: 16,
              border: '1px solid rgba(0,0,0,0.06)',
              boxShadow: '0 20px 50px rgba(15,23,42,0.24)',
              padding: 20,
              textAlign: 'center',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                margin: '0 auto',
                borderRadius: '50%',
                backgroundColor: 'rgba(100,116,139,0.10)',
                color: '#475569',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Lock size={20} strokeWidth={2.2} />
            </div>
            <h2 style={{ margin: '12px 0 0', fontSize: 16, fontWeight: 900, color: '#0F172A', wordBreak: 'keep-all' }}>
              {permAlert.title}
            </h2>
            {permAlert.body && (
              <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 600, color: '#64748B', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                {permAlert.body}
              </p>
            )}
            <button
              type="button"
              onClick={() => setPermAlert(null)}
              style={{
                marginTop: 16,
                width: '100%',
                height: 44,
                borderRadius: 11,
                border: 'none',
                backgroundColor: '#0F766E',
                color: '#FFFFFF',
                fontSize: 13.5,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              확인
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

// ─── Hero 통계 1셀 ─────────────────────────────────────────────────────────
function StatCell({
  icon,
  value,
  unit,
  label,
  divider,
  valueIsText,
  href,
  ariaLabel,
  hint,
}: {
  icon: React.ReactNode;
  value: string;
  unit?: string;
  label: string;
  divider?: 'right';
  valueIsText?: boolean;
  /** 있을 경우 셀 전체가 해당 라우트로 이동. 다음 일정 / 멤버 요약 셀에서 사용. */
  href?: string;
  /** href 링크의 접근성 라벨(스크린리더용). */
  ariaLabel?: string;
  /** 클릭 가능 보조 표시 — label 뒤 작은 chevron + hover 시 미세 상승. */
  hint?: boolean;
}) {
  const cellInner = (
    <>
      <span style={{ color: '#94A3B8', marginBottom: 4, display: 'inline-flex' }}>
        {icon}
      </span>
      <p
        style={{
          margin: 0,
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 1,
          maxWidth: '100%',
        }}
      >
        <span
          style={{
            fontSize: valueIsText ? 'clamp(11px, 3.4vw, 13px)' : 'clamp(15px, 4.6vw, 17px)',
            fontWeight: 800,
            color: '#0F172A',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            style={{
              fontSize: 'clamp(9px, 2.6vw, 10px)',
              fontWeight: 700,
              color: '#64748B',
              marginLeft: 2,
            }}
          >
            {unit}
          </span>
        )}
      </p>
      <span
        style={{
          marginTop: 3,
          fontSize: 'clamp(9px, 2.6vw, 10px)',
          fontWeight: 600,
          color: '#94A3B8',
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
        }}
      >
        {label}
        {hint && (
          <ChevronRight size={10} strokeWidth={2.4} style={{ color: '#CBD5E1', flexShrink: 0 }} />
        )}
      </span>
    </>
  );

  const baseStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 14,
    paddingBottom: 14,
    paddingLeft: 6,
    paddingRight: 6,
    borderRight: divider === 'right' ? '1px solid rgba(15,23,42,0.06)' : undefined,
    minWidth: 0,
    overflow: 'hidden',
    textDecoration: 'none',
    color: 'inherit',
  };

  if (href) {
    return (
      <Link
        href={href}
        aria-label={ariaLabel}
        style={baseStyle}
        className={`transition-transform active:scale-[0.98]${hint ? ' hover:-translate-y-px' : ''}`}
      >
        {cellInner}
      </Link>
    );
  }

  return <div style={baseStyle}>{cellInner}</div>;
}
