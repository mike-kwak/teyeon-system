// KDK 게스트 프로필 — 게스트 출생연도 저장/조회 (공식 동률 '연장자 우위' 계산 전용).
//   테이블: kdk_guest_profiles (supabase/add_kdk_guest_profiles.sql — RLS: CEO/ADMIN/OPERATOR).
//   호출 위치: /kdk 운영 화면(이름 매칭)·/kdk/display 전광판(읽기)만. 공개/일반 회원 화면 호출 금지.
//   개인정보 원칙: birth_year 는 순위 결정 목적 한정 — 어떤 공개 화면/DTO 에도 노출하지 않는다.
//   테이블 미생성(마이그레이션 전) 환경: 조회는 빈 결과(게스트 미제공 후순위 경로), 저장은 경고 후 무시.
import { supabase } from '../supabase';
import { normalizeBirthYear, type BirthYearStatus } from './officialRanking';
import { mergeAttendeeMeta, type AttendeeBirthYearDecision, type AttendeeMetaMap } from './attendeeMeta';

export type { AttendeeBirthYearDecision };

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

/**
 * attendee_meta 병합 저장의 유일한 구현 — read → mergeAttendeeMeta → write.
 * 두 저장 경로(이름 매칭 snapshot / 공식 확정 화면의 개별 결정)가 모두 이것을 거친다.
 * attendee_meta 는 컬럼 전체가 덮어써지므로, 여기서 기존 값을 읽어 병합하지 않으면
 * 다른 경로가 저장한 참가자 항목(특히 birthYearStatus:'declined')이 사라진다.
 * 테이블 미생성 환경에서는 조용히 생략한다(기존 관용 정책 유지 — 세션 진행을 막지 않는다).
 */
async function saveMergedAttendeeMeta(
  sessionId: string,
  clubId: string,
  decisions: Record<string, AttendeeBirthYearDecision>,
): Promise<void> {
  if (!sessionId || !clubId) throw new Error('session_id / club_id 가 없습니다.');
  if (Object.keys(decisions).length === 0) return;

  let current: AttendeeMetaMap = {};
  try {
    const { data, error } = await supabase
      .from('kdk_session_attendee_meta')
      .select('attendee_meta')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (error) throw error;
    current = (data?.attendee_meta || {}) as AttendeeMetaMap;
  } catch (err) {
    if (isMissingMetaTable(err)) {
      console.warn('[sessionAttendeeMeta] 테이블 미생성 — snapshot 저장 생략(SQL 적용 후 사용 가능)');
      return;
    }
    throw err;
  }

  const { error } = await supabase
    .from('kdk_session_attendee_meta')
    .upsert(
      {
        session_id: sessionId,
        club_id: clubId,
        attendee_meta: mergeAttendeeMeta(current, decisions),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'session_id' },
    );
  if (error) {
    if (isMissingMetaTable(error)) {
      console.warn('[sessionAttendeeMeta] 테이블 미생성 — snapshot 저장 생략(SQL 적용 후 사용 가능)');
      return;
    }
    throw error;
  }
}

/**
 * 세션 snapshot 저장(이름 매칭 확정) — { playerId: birthYear } 로 받은 게스트만 provided 로 기록한다.
 * 병합 저장이라 이 목록에 없는 참가자 항목은 그대로 남는다 —
 * 이미 '생년 미입력으로 진행'(declined)이 승인된 게스트를 이름 매칭 재저장으로 잃지 않는다.
 * 값이 없는(빈칸) 게스트는 '이번 입력에서 명시적으로 바꾸지 않음'으로 보고 기존 상태를 보존한다.
 */
export async function saveSessionBirthYearSnapshot(
  sessionId: string,
  clubId: string,
  birthYears: Record<string, number>,
): Promise<void> {
  if (!sessionId || !clubId) throw new Error('session_id / club_id 가 없습니다.');
  const decisions: Record<string, AttendeeBirthYearDecision> = {};
  for (const [playerId, year] of Object.entries(birthYears)) {
    const normalized = normalizeBirthYear(year);
    if (playerId && normalized !== null) decisions[playerId] = { birthYear: normalized };
  }
  await saveMergedAttendeeMeta(sessionId, clubId, decisions);
}

/** 세션 attendee_meta 한 참가자의 저장 형태. birthYearStatus 는 개인정보가 아닌 운영 상태값이다. */
export interface SessionAttendeeEntry {
  birthYear: number | null;
  birthYearStatus?: BirthYearStatus;
}

/**
 * 세션 snapshot 조회 — playerId → { birthYear, birthYearStatus }.
 * snapshot 의 유일한 reader 다(읽는 곳이 둘로 갈라져 상태 해석이 어긋나지 않게 한 곳으로 유지).
 * '아직 미입력'과 '운영자가 미입력 진행을 승인함'을 구분해 돌려준다.
 * 미생성/무권한이면 빈 Map — 기존과 동일하게 전원 미제공(후순위) + 미해결(확정 차단) 경로로 떨어진다.
 */
export async function getSessionAttendeeMeta(sessionId: string): Promise<Map<string, SessionAttendeeEntry>> {
  const map = new Map<string, SessionAttendeeEntry>();
  if (!sessionId) return map;
  try {
    const { data, error } = await supabase
      .from('kdk_session_attendee_meta')
      .select('attendee_meta')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (error) throw error;
    const meta = (data?.attendee_meta || {}) as Record<string, { birthYear?: unknown; birthYearStatus?: unknown }>;
    for (const [playerId, entry] of Object.entries(meta)) {
      const year = normalizeBirthYear(entry?.birthYear);
      const rawStatus = String(entry?.birthYearStatus || '');
      const status: BirthYearStatus | undefined =
        year !== null ? 'provided' : rawStatus === 'declined' ? 'declined' : undefined;
      if (year === null && status === undefined) continue; // 의미 없는 빈 항목은 무시
      map.set(playerId, { birthYear: year, ...(status ? { birthYearStatus: status } : {}) });
    }
  } catch (err) {
    if (!isMissingMetaTable(err)) console.warn('[sessionAttendeeMeta] 조회 실패:', err);
  }
  return map;
}

/**
 * 공식 확정 화면 — 참가자 1명의 출생연도 결정을 세션 snapshot 에 병합 저장.
 *   · { birthYear } → birthYear 저장 + status 'provided'
 *   · { declined }  → birthYear 제거 + status 'declined' (완전 동률에서 후순위로 확정)
 *
 * 정책상 declined 는 게스트 전용이다 — 회원 출생연도의 원본은 members."나이" 이고 서버 RPC 가
 * 그 값을 직접 쓰므로, 회원을 클라이언트에서 declined 처리하면 폰과 전광판의 입력 source 가 갈린다.
 * (호출부 app/kdk/page.tsx 에서 게스트만 이 경로를 타도록 막는다.)
 * 저장 자체는 saveSessionBirthYearSnapshot 과 동일한 병합 helper 를 재사용한다.
 */
export async function saveSessionAttendeeBirthYearDecision(
  sessionId: string,
  clubId: string,
  playerId: string,
  decision: AttendeeBirthYearDecision,
): Promise<void> {
  if (!playerId) throw new Error('player_id 가 없습니다.');
  // 공식 규칙(1900~현재 연도) 정규화는 저장 경계에서 강제한다 — 만 나이/미래 연도가 snapshot 에 박히지 않도록.
  let normalizedDecision: AttendeeBirthYearDecision = decision;
  if ('birthYear' in decision) {
    const normalized = normalizeBirthYear(decision.birthYear);
    if (normalized === null) throw new Error(`출생연도가 유효하지 않습니다: ${decision.birthYear}`);
    normalizedDecision = { birthYear: normalized };
  }
  await saveMergedAttendeeMeta(sessionId, clubId, { [playerId]: normalizedDecision });
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
