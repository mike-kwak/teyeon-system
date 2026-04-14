'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
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

const CEO_EMAIL = process.env.NEXT_PUBLIC_CEO_EMAIL || 'cws786@nate.com';
const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map(e => e.trim());

const STAFF_ROLES = ['회장', '부회장', '총무', '재무', '경기', '섭외'];
const MEMBER_ROLES = ['정회원', '준회원'];

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole>('GUEST');
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPendingMatching, setIsPendingMatching] = useState(false);
  const [systemMessage, setSystemMessage] = useState<string | null>(null);

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
      
      // Early Priority: CEO Email Check (Hardcoded safety)
      if (currentUser.email === CEO_EMAIL) {
        setRole('CEO');
        setIsPendingMatching(false);
        setIsLoading(false);
        return;
      }

      // Step 1: Check Members Table (Official Hub)
      const { data: linkedMember, error: memberError } = await supabase
        .from('members')
        .select('id, role, email')
        .eq('email', currentUser.email)
        .single();
      
      if (linkedMember) {
        const avatarUrl = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture;
        await supabase.from('members').update({ avatar_url: avatarUrl }).eq('id', linkedMember.id);
        
        let finalRole: UserRole = 'MEMBER';
        if (linkedMember.role) {
          const kRole = linkedMember.role.trim();
          if (kRole === 'CEO' || kRole === '회장') finalRole = 'CEO';
          else if (['부회장', '총무', '재무', '경기', '섭외'].includes(kRole) || ADMIN_EMAILS.includes(currentUser.email || '')) finalRole = 'ADMIN';
          else if (['정회원', '준회원'].includes(kRole)) finalRole = 'MEMBER';
        }

        console.log(`[Auth/DirectSync] Target Role (Members): ${finalRole}`);
        setRole(finalRole);
        setIsPendingMatching(false);
        setIsLoading(false);
        return;
      }

      // Step 2: Check Profiles Table (Secondary Source for Role)
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', currentUser.id)
        .single();

      if (profileData && profileData.role) {
        let finalRole: UserRole = 'MEMBER';
        const pRole = profileData.role.trim();
        if (pRole === 'CEO' || pRole === '회장') finalRole = 'CEO';
        else if (['부회장', '총무', '재무', '경기', '섭외'].includes(pRole)) finalRole = 'ADMIN';
        
        console.log(`[Auth/DirectSync] Target Role (Profiles): ${finalRole}`);
        setRole(finalRole);
        setIsLoading(false);
        return;
      }

      setRole('MEMBER');
      setIsPendingMatching(false);
      setIsLoading(false);
    } catch (err) {
      console.error('[Auth/DirectSync] Critical Failure Path:', err);
      setRole('MEMBER');
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Safety Force Resolve (Prevents "Syncing..." hang)
    const safetyTimeout = setTimeout(() => {
        setIsLoading(false);
    }, 5000);

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
          setIsLoading(false);
        }
      } catch (err) {
        console.warn(`[Supabase Auth] Init failed... retry: ${retryCount}`, err);
        if (retryCount < 2) {
          setSystemMessage('연결이 잠시 지연되고 있습니다. 다시 시도 중...');
          setTimeout(() => init(retryCount + 1), 2000);
        } else {
          setSystemMessage('네트워크 요청이 만료되었습니다. 캐시 데이터로 표시합니다.');
          if (!user) setIsLoading(false); // Only disable loading if we truly have no cache
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
    const isProduction = typeof window !== 'undefined' && window.location.hostname !== 'localhost';
    const redirectTarget = isProduction ? 'https://teyeon-system.vercel.app' : window.location.origin;
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
            }, 10000); // 10 second timeout for network issues
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
