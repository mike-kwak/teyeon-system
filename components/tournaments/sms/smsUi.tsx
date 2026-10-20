'use client';

// 문자 안내 센터 — 공통 스타일 · 작은 부품(복사 · 확인 창 · 알림).
//   ⚠ 복사 내용을 콘솔 · 로그에 남기지 않는다.

import React from 'react';
import { X } from 'lucide-react';

export const INK = '#0F172A';
export const BODY = '#334155';
export const MUTED = '#64748B';
export const FAINT = '#94A3B8';
export const LINE = '#E2E8F0';
export const LINE_SOFT = '#F1F5F9';
export const TEAL = '#0E8C80';
export const TEAL_DEEP = '#0A6F65';
export const TEAL_SOFT = '#E7F3F1';
export const AMBER = '#B45309';
export const AMBER_SOFT = '#FFFBEB';
export const RED = '#B91C1C';
export const RED_SOFT = '#FEF2F2';
export const NAVY = '#0F1B33';

export const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, boxSizing: 'border-box', minWidth: 0,
};
export const input: React.CSSProperties = {
  width: '100%', minHeight: 44, padding: '0 11px', border: '1px solid #CBD5E1', borderRadius: 9, fontSize: 15,
  fontFamily: 'inherit', color: INK, background: '#fff', boxSizing: 'border-box', minWidth: 0,
};
export const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '0 14px',
  borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', color: BODY, fontSize: 14, fontWeight: 800,
  fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', WebkitTapHighlightColor: 'transparent',
};
export const btnPrimary: React.CSSProperties = { ...btn, background: TEAL, borderColor: TEAL, color: '#fff' };
export const btnDark: React.CSSProperties = { ...btn, background: NAVY, borderColor: NAVY, color: '#fff' };
export const btnSmall: React.CSSProperties = { ...btn, minHeight: 36, padding: '0 11px', fontSize: 13 };

export function Chip({ tone = 'neutral', children, title }: { tone?: 'neutral' | 'teal' | 'amber' | 'red' | 'navy'; children: React.ReactNode; title?: string }) {
  const map = {
    neutral: { bg: LINE_SOFT, fg: MUTED },
    teal: { bg: TEAL_SOFT, fg: TEAL_DEEP },
    amber: { bg: AMBER_SOFT, fg: AMBER },
    red: { bg: RED_SOFT, fg: RED },
    navy: { bg: '#E8ECF4', fg: NAVY },
  }[tone];
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
      background: map.bg, color: map.fg, fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap', lineHeight: 1.6,
    }}>{children}</span>
  );
}

export function SectionHead({ no, title, en, desc, right }: { no: string; title: string; en: string; desc?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.14em', color: FAINT }}>{no} · {en}</p>
        <h2 style={{ margin: '2px 0 0', fontSize: 17, fontWeight: 900, color: INK, letterSpacing: '-0.01em' }}>{title}</h2>
        {desc && <p style={{ margin: '3px 0 0', fontSize: 12.5, fontWeight: 600, color: MUTED, lineHeight: 1.6, wordBreak: 'keep-all' }}>{desc}</p>}
      </div>
      {right && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{right}</div>}
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'info' | 'warn' | 'error' | 'ok'; children: React.ReactNode }) {
  const m = {
    info: { bg: '#F8FAFC', bd: LINE, fg: BODY },
    warn: { bg: AMBER_SOFT, bd: '#FDE68A', fg: '#78350F' },
    error: { bg: RED_SOFT, bd: '#FECACA', fg: '#7F1D1D' },
    ok: { bg: TEAL_SOFT, bd: '#BFE3DB', fg: TEAL_DEEP },
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : undefined} style={{
      background: m.bg, border: `1px solid ${m.bd}`, color: m.fg, borderRadius: 11, padding: '10px 12px',
      fontSize: 12.5, fontWeight: 700, lineHeight: 1.65, wordBreak: 'keep-all', overflowWrap: 'anywhere',
    }}>{children}</div>
  );
}

// ── 복사 ──────────────────────────────────────────────────────────────────────
/** 클립보드 복사. 실패하면 false — 호출한 쪽이 수동 복사 창을 띄운다. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 아래 방법으로 다시 시도 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const done = document.execCommand('copy');
    document.body.removeChild(ta);
    return done;
  } catch { return false; }
}

/** 자동 복사가 안 될 때 — 글자를 직접 선택해 복사하는 창. */
export function ManualCopy({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  React.useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ margin: '0 0 8px', fontSize: 12.5, fontWeight: 700, color: MUTED, lineHeight: 1.6, wordBreak: 'keep-all' }}>
        자동 복사가 되지 않았습니다. 아래 글자를 길게 눌러 전체 선택한 뒤 복사해 주세요.
      </p>
      <textarea ref={ref} readOnly value={text} data-sms-manual-copy rows={8}
        style={{ ...input, minHeight: 160, padding: 10, fontSize: 14, lineHeight: 1.55, resize: 'vertical' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button type="button" style={btn} onClick={onClose}>닫기</button>
      </div>
    </Modal>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-sms-modal style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '16px 16px calc(16px + env(safe-area-inset-bottom))',
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...card, width: '100%', maxWidth: 520, maxHeight: '86vh', overflowY: 'auto', padding: 18, boxShadow: '0 12px 40px rgba(15,23,42,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <p style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 16, fontWeight: 900, color: INK, wordBreak: 'keep-all' }}>{title}</p>
          <button type="button" aria-label="닫기" onClick={onClose} style={{ ...btnSmall, width: 36, padding: 0 }}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 확인 창(브라우저 confirm 대신 — 모바일에서도 같은 모양). */
export function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }: {
  title: string; body: React.ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: BODY, lineHeight: 1.7, wordBreak: 'keep-all' }}>{body}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button type="button" style={btn} onClick={onCancel} data-sms-confirm="cancel">취소</button>
        <button type="button" data-sms-confirm="ok" onClick={onConfirm}
          style={danger ? { ...btn, background: RED, borderColor: RED, color: '#fff' } : btnPrimary}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

export function Toast({ toast }: { toast: { text: string; tone: 'ok' | 'err' } | null }) {
  if (!toast) return null;
  return (
    <div role="status" aria-live="polite" data-sms-toast={toast.tone} style={{
      position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(84px + env(safe-area-inset-bottom))',
      zIndex: 1100, maxWidth: 'calc(100vw - 32px)', padding: '10px 14px', borderRadius: 11,
      background: toast.tone === 'ok' ? NAVY : RED, color: '#fff', fontSize: 13, fontWeight: 800,
      boxShadow: '0 6px 20px rgba(15,23,42,0.25)', wordBreak: 'keep-all', textAlign: 'center',
    }}>{toast.text}</div>
  );
}

export const fmtTime = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
};
