'use client';

// KDK 누적 벌금 이미지 리포트 — 미리보기 모달.
//   - 열릴 때 받은 스냅샷(PenaltyShareContent)으로 이미지를 브라우저에서 미리 생성한다(서버·업로드·DB 쓰기 없음).
//     1) 공유용(1배율, 폭 1080px) PNG 를 먼저 만들고 File 객체까지 준비 → 미리보기에도 이 이미지를 쓴다.
//     2) 이어서 저장용 원본(2배율, 폭 2160px) PNG 를 만든다.
//   - iOS 안정화: 공유 버튼 클릭 → (동기) File·canShare 확인 → 곧바로 navigator.share({ files }) 호출.
//     클릭과 share 사이에 이미지 생성·폰트 로딩 등 대기 작업이 없다(사용자 활성화 유지).
//     파일과 함께 text 를 넘기지 않는다(iOS 공유 대상 앱이 텍스트만 받거나 실패하는 경우 방지).
//   - 전체 공유(여러 장) + 현재 페이지 1장 공유. 실패 시 저장·텍스트 복사·카카오톡 사진 첨부 안내.
//   - navigator.share 가 끝나도 카카오톡 전송 성공 여부는 웹에서 알 수 없다 → 성공을 단정하지 않는다.
//   - 닫을 때 임시 URL(objectURL) 해제.

import React from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, Image as ImageIcon, Share2, X } from 'lucide-react';
import { formatPenaltyShareText, type PenaltyShareContent } from '@/lib/finance/kdkPenaltyHistoryShare';
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

/** 공유용 이미지 배율(폭 1080px) · 저장용 원본 배율(폭 2160px). */
export const SHARE_SCALE = 1;
export const ORIGINAL_SCALE = 2;

type ShareGen =
    | { kind: 'generating' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; blobs: Blob[]; urls: string[]; files: File[] };
type OrigGen = { kind: 'waiting' } | { kind: 'generating' } | { kind: 'error' } | { kind: 'ready'; blobs: Blob[] };
type Notice = { kind: 'ok' | 'error' | 'info'; text: string } | null;

export const PRIVACY_NOTE = '회원별 실명과 벌금 금액이 포함됩니다. 공유 대상을 확인해 주세요.';
const ATTACH_HINT = '카카오톡 채팅방의 + → 앨범(사진)에서 첨부해 주세요.';
export const MSG = {
    shareDone: '공유 창 작업이 끝났습니다. 카카오톡 채팅방에서 사진이 전송되었는지 확인해 주세요.',
    shareUnsupportedMulti: `이 브라우저는 여러 장 이미지 공유를 지원하지 않습니다. ‘현재 페이지 공유’로 한 장씩 보내거나, 이미지를 저장한 뒤 ${ATTACH_HINT}`,
    shareUnsupported: `이 브라우저는 이미지 파일 공유를 지원하지 않습니다. 이미지를 저장한 뒤 ${ATTACH_HINT}`,
    shareFailMulti: `여러 장 공유에 실패했습니다. ‘현재 페이지 공유’로 한 장씩 보내거나, 이미지를 저장한 뒤 ${ATTACH_HINT}`,
    shareFail: `이미지 공유에 실패했습니다. 이미지를 저장한 뒤 ${ATTACH_HINT}`,
    saved: (n: number) => `원본 이미지 ${n}장 저장을 요청했습니다. 저장되지 않으면 미리보기 이미지를 길게 눌러 저장해 주세요.`,
    imgCopied: '현재 페이지 이미지가 복사되었습니다. 카카오톡 입력창에 붙여넣어 주세요.',
    imgCopyUnsupported: '이 브라우저는 이미지 복사를 지원하지 않습니다. ‘현재 페이지 공유’ 또는 이미지 저장을 이용해 주세요.',
    imgCopyFail: '이미지를 복사하지 못했습니다. ‘현재 페이지 공유’ 또는 이미지 저장을 이용해 주세요.',
    textFail: '텍스트를 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.',
};

type ShareNav = Navigator & { canShare?: (data?: ShareData) => boolean };

function supportsImageClipboard(): boolean {
    return typeof window !== 'undefined' && typeof navigator !== 'undefined'
        && typeof navigator.clipboard?.write === 'function' && typeof window.ClipboardItem === 'function';
}

export function KdkPenaltyReportModal({ content, onClose }: { content: PenaltyShareContent; onClose: () => void }) {
    const doc = React.useMemo(() => buildReportDocument(content), [content]);
    const [share, setShare] = React.useState<ShareGen>({ kind: 'generating' });
    const [orig, setOrig] = React.useState<OrigGen>({ kind: 'waiting' });
    const [busy, setBusy] = React.useState(false);
    const [notice, setNotice] = React.useState<Notice>(null);
    const [attempt, setAttempt] = React.useState(0);
    const [current, setCurrent] = React.useState(0);
    const previewRef = React.useRef<HTMLDivElement | null>(null);
    const downloadUrls = React.useRef<string[]>([]);
    const pageCount = doc.pages.length;
    const multi = pageCount > 1;

    // 이미지 준비: 공유용(1배율) → File 준비 → 원본(2배율). 닫히거나 재시도하면 이전 URL 해제.
    React.useEffect(() => {
        let cancelled = false;
        let urls: string[] = [];
        setShare({ kind: 'generating' });
        setOrig({ kind: 'waiting' });
        setCurrent(0);
        (async () => {
            try {
                const blobs = await renderReportPngs(doc, SHARE_SCALE);
                if (cancelled) return;
                urls = blobs.map((b) => URL.createObjectURL(b));
                const files = blobs.map((b, i) => new File([b], reportFileName(doc.baseDate, i + 1), { type: 'image/png' }));
                setShare({ kind: 'ready', blobs, urls, files });
            } catch (e) {
                if (cancelled) return;
                console.warn('[KDK Penalty Report] share image generation failed', e);
                setShare({ kind: 'error', message: '이미지를 만들지 못했습니다. 다시 시도하거나 ‘텍스트 복사’를 이용해 주세요.' });
                return;
            }
            try {
                setOrig({ kind: 'generating' });
                const blobs = await renderReportPngs(doc, ORIGINAL_SCALE);
                if (!cancelled) setOrig({ kind: 'ready', blobs });
            } catch (e) {
                console.warn('[KDK Penalty Report] original image generation failed', e);
                if (!cancelled) setOrig({ kind: 'error' });
            }
        })();
        return () => { cancelled = true; urls.forEach((u) => URL.revokeObjectURL(u)); };
    }, [doc, attempt]);

    // 저장용 다운로드 URL 은 다운로드가 끝날 시간을 둔 뒤(또는 닫을 때) 해제.
    React.useEffect(() => () => { downloadUrls.current.forEach((u) => URL.revokeObjectURL(u)); downloadUrls.current = []; }, []);

    // ESC 닫기 + 배경 스크롤 잠금
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [onClose]);

    const ready = share.kind === 'ready' ? share : null;
    const origReady = orig.kind === 'ready' ? orig : null;

    // 미리보기 스크롤 위치 → 현재 페이지(영역 상단 1/3 지점에 걸친 장).
    const onPreviewScroll = React.useCallback(() => {
        const box = previewRef.current;
        if (!box) return;
        const mark = box.getBoundingClientRect().top + box.clientHeight / 3;
        const figs = [...box.querySelectorAll<HTMLElement>('figure[data-page]')];
        let idx = 0;
        figs.forEach((f, i) => { if (f.getBoundingClientRect().top <= mark) idx = i; });
        // 끝까지 내렸으면 마지막 장(짧은 마지막 장은 기준선까지 올라오지 못한다).
        if (figs.length && box.scrollTop + box.clientHeight >= box.scrollHeight - 2) idx = figs.length - 1;
        setCurrent(idx);
    }, []);
    const goPage = (i: number) => {
        setCurrent(i);
        const box = previewRef.current;
        const fig = box?.querySelector<HTMLElement>(`figure[data-page="${i}"]`);
        // 미리보기 영역이 position:relative → figure.offsetTop 은 영역 기준.
        if (box && fig) box.scrollTo({ top: Math.max(0, fig.offsetTop - 8), behavior: 'smooth' });
    };

    /** 파일 공유 — 클릭 핸들러에서 동기 확인 후 곧바로 share 호출. */
    const shareFiles = async (files: File[], isMulti: boolean) => {
        if (busy) return;
        const nav = navigator as ShareNav;
        const can = typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files });
        if (!can) { setNotice({ kind: 'error', text: isMulti ? MSG.shareUnsupportedMulti : MSG.shareUnsupported }); return; }
        setBusy(true);
        try {
            await nav.share({ files }); // 파일만 전달(text 미포함). 클릭 직후 첫 비동기 호출.
            setNotice({ kind: 'info', text: MSG.shareDone }); // 전송 성공 단정 아님.
        } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') setNotice(null); // 사용자 취소 — 메시지 없음.
            else setNotice({ kind: 'error', text: isMulti ? MSG.shareFailMulti : MSG.shareFail });
        } finally {
            setBusy(false);
        }
    };
    const onShareAll = () => { if (ready) void shareFiles(ready.files, multi); };
    const onShareCurrent = () => { if (ready) void shareFiles([ready.files[current]], false); };

    const download = async (indexes: number[]) => {
        if (!origReady || busy) return;
        setBusy(true);
        try {
            for (let k = 0; k < indexes.length; k++) {
                const i = indexes[k];
                const url = URL.createObjectURL(origReady.blobs[i]);
                downloadUrls.current.push(url);
                setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current = downloadUrls.current.filter((u) => u !== url); }, 60_000);
                const a = document.createElement('a');
                a.href = url;
                a.download = reportFileName(doc.baseDate, i + 1);
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
                if (k < indexes.length - 1) await new Promise((r) => setTimeout(r, 350)); // 연속 다운로드 차단 완화.
            }
            setNotice({ kind: 'info', text: MSG.saved(indexes.length) });
        } finally {
            setBusy(false);
        }
    };
    const onSaveAll = () => download(doc.pages.map((_, i) => i));
    const onSaveCurrent = () => download([current]);

    const onCopyImage = async () => {
        if (!ready || busy) return;
        if (!supportsImageClipboard()) { setNotice({ kind: 'error', text: MSG.imgCopyUnsupported }); return; }
        setBusy(true);
        try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': ready.blobs[current] })]);
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

    const shareDisabled = !ready || busy;
    const saveDisabled = !origReady || busy;
    const prep = share.kind === 'generating' ? '공유용 이미지 준비 중...'
        : share.kind === 'error' ? '이미지 준비 실패'
            : orig.kind === 'ready' ? '공유용 이미지 준비 완료 · 원본(고해상도) 저장 가능'
                : orig.kind === 'error' ? '공유용 이미지 준비 완료 · 원본 생성 실패(공유·복사는 가능)'
                    : '공유용 이미지 준비 완료 · 원본(고해상도) 준비 중...';

    const modal = (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="이미지 리포트 미리보기"
            data-share-bytes={ready ? ready.blobs.reduce((a, b) => a + b.size, 0) : undefined}
            data-orig-bytes={origReady ? origReady.blobs.reduce((a, b) => a + b.size, 0) : undefined}
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

                {/* 미리보기(공유용 PNG 그대로) — 독립 스크롤 */}
                <div ref={previewRef} onScroll={onPreviewScroll} data-report-preview style={{ flex: 1, minHeight: 120, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12, position: 'relative' }}>
                    {share.kind === 'generating' && (
                        <p aria-busy="true" style={{ margin: '40px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 800, color: '#64748B' }}>이미지를 만드는 중...</p>
                    )}
                    {share.kind === 'error' && (
                        <div role="alert" style={{ margin: '28px 4px', textAlign: 'center' }}>
                            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#B91C1C', wordBreak: 'keep-all' }}>{share.message}</p>
                            <button type="button" onClick={() => setAttempt((n) => n + 1)} style={{
                                marginTop: 10, height: 34, padding: '0 14px', borderRadius: 9, border: '1px solid rgba(15,23,42,0.12)',
                                background: '#FFFFFF', fontWeight: 800, fontSize: 12.5, color: NAVY, cursor: 'pointer',
                            }}>다시 시도</button>
                        </div>
                    )}
                    {ready && ready.urls.map((u, i) => (
                        <figure key={u} data-page={i} onClick={() => setCurrent(i)} style={{ margin: 0, cursor: multi ? 'pointer' : 'default' }}>
                            {multi && (
                                <figcaption style={{ fontSize: 11, fontWeight: 800, color: i === current ? TEAL_DARK : '#64748B', margin: '0 2px 4px' }}>
                                    {i + 1} / {pageCount}{i === current ? ' · 현재 페이지' : ''}
                                </figcaption>
                            )}
                            {/* eslint-disable-next-line @next/next/no-img-element -- 생성한 blob PNG 미리보기(next/image 최적화 대상 아님) */}
                            <img src={u} alt={`KDK 누적 벌금 리포트 ${i + 1}/${pageCount}`} style={{
                                display: 'block', width: '100%', height: 'auto', borderRadius: 8, background: '#FFFFFF',
                                border: multi && i === current ? `2px solid ${TEAL_DARK}` : '1px solid #DCE3EC',
                            }} />
                        </figure>
                    ))}
                </div>

                {/* 액션 */}
                <div style={{ padding: '10px 12px 12px', background: '#FFFFFF', borderTop: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: '#92400E', lineHeight: 1.45, wordBreak: 'keep-all' }}>{PRIVACY_NOTE}</p>
                    <p data-prep style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: '#64748B', lineHeight: 1.4, wordBreak: 'keep-all' }}>{prep}</p>
                    {multi && ready && (
                        <div role="group" aria-label="페이지 선택" style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto', paddingBottom: 1 }}>
                            {doc.pages.map((_, i) => (
                                <button key={i} type="button" onClick={() => goPage(i)} aria-pressed={i === current} aria-label={`${i + 1}페이지`} style={{
                                    flexShrink: 0, minWidth: 30, height: 28, padding: '0 6px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                                    fontSize: 12, fontWeight: 900, border: i === current ? '1px solid transparent' : '1px solid rgba(15,23,42,0.12)',
                                    background: i === current ? TEAL_DARK : '#FFFFFF', color: i === current ? '#FFFFFF' : NAVY,
                                }}>{i + 1}</button>
                            ))}
                        </div>
                    )}
                    {multi ? (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6 }}>
                                <Btn primary onClick={onShareAll} disabled={shareDisabled} icon={<Share2 size={15} />} label={`전체 공유 (${pageCount}장)`} />
                                <Btn primary onClick={onShareCurrent} disabled={shareDisabled} icon={<Share2 size={15} />} label={`현재 페이지 공유 ${current + 1}/${pageCount}`} />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6 }}>
                                <Btn onClick={onSaveAll} disabled={saveDisabled} icon={<Download size={14} />} label={`전체 저장 (${pageCount}장)`} />
                                <Btn onClick={onSaveCurrent} disabled={saveDisabled} icon={<Download size={14} />} label="현재 페이지 저장" />
                                <Btn onClick={onCopyImage} disabled={shareDisabled} icon={<ImageIcon size={14} />} label="현재 페이지 복사" />
                                <Btn onClick={onCopyText} disabled={busy} icon={<Copy size={14} />} label="텍스트 복사" />
                            </div>
                        </>
                    ) : (
                        <>
                            <Btn primary onClick={onShareAll} disabled={shareDisabled} icon={<Share2 size={16} />} label="이미지 공유" />
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6 }}>
                                <Btn onClick={onSaveAll} disabled={saveDisabled} icon={<Download size={14} />} label="이미지 저장" />
                                <Btn onClick={onCopyImage} disabled={shareDisabled} icon={<ImageIcon size={14} />} label="이미지 복사" />
                                <Btn onClick={onCopyText} disabled={busy} icon={<Copy size={14} />} label="텍스트 복사" />
                            </div>
                        </>
                    )}
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

function Btn({ onClick, disabled, icon, label, primary = false }: {
    onClick: () => void; disabled: boolean; icon: React.ReactNode; label: string; primary?: boolean;
}) {
    return (
        <button type="button" onClick={onClick} disabled={disabled} style={{
            height: primary ? 42 : 36, minWidth: 0, borderRadius: 10, cursor: disabled ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '0 4px',
            fontSize: primary ? 12.5 : 12, fontWeight: 900, whiteSpace: 'nowrap', fontFamily: 'inherit',
            border: primary ? '1px solid transparent' : '1px solid rgba(15,23,42,0.10)',
            background: disabled ? '#EEF2F6' : primary ? TEAL_DARK : '#FFFFFF',
            color: disabled ? '#94A3B8' : primary ? '#FFFFFF' : NAVY,
            boxShadow: disabled ? 'none' : primary ? '0 2px 8px rgba(14,124,118,0.22)' : '0 1px 3px rgba(15,23,42,0.06)',
            overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{icon}{label}</button>
    );
}
