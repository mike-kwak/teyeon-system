'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { logAction } from '@/lib/logging';
import Link from 'next/link';
import ProfileAvatar from '@/components/ProfileAvatar';

interface AdminMember {
  id: string; // member table id
  email?: string | null;
  nickname: string;
  role: string;
  avatar_url: string | null;
}

const ROLE_OPTIONS = [
  { group: '운영진 (Staff)', roles: ['회장', '부회장', '총무', '재무', '경기', '섭외'] },
  { group: '회원 (Member)', roles: ['정회원', '준회원', '게스트'] }
];

const FEATURE_REGISTRY: Record<string, { label: string, icon: string }> = {
  notice: { label: '클럽 공지사항', icon: '📢' },
  profile: { label: '멤버 프로필', icon: '👤' },
  profiles: { label: '멤버 프로필', icon: '👤' },
  tournament: { label: '스페셜 매치', icon: '🔥' },
  kdk: { label: 'KDK 대진 운영', icon: '⚙️' },
  live_court: { label: '라이브 코트', icon: '🎾' },
  scores: { label: '라이브 코트', icon: '🎾' },
  archive: { label: '경기 아카이브', icon: '📂' },
  finance: { label: '클럽 재무 장부', icon: '💰' },
  admin_settings: { label: '마스터 관리 설정', icon: '🛠️' },
  stats: { label: '방문 통계/기록', icon: '📈' }
};

const ALL_FEATURES = ['notice', 'profile', 'tournament', 'kdk', 'live_court', 'archive', 'finance', 'stats', 'admin'] as const;

export default function AdminPage() {
  const { role, appConfig, isLoading, refreshConfig } = useAuth();
  const router = useRouter();
  
  // Data State
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState<any[]>([]);
  
  // UI State
  const [activeTab, setActiveTab] = useState<'members' | 'permissions' | 'menu' | 'history'>('members');
  const [isSyncing, setIsSyncing] = useState(false);
  const [fetchingMembers, setFetchingMembers] = useState(false);
  const [fetchingHistory, setFetchingHistory] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Gating
  useEffect(() => {
    if (!isLoading && (role !== 'CEO' && role !== 'ADMIN')) {
      router.replace('/');
    }
  }, [role, isLoading, router]);

  const fetchMembersData = async (force = false) => {
    if (!force && members.length > 0) return;
    setFetchingMembers(true);
    setFetchError(null);
    try {
      const { data, error } = await supabase
        .from('members')
        .select('id, nickname, role, avatar_url')
        .order('nickname', { ascending: true });
      if (error) throw error;
      setMembers(data || []);
    } catch (err: any) {
      console.error('[Admin] Fetch Members Error:', err);
      setFetchError(err.message || String(err));
    } finally {
      setFetchingMembers(false);
    }
  };

  const fetchHistoryData = async (force = false) => {
    if (!force && logs.length > 0) return;
    setFetchingHistory(true);
    try {
      const { data: logsData } = await supabase
        .from('app_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      setLogs(logsData || []);

      // Optional/Safety RPC
      try {
        const { data: statsData } = await supabase.rpc('get_daily_visit_stats'); 
        if (statsData) setStats(statsData);
      } catch (rpcErr) {
        console.warn('Daily stats RPC error, skipping:', rpcErr);
      }
    } catch (err) {
      console.warn('[Admin] History fetch error:', err);
    } finally {
      setFetchingHistory(false);
    }
  };

  // Tab Trigger
  useEffect(() => {
    if (role === 'CEO' || role === 'ADMIN') {
      if (activeTab === 'members') fetchMembersData();
      if (activeTab === 'history' && role === 'CEO') fetchHistoryData();
    }
  }, [role, activeTab]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const updateConfig = async (newConfig: any) => {
    setIsSyncing(true);
    try {
      const { error } = await supabase
        .from('app_config')
        .update(newConfig)
        .eq('id', 'primary');
      if (error) throw error;
      await refreshConfig();
      showToast('마스터 설정 동기화 완료');
    } catch (err: any) {
      showToast('저장 실패: ' + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRoleChange = async (member: AdminMember, newRole: string) => {
    if (member.role === newRole) return;
    setUpdatingId(member.id);
    try {
      let systemRole: 'ADMIN' | 'MEMBER' | 'GUEST' = 'GUEST';
      if (ROLE_OPTIONS[0].roles.includes(newRole)) systemRole = 'ADMIN';
      else if (ROLE_OPTIONS[1].roles.includes(newRole)) systemRole = 'MEMBER';

      await supabase.from('members').update({ role: newRole }).eq('id', member.id);
      if (member.email) {
        await supabase.from('profiles').update({ role: systemRole }).eq('email', member.email);
      }
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: newRole } : m));
      logAction('/admin', 'role_changed', { target: member.nickname, newRole });
      showToast(`${member.nickname} ➔ ${newRole}`);
    } catch (err: any) {
      showToast('변경 실패: ' + err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  if (isLoading || (role !== 'CEO' && role !== 'ADMIN')) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#000000]">
        <div className="w-10 h-10 border-4 border-[#D4AF37] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const globalIsSyncing = isSyncing || fetchingMembers || fetchingHistory || updatingId !== null;

  return (
    <main className="flex flex-col min-h-screen bg-[#000000] text-white font-sans w-full pb-10">
      <header className="sticky top-0 z-40 bg-black/90 backdrop-blur-md border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/')} className="text-[#D4AF37] text-xl font-bold w-10 h-10 flex items-center justify-center hover:bg-white/10 rounded-full">←</button>
          <div className="leading-tight">
            <span className="text-[10px] text-[#D4AF37] font-black uppercase tracking-[0.2em]">CONTROL CENTER</span>
            <h1 className="text-sm font-black tracking-tight text-white uppercase opacity-80">Master Configuration</h1>
          </div>
        </div>
        <div onClick={() => fetchMembersData(true)} className="flex items-center gap-2 cursor-pointer bg-[#D4AF37]/10 px-3 py-1.5 rounded-full border border-[#D4AF37]/20 hover:bg-[#D4AF37]/20 transition-all group">
            <span className={`text-xs ${globalIsSyncing ? 'animate-spin' : 'group-hover:rotate-12 transition-transform'}`}>⚔️</span>
            <span className="text-[8px] font-black text-[#D4AF37] uppercase tracking-[0.3em]">{globalIsSyncing ? 'SYNCING...' : 'MASTER AUTH'}</span>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="flex px-4 mt-6 border-b border-white/10 sticky top-[73px] z-30 bg-black/95">
        {(['members', 'permissions', 'menu', 'history'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`
              flex-1 pb-4 text-[11px] font-black tracking-[0.1em] transition-all relative mt-2
              ${activeTab === tab ? 'text-[#D4AF37]' : 'text-white/40 hover:text-white'}
            `}
          >
            {tab === 'members' ? '인사' : tab === 'permissions' ? '권한' : tab === 'menu' ? '순서' : '방문 통계'}
            {activeTab === tab && (
              <div className="absolute bottom-[-1px] left-2 right-2 h-[2px] bg-[#D4AF37] shadow-[0_0_15px_rgba(212,175,55,0.8)]"></div>
            )}
          </button>
        ))}
      </nav>

      <div className="px-5 py-6 flex-1">
        {/* Tab 1: Personnel */}
        {activeTab === 'members' && (
          <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between mb-6 px-1">
                <h3 className="text-[10px] font-black text-white/50 uppercase tracking-[0.2em]">Member Directory</h3>
                <div className="flex items-center gap-2">
                    {fetchingMembers && <div className="w-2.5 h-2.5 border border-[#D4AF37] border-t-transparent rounded-full animate-spin"></div>}
                    <span className="text-[10px] font-bold text-[#D4AF37] bg-[#D4AF37]/10 px-3 py-1 rounded-full border border-[#D4AF37]/20 uppercase">Total {members.length}</span>
                </div>
            </div>

            {fetchError ? (
                <div className="bg-red-500/10 border border-red-500/20 p-5 rounded-3xl text-xs text-red-500 font-bold mb-6">
                   ⚠️ Sync Error: {fetchError}
                   <button onClick={() => fetchMembersData(true)} className="block mt-2 underline opacity-60">재시도</button>
                </div>
            ) : (
                <div className="space-y-2.5">
                    {members.map(m => (
                        <div key={m.id} className="bg-white/[0.03] border border-white/5 p-4 rounded-[32px] flex items-center gap-4 hover:border-white/20 transition-all hover:bg-white/[0.05]">
                            <ProfileAvatar src={m.avatar_url} alt={m.nickname} size={40} className="rounded-full shrink-0 border border-white/10 shadow-sm" fallbackIcon="👤" />
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-black tracking-tight">{m.nickname}</p>
                                <p className="text-[9px] text-[#A3E635] font-black tracking-[0.1em] mt-0.5 truncate uppercase">{m.role}</p>
                            </div>
                            <select 
                                value={m.role}
                                onChange={(e) => handleRoleChange(m, e.target.value)}
                                disabled={updatingId === m.id}
                                className={`bg-[#0A0A0F] text-[#D4AF37] text-[10px] font-black px-3 py-2 rounded-xl border border-white/10 outline-none ${updatingId === m.id ? 'opacity-20' : 'hover:border-[#D4AF37]/50'}`}
                            >
                                {ROLE_OPTIONS.map(g => (
                                    <optgroup key={g.group} label={g.group} className="bg-[#0A0A0F] text-white italic">
                                        {g.roles.map(r => <option key={r} value={r}>{r}</option>)}
                                    </optgroup>
                                ))}
                            </select>
                        </div>
                    ))}
                    {members.length === 0 && !fetchingMembers && (
                        <div className="py-20 text-center opacity-20 italic font-medium">No results found.</div>
                    )}
                </div>
            )}
          </section>
        )}

        {/* Tab 2: Permissions */}
        {activeTab === 'permissions' && (
          <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-5">
            <div className="px-1 mb-2">
                <h3 className="text-xs font-black text-white uppercase tracking-[0.3em]">Authorization Matrix</h3>
                <p className="text-[9px] text-[#A3E635] font-black mt-1 uppercase tracking-widest opacity-60 italic">Live Security Controller</p>
            </div>
            {ALL_FEATURES.map(feat => {
                const reg = FEATURE_REGISTRY[feat] || { label: feat, icon: '🛡️' };
                return (
                    <div key={feat} className="bg-white/[0.03] rounded-[36px] p-6 border border-white/5">
                        <div className="flex items-center gap-4 mb-6">
                            <span className="text-2xl">{reg.icon}</span>
                            <span className="text-[14px] font-black text-white/90 tracking-tight uppercase">{reg.label}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {(['ADMIN', 'MEMBER', 'GUEST'] as const).map(roleKey => {
                                const level = appConfig?.permissions?.[roleKey]?.[feat] || 'HIDE';
                                return (
                                    <div key={roleKey} className="flex flex-col gap-2">
                                        <span className="text-[8px] font-black text-white/30 text-center uppercase tracking-[0.1em]">{roleKey}</span>
                                        <button 
                                            disabled={isSyncing}
                                            onClick={() => {
                                                const levels = { ...(appConfig?.permissions || {}) };
                                                if (!levels[roleKey]) levels[roleKey] = {};
                                                const nextLevel = level === 'WRITE' ? 'READ' : level === 'READ' ? 'HIDE' : 'WRITE';
                                                (levels[roleKey] as any)[feat] = nextLevel;
                                                updateConfig({ permissions: levels });
                                            }}
                                            className={`
                                                w-full text-[10px] font-black py-3 rounded-2xl text-center border transition-all active:scale-90
                                                ${level === 'WRITE' ? 'bg-[#22C55E]/10 border-[#22C55E]/40 text-[#22C55E]' : 
                                                  level === 'READ' ? 'bg-[#3B82F6]/10 border-[#3B82F6]/40 text-[#3B82F6]' : 
                                                  'bg-white/5 border-white/5 text-white/20'}
                                                ${isSyncing ? 'opacity-30 cursor-not-allowed' : ''}
                                            `}
                                        >
                                            {level === 'WRITE' ? '쓰기' : level === 'READ' ? '읽기' : '제한'}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
          </section>
        )}

        {/* Tab 3: Orchestration (Menu Order) */}
        {activeTab === 'menu' && (
          <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h3 className="text-xs font-black text-white uppercase tracking-[0.3em] mb-7 px-1 opacity-80">Orchestration Tower</h3>
            {(['ADMIN', 'MEMBER', 'GUEST'] as const).map(roleKey => (
                <div key={roleKey} className="mb-12 last:mb-0">
                    <h4 className="text-[10px] font-black text-[#D4AF37] tracking-[0.2em] uppercase mb-4 px-2">{roleKey} VIEW SEQUENCE</h4>
                    <div className="bg-white/[0.02] rounded-[40px] p-2 space-y-1.5 border border-white/5 text-sm">
                        {(appConfig?.menu_order?.[roleKey] || []).map((itemId, idx) => {
                             const lowerId = itemId.toLowerCase();
                             const reg = FEATURE_REGISTRY[lowerId] || FEATURE_REGISTRY[itemId] || { label: itemId, icon: '⚙️' };
                             return (
                                <div key={itemId} className="flex items-center gap-4 p-4 bg-white/[0.03] rounded-[30px] border border-white/5">
                                    <span className="text-[10px] font-black text-[#D4AF37]/30 w-4 text-center">{idx + 1}</span>
                                    <span className="text-xl">{reg.icon}</span>
                                    <span className="text-[13px] font-bold flex-1 text-white/90 truncate tracking-tight">{reg.label}</span>
                                    <div className="flex gap-1.5 text-xs">
                                        <button 
                                            disabled={idx === 0 || isSyncing}
                                            onClick={() => {
                                                const order = [...(appConfig?.menu_order?.[roleKey] || [])];
                                                [order[idx-1], order[idx]] = [order[idx], order[idx-1]];
                                                updateConfig({ menu_order: { ...appConfig?.menu_order, [roleKey]: order } });
                                            }}
                                            className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-2xl border border-white/10 hover:bg-white/10 active:scale-90 transition-all disabled:opacity-5"
                                        >↑</button>
                                        <button 
                                            disabled={idx === (appConfig?.menu_order?.[roleKey]?.length || 0) - 1 || isSyncing}
                                            onClick={() => {
                                                const order = [...(appConfig?.menu_order?.[roleKey] || [])];
                                                [order[idx], order[idx+1]] = [order[idx+1], order[idx]];
                                                updateConfig({ menu_order: { ...appConfig?.menu_order, [roleKey]: order } });
                                            }}
                                            className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-2xl border border-white/10 hover:bg-white/10 active:scale-90 transition-all disabled:opacity-5"
                                        >↓</button>
                                    </div>
                                </div>
                             );
                        })}
                    </div>
                </div>
            ))}
          </section>
        )}

        {/* Tab 4: Visiting Stats (CEO Only) */}
        {activeTab === 'history' && (
          <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            {role !== 'CEO' ? (
              <div className="flex flex-col items-center justify-center py-20 text-center space-y-5 bg-white/[0.02] rounded-[40px] border border-white/5 mx-2">
                <span className="text-5xl opacity-20 grayscale">🔒</span>
                <div className="leading-tight">
                    <p className="text-sm font-black text-[#D4AF37] uppercase tracking-tighter shadow-sm mb-1">CEO EXCLUSIVE VAULT</p>
                    <p className="text-[10px] text-white/30 font-medium font-sans">관리자 탭 중 방문 통계는 오직 회장님만 열람 가능합니다.</p>
                </div>
                <button onClick={() => setActiveTab('members')} className="text-[11px] font-bold text-white/40 hover:text-white underline decoration-[#D4AF37] underline-offset-8 transition-all px-8 py-3 bg-white/5 rounded-full">인사 관리로 돌아가기</button>
              </div>
            ) : (
            <div className="flex flex-col gap-9">
                <div className="bg-gradient-to-br from-[#1A253D] to-[#14141F] rounded-[48px] p-8 border border-[#D4AF37]/20 shadow-2xl relative overflow-hidden group">
                    <div className="relative z-10">
                        <h3 className="text-xs font-black text-[#D4AF37] uppercase tracking-[0.3em] mb-7 flex items-center gap-3">
                            Audience Velocity
                            {fetchingHistory && <div className="w-2.5 h-2.5 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin"></div>}
                        </h3>
                        <div className="flex justify-between items-end gap-2.5 h-36">
                            {(stats.length > 0 ? stats : [4, 7, 12, 8, 15, 22, 18]).map((v: any, i) => (
                                <div key={i} className="flex-1 flex flex-col items-center gap-3.5 group/bar">
                                    <div className="w-full bg-gradient-to-t from-[#D4AF37]/10 to-[#D4AF37]/80 rounded-full transition-all duration-300 group-hover/bar:brightness-150" style={{ height: `${(typeof v === 'object' ? v.count : v) / 1.5}rem` }}></div>
                                    <span className="text-[9px] text-white/10 font-black uppercase tracking-widest">{6-i === 0 ? 'Now' : `d-${6-i}`}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div>
                   <div className="flex items-center justify-between mb-6 px-3">
                       <h3 className="text-[10px] font-black text-white/40 uppercase tracking-[0.4em]">Chronos Security Feed</h3>
                       <div className="px-3 py-1 bg-[#A3E635]/10 rounded-full border border-[#A3E635]/20 text-[8px] font-black text-[#A3E635] uppercase tracking-widest animate-pulse font-sans">Live Feed</div>
                   </div>
                   <div className="space-y-3 font-sans">
                        {logs.slice(0, 15).map((log, i) => (
                            <div key={i} className="bg-white/[0.03] border border-white/5 p-5 rounded-[36px] flex flex-col gap-3">
                                <div className="flex justify-between items-start">
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-black text-[#A3E635] uppercase tracking-widest">{log.action || 'INTERACT'}</span>
                                        <span className="text-[13px] font-black text-white mt-1 tracking-tight">{log.path || '/'}</span>
                                    </div>
                                    <span className="text-[9px] text-white/20 font-mono font-black uppercase">{new Date(log.created_at).toLocaleTimeString()}</span>
                                </div>
                                <div className="flex items-center gap-2 pt-2 border-t border-white/[0.03]">
                                    <ProfileAvatar src={null} alt="User" size={14} className="opacity-30 rounded-full" fallbackIcon="👤" />
                                    <p className="text-[9px] text-white/30 truncate font-mono tracking-tighter uppercase">{log.user_email || 'SECURE GUEST'}</p>
                                </div>
                            </div>
                        ))}
                   </div>
                </div>
            </div>
            )}
          </section>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50 bg-[#D4AF37] text-black px-10 py-4 rounded-full font-black shadow-[0_20px_60px_rgba(212,175,55,0.4)] animate-in slide-in-from-bottom-5 fade-in border border-white/20 text-[10px] uppercase tracking-[0.2em] whitespace-nowrap">
            🏆 {toast}
        </div>
      )}
    </main>
  );
}
