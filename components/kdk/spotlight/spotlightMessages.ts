// MATCH SPOTLIGHT 관리 화면 안내 문구 — 서버 reason → 운영진이 읽는 한국어. (관리 화면 · 운영진 편집기 공통)

export const REASON_TEXT: Record<string, string> = {
  login_required: '로그인이 필요합니다.',
  forbidden: 'CEO · ADMIN · KDK 관리자만 사용할 수 있습니다.',
  not_configured: '서버 설정(service role)이 없어 생성할 수 없습니다.',
  sql_not_applied: 'SPOTLIGHT SQL 이 아직 적용되지 않았습니다.',
  db_unavailable: '데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  visibility_unavailable: '회원 공개 범위를 확인하지 못해 중단했습니다(비공개 보호).',
  session_not_found: '세션 경기를 찾을 수 없습니다.',
  no_predictable_matches: '시작 전(대기) 경기 중 분석할 수 있는 경기가 없습니다.',
  stale_matches: '경기 상태가 바뀌어 저장하지 못했습니다. 다시 시도해 주세요.',
  ledger_unhealthy: '경기 이력 기록 장치가 비활성 상태라 생성을 막았습니다.',
  session_archived: '이미 종료(Archive)된 세션입니다.',
  not_latest: '더 최근 생성본이 있습니다. 최신본을 공개해 주세요.',
  not_publishable: '공개할 수 없는 상태입니다.',
  payload_too_large: '입력한 내용이 너무 깁니다.',
  // 운영진 관전 포인트 · 운영진 PICK 검증
  operator_invalid: '운영진 입력 형식이 올바르지 않습니다.',
  operator_too_many: '운영진 관전 포인트는 최대 8개까지 넣을 수 있습니다.',
  operator_text_empty: '관전 포인트 문구가 비어 있습니다.',
  operator_text_too_long: '관전 포인트는 120자 이내로 줄여 주세요.',
  operator_html: '관전 포인트에 < > 기호는 쓸 수 없습니다.',
  operator_unknown_match: '공개 대상이 아닌 경기입니다(시작 · 선수 변경으로 제외됐을 수 있습니다).',
  operator_duplicate_match: '같은 경기에 관전 포인트가 두 개 있습니다. 하나로 합쳐 주세요.',
  operator_player_mismatch: '문구에 그 경기 선수가 아닌 이름이 들어 있습니다. 경기 연결이나 문구를 확인해 주세요.',
  pick_unknown_match: '운영진 PICK 으로 고른 경기가 공개 대상이 아닙니다.',
  pick_already_selected: '이미 TOP 에 있는 경기입니다.',
  pick_no_analysis: '공식 분석 유형(RIVAL · CLOSE · HOT STREAK · POWER)이 없는 경기는 운영진 PICK 으로 넣을 수 없습니다.',
  pick_private: '비공개 회원의 기록이 근거인 경기라 운영진 PICK 으로 넣을 수 없습니다.',
  pick_not_waiting: '이미 시작했거나 대기 상태가 아닌 경기는 운영진 PICK 으로 넣을 수 없습니다.',
  pick_replace_required: 'TOP 5 가 가득 찼습니다. 교체할 경기를 골라 주세요.',
  pick_replace_invalid: '교체할 경기가 현재 TOP 에 없습니다.',
};

// no_predictable_matches 의 세부 원인(서버 detail) — 판정은 서버/DB 그대로, 안내만 구분한다.
const NO_PREDICTABLE_TEXT: Record<string, string> = {
  no_waiting: '시작 전(대기) 경기가 없습니다. 대기 중인 경기만 분석합니다.',
  invalid_players: '대기 경기의 선수 4명 정보가 온전하지 않아 분석할 수 없습니다.',
  uncertified: '대기 경기가 있지만, SPOTLIGHT 적용 이전에 만든 대진이라 시작 전 상태를 증명할 수 없어 분석하지 않았습니다. 새로 생성한 대진부터 사용할 수 있습니다.',
  blocked: '대기 경기가 있지만, 시작·변경 이력이 확인되어 예측할 수 없습니다(한 번 시작했거나 이력 기록이 끊긴 경기).',
};

export function spotlightFailText(j: { reason?: unknown; detail?: unknown; matchNo?: unknown }, status: number): string {
  const reason = String(j?.reason ?? '');
  if (reason === 'no_predictable_matches') {
    return NO_PREDICTABLE_TEXT[String(j?.detail ?? '')] || REASON_TEXT.no_predictable_matches;
  }
  const base = REASON_TEXT[reason] || `처리하지 못했습니다(${reason || status}).`;
  const no = Number(j?.matchNo);
  return Number.isInteger(no) && no > 0 ? `${base} (${no}경기)` : base;
}
