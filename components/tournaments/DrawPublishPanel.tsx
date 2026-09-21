'use client';

// 예선 DRAW 공개 관리 (운영진) — 예선 조별리그 메인 상단.
//
//   ⚠ LOCK(조편성 잠금) ≠ PUBLISH(참가자 · 관람객 공개). LOCK 이 자동 공개가 아니다.
//   ⚠ 조편성을 unlock 하면 서버가 같은 트랜잭션에서 자동 비공개로 돌린다(자동 재공개 없음).
//   ⚠ 서버 상태가 source of truth — 모든 동작 후 authoritative refetch.

import React from 'react';
import Link from 'next/link';
import { Eye, EyeOff, ExternalLink, Globe } from 'lucide-react';
import {
  drawPublishMessage, fetchDrawPublication, publishPreliminaryDraw, unpublishPreliminaryDraw,
  type DrawPublication,
} from '@/lib/tournaments/drawPublishService';
import { C } from '@/components/tournaments/standings/presentation';
import { StatusDot } from '@/components/tournaments/standings/primitives';

type Dialog = 'publish' | 'unpublish' | null;

const fmt = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function DrawPublishPanel({
  slug, onChanged, onMessage,
}: { slug: string; onChanged: () => void; onMessage: (m: string) => void }) {
  const [pub, setPub] = React.useState<DrawPublication | null>(null);
  const [ready, setReady] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [dlg, setDlg] = React.useState<Dialog>(null);
  const [reason, setReason] = React.useState('');

  const load = React.useCallback(async () => {
    try {
      const r = await fetchDrawPublication(slug);
      setReady(r.ready);
      setPub(r.publication);
    } catch (err) {
      onMessage(drawPublishMessage(err));
    }
  }, [slug, onMessage]);

  React.useEffect(() => { void load(); }, [load]);

  if (!ready || !pub) return null;   // migration 전이거나 권한 없음 — 패널을 그리지 않는다.

  const published = pub.publishedAt !== null;
  const locked = pub.drawStatus === 'locked';

  const run = async (fn: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    try {
      onMessage(await fn());
      setDlg(null);
      setReason('');
    } catch (err) {
      onMessage(drawPublishMessage(err));
    } finally {
      // 성공/실패 모두 서버 상태로 다시 맞춘다.
      await load();
      onChanged();
      setBusy(false);
    }
  };

  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Globe size={16} color={published ? C.tealText : C.slate} strokeWidth={2.3} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <StatusDot label={published ? 'DRAW 공개 중' : 'DRAW 비공개'} color={published ? C.tealText : C.slate} fontSize={13} />
          <p style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 600, color: C.muted, lineHeight: 1.5, wordBreak: 'keep-all' }}>
            {published
              ? `${fmt(pub.publishedAt as string)} 공개 · 참가자·관람객이 볼 수 있습니다`
              : locked
                ? '조편성이 확정되었습니다. 공개하면 참가자·관람객이 볼 수 있습니다.'
                : '조편성을 확정(LOCK)한 뒤 공개할 수 있습니다.'}
          </p>
        </div>
        {published ? (
          <button type="button" disabled={busy} onClick={() => { setReason(''); setDlg('unpublish'); }}
            style={{ ...btn, border: `1px solid ${C.line}`, background: '#fff', color: C.body }}>
            <EyeOff size={14} strokeWidth={2.4} /> 공개 취소
          </button>
        ) : locked ? (
          <button type="button" disabled={busy} onClick={() => setDlg('publish')}
            style={{ ...btn, border: 0, background: C.teal, color: '#fff' }}>
            <Eye size={14} strokeWidth={2.4} /> DRAW 공개
          </button>
        ) : null}
      </div>
      {published && (
        <Link href={`/tournaments/${slug}/draw`} target="_blank"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 12, fontWeight: 700, color: C.tealText, textDecoration: 'none' }}>
          공개 화면 보기 <ExternalLink size={12} strokeWidth={2.4} />
        </Link>
      )}

      {dlg && (
        <div role="dialog" aria-modal="true" aria-label={dlg === 'publish' ? 'DRAW 공개' : 'DRAW 공개 취소'}
          onClick={() => !busy && setDlg(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,0.55)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            padding: 12, paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
          }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: 16, padding: 16, boxSizing: 'border-box' }}>
            <p style={{ margin: 0, fontSize: 15.5, fontWeight: 800, color: C.navy }}>
              {dlg === 'publish' ? '예선 DRAW 공개' : '예선 DRAW 공개 취소'}
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 500, color: C.body, lineHeight: 1.7, wordBreak: 'keep-all' }}>
              {dlg === 'publish'
                ? '참가자·관람객에게 예선 조편성, 경기 결과, 순위가 공개됩니다. 조편성을 다시 수정(unlock)하면 자동으로 비공개로 바뀌고, 다시 확정한 뒤 직접 공개해야 합니다.'
                : '공개 DRAW 화면이 즉시 닫힙니다. 조편성과 경기 결과는 바뀌지 않습니다.'}
            </p>
            {dlg === 'unpublish' && (
              <label style={{ display: 'block', marginTop: 12 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>공개 취소 사유 (필수)</span>
                <input value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)}
                  placeholder="예: 조편성 재확인"
                  style={{
                    display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 42, marginTop: 5,
                    padding: '8px 11px', borderRadius: 9, border: `1px solid ${C.line}`, background: '#fff',
                    fontFamily: 'inherit', fontSize: 14, color: C.navy,
                  }} />
              </label>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 15 }}>
              <button type="button" disabled={busy} onClick={() => setDlg(null)}
                style={{ ...btn, flex: 1, minHeight: 44, border: `1px solid ${C.line}`, background: '#fff', color: C.body }}>
                닫기
              </button>
              {dlg === 'publish' ? (
                <button type="button" disabled={busy}
                  onClick={() => void run(async () => {
                    const r = await publishPreliminaryDraw(slug, pub.drawVersion);
                    return r.warnings.includes('tournament_not_public')
                      ? 'DRAW 를 공개했습니다. 대회가 아직 비공개 상태라 공개 화면에는 나타나지 않습니다.'
                      : 'DRAW 를 공개했습니다.';
                  })}
                  style={{ ...btn, flex: 2, minHeight: 44, border: 0, background: C.teal, color: '#fff' }}>
                  {busy ? '공개 중…' : '공개하기'}
                </button>
              ) : (
                <button type="button" disabled={busy || reason.trim().length < 2}
                  onClick={() => void run(async () => {
                    await unpublishPreliminaryDraw(slug, reason.trim(), pub.drawVersion);
                    return 'DRAW 공개를 취소했습니다.';
                  })}
                  style={{
                    ...btn, flex: 2, minHeight: 44, border: 0, background: C.navy, color: '#fff',
                    opacity: reason.trim().length >= 2 ? 1 : 0.45,
                  }}>
                  {busy ? '처리 중…' : '공개 취소'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  minHeight: 38, padding: '0 12px', borderRadius: 9,
  fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
};
