
'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Swords, Layout, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface LiveMatchGatekeeperProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function LiveMatchGatekeeper({ isOpen, onClose }: LiveMatchGatekeeperProps) {
    const router = useRouter();

    const selectMode = (path: string) => {
        router.push(path);
        onClose();
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[3000] flex flex-col justify-start items-center p-6 pt-[15vh]">
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/80 backdrop-blur-xl"
                    />
                    
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="relative w-full max-w-sm bg-[#1A1A1A] border border-white/10 rounded-[40px] p-8 shadow-[0_40px_100px_rgba(0,0,0,0.9)] overflow-hidden"
                    >
                        {/* Luxury Background Accents */}
                        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#C9B075]/40 to-transparent" />
                        <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#C9B075]/5 rounded-full blur-3xl" />
                        
                        <button onClick={onClose} className="absolute top-6 right-6 text-white/20 hover:text-white transition-colors">
                            <X size={24} />
                        </button>

                        <div className="text-center mb-10">
                            <span className="text-[10px] font-black text-[#C9B075] tracking-[0.4em] uppercase mb-2 block">Live Gatekeeper</span>
                            <h2 className="text-2xl font-black italic text-white tracking-tighter uppercase leading-tight">
                                어떤 게임을<br />진행하시겠습니까?
                            </h2>
                        </div>

                        <div className="space-y-4">
                            <button 
                                onClick={() => selectMode('/kdk')}
                                className="w-full group relative flex items-center gap-6 p-6 rounded-[28px] bg-white/[0.03] border border-white/5 hover:bg-white/[0.08] hover:border-[#C9B075]/30 transition-all active:scale-[0.98]"
                            >
                                <div className="w-14 h-14 rounded-2xl bg-[#C9B075]/10 flex items-center justify-center text-[#C9B075] group-hover:scale-110 transition-transform shadow-[0_0_20px_rgba(201,176,117,0.1)]">
                                    <Swords size={28} />
                                </div>
                                <div className="text-left">
                                    <h4 className="font-black text-lg text-white group-hover:text-[#C9B075] transition-colors uppercase">KDK 자동 모드</h4>
                                    <p className="text-[10px] font-bold text-white/40 tracking-wider uppercase">Auto Matchmaking & Ranking</p>
                                </div>
                                <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-[#C9B075] animate-pulse" />
                            </button>

                            <button 
                                onClick={() => selectMode('/special')}
                                className="w-full group relative flex items-center gap-6 p-6 rounded-[28px] bg-white/[0.03] border border-white/5 hover:bg-white/[0.08] hover:border-[#EF4444]/30 transition-all active:scale-[0.98]"
                            >
                                <div className="w-14 h-14 rounded-2xl bg-[#EF4444]/10 flex items-center justify-center text-[#EF4444] group-hover:scale-110 transition-transform shadow-[0_0_20px_rgba(239,68,68,0.1)]">
                                    <Layout size={28} />
                                </div>
                                <div className="text-left">
                                    <h4 className="font-black text-lg text-white group-hover:text-[#EF4444] transition-colors uppercase">스페셜 매치</h4>
                                    <p className="text-[10px] font-bold text-white/40 tracking-wider uppercase">100% 자율 매칭 및 실시간 대진 설계</p>
                                </div>

                                <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-[#EF4444] animate-pulse" />
                            </button>
                        </div>

                        <p className="mt-8 text-[10px] text-center font-bold text-white/20 tracking-widest uppercase italic">
                            Authorized Personnel Only
                        </p>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
