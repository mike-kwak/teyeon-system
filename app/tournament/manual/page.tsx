'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Layout, Hash, Trash2, Plus, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import PremiumSpinner from '@/components/PremiumSpinner';
import MemberSelector from '@/components/tournament/MemberSelector';
import { Member, AttendeeConfig } from '@/lib/tournament_types';

export default function ManualMatchLab() {
    const router = useRouter();
    const { role } = useAuth();
    const [allMembers, setAllMembers] = useState<Member[]>([]);
    const [tempGuests, setTempGuests] = useState<Member[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [attendeeConfigs, setAttendeeConfigs] = useState<Record<string, AttendeeConfig>>({});
    const [step, setStep] = useState(1);
    const [isLoading, setIsLoading] = useState(true);
    const [isMembersLoading, setIsMembersLoading] = useState(true);
    const [sessionTitle, setSessionTitle] = useState("");

    const isAdmin = role === 'CEO' || role === 'ADMIN';

    useEffect(() => {
        fetchMembers();
        const d = new Date();
        const yy = String(d.getFullYear()).slice(-2);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        setSessionTitle(`${yy}${mm}${dd}_MANUAL_01`);
    }, []);

    const fetchMembers = async () => {
        try {
            setIsMembersLoading(true);
            const { data, error } = await supabase
                .from('members')
                .select('*')
                .order('nickname');
            if (error) throw error;
            setAllMembers(data || []);
        } catch (err) {
            console.error(err);
        } finally {
            setIsMembersLoading(false);
            setIsLoading(false);
        }
    };

    const toggleMember = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
            const member = [...allMembers, ...tempGuests].find(m => m.id === id);
            if (member && !attendeeConfigs[id]) {
                setAttendeeConfigs(prev => ({
                    ...prev,
                    [id]: {
                        id,
                        name: member.nickname,
                        group: (member.position || '').toUpperCase().includes('B') ? 'B' : 'A',
                        startTime: '19:00',
                        endTime: '22:00'
                    }
                }));
            }
        }
        setSelectedIds(next);
    };

    const handleStep1Confirm = () => {
        if (selectedIds.size < 4) {
            alert("최소 4명의 참가자가 필요합니다.");
            return;
        }
        setStep(2);
    };

    if (isLoading) return <PremiumSpinner />;

    // --- Step 1: Attendee Selection ---
    if (step === 1) {
        return (
            <MemberSelector
                allMembers={allMembers}
                tempGuests={tempGuests}
                selectedIds={selectedIds}
                isMembersLoading={isMembersLoading}
                isMembersError={false}
                title="매뉴얼 매치 참석자"
                onToggle={toggleMember}
                onAddGuest={(name) => {
                    const guest: Member = { id: `g-${Date.now()}`, nickname: name, is_guest: true };
                    setTempGuests(prev => [...prev, guest]);
                    const next = new Set(selectedIds);
                    next.add(guest.id);
                    setSelectedIds(next);
                    setAttendeeConfigs(prev => ({
                        ...prev,
                        [guest.id]: { id: guest.id, name, is_guest: true, group: 'A', startTime: '19:00', endTime: '22:00' }
                    }));
                }}
                onFetchMembers={fetchMembers}
                onConfirm={handleStep1Confirm}
                onReset={() => {
                    setSelectedIds(new Set());
                    setAttendeeConfigs({});
                    setTempGuests([]);
                }}
                onRestore={(data) => {
                    if (data.selectedIds) setSelectedIds(new Set(data.selectedIds));
                    if (data.attendeeConfigs) setAttendeeConfigs(data.attendeeConfigs);
                    if (data.tempGuests) setTempGuests(data.tempGuests);
                    if (data.sessionTitle) setSessionTitle(data.sessionTitle);
                    if (data.step) setStep(data.step);
                }}
                onBack={() => router.push('/tournament')}
            />
        );
    }

    // --- Step 2: Simplified Manual Settings ---
    if (step === 2) {
        const attendees = Array.from(selectedIds).map(id => {
            const m = [...allMembers, ...tempGuests].find(x => x.id === id);
            return { id, name: m?.nickname || 'Unknown', is_guest: !!m?.is_guest };
        });

        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative pb-60">
                <header className="grid grid-cols-3 px-6 mb-4 items-center h-12 shrink-0 pt-4">
                    <div className="flex items-center">
                        <button
                            onClick={() => setStep(1)}
                            className="w-10 h-10 rounded-full flex items-center justify-center border border-[#C9B075]/30 bg-[#C9B075]/10 text-[#C9B075]"
                        >
                            <span className="text-xl">←</span>
                        </button>
                    </div>

                    <div className="text-center flex flex-col items-center">
                        <span className="text-[10px] font-black text-[#C9B075] tracking-[0.5em] uppercase px-3 py-1 bg-[#C9B075]/10 rounded-full border border-[#C9B075]/20 mb-1 leading-none scale-90">Step 02</span>
                        <h1 className="text-3xl font-black italic tracking-tighter uppercase whitespace-nowrap text-white leading-none">매뉴얼 설정</h1>
                    </div>

                    <div className="flex justify-end" />
                </header>

                <div className="px-6 space-y-10 max-w-lg mx-auto w-full pt-10">
                    {/* Session Title Section */}
                    <section className="space-y-4">
                        <div className="flex items-center gap-3 px-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#C9B075]" />
                            <h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.2em]">Archive Title</h3>
                        </div>
                        <input
                            type="text"
                            value={sessionTitle}
                            onChange={(e) => setSessionTitle(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-[24px] px-6 py-5 text-sm font-black text-white focus:border-[#C9B075]/50 outline-none transition-all"
                            placeholder="Ex: 20260428_MANUAL_01"
                        />
                    </section>

                    {/* Attendee Matrix (A/B Split) */}
                    <section className="bg-[#1E1E1E] border border-white/5 rounded-[40px] p-8">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-[13px] font-bold text-[#C9B075] tracking-[0.3em] uppercase flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-[#C9B075]" />
                                ATTENDEE MATRIX
                            </h3>
                            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">{attendees.length} SELECTED</span>
                        </div>
                        
                        <div className="space-y-2 max-h-[480px] overflow-y-auto no-scrollbar">
                            {attendees.map(m => {
                                const config = attendeeConfigs[m.id] || { id: m.id, name: m.name, group: "A", startTime: "19:00", endTime: "22:00" };
                                return (
                                    <div key={m.id} className="bg-[#141414] border border-white/5 rounded-[20px] p-3 flex items-center justify-between">
                                        <span className="text-[14px] font-black text-white/90 ml-2">
                                            {m.name}{m.is_guest ? ' (G)' : ''}
                                        </span>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'A' } }))}
                                                className={`w-10 h-10 rounded-xl font-black transition-all ${config.group === 'A' ? 'bg-[#C9B075] text-black' : 'bg-[#0A0A0A] border border-white/10 text-white/40'}`}
                                            >A</button>
                                            <button
                                                onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'B' } }))}
                                                className={`w-10 h-10 rounded-xl font-black transition-all ${config.group === 'B' ? 'bg-[#C9B075] text-black' : 'bg-[#0A0A0A] border border-white/10 text-white/40'}`}
                                            >B</button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    {/* Removed: Strategy Section */}
                    {/* Removed: Fixed Partners Section */}

                    <div className="pt-10">
                        <button
                            onClick={() => alert("Next Step: Manual Match Builder (To be implemented)")}
                            className="w-full h-20 rounded-[32px] bg-gradient-to-r from-[#C9B075] to-[#B8860B] text-black font-black uppercase tracking-[0.4em] text-sm shadow-[0_20px_60px_rgba(201,176,117,0.4)] active:scale-95 transition-all"
                        >
                            Confirm & Next: Pair Matches
                        </button>
                        <p className="mt-4 text-center text-[9px] font-bold text-white/20 uppercase tracking-widest italic leading-relaxed">
                            매뉴얼 모드는 사용자가 직접 대진을 구성합니다.<br />조 배정은 랭킹 계산에 반영됩니다.
                        </p>
                    </div>
                </div>

                {/* Background Decor */}
                <div className="fixed top-0 right-0 w-[500px] h-[500px] bg-[#C9B075]/5 rounded-full blur-[120px] -z-10 pointer-events-none" />
            </main>
        );
    }

    return null;
}
