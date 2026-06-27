// Admin Console 메뉴 구성 — 단일 config. 메뉴 추가·삭제·재배치는 이 배열만 수정.
//   원칙(1차): 실제로 존재하는 라우트만 등록(죽은 링크/대량 Coming Soon 금지).
//   external=true 인 항목은 /admin shell 을 벗어나 기존 일반 앱 화면으로 이동(런치패드 역할).

import type { LucideIcon } from 'lucide-react';
import {
    LayoutDashboard,
    CalendarDays,
    Swords,
    Ticket,
    Archive,
    Trophy,
    Wallet,
    Settings,
    LineChart,
    ScrollText,
    Clapperboard,
    Home,
    ListChecks,
    Menu,
} from 'lucide-react';

export interface AdminNavItem {
    id: string;
    label: string;
    href: string;
    icon: LucideIcon;
    /** /admin shell 밖(기존 일반 앱 화면)으로 이동하는 항목. */
    external?: boolean;
}

export interface AdminNavSection {
    title: string;
    items: AdminNavItem[];
}

export const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
    {
        title: '운영',
        items: [
            { id: 'dashboard', label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
            { id: 'schedule', label: '정모 일정', href: '/club/schedule', icon: CalendarDays, external: true },
            { id: 'kdk', label: 'KDK 운영', href: '/kdk', icon: Swords, external: true },
            { id: 'guests', label: '게스트 패스', href: '/admin/guest-pass-defaults', icon: Ticket },
        ],
    },
    {
        title: '분석',
        items: [
            { id: 'analytics', label: '사용 분석', href: '/admin/analytics', icon: LineChart },
            { id: 'stats', label: '방문 로그', href: '/admin/stats', icon: ScrollText },
        ],
    },
    {
        title: '기록 · 정산',
        items: [
            { id: 'archive', label: '아카이브', href: '/archive', icon: Archive, external: true },
            { id: 'tournament', label: '대회 캘린더', href: '/tournament-calendar', icon: Trophy, external: true },
            { id: 'finance', label: '재무', href: '/finance', icon: Wallet, external: true },
        ],
    },
    {
        title: '회원 · 시스템',
        items: [
            { id: 'settings', label: '관리자 설정', href: '/admin/settings', icon: Settings },
            { id: 'guide-recording', label: '가이드 및 촬영', href: '/admin/guide-recording', icon: Clapperboard },
        ],
    },
];

/** 모바일 BottomNav — 4개 고정. '관리'는 전체 메뉴 시트를 연다(별도 빈 페이지 만들지 않음). */
export interface AdminBottomNavItem {
    id: string;
    label: string;
    icon: LucideIcon;
    href?: string;          // href 가 있으면 이동, 없으면 action.
    action?: 'open-menu';   // 전체 메뉴 시트.
}

export const ADMIN_BOTTOM_NAV: AdminBottomNavItem[] = [
    { id: 'home', label: 'HOME', icon: Home, href: '/admin' },
    { id: 'schedule', label: '일정', icon: CalendarDays, href: '/club/schedule' },
    { id: 'tasks', label: '처리 필요', icon: ListChecks, href: '/admin#tasks' },
    { id: 'menu', label: '관리', icon: Menu, action: 'open-menu' },
];

/** 모든 sidebar 항목 평탄화(시트/검색용). */
export function allAdminNavItems(): AdminNavItem[] {
    return ADMIN_NAV_SECTIONS.flatMap((s) => s.items);
}
