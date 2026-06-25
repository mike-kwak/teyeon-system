'use client';

import React from 'react';
import { Link2, MessageSquare, Check, Power, Trash2 } from 'lucide-react';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import {
    publicNoticeUrl,
    buildKakaoNoticeText,
    formatReferenceDot,
    formatSeoulDateTime,
    type FinancePublicNotice,
} from '@/lib/finance/noticesService';

/**
 * 관리자 공지 목록의 한 장.
 *   정보 순서: 대상 기간 → 활성/비활성 → 기준일 → 생성 시각(KST) → 완료/일부/미납/남은 → 액션.
 *   액션: 활성 = 링크/안내문/비활성화, 비활성 = 링크/안내문/삭제(비활성만 삭제 가능).
 */
export default function FinanceNoticeCard({
    notice,
    onDeactivate,
    onDelete,
    busy,
}: {
    notice: FinancePublicNotice;
    onDeactivate: (id: string) => void;
    onDelete: (id: string) => void;
    busy?: boolean;
}) {
    const [copied, setCopied] = React.useState<'link' | 'kakao' | null>(null);
    const url = publicNoticeUrl(notice.token);

    const copy = async (text: string, kind: 'link' | 'kakao') => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(kind);
            setTimeout(() => setCopied(null), 1600);
        } catch {
            window.prompt('복사할 내용을 길게 눌러 복사해 주세요.', text);
        }
    };

    return (
        <section style={{
            backgroundColor: '#FFFFFF', borderRadius: 14,
            border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            padding: 13, opacity: notice.is_active ? 1 : 0.78,
        }}>
            {/* 제목/대상 기간 + 상태 */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 13, fontWeight: 900, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {notice.target_year}년 {notice.target_month}월 회비
                </p>
                <span style={{
                    flexShrink: 0, fontSize: 10, fontWeight: 800,
                    paddingTop: 3, paddingBottom: 3, paddingLeft: 8, paddingRight: 8, borderRadius: 999,
                    backgroundColor: notice.is_active ? 'rgba(15,159,152,0.12)' : 'rgba(100,116,139,0.12)',
                    color: notice.is_active ? '#0E7C76' : '#64748B',
                    border: `1px solid ${notice.is_active ? 'rgba(15,159,152,0.26)' : 'rgba(100,116,139,0.22)'}`,
                }}>
                    {notice.is_active ? '활성' : '비활성'}
                </span>
            </div>

            {/* 기준일 / 생성 시각 — 라벨로 명확히 분리 */}
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '2px 14px' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>
                    <span style={{ color: '#94A3B8', fontWeight: 700 }}>기준일 </span>
                    <span style={{ color: '#0E7C76', fontWeight: 800 }}>{formatReferenceDot(notice.reference_date)}</span>
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>
                    <span style={{ color: '#94A3B8', fontWeight: 700 }}>생성 </span>
                    {formatSeoulDateTime(notice.created_at)}
                </span>
            </div>

            {/* 완료 / 일부 / 미납 / 남은 금액 */}
            <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11.5, fontWeight: 800, color: '#475569' }}>
                <span style={{ color: '#0E7C76' }}>완료 {notice.paid_count}명</span>
                <span style={{ color: '#92400E' }}>일부 {notice.partial_count}명</span>
                <span style={{ color: '#B91C1C' }}>미납 {notice.unpaid_count}명</span>
                <span>남은 {formatWon(notice.total_unpaid_amount)}</span>
            </div>

            {/* 액션 */}
            <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => copy(url, 'link')} style={miniBtn}>
                    {copied === 'link' ? <Check size={13} /> : <Link2 size={13} />}
                    {copied === 'link' ? '복사됨' : '링크'}
                </button>
                <button type="button" onClick={() => copy(buildKakaoNoticeText({ referenceDate: notice.reference_date, url }), 'kakao')} style={miniBtn}>
                    {copied === 'kakao' ? <Check size={13} /> : <MessageSquare size={13} />}
                    {copied === 'kakao' ? '복사됨' : '안내문'}
                </button>
                {notice.is_active ? (
                    <button
                        type="button"
                        onClick={() => {
                            if (window.confirm('이 공지 링크를 비활성화할까요?\n비활성화하면 공개 URL 접근이 차단됩니다.')) onDeactivate(notice.id);
                        }}
                        disabled={busy}
                        style={{ ...miniBtn, marginLeft: 'auto', color: '#B45309', borderColor: 'rgba(180,83,9,0.30)' }}
                    >
                        <Power size={13} />
                        비활성화
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => {
                            if (window.confirm('이 재무 공지 링크를 삭제하시겠습니까? 삭제 후에는 기존 링크로 다시 확인할 수 없습니다.')) onDelete(notice.id);
                        }}
                        disabled={busy}
                        style={{ ...miniBtn, marginLeft: 'auto', color: '#B91C1C', borderColor: 'rgba(220,38,38,0.30)' }}
                    >
                        <Trash2 size={13} />
                        삭제
                    </button>
                )}
            </div>
        </section>
    );
}

const miniBtn: React.CSSProperties = {
    height: 32, paddingLeft: 10, paddingRight: 10, borderRadius: 8,
    border: '1px solid rgba(15,23,42,0.12)', backgroundColor: '#FFFFFF', color: '#334155',
    fontSize: 11.5, fontWeight: 800, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
};
