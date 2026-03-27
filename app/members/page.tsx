'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

interface Member {
  id: string;
  nickname: string;
  role?: string;
  is_admin?: boolean;
  is_guest?: boolean;
  phone?: string;
  mbti?: string;
  affiliation?: string;
  position?: string;
  achievements?: string;
}

const EXE_PRIORITY: Record<string, number> = {
  '회장': 1,
  '부회장': 2,
  '총무': 3,
  '재무': 4,
  '경기': 5,
  '섭외': 6,
};

const MEMBER_PRIORITY: Record<string, number> = {
  '정회원': 10,
  '준회원': 20,
  '게스트': 30,
};

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchMembers();
  }, []);

  // Helper to get member priority (lower is higher priority)
  const getMemberPriority = (m: Member): number => {
    const role = (m.role || '').trim();
    const pos = (m.position || '').trim();
    
    // 1. Check for Executives first (either in role or position)
    if (EXE_PRIORITY[role]) return EXE_PRIORITY[role];
    if (EXE_PRIORITY[pos]) return EXE_PRIORITY[pos];
    
    // 2. Check for Admin flag (usually mapped to CEO/회장)
    if (m.is_admin) return 0; // Highest
    
    // 3. Check for standard member types
    if (MEMBER_PRIORITY[role]) return MEMBER_PRIORITY[role];
    if (MEMBER_PRIORITY[pos]) return MEMBER_PRIORITY[pos];
    
    // 4. Guest flag
    if (m.is_guest) return 30;
    
    return 99; // Unknown
  };

  async function fetchMembers() {
    try {
      setLoading(true);
      setErrorMsg(null);
      const { data, error } = await supabase
        .from('members')
        .select('*');

      if (error) throw error;
      
      if (data) {
        // High-precision sorting for Executive-First policy
        const sortedData = [...data].sort((a, b) => {
          const aP = getMemberPriority(a);
          const bP = getMemberPriority(b);
          
          if (aP !== bP) return aP - bP;
          
          // Secondary sort: alphabetical by nickname
          return (a.nickname || '').localeCompare(b.nickname || '', 'ko');
        });
        setMembers(sortedData);
      }
    } catch (err: any) {
      console.error('Error fetching members:', err.message || err);
      setErrorMsg(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  const getRoleBadgeColor = (role: string) => {
    const r = role.trim();
    // Executive: Deep Blue or Red
    if (r === '회장' || r === '부회장' || r === 'CEO') return 'bg-[#DC2626] text-white shadow-[0_0_15px_rgba(220,38,38,0.3)] font-black'; // Accent Red
    if (EXE_PRIORITY[r]) return 'bg-[#2563EB] text-white shadow-[0_0_15px_rgba(37,99,235,0.3)] font-black'; // Primary Blue
    
    // Regular & Associate Members
    if (r === '정회원' || r === 'MEMBER') return 'bg-[#1A8D4D] text-white/90 font-bold';
    if (r === '준회원') return 'bg-[#10B981] text-white/90 font-bold'; // Bold Emerald
    
    return 'bg-white/5 text-white/30 border border-white/10 font-medium';
  };

  return (
    <main className="flex flex-col min-h-screen p-6 bg-[#000000] text-white font-sans max-w-4xl mx-auto pb-10">
      {/* Header */}
      <header className="flex items-center justify-between mb-10 max-w-md mx-auto w-full md:max-w-none">
        <Link href="/" className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-transform">
          <span className="text-xl">←</span>
        </Link>
        <h1 className="text-2xl font-black tracking-tighter flex items-center gap-3">
          클럽 멤버 <span className="text-[#D4AF37] text-sm font-bold bg-[#D4AF37]/10 px-3 py-1 rounded-full">{members.length}명</span>
        </h1>
        <div className="w-10"></div>
      </header>

      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl mb-6 text-red-200 text-xs font-bold max-w-md mx-auto w-full md:max-w-none">
          ⚠️ 오류 발생: {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center py-20">
          <div className="w-12 h-12 border-2 border-white/5 border-t-[#D4AF37] rounded-full animate-spin"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {members.map((member) => (
            <div 
              key={member.id}
              className="bg-gradient-to-br from-[#1A253D] to-[#0A0E1A] border border-white/5 rounded-[32px] p-6 flex flex-col shadow-2xl hover:border-[#D4AF37]/40 transition-all duration-300 group"
            >
              {/* Header: Name & Role */}
              <div className="flex justify-between items-start mb-5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-2xl font-black tracking-tight group-hover:text-[#D4AF37] transition-colors">{member.nickname}</h3>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {/* Primary Badge (Most Important) */}
                    {(() => {
                      const p1 = getMemberPriority(member);
                      const role = (member.role || '').trim();
                      const pos = (member.position || '').trim();
                      
                      // Determine which label is primary based on executive priority or existence
                      let primaryLabel = '';
                      let secondaryLabel = '';

                      const isRoleExe = EXE_PRIORITY[role] || role === 'CEO';
                      const isPosExe = EXE_PRIORITY[pos] || pos === 'CEO';

                      if (isRoleExe && isPosExe) {
                        // Both are executive, prioritize based on EXE_PRIORITY or default to role
                        if (EXE_PRIORITY[role] < EXE_PRIORITY[pos] || !EXE_PRIORITY[pos]) {
                          primaryLabel = role;
                          secondaryLabel = (pos !== role) ? pos : '';
                        } else {
                          primaryLabel = pos;
                          secondaryLabel = (role !== pos) ? role : '';
                        }
                      } else if (isRoleExe) {
                        primaryLabel = role;
                        secondaryLabel = (pos !== role) ? pos : '';
                      } else if (isPosExe) {
                        primaryLabel = pos;
                        secondaryLabel = (role !== pos) ? role : '';
                      } else {
                        // Neither is executive, prioritize role then position
                        primaryLabel = role || pos || '게스트';
                        if (primaryLabel === role && pos && pos !== role) {
                          secondaryLabel = pos;
                        } else if (primaryLabel === pos && role && role !== pos) {
                          secondaryLabel = role;
                        }
                      }

                      // Fallback for empty primary label
                      if (!primaryLabel) primaryLabel = '게스트';

                      return (
                        <>
                          <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider ${getRoleBadgeColor(primaryLabel)}`}>
                            {primaryLabel}
                          </span>
                          {secondaryLabel && (
                            <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider ${getRoleBadgeColor(secondaryLabel)}`}>
                              {secondaryLabel}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl shadow-inner group-hover:scale-110 group-hover:bg-[#D4AF37]/10 group-hover:border-[#D4AF37]/20 transition-all">
                  🎾
                </div>
              </div>

              {/* Body: Details */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] text-white/20 font-black uppercase tracking-widest">Contact</span>
                    <span className="text-xs font-bold text-white/80">{member.phone || '비공개'}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] text-white/20 font-black uppercase tracking-widest">MBTI</span>
                    <span className="text-xs font-bold text-[#D4AF37]">{member.mbti || '-'}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1 border-t border-white/5 pt-3">
                  <span className="text-[9px] text-white/20 font-black uppercase tracking-widest">Affiliation</span>
                  <span className="text-xs font-bold text-white/60">{member.affiliation || 'Teyeon Club'}</span>
                </div>

                {member.achievements && (
                  <div className="flex flex-col gap-1 border-t border-white/5 pt-3 bg-white/[0.02] -mx-6 px-6 py-3">
                    <span className="text-[9px] text-[#D4AF37]/60 font-black uppercase tracking-widest">Awards</span>
                    <p className="text-[11px] font-medium text-white/50 leading-relaxed italic">
                      {member.achievements}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {members.length === 0 && !loading && (
        <div className="text-center py-20 opacity-30 flex flex-col items-center">
          <span className="text-5xl mb-6">🏜️</span>
          <p className="text-lg font-black tracking-tight">멤버가 존재하지 않습니다.</p>
        </div>
      )}

      {/* Footer Info */}
      <footer className="mt-16 py-8 border-t border-white/5 flex flex-col items-center opacity-20">
        <p className="text-[10px] font-black tracking-widest uppercase mb-2">Teyeon Club Management System</p>
        <p className="text-[8px] font-bold">PREMIUM CHAMPAGNE GOLD Ed. v2.0</p>
      </footer>
    </main>
  );
}
