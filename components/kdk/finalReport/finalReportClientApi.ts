'use client';

// KDK FINAL REPORT 운영 화면 공통 — 서버 route 호출(사용자 토큰) · 안내 문구.
//   권한 · 공개본 생성은 서버가 매 요청 다시 판단한다. 이 파일은 service_role 키를 다루지 않는다.

import { supabase } from '@/lib/supabase';

export type FinalReportPostResult = { ok: boolean; status: number; j: any };

export async function postFinalReportAction(body: Record<string, unknown>): Promise<FinalReportPostResult> {
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) return { ok: false, status: 401, j: { ok: false, reason: 'login_required' } };
  try {
    const res = await fetch('/api/kdk/final-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    return { ok: res.ok && j?.ok === true, status: res.status, j };
  } catch {
    return { ok: false, status: 0, j: { ok: false, reason: 'network' } };
  }
}

/** 동시 편집 · 기록 정정으로 다시 불러와야 하는 거부 사유. */
export const CONFLICT_REASONS = new Set(['draft_conflict', 'revision_conflict', 'stale_source']);

export const FR_REASON_TEXT: Record<string, string> = {
  login_required: '로그인이 필요합니다. 다시 로그인해 주세요.',
  forbidden: 'FINAL REPORT 작성 권한이 없습니다(CEO · ADMIN · KDK 관리자).',
  not_configured: '서버 설정이 완료되지 않았습니다.',
  sql_not_applied: 'FINAL REPORT DB 설정이 아직 적용되지 않았습니다.',
  db_unavailable: '저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  network: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
  not_found: '공식 기록을 찾을 수 없습니다.',
  not_official: '공식 확정된 KDK 기록에서만 작성할 수 있습니다.',
  not_kdk: 'KDK 기록에서만 작성할 수 있습니다.',
  test: '테스트 기록에는 리포트를 만들 수 없습니다.',
  no_ranking: '공식 순위 기록이 없어 리포트를 만들 수 없습니다.',
  invalid_ranking: '공식 순위 기록 형식을 확인할 수 없습니다.',
  no_completed_matches: '완료된 경기 기록이 없어 리포트를 만들 수 없습니다.',
  draft_conflict: '다른 운영진이 먼저 저장했습니다. 최신 상태를 불러온 뒤 다시 저장해 주세요.',
  revision_conflict: '다른 운영진이 먼저 발행했습니다. 최신 상태를 불러온 뒤 다시 확인해 주세요.',
  stale_source: '편집 중에 공식 기록이 바뀌었습니다. 최신 기록을 불러와 다시 확인해 주세요.',
  needs_review: '공식 기록이 바뀌어 다시 확인해야 할 문구가 있습니다. STEP 1에서 확인해 주세요.',
  invalid_text: '공개할 수 없는 문구가 있습니다. 아래 안내를 확인해 주세요.',
  confirm_required: '발행 전 확인 체크가 필요합니다.',
  foreign_player: '이 기록에 없는 선수에게 연결된 스토리가 있습니다.',
  foreign_match: '이 기록에 없는 경기에 연결된 리뷰가 있습니다.',
  content_too_long: '글자 수 제한을 넘은 문구가 있습니다.',
  content_html: '꺾쇠(< >) 같은 HTML 문자는 쓸 수 없습니다.',
  content_too_many: '주요 경기는 최대 4개까지 고를 수 있습니다.',
  content_duplicate: '같은 선수 · 경기에 문구가 중복되어 있습니다.',
  content_tag_limit: '같은 운영진 태그는 한 경기에만 붙일 수 있습니다.',
  content_invalid: '문구 형식을 확인할 수 없습니다.',
  payload_leak: '공개본에 개인정보 형태가 섞여 발행을 막았습니다.',
  invalid_payload: '공개본 형식이 올바르지 않습니다.',
  payload_too_large: '공개본이 너무 커서 발행할 수 없습니다. 운영진 문구를 줄여 다시 시도하고, 계속되면 공식 기록의 선수 이름 · 경기 수가 비정상적으로 길거나 많은지 확인해 주세요.',
};
export const frFailText = (j: any): string => FR_REASON_TEXT[String(j?.reason || '')] || '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
