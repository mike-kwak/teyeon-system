// 공용 fetch 래퍼(lib/supabase.ts fetchWithRetry)의 재시도 예외 — 순수 함수만 둔다(단독 검증 대상).
//
//   배경 — fetchWithRetry 는 5xx · 네트워크 오류 때 같은 요청을 최대 3번 더 보낸다.
//     대회 경기 상태를 바꾸는 RPC 는 서버에 반영된 뒤 응답만 잃는 경우가 있다. 이때 같은 POST 를
//     다시 보내면 expected version 이 이미 지나가 version_conflict 로 돌아오고, 화면은 자기 성공을
//     실패로 오인한다(4F-4b QA 로 재현). 서버 RPC 는 version guard 로 두 번 반영을 막지만,
//     오인 자체는 막지 못한다 → 이 RPC 들만 자동 재시도에서 뺀다. 결과 판정은 화면이 재조회로 한다.
//
//   ⚠ 일반 POST 전체를 빼지 않는다. 읽기 RPC · GET · KDK · 그 밖의 쓰기는 기존 재시도 그대로다.
//   ⚠ RPC 경로를 **정확히 일치**로만 본다(이름 일부 일치 금지 — start_kdk_match 등과 섞이지 않게).
//   ⚠ 이름은 실제 호출 코드와 대조했다: lib/tournaments/matchAdminService.ts · bracketAdminService.ts.

/** 자동 재시도에서 빼는 조작 RPC — 대회 경기 한 건의 상태 · 결과를 바꾼다(expected version 사용). */
export const NO_RETRY_RPCS: ReadonlySet<string> = new Set([
  // 경기 진행
  'call_match',
  'uncall_match',
  'start_match',
  'complete_match',
  'complete_knockout_match',
  // 결과 수정 · 취소 · 복구 (본선 결과 수정 · 예선 결과 수정 · 취소 · 복구)
  //   ⚠ 본선 취소 · 복구 RPC 는 없다 — cancel_match 는 본선에 knockout_cancel_not_supported 를 돌려준다.
  'amend_knockout_match_score',
  'amend_completed_match_score',
  'cancel_match',
  'restore_cancelled_match',
]);

const RPC_PATH = /\/rest\/v1\/rpc\/([^/?#]+)$/;

/** 요청 대상 URL 문자열. Request · URL · 문자열 모두 받는다. */
const urlOf = (input: unknown): string | null => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === 'object' && typeof (input as { url?: unknown }).url === 'string') {
    return (input as { url: string }).url;
  }
  return null;
};

const methodOf = (input: unknown, init?: { method?: string } | null): string => {
  const fromInit = init?.method;
  if (fromInit) return fromInit.toUpperCase();
  const fromReq = input && typeof input === 'object' ? (input as { method?: unknown }).method : undefined;
  return typeof fromReq === 'string' ? fromReq.toUpperCase() : 'GET';
};

/** 이 요청을 자동 재시도하면 안 되는가 — 대상 조작 RPC 로 가는 POST 일 때만 true. */
export function isNoRetryRequest(input: unknown, init?: { method?: string } | null): boolean {
  if (methodOf(input, init) !== 'POST') return false;
  const raw = urlOf(input);
  if (!raw) return false;
  let path: string;
  try {
    path = new URL(raw, 'http://local.invalid').pathname;
  } catch {
    return false;
  }
  const m = RPC_PATH.exec(path);
  return !!m && NO_RETRY_RPCS.has(decodeURIComponent(m[1]));
}
