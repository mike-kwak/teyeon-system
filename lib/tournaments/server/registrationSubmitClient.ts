// 참가신청 제출 전용 Supabase 서버 클라이언트 (service_role).
//
//   ⚠ 이 모듈은 오직 app/api/tournaments/[slug]/register/route.ts 한 곳에서만 import 한다.
//     service_role 은 RLS 를 우회하는 최상위 권한이므로, 이름부터 용도를 좁혀 두고
//     클라이언트 인스턴스를 밖으로 내보내지 않는다(호출 함수만 export).
//   ⚠ 이 클라이언트로 하는 일은 submit_tournament_registration RPC 호출 '하나'뿐이다.
//     테이블 직접 조회·INSERT·UPDATE·DELETE 를 여기서 하지 않는다.
//   ⚠ SUPABASE_SERVICE_ROLE_KEY 는 NEXT_PUBLIC_ 접두어가 없으므로 클라이언트 번들에
//     들어가지 않는다. 절대 접두어를 붙이지 말 것.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertServerOnly } from './guard';

assertServerOnly('lib/tournaments/server/registrationSubmitClient');

export interface SubmitRpcArgs {
  p_slug: string;
  p_player1_name: string;
  p_player1_phone: string;
  p_player2_name: string;
  p_player2_phone: string;
  p_club_name: string | null;
  p_depositor_name: string;
  p_note: string | null;
  p_eligibility_confirmed: boolean;
  p_regulations_confirmed: boolean;
  p_privacy_agreed: boolean;
  p_media_notice_confirmed: boolean;
}

export type SubmitRpcOutcome =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; kind: 'not_configured' }
  | { ok: false; kind: 'rpc_error'; code: string; message: string };

let cached: SupabaseClient | null = null;

function client(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!cached) {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-teyeon-source': 'tournament-register-api' } },
    });
  }
  return cached;
}

/** 서버에 service_role 이 구성되어 있는지(= 제출을 처리할 수 있는지). */
export function isSubmitClientConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * 기존 submit_tournament_registration RPC 를 그대로 호출한다.
 *   정원(48/60)·대기·중복·advisory lock·동의 검증은 전부 RPC 안에서 처리되며 여기서 손대지 않는다.
 *   실패 시 RPC 가 던진 에러 코드 문자열을 그대로 올려보내 기존 문구 매핑을 유지한다.
 */
export async function callSubmitRegistrationRpc(args: SubmitRpcArgs): Promise<SubmitRpcOutcome> {
  const sb = client();
  if (!sb) return { ok: false, kind: 'not_configured' };

  const { data, error } = await sb.rpc('submit_tournament_registration', args);
  if (error) {
    return {
      ok: false,
      kind: 'rpc_error',
      code: String((error as { code?: unknown }).code || ''),
      message: String(error.message || ''),
    };
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, kind: 'rpc_error', code: '', message: 'INVALID_RESPONSE' };
  }
  return { ok: true, data: data as Record<string, unknown> };
}
