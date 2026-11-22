'use client';

// KDK 누적 벌금 이미지 리포트 — 미리보기 모달.
//   - 열릴 때 받은 스냅샷(PenaltyShareContent)으로 PNG 를 브라우저에서 생성 → 미리보기에 "실제 PNG"를 그대로 표시.
//   - 이미지 공유(Web Share files) · 이미지 저장(다운로드) · 이미지 복사(ClipboardItem, 1장일 때) · 텍스트 복사(V1).
//   - 외부 업로드·Storage 저장·DB 쓰기 없음. 닫을 때 임시 URL(objectURL) 해제.

import React from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, Image as ImageIcon, Share2, X } from 'lucide-react';
import { formatPenaltyShareText, SHARE_TITLE, type PenaltyShareContent } from '@/lib/finance/kdkPenaltyHistoryShare';
import { buildReportDocument, reportFileName } from '@/lib/finance/kdkPenaltyReportLayout';
import { renderReportPngs } from './kdkPenaltyReportCanvas';
import { NAVY, TEAL_DARK } from './KdkPenaltyHistoryUI';

export const COPY_OK = '누적 벌금 현황이 복사되었습니다.';

/** 텍스트 클립보드 복사(V1). Clipboard API 우선, 미지원·거부 시 textarea + execCommand 폴백(일부 인앱 브라우저). */
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

type Gen =
    | { kind: 'generating' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; blobs: Blob[]; urls: string[] };
type Notice = { kind: 'ok' | 'error' | 'info'; text: string } | null;

export const PRIVACY_NOTE = '회원별 실명과 벌금 금액이 포함됩니다. 공유 대상을 확인해 주세요.';
const MSG = {
    shareUnsupported: '이 브라우저는 이미지 파일 공유를 지원하지 않습니다. ‘이미지 저장’ 후 카카오톡에서 사진으로 첨부해 주세요.',
    shareFail: '이미지 공유에 실패했습니다. ‘이미지 저장’ 후 카카오톡에서 사진으로 첨부해 주세요.',
    saved: (n: number) => `이미지 ${n}장 저장을 요청했습니다. 저장되지 않으면 미리보기 이미지를 길게 눌러 저장해 주세요.`,
    imgCopied: '리포트 이미지가 복사되었습니다. 카카오톡 입력창에 붙여넣어 주세요.',
    imgCopyUnsupported: '이 브라우저는 이미지 복사를 지원하지 않습니다. ‘이미지 저장’ 또는 ‘이미지 공유’를 이용해 주세요.',
    imgCopyFail: '이미지를 복사하지 못했습니다. ‘이미지 저장’ 또는 ‘이미지 공유’를 이용해 주세요.',
    textFail: '텍스트를 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.',
};

type ShareNav = Navigator & { canShare?: (data?: ShareData) => boolean };

function supportsImageClipboard(): boolean {
    return typeof window !== 'undefined' && typeof navigator !== 'undefined'
        && typeof navigator.clipboard?.write === 'function' && typeof window.ClipboardItem === 'function';
}

export function KdkPenaltyReportModal({ content, onClose }: { content: PenaltyShareContent; onClose: () => void }) {
    const doc = React.useMemo(() => buildReportDocument(content), [content]);
    const [gen, setGen] = React.useState<Gen>({ kind: 'generating' });
    const [busy, setBusy] = React.useState(false);
    const [notice, setNotice] = React.useState<Notice>(null);
    const [attempt, setAttempt] = React.useState(0);
    const pageCount = doc.pages.length;

    // PNG 생성(스냅샷 기준). 닫히거나 재시도하면 이전 URL 해제.
    React.useEffect(() => {
        let cancelled = false;
        let urls: string[] = [];
        setGen({ kind: 'generating' });
        renderReportPngs(doc)
            .then((blobs) => {
                if (cancelled) return;
                urls = blobs.map((b) => URL.createObjectURL(b));
                setGen({ kind: 'ready', blobs, urls });
            })
            .catch((e) => {
                if (cancelled) return;
                console.warn('[KDK Penalty Report] image generation failed', e);
                setGen({ kind: 'error', message: '이미지를 만들지 못했습니다. 다시 시도하거나 ‘텍스트 복사’를 이용해 주세요.' });
            });
        return () => { cancelled = true; urls.forEach((u) => URL.revokeObjectURL(u)); };
    }, [doc, attempt]);

    // ESC 닫기 + 배경 스크롤 잠금
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [onClose]);

    const ready = gen.kind === 'ready' ? gen : null;
    const disabled = !ready || busy;
    const files = () => (ready ? ready.blobs.map((b, i) => new File([b], reportFileName(doc.baseDate, i + 1), { type: 'image/png' })) : []);

    const onShare = async () => {
        if (!ready || busy) return;
        const data: ShareData = { files: files(), title: SHARE_TITLE, text: `${SHARE_TITLE} · ${doc.periodText}` };
        const nav = navigator as ShareNav;
        const can = typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: data.files });
        if (!can) { setNotice({ kind: 'error', text: MSG.shareUnsupported }); return; }
        setBusy(true);
        try {
            await nav.share(data); // 사용자 클릭 직후 첫 비동기 호출(제스처 유지).
            setNotice(null);
        } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') setNotice(null); // 사용자 취소 — 메시지 없음.
            else setNotice({ kind: 'error', text: MSG.shareFail });
        } finally {
            setBusy(false);
        }
    };

    const onSave = async () => {
        if (!ready || busy) return;
        setBusy(true);
        try {
            for (let i = 0; i < ready.urls.length; i++) {
                const a = document.createElement('a');
                a.href = ready.urls[i];
                a.download = reportFileName(doc.baseDate, i + 1);
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
                if (i < ready.urls.length - 1) await new Promise((r) => setTimeout(r, 350)); // 연속 다운로드 차단 완화.
            }
            setNotice({ kind: 'info', text: MSG.saved(ready.urls.length) });
        } finally {
            setBusy(false);
        }
    };

    const onCopyImage = async () => {
        if (!ready || busy || ready.blobs.length !== 1) return;
        if (!supportsImageClipboard()) { setNotice({ kind: 'error', text: MSG.imgCopyUnsupported }); return; }
        setBusy(true);
        try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': ready.blobs[0] })]);
            setNotice({ kind: 'ok', text: MSG.imgCopied }); // write 가 성공(resolve)한 경우에만.
        } catch {
            setNotice({ kind: 'error', text: MSG.imgCopyFail });
        } finally {
            setBusy(false);
        }
    };

    const onCopyText = async () => {
        if (busy) return;
        setBusy(true);
        const ok = await copyText(formatPenaltyShareText(content));
        setBusy(false);
        setNotice(ok ? { kind: 'ok', text: COPY_OK } : { kind: 'error', text: MSG.textFail });
    };

    const multi = pageCount > 1;
    const modal = (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="이미지 리포트 미리보기"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 'max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom))',
            }}
        >
            <div style={{
                width: '100%', maxWidth: 560, maxHeight: '100%', display: 'flex', flexDirection: 'column',
                background: '#F1F5F9', borderRadius: 16, overflow: 'hidden', boxShadow: '0 12px 40px rgba(15,23,42,0.28)',
            }}>
                {/* 헤더 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 10px 16px', background: '#FFFFFF', borderBottom: '1px solid #E2E8F0' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 14.5, fontWeight: 900, color: NAVY }}>이미지 리포트 미리보기</p>
                        <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 700, color: '#64748B', wordBreak: 'keep-all' }}>
                            {doc.tabLabel} · {doc.periodText} · 기준일 {doc.baseDate} · <b style={{ color: NAVY }}>{pageCount}장</b>
                        </p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="닫기" style={{
                        width: 34, height: 34, borderRadius: '50%', border: '1px solid rgba(0,0,0,0.08)', background: '#FFFFFF',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#475569', flexShrink: 0,
                    }}><X size={17} /></button>
                </div>

                {/* 미리보기(실제 PNG) */}
                <div data-report-preview style={{ flex: 1, minHeight: 120, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {gen.kind === 'generating' && (
                        <p aria-busy="true" style={{ margin: '40px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 800, color: '#64748B' }}>이미지를 만드는 중...</p>
                    )}
                    {gen.kind === 'error' && (
                        <div role="alert" style={{ margin: '28px 4px', textAlign: 'center' }}>
                            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#B91C1C', wordBreak: 'keep-all' }}>{gen.message}</p>
                            <button type="button" onClick={() => setAttempt((n) => n + 1)} style={{
                                marginTop: 10, height: 34, padding: '0 14px', borderRadius: 9, border: '1px solid rgba(15,23,42,0.12)',
                                background: '#FFFFFF', fontWeight: 800, fontSize: 12.5, color: NAVY, cursor: 'pointer',
                            }}>다시 시도</button>
                        </div>
                    )}
                    {ready && ready.urls.map((u, i) => (
                        <figure key={u} style={{ margin: 0 }}>
                            {multi && <figcaption style={{ fontSize: 11, fontWeight: 800, color: '#64748B', margin: '0 2px 4px' }}>{i + 1} / {pageCount}</figcaption>}
                            {/* eslint-disable-next-line @next/next/no-img-element -- 생성한 blob PNG 미리보기(next/image 최적화 대상 아님) */}
                            <img src={u} alt={`KDK 누적 벌금 리포트 ${i + 1}/${pageCount}`} style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 8, border: '1px solid #DCE3EC', background: '#FFFFFF' }} />
                        </figure>
                    ))}
                </div>

                {/* 액션 */}
                <div style={{ padding: '10px 12px 12px', background: '#FFFFFF', borderTop: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: '#92400E', lineHeight: 1.45, wordBreak: 'keep-all' }}>{PRIVACY_NOTE}</p>
                    <Btn primary onClick={onShare} disabled={disabled} icon={<Share2 size={16} />} label={multi ? `이미지 공유 (${pageCount}장)` : '이미지 공유'} />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6 }}>
                        <Btn onClick={onSave} disabled={disabled} icon={<Download size={14} />} label="이미지 저장" />
                        <Btn onClick={onCopyImage} disabled={disabled || multi} icon={<ImageIcon size={14} />} label="이미지 복사" title={multi ? '여러 장은 저장 또는 공유를 이용해 주세요.' : undefined} />
                        <Btn onClick={onCopyText} disabled={busy} icon={<Copy size={14} />} label="텍스트 복사" />
                    </div>
                    {multi && <p style={{ margin: 0, fontSize: 10.5, fontWeight: 600, color: '#94A3B8', wordBreak: 'keep-all' }}>여러 장 리포트는 이미지 복사 대신 저장 또는 공유를 이용해 주세요.</p>}
                    <p role="status" aria-live="polite" style={{
                        margin: 0, fontSize: 11.5, fontWeight: 800, lineHeight: 1.45, wordBreak: 'keep-all',
                        color: notice?.kind === 'error' ? '#B91C1C' : notice?.kind === 'info' ? '#475569' : TEAL_DARK,
                    }}>{notice?.text ?? ''}</p>
                </div>
            </div>
        </div>
    );
    return createPortal(modal, document.body);
}

function Btn({ onClick, disabled, icon, label, primary = false, title }: {
    onClick: () => void; disabled: boolean; icon: React.ReactNode; label: string; primary?: boolean; title?: string;
}) {
    return (
        <button type="button" onClick={onClick} disabled={disabled} title={title} style={{
            height: primary ? 44 : 38, minWidth: 0, borderRadius: 10, cursor: disabled ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '0 4px',
            fontSize: primary ? 14 : 12, fontWeight: 900, whiteSpace: 'nowrap', fontFamily: 'inherit',
            border: primary ? '1px solid transparent' : '1px solid rgba(15,23,42,0.10)',
            background: disabled ? '#EEF2F6' : primary ? TEAL_DARK : '#FFFFFF',
            color: disabled ? '#94A3B8' : primary ? '#FFFFFF' : NAVY,
            boxShadow: disabled ? 'none' : primary ? '0 2px 8px rgba(14,124,118,0.22)' : '0 1px 3px rgba(15,23,42,0.06)',
            overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{icon}{label}</button>
    );
}
