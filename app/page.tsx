'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from '@/components/ProfileAvatar';
import { 
  Users, 
  Trophy, 
  Swords, 
  Megaphone, 
  CircleDollarSign, 
  Cpu, 
  Settings,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Note: We don't need a heavy external Skeleton library, basic tailwind animate-pulse blocks work flawlessly.

export default function Home() {
  const { user, role, signInWithKakao, signOut, isLoading, systemMessage } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const menuItems = [
    { 
      label: '클럽 공지', 
      icon: <Megaphone size={32} />, 
      path: '/notice', 
      description: 'Bulletin Protocol', 
      bg: 'url("/brain/d480949b-af88-4b89-95c1-d020c66a33ad/luxury_club_management_texture_1776010630008.png")',
      bgPos: '0% 0%'
    },
    { 
      label: '멤버 프로필', 
      icon: <Users size={32} />, 
      path: '/members', 
      description: 'Elite Database', 
      bg: 'url("/brain/d480949b-af88-4b89-95c1-d020c66a33ad/luxury_club_management_texture_1776010630008.png")',
      bgPos: '50% 50%'
    },
    { 
      label: '스페셜 매치', 
      icon: <Sparkles size={32} />, 
      path: '/special', 
      description: 'Premier Competition', 
      highlight: true,
      bg: 'url("/brain/d480949b-af88-4b89-95c1-d020c66a33ad/luxury_tennis_special_match_bg_1776010591068.png")',
      bgPos: 'center'
    },
    { 
      label: '대전 생성', 
      icon: <Swords size={32} />, 
      path: '/kdk', 
      description: 'Strategic Engine', 
      bg: 'url("/brain/d480949b-af88-4b89-95c1-d020c66a33ad/kdk_strategic_engine_bg_1776010611021.png")',
      bgPos: 'center'
    },
    { 
      label: '클럽 재무', 
      icon: <CircleDollarSign size={32} />, 
      path: '/finance', 
      description: 'Capital Control', 
      comingSoon: true,
      bg: 'rgba(255,255,255,0.05)'
    },
    { 
      label: 'AI 시드 예측', 
      icon: <Cpu size={32} />, 
      path: '/prediction', 
      description: 'Future Analytics', 
      comingSoon: true,
      bg: 'rgba(255,255,255,0.05)'
    },
    { 
      label: '관리자 설정', 
      icon: <Settings size={32} />, 
      path: '/admin', 
      description: 'Master Control',
      bg: 'url("/brain/d480949b-af88-4b89-95c1-d020c66a33ad/luxury_club_management_texture_1776010630008.png")',
      bgPos: '100% 100%'
    },
  ];

  return (
    <main 
      className="min-h-screen bg-black px-5 pt-0 w-full max-w-[480px] mx-auto flex flex-col items-center overflow-x-hidden relative"
      style={{ paddingBottom: '250px' }}
    >
      {/* Background Decorative Radial */}
      <div className="absolute top-0 w-full h-[600px] bg-gradient-to-b from-[#C9B075]/10 to-transparent pointer-events-none -z-10" />

      <div className="w-full max-w-[430px] mx-auto flex flex-col items-center">
        
        <div className="h-[24px] w-full shrink-0" />

        {isLoading && (
          <div className="w-full flex flex-col gap-6 animate-pulse">
            <div className="w-full h-[60px] bg-[#1A1A1A]/40 rounded-xl mb-2"></div>
            <div className="grid grid-cols-2 gap-6 w-full">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-[170px] bg-[#1A1A1A]/60 rounded-[32px]"></div>
              ))}
            </div>
          </div>
        )}

        {/* Unauthenticated State */}
        {!isLoading && !user && (
          <div className="w-full flex flex-col items-center justify-center min-h-[40vh] px-6 py-12 mt-6 bg-gradient-to-b from-[#1A1A1A] to-black backdrop-blur-2xl rounded-[40px] border border-white/5 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#C9B075]/40 to-transparent"></div>
            <p className="text-[16px] font-black text-white/40 tracking-[0.4em] mb-12 text-center uppercase italic">
              Club Entrance Protocol
            </p>
            <button 
              onClick={() => signInWithKakao()}
              className="w-full py-5 rounded-full bg-gradient-to-r from-[#C9B075] to-[#E5D29B] text-black text-[15px] font-[1000] tracking-widest shadow-[0_15px_40px_rgba(201,176,117,0.3)] transition-all active:scale-95 flex items-center justify-center gap-4 italic uppercase"
            >
              Kakao Authentication
            </button>
          </div>
        )}

        {/* Authenticated State - Premium GRID */}
        {!isLoading && user && (
          <>
            <div className="grid grid-cols-2 gap-5 w-full mt-6">
              {menuItems.slice(0, 6).map((item, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1, type: "spring", stiffness: 100 }}
                  className="relative h-[180px]"
                >
                  <Link href={item.path} className="block w-full h-full">
                    <motion.div 
                      whileHover={{ scale: 1.03, y: -5 }}
                      whileTap={{ scale: 0.97 }}
                      className={`relative w-full h-full rounded-[36px] overflow-hidden border-2 transition-all duration-500 shadow-2xl p-6 flex flex-col justify-end
                        ${item.highlight ? 'border-[#C9B075]/60 ring-2 ring-[#C9B075]/10' : 'border-white/10'}
                      `}
                    >
                      {/* Background Image with Filter */}
                      <div 
                        className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                        style={{ 
                            backgroundImage: item.bg?.startsWith('url') ? item.bg : 'none',
                            backgroundColor: !item.bg?.startsWith('url') ? item.bg : 'transparent',
                            backgroundPosition: item.bgPos || 'center'
                        }}
                      />
                      {/* Gradient Overlay */}
                      <div className={`absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent`} />
                      
                      {/* Interactive Glow Overlay */}
                      <motion.div 
                         className="absolute inset-0 bg-[#C9B075]/0 group-hover:bg-[#C9B075]/10 transition-colors pointer-events-none"
                      />

                      {item.comingSoon && (
                        <div className="absolute top-5 right-6 z-20">
                           <span className="px-2.5 py-1 bg-white/10 text-white/30 text-[8px] font-black rounded-full border border-white/5 tracking-tighter uppercase italic">
                            Inactive
                          </span>
                        </div>
                      )}

                      <div className={`relative z-10 mb-3 transition-all duration-500 group-hover:scale-110 group-hover:-translate-y-1 ${item.highlight ? 'text-[#C9B075]' : 'text-white/40'}`}>
                        {item.icon}
                      </div>

                      <div className="relative z-10">
                        <h3 className={`text-[17px] font-black tracking-tighter transition-colors mb-0.5 ${item.highlight ? 'text-[#C9B075] italic' : 'text-white'}`}>
                          {item.label}
                        </h3>
                        <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] italic">
                          {item.description}
                        </p>
                      </div>
                    </motion.div>
                  </Link>
                </motion.div>
              ))}
            </div>

            <div className="h-4 w-full shrink-0" />

            <motion.div 
               initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
               className="w-full px-1"
            >
              <Link href={menuItems[6].path} className="block w-full h-20 group">
                <motion.div 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full h-full rounded-[30px] border-2 border-white/5 bg-gradient-to-r from-[#1A1A1A] to-black flex items-center justify-center gap-5 shadow-2xl relative overflow-hidden"
                >
                  <div 
                    className="absolute inset-0 opacity-10 bg-cover bg-center"
                    style={{ backgroundImage: menuItems[6].bg, backgroundPosition: menuItems[6].bgPos }}
                  />
                  <div className="relative z-10 text-[#C9B075]/40 transition-all duration-300 group-hover:scale-110 group-hover:text-[#C9B075]">
                    <Settings size={22} />
                  </div>
                  <span className="relative z-10 font-black text-[#C9B075]/60 tracking-[0.4em] text-[12px] uppercase group-hover:text-[#C9B075] transition-colors italic">
                    {menuItems[6].label}
                  </span>
                </motion.div>
              </Link>
            </motion.div>
          </>
        )}

        <div className="mt-12 text-center opacity-20 flex flex-col gap-2">
           <span className="text-[10px] font-black text-white/60 tracking-[0.5em] uppercase italic">
             Elite Membership Protocol
           </span>
        </div>
      </div>

      {(toast || systemMessage) && (
        <div className="fixed bottom-[130px] left-1/2 -translate-x-1/2 w-[90vw] max-w-[380px] p-[20px] bg-[#C9B075] text-black font-black text-center rounded-[24px] z-[2000] shadow-2xl tracking-[0.2em] text-[13px] uppercase italic">
          {toast || systemMessage}
        </div>
      )}
    </main>
  );
}

