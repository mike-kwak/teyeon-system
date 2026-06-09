'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Layout,
  Settings,
  Swords,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const { user, signInWithKakao, isLoading, systemMessage } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [activeMemberCount, setActiveMemberCount] = useState<number>(24);
  const [totalKdkCount, setTotalKdkCount] = useState<number>(0);

  const CURRENT_VERSION = 'v5.0 Guest Fix';

  useEffect(() => {
    // 활동 회원 = 정회원 + 준회원 (role 기준); role = '게스트' 제외
    const CLUB_ID = process.env.NEXT_PUBLIC_CLUB_ID || '512d047d-a076-4080-97e5-6bb5a2c07819';
    supabase
      .from('members')
      .select('*', { count: 'exact', head: true })
      .eq('club_id', CLUB_ID)
      .neq('role', '게스트')
      .then(({ count, error }) => {
        if (!error && count !== null) setActiveMemberCount(count);
      });

    // 공식 KDK 세션 수: teyeon_archive_v1에서 is_official=true, is_test=false 기준 (1 row = 1 세션)
    supabase
      .from('teyeon_archive_v1')
      .select('*', { count: 'exact', head: true })
      .eq('is_official', true)
      .eq('is_test', false)
      .then(({ count, error }) => {
        if (error) {
          console.warn('[Home] KDK count 조회 실패 — fallback 0 유지:', error.message);
          return;
        }
        if (count !== null) setTotalKdkCount(count);
      });
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

  const MenuCard = ({
    label,
    description,
    icon,
    path,
    comingSoon,
    badge,
    accent = 'teal',
  }: {
    label: string;
    description?: string;
    icon: React.ReactNode;
    path: string;
    comingSoon?: boolean;
    badge?: string;
    accent?: 'teal' | 'gold';
  }) => (
    <Link
      href={path}
      style={{
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
        opacity: comingSoon ? 0.68 : 1,
      }}
      className="active:scale-[0.982]"
    >
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
          backgroundColor:
            accent === 'gold'
              ? 'rgba(201,168,76,0.10)'
              : 'rgba(13,148,136,0.09)',
          color: accent === 'gold' ? '#C9A84C' : '#0D9488',
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
          {badge && !comingSoon && (
            <span
              style={{
                flexShrink: 0,
                fontSize: 8,
                fontWeight: 800,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: 5,
                backgroundColor:
                  accent === 'gold'
                    ? 'rgba(201,168,76,0.10)'
                    : 'rgba(13,148,136,0.09)',
                color: accent === 'gold' ? '#B8891C' : '#0D9488',
                border:
                  accent === 'gold'
                    ? '1px solid rgba(201,168,76,0.24)'
                    : '1px solid rgba(13,148,136,0.20)',
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
    </Link>
  );

  if (!isMounted) return null;

  const tickerText = '한산모시배 · KDK 결과는 ARCHIVE에서 확인';

  return (
    <main
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '100dvh',
        backgroundColor: '#F2F4F7',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflowX: 'hidden',
        paddingBottom: 8,
      }}
    >
      {/* Slim ticker — light teal tint strip */}
      <style>{`
        @keyframes home-ticker {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
      <div
        style={{
          width: '100%',
          height: 30,
          backgroundColor: 'rgba(13,148,136,0.07)',
          borderBottom: '1px solid rgba(13,148,136,0.11)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            whiteSpace: 'nowrap',
            animation: 'home-ticker 24s linear infinite',
          }}
        >
          {[tickerText, tickerText].map((text, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                paddingRight: 72,
                fontFamily: 'var(--font-rajdhani), sans-serif',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: '#475569',
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  backgroundColor: '#0D9488',
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              {text}
            </span>
          ))}
        </div>
      </div>

      {/* Page content */}
      <div
        style={{
          width: '100%',
          maxWidth: 430,
          padding: '0 16px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Intro card */}
        <div
          style={{
            marginTop: 18,
            marginBottom: 20,
            borderRadius: 14,
            backgroundColor: '#FFFFFF',
            border: '1px solid rgba(0,0,0,0.06)',
            borderTop: '2px solid #0D9488',
            boxShadow: '0 2px 10px rgba(0,0,0,0.055)',
            padding: '18px 20px 16px 20px',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-rajdhani), sans-serif',
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: '0.30em',
              textTransform: 'uppercase',
              color: '#0D9488',
              marginBottom: 7,
            }}
          >
            TEYEON TENNIS CLUB
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-geist), var(--font-rajdhani), sans-serif',
              fontSize: 21,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: '#0F172A',
              lineHeight: 1.22,
              margin: 0,
            }}
          >
            테니스로 이어진 인연.
          </h1>
          <div
            style={{
              marginTop: 12,
              paddingTop: 10,
              borderTop: '1px solid rgba(0,0,0,0.055)',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 11,
                fontWeight: 600,
                color: '#64748B',
                lineHeight: 1.7,
              }}
            >
              {'활동 회원 '}
              <strong style={{ color: '#0F172A', fontWeight: 800 }}>{activeMemberCount}명</strong>
              {' · 누적 KDK '}
              <strong style={{ color: '#0F172A', fontWeight: 800 }}>{totalKdkCount}회</strong>
              {' · 다음 '}
              <strong style={{ color: '#0D9488', fontWeight: 700 }}>
                한산모시배
              </strong>
            </p>
          </div>
        </div>

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
              <MenuCard
                label="대진 생성"
                description="KDK 대진표 생성 및 실시간 운영."
                icon={<Swords size={21} strokeWidth={1.7} />}
                path="/kdk"
                badge="KDK"
                accent="teal"
              />
              <MenuCard
                label="대회 캘린더"
                description="월별 대회 일정과 참가/파트너 현황을 확인합니다."
                icon={<CalendarDays size={21} strokeWidth={1.7} />}
                path="/tournament-calendar"
                badge="CALENDAR"
                accent="teal"
              />
              <MenuCard
                label="스페셜 매치"
                description="수동 매치 운영 및 결과 기록."
                icon={<Layout size={21} strokeWidth={1.7} />}
                path="/special-match"
                badge="MANUAL"
                accent="teal"
              />
              <MenuCard
                label="멤버 프로필"
                description="클럽 멤버 프로필 및 랭킹을 조회합니다."
                icon={<Users size={21} strokeWidth={1.7} />}
                path="/members"
                accent="teal"
              />
              <MenuCard
                label="클럽 재무"
                description="회비, 미납, 월간 재무 리포트를 관리합니다."
                icon={<CircleDollarSign size={21} strokeWidth={1.7} />}
                path="/finance"
                accent="gold"
              />
              <MenuCard
                label="GUEST JOIN"
                description="TEYEON 게스트 참여 신청"
                icon={<UserPlus size={21} strokeWidth={1.7} />}
                path="/guest"
                badge="OPEN"
                accent="teal"
              />
              <MenuCard
                label="관리자 설정"
                description="멤버, 권한, 운영 기준을 관리합니다."
                icon={<Settings size={21} strokeWidth={1.7} />}
                path="/admin"
                badge="ADMIN"
                accent="gold"
              />
            </div>

          </>
        )}
      </div>

      {/* Toast */}
      {(toast || systemMessage) && (
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
    </main>
  );
}
