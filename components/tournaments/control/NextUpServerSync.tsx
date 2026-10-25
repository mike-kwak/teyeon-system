'use client';

// Control Center — 코트 전광판 NEXT 연동(본부 NEXT UP → 서버).
//
//   ⚠ 본부 NEXT UP 은 그대로 이 PC 에 저장된다(useCourtNextUp). 이 줄은 그 값을 서버에 '복사' 할 뿐이다.
//   ⚠ 자동으로 덮어쓰지 않는다 — 운영자가 [전광판에 보내기]를 확인한 뒤부터만(이 PC 에 '연동 중' 표시) 지정 · 변경 · 해제를 서버에 맞춘다.
//   ⚠ 서버 저장이 실패해도 경기 운영(투입 · 점수 · 타이머 · 본부 NEXT UP)은 그대로다 — 안내만 하고 다음 주기에 다시 맞춘다.
//   ⚠ SQL 미적용 · 권한 없음이면 아무것도 그리지 않는다. Realtime 없음(15초 주기 확인).

import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { NextUpEntry } from './useCourtNextUp';
import { fetchServerNextUps, saveServerNextUps, sameNextUps } from '@/lib/tournaments/nextUpServerService';
import type { ServerNextUp } from '@/lib/tournaments/nextUpServerService';

const POLL_MS = 15_000;
const linkKey = (slug: string) => `teyeon:control:next-up-server:v1:${slug}`;
const readLinked = (slug: string) => { try { return window.localStorage.getItem(linkKey(slug)) === '1'; } catch { return false; } };
const writeLinked = (slug: string, on: boolean) => { try { if (on) window.localStorage.setItem(linkKey(slug), '1'); else window.localStorage.removeItem(linkKey(slug)); } catch { /* 표시만 달라진다 */ } };
const listText = (xs: ReadonlyArray<{ courtNo: number; matchNo: number | null }>) =>
  xs.length ? xs.map((e) => `${e.courtNo}번 M${e.matchNo ?? '?'}`).join(' · ') : '없음';

export default function NextUpServerSync({ slug, entries, loaded }: { slug: string; entries: NextUpEntry[]; loaded: boolean }) {
  const [server, setServer] = React.useState<ServerNextUp[] | null>(null);
  const [available, setAvailable] = React.useState<boolean | null>(null);
  const [linked, setLinked] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const busyRef = React.useRef(false);
  const entriesRef = React.useRef(entries);
  entriesRef.current = entries;

  React.useEffect(() => { setLinked(readLinked(slug)); }, [slug]);

  const refresh = React.useCallback(async () => {
    const r = await fetchServerNextUps(slug);
    if (r.kind === 'ok') { setAvailable(true); setServer(r.items); return r.items; }
    if (r.kind === 'unavailable' || r.kind === 'forbidden') setAvailable(false);
    return null;
  }, [slug]);

  const push = React.useCallback(async (items: ReadonlyArray<{ courtNo: number; matchId: string }>) => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true);
    try {
      const r = await saveServerNextUps(slug, items);
      if (r.kind === 'ok') { setError(null); await refresh(); return true; }
      setError(r.kind === 'rejected' ? `전광판 저장이 거부되었습니다(${r.reason}). 경기 운영에는 영향이 없습니다.` : '전광판 저장에 실패했습니다. 15초 뒤 다시 맞춥니다. 경기 운영에는 영향이 없습니다.');
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  }, [slug, refresh]);

  // 주기 확인 — 연동 중이고 서버가 본부와 다르면 본부 값으로 맞춘다(실패 재시도 포함).
  React.useEffect(() => {
    if (!slug) return;
    let alive = true;
    const tick = async () => {
      const s = await refresh();
      if (!alive || !s || !readLinked(slug) || !loaded) return;
      if (!sameNextUps(s, entriesRef.current)) await push(entriesRef.current);
    };
    void tick();
    const t = window.setInterval(() => { if (document.visibilityState !== 'hidden') void tick(); }, POLL_MS);
    return () => { alive = false; window.clearInterval(t); };
  }, [slug, loaded, refresh, push]);

  // 연동 중 — 본부 지정 · 변경 · 해제가 생기면 바로 서버에 맞춘다(잠깐 모아서 한 번).
  React.useEffect(() => {
    if (!linked || !loaded || available !== true || server === null) return;
    if (sameNextUps(server, entries)) return;
    const t = window.setTimeout(() => { void push(entriesRef.current); }, 600);
    return () => window.clearTimeout(t);
  }, [linked, loaded, available, server, entries, push]);

  if (available !== true || !loaded) return null;

  const same = server !== null && sameNextUps(server, entries);
  const start = async () => {
    if (!window.confirm(`본부 NEXT UP ${entries.length}건을 코트 전광판(서버)에 보냅니다.\n${listText(entries)}\n\n서버에 있던 값(${listText(server ?? [])})은 이 목록으로 바뀝니다. 이후 지정 · 변경 · 해제는 자동으로 전광판에 반영됩니다.`)) return;
    if (await push(entries)) { writeLinked(slug, true); setLinked(true); }
  };
  const stop = async () => {
    if (!window.confirm('전광판 NEXT 연동을 끕니다. 전광판의 NEXT 는 모두 \'미정\'이 되고, 본부 NEXT UP(이 PC)은 그대로입니다.')) return;
    writeLinked(slug, false); setLinked(false);
    await push([]);
  };

  const tone = !linked ? '#64748B' : error ? '#B91C1C' : same ? '#0E8C80' : '#9A3412';
  return (
    <div data-nextup-server={linked ? (error ? 'error' : same ? 'synced' : 'pending') : 'off'} role="status" style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '7px 11px', borderRadius: 9,
      border: `1px solid ${linked ? tone : '#E2E8F0'}`, background: '#fff', fontSize: 12, fontWeight: 700, color: tone,
    }}>
      <span style={{ wordBreak: 'keep-all' }}>
        {!linked ? `전광판 NEXT 연동 꺼짐 — 본부 NEXT UP ${entries.length}건은 이 PC 에만 있습니다.`
          : error ? error
            : same ? `전광판 NEXT 연동 중 · 서버와 일치(${listText(server ?? [])})`
              : '전광판 NEXT 연동 중 · 서버에 반영 중…'}
      </span>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
        {!linked ? (
          <button type="button" data-control-action="nextup-server-start" disabled={busy} onClick={() => { void start(); }}
            style={{ minHeight: 28, padding: '3px 10px', borderRadius: 7, border: '1px solid #1D4ED8', background: '#1D4ED8', color: '#fff', fontSize: 12, fontWeight: 800, cursor: busy ? 'default' : 'pointer' }}>
            전광판에 보내기
          </button>
        ) : (
          <>
            {error && (
              <button type="button" data-control-action="nextup-server-retry" disabled={busy} onClick={() => { void push(entriesRef.current); }}
                style={{ minHeight: 28, padding: '3px 9px', borderRadius: 7, border: '1px solid #E2E8F0', background: '#fff', color: '#334155', fontSize: 12, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <RefreshCw size={12} strokeWidth={2.4} />다시 시도
              </button>
            )}
            <button type="button" data-control-action="nextup-server-stop" disabled={busy} onClick={() => { void stop(); }}
              style={{ minHeight: 28, padding: '3px 9px', borderRadius: 7, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', fontSize: 12, fontWeight: 800 }}>
              연동 끄기
            </button>
          </>
        )}
      </span>
    </div>
  );
}
