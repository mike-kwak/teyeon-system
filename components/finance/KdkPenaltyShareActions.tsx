'use client';

// KDK 누적 벌금 현황 — 공유 액션.
//   V2: 메인 '이미지 리포트'(미리보기 모달 → 이미지 공유·저장·복사) + 보조 '텍스트 복사'(V1 텍스트).
//   - 내용은 버튼을 누른 순간 getContent() 로 스냅샷한다(현재 탭·기간의 최신 데이터). getContent 가 null 이면 비활성
//     (로딩·새로고침·오류·기간 미선택 → 이전 기간 데이터 공유 방지). 버튼 자체는 항상 표시한다.
//   - 외부 SDK · 자동 발송 · 공개 링크 · 외부 업로드 없음.

import React from 'react';
import { Copy, FileImage } from 'lucide-react';
import { formatPenaltyShareText, type PenaltyShareContent } from '@/lib/finance/kdkPenaltyHistoryShare';
import { NAVY, TEAL_DARK } from './KdkPenaltyHistoryUI';
import { COPY_OK, copyText, KdkPenaltyReportModal, PRIVACY_NOTE } from './KdkPenaltyReportModal';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

const COPY_FAIL = '복사하지 못했습니다. 브라우저의 클립보드 권한을 확인한 뒤 다시 시도해 주세요.';

export function KdkPenaltyShareActions({ getContent }: { getContent: (() => PenaltyShareContent) | null }) {
    const [notice, setNotice] = React.useState<Notice>(null);
    const [busy, setBusy] = React.useState(false);
    const [report, setReport] = React.useState<PenaltyShareContent | null>(null);
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const disabled = !getContent || busy;

    React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    // 데이터가 바뀌어(기간·탭·새로고침) 버튼이 비활성화되면 이전 안내를 지운다.
    React.useEffect(() => { if (!getContent) setNotice(null); }, [getContent]);

    const show = (n: Notice) => {
        setNotice(n);
        if (timer.current) clearTimeout(timer.current);
        if (n) timer.current = setTimeout(() => setNotice(null), 3500);
    };

    const onCopy = async () => {
        if (!getContent) return;
        const text = formatPenaltyShareText(getContent());
        setBusy(true);
        const ok = await copyText(text);
        setBusy(false);
        show(ok ? { kind: 'ok', text: COPY_OK } : { kind: 'error', text: COPY_FAIL });
    };

    const onReport = () => {
        if (!getContent || report) return; // 중복 열기 방지
        show(null);
        setReport(getContent());
    };
    const closeReport = React.useCallback(() => setReport(null), []);

    return (
        <section aria-label="누적 벌금 현황 공유" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.35fr)', gap: 8 }}>
                <ActionButton onClick={onCopy} disabled={disabled} icon={<Copy size={15} />} label="텍스트 복사" />
                <ActionButton onClick={onReport} disabled={disabled || !!report} icon={<FileImage size={16} />} label="이미지 리포트" primary />
            </div>
            <p style={{ margin: '0 2px', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                {PRIVACY_NOTE}
            </p>
            <p role="status" aria-live="polite" style={{
                margin: notice ? '0 2px' : 0, fontSize: 11.5, fontWeight: 800, lineHeight: 1.5, wordBreak: 'keep-all',
                color: notice?.kind === 'error' ? '#B91C1C' : TEAL_DARK, minHeight: 0,
            }}>{notice?.text ?? ''}</p>
            {report && <KdkPenaltyReportModal content={report} onClose={closeReport} />}
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
