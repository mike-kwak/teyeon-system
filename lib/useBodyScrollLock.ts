'use client';

import { useEffect } from 'react';

/**
 * 모달 오픈 중 배경 스크롤 잠금.
 *
 * ⚠️ 중요: 이 앱은 "단일 스크롤러" 아키텍처다. html/body 는 스크롤하지 않고
 *   (globals.css 의 `body { overflow: hidden }`), 실제 세로 스크롤러는
 *   RootShell 안의 GlobalMain(`<main id="main-container">`, overflow-y:auto)이다.
 *   따라서 body 만 position:fixed 로 잠그면 window.scrollY 는 항상 0 이라 아무 효과가 없고,
 *   진짜 스크롤러인 GlobalMain 은 그대로 스크롤된다 → 실기기(iOS Safari)에서 모달 위 스와이프가
 *   배경 페이지를 움직이는 버그가 난다.
 *
 * 그래서 여기서는:
 *   1) 실제 스크롤 소유자(#main-container)를 overflow:hidden 으로 만들어 스크롤 컨테이너 자체를 해제한다.
 *      overflow:hidden 은 현재 scrollTop 을 그대로 보존하고(프로그램적으로만 스크롤 가능, 사용자 터치로는 불가)
 *      iOS 를 포함한 모든 브라우저에서 배경이 터치로 움직이지 않게 만든다. touch-action/overscroll-behavior
 *      의 iOS 미준수와 무관하게 확실하다.
 *   2) 보조로 body 도 기존처럼 고정(하위 호환, 혹시 있을 window 스크롤 대비).
 *   해제/unmount 시 변경 전 inline 값을 "정확히" 복원하고 원래 스크롤 위치로 되돌린다.
 *
 * 다중 모달 동시 잠금은 현재 앱에 없어 단순 저장/복원으로 충분하다.
 * 디자인/기능에는 영향을 주지 않는다 — 스크롤 잠금만 담당.
 */
export function useBodyScrollLock(locked: boolean): void {
    useEffect(() => {
        if (!locked) return;
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        const body = document.body;
        const scrollY = window.scrollY;

        // 실제 스크롤러(GlobalMain). 비-admin shell 에서는 항상 존재한다.
        const scroller = document.getElementById('main-container');
        const scrollerTop = scroller ? scroller.scrollTop : 0;

        // 변경 전 inline 값 보존(정확 복원용).
        const prevBody = {
            position: body.style.position,
            top: body.style.top,
            left: body.style.left,
            right: body.style.right,
            width: body.style.width,
            overflow: body.style.overflow,
            overscrollBehavior: body.style.overscrollBehavior,
        };
        const prevScroller = scroller
            ? { overflow: scroller.style.overflow, overscrollBehavior: scroller.style.overscrollBehavior }
            : null;

        // 1) 진짜 스크롤러 잠금 — 이게 핵심.
        if (scroller) {
            scroller.style.overflow = 'hidden';
            scroller.style.overscrollBehavior = 'none';
            scroller.scrollTop = scrollerTop; // 현재 위치 고정(클램프 방지)
        }

        // 2) 보조: body 고정(기존 동작 유지).
        body.style.position = 'fixed';
        body.style.top = `-${scrollY}px`;
        body.style.left = '0';
        body.style.right = '0';
        body.style.width = '100%';
        body.style.overflow = 'hidden';
        body.style.overscrollBehavior = 'none';

        return () => {
            body.style.position = prevBody.position;
            body.style.top = prevBody.top;
            body.style.left = prevBody.left;
            body.style.right = prevBody.right;
            body.style.width = prevBody.width;
            body.style.overflow = prevBody.overflow;
            body.style.overscrollBehavior = prevBody.overscrollBehavior;

            if (scroller && prevScroller) {
                scroller.style.overflow = prevScroller.overflow;
                scroller.style.overscrollBehavior = prevScroller.overscrollBehavior;
                scroller.scrollTop = scrollerTop; // 기존 배경 스크롤 위치 복원
            }

            // 잠금 동안 저장해 둔 window 위치로 즉시 복귀.
            window.scrollTo(0, scrollY);
        };
    }, [locked]);
}
