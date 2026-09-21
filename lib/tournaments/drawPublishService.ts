// 예선 DRAW 공개 관리 — 운영진 전용 RPC 래퍼.
//   ⚠ 서버가 최종 판정한다(locked 여부 · version · 권한). 화면은 결과를 다시 불러와 표시만 한다.
//   ⚠ LOCK(운영 잠금)과 PUBLISH(공개)는 다른 개념이다. unlock 하면 서버가 자동으로 비공개로 돌린다.

import { supabase } from '@/lib/supabase';

export interface DrawPublication {
  slug: string;
  tournamentStatus: string;
  drawStatus: 'draft' | 'locked';
  drawVersion: number;
  /** null = 비공개. */
  publishedAt: string | null;
}

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

function unwrap(data: unknown): Record<string, unknown> {
  const o = rec(data);
  if (o.ok === false) {
    const err = new Error(str(o.reason) || 'UNKNOWN') as Error & { reason?: string };
    err.reason = str(o.reason);
    throw err;
  }
  return o;
}

const isMissing = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return code === 'PGRST202' || code === '42883'
    || (/preliminary_draw/.test(msg) && /does not exist|schema cache|Could not find/.test(msg));
};

/** 공개 상태 조회. RPC 가 아직 없으면(migration 전) ready=false. */
export async function fetchDrawPublication(
  slug: string,
): Promise<{ ready: boolean; publication: DrawPublication | null }> {
  const { data, error } = await supabase.rpc('get_admin_preliminary_draw_publication', { p_slug: slug });
  if (error) {
    if (isMissing(error)) return { ready: false, publication: null };
    throw error;
  }
  if (data === null || data === undefined) return { ready: true, publication: null };
  const o = rec(data);
  return {
    ready: true,
    publication: {
      slug: str(o.slug),
      tournamentStatus: str(o.tournamentStatus),
      drawStatus: str(o.drawStatus) === 'locked' ? 'locked' : 'draft',
      drawVersion: num(o.drawVersion),
      publishedAt: typeof o.publishedAt === 'string' && o.publishedAt ? o.publishedAt : null,
    },
  };
}

export async function publishPreliminaryDraw(
  slug: string, expectedVersion: number,
): Promise<{ version: number; publishedAt: string | null; warnings: string[] }> {
  const { data, error } = await supabase.rpc('publish_preliminary_draw', {
    p_slug: slug, p_expected_version: expectedVersion,
  });
  if (error) throw error;
  const o = unwrap(data);
  return {
    version: num(o.version),
    publishedAt: typeof o.publishedAt === 'string' ? o.publishedAt : null,
    warnings: Array.isArray(o.warnings) ? o.warnings.map(String) : [],
  };
}

export async function unpublishPreliminaryDraw(
  slug: string, reason: string, expectedVersion: number,
): Promise<{ version: number }> {
  const { data, error } = await supabase.rpc('unpublish_preliminary_draw', {
    p_slug: slug, p_reason: reason, p_expected_version: expectedVersion,
  });
  if (error) throw error;
  const o = unwrap(data);
  return { version: num(o.version) };
}

/** 운영자용 한국어 한 줄. 내부 상세를 노출하지 않는다. */
export function drawPublishMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown; reason?: unknown } | null;
  const code = String(e?.code || '');
  const key = String(e?.reason || e?.message || '');
  if (code === '42501' || /not authorized/i.test(key)) return '권한이 없습니다. (CEO·ADMIN 전용)';
  if (isMissing(err)) return 'DRAW 공개 기능이 아직 적용되지 않았습니다. (migration 대기)';
  switch (key) {
    case 'draw_not_locked':        return '조편성을 확정(LOCK)한 뒤 공개할 수 있습니다.';
    case 'version_conflict':       return '그 사이 조편성이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.';
    case 'version_required':       return '화면을 새로고침한 뒤 다시 시도해 주세요.';
    case 'draw_already_published': return '이미 공개 중입니다.';
    case 'draw_not_published':     return '이미 비공개 상태입니다.';
    case 'validation_failed':      return '조편성 검증에 실패했습니다. 조편성 화면에서 확인해 주세요.';
    case 'reason_required':        return '공개 취소 사유를 입력해 주세요.';
    case 'tournament_not_found':   return '대회를 찾을 수 없습니다.';
    default:                       return '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }
}
