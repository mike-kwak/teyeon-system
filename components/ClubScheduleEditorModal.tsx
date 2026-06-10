'use client';

import React, { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import {
  ClubSchedule,
  ClubScheduleInput,
  CLUB_SCHEDULE_TYPES,
  ClubScheduleType,
} from '@/lib/clubScheduleData';

// ─── Helper components ────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: 'block',
      marginBottom: 6,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: '#64748B',
    }}>
      {children}
    </span>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        height: 44,
        width: '100%',
        borderRadius: 12,
        border: '1.5px solid rgba(0,0,0,0.12)',
        backgroundColor: '#FFFFFF',
        padding: '0 12px',
        fontSize: 13,
        fontWeight: 600,
        color: '#0F172A',
        outline: 'none',
        boxSizing: 'border-box',
        WebkitTapHighlightColor: 'transparent',
      } as React.CSSProperties}
    />
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
  min = 0,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  min?: number;
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      min={min}
      placeholder={placeholder}
      onChange={(e) => {
        const v = parseInt(e.target.value, 10);
        onChange(isNaN(v) ? undefined : v);
      }}
      style={{
        height: 44,
        width: '100%',
        borderRadius: 12,
        border: '1.5px solid rgba(0,0,0,0.12)',
        backgroundColor: '#FFFFFF',
        padding: '0 12px',
        fontSize: 13,
        fontWeight: 600,
        color: '#0F172A',
        outline: 'none',
        boxSizing: 'border-box',
        WebkitTapHighlightColor: 'transparent',
      } as React.CSSProperties}
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '10px 14px',
        borderRadius: 12,
        border: checked ? '1.5px solid #6366F1' : '1.5px solid rgba(0,0,0,0.10)',
        backgroundColor: checked ? 'rgba(99,102,241,0.06)' : '#FAFAFA',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        transition: 'border-color 0.15s, background-color 0.15s',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: checked ? '#3730A3' : '#475569' }}>
        {label}
      </span>
      <div style={{
        width: 36,
        height: 20,
        borderRadius: 99,
        backgroundColor: checked ? '#6366F1' : 'rgba(0,0,0,0.14)',
        position: 'relative',
        flexShrink: 0,
        transition: 'background-color 0.15s',
      }}>
        <div style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          backgroundColor: '#FFFFFF',
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          boxShadow: '0 1px 3px rgba(0,0,0,0.20)',
          transition: 'left 0.15s',
        }} />
      </div>
    </button>
  );
}

function TypeChips({
  value,
  onChange,
}: {
  value: ClubScheduleType;
  onChange: (v: ClubScheduleType) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
      {CLUB_SCHEDULE_TYPES.map((type) => {
        const active = value === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onChange(type)}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: active ? '1.5px solid #6366F1' : '1px solid rgba(0,0,0,0.12)',
              backgroundColor: active ? 'rgba(99,102,241,0.09)' : '#FFFFFF',
              color: active ? '#3730A3' : '#475569',
              fontSize: 13,
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              WebkitTapHighlightColor: 'transparent',
              transition: 'all 0.14s',
            }}
          >
            {type}
          </button>
        );
      })}
    </div>
  );
}

// ─── Default form values ──────────────────────────────────────────────────────

function toInput(cs?: ClubSchedule | null): ClubScheduleInput {
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return {
    id: cs?.id,
    title: cs?.title ?? '',
    schedule_type: cs?.schedule_type ?? '정모',
    schedule_date: cs?.schedule_date ?? dateKey,
    start_time: cs?.start_time ?? '',
    end_time: cs?.end_time ?? '',
    location: cs?.location ?? '',
    court_count: cs?.court_count ?? 1,
    guest_enabled: cs?.guest_enabled ?? false,
    guest_limit: cs?.guest_limit ?? undefined,
    fee_amount: cs?.fee_amount ?? undefined,
    show_on_main: cs?.show_on_main ?? false,
    memo: cs?.memo ?? '',
  };
}

// ─── Main component ───────────────────────────────────────────────────────────
// 구조: Overlay(fixed, inset:0, overflowY:auto) > Panel(minHeight:100dvh)
// - flex-column body/footer 분리 제거
// - 고정(fixed/sticky) footer 완전 제거
// - overlay 하나가 단독 스크롤 담당
// - 저장/취소 버튼은 폼 맨 아래 일반 block 요소
// - BottomNav(z:500) / GlobalHeader(z:200) → overlay z-index:9000으로 완전히 가림

interface ClubScheduleEditorModalProps {
  schedule: ClubSchedule | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: ClubScheduleInput) => void;
  onDelete: (id: string) => void;
}

export default function ClubScheduleEditorModal({
  schedule,
  isSaving,
  onClose,
  onSave,
  onDelete,
}: ClubScheduleEditorModalProps) {
  const [form, setForm] = useState<ClubScheduleInput>(() => toInput(schedule));

  const set = <K extends keyof ClubScheduleInput>(key: K, value: ClubScheduleInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // guestMode: 'unlimited'=제한 없음(guest_limit null), 'limited'=인원 지정(guest_limit 숫자)
  const [guestMode, setGuestMode] = useState<'unlimited' | 'limited'>(() =>
    schedule?.guest_enabled && schedule?.guest_limit != null ? 'limited' : 'unlimited'
  );

  return (
    // ── Overlay ──────────────────────────────────────────────────────────────
    // 단일 스크롤 컨테이너. fixed + inset:0 + overflowY:auto.
    // z-index:9000 이 BottomNav(500)/GlobalHeader(200) 를 완전히 덮음.
    // Panel 콘텐츠가 길어지면 overlay 전체가 스크롤됨 — 별도 body 분리 없음.
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
        backgroundColor: 'rgba(15,23,42,0.50)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      } as React.CSSProperties}
    >
      {/* ── Panel ─────────────────────────────────────────────────────────── */}
      {/* minHeight:100dvh → 초기 화면을 꽉 채우고, 콘텐츠가 길면 자연스럽게 늘어남 */}
      {/* overflow:visible → Panel 자체는 스크롤하지 않음 (Overlay가 담당)       */}
      <div
        style={{
          width: '100%',
          maxWidth: 600,
          minHeight: '100dvh',
          margin: '0 auto',
          backgroundColor: '#FFFFFF',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 0 60px rgba(0,0,0,0.22)',
        }}
      >
        {/* ── Header ────────────────────────────────────────────────────── */}
        {/* 일반 block — sticky/fixed 없음. 상단 safe-area padding 포함.    */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            borderBottom: '1px solid rgba(0,0,0,0.07)',
            backgroundColor: '#FFFFFF',
            padding: 'calc(env(safe-area-inset-top) + 16px) 16px 14px',
          } as React.CSSProperties}
        >
          <div style={{ minWidth: 0 }}>
            <p style={{
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: '0.20em',
              textTransform: 'uppercase',
              color: '#4338CA',
              margin: 0,
              lineHeight: 1.3,
            }}>
              Club Schedule
            </p>
            <h2 style={{
              fontSize: 18,
              fontWeight: 900,
              letterSpacing: '-0.03em',
              color: '#0F172A',
              margin: '2px 0 0',
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {schedule ? '클럽 일정 수정' : '클럽 일정 등록'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label="닫기"
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: '50%',
              border: '1px solid rgba(0,0,0,0.10)',
              backgroundColor: '#F8FAFC',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#64748B',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Form ──────────────────────────────────────────────────────── */}
        {/* 일반 block flow. 저장/취소 버튼 포함.                            */}
        <div
          style={{
            flex: 1,
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* 일정명 */}
          <div>
            <FieldLabel>일정명</FieldLabel>
            <TextInput
              value={form.title}
              onChange={(v) => set('title', v)}
              placeholder="예: 6월 정기 정모"
            />
          </div>

          {/* 일정 유형 */}
          <div>
            <FieldLabel>일정 유형</FieldLabel>
            <TypeChips
              value={form.schedule_type}
              onChange={(v) => set('schedule_type', v)}
            />
          </div>

          {/* 날짜 */}
          <div>
            <FieldLabel>날짜</FieldLabel>
            <TextInput
              type="date"
              value={form.schedule_date}
              onChange={(v) => set('schedule_date', v)}
            />
          </div>

          {/* 시간 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <FieldLabel>시작 시간</FieldLabel>
              <TextInput
                type="time"
                value={form.start_time ?? ''}
                onChange={(v) => set('start_time', v)}
              />
            </div>
            <div>
              <FieldLabel>종료 시간</FieldLabel>
              <TextInput
                type="time"
                value={form.end_time ?? ''}
                onChange={(v) => set('end_time', v)}
              />
            </div>
          </div>

          {/* 장소 */}
          <div>
            <FieldLabel>장소</FieldLabel>
            <TextInput
              value={form.location ?? ''}
              onChange={(v) => set('location', v)}
              placeholder="예: 문래 테니스장"
            />
          </div>

          {/* 코트 수 */}
          <div>
            <FieldLabel>코트 수</FieldLabel>
            <NumberInput
              value={form.court_count}
              onChange={(v) => set('court_count', v)}
              placeholder="1"
              min={1}
            />
          </div>

          {/* 게스트 모집 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Toggle
              label="게스트 모집"
              checked={form.guest_enabled}
              onChange={(v) => {
                set('guest_enabled', v);
                if (!v) set('guest_limit', undefined); // OFF 시 인원 초기화
              }}
            />
            {form.guest_enabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 4 }}>

                {/* 인원 제한 방식 선택 */}
                <div>
                  <FieldLabel>인원 제한</FieldLabel>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(['unlimited', 'limited'] as const).map((mode) => {
                      const active = guestMode === mode;
                      const label = mode === 'unlimited' ? '제한 없음' : '인원 지정';
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            setGuestMode(mode);
                            if (mode === 'unlimited') set('guest_limit', undefined);
                          }}
                          style={{
                            padding: '8px 16px',
                            borderRadius: 10,
                            border: active ? '1.5px solid #6366F1' : '1px solid rgba(0,0,0,0.12)',
                            backgroundColor: active ? 'rgba(99,102,241,0.09)' : '#FFFFFF',
                            color: active ? '#3730A3' : '#475569',
                            fontSize: 13,
                            fontWeight: active ? 700 : 500,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            WebkitTapHighlightColor: 'transparent',
                            transition: 'all 0.14s',
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 인원 지정 시에만 input 표시 */}
                {guestMode === 'limited' && (
                  <div>
                    <FieldLabel>모집 인원</FieldLabel>
                    <NumberInput
                      value={form.guest_limit}
                      onChange={(v) => set('guest_limit', v)}
                      placeholder="예: 4"
                      min={1}
                    />
                  </div>
                )}

                {/* 게스트비 */}
                <div>
                  <FieldLabel>게스트비 (원)</FieldLabel>
                  <NumberInput
                    value={form.fee_amount}
                    onChange={(v) => set('fee_amount', v)}
                    placeholder="미입력 시 무료"
                    min={0}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 참가비 (게스트 모집 아닐 때) */}
          {!form.guest_enabled && (
            <div>
              <FieldLabel>참가비 (원)</FieldLabel>
              <NumberInput
                value={form.fee_amount}
                onChange={(v) => set('fee_amount', v)}
                placeholder="미입력 시 무료"
                min={0}
              />
            </div>
          )}

          {/* 메인 노출 */}
          <Toggle
            label="메인 화면 노출"
            checked={form.show_on_main}
            onChange={(v) => set('show_on_main', v)}
          />

          {/* 메모 */}
          <div>
            <FieldLabel>메모</FieldLabel>
            <textarea
              value={form.memo ?? ''}
              onChange={(e) => set('memo', e.target.value)}
              placeholder="운영 메모, 주의사항"
              style={{
                minHeight: 80,
                width: '100%',
                borderRadius: 12,
                border: '1.5px solid rgba(0,0,0,0.12)',
                backgroundColor: '#FFFFFF',
                padding: '10px 12px',
                fontSize: 13,
                fontWeight: 600,
                color: '#0F172A',
                outline: 'none',
                boxSizing: 'border-box',
                resize: 'vertical',
                lineHeight: 1.6,
                WebkitTapHighlightColor: 'transparent',
              } as React.CSSProperties}
            />
          </div>

          {/* Delete zone — 기존 일정만 */}
          {schedule && (
            <div
              style={{
                borderRadius: 14,
                border: '1px solid rgba(239,68,68,0.22)',
                backgroundColor: 'rgba(239,68,68,0.04)',
                padding: '14px',
              }}
            >
              <p style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: '#DC2626',
                margin: '0 0 4px',
              }}>
                Delete
              </p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: '#DC2626', margin: 0, lineHeight: 1.5, flex: 1 }}>
                  잘못 등록한 일정만 삭제하세요. 취소된 일정은 삭제보다 메모 수정을 권장합니다.
                </p>
                <button
                  type="button"
                  onClick={() => onDelete(schedule.id)}
                  disabled={isSaving}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    height: 40,
                    padding: '0 14px',
                    borderRadius: 10,
                    border: '1px solid rgba(239,68,68,0.30)',
                    backgroundColor: '#FFFFFF',
                    fontSize: 11,
                    fontWeight: 800,
                    color: '#DC2626',
                    cursor: 'pointer',
                    flexShrink: 0,
                    WebkitTapHighlightColor: 'transparent',
                    opacity: isSaving ? 0.5 : 1,
                  }}
                >
                  <Trash2 size={13} />
                  일정 삭제
                </button>
              </div>
            </div>
          )}

          {/* ── 저장/취소 버튼 — 폼 마지막 일반 block 요소 ─────────────── */}
          {/* fixed/sticky 없음. overlay 스크롤로 접근. borderTop으로 구분선. */}
          <div
            style={{
              marginTop: 8,
              paddingTop: 16,
              borderTop: '1px solid rgba(0,0,0,0.07)',
              display: 'flex',
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              style={{
                flex: 1,
                height: 50,
                borderRadius: 14,
                border: '1.5px solid rgba(0,0,0,0.12)',
                backgroundColor: '#F8FAFC',
                fontSize: 13,
                fontWeight: 700,
                color: '#475569',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                opacity: isSaving ? 0.5 : 1,
              }}
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => onSave(form)}
              disabled={isSaving}
              style={{
                flex: 2,
                height: 50,
                borderRadius: 14,
                border: '1.5px solid rgba(99,102,241,0.38)',
                backgroundColor: '#6366F1',
                fontSize: 13,
                fontWeight: 800,
                color: '#FFFFFF',
                cursor: isSaving ? 'not-allowed' : 'pointer',
                WebkitTapHighlightColor: 'transparent',
                opacity: isSaving ? 0.7 : 1,
                letterSpacing: '-0.01em',
                boxShadow: '0 3px 12px rgba(99,102,241,0.22)',
                transition: 'opacity 0.15s',
              }}
            >
              {isSaving ? '저장 중...' : '저장 확인'}
            </button>
          </div>

          {/* ── 하단 spacer ───────────────────────────────────────────────── */}
          {/* BottomNav(z:500) 는 overlay(z:9000) 뒤에 가려지지만,              */}
          {/* 버튼 아래 여백을 충분히 확보해 시각적으로 끝까지 보이도록 보장.    */}
          <div style={{ height: 'calc(140px + env(safe-area-inset-bottom))' } as React.CSSProperties} />
        </div>
      </div>
    </div>
  );
}
