// Club Schedule 참석자/댓글 등에서 사용하는 공통 회원 표시 resolver.
// 부분 일치 / 닉네임 검색 / 이메일 추정 금지. exact stable id / exact email만 사용.
//
// 입력: { memberId?, userId } 배열 (개인정보 안전한 식별자만)
// 출력: ResolvedDisplays (byUserId + byMemberId Map)
//
// 표시 우선순위 (members row가 없어도 profiles만으로 표시 가능):
//   이름:   members.nickname → profiles.nickname → (self) user_metadata.nickname/full_name/name → '회원 정보 없음'
//   사진:   members.avatar_url → profiles.avatar_url → (self) user_metadata.avatar_url/picture → null (→ InitialAvatar)
//   이름과 사진은 서로 다른 소스에서 독립적으로 선택될 수 있음.
//   (예: 이름은 members.nickname, 사진은 profiles.avatar_url)
//
// 조회 흐름 (N+1 회피 — 최대 3 batch):
//   1) member_id batch       — members.id IN (...)
//   2) user_id batch         — profiles.id IN (...) — 모든 user_id 대상으로 항상 수집
//                              (members 매칭 성공 row도 fallback 사진/이름 후보 확보)
//   3) email batch           — members.email IN (...) — profiles로 얻은 email로 보강

import { supabase } from './supabase';

export interface MemberIdentity {
    /** auth.users.id — NOT NULL */
    userId: string;
    /** members.id — nullable (구버전 row에선 null) */
    memberId?: string | null;
}

export interface MemberDisplay {
    /** 화면 표시용 이름 — UUID/이메일/전화번호 노출 금지 */
    nickname: string | null;
    isGuest: boolean | null;
    /** 매칭에 성공한 members.id (없을 수도) — 호출자가 row 보강 시 사용 */
    memberId: string | null;
    /** 화면 표시용 아바타 URL. null이면 호출자에서 InitialAvatar fallback. */
    avatarUrl: string | null;
    /** 표시용 역할 (CEO/ADMIN/MEMBER 등). 없으면 null. */
    role: string | null;
}

export interface ResolvedDisplays {
    /** user_id → MemberDisplay. user_id가 있는 모든 row가 키로 들어있음. */
    byUserId: Map<string, MemberDisplay>;
    /** member_id → MemberDisplay. member_id로 직접 매칭된 경우만. */
    byMemberId: Map<string, MemberDisplay>;
}

const logResolverWarn = (label: string, err: any) => {
    if (!err) return;
    const code    = err?.code    ?? '(no code)';
    const message = err?.message ?? '(no message)';
    const details = err?.details ?? '(no details)';
    const hint    = err?.hint    ?? '(no hint)';
    // eslint-disable-next-line no-console
    console.warn(`[MemberResolver/${label}] code=${code} | message=${message} | details=${details} | hint=${hint}`);
};

/**
 * 카카오 CDN의 http URL을 https로 정규화. 그 외 URL은 trim만.
 * 운영 환경의 mixed-content / next/image Invalid src 방지.
 * 원본 DB는 수정하지 않고 화면 전달 직전에만 정규화.
 */
const KAKAO_CDN_HOST_RE = /^http:\/\/(img1|t1|k)\.kakaocdn\.net/i;
export function normalizeAvatarUrl(value?: string | null): string | null {
    const s = typeof value === 'string' ? value.trim() : value;
    if (!s) return null;
    if (KAKAO_CDN_HOST_RE.test(s)) {
        return s.replace(/^http:\/\//i, 'https://');
    }
    return s;
}

/** 빈 문자열 → null. trim 적용. */
const normText = (v: any): string | null => {
    const s = typeof v === 'string' ? v.trim() : v;
    return s ? s : null;
};

// 내부 row 표현 — 소스별 후보를 모아 우선순위로 선택할 때 사용.
type MemberRow = {
    id: string;
    nickname: string | null;
    isGuest: boolean | null;
    avatarUrl: string | null;
    role: string | null;
    email: string | null;
};
type ProfileRow = {
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
    email: string | null;
};

/**
 * 댓글/참석 row의 user_id/member_id를 받아 한 번에 표시 정보를 해소.
 * 개별 row마다 호출하지 말고 화면에서 row 배열을 모은 뒤 1회만 호출.
 */
export async function resolveMemberDisplays(
    identities: MemberIdentity[],
): Promise<ResolvedDisplays> {
    const byUserId: Map<string, MemberDisplay> = new Map();
    const byMemberId: Map<string, MemberDisplay> = new Map();

    // 초기화 — 모든 user_id에 빈 슬롯
    for (const it of identities) {
        if (it.userId && !byUserId.has(it.userId)) {
            byUserId.set(it.userId, { nickname: null, isGuest: null, memberId: null, avatarUrl: null, role: null });
        }
    }
    if (identities.length === 0) return { byUserId, byMemberId };

    // ── 1차: member_id batch — members 직접 조회 ────────────────────────────
    const memberById: Map<string, MemberRow> = new Map();
    const memberIds = Array.from(new Set(
        identities.map((i) => i.memberId).filter((m): m is string => !!m),
    ));
    if (memberIds.length > 0) {
        try {
            const { data, error } = await supabase
                .from('members')
                .select('id, nickname, is_guest, email, avatar_url, role')
                .in('id', memberIds);
            if (error) {
                logResolverWarn('member_id batch', error);
            } else {
                for (const m of (data || []) as any[]) {
                    memberById.set(m.id, {
                        id: m.id,
                        nickname: normText(m.nickname),
                        isGuest: m.is_guest ?? null,
                        avatarUrl: normalizeAvatarUrl(m.avatar_url),
                        role: normText(m.role),
                        email: normText(m.email),
                    });
                }
            }
        } catch (e: any) {
            logResolverWarn('member_id batch threw', e);
        }
    }

    // ── 2차: 모든 user_id → profiles batch ──────────────────────────────────
    // member_id 매칭 성공 row도 포함해 항상 profile 후보 수집. 핵심 변경:
    // member 연결이 없어도 profiles.nickname / profiles.avatar_url 로 표시 가능해야 함.
    const profileByUserId: Map<string, ProfileRow> = new Map();
    const allUserIds = Array.from(new Set(
        identities.map((it) => it.userId).filter((u): u is string => !!u),
    ));
    if (allUserIds.length > 0) {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, nickname, email, avatar_url')
                .in('id', allUserIds);
            if (error) {
                logResolverWarn('profiles batch', error);
            } else {
                for (const p of (data || []) as any[]) {
                    profileByUserId.set(p.id, {
                        id: p.id,
                        nickname: normText(p.nickname),
                        avatarUrl: normalizeAvatarUrl(p.avatar_url),
                        email: normText(p.email),
                    });
                }
            }
        } catch (e: any) {
            logResolverWarn('profiles batch threw', e);
        }
    }

    // ── 3차: profiles에서 얻은 email로 members 보강 ─────────────────────────
    // 일부 회원은 member_id가 댓글/참석 row에 없지만 email로는 매칭될 수 있음.
    const orphanEmails = Array.from(new Set(
        Array.from(profileByUserId.values())
            .map((p) => p.email)
            .filter((e): e is string => !!e),
    ));
    const memberByEmail: Map<string, MemberRow> = new Map();
    if (orphanEmails.length > 0) {
        try {
            const { data, error } = await supabase
                .from('members')
                .select('id, nickname, is_guest, email, avatar_url, role')
                .in('email', orphanEmails);
            if (error) {
                logResolverWarn('members-by-email batch', error);
            } else {
                for (const m of (data || []) as any[]) {
                    if (m.email) {
                        memberByEmail.set(normText(m.email)!, {
                            id: m.id,
                            nickname: normText(m.nickname),
                            isGuest: m.is_guest ?? null,
                            avatarUrl: normalizeAvatarUrl(m.avatar_url),
                            role: normText(m.role),
                            email: normText(m.email),
                        });
                        // 동일 row를 memberById에도 등록해 후속 매칭 일관
                        if (!memberById.has(m.id)) {
                            memberById.set(m.id, memberByEmail.get(normText(m.email)!)!);
                        }
                    }
                }
            }
        } catch (e: any) {
            logResolverWarn('members-by-email batch threw', e);
        }
    }

    // ── 최종 합성 — identity마다 우선순위로 이름/사진 독립 선택 ─────────────
    for (const it of identities) {
        if (!it.userId) continue;

        // 후보 수집 (priority 순서)
        const memberHitDirect = it.memberId ? memberById.get(it.memberId) ?? null : null;
        const profileHit = profileByUserId.get(it.userId) ?? null;
        const memberHitByEmail = profileHit?.email ? memberByEmail.get(profileHit.email) ?? null : null;

        // 가장 권위 있는 member row 선택 (direct memberId > profile.email → member)
        const memberHit: MemberRow | null = memberHitDirect ?? memberHitByEmail ?? null;

        // 이름 우선순위: members.nickname → profiles.nickname → null
        const nickname =
            memberHit?.nickname ??
            profileHit?.nickname ??
            null;

        // 사진 우선순위: members.avatar_url → profiles.avatar_url → null
        const avatarUrl =
            memberHit?.avatarUrl ??
            profileHit?.avatarUrl ??
            null;

        // role / isGuest 는 members에서만 의미가 있음
        const display: MemberDisplay = {
            nickname,
            isGuest: memberHit?.isGuest ?? null,
            memberId: memberHit?.id ?? null,
            avatarUrl,
            role: memberHit?.role ?? null,
        };

        byUserId.set(it.userId, display);
        if (display.memberId) byMemberId.set(display.memberId, display);
    }

    return { byUserId, byMemberId };
}

/**
 * row 표시용 헬퍼.
 * 본인 row일 때만 selfName/selfAvatarUrl 보조 fallback 사용 (호출자에서 user_metadata 주입).
 * 최종 실패 시 '회원 정보 없음'.
 *
 * 개인정보 노출 금지: 이메일/UUID/manual-guest- 접두사 등 절대 표시명으로 사용하지 않음.
 */
export function pickDisplayName(opts: {
    userId: string;
    memberId?: string | null;
    resolved: ResolvedDisplays;
    /** row가 현재 로그인 사용자 본인일 때만 전달. */
    selfName?: string | null;
    /** 본인 row일 때 보강할 avatar URL (user_metadata). */
    selfAvatarUrl?: string | null;
}): {
    name: string;
    isGuest: boolean | null;
    resolvedMemberId: string | null;
    avatarUrl: string | null;
    role: string | null;
} {
    const byUser = opts.resolved.byUserId.get(opts.userId);
    const byMember = opts.memberId ? opts.resolved.byMemberId.get(opts.memberId) : undefined;

    // 이름과 사진은 별개로 가장 정보가 풍부한 hit를 선택.
    // 우선순위: byUser(이미 resolver 안에서 members/profiles 합성됨) > byMember
    const nameHit = byUser?.nickname ? byUser : (byMember?.nickname ? byMember : null);
    const avatarHit = byUser?.avatarUrl ? byUser : (byMember?.avatarUrl ? byMember : null);
    const memberIdHit = byUser?.memberId ?? byMember?.memberId ?? opts.memberId ?? null;
    const isGuestHit = byUser?.isGuest ?? byMember?.isGuest ?? null;
    const roleHit = byUser?.role ?? byMember?.role ?? null;

    // self avatar는 본인 row에서 위 두 단계가 모두 실패했을 때만 마지막 보강.
    const selfAvatar = opts.selfAvatarUrl ? normalizeAvatarUrl(opts.selfAvatarUrl) : null;

    if (nameHit?.nickname) {
        return {
            name: nameHit.nickname,
            isGuest: isGuestHit,
            resolvedMemberId: memberIdHit,
            avatarUrl: avatarHit?.avatarUrl ?? selfAvatar ?? null,
            role: roleHit,
        };
    }

    // 본인 fallback (user_metadata에서 받은 이름)
    if (opts.selfName) {
        return {
            name: opts.selfName,
            isGuest: isGuestHit,
            resolvedMemberId: memberIdHit,
            avatarUrl: avatarHit?.avatarUrl ?? selfAvatar ?? null,
            role: roleHit,
        };
    }

    return {
        name: '회원 정보 없음',
        isGuest: isGuestHit,
        resolvedMemberId: memberIdHit,
        avatarUrl: avatarHit?.avatarUrl ?? null,
        role: roleHit,
    };
}
