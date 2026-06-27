'use client';

// Guide & Recording 공통 hook. Provider 밖에서 호출돼도 앱이 깨지지 않도록 안전한 no-op 기본값을 제공한다.
//   (촬영 기능을 적용하지 않은 화면/컴포넌트에서 useGuideRecording() 를 써도 항상 안전.)

import React from 'react';
import { GuideRecordingContext, type GuideRecordingValue } from '@/components/guide/guideRecordingContext';

const SAFE_DEFAULT: GuideRecordingValue = {
    previewRole: 'ADMIN_ORIGINAL',
    isRecordingMode: false,
    cursor: { enabled: false, size: 'md', color: 'accent', ripple: true },
    statusBarHidden: false,
    optMask: false, optHideAdmin: false, optWriteBlock: false,
    isPreviewMode: false, isAdminOriginal: true, isMemberPreview: false, isGuestPreview: false, isPublicPreview: false,
    shouldMaskPrivateData: false, shouldHideAdminControls: false, isWriteBlocked: false, isCursorHighlightEnabled: false,
    setPreviewRole: () => {}, setRecordingMode: () => {}, setMask: () => {}, setHideAdmin: () => {}, setWriteBlock: () => {},
    setCursorHighlight: () => {}, setCursorSize: () => {}, setCursorColor: () => {}, setCursorRipple: () => {}, setStatusBarHidden: () => {},
    startMemberRecording: () => {}, startGuestRecording: () => {}, startPublicRecording: () => {},
    showAdminOriginal: () => {}, endPreview: () => {}, endAllRecordingModes: () => {},
    guardWriteAction: () => true,      // Provider 없으면 항상 허용(=촬영 기능 미적용)
    assertWriteAllowed: () => true,
};

export function useGuideRecording(): GuideRecordingValue {
    const ctx = React.useContext(GuideRecordingContext);
    return ctx ?? SAFE_DEFAULT;
}
