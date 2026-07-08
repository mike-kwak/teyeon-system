// KDK 게스트 프로필 — 게스트 출생연도 저장/조회 (공식 동률 '연소자 우위' 계산 전용).
//   테이블: kdk_guest_profiles (supabase/add_kdk_guest_profiles.sql — RLS: CEO/ADMIN/OPERATOR).
//   호출 위치: /kdk 운영 화면(이름 매칭)·/kdk/display 전광판(읽기)만. 공개/일반 회원 화면 호출 금지.
//   개인정보 원칙: birth_year 는 순위 결정 목적 한정 — 어떤 공개 화면/DTO 에도 노출하지 않는다.
//   테이블 미생성(마이그레이션 전) 환경: 조회는 빈 결과(게스트 미제공 후순위 경로), 저장은 경고 후 무시.
import { supabase } from '../supabase';
import { normalizeBirthYear } from './officialRanking';

export interface GuestProfile {
  guestKey: string;
  displayName: string;
  birthYear: number | null;
}

export interface GuestProfileUpsertInput {
  guestKey: string;
  displayName: string;
  normalizedName: string;
  birthYear: number | null; // null = 미제공(허용). 유효하지 않은 값은 호출 전에 걸러야 한다.
}

const isMissingTable = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return code === '42P01' || code === 'PGRST205' ||
    (msg.includes('kdk_guest_profiles') && (msg.includes('does not exist') || msg.includes('schema cache')));
};

/**
 * guest_key 목록으로 저장된 프로필 batch 조회(N+1 금지 — 이름 매칭 화면에서 1회 호출).
 * 반환: guestKey → GuestProfile. 테이블 미생성/무권한이면 빈 Map(안전 폴백 — 미제공 취급).
 */
export async function getGuestProfilesByKeys(
  clubId: string,
  guestKeys: string[],
): Promise<Map<string, GuestProfile>> {
  const map = new Map<string, GuestProfile>();
  const keys = Array.from(new Set(guestKeys.filter(Boolean)));
  if (!clubId || keys.length === 0) return map;
  try {
    const { data, error } = await supabase
      .from('kdk_guest_profiles')
      .select('guest_key, display_name, birth_year')
      .eq('club_id', clubId)
      .in('guest_key', keys);
    if (error) throw error;
    for (const row of data || []) {
      map.set(String(row.guest_key), {
        guestKey: String(row.guest_key),
        displayName: String(row.display_name || ''),
        birthYear: normalizeBirthYear(row.birth_year),
      });
    }
  } catch (err) {
    if (!isMissingTable(err)) console.warn('[guestProfiles] 조회 실패:', err);
  }
  return map;
}

// ── 세션 birthYear snapshot (kdk_session_attendee_meta) ──────────────────────
//   영구 프로필은 이름 매칭 화면에서만 조회한다. 모바일 /kdk · 전광판 · 다른 운영자 기기는
//   세션 확정 시점에 박제된 이 snapshot 만 읽어 동일 순위를 계산한다
//   (프로필을 나중에 수정해도 진행 중/과거 세션 순위가 바뀌지 않음).

const isMissingMetaTable = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return code === '42P01' || code === 'PGRST205' ||
    (msg.includes('kdk_session_attendee_meta') && (msg.includes('does not exist') || msg.includes('schema cache')));
};

/** 세션 snapshot 저장 — { playerId: { birthYear } } (제공된 게스트만). 미생성 시 경고 후 생략. */
export async function saveSessionBirthYearSnapshot(
  sessionId: string,
  clubId: string,
  birthYears: Record<string, number>,
): Promise<void> {
  if (!sessionId || !clubId) throw new Error('session_id / club_id 가 없습니다.');
  const attendee_meta: Record<string, { birthYear: number }> = {};
  for (const [playerId, year] of Object.entries(birthYears)) {
    const normalized = normalizeBirthYear(year);
    if (playerId && normalized !== null) attendee_meta[playerId] = { birthYear: normalized };
  }
  const { error } = await supabase
    .from('kdk_session_attendee_meta')
    .upsert({ session_id: sessionId, club_id: clubId, attendee_meta, updated_at: new Date().toISOString() }, { onConflict: 'session_id' });
  if (error) {
    if (isMissingMetaTable(error)) {
      console.warn('[sessionAttendeeMeta] 테이블 미생성 — snapshot 저장 생략(SQL 적용 후 사용 가능)');
      return;
    }
    throw error;
  }
}

/** 세션 snapshot 조회 — playerId → birthYear. 미생성/무권한이면 빈 Map(미제공 후순위 경로). */
export async function getSessionBirthYearSnapshot(sessionId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!sessionId) return map;
  try {
    const { data, error } = await supabase
      .from('kdk_session_attendee_meta')
      .select('attendee_meta')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (error) throw error;
    const meta = (data?.attendee_meta || {}) as Record<string, { birthYear?: unknown }>;
    for (const [playerId, entry] of Object.entries(meta)) {
      const year = normalizeBirthYear(entry?.birthYear);
      if (year !== null) map.set(playerId, year);
    }
  } catch (err) {
    if (!isMissingMetaTable(err)) console.warn('[sessionAttendeeMeta] 조회 실패:', err);
  }
  return map;
}

/**
 * 게스트 프로필 batch upsert — (club_id, guest_key) unique 기준.
 * birthYear 는 이미 normalize 된 값(null 허용 — 비우면 null 로 갱신되어 '미제공' 상태로 되돌림).
 * 실패 시 throw — 호출부가 운영자에게 알리되 세션 생성 자체는 막지 않는 것을 권장.
 */
export async function upsertGuestProfiles(
  clubId: string,
  entries: GuestProfileUpsertInput[],
): Promise<void> {
  if (!clubId) throw new Error('club_id 가 없습니다.');
  const rows = entries
    .filter((e) => e.guestKey && e.displayName)
    .map((e) => {
      if (e.birthYear !== null && normalizeBirthYear(e.birthYear) === null) {
        throw new Error(`출생연도가 유효하지 않습니다: ${e.displayName} (${e.birthYear})`);
      }
      return {
        club_id: clubId,
        guest_key: e.guestKey,
        display_name: e.displayName,
        normalized_name: e.normalizedName,
        birth_year: e.birthYear,
        updated_at: new Date().toISOString(),
      };
    });
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('kdk_guest_profiles')
    .upsert(rows, { onConflict: 'club_id,guest_key' });
  if (error) {
    if (isMissingTable(error)) {
      // 마이그레이션 전 — 저장만 건너뛰고 세션 진행은 막지 않는다(운영 연속성).
      console.warn('[guestProfiles] 테이블 미생성 — 출생연도 저장 생략(SQL 적용 후 사용 가능)');
      return;
    }
    throw error;
  }
}
