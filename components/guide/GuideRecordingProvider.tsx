'use client';

// Guide & Recording — 전역 미리보기/녹화 상태 Provider.
//   ⚠ UI 표현 전용. 실제 Auth Role/RLS 는 절대 바꾸지 않는다(user.role 미변경).
//   - previewRole 로 화면 표시 판단(effectiveUiRole)만 바꾼다.
//   - 촬영 중 실수 방지용 write guard + 개인정보 마스킹 + 관리자 컨트롤 숨김 플래그 제공.
//   - 상태는 sessionStorage 에만 저장(브라우저 종료 시 초기화). hydration mismatch 방지 위해 mount 후 복원.

import React from 'react';
import { useRouter } from 'next/navigation';
import { WRITE_BLOCK_MESSAGE } from '@/lib/guide/writeGuard';
import {
    GuideRecordingContext,
    type GuideRecordingValue, type PreviewRole, type CursorSize, type CursorColor,
} from './guideRecordingContext';
import RecordingStatusBar from './RecordingStatusBar';
import RecordingCursorOverlay from './RecordingCursorOverlay';

const K_ROLE = 'teyeon-preview-role';
const K_REC = 'teyeon-recording-mode';
const K_CURSOR = 'teyeon-recording-cursor';

const DEFAULT_CURSOR = { enabled: false, size: 'md' as CursorSize, color: 'accent' as CursorColor, ripple: true };

export default function GuideRecordingProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const [mounted, setMounted] = React.useState(false);
    const [previewRole, setPreviewRoleState] = React.useState<PreviewRole>('ADMIN_ORIGINAL');
    const [isRecordingMode, setIsRecordingMode] = React.useState(false);
    const [optMask, setOptMask] = React.useState(false);
    const [optHideAdmin, setOptHideAdmin] = React.useState(false);
    const [optWriteBlock, setOptWriteBlock] = React.useState(false);
    const [cursor, setCursor] = React.useState(DEFAULT_CURSOR);
    const [statusBarHidden, setStatusBarHiddenState] = React.useState(false);
    const [notice, setNotice] = React.useState<{ id: number; text: string } | null>(null);
    const lastNoticeAt = React.useRef(0);

    // mount 후 sessionStorage 복원(hydration mismatch 방지).
    React.useEffect(() => {
        setMounted(true);
        try {
            const role = sessionStorage.getItem(K_ROLE) as PreviewRole | null;
            if (role && ['ADMIN_ORIGINAL', 'MEMBER', 'GUEST', 'PUBLIC'].includes(role)) setPreviewRoleState(role);
            const rec = sessionStorage.getItem(K_REC);
            if (rec) {
                const r = JSON.parse(rec);
                setIsRecordingMode(!!r.recording);
                setOptMask(!!r.mask);
                setOptHideAdmin(!!r.hideAdmin);
                setOptWriteBlock(!!r.write);
            }
            const cur = sessionStorage.getItem(K_CURSOR);
            if (cur) setCursor({ ...DEFAULT_CURSOR, ...JSON.parse(cur) });
        } catch { /* ignore */ }
    }, []);

    // 변경 시 persist(mount 이후에만).
    React.useEffect(() => { if (mounted) try { sessionStorage.setItem(K_ROLE, previewRole); } catch { /* */ } }, [previewRole, mounted]);
    React.useEffect(() => {
        if (!mounted) return;
        try { sessionStorage.setItem(K_REC, JSON.stringify({ recording: isRecordingMode, mask: optMask, hideAdmin: optHideAdmin, write: optWriteBlock })); } catch { /* */ }
    }, [isRecordingMode, optMask, optHideAdmin, optWriteBlock, mounted]);
    React.useEffect(() => { if (mounted) try { sessionStorage.setItem(K_CURSOR, JSON.stringify(cursor)); } catch { /* */ } }, [cursor, mounted]);

    const isPreviewMode = previewRole !== 'ADMIN_ORIGINAL';
    const shouldHideAdminControls = optHideAdmin || isPreviewMode;
    const isWriteBlocked = optWriteBlock || isPreviewMode;

    const guardWriteAction = React.useCallback((actionLabel?: string): boolean => {
        if (!(optWriteBlock || previewRole !== 'ADMIN_ORIGINAL')) return true;
        // 단일 toast + 1.8s 디바운스(반복 클릭 spam 방지).
        const now = Date.now();
        if (now - lastNoticeAt.current > 1800) {
            lastNoticeAt.current = now;
            setNotice({ id: now, text: actionLabel ? `${WRITE_BLOCK_MESSAGE} (${actionLabel})` : WRITE_BLOCK_MESSAGE });
            window.setTimeout(() => setNotice((n) => (n && n.id === now ? null : n)), 2400);
        }
        return false;
    }, [optWriteBlock, previewRole]);

    const applyRecordingBundle = React.useCallback((role: PreviewRole) => {
        setPreviewRoleState(role);
        setIsRecordingMode(true);
        setOptMask(true);
        setOptHideAdmin(true);
        setOptWriteBlock(true);
        setCursor((c) => ({ ...c, enabled: true }));
    }, []);

    const value: GuideRecordingValue = {
        previewRole, isRecordingMode, cursor, statusBarHidden,
        optMask, optHideAdmin, optWriteBlock,
        isPreviewMode,
        isAdminOriginal: previewRole === 'ADMIN_ORIGINAL',
        isMemberPreview: previewRole === 'MEMBER',
        isGuestPreview: previewRole === 'GUEST',
        isPublicPreview: previewRole === 'PUBLIC',
        shouldMaskPrivateData: optMask,
        shouldHideAdminControls,
        isWriteBlocked,
        isCursorHighlightEnabled: cursor.enabled,
        setPreviewRole: setPreviewRoleState,
        setRecordingMode: setIsRecordingMode,
        setMask: setOptMask,
        setHideAdmin: setOptHideAdmin,
        setWriteBlock: setOptWriteBlock,
        setCursorHighlight: (on) => setCursor((c) => ({ ...c, enabled: on })),
        setCursorSize: (size) => setCursor((c) => ({ ...c, size })),
        setCursorColor: (color) => setCursor((c) => ({ ...c, color })),
        setCursorRipple: (ripple) => setCursor((c) => ({ ...c, ripple })),
        setStatusBarHidden: setStatusBarHiddenState,
        startMemberRecording: () => { applyRecordingBundle('MEMBER'); router.push('/'); },
        startGuestRecording: () => { applyRecordingBundle('GUEST'); router.push('/club'); },
        startPublicRecording: () => { applyRecordingBundle('PUBLIC'); router.push('/club'); },
        showAdminOriginal: () => setPreviewRoleState('ADMIN_ORIGINAL'),
        endPreview: () => setPreviewRoleState('ADMIN_ORIGINAL'),
        endAllRecordingModes: () => {
            setPreviewRoleState('ADMIN_ORIGINAL');
            setIsRecordingMode(false);
            setOptMask(false);
            setOptHideAdmin(false);
            setOptWriteBlock(false);
            setCursor(DEFAULT_CURSOR);
            setStatusBarHiddenState(false);
            try { sessionStorage.removeItem(K_ROLE); sessionStorage.removeItem(K_REC); sessionStorage.removeItem(K_CURSOR); } catch { /* */ }
        },
        guardWriteAction,
        assertWriteAllowed: () => guardWriteAction(),
    };

    const active = mounted && (isPreviewMode || isRecordingMode);

    return (
        <GuideRecordingContext.Provider value={value}>
            {children}
            {mounted && cursor.enabled && (isPreviewMode || isRecordingMode) && (
                <RecordingCursorOverlay size={cursor.size} color={cursor.color} ripple={cursor.ripple} />
            )}
            {active && <RecordingStatusBar />}
            {/* write block 단일 toast */}
            {mounted && notice && (
                <div
                    role="status"
                    aria-live="polite"
                    className="hidden lg:flex"
                    style={{
                        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 2147483600,
                        alignItems: 'center', gap: 8, maxWidth: '92vw',
                        padding: '11px 16px', borderRadius: 12,
                        backgroundColor: '#7F1D1D', color: '#FFE4E6',
                        border: '1px solid rgba(255,255,255,0.18)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                        fontSize: 13, fontWeight: 800, pointerEvents: 'none',
                    }}
                >
                    <span aria-hidden style={{ fontSize: 14 }}>⛔</span>{notice.text}
                </div>
            )}
        </GuideRecordingContext.Provider>
    );
}
