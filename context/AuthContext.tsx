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
      const { data: linkedMembers, error: linkedMembersError } = await withAuthTimeout(
        supabase
          .from('members')
          .select('id, avatar_url')
          .eq('email', email)
          .limit(5),
        'Member avatar lookup',
        5000
      );

      if (linkedMembersError) {
        console.warn('[Auth/AvatarSync] Member avatar lookup failed:', linkedMembersError);
        return;
      }

      const membersWithoutAvatar = (linkedMembers || []).filter((member: any) => {
        return !String(member?.avatar_url || '').trim();
      });

      const updateResults = await Promise.all(
        membersWithoutAvatar.map((member: any) => {
          const query = supabase
            .from('members')
            .update({ avatar_url: candidateAvatarUrl })
            .eq('id', member.id);

          const guardedQuery = member.avatar_url === null || member.avatar_url === undefined
            ? query.is('avatar_url', null)
            : query.eq('avatar_url', member.avatar_url);

          return withAuthTimeout(guardedQuery, 'Member avatar update', 5000);
        })
      );

      let anyUpdateFailed = false;
      updateResults.forEach((result: any) => {
        if (result?.error) {
          anyUpdateFailed = true;
          console.warn('[Auth/AvatarSync] Member avatar update failed:', result.error);
        }
      });

      // SELECT + 필요한 UPDATE 전부 성공 → 이번 탭 세션 완료 기록(현재 아바타 URL 저장).
      if (!anyUpdateFailed) {
        try {
          if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(gateKey, candidateAvatarUrl);
          }
        } catch {
          // sessionStorage 접근 불가 — 저장 생략(다음 로드에서 기존 동작).
        }
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
          // nickname 포함: 아래 no-op UPDATE 방지 비교(shouldUpdateProfile)에 사용.
          .select('id, email, role, avatar_url, nickname')
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
        email: currentUser.email,
        profileId: idProfile?.id ?? null,
        profileEmail: idProfile?.email ?? null,
        profileRole: idProfile?.role ?? null
      });

      let profile = idProfile;

      if (!profile && currentUser.email) {
        const { data: emailProfiles, error: emailProfileError } = await withAuthTimeout(
          supabase
            .from('profiles')
            // nickname 포함: id 조회와 동일하게 no-op UPDATE 방지 비교에 사용.
            .select('id, email, role, avatar_url, nickname')
            .eq('email', currentUser.email)
            .limit(1),
          'Profile lookup by email'
        );

        if (emailProfileError) {
          console.error('[Auth/DirectSync] Profile lookup by email failed:', {
            userId: currentUser.id,
            email: currentUser.email,
            error: emailProfileError
          });
          throw emailProfileError;
        }

        profile = emailProfiles?.[0] ?? null;
        console.log('[Auth/DirectSync] Profile lookup by email result:', {
          userId: currentUser.id,
          email: currentUser.email,
          profileId: profile?.id ?? null,
          profileEmail: profile?.email ?? null,
          profileRole: profile?.role ?? null
        });
      }

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
            // reconcile 이 실제로 성공하면 같은 payload 를 이미 썼으므로 아래 display update 는 생략.
            let reconciledOk = false;
            if (profile.id !== currentUser.id) {
              const { error: profileIdUpdateError } = await withAuthTimeout(
                supabase
                  .from('profiles')
                  .update({
                    id: currentUser.id,
                    email: currentUser.email,
                    nickname,
                    avatar_url: avatarUrl
                  })
                  .eq('id', profile.id),
                'Profile id reconcile',
                5000
              );

              if (profileIdUpdateError) {
                console.warn('[Auth/DirectSync] Profile id reconcile failed:', {
                  fromProfileId: profile.id,
                  toUserId: currentUser.id,
                  email: currentUser.email,
                  error: profileIdUpdateError
                });
              } else {
                reconciledOk = true;
              }
            }

            // no-op UPDATE 방지: 저장 payload 와 동일한 정규화(빈 문자열→null)로 DB 값과 비교해
            //   실제로 달라졌을 때만 PATCH 한다(이전에는 값이 같아도 매 전체 로드마다 무조건 PATCH).
            //   - nickname/avatarUrl 계산식은 이미 빈값→null 로 끝난다(|| null 체인).
            //   - email 은 auth 값이 undefined 면 payload 직렬화에서 탈락(기존 동작 유지)하므로
            //     값이 있을 때만 비교한다 — undefined 로 DB email 을 지우는 회귀 방지.
            const dbEmail = (profile as any).email || null;
            const dbNickname = (profile as any).nickname || null;
            const dbAvatarUrl = (profile as any).avatar_url || null;
            const emailChanged = currentUser.email != null && dbEmail !== currentUser.email;
            const nicknameChanged = dbNickname !== nickname;
            const avatarChanged = dbAvatarUrl !== avatarUrl;
            const shouldUpdateProfile = emailChanged || nicknameChanged || avatarChanged;

            if (shouldUpdateProfile && !reconciledOk) {
              const { error: profileUpdateError } = await withAuthTimeout(
                supabase
                  .from('profiles')
                  .update({
                    email: currentUser.email,
                    nickname,
                    avatar_url: avatarUrl
                  })
                  .eq('id', currentUser.id),
                'Profile display update',
                5000
              );

              if (profileUpdateError) {
                console.warn('[Auth/DirectSync] Profile display update failed:', profileUpdateError);
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
        const { data: insertedProfile, error: insertError } = await withAuthTimeout(
          supabase
            .from('profiles')
            .insert({
              id: currentUser.id,
              email: currentUser.email,
              role: 'GUEST',
              nickname,
              avatar_url: avatarUrl
            })
            .select('role')
            .single(),
          'Profile guest insert'
        );

        if (insertError) throw insertError;
        finalRole = normalizeRole(insertedProfile?.role);
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
      const { data: linkedMember, error: linkedMemberError } = await supabase
        .from('members')
        .select('avatar_url')
        .eq('id', memberId)
        .maybeSingle();

      if (linkedMemberError) {
        console.warn('[Auth] Member avatar precheck failed:', linkedMemberError);
      }

      const updatePayload: Record<string, any> = { email: user.email };
      if (avatarUrl && !String((linkedMember as any)?.avatar_url || '').trim()) {
        updatePayload.avatar_url = avatarUrl;
      }

      await supabase.from('members').update(updatePayload).eq('id', memberId);
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
    const { user, isLoading, isPendingMatching, confirmIdentity, signOut, setPendingMatching } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const [inputValue, setInputValue] = useState('');
    const [matchingStatus, setMatchingStatus] = useState<'idle' | 'searching' | 'error'>('idle');
    const [matchedMember, setMatchedMember] = useState<any>(null);
    const [searchResult, setSearchResult] = useState<any[]>([]);
    
    // Load state debugging & timeout (v3.9 Stability)
    const [isLoadTimeout, setIsLoadTimeout] = useState(false);

    const isWhiteTheme = pathname === '/sample-white';
    const isPublicPath =
      pathname?.startsWith('/guest/pass/') ||
      pathname === '/club' ||
      pathname?.startsWith('/club/') ||
      // 재무 공개 공지(월회비·KDK 벌금/상금) — 로그인 없이 읽기 전용 접근 허용.
      pathname?.startsWith('/finance/public/');

    const handleSearch = async () => {
        if (!inputValue || inputValue.length < 2) return;
        setMatchingStatus('searching');
        setMatchedMember(null);
        setSearchResult([]);
        
        try {
            const isDigits = /^\d+$/.test(inputValue);
            
            // 1. Fetch all eligible members (those not yet linked to an email and NOT guests)
            const { data: candidates, error } = await supabase
                .from('members')
                .select('id, nickname, role, phone, email, is_guest')
                .is('email', null)
                .neq('role', 'GUEST');

            if (error) throw error;

            if (isDigits) {
                // Phone matching (ends with input or exact match)
                const inputDigits = inputValue.replace(/[^0-9]/g, '');
                const matches = candidates?.filter(m => {
                    if (!m.phone) return false;
                    const dbDigits = m.phone.replace(/[^0-9]/g, '');
                    return dbDigits.endsWith(inputDigits) || dbDigits === inputDigits;
                }) || [];

                if (matches.length === 1) {
                    setMatchedMember(matches[0]);
                } else if (matches.length > 1) {
                    setSearchResult(matches);
                } else {
                    setMatchingStatus('error');
                }
            } else {
                // Name matching (nickname)
                const matches = candidates?.filter(m => 
                    m.nickname && (m.nickname.includes(inputValue) || inputValue.includes(m.nickname))
                ) || [];

                if (matches.length === 1) {
                    setMatchedMember(matches[0]);
                } else if (matches.length > 1) {
                    setSearchResult(matches);
                } else {
                    setMatchingStatus('error');
                }
            }
            
            if (matchedMember || (searchResult && searchResult.length > 0)) {
                setMatchingStatus('idle');
            }
        } catch (err) {
            setMatchingStatus('error');
        }
    };

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
