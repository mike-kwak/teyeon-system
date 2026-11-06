'use client';

// MATCH SPOTLIGHT 관리 화면 공통 — 서버 route 호출(사용자 토큰) · 클립보드 복사.

import { supabase } from '@/lib/supabase';

export type SpotlightPostResult = { ok: boolean; status: number; j: any };

/** /api/kdk/spotlight 호출 — 권한은 서버가 다시 확인한다. 로그인 없으면 status 401 · reason login_required. */
export async function postSpotlightAction(body: Record<string, unknown>): Promise<SpotlightPostResult> {
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) return { ok: false, status: 401, j: { ok: false, reason: 'login_required' } };
  const res = await fetch('/api/kdk/spotlight', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok && j?.ok === true, status: res.status, j };
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
}

/** 기기 저장(브라우저 저장소) — 실패해도 동작에 영향 없음. 운영진 원문 메모는 서버로 보내지 않고 여기만 둔다. */
export function readLocal<T>(key: string): T | null {
  try { const v = window.localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
export function writeLocal(key: string, value: unknown): void {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* 저장 실패 무시 */ }
}
