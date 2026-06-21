'use client';

import React from 'react';
import { Copy, Check, Share2 } from 'lucide-react';
import type { ClubSchedule } from '@/lib/clubScheduleData';
import {
    fetchScheduleGuestPass,
    fetchGuestPassDefaults,
    mergeGuestPassData,
    type ScheduleGuestPass,
    type GuestPassDefaults,
} from '@/lib/guestPassService';
import {
    buildGuestPassUrl,
    buildKakaoMessage,
    shareOrCopyText,
} from '@/lib/guestPassMessage';

/**
 * 일반 회원용 — 활성화된 정모에서만 게스트 안내 링크를 복사할 수 있는 작은 카드.
 * 작성/수정/토글 권한 없음. token 만 있으면 카드 표시.
 * 호출자는 isAdmin 사용자에게는 GuestPassSettingsCard 를 대신 보여줘서 중복 표시 회피.
 */

interface GuestPassMemberLinkProps {
    schedule: ClubSchedule;
}

export default function GuestPassMemberLink({ schedule }: GuestPassMemberLinkProps) {
    const [loaded, setLoaded] = React.useState(false);
    const [perMeet, setPerMeet] = React.useState<ScheduleGuestPass | null>(null);
    const [defaults, setDefaults] = React.useState<GuestPassDefaults | null>(null);
    const [linkState, setLinkState] = React.useState<'idle' | 'copied' | 'shared' | 'failed'>('idle');
    const [kakaoState, setKakaoState] = React.useState<'idle' | 'copied' | 'failed'>('idle');

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const pm = await fetchScheduleGuestPass(schedule.id);
                if (cancelled) return;
                setPerMeet(pm);
                // 카카오 메시지에 필요 — 활성화된 경우에만 defaults 도 조회.
                if (pm?.isActive && pm.publicToken) {
                    const d = await fetchGuestPassDefaults();
                    if (cancelled) return;
                    setDefaults(d);
                }
            } catch {
                /* 활성 row가 없거나 RLS 차단 — 카드 자체 비표시 */
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [schedule.id]);

    // 비활성/토큰 없음/로드 실패 → 회원에게는 카드 자체를 보여주지 않는다.
    if (!loaded) return null;
    if (!perMeet || !perMeet.isActive || !perMeet.publicToken) return null;

    const url = buildGuestPassUrl({ token: perMeet.publicToken });

    const handleCopyLink = async () => {
        const r = await shareOrCopyText({ title: 'TEYEON Guest Pass', text: url });
        setLinkState(r.mode === 'share' ? 'shared' : r.mode === 'copy' ? 'copied' : 'failed');
        window.setTimeout(() => setLinkState('idle'), 2000);
    };

    const handleCopyKakao = async () => {
        if (!defaults) {
            // defaults 가 없으면 메시지 안내문 일부가 비게 됨 — 그래도 진행.
        }
        const data = mergeGuestPassData({ schedule, defaults, perMeet });
        const message = buildKakaoMessage({ data, guestPassUrl: url });
        const r = await shareOrCopyText({ title: 'TEYEON 게스트 안내', text: message });
        setKakaoState(r.mode === 'copy' || r.mode === 'share' ? 'copied' : 'failed');
        window.setTimeout(() => setKakaoState('idle'), 2000);
    };

    return (
        <section
            style={{
                borderRadius: 14,
                backgroundColor: '#FFFFFF',
                border: '1px solid rgba(15,159,152,0.18)',
                boxShadow: '0 1px 5px rgba(0,0,0,0.04)',
                padding: 14,
                display: 'flex', flexDirection: 'column', gap: 10,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                    width: 8, height: 8, borderRadius: '50%', backgroundColor: '#10B981',
                }} />
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em' }}>
                    게스트 안내 링크 공개 중
                </p>
            </div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#64748B', lineHeight: 1.55 }}>
                초대하실 분에게 아래 링크를 보내주세요. 작성/수정은 운영진만 가능합니다.
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" onClick={handleCopyLink} style={btnStyle}>
                    {linkState === 'copied' || linkState === 'shared' ? <Check size={12} /> : <Copy size={12} />}
                    {linkState === 'copied' ? '복사됨'
                        : linkState === 'shared' ? '공유됨'
                            : linkState === 'failed' ? '실패'
                                : '링크 복사'}
                </button>
                <button type="button" onClick={handleCopyKakao} style={btnStyle}>
                    {kakaoState === 'copied' ? <Check size={12} /> : <Share2 size={12} />}
                    {kakaoState === 'copied' ? '복사됨'
                        : kakaoState === 'failed' ? '실패'
                            : '카카오 안내문 복사'}
                </button>
            </div>
        </section>
    );
}

const btnStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    height: 32, paddingLeft: 12, paddingRight: 12,
    borderRadius: 8,
    backgroundColor: '#0F9F98',
    color: '#FFFFFF',
    border: 'none',
    fontSize: 11.5, fontWeight: 800,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
};
