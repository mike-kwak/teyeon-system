
'use client';

import React, { useState } from 'react';
import { Member } from '@/lib/tournament_types';
import { DataStateView } from '@/components/DataStateView';
import { Skeleton } from '@/components/Skeleton';
import { CustomRecoveryButton } from './Modals';

interface MemberSelectorProps {
    allMembers: Member[];
    tempGuests: Member[];
    selectedIds: Set<string>;
    isMembersLoading: boolean;
    isMembersError: boolean;
    stepLabel?: string;
    title?: string;
    sessionKey?: string;
    onToggle: (id: string) => void;
    onAddGuest: (name: string) => void;
    onFetchMembers: () => void;
    onConfirm: () => void;
    onReset: () => void;
    onRestore: (data: any) => void;
    onBack?: () => void;
}

export default function MemberSelector({
    allMembers,
    tempGuests,
    selectedIds,
    isMembersLoading,
    isMembersError,
    stepLabel = "Step 01",
    title = "참석자 확정",
    sessionKey = "kdk_live_session",
    onToggle,
    onAddGuest,
    onFetchMembers,
    onConfirm,
    onReset,
    onRestore,
    onBack
}: MemberSelectorProps) {
    const [showGuestInput, setShowGuestInput] = useState(false);
    const [newGuestName, setNewGuestName] = useState("");

    const handleAddGuest = () => {
        if (!newGuestName.trim()) return;
        onAddGuest(newGuestName.trim());
        setNewGuestName("");
        setShowGuestInput(false);
    };

    return (
        <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative">
            <header className="grid grid-cols-3 px-6 mb-1 items-center h-12">
                <div className="flex items-center gap-4">
                    {onBack && (
                        <button 
                            onClick={onBack}
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-white/40 active:scale-90 transition-all"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>
                        </button>
                    )}
                    <CustomRecoveryButton onRestore={onRestore} sessionKey={sessionKey} />
                </div>

                <div className="text-center flex flex-col items-center">
                    <span className="text-[10px] font-black text-[#C9B075] tracking-[0.5em] uppercase px-3 py-1 bg-[#C9B075]/10 rounded-full border border-[#C9B075]/20 mb-1 inline-block leading-none scale-90">{stepLabel}</span>
                    <h1 className="text-3xl font-black italic tracking-tighter uppercase whitespace-nowrap text-white leading-none">{title}</h1>
                </div>

                <div className="flex justify-end">
                    <button
                        onClick={onReset}
                        className="h-9 px-3 rounded-full bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-500/80 hover:bg-red-500/20 transition-all active:scale-95 group"
                        title="전체 데이터 초기화"
                    >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="group-hover:rotate-180 transition-transform duration-500"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                        <span className="text-[9px] font-black uppercase tracking-tighter">초기화</span>
                    </button>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-2 no-scrollbar" style={{ paddingBottom: '240px' }}>
                <DataStateView
                    isLoading={isMembersLoading}
                    isError={isMembersError}
                    onRetry={onFetchMembers}
                    loadingComponent={
                        <div className="grid grid-cols-3 gap-2">
                            {[...Array(12)].map((_, i) => <Skeleton key={i} size="lg" />)}
                        </div>
                    }
                >
                    <section className="space-y-4">
                        <div className="grid grid-cols-3 gap-x-3 gap-y-6 py-1">
                            {[...allMembers, ...tempGuests].map(m => {
                                const isSelected = selectedIds.has(m.id);
                                const isGuest = m.is_guest || m.id.startsWith('guest-') || m.id.startsWith('g-');
                                return (
                                    <div
                                        key={m.id}
                                        onClick={() => onToggle(m.id)}
                                        className={`h-22 rounded-[24px] border-2 transition-all flex flex-col items-center justify-center cursor-pointer text-center px-1
                                        ${isSelected
                                                ? 'bg-[#C9B075] border-white/20 text-black shadow-[0_10px_25px_rgba(201,176,117,0.4)] scale-100 z-10'
                                                : 'bg-[#1A1A1A] border-white/5 text-white/90 hover:bg-white/10 hover:border-white/10 scale-95 opacity-80 shadow-lg'}`}
                                    >
                                        <span className="text-[15px] font-bold break-keep leading-tight px-1 drop-shadow-sm">
                                            {m.nickname}{isGuest ? ' (G)' : ''}
                                        </span>
                                        {isGuest && <span className={`text-[8px] font-black uppercase mt-1 ${isSelected ? 'text-black/60' : 'text-[#C9B075]'}`}>Guest</span>}
                                    </div>
                                );
                            })}

                            {showGuestInput ? (
                                <div className="h-20 rounded-2xl border border-[#C9B075] bg-black/40 px-2 flex items-center gap-1 animate-in zoom-in-95">
                                    <input
                                        autoFocus
                                        value={newGuestName}
                                        onChange={(e) => setNewGuestName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleAddGuest();
                                            if (e.key === 'Escape') setShowGuestInput(false);
                                        }}
                                        placeholder="이름"
                                        className="w-full bg-transparent text-sm font-black text-[#C9B075] outline-none text-center"
                                    />
                                    <button onClick={handleAddGuest} className="text-[#C9B075] font-black px-1">↵</button>
                                </div>
                            ) : (
                                <button onClick={() => setShowGuestInput(true)} className="h-20 rounded-2xl border-2 border-dashed border-[#C9B075]/40 bg-[#C9B075]/5 text-[#C9B075] flex flex-col items-center justify-center active:scale-95 hover:bg-[#C9B075]/10 hover:border-[#C9B075]/60 transition-all group">
                                    <span className="text-3xl font-bold group-hover:scale-125 transition-transform text-[#C9B075] leading-none mb-1">+</span>
                                    <span className="text-[9px] font-black uppercase tracking-tighter text-[#C9B075]">ADD GUEST</span>
                                </button>
                            )}
                        </div>
                    </section>
                </DataStateView>
            </div>

            <div className="fixed bottom-[120px] left-1/2 -translate-x-1/2 w-full max-w-[480px] px-6 z-[70] pointer-events-none">
                <div className="relative">
                    <div className="absolute inset-x-0 -inset-y-4 bg-gradient-to-t from-[#121212] via-[#121212]/80 to-transparent backdrop-blur-md rounded-[24px] -z-10" />
                    <button
                        onClick={onConfirm}
                        style={{
                            width: '100%',
                            padding: '8px 0',
                            borderRadius: '999px',
                            background: '#C9B075',
                            color: '#000000',
                            border: '1px solid rgba(255, 255, 255, 0.4)',
                            fontSize: '14px',
                            fontWeight: 1000,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            cursor: 'pointer',
                            WebkitTextFillColor: '#000000',
                            transition: 'all 0.15s',
                            boxShadow: '0 10px 30px rgba(201,176,117,0.4)',
                        }}
                        className="active:scale-95 pointer-events-auto"
                    >
                        참석자 확정 및 설정 ➡️
                    </button>
                </div>
            </div>
        </main>
    );
}
