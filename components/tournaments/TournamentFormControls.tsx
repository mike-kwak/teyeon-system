'use client';

// 공개 참가신청 폼 컨트롤 — Tournament Design System(Cool Premium Light) 위에서 동작.
//   Admin form 느낌이 나지 않도록 Hub 와 같은 카드/라벨/여백 언어를 쓴다.
//
//   모바일 규칙
//     · input font-size 는 16px 이상 — iOS 가 포커스 시 화면을 확대하지 않게 한다.
//     · 라벨·오류·체크박스 문구는 자르지 않는다(ellipsis 없음, keep-all wrap).
//     · 터치 타깃 최소 높이 52px.
//   오류는 상단 alert 하나로 몰지 않고 각 필드 바로 아래에 표시한다.

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { TT, FONT_LABEL } from './tournamentTheme';

/** 폼 전역 스타일(:focus 는 인라인 스타일로 표현할 수 없어 style 태그로 둔다). */
export function TournamentFormStyles() {
  return (
    <style>{`
      .tt-input, .tt-textarea {
        width: 100%;
        box-sizing: border-box;
        border-radius: 10px;
        border: 1.5px solid ${TT.line};
        background-color: #FBFCFD;
        color: ${TT.ink};
        font-family: inherit;
        font-size: 16px;
        font-weight: 600;
        outline: none;
        transition: border-color .15s ease, background-color .15s ease;
        -webkit-appearance: none;
        appearance: none;
      }
      .tt-input { height: 52px; padding: 0 14px; }
      .tt-textarea { min-height: 96px; padding: 13px 14px; line-height: 1.6; resize: vertical; }
      .tt-input::placeholder, .tt-textarea::placeholder { color: ${TT.faint}; font-weight: 500; }
      .tt-input:focus, .tt-textarea:focus { border-color: ${TT.teal}; background-color: #FFFFFF; }
      .tt-input--error, .tt-textarea--error { border-color: #DC2626; background-color: #FEF7F7; }
      .tt-input--error:focus, .tt-textarea--error:focus { border-color: #DC2626; }
      .tt-check { accent-color: ${TT.teal}; width: 19px; height: 19px; flex-shrink: 0; margin: 1px 0 0; }
    `}</style>
  );
}

/** 섹션 카드 — 라벨 + 내용. */
export function FormCard({
  label,
  children,
  description,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        backgroundColor: TT.surface,
        border: `1px solid ${TT.line}`,
        borderRadius: 12,
        padding: '17px 16px 18px',
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: FONT_LABEL,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.16em',
          color: TT.teal,
        }}
      >
        {label}
      </p>
      {description && (
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 12,
            fontWeight: 600,
            color: TT.muted,
            lineHeight: 1.65,
            wordBreak: 'keep-all',
          }}
        >
          {description}
        </p>
      )}
      <div style={{ marginTop: 15, display: 'flex', flexDirection: 'column', gap: 15 }}>{children}</div>
    </section>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      style={{
        margin: '7px 0 0',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        fontSize: 12.5,
        fontWeight: 700,
        color: '#DC2626',
        lineHeight: 1.55,
        wordBreak: 'keep-all',
      }}
    >
      <AlertCircle size={14} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ minWidth: 0 }}>{message}</span>
    </p>
  );
}

interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  helper?: string;
  error?: string;
  children: React.ReactNode;
}

export function Field({ id, label, required, optional, helper, error, children }: FieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          marginBottom: 7,
          fontSize: 12.5,
          fontWeight: 700,
          color: TT.inkSoft,
          lineHeight: 1.5,
          wordBreak: 'keep-all',
        }}
      >
        {label}
        {required && <span style={{ color: '#DC2626', marginLeft: 3 }}>*</span>}
        {optional && (
          <span style={{ marginLeft: 5, fontSize: 11.5, fontWeight: 600, color: TT.subtle }}>선택</span>
        )}
      </label>
      {children}
      {error ? (
        <FieldError message={error} />
      ) : (
        helper && (
          <p
            style={{
              margin: '7px 0 0',
              fontSize: 11.5,
              fontWeight: 600,
              color: TT.subtle,
              lineHeight: 1.6,
              wordBreak: 'keep-all',
            }}
          >
            {helper}
          </p>
        )
      )}
    </div>
  );
}

interface TextInputProps {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: boolean;
  maxLength?: number;
  inputMode?: 'text' | 'numeric' | 'tel';
  type?: string;
  autoComplete?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  error,
  maxLength,
  inputMode = 'text',
  type = 'text',
  autoComplete,
  inputRef,
}: TextInputProps) {
  return (
    <input
      id={id}
      ref={inputRef}
      className={`tt-input${error ? ' tt-input--error' : ''}`}
      type={type}
      inputMode={inputMode}
      autoComplete={autoComplete}
      placeholder={placeholder}
      maxLength={maxLength}
      value={value}
      aria-invalid={error || undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function TextAreaInput({
  id,
  value,
  onChange,
  placeholder,
  error,
  maxLength,
  inputRef,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: boolean;
  maxLength?: number;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <textarea
      id={id}
      ref={inputRef}
      className={`tt-textarea${error ? ' tt-textarea--error' : ''}`}
      placeholder={placeholder}
      maxLength={maxLength}
      value={value}
      aria-invalid={error || undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * 확인/동의 항목.
 *   본문(body)은 공식 요강 원문 또는 수집 항목 고지를 그대로 넣는 자리다 — 여기서 새 문구를 만들지 않는다.
 *   문구가 길어도 잘리지 않고 wrap 된다.
 */
export function ConsentRow({
  id,
  checked,
  onChange,
  title,
  body,
  error,
  action,
  inputRef,
  last,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  body?: React.ReactNode;
  error?: string;
  action?: React.ReactNode;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  last?: boolean;
}) {
  return (
    <div
      style={{
        paddingBottom: last ? 0 : 14,
        marginBottom: last ? 0 : 14,
        borderBottom: last ? 'none' : `1px solid ${TT.lineSoft}`,
      }}
    >
      <label
        htmlFor={id}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 11,
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <input
          id={id}
          ref={inputRef}
          className="tt-check"
          type="checkbox"
          checked={checked}
          aria-invalid={!!error || undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontSize: 13.5,
              fontWeight: 800,
              color: TT.ink,
              lineHeight: 1.55,
              wordBreak: 'keep-all',
            }}
          >
            {title}
            <span style={{ color: '#DC2626', marginLeft: 3 }}>*</span>
          </span>
          {body && (
            <span
              style={{
                display: 'block',
                marginTop: 6,
                fontSize: 12,
                fontWeight: 600,
                color: TT.muted,
                lineHeight: 1.7,
                wordBreak: 'keep-all',
              }}
            >
              {body}
            </span>
          )}
        </span>
      </label>
      {action && <div style={{ marginTop: 8, paddingLeft: 30 }}>{action}</div>}
      {error && <div style={{ paddingLeft: 30 }}><FieldError message={error} /></div>}
    </div>
  );
}
