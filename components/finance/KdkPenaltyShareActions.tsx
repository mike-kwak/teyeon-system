'use client';

// KDK 누적 벌금 현황 — 공유 액션(현황 복사 · 공유하기).
//   - 텍스트는 버튼을 누른 순간 getText() 로 만든다(현재 탭·기간의 최신 데이터). getText 가 null 이면 비활성.
//   - 공유하기: Web Share API 가 있으면 클릭 핸들러에서 곧바로 navigator.share 호출(사용자 제스처 유지).
//     취소(AbortError)는 아무 메시지도 띄우지 않는다. 미지원·실패 시 같은 텍스트를 클립보드에 복사.
//   - 외부 SDK · 자동 발송 · 공개 링크 없음.

import React from 'react';
import { Copy, Share2 } from 'lucide-react';
import { SHARE_TITLE } from '@/lib/finance/kdkPenaltyHistoryShare';
import { NAVY, TEAL_DARK } from './KdkPenaltyHistoryUI';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

export const COPY_OK = '누적 벌금 현황이 복사되었습니다.';
const COPY_FAIL = '복사하지 못했습니다. 브라우저의 클립보드 권한을 확인한 뒤 다시 시도해 주세요.';
const SHARE_FALLBACK_OK = '이 기기에서는 공유하기를 지원하지 않아 현황을 복사했습니다. 카카오톡에 붙여넣어 주세요.';

/** 클립보드 복사. Clipboard API 우선, 미지원·거부 시 textarea + execCommand 폴백(일부 인앱 브라우저). */
export async function copyText(text: string): Promise<boolean> {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // 폴백으로 진행.
    }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

export function KdkPenaltyShareActions({ getText }: { getText: (() => string) | null }) {
    const [notice, setNotice] = React.useState<Notice>(null);
    const [busy, setBusy] = React.useState(false);
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const disabled = !getText || busy;

    React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    // 데이터가 바뀌어(기간·탭·새로고침) 버튼이 비활성화되면 이전 안내를 지운다.
    React.useEffect(() => { if (!getText) setNotice(null); }, [getText]);

    const show = (n: Notice) => {
        setNotice(n);
        if (timer.current) clearTimeout(timer.current);
        if (n) timer.current = setTimeout(() => setNotice(null), 3500);
    };

    const onCopy = async () => {
        if (!getText) return;
        const text = getText();
        setBusy(true);
        const ok = await copyText(text);
        setBusy(false);
        show(ok ? { kind: 'ok', text: COPY_OK } : { kind: 'error', text: COPY_FAIL });
    };

    const onShare = async () => {
        if (!getText) return;
        const text = getText();
        const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
        if (canShare) {
            setBusy(true);
            try {
                await navigator.share({ title: SHARE_TITLE, text }); // 제스처 직후 첫 비동기 호출.
                setBusy(false);
                show(null); // 공유 창에서 완료 — 별도 성공 문구 없음.
                return;
            } catch (e) {
                setBusy(false);
                if (e instanceof DOMException && e.name === 'AbortError') { show(null); return; } // 사용자 취소.
                // 그 외 실패(권한·미지원 데이터 등) → 복사로 대체.
            }
        }
        setBusy(true);
        const ok = await copyText(text);
        setBusy(false);
        show(ok ? { kind: 'ok', text: canShare ? COPY_OK : SHARE_FALLBACK_OK } : { kind: 'error', text: COPY_FAIL });
    };

    return (
        <section aria-label="누적 벌금 현황 공유" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
                <ActionButton onClick={onCopy} disabled={disabled} icon={<Copy size={15} />} label="현황 복사" />
                <ActionButton onClick={onShare} disabled={disabled} icon={<Share2 size={15} />} label="공유하기" primary />
            </div>
            <p style={{ margin: '0 2px', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                회원별 실명과 벌금 금액이 포함됩니다. 공유 대상을 확인해 주세요.
            </p>
            <p role="status" aria-live="polite" style={{
                margin: notice ? '0 2px' : 0, fontSize: 11.5, fontWeight: 800, lineHeight: 1.5, wordBreak: 'keep-all',
                color: notice?.kind === 'error' ? '#B91C1C' : TEAL_DARK, minHeight: 0,
            }}>{notice?.text ?? ''}</p>
        </section>
    );
}

function ActionButton({ onClick, disabled, icon, label, primary = false }: {
    onClick: () => void; disabled: boolean; icon: React.ReactNode; label: string; primary?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-disabled={disabled}
            style={{
                height: 40, minWidth: 0, borderRadius: 11, cursor: disabled ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                fontSize: 13, fontWeight: 900, whiteSpace: 'nowrap', fontFamily: 'inherit',
                border: primary ? '1px solid transparent' : '1px solid rgba(15,23,42,0.10)',
                background: disabled ? '#EEF2F6' : primary ? TEAL_DARK : '#FFFFFF',
                color: disabled ? '#94A3B8' : primary ? '#FFFFFF' : NAVY,
                boxShadow: disabled ? 'none' : primary ? '0 2px 8px rgba(14,124,118,0.22)' : '0 1px 4px rgba(15,23,42,0.06)',
            }}
        >{icon}{label}</button>
    );
}
