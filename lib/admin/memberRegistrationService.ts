// 관리자 — 신규 회원 등록 · 앱 계정(auth) 연결 service.
//   배경: '앱 계정' 탭의 역할 변경은 profiles.role 만 갱신하고 members 행을 만들지 않아,
//   로그인 계정(profiles)은 있어도 회원(members)이 없는 미연결 상태가 발생한다(예: 박일원).
//
//   안전 원칙:
//   · 회원 식별은 stable id(members.id / profiles.id=auth_user_id)만 사용 — 이름 부분 일치 자동 매칭 금지.
//   · 기존 회원 우선: 신규 생성 전 exact(nickname/email/auth_user_id) 후보를 반드시 조회해 제안.
//   · caller 가 임의 auth_user_id 를 넘겨도 여기서 "이미 다른 회원에 연결됐는지"를 재검증한다.
//     최종 방어선: DB 의 members_auth_user_id_unique 부분 unique index(supabase/add_members_auth_user_id.sql)
//     + 운영 RLS(관리자만 members 쓰기). 클라이언트 role 검사는 우회 가능하므로 UI(canEditAdminSettings)
//     + RLS 가 권한의 실제 경계다.
//   · 이 파일은 회원 초대/자동 승인/대량 업로드/감사 로그를 다루지 않는다(1차 범위 외).

import { supabase } from '../supabase';

export interface UnlinkedAccount {
  /** profiles.id = auth.users.id */
  id: string;
  email: string | null;
  nickname: string | null;
  avatar_url: string | null;
  role: string;
}

export interface MemberLite {
  id: string;
  nickname: string;
  role: string;
  email: string | null;
  auth_user_id: string | null;
  avatar_url: string | null;
}

export interface MemberCandidates {
  /** 입력 이름과 nickname 이 정확히 일치하는 기존 회원(트림 비교). */
  byName: MemberLite[];
  /** 입력 이메일과 email 이 정확히 일치하는 기존 회원. */
  byEmail: MemberLite[];
  /** 선택한 auth_user_id 가 이미 연결된 기존 회원(있으면 신규 연결 차단 대상). */
  byAuth: MemberLite[];
}

const MEMBER_COLS = 'id, nickname, role, email, auth_user_id, avatar_url';

/** 아직 members 에 연결되지 않은 앱 계정(profiles) 목록. */
export async function fetchUnlinkedAccounts(): Promise<UnlinkedAccount[]> {
  const [profilesRes, membersRes] = await Promise.all([
    supabase.from('profiles').select('id, email, nickname, avatar_url, role'),
    supabase.from('members').select('auth_user_id'),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (membersRes.error) throw membersRes.error;
  const linked = new Set(
    (membersRes.data || []).map((m: any) => m.auth_user_id).filter(Boolean),
  );
  return ((profilesRes.data || []) as UnlinkedAccount[]).filter((p) => !linked.has(p.id));
}

/** 신규 생성/연결 전 기존 회원 exact 후보 조회 — 부분 일치는 조회하지 않는다. */
export async function findMemberCandidates(input: {
  name?: string | null;
  email?: string | null;
  authUserId?: string | null;
}): Promise<MemberCandidates> {
  const name = (input.name || '').trim();
  const email = (input.email || '').trim();
  const authUserId = (input.authUserId || '').trim();
  const [byName, byEmail, byAuth] = await Promise.all([
    name
      ? supabase.from('members').select(MEMBER_COLS).eq('nickname', name)
      : Promise.resolve({ data: [], error: null }),
    email
      ? supabase.from('members').select(MEMBER_COLS).eq('email', email)
      : Promise.resolve({ data: [], error: null }),
    authUserId
      ? supabase.from('members').select(MEMBER_COLS).eq('auth_user_id', authUserId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (byName.error) throw byName.error;
  if (byEmail.error) throw byEmail.error;
  if (byAuth.error) throw byAuth.error;
  return {
    byName: (byName.data || []) as MemberLite[],
    byEmail: (byEmail.data || []) as MemberLite[],
    byAuth: (byAuth.data || []) as MemberLite[],
  };
}

/** 해당 auth 계정이 이미 다른 회원에 연결되어 있으면 그 회원을 반환(없으면 null). */
async function findMemberByAuthUserId(authUserId: string): Promise<MemberLite | null> {
  const { data, error } = await supabase
    .from('members').select(MEMBER_COLS).eq('auth_user_id', authUserId).limit(1);
  if (error) throw error;
  return ((data || [])[0] as MemberLite) || null;
}

/**
 * 기존 회원에 앱 계정을 연결한다.
 * 검증: ① 그 계정이 이미 다른 회원에 연결 → 차단 ② 대상 회원이 이미 다른 계정에 연결 → 차단
 * (해제 후 재연결하도록 안내). 이메일이 오면 회원 email 도 함께 채운다(기존 값 유지 원칙: 빈 경우만).
 */
export async function linkAccountToMember(input: {
  memberId: string;
  authUserId: string;
  email?: string | null;
}): Promise<MemberLite> {
  const { memberId, authUserId } = input;
  if (!memberId || !authUserId) throw new Error('회원과 앱 계정을 모두 선택해 주세요.');

  const already = await findMemberByAuthUserId(authUserId);
  if (already && already.id !== memberId) {
    throw new Error(`이 앱 계정은 이미 '${already.nickname}' 회원에 연결되어 있습니다.`);
  }

  const { data: targetRows, error: targetErr } = await supabase
    .from('members').select(MEMBER_COLS).eq('id', memberId).limit(1);
  if (targetErr) throw targetErr;
  const target = (targetRows || [])[0] as MemberLite | undefined;
  if (!target) throw new Error('대상 회원을 찾을 수 없습니다.');
  if (target.auth_user_id && target.auth_user_id !== authUserId) {
    throw new Error(`'${target.nickname}' 회원은 이미 다른 앱 계정에 연결되어 있습니다. 먼저 연결을 해제해 주세요.`);
  }

  const payload: Record<string, unknown> = { auth_user_id: authUserId };
  const email = (input.email || '').trim();
  if (email && !target.email) payload.email = email; // 기존 이메일은 덮어쓰지 않음(빈 경우만 보충)

  const { data, error } = await supabase
    .from('members').update(payload).eq('id', memberId).select(MEMBER_COLS).single();
  if (error) {
    // DB 부분 unique index 위반(동시성 등) → 사용자 친화 메시지
    if (String(error.code) === '23505') throw new Error('이 앱 계정은 이미 다른 회원에 연결되어 있습니다.');
    throw error;
  }
  return data as MemberLite;
}

/**
 * 신규 회원을 생성한다(기존 회원이 없을 때만 — 호출 전 findMemberCandidates 로 확인·안내).
 * authUserId 가 있으면 생성과 동시에 연결하며, 이미 다른 회원에 연결된 계정이면 차단한다.
 * 이름 exact 중복은 여기서도 재검증해 오류로 반환한다(임의 첫 번째 회원 선택 금지).
 */
export async function createMember(input: {
  nickname: string;
  role: string;
  email?: string | null;
  authUserId?: string | null;
  avatarUrl?: string | null;
  allowDuplicateName?: boolean; // UI 에서 동일 이름 경고를 사용자가 확인한 경우에만 true
}): Promise<MemberLite> {
  const nickname = (input.nickname || '').trim();
  const role = (input.role || '').trim();
  if (!nickname) throw new Error('회원 이름을 입력해 주세요.');
  if (!role) throw new Error('회원 구분을 선택해 주세요.');

  const authUserId = (input.authUserId || '').trim() || null;
  const email = (input.email || '').trim() || null;

  if (authUserId) {
    const already = await findMemberByAuthUserId(authUserId);
    if (already) throw new Error(`이 앱 계정은 이미 '${already.nickname}' 회원에 연결되어 있습니다.`);
  }
  if (!input.allowDuplicateName) {
    const { data: sameName, error } = await supabase
      .from('members').select('id, nickname').eq('nickname', nickname).limit(1);
    if (error) throw error;
    if ((sameName || []).length > 0) {
      throw new Error(`같은 이름의 회원('${nickname}')이 이미 있습니다. 기존 회원 연결을 먼저 확인해 주세요.`);
    }
  }

  const payload: Record<string, unknown> = { nickname, role };
  if (email) payload.email = email;
  if (authUserId) payload.auth_user_id = authUserId;
  if (input.avatarUrl) payload.avatar_url = input.avatarUrl;

  const { data, error } = await supabase
    .from('members').insert(payload).select(MEMBER_COLS).single();
  if (error) {
    if (String(error.code) === '23505') throw new Error('이 앱 계정은 이미 다른 회원에 연결되어 있습니다.');
    throw error;
  }
  return data as MemberLite;
}

/** 회원의 앱 계정 연결을 해제한다(오연결 복구용 — 확인 모달은 UI 가 담당). */
export async function unlinkAccountFromMember(memberId: string): Promise<void> {
  if (!memberId) throw new Error('대상 회원이 없습니다.');
  const { error } = await supabase
    .from('members').update({ auth_user_id: null }).eq('id', memberId);
  if (error) throw error;
}
