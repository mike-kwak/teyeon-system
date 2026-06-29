'use client';

// TENNIS LOG 공통 확인 다이얼로그 — 삭제 등 파괴적 동작 확인용.
// 기존 메인 화면 permAlert 모달과 동일한 시각 언어(중앙 모달 + 오버레이).

import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default function TennisLogConfirmDialog({
  open,
  title,
  body,
  confirmLabel = '삭제',
  cancelLabel = '취소',
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  const confirmColor = destructive ? '#DC2626' : '#0F766E';

  return (
    <div
      onClick={busy ? undefined : onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(15,23,42,0.45)',
        backdropFilter: 'blur(4px)',
        padding: 20,
        paddingTop: 'calc(20px + env(safe-area-inset-top))',
        paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
        boxSizing: 'border-box',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 320,
          backgroundColor: '#FFFFFF',
          borderRadius: 16,
          border: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 20px 50px rgba(15,23,42,0.24)',
          padding: 20,
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            margin: '0 auto',
            borderRadius: '50%',
            backgroundColor: destructive ? 'rgba(220,38,38,0.10)' : 'rgba(15,118,110,0.10)',
            color: confirmColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AlertTriangle size={20} strokeWidth={2.2} />
        </div>
        <h2 style={{ margin: '12px 0 0', fontSize: 16, fontWeight: 900, color: '#0F172A', wordBreak: 'keep-all' }}>
          {title}
        </h2>
        {body && (
          <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 600, color: '#64748B', lineHeight: 1.6, wordBreak: 'keep-all' }}>
            {body}
          </p>
        )}
        <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              flex: 1,
              height: 46,
              borderRadius: 11,
              border: '1px solid rgba(15,27,51,0.14)',
              backgroundColor: '#FFFFFF',
              color: '#334155',
              fontSize: 13.5,
              fontWeight: 800,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              flex: 1,
              height: 46,
              borderRadius: 11,
              border: 'none',
              backgroundColor: confirmColor,
              color: '#FFFFFF',
              fontSize: 13.5,
              fontWeight: 800,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? '처리 중…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
