'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Session, User } from '@supabase/supabase-js';
import { useRouter, usePathname } from 'next/navigation';

export type UserRole = 'CEO' | 'ADMIN' | 'MEMBER' | 'GUEST';
export type AccessLevel = 'WRITE' | 'READ' | 'HIDE';

export type FeatureKey = 
  | 'admin_settings' 
  | 'stats' 
  | 'finance' // 통합 재무
  | 'notice'  // 클럽 공지
  | 'kdk'     // 대진 생성/운영
  | 'scores'  // 스코어/라이브
  | 'profiles'; // 멤버 프로필

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

  const fetchConfig = async () => {
    try {
      const { data, error } = await supabase
        .from('app_config')
        .select('*')
        .eq('id', 'primary')
        .single();
      
      if (!error && data) {
        setAppConfig(data);
      }
    } catch (err) {
      console.error('[Auth] Config fetch error:', err);
    }
  };

  const hasPermission = (feature: string): AccessLevel => {
    if (role === 'CEO') return 'WRITE';
    if (!appConfig?.permissions?.[role]) {
      // Fallback defaults if config is missing
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

  useEffect(() => {
    // Initial data fetch
    const init = async () => {
      // Safety timeout: Ensure loading finishes after 8s regardless
      const timeoutId = setTimeout(() => {
        setIsLoading(false);
        console.warn('[Auth] Initialization timeout reached');
      }, 8000);

      try {
        console.log('[Auth] Initializing...');
        await fetchConfig();
        
        const { data: { session } } = await supabase.auth.getSession();
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          await syncProfile(session.user);
        } else {
          setIsLoading(false);
        }
      } catch (err) {
        console.error('[Auth] Initialization error:', err);
        setIsLoading(false);
      } finally {
        clearTimeout(timeoutId);
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await syncProfile(session.user);
      } else {
        setRole('GUEST');
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const syncProfile = async (currentUser: User) => {
    try {
      // 1. Email-Based Promotion 
      let initialRole: UserRole = 'GUEST';
      if (currentUser.email === CEO_EMAIL) {
        initialRole = 'CEO';
      } else if (ADMIN_EMAILS.includes(currentUser.email || '')) {
        initialRole = 'ADMIN';
      }

      // 2. Fetch the current member row
      const { data: memberRecord } = await supabase
        .from('members')
        .select('role')
        .eq('email', currentUser.email)
        .single();
      
      let finalRole: UserRole = initialRole;
      if (memberRecord?.role) {
        const kRole = memberRecord.role.trim();
        if (kRole === 'CEO') finalRole = 'CEO';
        else if (STAFF_ROLES.includes(kRole)) finalRole = 'ADMIN';
        else if (MEMBER_ROLES.includes(kRole)) finalRole = 'MEMBER';
        else if (kRole === '게스트' || kRole === 'GUEST') finalRole = 'GUEST';
      }

      const avatarUrl = 
        currentUser.user_metadata?.avatar_url || 
        currentUser.user_metadata?.picture || 
        currentUser.user_metadata?.profile_image_url ||
        currentUser.user_metadata?.profile_image;

      // 3. Upsert to public.profiles
      const { data: profile } = await supabase
        .from('profiles')
        .upsert({
          id: currentUser.id,
          email: currentUser.email,
          role: finalRole,
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' })
        .select('role')
        .single();

      setRole((profile?.role as UserRole) || finalRole);

      // 4. Sync to members table
      if (currentUser.email) {
        const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
        const nickname = currentUser.user_metadata?.nickname || currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];

        const { data: matchedEmail } = await supabase
          .from('members')
          .update({ 
            avatar_url: avatarUrl,
            email: currentUser.email 
          })
          .eq('email', currentUser.email)
          .select('id');
        
        if (!matchedEmail || matchedEmail.length === 0) {
          const { data: matchedNick } = await supabase
            .from('members')
            .update({ 
              avatar_url: avatarUrl,
              email: currentUser.email 
            })
            .eq('nickname', nickname)
            .is('email', null) 
            .select('id');
          
          if (!matchedNick || matchedNick.length === 0) {
            await supabase
              .from('members')
              .insert({
                nickname: nickname,
                email: currentUser.email,
                avatar_url: avatarUrl,
                role: finalRole === 'CEO' ? 'CEO' : '게스트', // Standard label for DB readability
                club_id: clubId,
                등록일: new Date().toISOString().split('T')[0]
              });
          }
        }
      }
    } catch (err) {
      console.error('[Auth] Sync error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithKakao = async () => {
    const isProduction = typeof window !== 'undefined' && window.location.hostname !== 'localhost';
    const redirectTarget = isProduction 
      ? 'https://teyeon-system.vercel.app' 
      : window.location.origin;

    console.log('[Auth] Initiating Kakao login');
    console.log('[Auth] Current Origin:', window.location.origin);
    console.log('[Auth] Redirect Target:', redirectTarget);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: { 
        redirectTo: redirectTarget,
        skipBrowserRedirect: false
      },
    });
    
    if (error) {
      console.error('Kakao login error:', error.message);
      alert('로그인 오류 발생: ' + error.message + '\nTarget: ' + redirectTarget);
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Logout error:', error.message);
  };

  return (
    <AuthContext.Provider value={{ 
      user, session, role, appConfig, isLoading, 
      signInWithKakao, signOut, hasPermission, getRestrictionMessage,
      refreshConfig: fetchConfig 
    }}>
      <NavigationGuard>
        {children}
      </NavigationGuard>
    </AuthContext.Provider>
  );
};

// --- Helper: Guarding Navigation ---
const NavigationGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, isLoading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        // Only redirect if we ARE NOT already on the login page (root)
        // and if loading has finished and no user exists.
        if (!isLoading && !user && pathname !== '/') {
            console.log('[AuthGuard] Redirecting to login...');
            router.push('/');
        }
    }, [user, isLoading, pathname, router]);

    // Don't show content for guarded internal pages if still checking auth
    if (isLoading && pathname !== '/') {
        return (
            <div className="fixed inset-0 bg-[#0F0F1A] flex items-center justify-center z-[1000]">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-[#D4AF37] border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.4em] animate-pulse">Establishing Identity</span>
                </div>
            </div>
        );
    }

    return <>{children}</>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
