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
  isPendingMatching: boolean;
  setPendingMatching: (val: boolean) => void;
  confirmIdentity: (memberId: string) => Promise<void>;
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

  // Profile Sync Logic
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
        const { data: existingLinkedMember } = await supabase
          .from('members')
          .select('id, role')
          .eq('email', currentUser.email)
          .single();

        if (existingLinkedMember) {
          await supabase.from('members').update({ avatar_url: avatarUrl }).eq('id', existingLinkedMember.id);
        } else {
          const nickname = currentUser.user_metadata?.nickname || currentUser.user_metadata?.full_name;
          const cleanNick = nickname?.replace(/\s+/g, '').toLowerCase();

          const { data: unlinkedMembers } = await supabase
            .from('members')
            .select('id, nickname')
            .is('email', null);

          const matchedMember = unlinkedMembers?.find(m => 
            m.nickname.replace(/\s+/g, '').toLowerCase() === cleanNick
          );

          if (matchedMember) {
            await supabase.from('members')
              .update({ email: currentUser.email, avatar_url: avatarUrl })
              .eq('id', matchedMember.id);
          } else {
            setRole('GUEST');
            setIsPendingMatching(true);
          }
        }
      }
    } catch (err) {
      console.error('[Auth] Sync error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const init = async (retryCount = 0) => {
      try {
        console.log(`[Auth] Initializing (Attempt ${retryCount + 1})...`);
        const timeoutId = setTimeout(() => {
          setIsLoading(false);
        }, 8000);

        await fetchConfig();
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;

        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          await syncProfile(session.user);
        } else {
          setIsLoading(false);
        }
        clearTimeout(timeoutId);
      } catch (err) {
        console.error(`[Auth] Initialization error:`, err);
        if (retryCount < 2) {
          setTimeout(() => init(retryCount + 1), 2000);
        } else {
          setIsLoading(false);
        }
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          await syncProfile(session.user);
        }
      } else {
        setRole('GUEST');
        setIsPendingMatching(false);
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
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
      refreshConfig: fetchConfig, isPendingMatching, setPendingMatching: setIsPendingMatching, confirmIdentity
    }}>
      <NavigationGuard>
        {children}
      </NavigationGuard>
    </AuthContext.Provider>
  );
};

const NavigationGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, isLoading, isPendingMatching, confirmIdentity, signOut } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const [matchingMembers, setMatchingMembers] = useState<any[]>([]);

    useEffect(() => {
        if (isPendingMatching) {
          supabase.from('members').select('id, nickname, role').is('email', null)
            .then(({ data }) => setMatchingMembers(data || []));
        }
    }, [isPendingMatching]);

    useEffect(() => {
        if (!isLoading && !user && pathname !== '/') {
            router.push('/');
        }
    }, [user, isLoading, pathname, router]);

    if (isPendingMatching && user) {
      return (
        <div className="fixed inset-0 bg-[#0F0F1A]/95 backdrop-blur-xl flex items-center justify-center z-[2000] p-6">
          <div className="w-full max-w-sm bg-[#1A1A2E] border border-white/10 rounded-[32px] p-8 shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="text-center mb-8">
              <span className="text-4xl mb-4 block">🔍</span>
              <h2 className="text-xl font-black text-white mb-2 tracking-tight">본인 확인이 필요합니다</h2>
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
                클럽 명단에서 본인의 이름을 선택해주세요.
              </p>
            </div>
            <div className="max-h-[300px] overflow-y-auto space-y-2 mb-8 pr-2 custom-scrollbar">
              {matchingMembers.map(m => (
                <button key={m.id} onClick={() => confirmIdentity(m.id)} className="w-full bg-white/5 hover:bg-[#D4AF37]/20 border border-white/5 hover:border-[#D4AF37]/50 py-4 px-6 rounded-2xl text-left transition-all active:scale-95 group">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white group-hover:text-[#D4AF37]">{m.nickname}</span>
                    <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">{m.role || '멤버'}</span>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => signOut()} className="w-full py-4 text-white/40 text-[10px] font-black uppercase tracking-[0.2em] hover:text-white transition-colors">로그아웃</button>
          </div>
        </div>
      );
    }

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
