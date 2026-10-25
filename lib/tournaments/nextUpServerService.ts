// 코트별 NEXT UP 서버 저장 — 본부 지정을 별도 PC 코트 전광판과 나눈다.
//
//   ⚠ 이 파일이 부르는 RPC 는 둘뿐이다: get_court_next_ups(조회) · set_court_next_ups(전체 교체).
//     권한 · 코트/경기 소속 · 중복 검사는 SQL 이 한다. 여기서 흉내 내지 않는다.
//   ⚠ 경기 운영과 무관하다 — 저장이 실패해도 투입 · 점수 · 타이머 · 본부의 NEXT UP(이 PC 저장)은 그대로다.
//   ⚠ SQL 이 아직 적용되지 않았으면 'unavailable' — 화면은 연동 기능을 숨긴다.

import { supabase } from '@/lib/supabase';

export interface ServerNextUp { courtNo: number; matchId: string; matchNo: number | null }

export type ServerNextUpLoad =
  | { kind: 'ok'; items: ServerNextUp[] }
  /** 권한 없음(관리자 로그인 아님) — RPC 가 null. */
  | { kind: 'forbidden' }
  /** SQL 미적용(함수 없음). */
  | { kind: 'unavailable' }
  | { kind: 'error' };

const errCode = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? '');
const isMissing = (e: unknown): boolean => {
  const msg = String((e as { message?: unknown } | null)?.message ?? '');
  return errCode(e) === 'PGRST202' || errCode(e) === '42883' || (/court_next_ups/.test(msg) && /Could not find|does not exist|schema cache/.test(msg));
};

export function parseServerNextUps(raw: unknown): ServerNextUp[] | null {
  const items = raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : null;
  if (!items) return null;
  return items.flatMap((x) => {
    const o = x as { courtNo?: unknown; matchId?: unknown; matchNo?: unknown } | null;
    return o && Number.isInteger(o.courtNo) && typeof o.matchId === 'string' && o.matchId !== ''
      ? [{ courtNo: o.courtNo as number, matchId: o.matchId, matchNo: Number.isInteger(o.matchNo) ? (o.matchNo as number) : null }]
      : [];
  }).sort((a, b) => a.courtNo - b.courtNo);
}

export async function fetchServerNextUps(slug: string): Promise<ServerNextUpLoad> {
  try {
    const { data, error } = await supabase.rpc('get_court_next_ups', { p_slug: slug });
    if (error) return isMissing(error) ? { kind: 'unavailable' } : errCode(error) === '42501' ? { kind: 'forbidden' } : { kind: 'error' };
    if (data === null) return { kind: 'forbidden' };
    const items = parseServerNextUps(data);
    return items ? { kind: 'ok', items } : { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}

export type ServerNextUpSave = { kind: 'ok' } | { kind: 'rejected'; reason: string } | { kind: 'error' };

/** 이 대회의 지정 전체를 items 로 바꾼다(빈 배열 = 모두 해제). */
export async function saveServerNextUps(slug: string, items: ReadonlyArray<{ courtNo: number; matchId: string }>): Promise<ServerNextUpSave> {
  try {
    const { data, error } = await supabase.rpc('set_court_next_ups', {
      p_slug: slug, p_items: items.map((e) => ({ courtNo: e.courtNo, matchId: e.matchId })),
    });
    if (error) return { kind: 'error' };
    const o = data as { ok?: unknown; reason?: unknown } | null;
    if (o?.ok === true) return { kind: 'ok' };
    return { kind: 'rejected', reason: typeof o?.reason === 'string' ? o.reason : 'unknown' };
  } catch {
    return { kind: 'error' };
  }
}

/** 두 지정 목록이 같은가(코트 → 경기 id). */
export const sameNextUps = (a: ReadonlyArray<{ courtNo: number; matchId: string }>, b: ReadonlyArray<{ courtNo: number; matchId: string }>): boolean => {
  const key = (x: ReadonlyArray<{ courtNo: number; matchId: string }>) => [...x].sort((p, q) => p.courtNo - q.courtNo).map((e) => `${e.courtNo}:${e.matchId}`).join(',');
  return key(a) === key(b);
};
