'use client';

import React from 'react';
import { Plus, X, Save } from 'lucide-react';
import type {
    GuestPassDefaults,
    GuestPassDefaultsInput,
} from '@/lib/guestPassService';

/**
 * Guest Pass 공통 기본값 편집 폼.
 * - CEO/ADMIN 전용. 호출자(page)에서 진입 권한 검사.
 * - 저장은 호출자(page)가 onSave 로 받아 supabase 호출.
 */

interface GuestPassDefaultsEditorProps {
    initial: GuestPassDefaults | null;
    saving: boolean;
    saveError: string | null;
    savedAt: string | null;       // ISO timestamp — 마지막 성공 저장 시각
    onSave: (input: GuestPassDefaultsInput) => void | Promise<void>;
}

const DEFAULT_MATCH_HEADLINE = '당일 대진표 공유 예정';
const DEFAULT_MATCH_BODY = '대진표는 당일 경기이사가 편성한 뒤 앱에 등록되며, 준비가 완료되면 이 페이지에서 확인할 수 있습니다.';

const EMPTY: GuestPassDefaultsInput = {
    defaultFeeAmount: null,
    bankName: null,
    bankAccountNumber: null,
    bankAccountHolderDisplay: null,
    paymentNote: null,
    preparationItems: [],
    arrivalGuideMinutes: 15,
    lateOrAbsentNotice: null,
    kdkStartNotice: null,
    penaltyNotice: null,
    guestPrizeExclusion: null,
    clubIntroName: 'TEYEON',
    clubIntroParagraphs: [],
    contactNotice: null,
    matchStatusHeadline: DEFAULT_MATCH_HEADLINE,
    matchStatusBody: DEFAULT_MATCH_BODY,
};

function defaultsToInput(d: GuestPassDefaults | null): GuestPassDefaultsInput {
    if (!d) return { ...EMPTY };
    return {
        defaultFeeAmount: d.defaultFeeAmount,
        bankName: d.bankName,
        bankAccountNumber: d.bankAccountNumber,
        bankAccountHolderDisplay: d.bankAccountHolderDisplay,
        paymentNote: d.paymentNote,
        preparationItems: [...d.preparationItems],
        arrivalGuideMinutes: d.arrivalGuideMinutes,
        lateOrAbsentNotice: d.lateOrAbsentNotice,
        kdkStartNotice: d.kdkStartNotice,
        penaltyNotice: d.penaltyNotice,
        guestPrizeExclusion: d.guestPrizeExclusion,
        clubIntroName: d.clubIntroName,
        clubIntroParagraphs: [...d.clubIntroParagraphs],
        contactNotice: d.contactNotice,
        matchStatusHeadline: d.matchStatusHeadline || DEFAULT_MATCH_HEADLINE,
        matchStatusBody: d.matchStatusBody || DEFAULT_MATCH_BODY,
    };
}

export default function GuestPassDefaultsEditor({
    initial, saving, saveError, savedAt, onSave,
}: GuestPassDefaultsEditorProps) {
    const [form, setForm] = React.useState<GuestPassDefaultsInput>(() => defaultsToInput(initial));

    // initial이 비동기로 도착하는 경우 한 번만 hydrate.
    const hydratedRef = React.useRef(false);
    React.useEffect(() => {
        if (!hydratedRef.current && initial) {
            setForm(defaultsToInput(initial));
            hydratedRef.current = true;
        }
    }, [initial]);

    const update = <K extends keyof GuestPassDefaultsInput>(
        key: K,
        value: GuestPassDefaultsInput[K],
    ) => setForm((p) => ({ ...p, [key]: value }));

    const addItem = () => update('preparationItems', [...form.preparationItems, '']);
    const setItem = (idx: number, value: string) => {
        const next = [...form.preparationItems];
        next[idx] = value;
        update('preparationItems', next);
    };
    const removeItem = (idx: number) =>
        update('preparationItems', form.preparationItems.filter((_, i) => i !== idx));

    const addParagraph = () => update('clubIntroParagraphs', [...form.clubIntroParagraphs, '']);
    const setParagraph = (idx: number, value: string) => {
        const next = [...form.clubIntroParagraphs];
        next[idx] = value;
        update('clubIntroParagraphs', next);
    };
    const removeParagraph = (idx: number) =>
        update('clubIntroParagraphs', form.clubIntroParagraphs.filter((_, i) => i !== idx));

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const cleaned: GuestPassDefaultsInput = {
            ...form,
            // 빈 문자열은 null 로 저장. 배열 항목 중 빈 문자열은 제거.
            bankName: form.bankName?.trim() || null,
            bankAccountNumber: form.bankAccountNumber?.trim() || null,
            bankAccountHolderDisplay: form.bankAccountHolderDisplay?.trim() || null,
            paymentNote: form.paymentNote?.trim() || null,
            lateOrAbsentNotice: form.lateOrAbsentNotice?.trim() || null,
            kdkStartNotice: form.kdkStartNotice?.trim() || null,
            penaltyNotice: form.penaltyNotice?.trim() || null,
            guestPrizeExclusion: form.guestPrizeExclusion?.trim() || null,
            contactNotice: form.contactNotice?.trim() || null,
            preparationItems: form.preparationItems.map((s) => s.trim()).filter(Boolean),
            clubIntroParagraphs: form.clubIntroParagraphs.map((s) => s.trim()).filter(Boolean),
            clubIntroName: form.clubIntroName.trim() || 'TEYEON',
            defaultFeeAmount: form.defaultFeeAmount && form.defaultFeeAmount > 0 ? form.defaultFeeAmount : null,
            arrivalGuideMinutes: form.arrivalGuideMinutes > 0 ? form.arrivalGuideMinutes : 15,
            // 비어있으면 기본 문구로 복원 — 공개 화면이 비지 않게.
            matchStatusHeadline: form.matchStatusHeadline.trim() || DEFAULT_MATCH_HEADLINE,
            matchStatusBody: form.matchStatusBody.trim() || DEFAULT_MATCH_BODY,
        };
        onSave(cleaned);
    };

    return (
        <form
            onSubmit={handleSubmit}
            style={{
                display: 'flex', flexDirection: 'column', gap: 14,
                width: '100%', boxSizing: 'border-box',
            }}
        >
            {/* ── 게스트비 / 계좌 ───────────────────────────────────────── */}
            <Card title="게스트비 / 계좌">
                <Field label="기본 게스트비 (원)">
                    <input
                        type="number"
                        inputMode="numeric"
                        value={form.defaultFeeAmount ?? ''}
                        onChange={(e) => update('defaultFeeAmount', e.target.value ? Number(e.target.value) : null)}
                        placeholder="10000"
                        style={inputStyle}
                    />
                </Field>
                <Field label="은행명">
                    <input
                        value={form.bankName ?? ''}
                        onChange={(e) => update('bankName', e.target.value)}
                        placeholder="카카오뱅크"
                        style={inputStyle}
                    />
                </Field>
                <Field label="계좌번호">
                    <input
                        value={form.bankAccountNumber ?? ''}
                        onChange={(e) => update('bankAccountNumber', e.target.value)}
                        placeholder="3333-00-0000000"
                        style={inputStyle}
                    />
                </Field>
                <Field label="공개용 예금주">
                    <input
                        value={form.bankAccountHolderDisplay ?? ''}
                        onChange={(e) => update('bankAccountHolderDisplay', e.target.value)}
                        placeholder="예: 곽민*"
                        style={inputStyle}
                    />
                    <Hint>
                        Guest Pass 공개 화면에 그대로 노출되는 표시명입니다. 실명 입력을 권하지 않습니다.
                    </Hint>
                </Field>
                <Field label="입금 안내">
                    <textarea
                        value={form.paymentNote ?? ''}
                        onChange={(e) => update('paymentNote', e.target.value)}
                        placeholder="경기 시작 전 입금 부탁드립니다."
                        rows={2}
                        style={textareaStyle}
                    />
                </Field>
            </Card>

            {/* ── KDK 경기 안내 ────────────────────────────────────────── */}
            <Card title="KDK 경기 안내 (공통)">
                <Field label="경기 안내 상태 문구">
                    <input
                        value={form.matchStatusHeadline}
                        onChange={(e) => update('matchStatusHeadline', e.target.value)}
                        placeholder={DEFAULT_MATCH_HEADLINE}
                        style={inputStyle}
                    />
                </Field>
                <Field label="경기 안내 상세 문구">
                    <textarea
                        value={form.matchStatusBody}
                        onChange={(e) => update('matchStatusBody', e.target.value)}
                        placeholder={DEFAULT_MATCH_BODY}
                        rows={3}
                        style={textareaStyle}
                    />
                    <Hint>정모별로 별도 문구가 필요하면 정모 상세의 Guest Pass 설정에서 override 합니다.</Hint>
                </Field>
            </Card>

            {/* ── 준비사항 ──────────────────────────────────────────────── */}
            <Card title="준비사항">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {form.preparationItems.map((it, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: 6 }}>
                            <input
                                value={it}
                                onChange={(e) => setItem(idx, e.target.value)}
                                placeholder="예: 테니스 라켓"
                                style={{ ...inputStyle, flex: 1 }}
                            />
                            <button
                                type="button"
                                onClick={() => removeItem(idx)}
                                aria-label="항목 삭제"
                                style={ghostButton}
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ))}
                    <button type="button" onClick={addItem} style={addButton}>
                        <Plus size={13} /> 항목 추가
                    </button>
                </div>
                <Field label="권장 도착 시간 (분 전)">
                    <input
                        type="number"
                        inputMode="numeric"
                        value={form.arrivalGuideMinutes}
                        onChange={(e) => update('arrivalGuideMinutes', Number(e.target.value) || 15)}
                        style={{ ...inputStyle, width: 100 }}
                    />
                </Field>
                <Field label="지각·불참 안내">
                    <textarea
                        value={form.lateOrAbsentNotice ?? ''}
                        onChange={(e) => update('lateOrAbsentNotice', e.target.value)}
                        placeholder="지각 또는 불참 시 초대한 회원 또는 운영진에게 사전 연락 부탁드립니다."
                        rows={2}
                        style={textareaStyle}
                    />
                </Field>
            </Card>

            {/* ── 운영 규칙 ─────────────────────────────────────────────── */}
            <Card title="운영 규칙 (GUEST NOTE)">
                <Field label="KDK 1:1 시작 안내">
                    <textarea
                        value={form.kdkStartNotice ?? ''}
                        onChange={(e) => update('kdkStartNotice', e.target.value)}
                        placeholder="KDK 경기는 기본 1:1 스코어에서 시작합니다."
                        rows={2}
                        style={textareaStyle}
                    />
                </Field>
                <Field label="벌금 규칙">
                    <textarea
                        value={form.penaltyNotice ?? ''}
                        onChange={(e) => update('penaltyNotice', e.target.value)}
                        placeholder="운영 기준에 따라 벌금이 발생할 수 있습니다."
                        rows={2}
                        style={textareaStyle}
                    />
                </Field>
                <Field label="게스트 상금 제외">
                    <textarea
                        value={form.guestPrizeExclusion ?? ''}
                        onChange={(e) => update('guestPrizeExclusion', e.target.value)}
                        placeholder="게스트도 당일 순위 집계에는 포함되지만, 1등 시에도 상금 지급 대상은 아닙니다."
                        rows={2}
                        style={textareaStyle}
                    />
                </Field>
            </Card>

            {/* ── 클럽 소개 ─────────────────────────────────────────────── */}
            <Card title="TEYEON 클럽 소개">
                <Field label="클럽명">
                    <input
                        value={form.clubIntroName}
                        onChange={(e) => update('clubIntroName', e.target.value)}
                        placeholder="TEYEON"
                        style={inputStyle}
                    />
                </Field>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {form.clubIntroParagraphs.map((p, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <textarea
                                value={p}
                                onChange={(e) => setParagraph(idx, e.target.value)}
                                placeholder="2~3 문단으로 클럽을 소개해 주세요."
                                rows={2}
                                style={{ ...textareaStyle, flex: 1 }}
                            />
                            <button
                                type="button"
                                onClick={() => removeParagraph(idx)}
                                aria-label="단락 삭제"
                                style={ghostButton}
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ))}
                    <button type="button" onClick={addParagraph} style={addButton}>
                        <Plus size={13} /> 단락 추가
                    </button>
                </div>
            </Card>

            {/* ── 문의 안내 ─────────────────────────────────────────────── */}
            <Card title="문의 안내">
                <Field label="문의 한 줄">
                    <textarea
                        value={form.contactNotice ?? ''}
                        onChange={(e) => update('contactNotice', e.target.value)}
                        placeholder="문의사항은 초대한 회원 또는 TEYEON 운영진에게 부탁드립니다."
                        rows={2}
                        style={textareaStyle}
                    />
                </Field>
            </Card>

            {/* ── 저장 ──────────────────────────────────────────────────── */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end',
                paddingTop: 4,
            }}>
                {saveError && (
                    <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: '#B91C1C' }}>
                        {saveError}
                    </span>
                )}
                {savedAt && !saveError && !saving && (
                    <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: '#0E7C5C' }}>
                        저장됨
                    </span>
                )}
                <button
                    type="submit"
                    disabled={saving}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        height: 38, paddingLeft: 16, paddingRight: 16,
                        borderRadius: 10,
                        backgroundColor: saving ? '#CBD5E1' : '#0F9F98',
                        color: '#FFFFFF', border: 'none',
                        fontSize: 12.5, fontWeight: 800,
                        cursor: saving ? 'wait' : 'pointer',
                        WebkitTapHighlightColor: 'transparent',
                    }}
                >
                    <Save size={13} />
                    {saving ? '저장 중...' : '저장'}
                </button>
            </div>
        </form>
    );
}

// ── Sub components ──────────────────────────────────────────────────────────

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section
        style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 14,
            border: '1px solid rgba(0,0,0,0.06)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            paddingTop: 14, paddingRight: 14, paddingBottom: 14, paddingLeft: 14,
            display: 'flex', flexDirection: 'column', gap: 10,
        }}
    >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em' }}>
            {title}
        </h3>
        {children}
    </section>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>{label}</span>
        {children}
    </label>
);

const Hint = ({ children }: { children: React.ReactNode }) => (
    <span style={{ fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.5 }}>
        {children}
    </span>
);

const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    height: 36,
    paddingLeft: 10, paddingRight: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,23,42,0.10)',
    fontSize: 12.5, fontWeight: 600, color: '#0F172A',
    backgroundColor: '#FFFFFF',
    fontFamily: 'inherit',
    outline: 'none',
};

const textareaStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,23,42,0.10)',
    fontSize: 12.5, fontWeight: 600, color: '#0F172A',
    backgroundColor: '#FFFFFF',
    fontFamily: 'inherit',
    outline: 'none',
    resize: 'vertical',
    minHeight: 56,
};

const ghostButton: React.CSSProperties = {
    width: 32, height: 36,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 8,
    border: '1px solid rgba(15,23,42,0.10)',
    backgroundColor: '#FFFFFF', color: '#64748B',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
};

const addButton: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    height: 30, paddingLeft: 10, paddingRight: 10,
    borderRadius: 8,
    border: '1px dashed rgba(15,159,152,0.40)',
    backgroundColor: 'rgba(15,159,152,0.04)',
    color: '#0E7C76',
    fontSize: 11, fontWeight: 800,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
};
