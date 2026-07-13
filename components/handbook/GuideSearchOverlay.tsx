'use client';

// Handbook 전역 검색 오버레이 — 기본형(Handoff §5.E).
//   입력 + 결과 목록(제목/keywords 한글 매칭) + ESC/백드롭 닫기 + 자동 포커스 + '/' 단축키.

import React from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { HB, HB_SHADOW } from './handbookTokens';
import { audienceMeta, moduleHref, searchModules } from '@/lib/handbook/modules';
import { GuideStatusBadge } from './HandbookBadges';

export default function GuideSearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const results = React.useMemo(() => searchModules(query), [query]);

  React.useEffect(() => {
    if (open) { setQuery(''); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label="가이드 검색"
      style={{ position: 'fixed', inset: 0, zIndex: 80, backgroundColor: 'rgba(20,38,60,.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '10vh 16px 16px' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, maxHeight: '60vh', display: 'flex', flexDirection: 'column', backgroundColor: HB.surface, borderRadius: 16, boxShadow: HB_SHADOW.elevated, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${HB.borderSub}` }}>
          <Search size={17} style={{ color: HB.textTertiary, flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="기능 이름이나 키워드로 검색 (예: 랭킹, 참석)"
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 15, fontWeight: 600, color: HB.textPrimary, backgroundColor: 'transparent' }}
          />
          <button type="button" onClick={onClose} aria-label="닫기"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 30, padding: '0 10px', borderRadius: 999, border: `1px solid ${HB.border}`, backgroundColor: HB.surfaceSub, color: HB.textSecondary, fontSize: 11, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
            ESC <X size={12} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: 8 }}>
          {query.trim() === '' ? (
            <p style={{ margin: 0, padding: '22px 12px', fontSize: 13, fontWeight: 600, color: HB.textTertiary, textAlign: 'center' }}>찾고 싶은 기능을 입력해보세요.</p>
          ) : results.length === 0 ? (
            <p style={{ margin: 0, padding: '22px 12px', fontSize: 13, fontWeight: 600, color: HB.textTertiary, textAlign: 'center' }}>검색 결과가 없습니다.</p>
          ) : results.map((m) => {
            const meta = audienceMeta(m.audience[0]);
            return (
              <button key={m.id} type="button" onClick={() => { onClose(); router.push(moduleHref(m)); }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 12, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', textAlign: 'left', minHeight: 48 }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: HB.textPrimary, wordBreak: 'keep-all' }}>{m.title}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 600, color: HB.textTertiary }}>{meta.label} · {m.chapter}</p>
                </div>
                <GuideStatusBadge status={m.recording_status} />
                <span style={{ fontSize: 12, fontWeight: 800, color: HB.teal, whiteSpace: 'nowrap', flexShrink: 0 }}>열기 →</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 검색 버튼 + '/' 단축키 — 페이지에서 사용. */
export function useGuideSearch(): [boolean, () => void, () => void] {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !open) {
        const t = e.target as HTMLElement;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return [open, () => setOpen(true), () => setOpen(false)];
}
