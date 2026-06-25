'use client';

import { useEffect } from 'react';

/**
 * 모달 오픈 중 배경(body) 스크롤 잠금.
 *   - locked=true 가 되면 현재 window.scrollY 를 저장하고 body 를 position:fixed 로 고정해
 *     배경 페이지가 휠/터치로 움직이지 않게 한다.
 *   - 해제(또는 unmount) 시 기존 inline 스타일을 "정확히" 복원하고 원래 스크롤 위치로 되돌린다.
 *   - 기존 body inline style 이 있을 수 있어, 변경 전 값을 저장했다가 그대로 복원한다.
 *   - 여러 모달이 동시에 잠그는 케이스는 현재 앱에 없어 단순 저장/복원으로 충분.
 *
 * 디자인/기능에는 영향을 주지 않는다 — 스크롤 잠금만 담당.
 */
export function useBodyScrollLock(locked: boolean): void {
    useEffect(() => {
        if (!locked) return;
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        const body = document.body;
        const scrollY = window.scrollY;

        // 변경 전 inline 값 보존(정확 복원용).
        const prev = {
            position: body.style.position,
            top: body.style.top,
            left: body.style.left,
            right: body.style.right,
            width: body.style.width,
            overflow: body.style.overflow,
            overscrollBehavior: body.style.overscrollBehavior,
        };

        body.style.position = 'fixed';
        body.style.top = `-${scrollY}px`;
        body.style.left = '0';
        body.style.right = '0';
        body.style.width = '100%';
        body.style.overflow = 'hidden';
        body.style.overscrollBehavior = 'none';

        return () => {
            body.style.position = prev.position;
            body.style.top = prev.top;
            body.style.left = prev.left;
            body.style.right = prev.right;
            body.style.width = prev.width;
            body.style.overflow = prev.overflow;
            body.style.overscrollBehavior = prev.overscrollBehavior;
            // 잠금 동안 저장해 둔 위치로 즉시 복귀.
            window.scrollTo(0, scrollY);
        };
    }, [locked]);
}
