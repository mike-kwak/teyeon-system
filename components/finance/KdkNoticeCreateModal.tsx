'use client';

// KDK 벌금·상금 현황 공개 공지 생성 모달.
//   현재 정산 상태를 스냅샷으로 고정해 공개 링크(랜덤 토큰)를 만든다.
//   같은 세션에서도 여러 번 생성 가능(최초/중간/최종). 생성 후 데이터가 바뀌어도 공지는 불변.

import React from 'react';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import { FINANCE_PAYMENT_ACCOUNT } from '@/lib/finance/paymentAccount';
import type { KdkPenaltyRow } from '@/lib/finance/kdkSettlementService';
import type { KdkPrizeDerivation, KdkPrizePayout } from '@/lib/finance/kdkPrizeService';
import {
    buildKdkNoticeMembers,
    buildKdkNoticeStats,
    buildKdkNoticePrize,
    createKdkNotice,
    publicKdkNoticeUrl,
    buildKdkKakaoText,
} from '@/lib/finance/kdkNoticesService';

interface Props {
    sessionId: string;
    kdkDate: string | null;
    sessionTitle: string | null;
    penaltyRows: KdkPenaltyRow[];
    prizeDerivation: KdkPrizeDerivation;
    prizePayout: KdkPrizePayout | null;
    onClose: () => void;
    onCreated: () => void;
}

const NAVY = '#0F172A';

export default function KdkNoticeCreateModal({ sessionId, kdkDate, sessionTitle, penaltyRows, prizeDerivation, prizePayout, onClose, onCreated }: Props) {
    const dateDot = React.useMemo(() => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(kdkDate || '');
        return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
    }, [kdkDate]);

    const [title, setTitle] = React.useState(`${dateDot ? dateDot + ' ' : ''}KDK 벌금 납부 현황`);
    const [referenceAt, setReferenceAt] = React.useState(() => toLocalInput(new Date()));
    const [dueAt, setDueAt] = React.useState(() => {
        const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0);
        return toLocalInput(d);
    });
    const [publicNote, setPublicNote] = React.useState('미납자는 마감 시간까지 입금 부탁드립니다.');
    const [includeRanking, setIncludeRanking] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [result, setResult] = React.useState<{ url: string; kakao: string } | null>(null);
    const [copied, setCopied] = React.useState<'url' | 'kakao' | null>(null);

    // 모달이 떠 있는 동안 배경(Finance 정산 페이지) 스크롤 잠금.
    useBodyScrollLock(true);

    const members = React.useMemo(() => buildKdkNoticeMembers(penaltyRows), [penaltyRows]);
    const stats = React.useMemo(() => buildKdkNoticeStats(members), [members]);
    const prize = React.useMemo(() => buildKdkNoticePrize(prizeDerivation, prizePayout), [prizeDerivation, prizePayout]);

    const handleCreate = async () => {
        const refISO = localToISO(referenceAt);
        if (!refISO) { alert('기준일시가 올바르지 않습니다.'); return; }
        const dueISO = dueAt ? localToISO(dueAt) : null;
        setBusy(true);
        try {
            const rankingUrl = includeRanking && typeof window !== 'undefined'
                ? `${window.location.origin}/archive?session=${encodeURIComponent(sessionId)}`
                : null;
            const { token } = await createKdkNotice({
                sessionId,
                kdkDate,
                sessionTitle,
                title,
                referenceAt: refISO,
                dueAt: dueISO,
                publicNote,
                rankingUrl,
                members,
                stats,
                prize,
            });
            const url = publicKdkNoticeUrl(token);
            const kakao = buildKdkKakaoText({ kdkDate, referenceAt: refISO, dueAt: dueISO, prize, paymentAccount: FINANCE_PAYMENT_ACCOUNT, url });
            setResult({ url, kakao });
        } catch (e: any) {
            alert(e?.message || '공지 생성에 실패했습니다.');
        } finally {
            setBusy(false);
        }
    };

    const copy = async (text: string, which: 'url' | 'kakao') => {
        try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(null), 1500); } catch { /* noop */ }
    };

    return (
        <div role="dialog" aria-modal="true" onClick={onClose} style={overlay}>
            <div onClick={(e) => e.stopPropagation()} style={sheet}>
                <div style={header}>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: NAVY }}>벌금 현황 공지 만들기</h3>
                    <button type="button" onClick={onClose} aria-label="닫기" style={closeBtn}><X size={16} /></button>
                </div>

                <div data-kdk-notice-modal-scroll style={body}>
                    {!result ? (
                        <>
                            {/* 요약 미리보기 */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                <Mini label="대상" v={`${stats.targetCount}명`} />
                                <Mini label="완료" v={`${stats.paidCount}명`} />
                                <Mini label="미납" v={`${stats.unpaidCount}명`} />
                                <Mini label="미납액" v={formatWon(stats.totalUnpaid)} />
                            </div>

                            <Field label="공지 제목">
                                <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
                            </Field>
                            <Field label="기준일시">
                                <input type="datetime-local" value={referenceAt} onChange={(e) => setReferenceAt(e.target.value)} style={input} />
                            </Field>
                            <Field label="납부 마감일시">
                                <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={input} />
                            </Field>
                            <Field label="안내 메모">
                                <textarea value={publicNote} onChange={(e) => setPublicNote(e.target.value)} rows={2} style={{ ...input, height: 'auto', resize: 'vertical' }} />
                            </Field>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                                <input type="checkbox" checked={includeRanking} onChange={(e) => setIncludeRanking(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#0F9F98' }} />
                                전체 순위 링크 포함
                            </label>

                            {prize && (
                                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#64748B', lineHeight: 1.6 }}>
                                    최종 1위 {prize.overallWinnerName}{prize.overallWinnerIsGuest ? '(게스트)' : ''} · 상금 대상 {prize.recipientName || '없음'}
                                    {prize.recipientName ? ` (전체 ${prize.recipientOverallRank ?? '?'}위, ${formatWon(prize.amount)}, ${prize.status === 'paid' ? '지급 완료' : '미지급'})` : ''}
                                </p>
                            )}

                            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: '#0E7C76' }}>
                                공지에 카카오뱅크 입금 계좌(벌금 입금 계좌)가 포함됩니다.
                            </p>

                            <button type="button" onClick={handleCreate} disabled={busy} style={{ width: '100%', height: 44, borderRadius: 11, border: 'none', background: busy ? '#CBD5E1' : 'linear-gradient(90deg,#0F9F98,#16A085)', color: '#FFFFFF', fontSize: 13, fontWeight: 900, cursor: busy ? 'wait' : 'pointer' }}>
                                {busy ? '생성 중...' : '공지 생성'}
                            </button>
                        </>
                    ) : (
                        <>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#16A085' }}>공지가 생성되었습니다.</p>
                            <Field label="공개 링크">
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <input readOnly value={result.url} style={{ ...input, flex: 1 }} />
                                    <button type="button" onClick={() => copy(result.url, 'url')} style={copyBtn}>{copied === 'url' ? '복사됨' : '복사'}</button>
                                </div>
                            </Field>
                            <Field label="카카오톡 안내문">
                                <textarea readOnly value={result.kakao} rows={10} style={{ ...input, height: 'auto', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />
                            </Field>
                            <button type="button" onClick={() => copy(result.kakao, 'kakao')} style={{ ...copyBtn, width: '100%', height: 40 }}>{copied === 'kakao' ? '안내문 복사됨' : '카카오톡 안내문 복사'}</button>
                            <button type="button" onClick={onCreated} style={{ width: '100%', height: 42, borderRadius: 11, border: '1px solid #DCE8F5', background: '#FFFFFF', color: '#0E7C76', fontSize: 12.5, fontWeight: 900, cursor: 'pointer' }}>완료</button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <p style={{ margin: '0 0 5px', fontSize: 11, fontWeight: 800, color: '#475569' }}>{label}</p>
            {children}
        </div>
    );
}
function Mini({ label, v }: { label: string; v: string }) {
    return (
        <span style={{ flex: 1, minWidth: 70, background: '#F4F7FB', borderRadius: 10, border: '1px solid #E3ECF6', padding: '7px 9px' }}>
            <span style={{ display: 'block', fontSize: 9.5, fontWeight: 800, color: '#94A3B8' }}>{label}</span>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 900, color: NAVY, whiteSpace: 'nowrap' }}>{v}</span>
        </span>
    );
}

function toLocalInput(d: Date): string {
    if (Number.isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function localToISO(v: string): string | null {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// iOS Safari: position:fixed + inset:0 는 '레이아웃 뷰포트'(주소창 숨김 기준의 큰 높이)를 채운다.
// 그 바닥에 alignItems:flex-end 로 시트를 붙이면, 실제로 보이는 영역(주소창/툴바 표시 시)보다
// 아래(브라우저 툴바 뒤)에 시트 하단이 위치해 마지막 '공지 생성' 버튼이 화면 밖으로 밀린다.
// height:100dvh(+top:0, bottom 제거)로 컨테이너를 '동적(가시) 뷰포트'에 맞춰, 시트 하단이 항상
// 보이는 바닥에 붙도록 한다. z-index 는 변경하지 않는다.
const overlay: React.CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, height: '100dvh', zIndex: 1000, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden', overscrollBehavior: 'none', touchAction: 'none' };
const sheet: React.CSSProperties = { width: '100%', maxWidth: 480, maxHeight: '92dvh', background: '#F4F7FB', borderTopLeftRadius: 22, borderTopRightRadius: 22, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 -10px 40px rgba(15,45,85,0.25)' };
// flexShrink:0 — 세로 flex 컬럼에서 헤더는 절대 줄지 않게 고정하고, 스크롤은 body 만 담당한다.
const header: React.CSSProperties = { flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px', background: '#FFFFFF', borderBottom: '1px solid #E3ECF6' };
// 하단 패딩에 safe-area 포함: 바텀시트가 뷰포트 바닥에 붙어 있어, 마지막 요소(공지 생성 버튼)가
// 홈 인디케이터(safe-area-inset-bottom)에 가려지지 않도록 스크롤 영역 자체에 여백을 확보한다.
const body: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', padding: '16px 16px calc(24px + env(safe-area-inset-bottom)) 16px', display: 'flex', flexDirection: 'column', gap: 12 };
const closeBtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 10, border: '1px solid #DCE8F5', background: '#FFFFFF', color: '#56729A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
const input: React.CSSProperties = { width: '100%', height: 40, borderRadius: 10, border: '1px solid #DCE8F5', background: '#FFFFFF', padding: '0 12px', fontSize: 13, fontWeight: 600, color: NAVY, boxSizing: 'border-box', outline: 'none' };
const copyBtn: React.CSSProperties = { padding: '0 14px', height: 40, borderRadius: 10, border: 'none', background: '#0F9F98', color: '#FFFFFF', fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' };
