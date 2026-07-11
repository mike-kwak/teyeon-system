'use client';

// PUBLIC_GUEST 검토 대기(pending) 신청 건수 — Admin shell 공용 배지 상태.
//   · 사이드바 / 모바일 메뉴 시트 / 대시보드 / 게스트 신청 페이지가 같은 count 를 공유.
//   · 상태 변경(승인/보류/거절) 후 refresh() 한 번으로 모든 배지가 함께 갱신된다.
//   · count 전용 RPC(get_pending_guest_application_count) — 개인정보 미반환, 숫자만.
//   · 권한 없음/미적용/오류 → count=null(배지 숨김). 관리자 화면은 절대 깨지지 않는다.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { canManageGuestApplications } from '@/lib/admin/adminAccess';
import { fetchPendingGuestApplicationCount } from '@/lib/guestApplicationService';

interface GuestPendingValue {
  /** 검토 대기 건수. null = 표시하지 않음(권한 없음/미적용/오류). */
  count: number | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const GuestPendingContext = createContext<GuestPendingValue>({ count: null, loading: false, refresh: async () => {} });

export function GuestPendingProvider({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  const canManage = canManageGuestApplications(role);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!canManage) { setCount(null); return; }
    setLoading(true);
    try {
      const n = await fetchPendingGuestApplicationCount();
      setCount(n);
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <GuestPendingContext.Provider value={{ count, loading, refresh }}>
      {children}
    </GuestPendingContext.Provider>
  );
}

export function useGuestPending(): GuestPendingValue {
  return useContext(GuestPendingContext);
}

/**
 * Admin nav 항목용 검토대기 배지 — 'guest-applications' 항목에만, count>0 일 때만 표시.
 *   긴 숫자 overflow 방지(99+ 클램프). count=null/0 이면 렌더 안 함(빈 배지 금지).
 */
export function GuestNavBadge({ itemId, style }: { itemId: string; style?: React.CSSProperties }) {
  const { count } = useGuestPending();
  if (itemId !== 'guest-applications' || !count || count <= 0) return null;
  return (
    <span
      aria-label={`검토 대기 ${count}건`}
      style={{
        minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
        backgroundColor: '#EF4444', color: '#FFFFFF', fontSize: 10.5, fontWeight: 900,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, lineHeight: 1, ...style,
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
