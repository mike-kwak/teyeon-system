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

  const syncProfile = async (currentUser: User) => {
    try {
      let initialRole: UserRole = 'GUEST';
      if (currentUser.email === CEO_EMAIL) {
        initialRole = 'CEO';
      } else if (ADMIN_EMAILS.includes(currentUser.email || '')) {
        initialRole = 'ADMIN';
      }

      const { data: linkedMember } = await supabase
        .from('members')
        .select('id, role, email')
        .eq('email', currentUser.email)
        .single();
      
      if (linkedMember) {
        const avatarUrl = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture;
        await supabase.from('members').update({ avatar_url: avatarUrl }).eq('id', linkedMember.id);
        
        let finalRole: UserRole = initialRole;
        if (linkedMember.role) {
            const kRole = linkedMember.role.trim();
            if (kRole === 'CEO') finalRole = 'CEO';
            else if (STAFF_ROLES.includes(kRole)) finalRole = 'ADMIN';
            else if (MEMBER_ROLES.includes(kRole)) finalRole = 'MEMBER';
        }
        setRole(finalRole);
        setIsPendingMatching(false);
        setIsLoading(false);
        return;
      }

      const nickname = currentUser.user_metadata?.nickname || currentUser.user_metadata?.full_name;
      if (nickname) {
        const { data: matchedNick } = await supabase
          .from('members')
          .select('id')
          .eq('nickname', nickname)
          .is('email', null)
          .single();
        
        if (matchedNick) {
          await supabase.from('members')
            .update({ email: currentUser.email, avatar_url: currentUser.user_metadata?.avatar_url })
            .eq('id', matchedNick.id);
          
          setTimeout(() => syncProfile(currentUser), 500);
          return;
        }
      }

      setRole('GUEST');
      setIsPendingMatching(true);
      setIsLoading(false);
    } catch (err) {
      console.error('[Auth] Sync error:', err);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const init = async (retryCount = 0) => {
      try {
        const timeoutId = setTimeout(() => {
          setIsLoading(false);
        }, 12000);

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
    const [phoneNumber, setPhoneNumber] = useState('');
    const [matchingStatus, setMatchingStatus] = useState<'idle' | 'searching' | 'error'>('idle');
    const [matchedMember, setMatchedMember] = useState<any>(null);
    const [showFullList, setShowFullList] = useState(false);
    const [unlinkedMembers, setUnlinkedMembers] = useState<any[]>([]);

    const isWhiteTheme = pathname === '/sample-white';

    const handlePhoneMatch = async () => {
        if (!phoneNumber || phoneNumber.length < 4) return;
        setMatchingStatus('searching');
        setMatchedMember(null);
        
        try {
            const { data, error } = await supabase
                .from('members')
                .select('id, nickname, role, phone, email');
            
            if (error) throw error;

            const inputDigits = phoneNumber.replace(/[^0-9]/g, '');

            const found = data?.find(m => {
                if (m.email) return false;
                if (!m.phone) return false;
                const dbDigits = m.phone.replace(/[^0-9]/g, '');
                return dbDigits.endsWith(inputDigits) || dbDigits === inputDigits;
            });

            if (found) {
                setMatchedMember(found);
                setMatchingStatus('idle');
            } else {
                setMatchingStatus('error');
                // Auto-fetch list for fallback
                const unlinked = data?.filter(m => !m.email) || [];
                setUnlinkedMembers(unlinked);
            }
        } catch (err) {
            setMatchingStatus('error');
        }
    };

    useEffect(() => {
        if (!isLoading && !user && pathname !== '/') {
            router.push('/');
        }
    }, [user, isLoading, pathname, router]);

    if (isPendingMatching && user) {
      return (
        <div className={`fixed inset-0 flex items-center justify-center z-[2000] p-6 transition-colors duration-500 ${isWhiteTheme ? 'bg-[#F8FAFC]/95 backdrop-blur-xl' : 'bg-[#0F0F1A]/95 backdrop-blur-xl'}`}>
          <div className={`w-full max-w-sm border rounded-[32px] p-8 shadow-2xl animate-in zoom-in-95 duration-300 ${isWhiteTheme ? 'bg-white border-white text-[#0F172A]' : 'bg-[#1A1A2E] border-white/10 text-white'}`}>
            <div className="text-center mb-8">
              <span className="text-4xl mb-4 block">🛡️</span>
              <h2 className="text-xl font-black mb-2 tracking-tight">본인 확인이 필요합니다</h2>
              <p className={`text-[10px] font-bold uppercase tracking-widest leading-relaxed ${isWhiteTheme ? 'text-[#64748B]' : 'text-white/40'}`}>
                클럽 명단에 등록된<br/><span className={isWhiteTheme ? 'text-[#B45309]' : 'text-[#D4AF37]'}>전화번호 뒤 4자리</span>를 입력해주세요.
              </p>
            </div>
            
            <div className="space-y-4 mb-8">
                {!showFullList ? (
                <>
                  <input 
                      type="tel" 
                      placeholder="번호 뒤 4자리 입력..."
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9]/g, ''))}
                      className={`w-full bg-transparent border-b-2 py-3 text-center text-2xl font-black transition-all outline-none ${isWhiteTheme ? 'border-[#E2E8F0] focus:border-[#B45309]' : 'border-white/10 focus:border-[#D4AF37]'}`}
                      onKeyDown={(e) => e.key === 'Enter' && handlePhoneMatch()}
                  />

                  {!matchedMember ? (
                    <div className="flex flex-col gap-2">
                        <button
                        onClick={handlePhoneMatch}
                        disabled={matchingStatus === 'searching'}
                        className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 ${isWhiteTheme ? 'bg-[#B45309] text-white' : 'bg-[#D4AF37] text-black'} ${matchingStatus === 'searching' ? 'opacity-50 animate-pulse' : 'shadow-lg'}`}
                        >
                        {matchingStatus === 'searching' ? '조회 중...' : '매칭하기'}
                        </button>
                        {matchingStatus === 'error' && (
                            <button 
                                onClick={() => setShowFullList(true)}
                                className={`text-[10px] font-black underline mt-2 ${isWhiteTheme ? 'text-[#B45309]' : 'text-[#D4AF37]'}`}
                            >
                                번호를 모르겠나요? 직접 이름 선택하기
                            </button>
                        )}
                    </div>
                  ) : (
                    <div className={`p-4 rounded-2xl border animate-in slide-in-from-top-2 ${isWhiteTheme ? 'bg-slate-50 border-emerald-500/20' : 'bg-white/5 border-emerald-500/20'}`}>
                      <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-black opacity-40 uppercase">멤버 확인됨</span>
                          <span className="text-[#10B981] text-[10px] font-black">MATCHED</span>
                      </div>
                      <div className="flex items-center justify-between">
                          <span className="text-lg font-black">{matchedMember.nickname}</span>
                          <button 
                              onClick={() => confirmIdentity(matchedMember.id)}
                              className="bg-[#10B981] text-white px-4 py-2 rounded-xl text-[10px] font-black"
                          >
                              로그인
                          </button>
                      </div>
                    </div>
                  )}

                  {matchingStatus === 'error' && (
                      <p className="text-center text-red-500 text-[9px] font-bold">등록된 번호를 찾을 수 없습니다.</p>
                  )}
                </>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto px-1 custom-scrollbar">
                     <p className={`text-[9px] font-black mb-3 uppercase tracking-widest opacity-40`}>미연결 멤버 리스트</p>
                    {unlinkedMembers.map(m => (
                      <button 
                        key={m.id} 
                        onClick={() => confirmIdentity(m.id)}
                        className={`w-full text-left py-3 px-4 rounded-xl border transition-all active:scale-95 flex justify-between items-center ${isWhiteTheme ? 'bg-slate-50 border-slate-100 hover:border-[#B45309]' : 'bg-white/5 border-white/5 hover:border-[#D4AF37]'}`}
                      >
                        <span className="font-bold text-sm">{m.nickname}</span>
                        <span className="text-[8px] opacity-30">{m.phone ? `*${m.phone.slice(-4)}` : '번호미등록'}</span>
                      </button>
                    ))}
                    <button 
                      onClick={() => setShowFullList(false)}
                      className="w-full py-2 text-[9px] font-black text-[#D4AF37] mt-4"
                    >
                      ← 돌아가기
                    </button>
                  </div>
                )}
            </div>

            <button 
              onClick={() => signOut()}
              className={`w-full py-4 text-[10px] font-black uppercase tracking-[0.2em] transition-colors ${isWhiteTheme ? 'text-[#94A3B8]' : 'text-white/40'}`}
            >
              로그아웃
            </button>
            <div className="text-center mt-2 opacity-15 text-[8px] font-bold">STABILITY v3.7 • PLATINUM ED.</div>
          </div>
        </div>
      );
    }

    if (isLoading && pathname !== '/') {
        return (
            <div className={`fixed inset-0 flex items-center justify-center z-[1000] ${isWhiteTheme ? 'bg-[#FFFFFF]' : 'bg-[#0F0F1A]'}`}>
                <div className="flex flex-col items-center gap-4">
                    <div className={`w-12 h-12 border-4 border-t-transparent rounded-full animate-spin ${isWhiteTheme ? 'border-slate-200 border-t-[#B45309]' : 'border-white/5 border-t-[#D4AF37]'}`}></div>
                    <span className={`text-[10px] font-black uppercase tracking-[0.4em] animate-pulse ${isWhiteTheme ? 'text-[#B45309]' : 'text-[#D4AF37]'}`}>Establishing Identity</span>
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
