'use client';

// KDK 누적 벌금 이미지 리포트 — 미리보기 모달.
//   - 열릴 때 받은 스냅샷(PenaltyShareContent)으로 이미지를 브라우저에서 미리 생성한다(서버·업로드·DB 쓰기 없음).
//     1) 공유용(1배율, 폭 1080px) PNG 를 먼저 만들고 File 객체까지 준비 → 미리보기에도 이 이미지를 쓴다.
//     2) 이어서 저장용 원본(2배율, 폭 2160px) PNG 를 만든다.
//   - 메인: '이미지 복사 k/N' — 기존 Ranking 결과 이미지와 같은 ClipboardItem PNG 복사 → 카카오톡 채팅방 붙여넣기.
//     여러 장은 '다음 페이지'로 사용자가 직접 넘긴 뒤 다시 복사(자동 이동 없음).
//     복사 미지원·실패 → Ranking 처럼 해당 장 PNG 자동 저장 요청 + 첨부 안내(저장 완료는 단정하지 않음).
//   - 보조: '다른 앱으로 보내기'(Web Share). 클릭 → (동기) File·canShare 확인 → 곧바로 navigator.share({ files }).
//     파일만 전달(text 미포함). 공유 창이 닫혀도 받는 앱의 전송 성공 여부는 웹에서 알 수 없다 → 성공을 단정하지 않는다.
//   - 저장(전체·현재 페이지, 원본 2160px) · 텍스트 복사(V1) 유지.
//   - 닫을 때 임시 URL(objectURL) 해제.

import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Copy, Download, Image as ImageIcon, Share2, X } from 'lucide-react';
import { formatPenaltyShareText, type PenaltyShareContent } from '@/lib/finance/kdkPenaltyHistoryShare';
import { buildReportDocument } from '@/lib/finance/kdkPenaltyReportLayout';
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
const ATTACH_HINT = '카카오톡 채팅방의 + → 앨범(사진) 또는 파일에서 첨부해 주세요.';
export const MSG = {
    // 메인: Ranking 과 같은 이미지 복사 → 카카오톡 채팅방 붙여넣기
    imgCopied: (k: number, n: number) => `이미지 ${k}/${n}이(가) 복사되었습니다. 카카오톡 채팅방에서 붙여넣기 해주세요.`
        + (k < n ? ' 다음 장은 ‘다음 페이지’를 누른 뒤 다시 복사해 주세요.' : ''),
    // 복사 실패 → Ranking 처럼 해당 장 PNG 자동 저장(저장 완료는 확인할 수 없으므로 '요청'으로 표현)
    imgCopyFallback: (k: number, n: number) => `이미지 복사가 지원되지 않아 ${k}/${n} PNG 저장을 요청했습니다. 저장되면 ${ATTACH_HINT}`,
    imgCopyFailNoFile: `이미지를 복사하지 못했습니다. ‘이미지 저장’ 후 ${ATTACH_HINT}`,
    // 보조: 다른 앱으로 보내기(Web Share)
    shareDone: '공유 창 작업이 끝났습니다. 받는 앱에서 실제로 전송되었는지 확인해 주세요.',
    shareDoneIos: '공유 창 작업이 끝났습니다. ‘이미지 저장’을 선택했다면 사진 앱에서 확인한 뒤 카카오톡 채팅방의 + → 앨범에서 첨부해 주세요.',
    // 여러 장 일괄 전송 안내
    bulkPc: '여러 장을 한 번에 보내려면 전체 저장 후 다운로드 폴더에서 이미지를 선택해 카카오톡 채팅방에 끌어다 놓으세요.',
    bulkPcNote: '처음 한 번 브라우저의 ‘여러 파일 다운로드 허용’이 필요할 수 있습니다.',
    bulkIos: (n: number) => `여러 장을 한 번에 보내려면 ‘사진 앱에 저장 (${n}장)’을 누른 뒤 공유 창에서 ‘이미지 ${n}개 저장’을 선택하고, 카카오톡 채팅방의 + → 앨범에서 첨부하세요.`,
    bulkIosNote: '공유 창에 저장 항목이 보이지 않으면 ‘이미지 복사’로 한 장씩 보내 주세요.',
    shareUnsupported: `이 브라우저는 다른 앱으로 이미지 보내기를 지원하지 않습니다. ‘이미지 복사’를 이용하거나, 이미지를 저장한 뒤 ${ATTACH_HINT}`,
    shareFail: `다른 앱으로 보내지 못했습니다. ‘이미지 복사’를 이용하거나, 이미지를 저장한 뒤 ${ATTACH_HINT}`,
    saved: (n: number) => `원본 이미지 ${n}장 저장을 요청했습니다. 저장되지 않으면 미리보기 이미지를 길게 눌러 저장해 주세요.`,
    textFail: '텍스트를 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.',
};

type ShareNav = Navigator & { canShare?: (data?: ShareData) => boolean };

/**
 * 저장·공유 파일명: TEYEON_KDK_Penalty_YYYY-MM-DD_{all|member|guest}_{kk}of{NN}.png
 *   - 탭 구분(같은 날 전체·회원·게스트 저장이 섞이지 않게), 페이지/전체 수를 같은 자릿수(최소 2)로 맞춰 이름순 = 페이지순.
 */
export function reportExportFileName(baseDate: string, tab: 'all' | 'member' | 'guest', pageNo: number, pageCount: number, view?: string): string {
    const w = Math.max(2, String(pageCount).length);
    const pad = (n: number) => String(n).padStart(w, '0');
    // V6: 금액(V5) 외 표시 방식은 파일명에 방식을 붙여 같은 날 저장한 이미지가 섞이지 않게 한다. 금액은 V5 파일명 그대로.
    const v = view && view !== 'amount' ? `_${view}` : '';
    return `TEYEON_KDK_Penalty_${baseDate.replace(/\./g, '-')}_${tab}${v}_${pad(pageNo)}of${pad(pageCount)}.png`;
}

/**
 * 플랫폼 구분(안내 문구용). iPhone/iPod/iPad(iPadOS 데스크톱 UA 포함)만 iOS 로 본다.
 *   Android · 터치스크린 Windows 는 iOS 가 아니다(MacIntel + 멀티터치만 iPadOS 로 판정).
 */
export function detectPlatform(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number } | undefined): 'ios' | 'android' | 'desktop' {
    if (!nav) return 'desktop';
    const ua = nav.userAgent || '';
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1) return 'ios'; // iPadOS
    return 'desktop';
}

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
                const files = blobs.map((b, i) => new File([b], reportExportFileName(doc.baseDate, doc.tab, i + 1, blobs.length, doc.view), { type: 'image/png' }));
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
    const platform = React.useMemo(() => detectPlatform(typeof navigator !== 'undefined' ? navigator : undefined), []);
    // iOS 에서 이미지 파일 공유가 실제로 가능한지(canShare files) — 불가하면 기존 저장·복사 흐름 유지.
    const iosShare = React.useMemo(() => {
        if (platform !== 'ios' || !ready) return false;
        const nav = navigator as ShareNav;
        try {
            return typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: ready.files });
        } catch {
            return false;
        }
    }, [platform, ready]);

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

    /** 보조: 다른 앱으로 보내기(Web Share) — 클릭 핸들러에서 동기 확인 후 곧바로 share({ files }) 호출. */
    const onShareOther = async () => {
        if (!ready || busy) return;
        const files = ready.files;
        const nav = navigator as ShareNav;
        const can = typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files });
        if (!can) { setNotice({ kind: 'error', text: MSG.shareUnsupported }); return; }
        setBusy(true);
        try {
            await nav.share({ files }); // 파일만 전달(text 미포함). 클릭 직후 첫 비동기 호출.
            setNotice({ kind: 'info', text: iosShare ? MSG.shareDoneIos : MSG.shareDone }); // 전송·저장 성공 단정 아님.
        } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') setNotice(null); // 사용자 취소 — 메시지 없음.
            else setNotice({ kind: 'error', text: MSG.shareFail });
        } finally {
            setBusy(false);
        }
    };

    /** PNG 다운로드(앵커). 다운로드가 끝날 시간을 두고 URL 해제. 저장 완료 여부는 웹에서 알 수 없다. */
    const downloadBlobs = async (items: { blob: Blob; pageIndex: number }[]) => {
        for (let k = 0; k < items.length; k++) {
            const { blob, pageIndex } = items[k];
            const url = URL.createObjectURL(blob);
            downloadUrls.current.push(url);
            setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current = downloadUrls.current.filter((u) => u !== url); }, 60_000);
            const a = document.createElement('a');
            a.href = url;
            a.download = reportExportFileName(doc.baseDate, doc.tab, pageIndex + 1, pageCount, doc.view);
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
            if (k < items.length - 1) await new Promise((r) => setTimeout(r, 350)); // 연속 다운로드 차단 완화.
        }
    };
    const download = async (indexes: number[]) => {
        if (!origReady || busy) return;
        setBusy(true);
        try {
            await downloadBlobs(indexes.map((i) => ({ blob: origReady.blobs[i], pageIndex: i })));
            setNotice({ kind: 'info', text: MSG.saved(indexes.length) });
        } finally {
            setBusy(false);
        }
    };
    const onSaveAll = () => download(doc.pages.map((_, i) => i));
    const onSaveCurrent = () => download([current]);

    /**
     * 메인: 이미지 복사(Ranking 과 같은 ClipboardItem PNG) → 카카오톡 채팅방에 붙여넣기.
     *   - 미리 만든 공유용 PNG(1080px)를 클릭 즉시 복사. 성공(write resolve) 시에만 성공 안내.
     *   - 복사 후 페이지는 자동으로 넘기지 않는다(사용자가 '다음 페이지'로 이동).
     *   - 미지원·실패 → Ranking 처럼 해당 장 PNG 자동 저장 요청 + 첨부 안내(원본 준비 전이면 공유용 PNG).
     */
    const onCopyImage = async () => {
        if (!ready || busy) return;
        const page = current;
        setBusy(true);
        try {
            if (!supportsImageClipboard()) throw new Error('Image clipboard is not supported.');
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': ready.blobs[page] })]);
            setNotice({ kind: 'ok', text: MSG.imgCopied(page + 1, pageCount) });
        } catch (copyError) {
            console.warn('[KDK Penalty Report Image Copy]', copyError);
            try {
                await downloadBlobs([{ blob: origReady ? origReady.blobs[page] : ready.blobs[page], pageIndex: page }]);
                setNotice({ kind: 'info', text: MSG.imgCopyFallback(page + 1, pageCount) });
            } catch {
                setNotice({ kind: 'error', text: MSG.imgCopyFailNoFile });
            }
        } finally {
            setBusy(false);
        }
    };
    const onNextPage = () => { if (current < pageCount - 1) goPage(current + 1); };

    const onCopyText = async () => {
        if (busy) return;
        setBusy(true);
        const ok = await copyText(formatPenaltyShareText(content));
        setBusy(false);
        setNotice(ok ? { kind: 'ok', text: COPY_OK } : { kind: 'error', text: MSG.textFail });
    };

    const shareDisabled = !ready || busy;
    // iOS + 이미지 파일 공유 지원일 때만 Web Share 를 '사진 앱에 저장 (N장)'으로 표시(공유 창의 '이미지 N개 저장' 경로).
    const shareLabel = iosShare ? `사진 앱에 저장 (${pageCount}장)` : '다른 앱으로 보내기';
    const bulkGuide = !multi || !ready ? null
        : iosShare ? { text: MSG.bulkIos(pageCount), note: MSG.bulkIosNote }
            : platform === 'desktop' ? { text: MSG.bulkPc, note: MSG.bulkPcNote }
                : null; // Android·파일 공유 미지원 iOS: 기존 저장·복사 유지(별도 안내 없음)
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
                            {doc.tabLabel}{doc.view !== 'amount' ? ` · ${doc.viewLabel}` : ''} · {doc.periodText} · 기준일 {doc.baseDate} · <b style={{ color: NAVY }}>{pageCount}장</b>
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
                    {/* 메인: 이미지 복사 k/N (+ 여러 장이면 다음 페이지) */}
                    {multi ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: 6 }}>
                            <Btn primary onClick={onCopyImage} disabled={shareDisabled} icon={<ImageIcon size={16} />} label={`이미지 복사 ${current + 1}/${pageCount}`} />
                            <Btn onClick={onNextPage} disabled={!ready || busy || current >= pageCount - 1} icon={<ChevronRight size={15} />} label="다음 페이지" tall />
                        </div>
                    ) : (
                        <Btn primary onClick={onCopyImage} disabled={shareDisabled} icon={<ImageIcon size={16} />} label={`이미지 복사 1/1`} />
                    )}
                    {/* 보조: 저장 · 다른 앱으로 보내기(Web Share) · 텍스트 복사 */}
                    {multi ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6 }}>
                            <Btn onClick={onSaveAll} disabled={saveDisabled} icon={<Download size={14} />} label={`전체 저장 (${pageCount}장)`} />
                            <Btn onClick={onSaveCurrent} disabled={saveDisabled} icon={<Download size={14} />} label="현재 페이지 저장" />
                            <Btn onClick={onShareOther} disabled={shareDisabled} icon={<Share2 size={14} />} label={shareLabel} />
                            <Btn onClick={onCopyText} disabled={busy} icon={<Copy size={14} />} label="텍스트 복사" />
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6 }}>
                            <Btn onClick={onSaveAll} disabled={saveDisabled} icon={<Download size={14} />} label="이미지 저장" />
                            <Btn onClick={onShareOther} disabled={shareDisabled} icon={<Share2 size={14} />} label={shareLabel} />
                            <Btn onClick={onCopyText} disabled={busy} icon={<Copy size={14} />} label="텍스트 복사" />
                        </div>
                    )}
                    {bulkGuide && (
                        <p data-bulk-guide style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: '#475569', lineHeight: 1.45, wordBreak: 'keep-all' }}>
                            {bulkGuide.text} <span style={{ color: '#94A3B8', fontWeight: 600 }}>{bulkGuide.note}</span>
                        </p>
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

function Btn({ onClick, disabled, icon, label, primary = false, tall = false }: {
    onClick: () => void; disabled: boolean; icon: React.ReactNode; label: string; primary?: boolean; tall?: boolean;
}) {
    return (
        <button type="button" onClick={onClick} disabled={disabled} style={{
            height: primary || tall ? 42 : 36, minWidth: 0, borderRadius: 10, cursor: disabled ? 'default' : 'pointer',
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
