'use client';

// Handbook 사용자 학습 상태 — 읽음(read) + 최근 본(recent). 1차: localStorage.
//   · hydration mismatch 방지: mount 후 useEffect 에서만 로드(loaded 플래그).
//   · key 는 버전 접미사로 스키마 변경에 대비. 계정 연동은 후속(README §16 미결정).
//   · 가이드 "제작 상태"와는 완전히 분리 — 여기서는 사용자 학습 상태만 다룬다.

import { useCallback, useEffect, useState } from 'react';

const READ_KEY = 'teyeon:handbook:read:v1';
const RECENT_KEY = 'teyeon:handbook:recent:v1';
const RECENT_MAX = 8;

export interface RecentEntry { id: string; at: number }

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function saveJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 보조 기능 — 실패 무시 */ }
}

export function useHandbookProgress() {
  const [loaded, setLoaded] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<RecentEntry[]>([]);

  useEffect(() => {
    setReadIds(new Set(loadJson<string[]>(READ_KEY, [])));
    setRecent(loadJson<RecentEntry[]>(RECENT_KEY, []).filter((r) => r && r.id));
    setLoaded(true);
  }, []);

  const markRead = useCallback((id: string) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev); next.add(id);
      saveJson(READ_KEY, [...next]);
      return next;
    });
  }, []);

  const pushRecent = useCallback((id: string) => {
    setRecent((prev) => {
      const next = [{ id, at: Date.now() }, ...prev.filter((r) => r.id !== id)].slice(0, RECENT_MAX);
      saveJson(RECENT_KEY, next);
      return next;
    });
  }, []);

  return { loaded, readIds, recent, markRead, pushRecent };
}
