'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useGuideRecording } from '@/hooks/useGuideRecording';
import GuestPassDefaultsEditor from '@/components/admin/GuestPassDefaultsEditor';
import {
    fetchGuestPassDefaults,
    saveGuestPassDefaults,
    type GuestPassDefaults,
    type GuestPassDefaultsInput,
} from '@/lib/guestPassService';

/**
 * /admin/guest-pass-defaults
 *
 * CEO/ADMIN 전용 — 클럽 공통 Guest Pass 기본값 편집.
 * 메인 진입점은 Club Schedule 상세의 [Guest Pass 설정] 카드 내부 링크.
 * 직접 URL 진입도 허용하지만, 권한이 없으면 화면에서 차단.
 */

export default function GuestPassDefaultsPage() {
    const router = useRouter();
    const { user, role, isLoading } = useAuth();
    const { guardWriteAction, shouldHideAdminControls } = useGuideRecording();
    // 촬영 보호/미리보기에서는 편집 화면을 숨긴다(기존 권한 조건 유지 + 촬영 숨김 조건 추가).
    const isAdmin = (role === 'CEO' || role === 'ADMIN') && !shouldHideAdminControls;

    const [defaults, setDefaults] = React.useState<GuestPassDefaults | null>(null);
    const [loadStatus, setLoadStatus] = React.useState<'loading' | 'ok' | 'failed'>('loading');
    const [saving, setSaving] = React.useState(false);
    const [saveError, setSaveError] = React.useState<string | null>(null);
    const [savedAt, setSavedAt] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!isAdmin) return;
        let cancelled = false;
        (async () => {
            try {
                const row = await fetchGuestPassDefaults();
                if (cancelled) return;
                setDefaults(row);
                setLoadStatus('ok');
            } catch {
                if (cancelled) return;
                setLoadStatus('failed');
            }
        })();
        return () => { cancelled = true; };
    }, [isAdmin]);

    const handleSave = async (input: GuestPassDefaultsInput) => {
        if (!guardWriteAction('Guest Pass 공통 기본값 저장')) return; // 촬영 보호 모드 차단
        setSaving(true);
        setSaveError(null);
        try {
            const saved = await saveGuestPassDefaults(input, user?.id);
            setDefaults(saved);
            setSavedAt(saved.updatedAt);
        } catch (err: any) {
            setSaveError(err?.message || '저장에 실패했습니다.');
        } finally {
            setSaving(false);
        }
    };

    if (isLoading) {
        return <CenterMessage>LOADING...</CenterMessage>;
    }
    if (!user || !isAdmin) {
        return (
            <main style={pageStyle}>
                <div style={containerStyle}>
                    <p style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', textAlign: 'center', margin: 0 }}>
                        운영자만 접근할 수 있는 페이지입니다.
                    </p>
                    <Link
                        href="/"
                        style={{
                            display: 'inline-block', marginTop: 12,
                            fontSize: 12, fontWeight: 700, color: '#3B82F6', textAlign: 'center',
                        }}
                    >
                        ← 홈으로 돌아가기
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <main style={pageStyle}>
            <div style={containerStyle}>
                <header style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 10 }}>
                    <button
                        type="button"
                        onClick={() => router.back()}
                        aria-label="뒤로"
                        style={{
                            width: 34, height: 34, borderRadius: '50%',
                            border: '1px solid rgba(0,0,0,0.09)', backgroundColor: '#FFFFFF',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#475569', cursor: 'pointer', flexShrink: 0,
                        }}
                    >
                        <ChevronLeft size={17} strokeWidth={2.2} />
                    </button>
                    <div>
                        <p
                            style={{
                                fontSize: 8, fontWeight: 800, letterSpacing: '0.28em',
                                textTransform: 'uppercase', color: '#0F9F98',
                                margin: 0, lineHeight: 1.3,
                            }}
                        >
                            CLUB · GUEST PASS
                        </p>
                        <p
                            style={{
                                fontSize: 16, fontWeight: 900, color: '#0F172A',
                                margin: 0, lineHeight: 1.2, letterSpacing: '-0.01em',
                            }}
                        >
                            공통 기본값 편집
                        </p>
                    </div>
                </header>

                <p style={{
                    fontSize: 11.5, fontWeight: 600, color: '#64748B',
                    margin: '0 2px 4px', lineHeight: 1.55,
                }}>
                    여기서 입력한 값이 모든 정모 Guest Pass 의 기본값으로 자동 적용됩니다.
                    정모별 게스트비/계좌 공개 여부/추가 공지는 정모 상세 화면의 Guest Pass 설정 카드에서 override 할 수 있습니다.
                </p>

                {loadStatus === 'loading' && (
                    <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textAlign: 'center', margin: '24px 0' }}>
                        불러오는 중...
                    </p>
                )}
                {loadStatus === 'failed' && (
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#B91C1C', textAlign: 'center', margin: '24px 0' }}>
                        기본값을 불러오지 못했습니다. supabase/add_club_guest_pass_defaults.sql 적용 여부를 확인해 주세요.
                    </p>
                )}
                {loadStatus === 'ok' && (
                    <GuestPassDefaultsEditor
                        initial={defaults}
                        saving={saving}
                        saveError={saveError}
                        savedAt={savedAt}
                        onSave={handleSave}
                    />
                )}
            </div>
        </main>
    );
}

const CenterMessage = ({ children }: { children: React.ReactNode }) => (
    <main style={pageStyle}>
        <div style={{ ...containerStyle, paddingTop: 80, textAlign: 'center' }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.1em' }}>
                {children}
            </p>
        </div>
    </main>
);

const pageStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '100dvh',
    backgroundColor: '#F2F4F7',
    marginBottom: 'calc(-1 * var(--page-bottom-safe))',
};

const containerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 430,
    margin: '0 auto',
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 'var(--page-bottom-safe)',
    paddingLeft: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    boxSizing: 'border-box',
};
