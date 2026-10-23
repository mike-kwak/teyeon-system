'use client';

// Control Center — 코트별 NEXT UP(대기 코트 지정) 저장. 본부 PC 한 대 기준.
//
//   ⚠ 이 브라우저의 localStorage 에만 둔다(대회별 키). 서버 · DB 에 쓰지 않는다 — 경기 상태 · 호명 · 코트 점유와 무관하다.
//     다른 기기 · 다른 운영자에게는 보이지 않는다(같은 PC 의 다른 탭에는 storage 이벤트로 맞춘다).
//   ⚠ 코트당 1경기 · 경기당 1코트. 지정을 스스로 옮기거나 지우지 않는다 — 운영자의 지정 · 변경 · 해제와
//     이 화면에서 투입이 성공했을 때만 바뀐다. 무효(완료 · 취소 · 다른 코트 진행)는 화면이 표시만 한다.
//   ⚠ 저장 실패(사생활 모드 · 저장 공간)는 경고로 알린다. 화면의 지정은 그대로 쓴다.

import React from 'react';

export interface NextUpEntry {
  courtNo: number;
  matchId: string;
  /** 표시용(경기를 못 찾을 때 안내). 판정은 matchId 로만 한다. */
  matchNo: number;
  /** 지정 시각(ms) — 불러올 때 중복이 있으면 나중 것을 남긴다. */
  at: number;
}

export const nextUpStorageKey = (slug: string) => `teyeon:control:next-up:v1:${slug}`;

/** 저장값 정리 — 모양이 틀린 줄은 버리고, 코트 · 경기가 겹치면 나중 지정만 남긴다. */
export function sanitizeNextUp(raw: unknown): NextUpEntry[] {
  const items = raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)
    ? (raw as { items: unknown[] }).items : [];
  const ok = items.filter((x): x is NextUpEntry => {
    const e = x as Partial<NextUpEntry> | null;
    return !!e && Number.isInteger(e.courtNo) && (e.courtNo as number) > 0
      && typeof e.matchId === 'string' && e.matchId !== ''
      && Number.isFinite(e.matchNo) && Number.isFinite(e.at);
  }).sort((a, b) => b.at - a.at);
  const courts = new Set<number>(); const matches = new Set<string>();
  return ok.filter((e) => {
    if (courts.has(e.courtNo) || matches.has(e.matchId)) return false;
    courts.add(e.courtNo); matches.add(e.matchId); return true;
  }).sort((a, b) => a.courtNo - b.courtNo);
}

/** 저장된 대기 지정을 바로 읽는다(경기 운영 화면처럼 hook 없이 쓰는 곳용). 못 읽으면 빈 목록. */
export function readNextUp(slug: string): NextUpEntry[] {
  try { const s = window.localStorage.getItem(nextUpStorageKey(slug)); return s ? sanitizeNextUp(JSON.parse(s)) : []; } catch { return []; }
}

/** 이 경기를 이 코트에 투입할 때 대기 지정과 어긋나는 점 — 확인 문구(없으면 null). */
export function nextUpConflictText(entries: NextUpEntry[], matchId: string, matchNo: number, courtNo: number): string | null {
  const lines: string[] = [];
  const here = entries.find((e) => e.courtNo === courtNo);
  if (here && here.matchId !== matchId) lines.push(`${courtNo}번 코트에는 M${here.matchNo}이(가) 대기 지정되어 있습니다(대기 지정은 그대로 남습니다).`);
  const mine = entries.find((e) => e.matchId === matchId);
  if (mine && mine.courtNo !== courtNo) lines.push(`M${matchNo}은(는) ${mine.courtNo}번 코트 대기로 지정되어 있습니다(투입되면 그 대기 지정은 해제됩니다).`);
  return lines.length ? `${lines.join('\n')}\n\nM${matchNo}을(를) ${courtNo}번 코트에 투입할까요?` : null;
}

/** 투입이 성공한 경기의 대기 지정을 저장소에서 지운다(같은 PC 의 관제 탭은 storage 이벤트로 맞춘다). */
export function dropNextUpMatch(slug: string, matchId: string): void {
  try {
    const cur = readNextUp(slug);
    if (!cur.some((e) => e.matchId === matchId)) return;
    window.localStorage.setItem(nextUpStorageKey(slug), JSON.stringify({ v: 1, items: cur.filter((e) => e.matchId !== matchId) }));
  } catch { /* 저장 실패 — 관제 화면이 무효 지정으로 표시한다 */ }
}

export interface CourtNextUp {
  entries: NextUpEntry[];
  /** 저장소를 읽었는가(읽기 전에는 지정을 그리지 않는다). */
  loaded: boolean;
  /** 저장 · 읽기 실패 안내. 정상이면 null. */
  storageError: string | null;
  /** 이 코트의 대기를 이 경기로 — 그 경기가 다른 코트 대기였다면 그 지정은 옮겨 온다(호출 전에 운영자 확인). */
  assign: (courtNo: number, matchId: string, matchNo: number) => void;
  clearCourt: (courtNo: number) => void;
  clearMatch: (matchId: string) => void;
}

export function useCourtNextUp(slug: string): CourtNextUp {
  const key = nextUpStorageKey(slug);
  const [entries, setEntries] = React.useState<NextUpEntry[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [storageError, setStorageError] = React.useState<string | null>(null);
  const ref = React.useRef<NextUpEntry[]>([]);

  const read = React.useCallback(() => {
    try {
      const s = window.localStorage.getItem(key);
      const next = s ? sanitizeNextUp(JSON.parse(s)) : [];
      ref.current = next; setEntries(next);
    } catch {
      setStorageError('이 브라우저의 저장소를 읽지 못했습니다. 대기 지정이 새로고침 뒤 유지되지 않을 수 있습니다.');
    }
  }, [key]);

  React.useEffect(() => {
    ref.current = []; setEntries([]); setStorageError(null);
    read(); setLoaded(true);
    // 같은 PC 의 다른 탭에서 바꾼 경우만 맞춘다(다른 기기와는 공유하지 않는다).
    const onStorage = (e: StorageEvent) => { if (e.key === key) read(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, read]);

  const commit = React.useCallback((next: NextUpEntry[]) => {
    ref.current = next; setEntries(next);
    try {
      window.localStorage.setItem(key, JSON.stringify({ v: 1, items: next }));
      setStorageError(null);
    } catch {
      setStorageError('대기 지정을 이 브라우저에 저장하지 못했습니다. 새로고침하면 사라질 수 있습니다.');
    }
  }, [key]);

  const assign = React.useCallback((courtNo: number, matchId: string, matchNo: number) => {
    commit([...ref.current.filter((e) => e.courtNo !== courtNo && e.matchId !== matchId),
      { courtNo, matchId, matchNo, at: Date.now() }].sort((a, b) => a.courtNo - b.courtNo));
  }, [commit]);
  const clearCourt = React.useCallback((courtNo: number) => {
    if (ref.current.some((e) => e.courtNo === courtNo)) commit(ref.current.filter((e) => e.courtNo !== courtNo));
  }, [commit]);
  const clearMatch = React.useCallback((matchId: string) => {
    if (ref.current.some((e) => e.matchId === matchId)) commit(ref.current.filter((e) => e.matchId !== matchId));
  }, [commit]);

  return { entries, loaded, storageError, assign, clearCourt, clearMatch };
}
