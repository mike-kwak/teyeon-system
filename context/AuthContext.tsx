'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Session, User } from '@supabase/supabase-js';
import { useRouter, usePathname } from 'next/navigation';
import PremiumSpinner from '@/components/PremiumSpinner';
import { withRetry } from '@/utils/withRetry';

export type UserRole = 'CEO' | 'ADMIN' | 'MEMBER' | 'GUEST';
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

const VALID_ROLES: UserRole[] = ['CEO', 'ADMIN', 'MEMBER', 'GUEST'];

const normalizeRole = (value?: string | null): UserRole => {
  const normalized = value?.trim().toUpperCase();
  return VALID_ROLES.includes(normalized as UserRole) ? normalized as UserRole : 'GUEST';
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

  const getRestrictionMessage = (feature: string): string => {
    if (role === 'GUEST') return "정회원 전용 메뉴입니다. 클럽 가입 후 이용해 주세요!";
    if (role === 'MEMBER') return "운영진 전용 메뉴입니다. 권한이 필요합니다.";
    if (role === 'ADMIN') return "CEO 전용 메뉴입니다.";
    return "권한이 필요한 메뉴입니다.";
  };

  const syncProfile = async (currentUser: User) => {
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

      const { data: idProfile, error: idProfileError } = await supabase
        .from('profiles')
        .select('id, email, role')
        .eq('id', currentUser.id)
        .maybeSingle();

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
        const { data: emailProfiles, error: emailProfileError } = await supabase
          .from('profiles')
          .select('id, email, role')
          .eq('email', currentUser.email)
          .limit(1);

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

      if (profile) {
        if (profile.id !== currentUser.id) {
          const { error: profileIdUpdateError } = await supabase
            .from('profiles')
            .update({
              id: currentUser.id,
              email: currentUser.email,
              nickname,
              avatar_url: avatarUrl
            })
            .eq('id', profile.id);

          if (profileIdUpdateError) {
            console.warn('[Auth/DirectSync] Profile id reconcile failed:', {
              fromProfileId: profile.id,
              toUserId: currentUser.id,
              email: currentUser.email,
              error: profileIdUpdateError
            });
          }
        }

        const { error: profileUpdateError } = await supabase
          .from('profiles')
          .update({
            email: currentUser.email,
            nickname,
            avatar_url: avatarUrl
          })
          .eq('id', currentUser.id);

        if (profileUpdateError) {
          console.warn('[Auth/DirectSync] Profile display update failed:', profileUpdateError);
        }
      } else {
        const { data: insertedProfile, error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: currentUser.id,
            email: currentUser.email,
            role: 'GUEST',
            nickname,
            avatar_url: avatarUrl
          })
          .select('role')
          .single();

        if (insertError) throw insertError;
        finalRole = normalizeRole(insertedProfile?.role);
      }

      console.log(`[Auth/DirectSync] Target Role (Profiles): ${finalRole}`);
      authResolvedRef.current = true;
      setRole(finalRole);
      setIsPendingMatching(false);
      setIsLoading(false);
      return;
    } catch (err) {
      console.error('[Auth/DirectSync] Critical Failure Path:', err);
      
      authResolvedRef.current = true;
      setRole('GUEST');
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Safety Force Resolve (Prevents "Syncing..." hang)
    // Increased to 15s to allow for multiple exponential retries in poor LTE conditions
    const safetyTimeout = setTimeout(() => {
        if (!authResolvedRef.current) {
            console.warn('[Auth] Safety timeout reached. Forcing resolve with cached state.');
            authResolvedRef.current = true;
            setRole('GUEST');
            setIsLoading(false);
        }
    }, 15000);

    const init = async (retryCount = 0) => {
      try {
        await fetchConfig();
        const { data: { session }, error } = await withRetry(() => supabase.auth.getSession());
        if (error) throw error;

        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Enhanced stability: Catch all active session events
      if (['SIGNED_IN', 'INITIAL_SESSION', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          await syncProfile(session.user);
        }
      } else if (event === 'SIGNED_OUT') {
        // Only clear state on explicit SIGNED_OUT
          setSession(null);
          setUser(null);
          authResolvedRef.current = true;
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
      await supabase.from('members').update({ email: user.email, avatar_url: avatarUrl }).eq('id', memberId);
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
        if (!isLoading && !user && pathname !== '/') {
            router.push('/');
        }
    }, [user, isLoading, pathname, router]);

    if (isLoading && pathname !== '/') {
        return <PremiumSpinner isWhiteTheme={isWhiteTheme} message={isLoadTimeout ? "네트워크 지연 발생..." : "Establishing Identity..."} />;
    }

    return <>{children}</>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
