'use client';

// 공개 공지(월회비·KDK 벌금)용 입금 계좌 카드 — 표시 + 계좌번호 복사.
//   - Cool Premium Light / 엑셀형 화면과 어울리는 작은 카드(과한 색/크기 지양).
//   - 계좌번호는 줄바꿈 금지, 좌우 잘림 금지, 복사 버튼 터치 영역 확보.
//   - 복사는 프로젝트 공용 copyTextSafe(Clipboard API + execCommand fallback) 재사용.
//   - 복사 값은 하이픈 없는 숫자(accountNumberCopy)만.

import React from 'react';
import { Copy, Check } from 'lucide-react';
import { copyTextSafe } from '@/lib/clubScheduleShare';
import type { FinancePaymentAccountSnapshot } from '@/lib/finance/paymentAccount';

export default function PaymentAccountCard({
    account,
    label,
}: {
    account: FinancePaymentAccountSnapshot;
    label: string;   // '회비 입금 계좌' | '벌금 입금 계좌'
}) {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = async () => {
        const ok = await copyTextSafe(account.accountNumberCopy);
        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } else {
            window.prompt('계좌번호를 길게 눌러 복사해 주세요.', account.accountNumberCopy);
        }
    };

    return (
        <section style={{
            border: '1px solid #E2E8F0', borderRadius: 8,
            backgroundColor: '#F8FAFC', padding: '11px 13px',
        }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em' }}>{label}</p>
            <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: '#64748B', whiteSpace: 'nowrap' }}>{account.bankName}</p>
                    <p style={{ margin: '1px 0 0', fontSize: 15, fontWeight: 900, color: '#0F172A', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>
                        {account.accountNumberDisplay}
                    </p>
                    <p style={{ margin: '1px 0 0', fontSize: 11, fontWeight: 700, color: '#64748B', whiteSpace: 'nowrap' }}>예금주 {account.accountHolder}</p>
                </div>
                <button
                    type="button"
                    onClick={handleCopy}
                    style={{
                        flexShrink: 0, minHeight: 40, padding: '0 12px',
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        borderRadius: 8, border: `1px solid ${copied ? '#A7E3C9' : '#CBD5E1'}`,
                        backgroundColor: copied ? '#E7F6EF' : '#FFFFFF',
                        color: copied ? '#047857' : '#334155',
                        fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? '복사됨' : '계좌번호 복사'}
                </button>
            </div>
            {copied && (
                <p style={{ margin: '7px 0 0', fontSize: 11, fontWeight: 700, color: '#047857' }}>계좌번호를 복사했습니다.</p>
            )}
        </section>
    );
}
