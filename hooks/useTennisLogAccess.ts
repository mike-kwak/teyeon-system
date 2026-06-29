'use client';

// TENNIS LOG 접근 권한 공통 훅 — 메인 카드와 /tennis-log 라우트가 동일하게 사용한다.
//   · 로그인 사용자 ↔ members 연결은 프로젝트 공통 resolver(resolveMemberDisplays) 재사용.
//     (우선순위: members.id → members.auth_user_id → members.email)
//   · 조회 중에는 'loading' 을 반환 → 호출측은 정상 접근으로 보이지 않게 처리(안전한 잠금 기본값).
//   · 조회 실패 시에도 'locked' 로 폴백.

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { resolveMemberDisplays } from '@/lib/memberDisplayResolver';
import { resolveTennisLogAccess, type TennisLogAccess } from '@/lib/tennisLogAccess';

export function useTennisLogAccess(): TennisLogAccess {
  const { user, isLoading } = useAuth();
  const [status, setStatus] = useState<TennisLogAccess>('loading');
  const userId = user?.id ?? null;

  useEffect(() => {
    let cancelled = false;

    if (isLoading) {
      setStatus('loading');
      return;
    }
    if (!userId) {
      setStatus('unauthenticated');
      return;
    }

    setStatus('loading');
    (async () => {
      try {
        const resolved = await resolveMemberDisplays([{ userId }]);
        const memberRole = resolved.byUserId.get(userId)?.role ?? null;
        if (!cancelled) setStatus(resolveTennisLogAccess(true, memberRole));
      } catch {
        if (!cancelled) setStatus('locked'); // 실패 시 안전한 잠금 기본값
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, isLoading]);

  return status;
}
