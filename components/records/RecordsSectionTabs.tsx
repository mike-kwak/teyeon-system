'use client';

// 기록 영역 공통 진입 탭 — /archive(공식 기록) ↔ /ranking(TEYEON Ranking) 이동.
//   · 라우트는 합치지 않는다: 실제 <Link> 내비게이션(anchor semantics, 뒤로가기/포커스 정상).
//   · active 판정은 client state 가 아니라 pathname 기준.
//   · 디자인: Cool Premium Light 공통 — 흰 카드 + 하단 언더라인 강조(과한 pill/segmented 금지).
//     Ranking 내부의 시즌/누적 "채움형" 탭과 시각 계층이 겹치지 않도록 언더라인 방식을 사용한다.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/archive', label: '공식 기록' },
  { href: '/ranking', label: '랭킹' },
] as const;

export default function RecordsSectionTabs() {
  const pathname = usePathname() || '';

  return (
    <nav
      aria-label="기록 영역"
      style={{
        display: 'flex',
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        border: '1px solid rgba(15,23,42,0.07)',
        boxShadow: '0 2px 10px rgba(15,23,42,0.05)',
        overflow: 'hidden',
      }}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 46, // 모바일 터치 영역 확보(44px+)
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: active ? 900 : 600,
              color: active ? '#0F172A' : '#64748B',
              backgroundColor: active ? '#FFFFFF' : '#F8FAFC',
              transition: 'color 0.15s, background-color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
            {/* active 구분은 색상 외에 언더라인 + font-weight 로도 제공(접근성) */}
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 14,
                right: 14,
                bottom: 0,
                height: 2.5,
                borderRadius: 99,
                backgroundColor: active ? '#0D9488' : 'transparent',
              }}
            />
          </Link>
        );
      })}
    </nav>
  );
}
