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
//
//   P0 개인정보 최소화: email 등 민감 컬럼 조회는 관리자 전용 RPC(admin_find_member_candidates /
//   admin_list_profiles)로 수행한다. RPC 미적용(컬럼 privilege 적용 전) 환경에서는 기존 직접 조회로
//   폴백해 무중단 배포를 보장한다. update/insert 의 반환(select)은 email 을 제외한 안전 컬럼만 쓴다.

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

// 직접 조회(폴백 전용 — 컬럼 privilege 적용 전까지만 성공) / 반환용 안전 컬럼(email 제외).
const MEMBER_COLS = 'id, nickname, role, email, auth_user_id, avatar_url';
const MEMBER_RETURN_COLS = 'id, nickname, role, auth_user_id, avatar_url';

// RPC 미존재(마이그레이션 전) 판정 — PGRST202 / 42883.
const isMissingFunction = (err: unknown): boolean => {
  const code = String((err as { code?: unknown } | null)?.code || '');
  return code === 'PGRST202' || code === '42883';
};

// 클럽 식별자 — 홈/멤버 목록 등이 .eq('club_id', …) 로 조회하므로 신규 회원도 반드시 설정한다.
// (프로젝트 공통 관용구: app/page.tsx, app/members/page.tsx 등과 동일한 env+fallback 방식)
const CLUB_ID = process.env.NEXT_PUBLIC_CLUB_ID || '512d047d-a076-4080-97e5-6bb5a2c07819';

/**
 * 관리자 전용 회원 exact 검색 RPC 호출. 반환 null = RPC 미적용(폴백 필요).
 * 조건은 OR 매칭이므로 호출측이 필요한 키만 넘긴다.
 */
async function findMembersViaAdminRpc(input: {
  nickname?: string | null;
  email?: string | null;
  authUserId?: string | null;
  memberId?: string | null;
}): Promise<MemberLite[] | null> {
  const { data, error } = await supabase.rpc('admin_find_member_candidates', {
    p_nickname: input.nickname || null,
    p_email: input.email || null,
    p_auth_user_id: input.authUserId || null,
    p_member_id: input.memberId || null,
  });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw error;
  }
  return (Array.isArray(data) ? data : []) as MemberLite[];
}

/** 아직 members 에 연결되지 않은 앱 계정(profiles) 목록. */
export async function fetchUnlinkedAccounts(): Promise<UnlinkedAccount[]> {
  // profiles email 은 관리자 전용 — RPC 우선, 미적용 시 직접 조회 폴백.
  let profileRows: UnlinkedAccount[] | null = null;
  const { data: rpcRows, error: rpcErr } = await supabase.rpc('admin_list_profiles');
  if (!rpcErr && Array.isArray(rpcRows)) {
    profileRows = rpcRows as UnlinkedAccount[];
  } else if (rpcErr && !isMissingFunction(rpcErr)) {
    throw rpcErr;
  }
  if (profileRows === null) {
    const { data, error } = await supabase.from('profiles').select('id, email, nickname, avatar_url, role');
    if (error) throw error;
    profileRows = (data || []) as UnlinkedAccount[];
  }
  const { data: memberRows, error: membersErr } = await supabase.from('members').select('auth_user_id');
  if (membersErr) throw membersErr;
  const linked = new Set(
    (memberRows || []).map((m: { auth_user_id: string | null }) => m.auth_user_id).filter(Boolean),
  );
  return profileRows.filter((p) => !linked.has(p.id));
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

  // RPC 경로(관리자 전용 — email 매칭 포함). 키별로 분리 호출해 기존 byName/byEmail/byAuth 구분 유지.
  const [rpcByName, rpcByEmail, rpcByAuth] = await Promise.all([
    name ? findMembersViaAdminRpc({ nickname: name }) : Promise.resolve([] as MemberLite[]),
    email ? findMembersViaAdminRpc({ email }) : Promise.resolve([] as MemberLite[]),
    authUserId ? findMembersViaAdminRpc({ authUserId }) : Promise.resolve([] as MemberLite[]),
  ]);
  if (rpcByName !== null && rpcByEmail !== null && rpcByAuth !== null) {
    return { byName: rpcByName, byEmail: rpcByEmail, byAuth: rpcByAuth };
  }

  // 폴백(마이그레이션 전): 기존 직접 조회.
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
  const viaRpc = await findMembersViaAdminRpc({ authUserId });
  if (viaRpc !== null) return viaRpc[0] || null;
  const { data, error } = await supabase
    .from('members').select(MEMBER_COLS).eq('auth_user_id', authUserId).limit(1);
  if (error) throw error;
  return ((data || [])[0] as MemberLite) || null;
}

/** memberId 로 회원 1명 조회(연결 검증용 — email 포함 필요). */
async function findMemberById(memberId: string): Promise<MemberLite | null> {
  const viaRpc = await findMembersViaAdminRpc({ memberId });
  if (viaRpc !== null) return viaRpc[0] || null;
  const { data, error } = await supabase
    .from('members').select(MEMBER_COLS).eq('id', memberId).limit(1);
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

  const target = await findMemberById(memberId);
  if (!target) throw new Error('대상 회원을 찾을 수 없습니다.');
  if (target.auth_user_id && target.auth_user_id !== authUserId) {
    throw new Error(`'${target.nickname}' 회원은 이미 다른 앱 계정에 연결되어 있습니다. 먼저 연결을 해제해 주세요.`);
  }

  const payload: Record<string, unknown> = { auth_user_id: authUserId };
  const email = (input.email || '').trim();
  if (email && !target.email) payload.email = email; // 기존 이메일은 덮어쓰지 않음(빈 경우만 보충)

  // 반환은 안전 컬럼만(email 제외) — 컬럼 privilege 적용 후에도 update().select() 가 실패하지 않게.
  const { data, error } = await supabase
    .from('members').update(payload).eq('id', memberId).select(MEMBER_RETURN_COLS).single();
  if (error) {
    // DB 부분 unique index 위반(동시성 등) → 사용자 친화 메시지
    if (String(error.code) === '23505') throw new Error('이 앱 계정은 이미 다른 회원에 연결되어 있습니다.');
    throw error;
  }
  return { ...(data as Omit<MemberLite, 'email'>), email: email || target.email || null };
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

  // club_id 누락 시 홈/멤버 목록 집계에서 빠지므로 null 저장 대신 명확히 실패시킨다.
  if (!CLUB_ID) throw new Error('클럽 설정(club_id)을 찾을 수 없어 회원을 생성할 수 없습니다.');

  const payload: Record<string, unknown> = { nickname, role, club_id: CLUB_ID };
  if (email) payload.email = email;
  if (authUserId) payload.auth_user_id = authUserId;
  if (input.avatarUrl) payload.avatar_url = input.avatarUrl;

  const { data, error } = await supabase
    .from('members').insert(payload).select(MEMBER_RETURN_COLS).single();
  if (error) {
    if (String(error.code) === '23505') throw new Error('이 앱 계정은 이미 다른 회원에 연결되어 있습니다.');
    throw error;
  }
  return { ...(data as Omit<MemberLite, 'email'>), email };
}

/** 회원의 앱 계정 연결을 해제한다(오연결 복구용 — 확인 모달은 UI 가 담당). */
export async function unlinkAccountFromMember(memberId: string): Promise<void> {
  if (!memberId) throw new Error('대상 회원이 없습니다.');
  const { error } = await supabase
    .from('members').update({ auth_user_id: null }).eq('id', memberId);
  if (error) throw error;
}
