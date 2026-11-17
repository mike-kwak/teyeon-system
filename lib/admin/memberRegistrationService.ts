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
import { splitMemberRoles, WITHDRAWN_ROLE } from '../members/membershipStatus';

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

// ═══════════════════ 클럽 회원 자격(members.role) ↔ 앱 권한(profiles.role) ═══════════════════
//   두 값은 별개 개념이다. 이 구역은 "불일치를 보여 주고, 관리자가 확인한 변경만 안전하게 저장"한다.
//   · 자동 승격 없음. 비표준 값은 원본 그대로 표시하고 정규화 · 저장하지 않는다.
//   · 저장은 기존 서버 경로(RLS: CEO·ADMIN 만 + P0-C: 본인 변경 금지 · CEO 는 CEO 만)를 그대로 탄다.
//     여기서는 "현재 값 비교 후 UPDATE + 실제 변경 행 확인"을 더해 오래된 화면 · 동시 수정 · 조용한 RLS 거부(0행)를
//     실패로 처리한다.

/** AuthContext 가 인식하는 앱 권한 6종(정확한 대문자 값). */
export const APP_ROLES = ['CEO', 'ADMIN', 'OPERATOR', 'FINANCE_MANAGER', 'MEMBER', 'GUEST'] as const;
export type AppRole = (typeof APP_ROLES)[number];
/** 관리자 화면에서 새로 부여할 수 있는 값 — 기존 범위(4종) 유지. OPERATOR · FINANCE_MANAGER 는 표시만. */
export const GRANTABLE_APP_ROLES = ['GUEST', 'MEMBER', 'ADMIN', 'CEO'] as const;
export type GrantableAppRole = (typeof GRANTABLE_APP_ROLES)[number];

export interface AppRoleInfo {
  /** profiles.role 원본 값(null = 값 없음). */
  raw: string | null;
  /** 원본이 6종 중 하나와 정확히 같을 때 그 값, 아니면 null(비표준). */
  exact: AppRole | null;
  /** 앱(AuthContext.normalizeRole)이 실제로 적용하는 권한 — 대문자 · 공백 제거 후 6종 외는 GUEST. */
  effective: AppRole;
  /** 이 화면에서 역할 선택(변경)이 가능한 값인가 — 정확한 GRANTABLE 값일 때만. */
  editable: boolean;
}

export function describeAppRole(raw: string | null | undefined): AppRoleInfo {
  const value = raw ?? null;
  const exact = (APP_ROLES as readonly string[]).includes(value ?? '') ? (value as AppRole) : null;
  const upper = (value ?? '').trim().toUpperCase();
  const effective = (APP_ROLES as readonly string[]).includes(upper) ? (upper as AppRole) : 'GUEST';
  const editable = exact !== null && (GRANTABLE_APP_ROLES as readonly string[]).includes(exact);
  return { raw: value, exact, effective, editable };
}

/** 클럽 직책 중 회원 자격으로 보는 값(운영진 직책 포함). */
const CLUB_MEMBER_TOKENS = ['정회원', '준회원', '회장', '부회장', '총무', '재무', '경기', '섭외', 'CEO'];

export type ClubStanding = 'withdrawn' | 'member' | 'guest' | 'unknown';

/** members.role(쉼표 다중값 가능) → 클럽 자격 분류. 탈회가 있으면 탈회 우선. */
export function clubStanding(memberRole: string | null | undefined): ClubStanding {
  const toks = splitMemberRoles(memberRole);
  if (toks.includes(WITHDRAWN_ROLE)) return 'withdrawn';
  if (toks.some((t) => CLUB_MEMBER_TOKENS.includes(t))) return 'member';
  if (toks.includes('게스트')) return 'guest';
  return 'unknown';
}

/** 앱 권한 조회 상태 — 'ready' 일 때만 판정한다(로딩 · 실패를 GUEST 로 보지 않는다). */
export type AppRoleLookup =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; byId: ReadonlyMap<string, string | null> };

export type RoleSyncKind =
  | 'unlinked'               // 계정 미연결(앱 권한 없음 — 자동 연결 금지)
  | 'pending'                // 앱 권한 조회 중/실패 — 판정 보류
  | 'no_profile'             // 연결됐지만 앱 계정(profiles) 행 없음 ⚠
  | 'promotable'             // 회원 자격 + 앱 권한이 정확히 GUEST ⚠ → [MEMBER 로 변경] 가능
  | 'nonstandard'            // 비표준 앱 권한 값 ⚠ (보호 — 변경 버튼 없음)
  | 'guest_with_access'      // 게스트 회원인데 앱 권한 MEMBER 이상 ⚠ (경고만, 자동 강등 없음)
  | 'withdrawn_with_access'  // 탈회 회원인데 앱 권한 유지 ⚠ (안내만)
  | 'ok';

export interface RoleSync {
  kind: RoleSyncKind;
  app: AppRoleInfo | null;
  /** ⚠ 불일치로 집계할 상태인가. */
  warn: boolean;
}

export function computeRoleSync(
  member: { role: string | null; auth_user_id?: string | null },
  lookup: AppRoleLookup,
): RoleSync {
  if (!member.auth_user_id) return { kind: 'unlinked', app: null, warn: false };
  if (lookup.state !== 'ready') return { kind: 'pending', app: null, warn: false };
  if (!lookup.byId.has(member.auth_user_id)) return { kind: 'no_profile', app: null, warn: true };
  const app = describeAppRole(lookup.byId.get(member.auth_user_id));
  const standing = clubStanding(member.role);
  if (app.exact === null) return { kind: 'nonstandard', app, warn: true };
  if (standing === 'withdrawn') {
    return app.exact === 'GUEST' ? { kind: 'ok', app, warn: false } : { kind: 'withdrawn_with_access', app, warn: true };
  }
  if (standing === 'member' && app.exact === 'GUEST') return { kind: 'promotable', app, warn: true };
  if (standing === 'guest' && app.exact !== 'GUEST') return { kind: 'guest_with_access', app, warn: true };
  return { kind: 'ok', app, warn: false };
}

/** 역할 저장 실패 — reason 으로 안내 문구를 고른다. 성공 메시지를 띄우면 안 되는 모든 경우. */
export type RoleUpdateReason = 'not_applied' | 'forbidden' | 'precondition' | 'invalid' | 'unknown';
export class RoleUpdateError extends Error {
  reason: RoleUpdateReason;
  constructor(reason: RoleUpdateReason, message: string) {
    super(message);
    this.name = 'RoleUpdateError';
    this.reason = reason;
  }
}

// DI: 검증 스크립트가 가짜 클라이언트를 넣을 수 있게 한다(기본은 앱 supabase).
type Db = { from: (table: string) => any };

const toRoleUpdateError = (error: any): RoleUpdateError => {
  const code = String(error?.code || '');
  const msg = String(error?.message || error?.details || '');
  if (code === '42501' || /permission|권한/i.test(msg)) {
    return new RoleUpdateError('forbidden', `서버가 변경을 거부했습니다: ${msg || '권한 없음'}`);
  }
  return new RoleUpdateError('unknown', `저장 실패: ${msg || code || '알 수 없는 오류'}`);
};

const NOT_APPLIED_MSG = '변경되지 않았습니다. 다른 곳에서 이미 바뀌었거나 변경 권한이 없습니다. 최신 상태를 다시 불러옵니다.';

/**
 * 앱 권한(profiles.role) 변경 — 현재 값이 expectedRaw 와 같을 때만 UPDATE, 실제 변경 1행 확인.
 *   next 는 GRANTABLE 4종만. expectedRaw 가 비표준 · OPERATOR · FINANCE_MANAGER 면 거부(보호 상태).
 */
export async function setAppRole(
  input: { profileId: string; expectedRaw: string | null; next: GrantableAppRole },
  db: Db = supabase,
): Promise<{ id: string; role: string }> {
  const { profileId, expectedRaw, next } = input;
  if (!profileId) throw new RoleUpdateError('invalid', '대상 계정이 없습니다.');
  if (!(GRANTABLE_APP_ROLES as readonly string[]).includes(next)) {
    throw new RoleUpdateError('invalid', `이 화면에서 부여할 수 없는 권한입니다: ${next}`);
  }
  if (!describeAppRole(expectedRaw).editable) {
    throw new RoleUpdateError('invalid', '보호된 권한(또는 비표준 값)은 이 화면에서 변경할 수 없습니다.');
  }
  if (expectedRaw === next) throw new RoleUpdateError('invalid', '이미 같은 권한입니다.');
  const { data, error } = await db
    .from('profiles')
    .update({ role: next })
    .eq('id', profileId)
    .eq('role', expectedRaw as string)
    .select('id, role');
  if (error) throw toRoleUpdateError(error);
  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== 1 || rows[0]?.role !== next) throw new RoleUpdateError('not_applied', NOT_APPLIED_MSG);
  return rows[0] as { id: string; role: string };
}

/**
 * 연결된 회원 계정의 앱 권한을 GUEST → MEMBER 로(관리자 확인 후 호출).
 *   저장 직전 DB 에서 다시 확인: 회원이 그 계정에 연결돼 있고 · 회원 자격(정회원/준회원/운영진 직책)이며 ·
 *   앱 권한이 정확히 'GUEST' 일 때만. 하나라도 다르면 변경 0건으로 중단.
 */
export async function promoteLinkedMemberToMember(
  input: { memberId: string; profileId: string },
  db: Db = supabase,
): Promise<{ id: string; role: string }> {
  const { memberId, profileId } = input;
  if (!memberId || !profileId) throw new RoleUpdateError('invalid', '회원과 계정 정보가 필요합니다.');
  const m = await db.from('members').select('id, role, auth_user_id').eq('id', memberId).maybeSingle();
  if (m.error) throw toRoleUpdateError(m.error);
  if (!m.data || m.data.auth_user_id !== profileId) {
    throw new RoleUpdateError('precondition', '회원과 계정의 연결이 확인되지 않아 변경하지 않았습니다. 최신 상태를 다시 불러옵니다.');
  }
  if (clubStanding(m.data.role) !== 'member') {
    throw new RoleUpdateError('precondition', '정회원 · 준회원 · 운영진 직책 회원만 MEMBER 로 변경할 수 있습니다.');
  }
  const p = await db.from('profiles').select('id, role').eq('id', profileId).maybeSingle();
  if (p.error) throw toRoleUpdateError(p.error);
  if (!p.data) throw new RoleUpdateError('precondition', '앱 계정을 찾을 수 없어 변경하지 않았습니다.');
  if (p.data.role !== 'GUEST') {
    throw new RoleUpdateError('precondition', `현재 앱 권한이 GUEST 가 아닙니다(${p.data.role ?? '없음'}). 변경하지 않았습니다.`);
  }
  return setAppRole({ profileId, expectedRaw: 'GUEST', next: 'MEMBER' }, db);
}

/**
 * 클럽 회원 자격(members.role) 변경 — 현재 값 비교 후 UPDATE, 실제 변경 1행 확인.
 *   RLS 로 막힌 경우(오류 없이 0행)도 실패로 처리한다.
 */
export async function setClubRole(
  input: { memberId: string; expected: string | null; next: string },
  db: Db = supabase,
): Promise<{ id: string; role: string }> {
  const { memberId, expected, next } = input;
  if (!memberId || !next) throw new RoleUpdateError('invalid', '대상 회원과 회원 자격을 확인해 주세요.');
  if (expected === next) throw new RoleUpdateError('invalid', '이미 같은 회원 자격입니다.');
  let q = db.from('members').update({ role: next }).eq('id', memberId);
  q = expected === null ? q.is('role', null) : q.eq('role', expected);
  const { data, error } = await q.select('id, role');
  if (error) throw toRoleUpdateError(error);
  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== 1 || rows[0]?.role !== next) throw new RoleUpdateError('not_applied', NOT_APPLIED_MSG);
  return rows[0] as { id: string; role: string };
}

/** 앱 권한 조회(id · role 만 — 조회 전용 운영진도 RLS 상 읽을 수 있는 컬럼). 실패는 throw(→ 판정 보류). */
export async function fetchAppRolesById(db: Db = supabase): Promise<Map<string, string | null>> {
  const { data, error } = await db.from('profiles').select('id, role');
  if (error) throw error;
  return new Map((Array.isArray(data) ? data : []).map((r: { id: string; role: string | null }) => [r.id, r.role ?? null]));
}
