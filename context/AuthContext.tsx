'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Session, User } from '@supabase/supabase-js';
import { useRouter, usePathname } from 'next/navigation';
import PremiumSpinner from '@/components/PremiumSpinner';
import { withRetry } from '@/utils/withRetry';

export type UserRole = 'CEO' | 'ADMIN' | 'OPERATOR' | 'FINANCE_MANAGER' | 'MEMBER' | 'GUEST';
export type AccessLevel = 'WRITE' | 'READ' | 'HIDE';

export type FeatureKey = 
  | 'admin_settings' 
  | 'stats' 
  | 'finance'
  | 'notice'
  | 'kdk'
  | 'scores'
  | 'profiles';

export interface AppConfig {
  permissions: {
    [role in UserRole]: {
      [feature in string]?: AccessLevel;
    };
  };
  menu_order: {
    [role in UserRole]: string[];
  };
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: UserRole;
  appConfig: AppConfig | null;
  isLoading: boolean;
  signInWithKakao: () => Promise<void>;
  signOut: () => Promise<void>;
  hasPermission: (feature: FeatureKey) => AccessLevel;
  getRestrictionMessage: (feature: FeatureKey) => string;
  refreshConfig: () => Promise<void>;
  isPendingMatching: boolean;
  setPendingMatching: (val: boolean) => void;
  confirmIdentity: (memberId: string) => Promise<void>;
  systemMessage: string | null;
  setSystemMessage: (msg: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const VALID_ROLES: UserRole[] = ['CEO', 'ADMIN', 'OPERATOR', 'FINANCE_MANAGER', 'MEMBER', 'GUEST'];

const normalizeRole = (value?: string | null): UserRole => {
  const normalized = value?.trim().toUpperCase();
  return VALID_ROLES.includes(normalized as UserRole) ? normalized as UserRole : 'GUEST';
};

const withAuthTimeout = async <T,>(promise: PromiseLike<T>, label: string, ms = 12000): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });

  console.log(`[Auth/DirectSync] ${label} started`);

  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } catch (err) {
    console.error(`[Auth/DirectSync] ${label} failed or timed out:`, err);
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole>('GUEST');
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPendingMatching, setIsPendingMatching] = useState(false);
  const [systemMessage, setSystemMessage] = useState<string | null>(null);
  const authResolvedRef = useRef(false);
  const authUserSeenRef = useRef(false);
  const profileLookupStartedRef = useRef(false);
  const profileSyncPromiseRef = useRef<Promise<void> | null>(null);
  const profileSyncUserKeyRef = useRef<string | null>(null);
  const resolvedProfileSyncKeyRef = useRef<string | null>(null);
  const inFlightLogShownRef = useRef(false);

  const fetchConfig = async () => {
    try {
      const { data, error } = await withRetry(() => supabase
        .from('app_config')
        .select('*')
        .eq('id', 'primary')
        .single());
      
      if (!error && data) {
        setAppConfig(data);
      }
    } catch (err) {
      console.warn('[Network/Auth] Failed to load config, retaining last known mode.', err);
      // setSystemMessage('네트워크가 지연되어 오프라인 모드로 자동 전환되었습니다.');
    } finally {
      // Don't setIsLoading(false) here yet, wait for init() to decide.
    }
  };

  const hasPermission = (feature: string): AccessLevel => {
    if (role === 'CEO') return 'WRITE';
    if (!appConfig?.permissions?.[role]) {
      if (feature === 'admin_settings' || feature === 'stats') return 'HIDE';
      return (role === 'ADMIN') ? 'WRITE' : 'READ';
    }
    return (appConfig.permissions[role] as any)[feature] || 'HIDE';
  };

  const syncMemberAvatarIfMissing = async (userId: string, email?: string | null, candidateAvatarUrl?: string | null) => {
    if (!email || !candidateAvatarUrl) return;

    // 탭 세션 1회 게이트: 같은 사용자 + 같은 아바타 URL 조합이면 이번 탭에서는 재조회하지 않는다
    //   (매 전체 로드마다 members SELECT 가 나가던 문제 제거). 아바타 URL 이 바뀌면 값이 달라져 자동 재실행.
    //   sessionStorage 는 탭 수명이라 계정 전환(키에 userId 포함)/브라우저 재시작 시 자연 초기화.
    //   저장은 SELECT + 필요한 UPDATE 가 모두 성공한 뒤에만 수행(실패 시 다음 로드에서 재시도).
    const gateKey = `teyeon:member-avatar-sync:${userId}`;
    try {
      if (typeof window !== 'undefined' && window.sessionStorage.getItem(gateKey) === candidateAvatarUrl) {
        return;
      }
    } catch {
      // sessionStorage 접근 불가 환경 — 게이트 없이 기존 동작으로 fallback.
    }

    try {
      // members direct UPDATE 제거 → 제한 RPC. 서버가 JWT email 매칭 + 아바타 빈 본인 회원만 채운다
      //   (auth_user_id null/내 uid, 같은 email 이 정확히 1건일 때만 — 다건이면 서버가 안전 중단).
      const { error: rpcError } = await withAuthTimeout(
        supabase.rpc('fill_my_member_avatars', { p_avatar_url: candidateAvatarUrl }),
        'Member avatar fill RPC',
        5000
      );

      if (rpcError) {
        console.warn('[Auth/AvatarSync] fill_my_member_avatars failed:', rpcError);
        return;
      }

      // 성공 → 이번 탭 세션 완료 기록(현재 아바타 URL 저장).
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(gateKey, candidateAvatarUrl);
        }
      } catch {
        // sessionStorage 접근 불가 — 저장 생략(다음 로드에서 기존 동작).
      }
    } catch (err) {
      console.warn('[Auth/AvatarSync] Member avatar sync skipped:', err);
    }
  };

  const getRestrictionMessage = (feature: string): string => {
    if (role === 'GUEST') return "정회원 전용 메뉴입니다. 클럽 가입 후 이용해 주세요!";
    if (role === 'MEMBER') return "운영진 전용 메뉴입니다. 권한이 필요합니다.";
    if (role === 'ADMIN') return "CEO 전용 메뉴입니다.";
    return "권한이 필요한 메뉴입니다.";
  };

  const syncProfile = async (currentUser: User) => {
    authUserSeenRef.current = true;
    const syncKey = `${currentUser.id}:${currentUser.email || ''}`;

    if (authResolvedRef.current && resolvedProfileSyncKeyRef.current === syncKey) {
      return;
    }

    if (profileSyncPromiseRef.current) {
      if (!inFlightLogShownRef.current) {
        console.debug('[Auth/DirectSync] Profile sync already in flight. Reusing current request.', {
          requested: syncKey,
          inFlight: profileSyncUserKeyRef.current
        });
        inFlightLogShownRef.current = true;
      }
      return profileSyncPromiseRef.current;
    }

    profileSyncUserKeyRef.current = syncKey;
    inFlightLogShownRef.current = false;

    const syncPromise = (async () => {
    try {
      console.log(`[Auth/DirectSync] Forcing single source of truth lookup for ${currentUser.email}`);

      const avatarUrl = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || null;
      const nickname =
        currentUser.user_metadata?.nickname ||
        currentUser.user_metadata?.full_name ||
        currentUser.user_metadata?.name ||
        currentUser.email?.split('@')[0] ||
        null;

      console.log('[Auth/DirectSync] Current auth user:', {
        userId: currentUser.id,
        email: currentUser.email
      });

      profileLookupStartedRef.current = true;
      console.log('[Auth/DirectSync] Starting profile lookup', {
        syncKey,
        userId: currentUser.id,
        email: currentUser.email
      });

      const { data: idProfile, error: idProfileError } = await withAuthTimeout(
        supabase
          .from('profiles')
          // P1-2: email 미조회. nickname 은 no-op UPDATE 방지 비교(shouldUpdateProfile)에 사용.
          .select('id, role, avatar_url, nickname')
          .eq('id', currentUser.id)
          .maybeSingle(),
        'Profile lookup by id'
      );

      if (idProfileError) {
        console.error('[Auth/DirectSync] Profile lookup by id failed:', {
          userId: currentUser.id,
          email: currentUser.email,
          error: idProfileError
        });
        throw idProfileError;
      }

      console.log('[Auth/DirectSync] Profile lookup by id result:', {
        userId: currentUser.id,
        profileId: idProfile?.id ?? null,
        profileRole: idProfile?.role ?? null
      });

      // P1-2 개인정보 최소화 — profiles.email 로 profile 을 찾던 클라이언트 fallback 제거.
      //   id(auth.uid()) 로 본인 profile 이 없으면 아래 else 분기의 sync_my_profile RPC 가
      //   서버에서 JWT email 로 reconcile(기존 role 보존)/신규 생성하고 role 을 재조회한다.
      const profile = idProfile;

      let finalRole = normalizeRole(profile?.role);
      let roleApplied = false;

      if (profile) {
        console.log(`[Auth/DirectSync] Target Role (Profiles): ${finalRole}`);
        authResolvedRef.current = true;
        resolvedProfileSyncKeyRef.current = syncKey;
        setRole(finalRole);
        setIsPendingMatching(false);
        setIsLoading(false);
        roleApplied = true;

        void (async () => {
          try {
            // profiles direct insert/update/reconcile 제거 → 제한 RPC(sync_my_profile).
            //   서버가 ① 본인 row 표시정보 갱신 ② email 매칭 row 를 uid 로 이전(role 보존)
            //   ③ 신규 GUEST 생성 을 안전하게 처리(role 은 클라가 지정 불가). email 은 JWT.
            //   no-op 방지: 값이 실제로 달라졌을 때만 호출(불필요한 RPC 왕복 억제).
            const dbNickname = (profile as any).nickname || null;
            const dbAvatarUrl = (profile as any).avatar_url || null;
            // P2: profiles.email 을 조회하지 않으므로(email 미select) email 변경 비교를 제거한다.
            //   과거엔 dbEmail 이 항상 null 이 되어 emailChanged 가 매 로드 true → 불필요한 RPC 왕복 유발.
            //   email reconcile(신규/이전)은 profile 미존재 시 else 분기의 sync_my_profile 이 JWT 로 처리.
            const needsReconcile = profile.id !== currentUser.id;
            const nicknameChanged = dbNickname !== nickname;
            const avatarChanged = dbAvatarUrl !== avatarUrl;

            if (needsReconcile || nicknameChanged || avatarChanged) {
              const { error: syncError } = await withAuthTimeout(
                supabase.rpc('sync_my_profile', { p_nickname: nickname, p_avatar_url: avatarUrl }),
                'Profile sync RPC',
                5000
              );
              if (syncError) {
                console.warn('[Auth/DirectSync] sync_my_profile failed:', syncError?.message || syncError);
              }
            }

            await syncMemberAvatarIfMissing(
              currentUser.id,
              currentUser.email,
              avatarUrl || (profile as any)?.avatar_url || null
            );
          } catch (displaySyncError) {
            console.warn('[Auth/DirectSync] Profile display sync skipped:', displaySyncError);
          }
        })();
      } else {
        // profiles direct insert 제거 → sync_my_profile RPC(신규는 GUEST 로 생성, role 클라 지정 불가).
        const { error: syncError } = await withAuthTimeout(
          supabase.rpc('sync_my_profile', { p_nickname: nickname, p_avatar_url: avatarUrl }),
          'Profile guest sync RPC'
        );
        if (syncError) throw syncError;
        // 생성 후 최종 role 재조회(RPC 는 void — reconcile 로 기존 role 이 보존됐을 수 있음).
        const { data: createdProfile } = await withAuthTimeout(
          supabase.from('profiles').select('role').eq('id', currentUser.id).maybeSingle(),
          'Profile role reread'
        );
        finalRole = normalizeRole(createdProfile?.role ?? 'GUEST');
        void syncMemberAvatarIfMissing(currentUser.id, currentUser.email, avatarUrl);
      }

      if (!roleApplied) {
        console.log(`[Auth/DirectSync] Target Role (Profiles): ${finalRole}`);
        authResolvedRef.current = true;
        resolvedProfileSyncKeyRef.current = syncKey;
        setRole(finalRole);
        setIsPendingMatching(false);
        setIsLoading(false);
      }
      return;
    } catch (err) {
      console.error('[Auth/DirectSync] Critical Failure Path:', err);
      
      authResolvedRef.current = true;
      setIsPendingMatching(false);
      setIsLoading(false);
    }
    })();

    profileSyncPromiseRef.current = syncPromise;

    try {
      await syncPromise;
    } finally {
      if (profileSyncPromiseRef.current === syncPromise) {
        profileSyncPromiseRef.current = null;
        profileSyncUserKeyRef.current = null;
        inFlightLogShownRef.current = false;
      }
    }
  };

  useEffect(() => {
    // Safety Force Resolve (Prevents "Syncing..." hang)
    // Increased to 15s to allow for multiple exponential retries in poor LTE conditions
    const safetyTimeout = setTimeout(() => {
        if (!authResolvedRef.current) {
          if (authUserSeenRef.current || profileLookupStartedRef.current || profileSyncPromiseRef.current) {
            console.warn('[Auth] Safety timeout reached while auth/profile lookup is active. Ending loading without changing role.', {
              hasAuthUser: authUserSeenRef.current,
              profileLookupStarted: profileLookupStartedRef.current,
              profileSyncInFlight: Boolean(profileSyncPromiseRef.current)
            });
            authResolvedRef.current = true;
            setIsLoading(false);
            return;
          }

            console.warn('[Auth] Safety timeout reached. Forcing resolve with cached state.');
            authResolvedRef.current = true;
            setRole('GUEST');
            setIsLoading(false);
        }
    }, 15000);

    const init = async (retryCount = 0) => {
      try {
        void fetchConfig();
        const { data: { session }, error } = await withAuthTimeout(
          supabase.auth.getSession(),
          'Auth getSession',
          7000
        );
        if (error) throw error;

        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          authUserSeenRef.current = true;
          await syncProfile(session.user);
        } else {
          authResolvedRef.current = true;
          setIsLoading(false);
        }
      } catch (err) {
        console.warn(`[Supabase Auth] Init failed... retry: ${retryCount}`, err);
        if (retryCount < 5) {
          setSystemMessage(`연결이 지연되고 있습니다... 재시도 중 (${retryCount + 1}/5)`);
          const backoff = Math.min(2000 * Math.pow(1.5, retryCount), 8000);
          setTimeout(() => init(retryCount + 1), backoff);
        } else {
          setSystemMessage('네트워크 요청이 만료되었습니다. 이전 저장된 정보를 표시합니다.');
          if (!user) setIsLoading(false); 
        }
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Enhanced stability: Catch all active session events
      if (['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          authUserSeenRef.current = true;
          setTimeout(() => {
            void syncProfile(session.user);
          }, 0);
        }
      } else if (event === 'SIGNED_OUT') {
        // Only clear state on explicit SIGNED_OUT
          setSession(null);
          setUser(null);
          authResolvedRef.current = true;
          authUserSeenRef.current = false;
          profileLookupStartedRef.current = false;
          resolvedProfileSyncKeyRef.current = null;
          setRole('GUEST');
        setIsPendingMatching(false);
        setIsLoading(false);
      }
    });

    return () => {
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const confirmIdentity = async (memberId: string) => {
    if (!user?.email) return;
    try {
      setIsLoading(true);
      const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;
      // members direct UPDATE 제거 → 제한 RPC. 서버가 JWT email = members.email 일치를 검증하고
      //   auth_user_id 를 내 uid 로 연결(타 계정 연결분 차단) + 비어있으면 avatar 보충. role/club_id 불변.
      const { error: claimError } = await supabase.rpc('claim_my_member', {
        p_member_id: memberId,
        p_avatar_url: avatarUrl || null,
      });
      if (claimError) {
        // 권한/이메일 불일치 등 — 로그인 자체는 막지 않되 연결만 스킵(내부 오류 문구 비노출).
        console.warn('[Auth] claim_my_member failed:', claimError?.message || claimError);
      }
      await syncProfile(user);
      setIsPendingMatching(false);
    } catch (err) {
      console.error('[Auth] Match error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithKakao = async () => {
    const redirectTarget = typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}${window.location.search}`
      : undefined;
    await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: { redirectTo: redirectTarget, skipBrowserRedirect: false },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ 
      user, session, role, appConfig, isLoading, 
      signInWithKakao, signOut, hasPermission, getRestrictionMessage,
      refreshConfig: fetchConfig, isPendingMatching, setPendingMatching: setIsPendingMatching, confirmIdentity,
      systemMessage, setSystemMessage
    }}>
      <NavigationGuard>
        {children}
      </NavigationGuard>
    </AuthContext.Provider>
  );
};

const NavigationGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // 회원 매칭(claim) 흐름은 별도 화면(app/kdk)에서 confirmIdentity RPC 로 수행한다.
    //   NavigationGuard 는 로그인 로딩 게이트 + 미로그인 리다이렉트만 담당(회원 조회 없음).
    const { user, isLoading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    // Load state debugging & timeout (v3.9 Stability)
    const [isLoadTimeout, setIsLoadTimeout] = useState(false);

    const isWhiteTheme = pathname === '/sample-white';
    const isPublicPath =
      pathname?.startsWith('/guest/pass/') ||
      pathname === '/club' ||
      pathname?.startsWith('/club/') ||
      // 재무 공개 공지(월회비·KDK 벌금/상금) — 로그인 없이 읽기 전용 접근 허용.
      pathname?.startsWith('/finance/public/');

    useEffect(() => {
        // Timeout for loading (Stability v3.9)
        let timeoutId: any;
        if (isLoading) {
            timeoutId = setTimeout(() => {
                setIsLoadTimeout(true);
            }, 12000); // Wait 12s before showing delay warning
        } else {
            setIsLoadTimeout(false);
        }
        return () => clearTimeout(timeoutId);
    }, [isLoading]);

    useEffect(() => {
        if (!isLoading && !user && pathname !== '/' && !isPublicPath) {
            router.push('/');
        }
    }, [user, isLoading, pathname, router, isPublicPath]);

    if (isLoading && pathname !== '/' && !isPublicPath) {
        return <PremiumSpinner isWhiteTheme={isWhiteTheme} message={isLoadTimeout ? "네트워크 지연 발생..." : "Establishing Identity..."} />;
    }

    return <>{children}</>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
