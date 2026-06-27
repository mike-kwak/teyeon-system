'use client';

// Guide & Recording context + 타입 — provider/hook/하위 컴포넌트가 공유(순환 import 방지용 분리 모듈).

import React from 'react';

export type PreviewRole = 'ADMIN_ORIGINAL' | 'MEMBER' | 'GUEST' | 'PUBLIC';
export type CursorSize = 'sm' | 'md' | 'lg';
export type CursorColor = 'accent' | 'red';

export interface GuideRecordingValue {
    previewRole: PreviewRole;
    isRecordingMode: boolean;
    cursor: { enabled: boolean; size: CursorSize; color: CursorColor; ripple: boolean };
    statusBarHidden: boolean;
    optMask: boolean;
    optHideAdmin: boolean;
    optWriteBlock: boolean;
    isPreviewMode: boolean;
    isAdminOriginal: boolean;
    isMemberPreview: boolean;
    isGuestPreview: boolean;
    isPublicPreview: boolean;
    shouldMaskPrivateData: boolean;
    shouldHideAdminControls: boolean;
    isWriteBlocked: boolean;
    isCursorHighlightEnabled: boolean;
    setPreviewRole: (r: PreviewRole) => void;
    setRecordingMode: (on: boolean) => void;
    setMask: (on: boolean) => void;
    setHideAdmin: (on: boolean) => void;
    setWriteBlock: (on: boolean) => void;
    setCursorHighlight: (on: boolean) => void;
    setCursorSize: (s: CursorSize) => void;
    setCursorColor: (c: CursorColor) => void;
    setCursorRipple: (on: boolean) => void;
    setStatusBarHidden: (on: boolean) => void;
    startMemberRecording: () => void;
    startGuestRecording: () => void;
    startPublicRecording: () => void;
    showAdminOriginal: () => void;
    endPreview: () => void;
    endAllRecordingModes: () => void;
    guardWriteAction: (actionLabel?: string) => boolean;
    assertWriteAllowed: () => boolean;
}

export const GuideRecordingContext = React.createContext<GuideRecordingValue | null>(null);
