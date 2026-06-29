'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Lock, Plus, Trash2, Check } from 'lucide-react';
import { useTennisLogAccess } from '@/hooks/useTennisLogAccess';

// Cool Premium Light 토큰
const NAVY = '#0F1B33';
const TEAL = '#0E7C76';
const INK = '#0F172A';
const SUB = '#64748B';
const FAINT = '#94A3B8';
const CARD_BORDER = 'rgba(0,0,0,0.06)';
const FIELD_BORDER = 'rgba(15,27,51,0.14)';

const RESULT_OPTIONS = ['우승', '준우승', '4강', '8강', '예선'] as const;

const DETAIL_ROWS = [
  { key: 'matches', label: '경기별 결과', hint: '라운드별 상대 · 점수' },
  { key: 'condition', label: '컨디션 / 상세 회고', hint: '' },
  { key: 'review', label: '잘된 점 · 아쉬운 점 · 개선 목표', hint: '' },
  { key: 'partner', label: '파트너 호흡 메모', hint: '' },
] as const;

type DetailKey = (typeof DETAIL_ROWS)[number]['key'];

function todayString(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function TournamentLogForm({ mode }: { mode: 'new' | 'edit' }) {
  const router = useRouter();
  const access = useTennisLogAccess();
  const [isMounted, setIsMounted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 입력 상태 — 향후 실제 저장 바인딩 대비. 현재는 로컬 상태만 유지(DB 저장 미구현).
  const [date, setDate] = useState<string>(todayString());
  const [name, setName] = useState('');
  const [event, setEvent] = useState('');
  const [partner, setPartner] = useState('');
  const [result, setResult] = useState<string>('');
  const [oneLine, setOneLine] = useState('');
  const [details, setDetails] = useState<Record<DetailKey, string>>({
    matches: '',
    condition: '',
    review: '',
    partner: '',
  });
  const [openRows, setOpenRows] = useState<Record<DetailKey, boolean>>({
    matches: false,
    condition: false,
    review: false,
    partner: false,
  });

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // 접근 권한 없는 경우 — 미로그인은 '/', 잠금(준회원·게스트·미연결)은 홈 가드(/tennis-log)로 위임.
  useEffect(() => {
    if (access === 'unauthenticated') router.replace('/');
    else if (access === 'locked') router.replace('/tennis-log');
  }, [access, router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // 조회 중/권한 없음 — 폼을 노출하지 않음(안전한 기본값).
  if (!isMounted || access !== 'allowed') return null;

  const handleSave = () => {
    if (!date || !name.trim() || !event.trim() || !partner.trim() || !result) {
      setToast('필수 항목(대회 날짜·대회명·종목·파트너·최종 성적)을 입력해 주세요.');
      return;
    }
    // 실제 DB 저장은 다음 단계에서 구현. 현재는 안내만.
    setToast('저장 기능은 다음 단계에서 제공됩니다.');
  };

  const handleDelete = () => {
    setToast('삭제 기능은 다음 단계에서 제공됩니다.');
  };

  const toggleRow = (key: DetailKey) =>
    setOpenRows((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div style={{ width: '100%', maxWidth: 450, margin: '0 auto', boxSizing: 'border-box' }}>
      {/* 상단 헤더 바 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '12px 14px',
          borderBottom: `1px solid ${CARD_BORDER}`,
          backgroundColor: '#FFFFFF',
        }}
      >
        <button
          type="button"
          onClick={() => router.push('/tennis-log')}
          aria-label="뒤로"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: NAVY,
            minWidth: 0,
          }}
        >
          <ChevronLeft size={20} strokeWidth={2.2} />
          <span style={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap' }}>
            {mode === 'edit' ? '대회 기록 수정' : '대회 기록 추가'}
          </span>
        </button>
        <span
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 9px',
            borderRadius: 999,
            border: `1px solid ${FIELD_BORDER}`,
            color: SUB,
            fontSize: 10.5,
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          <Lock size={11} strokeWidth={2.4} />
          나만 보기
        </span>
      </div>

      {/* 본문 — 하단 저장 바 높이만큼 여백 확보 */}
      <div
        style={{
          padding: '14px 16px',
          paddingBottom: 'calc(104px + env(safe-area-inset-bottom))',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* 안내 배너 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 11,
            backgroundColor: 'rgba(14,124,118,0.08)',
            border: '1px solid rgba(14,124,118,0.16)',
            color: '#0E6B66',
            fontSize: 11.5,
            fontWeight: 600,
            lineHeight: 1.5,
            wordBreak: 'keep-all',
          }}
        >
          <Check size={14} strokeWidth={2.6} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>필수 항목만 채워도 기록할 수 있어요. 나머지는 나중에 천천히 채워도 괜찮아요.</span>
        </div>

        {/* 기본 정보 */}
        <FieldGroupTitle required>기본 정보</FieldGroupTitle>

        <Field label="대회 날짜" required>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={inputStyle}
          />
        </Field>

        <Field label="대회명" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 제9회 충청 오픈 테니스"
            style={inputStyle}
          />
        </Field>

        {/* 종목 / 파트너 — 360px에서도 2열 유지, 텍스트 잘림 방지 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="종목" required>
            <input
              type="text"
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              placeholder="예: 남자 복식"
              style={inputStyle}
            />
          </Field>
          <Field label="파트너" required>
            <input
              type="text"
              value={partner}
              onChange={(e) => setPartner(e.target.value)}
              placeholder="파트너 이름"
              style={inputStyle}
            />
          </Field>
        </div>

        {/* 최종 성적 — flex-wrap 허용(글자 확대 시에도 overflow 없음) */}
        <Field label="최종 성적" required>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {RESULT_OPTIONS.map((opt) => {
              const selected = result === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setResult(selected ? '' : opt)}
                  style={{
                    flex: '0 0 auto',
                    padding: '9px 16px',
                    borderRadius: 999,
                    border: selected ? `1px solid ${TEAL}` : `1px solid ${FIELD_BORDER}`,
                    backgroundColor: selected ? TEAL : '#FFFFFF',
                    color: selected ? '#FFFFFF' : SUB,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="한 줄 회고">
          <textarea
            value={oneLine}
            onChange={(e) => setOneLine(e.target.value)}
            placeholder="예: 8강부터 흐름이 좋았고 결승에서 첫 게임 리듬을 못 잡았다."
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 60, lineHeight: 1.5 }}
          />
        </Field>

        {/* 자세히 기록 (선택) */}
        <FieldGroupTitle>자세히 기록 <span style={{ color: FAINT, fontWeight: 600 }}>(선택)</span></FieldGroupTitle>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {DETAIL_ROWS.map((row) => {
            const open = openRows[row.key];
            return (
              <div
                key={row.key}
                style={{
                  backgroundColor: '#FFFFFF',
                  border: `1px solid ${CARD_BORDER}`,
                  borderRadius: 12,
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleRow(row.key)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '13px 14px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <Plus
                    size={16}
                    strokeWidth={2.4}
                    style={{
                      flexShrink: 0,
                      color: TEAL,
                      transition: 'transform 0.18s',
                      transform: open ? 'rotate(45deg)' : 'none',
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.label}
                    </span>
                    {row.hint && (
                      <span style={{ fontSize: 11, fontWeight: 500, color: FAINT, marginTop: 1 }}>{row.hint}</span>
                    )}
                  </span>
                  <ChevronRight
                    size={15}
                    strokeWidth={2.2}
                    style={{ flexShrink: 0, color: '#CBD5E1', transition: 'transform 0.18s', transform: open ? 'rotate(90deg)' : 'none' }}
                  />
                </button>
                {open && (
                  <div style={{ padding: '0 14px 14px' }}>
                    <textarea
                      value={details[row.key]}
                      onChange={(e) => setDetails((prev) => ({ ...prev, [row.key]: e.target.value }))}
                      rows={3}
                      placeholder="자유롭게 기록해 보세요."
                      style={{ ...inputStyle, resize: 'vertical', minHeight: 76, lineHeight: 1.5 }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 하단 저장 바 — safe-area 적용. 신규(new)에는 삭제 버튼 없음, 수정(edit)에만 표시. */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 600,
          width: '100%',
          maxWidth: 450,
          boxSizing: 'border-box',
          backgroundColor: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderTop: `1px solid ${CARD_BORDER}`,
          boxShadow: '0 -2px 16px rgba(0,0,0,0.06)',
          padding: '12px 16px',
          paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {mode === 'edit' && (
          <button
            type="button"
            onClick={handleDelete}
            aria-label="기록 삭제"
            style={{
              flexShrink: 0,
              width: 52,
              height: 50,
              borderRadius: 12,
              border: '1px solid rgba(220,38,38,0.28)',
              backgroundColor: '#FFFFFF',
              color: '#DC2626',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Trash2 size={19} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          style={{
            flex: 1,
            height: 50,
            borderRadius: 12,
            border: 'none',
            backgroundColor: NAVY,
            color: '#FFFFFF',
            fontSize: 15,
            fontWeight: 800,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
          }}
        >
          <Check size={18} strokeWidth={2.6} />
          저장
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 'calc(86px + env(safe-area-inset-bottom))',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2000,
            width: '92%',
            maxWidth: 420,
            backgroundColor: '#0F766E',
            borderRadius: 11,
            padding: '12px 18px',
            textAlign: 'center',
            fontSize: 13,
            fontWeight: 700,
            color: '#FFFFFF',
            boxShadow: '0 6px 24px rgba(13,148,136,0.28)',
            wordBreak: 'keep-all',
            lineHeight: 1.5,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ── 보조 ────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '11px 13px',
  borderRadius: 11,
  border: `1px solid ${FIELD_BORDER}`,
  backgroundColor: '#FFFFFF',
  fontSize: 14,
  fontWeight: 600,
  color: INK,
  outline: 'none',
  fontFamily: 'inherit',
};

function FieldGroupTitle({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <p style={{ margin: '2px 0 -4px', fontSize: 13, fontWeight: 800, color: NAVY, display: 'flex', alignItems: 'center', gap: 6 }}>
      {children}
      {required && (
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            letterSpacing: '0.04em',
            color: '#DC2626',
            backgroundColor: 'rgba(220,38,38,0.08)',
            border: '1px solid rgba(220,38,38,0.20)',
            borderRadius: 5,
            padding: '1px 5px',
          }}
        >
          필수
        </span>
      )}
    </p>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: SUB,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
        {required && <span style={{ color: '#DC2626' }}>*</span>}
      </span>
      {children}
    </label>
  );
}
