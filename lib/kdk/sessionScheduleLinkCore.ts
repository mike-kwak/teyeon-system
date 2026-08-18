// KDK 세션 ↔ Club Schedule(정모) 연결 — 순수 로직(DB 접근 없음).
//
//   연결의 단일 진실 소스는 kdk_session_meta.club_schedule_id 한 컬럼뿐이다.
//   (uuid, nullable, FK → club_schedules.id, ON DELETE SET NULL, 1:1 partial unique index)
//   이 모듈은 그 컬럼을 다루는 판정/가공만 담당하고, I/O 는 sessionScheduleLinkService 가 맡는다.
//   DB 접근이 없어 fixture(scripts/verify_club_schedule_kdk_link.mts)로 그대로 검증한다.
//
//   ⚠️ 연결 해제(unlink)는 '삭제'가 아니다. 해제는 club_schedule_id 를 NULL 로 바꾸는 것뿐이며
//   KDK 세션·경기·점수·순위·공식 기록(Archive)·정산(Finance)·참가자 메타는 일절 건드리지 않는다.

/** 정모 연결 관리 화면에 표시하는 KDK 세션 1건. 개인정보/경기 데이터는 담지 않는다. */
export interface KdkSessionLinkInfo {
  /** KDK 세션 id — matches.session_id / teyeon_archive_v1.id 와 동일한 문자열 키. */
  sessionId: string;
  /** Archive row 존재 여부(= 결과가 저장된 세션). */
  isArchived: boolean;
  /** 공식 확정 여부(teyeon_archive_v1.is_official). */
  isOfficial: boolean;
  /** kdk_session_meta.updated_at — 목록 정렬용. */
  updatedAt: string | null;
}

/** 조회 원본(느슨한 타입) — PostgREST 응답을 그대로 받는다. */
export interface RawSessionMetaRow {
  session_id?: unknown;
  updated_at?: unknown;
}
export interface RawArchiveRow {
  id?: unknown;
  is_official?: unknown;
}

/**
 * kdk_session_meta 행 + teyeon_archive_v1 행을 session_id 로 합친다.
 * Archive 조회가 실패해 빈 배열이 와도 목록 자체는 살아남아야 하므로(연결 관리가 막히면 안 됨)
 * archive 정보가 없으면 isArchived=false / isOfficial=false 로 둔다.
 * 정렬: updated_at 내림차순 → session_id 내림차순(최근 세션이 위). 결정적 순서 보장.
 */
export function mergeKdkSessionLinkInfo(
  metaRows: readonly RawSessionMetaRow[] | null | undefined,
  archiveRows: readonly RawArchiveRow[] | null | undefined,
): KdkSessionLinkInfo[] {
  const officialById = new Map<string, boolean>();
  for (const row of archiveRows || []) {
    const id = String(row?.id ?? '');
    if (id) officialById.set(id, row?.is_official === true);
  }

  const seen = new Set<string>();
  const list: KdkSessionLinkInfo[] = [];
  for (const row of metaRows || []) {
    const sessionId = String(row?.session_id ?? '');
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    const updatedAtRaw = row?.updated_at;
    list.push({
      sessionId,
      isArchived: officialById.has(sessionId),
      isOfficial: officialById.get(sessionId) === true,
      updatedAt: typeof updatedAtRaw === 'string' && updatedAtRaw ? updatedAtRaw : null,
    });
  }

  return list.sort((a, b) => {
    const at = a.updatedAt || '';
    const bt = b.updatedAt || '';
    if (at !== bt) return at < bt ? 1 : -1;
    return a.sessionId < b.sessionId ? 1 : -1;
  });
}

/**
 * 연결 해제 허용 여부 — 정책상 항상 허용한다.
 *   진행 완료 / 공식 확정 / Archive 저장 / Finance 정산 생성 상태여도 '연결만' 끊는 것은 안전하다.
 *   Archive·Finance 는 세션 id(teyeon_archive_v1.id / related_kdk_session_id)로 연결되며
 *   club_schedule_id 를 전혀 참조하지 않으므로 재계산·삭제가 일어나지 않는다.
 * 함수로 남겨 두는 이유: 정책이 코드로 고정되어야 회귀(예: 공식 세션 해제 차단)를 fixture 가 잡는다.
 */
export function canUnlinkKdkSession(_info: KdkSessionLinkInfo): boolean {
  return true;
}

/** 연결 해제 UPDATE 의 결과 해석 — 영향받은 row 가 없으면 이미 다른 곳에서 바뀐 것이다. */
export type UnlinkOutcome = 'unlinked' | 'already_changed';
export function resolveUnlinkOutcome(affectedRowCount: number): UnlinkOutcome {
  return affectedRowCount > 0 ? 'unlinked' : 'already_changed';
}

/**
 * 재연결 가능 여부 — 대상 정모에 이미 다른 세션이 연결돼 있으면 불가(1:1 partial unique index).
 * 같은 세션이 이미 그 정모에 연결돼 있으면 변경할 것이 없다.
 */
export type LinkPrecheck = 'ok' | 'schedule_occupied' | 'already_linked';
export function precheckLink(
  sessionId: string,
  scheduleId: string,
  occupiedBySessionId: string | null,
): LinkPrecheck {
  if (!occupiedBySessionId) return 'ok';
  if (occupiedBySessionId === sessionId) return 'already_linked';
  return 'schedule_occupied';
}

/** 화면 배지 문구 — 상세/피커가 같은 표현을 쓰도록 한 곳에서 관리(문구 drift 방지). */
export function kdkSessionStatusLabel(info: KdkSessionLinkInfo): string {
  if (info.isOfficial) return '공식 확정';
  if (info.isArchived) return '기록 저장됨';
  return '진행/미확정';
}
