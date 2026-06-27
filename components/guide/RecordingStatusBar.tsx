'use client';

// 촬영 상태 고정 표시(우상단). PC 전용(모바일 미표시). 영상 방해 최소화를 위해 숨김 토글 제공.
//   - 종료 버튼 제공(모든 미리보기 종료). 색상 외 텍스트 상태 병기. 스크린리더 전달.

import React from 'react';
import { useGuideRecording } from '@/hooks/useGuideRecording';
import { EyeOff, Video, X } from 'lucide-react';

const ROLE_LABEL: Record<string, string> = {
    ADMIN_ORIGINAL: 'ADMIN', MEMBER: 'MEMBER PREVIEW', GUEST: 'GUEST PREVIEW', PUBLIC: 'PUBLIC PREVIEW',
};

export default function RecordingStatusBar() {
    const g = useGuideRecording();
    const parts: string[] = [];
    if (g.isPreviewMode) parts.push(ROLE_LABEL[g.previewRole]);
    if (g.isRecordingMode) parts.push('RECORDING MODE');
    // 모든 쓰기가 차단된 것처럼 보이지 않도록 "촬영 보호 모드"로 표기(실제 차단은 적용 화면 한정).
    if (g.isWriteBlocked) parts.push('촬영 보호 모드');
    const text = parts.join(' · ') || 'PREVIEW';

    if (g.statusBarHidden) {
        // 영상에 방해되지 않도록 최소 점만 노출 → 클릭 시 복원.
        return (
            <button
                type="button" aria-label="촬영 상태 표시 보이기"
                onClick={() => g.setStatusBarHidden(false)}
                className="hidden lg:flex"
                style={{ position: 'fixed', top: 10, right: 10, zIndex: 2147483602, width: 14, height: 14, borderRadius: '50%', border: 'none', cursor: 'pointer', backgroundColor: '#DC2626', boxShadow: '0 0 0 2px rgba(255,255,255,0.6)' }}
            />
        );
    }

    return (
        <div
            role="status" aria-live="polite"
            className="hidden lg:flex"
            style={{
                position: 'fixed', top: 12, right: 12, zIndex: 2147483602,
                alignItems: 'center', gap: 8, padding: '7px 10px 7px 12px', borderRadius: 999,
                backgroundColor: 'rgba(15,27,51,0.92)', color: '#FFFFFF',
                border: '1px solid rgba(220,38,38,0.5)', boxShadow: '0 6px 20px rgba(0,0,0,0.28)',
            }}
        >
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#F43F5E', flexShrink: 0 }} />
            <Video size={13} aria-hidden style={{ opacity: 0.8 }} />
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{text}</span>
            <button type="button" aria-label="상태 표시 숨기기" onClick={() => g.setStatusBarHidden(true)}
                style={{ display: 'inline-flex', width: 22, height: 22, borderRadius: 6, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: '#C7D2E3', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <EyeOff size={12} />
            </button>
            <button type="button" aria-label="모든 미리보기 종료" onClick={() => g.endAllRecordingModes()}
                style={{ display: 'inline-flex', width: 22, height: 22, borderRadius: 6, border: '1px solid rgba(244,63,94,0.5)', background: 'rgba(244,63,94,0.16)', color: '#FFD9DF', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <X size={12} />
            </button>
        </div>
    );
}
