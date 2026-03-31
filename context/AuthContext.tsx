'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Session, User } from '@supabase/supabase-js';
import { useRouter, usePathname } from 'next/navigation';
import PremiumSpinner from '@/components/PremiumSpinner';

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
    // Safety Force Resolve (Prevents "Syncing..." hang)
    const safetyTimeout = setTimeout(() => {
        setIsLoading(false);
    }, 5000);

    const init = async (retryCount = 0) => {
      try {
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
      refreshConfig: fetchConfig, isPendingMatching, setPendingMatching: setIsPendingMatching, confirmIdentity
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

    if (isPendingMatching && user) {
      return (
        <div className={`fixed inset-0 flex items-center justify-center z-[2000] p-6 transition-colors duration-500 ${isWhiteTheme ? 'bg-[#F8FAFC]/95 backdrop-blur-xl' : 'bg-[#0F0F1A]/95 backdrop-blur-xl'}`}>
          <div className={`w-full max-w-sm border rounded-[32px] p-8 shadow-2xl animate-in zoom-in-95 duration-300 ${isWhiteTheme ? 'bg-white border-white text-[#0F172A]' : 'bg-[#1A1A2E] border-white/10 text-white'}`}>
            <div className="text-center mb-8">
              <span className="text-4xl mb-4 block">🛡️</span>
              <h2 className="text-xl font-black mb-2 tracking-tight">본인 확인이 필요합니다</h2>
              <p className={`text-[10px] font-bold uppercase tracking-widest leading-relaxed opacity-60`}>
                테연 클럽 명단에 등록된<br/><span className={isWhiteTheme ? 'text-[#B45309]' : 'text-[#D4AF37]'}>이름 또는 전화번호 뒷자리</span>를 입력하세요.
              </p>
            </div>
            
            <div className="space-y-4 mb-8">
                <input 
                    type="text" 
                    placeholder="이름 또는 번호 4자리..."
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className={`w-full bg-transparent border-b-2 py-3 text-center text-xl font-black transition-all outline-none ${isWhiteTheme ? 'border-[#E2E8F0] focus:border-[#B45309]' : 'border-white/10 focus:border-[#D4AF37]'}`}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />

                {!matchedMember ? (
                  <div className="flex flex-col gap-2">
                    {searchResult.length > 0 ? (
                        <div className="space-y-2 pt-2">
                           <p className="text-[9px] font-bold opacity-40 uppercase mb-2">검색 결과입니다:</p>
                           {searchResult.map(m => (
                               <button 
                                key={m.id} 
                                onClick={() => setMatchedMember(m)}
                                className={`w-full text-left py-3 px-4 rounded-xl border transition-all active:scale-95 flex justify-between items-center ${isWhiteTheme ? 'bg-slate-50 border-slate-100' : 'bg-white/5 border-white/5'}`}
                               >
                                   <span className="font-bold text-sm">{m.nickname}</span>
                                   <span className="text-[10px] opacity-40">{m.phone ? `*${m.phone.slice(-4)}` : 'N/A'}</span>
                               </button>
                           ))}
                           <button onClick={() => setSearchResult([])} className="w-full text-[10px] opacity-30 py-2">다시 검색</button>
                        </div>
                    ) : (
                        <button
                        onClick={handleSearch}
                        disabled={matchingStatus === 'searching'}
                        className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 ${isWhiteTheme ? 'bg-[#B45309] text-white shadow-xl shadow-[#B45309]/20' : 'bg-[#D4AF37] text-black shadow-xl shadow-[#D4AF37]/20'} ${matchingStatus === 'searching' ? 'opacity-50 animate-pulse' : ''}`}
                        >
                        {matchingStatus === 'searching' ? '찾는 중...' : '매칭하기'}
                        </button>
                    )}
                  </div>
                ) : (
                  <div className={`p-5 rounded-[24px] border animate-in slide-in-from-top-2 ${isWhiteTheme ? 'bg-[#FEFCE8] border-[#FEF08A]' : 'bg-[#D4AF37]/10 border-[#D4AF37]/30'}`}>
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-black opacity-40 uppercase tracking-tighter">확인된 멤버 명단</span>
                        <span className="text-[#10B981] text-[10px] font-[1000] tracking-tighter">AUTHENTICATED</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-xl font-[1000]">{matchedMember.nickname}</span>
                        <button 
                            onClick={() => confirmIdentity(matchedMember.id)}
                            className="bg-[#10B981] text-white px-5 py-2.5 rounded-xl text-[11px] font-black shadow-lg shadow-emerald-500/30 hover:scale-105 active:scale-95 transition-transform"
                        >
                            로그인 시작
                        </button>
                    </div>
                  </div>
                )}

                {matchingStatus === 'error' && (
                    <div className="text-center space-y-2 animate-in fade-in slide-in-from-bottom-2">
                        <p className="text-red-500 text-[10px] font-bold">등록된 정보를 찾을 수 없습니다.</p>
                        <p className="text-[9px] opacity-40 leading-relaxed font-bold">운영진에게 등록된 정확한 성명 <br/>또는 번호를 입력해주세요.</p>
                    </div>
                )}
            </div>

            <div className="flex flex-col items-center gap-4 mt-4">
                <button 
                    onClick={() => setPendingMatching(false)}
                    className={`w-full py-4 text-[10px] font-black uppercase tracking-[0.2em] ${isWhiteTheme ? 'text-[#B45309]' : 'text-[#D4AF37]'} bg-white/5 rounded-2xl active:scale-95 transition-all`}
                >
                정회원이 아닙니다 (Guest로 시작)
                </button>
                
                <button 
                    onClick={() => signOut()}
                    className={`w-full py-2 text-[10px] font-black uppercase tracking-[0.2em] opacity-40 hover:opacity-100 transition-opacity`}
                >
                로그아웃 후 다시 시도
                </button>
                <div className="flex flex-col items-center opacity-20">
                    <span className="text-[10px] font-black tracking-[0.4em] mb-1">TEYEON SECURITY</span>
                    <span className="text-[8px] font-black">ULTIMATE REAL-TIME v3.9 • PLATINUM</span>
                </div>
            </div>
          </div>
        </div>
      );
    }

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
