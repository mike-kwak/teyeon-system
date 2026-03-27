'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { generateKdkMatches, Player as KdkPlayer, Match as KdkMatch } from '@/lib/kdk';

// --- Types & Interfaces ---
interface Member {
    id: string;
    nickname: string;
    role?: string;
    position?: string;
    is_guest?: boolean;
}

type AttendeeConfig = {
    id: string;
    name: string;
    is_guest?: boolean;
    group: 'A' | 'B';
    startTime: string;
    endTime: string;
    isLate?: boolean;
    age?: number;
    isWinner?: boolean;
};

interface Match {
    id: string;
    playerIds: string[];
    court: number | null;
    status: 'waiting' | 'playing' | 'complete';
    score1?: number;
    score2?: number;
    mode: string;
    round?: number;
    teams?: [string[], string[]];
}

type KDKConcept = 'RANDOM' | 'LEVEL' | 'MBTI' | 'WINNER' | 'AGE';

// --- Role Support ---
type UserRole = 'CEO' | 'Staff' | 'Member' | 'Guest';

export default function KDKPage() {
    const [step, setStep] = useState(1);
    const [allMembers, setAllMembers] = useState<Member[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [tempGuests, setTempGuests] = useState<Member[]>([]);
    const [showGuestInput, setShowGuestInput] = useState(false);
    const [newGuestName, setNewGuestName] = useState("");

    const [sessionId, setSessionId] = useState<string | null>(null);
    const [sessionTitle, setSessionTitle] = useState(() => {
        const d = new Date();
        const yy = String(d.getFullYear()).slice(-2);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yy}${mm}${dd}_KDK_01`;
    });
    const [matches, setMatches] = useState<Match[]>([]);
    const [activeMatchIds, setActiveMatchIds] = useState<string[]>([]);
    const [attendeeConfigs, setAttendeeConfigs] = useState<Record<string, AttendeeConfig>>({});

    const [genMode, setGenMode] = useState<KDKConcept>('RANDOM');
    const [totalCourts, setTotalCourts] = useState(2);
    const [matchTime, setMatchTime] = useState(30);
    const [fixedPartners, setFixedPartners] = useState<[string, string][]>([]);
    const [fixedTeamMode, setFixedTeamMode] = useState(false);
    const [partnerSelectSource, setPartnerSelectSource] = useState<string | null>(null);
    const [targetGames, setTargetGames] = useState(4);
    const [matchRules, setMatchRules] = useState("1:1 시작, 노에드, 타이 3:3 시작 7포인트 선승");

    const [firstPrize, setFirstPrize] = useState(10000);
    const [bottom25Late, setBottom25Late] = useState(3000);
    const [bottom25Penalty, setBottom25Penalty] = useState(5000);
    const [accountInfo, setAccountInfo] = useState("카카오뱅크 3333-01-5235337 (곽민섭)");
    const [currentTime, setCurrentTime] = useState("");
    const [showScoreModal, setShowScoreModal] = useState<string | null>(null);
    const [tempScores, setTempScores] = useState({ s1: 0, s2: 0 });
    const [showRankingModal, setShowRankingModal] = useState(false);
    const [userRole, setUserRole] = useState<UserRole>('CEO');
    const [isGenerating, setIsGenerating] = useState(false);
    const [activeTab, setActiveTab] = useState<'MATCHES' | 'RANKING'>('MATCHES');
    const [showWarning, setShowWarning] = useState(false);
    const [warningMsg, setWarningMsg] = useState("");

    const [showGuestDataModal, setShowGuestDataModal] = useState(false);
    const [hasSkippedGuestInfo, setHasSkippedGuestInfo] = useState(false);

    const handleGuestDataSave = (id: string, age: number, isWinner: boolean) => {
        setAttendeeConfigs(prev => ({
            ...prev,
            [id]: {
                ...(prev[id] || { id, name: "Unknown", group: 'A', startTime: '18:00', endTime: '22:00' } as any),
                age,
                isWinner
            }
        }));
    };

    const validateGroups = (): { ok: boolean; msg: string } => {
        const attendees = Array.from(selectedIds).map(id => {
            const config = attendeeConfigs[id];
            // If no config found (rare, but possible if newly selected), default to A
            return config?.group || 'A';
        });

        const countA = attendees.filter(g => g === 'A').length;
        const countB = attendees.filter(g => g === 'B').length;

        if (countA > 0 && countA < 4) {
            return { ok: false, msg: "A조 인원이 부족합니다 (최소 4명 필요)" };
        }
        if (countB > 0 && countB < 4) {
            return { ok: false, msg: "B조 인원이 부족합니다 (최소 4명 필요)" };
        }
        if (countA === 0 && countB === 0) {
            return { ok: false, msg: "최소 1명 이상의 참석자가 필요합니다" };
        }

        return { ok: true, msg: "" };
    };

    const handleStep1Confirm = () => {
        const result = validateGroups();
        if (!result.ok) {
            setWarningMsg(result.msg);
            setShowWarning(true);
            return;
        }
        setStep(2);
    };

    const [showResetConfirm, setShowResetConfirm] = useState(false);

    useEffect(() => {
        fetchMembers();
        const timer = setInterval(() => {
            setCurrentTime(new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' }));
        }, 1000);

        // Silently check for existing session instead of prompt
        const saved = localStorage.getItem('kdk_live_session');
        if (saved) {
             // We don't auto-load anymore to keep it clean, but we could store it for manual recovery
             console.log("Existing session found in LS");
        }

        return () => clearInterval(timer);
    }, []);

    // Save to LocalStorage
    useEffect(() => {
        const data = {
            matches,
            attendeeConfigs,
            selectedIds: Array.from(selectedIds),
            tempGuests,
            step,
            sessionTitle
        };
        localStorage.setItem('kdk_live_session', JSON.stringify(data));
    }, [matches, attendeeConfigs, selectedIds, tempGuests, step, sessionTitle]);

    const fetchMembers = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const { data: profile } = await supabase.from('profiles').select('club_role').eq('id', user.id).single();
            if (profile) setUserRole(profile.club_role as UserRole);
        }

        const { data } = await supabase.from('members').select('*').order('nickname');
        if (data) setAllMembers(data);
    };

    const toggleMember = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const addQuickGuest = () => {
        if (!newGuestName.trim()) return;
        const guest: Member = { id: `g-${Date.now()}`, nickname: newGuestName.trim(), is_guest: true };
        setTempGuests(prev => [...prev, guest]);
        const next = new Set(selectedIds);
        next.add(guest.id);
        setSelectedIds(next);
        setNewGuestName("");
        setShowGuestInput(false);
    };

    const resetSession = () => {
        setShowResetConfirm(true);
    };

    const confirmReset = () => {
        setSelectedIds(new Set());
        setTempGuests([]);
        setMatches([]);
        setActiveMatchIds([]);
        setAttendeeConfigs({});
        setSessionId(null);
        setStep(1);
        setFixedPartners([]);
        setFixedTeamMode(false);
        setShowResetConfirm(false);
        localStorage.removeItem('kdk_live_session');
    };

    const getPlayerName = (id: string) => {
        const m = [...allMembers, ...tempGuests].find(x => x.id === id);
        const name = attendeeConfigs[id]?.name || m?.nickname || "???";
        const isGuest = m?.is_guest || attendeeConfigs[id]?.is_guest;
        return isGuest ? `${name}(G)` : name;
    };

    const generateKDK = async () => {
        const result = validateGroups();
        if (!result.ok) {
            setWarningMsg(result.msg);
            setShowWarning(true);
            return;
        }

        const selectedAttendees = Array.from(selectedIds).map(id => {
            const m = allMembers.find(x => x.id === id) || tempGuests.find(x => x.id === id);
            const conf = attendeeConfigs[id] || { group: m?.position || 'A' };
            const group = (conf.group || 'A').toUpperCase().includes('B') ? 'B' : 'A';
            return { id, group };
        });

        const countA = selectedAttendees.filter(a => a.group === 'A').length;
        const countB = selectedAttendees.filter(a => a.group === 'B').length;

        if (countA < 4) {
            setWarningMsg("A조 인원이 부족합니다 (최소 4명 필요)");
            setShowWarning(true);
            return;
        }

        if (countB > 0 && countB < 4) {
            setWarningMsg("B조 인원이 부족합니다 (최소 4명 필요)");
            setShowWarning(true);
            return;
        }

        setIsGenerating(true);
        try {
            const attendees = Array.from(selectedIds).map(id => {
                const m = allMembers.find(x => x.id === id) || tempGuests.find(x => x.id === id);
                const conf = attendeeConfigs[id] || { group: 'A', startTime: '18:00', endTime: '22:00' };
                return {
                    id,
                    name: m?.nickname || "Unknown",
                    group: conf.group,
                    times: [conf.startTime, conf.endTime] as [string, string],
                    isGuest: m?.is_guest,
                    achievements: !!conf.isWinner, // Use actual isWinner flag
                    birthdate: conf.age ? String(new Date().getFullYear() - conf.age) : undefined, // Encode age as birth year for engine
                } as KdkPlayer;
            });

            const groupCourtMap: Record<string, number[]> = {
                'A': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                'B': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            };

            const kdkMatches = generateKdkMatches(attendees, groupCourtMap, targetGames, genMode, fixedPartners, fixedTeamMode);
            
            // Convert KdkMatch to internal Match
            const formattedMatches: Match[] = kdkMatches.map(km => ({
                id: km.id,
                playerIds: [...km.team1, ...km.team2].map(name => attendees.find(a => a.name === name)?.id || name),
                court: km.court,
                status: 'waiting',
                mode: 'KDK',
                round: km.round,
                teams: [km.team1, km.team2]
            })) as any;

            // DB SAVE DISABLED (EMERGENCY LOCAL-ONLY MODE)

            if (window.navigator?.vibrate) window.navigator.vibrate([100, 50, 100]); // 딩-동!
            setMatches(formattedMatches);
            setStep(3);
        } catch (err: any) {
            console.error(err);
            alert("대진 생성 실패: " + err.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const startMatch = async (matchId: string) => {
        // Find lowest available court number
        const inUseCourts = matches.filter(m => m.status === 'playing').map(m => m.court || 0);
        let nextCourt = 1;
        while (inUseCourts.includes(nextCourt)) nextCourt++;

        const nextActive = [...activeMatchIds, matchId];
        const nextMatches = matches.map(m => m.id === matchId ? { ...m, status: 'playing' as const, court: nextCourt } : m);
        setActiveMatchIds(nextActive);
        setMatches(nextMatches);
    };

    const updateMatchCourt = (matchId: string) => {
        const courtStr = prompt("변경할 코트 번호를 입력하세요", "1");
        if (courtStr === null) return;
        const courtNum = parseInt(courtStr) || 1;
        setMatches(prev => prev.map(m => m.id === matchId ? { ...m, court: courtNum } : m));
    };
    
    const finishMatch = async (matchId: string, s1: number, s2: number) => {
        const nextMatches = matches.map(m => m.id === matchId ? { ...m, status: 'complete' as const, score1: s1, score2: s2 } : m);
        const nextActive = activeMatchIds.filter(id => id !== matchId);
        setMatches(nextMatches);
        if (window.navigator?.vibrate) window.navigator.vibrate([100, 50, 100]); // 완료 진동
        setActiveMatchIds(nextActive);
        setShowScoreModal(null);
        /*
        if (sessionId) {
            const { data: existing } = await supabase.from('matches_archive').select('data').eq('id', sessionId).single();
            const nextData = {
                ...(existing?.data || {}),
                matches: nextMatches,
                attendee_configs: attendeeConfigs,
            };
            await supabase.from('matches_archive').update({ data: nextData }).eq('id', sessionId);
        }
        */
    };

    const playerStats = useMemo(() => {
        const res: Record<string, { wins: number, losses: number, diff: number, games: number }> = {};
        matches.filter(m => m.status === 'complete').forEach(m => {
            m.playerIds.forEach((pid, idx) => {
                if (!res[pid]) res[pid] = { wins: 0, losses: 0, diff: 0, games: 0 };
                const isTeam1 = idx < 2;
                const score1 = Number(m.score1 || 0);
                const score2 = Number(m.score2 || 0);
                const win = isTeam1 ? (score1 > score2) : (score2 > score1);
                const d = isTeam1 ? (score1 - score2) : (score2 - score1);
                
                res[pid].games += 1;
                if (win) res[pid].wins += 1;
                else res[pid].losses += 1;
                res[pid].diff += d;
            });
        });
        return res;
    }, [matches]);

    const allPlayersInRanking = useMemo(() => {
        const participantIds = selectedIds.size > 0 
            ? Array.from(selectedIds) 
            : Array.from(new Set(matches.flatMap(m => m.playerIds)));

        return participantIds.map(id => {
            const m = allMembers.find(x => x.id === id) || tempGuests.find(x => x.id === id);
            const conf = attendeeConfigs[id] || { name: m?.nickname || id, group: 'A', is_guest: m?.is_guest };
            return {
                id, 
                name: m?.nickname || id, 
                is_guest: m?.is_guest || conf.is_guest,
                group: conf.group || 'A',
                age: conf.age || 0,
                ...playerStats[id] || { wins: 0, losses: 0, diff: 0, games: 0 }
            };
        }).sort((a, b) => b.wins - a.wins || b.diff - a.diff);
    }, [playerStats, attendeeConfigs, selectedIds, matches, allMembers, tempGuests]);

    const copyMatchTable = () => {
        let text = `📌 오늘의 대진표: ${sessionTitle}\n`;
        text += `⚖️ 규칙: ${matchRules}\n`;
        text += `💰 상벌금: 1등 ${firstPrize.toLocaleString()}원 / 하위 ${bottom25Late.toLocaleString()}~${bottom25Penalty.toLocaleString()}원\n`;
        text += `━━━━━━━━━━━━━━\n`;
        
        const matchesByRound: Record<number, Match[]> = {};
        matches.forEach(m => {
            const r = m.round || 1;
            if (!matchesByRound[r]) matchesByRound[r] = [];
            matchesByRound[r].push(m);
        });

        Object.entries(matchesByRound).sort(([a], [b]) => Number(a) - Number(b)).forEach(([round, roundMatches]) => {
            text += `📍 ${round}라운드\n`;
            roundMatches.forEach((m, idx) => {
                text += `${idx + 1}코트: ${getPlayerName(m.playerIds[0])}/${getPlayerName(m.playerIds[1])} vs ${getPlayerName(m.playerIds[2])}/${getPlayerName(m.playerIds[3])}\n`;
            });
            text += `\n`;
        });

        text += `━━━━━━━━━━━━━━\n`;
        text += `※ 상세 결과 확인: ${window.location.origin}/kdk`;
        
        navigator.clipboard.writeText(text);
        alert("📋 대진표 텍스트가 복사되었습니다!");
    };

    const copyFinalResults = () => {
        let text = `📌 오늘의 대진표: ${sessionTitle}\n`;
        text += `실시간 및 확정 랭킹 및 벌금 현황\n`;
        text += `🏦 계좌: ${accountInfo}\n`;
        text += `━━━━━━━━━━━━━━\n\n`;
        
        const sortedPlayers = [...allPlayersInRanking];
        const totalCount = sortedPlayers.length;
        // Bottom 25% get penalties
        const penaltyThreshold = Math.ceil(totalCount * 0.25);
        const penaltyStartIndex = totalCount - penaltyThreshold;

        sortedPlayers.forEach((p, i) => {
            let rankPrefix = '';
            if (i === 0) rankPrefix = '🥇 ';
            else if (i === 1) rankPrefix = '🥈 ';
            else if (i === 2) rankPrefix = '🥉 ';
            else rankPrefix = `${i + 1}위 `;

            let prizePenalty = '';
            if (i === 0) {
                prizePenalty = ` [💰 +${firstPrize.toLocaleString()}원]`;
            } else if (i >= penaltyStartIndex) {
                const isLate = attendeeConfigs[p.id]?.isLate;
                const amt = isLate ? bottom25Late : bottom25Penalty;
                prizePenalty = ` [💸 -${amt.toLocaleString()}원]`;
            } else {
                prizePenalty = ` [0원]`;
            }

            text += `${rankPrefix}${p.name}${p.is_guest?'(G)':''}: ${p.wins}승 ${p.losses}패${prizePenalty}\n`;
        });

        text += `\n━━━━━━━━━━━━━━\n`;
        text += `※ 전체 결과 확인: ${window.location.origin}/kdk`;
        
        navigator.clipboard.writeText(text);
        alert("📊 최종 결과 및 벌금 현황이 복사되었습니다!");
    };

    function addMinutesToTime(time: string, mins: number) {
        const [h, m] = time.split(':').map(Number);
        const total = h * 60 + m + mins;
        const nh = Math.floor(total / 60) % 24;
        const nm = total % 60;
        return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
    }

    const busyPlayerIds = new Set(matches.filter(m => m.status === 'playing').flatMap(m => m.playerIds || []));

    // --- Step 1: Attendee Selection ---
    if (step === 1) {
        return (
            <main className="flex flex-col min-h-screen bg-[#000000] text-white font-sans max-w-lg mx-auto relative overflow-hidden">
                <header className="flex items-center justify-between px-6 pt-[calc(1.5rem+var(--safe-top))] mb-8 gap-4">
                    <div className="flex items-center gap-3">
                        <Link href="/" className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-transform">
                            <span className="text-xl">←</span>
                        </Link>
                        <button 
                            onClick={() => setShowResetConfirm(true)}
                            className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/30 hover:text-red-500/60 transition-all active:scale-95 group"
                            title="Reset Tournament"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:rotate-180 transition-transform duration-500"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                        </button>
                    </div>

                    <div className="flex-[2] text-center flex flex-col items-center">
                        <span className="text-[10px] font-black text-[#D4AF37] tracking-[0.5em] uppercase px-3 py-1 bg-[#D4AF37]/10 rounded-full border border-[#D4AF37]/20 mb-2 inline-block">Step 01</span>
                        <h1 className="text-3xl font-black italic tracking-tighter uppercase whitespace-nowrap">참석자 확정</h1>
                        <div className="mt-3 flex items-center justify-center gap-2">
                             <div className="h-px w-4 bg-[#D4AF37]/30" />
                             <span className="text-[9px] font-black text-white/30 uppercase tracking-widest">{selectedIds.size} PLAYERS READY</span>
                             <div className="h-px w-4 bg-[#D4AF37]/30" />
                        </div>
                    </div>

                    <div className="flex-1 flex justify-end">
                        <ManualRecoveryButton 
                            onRestore={(data) => {
                                 setMatches(data.matches || []);
                                 setAttendeeConfigs(data.attendeeConfigs || {});
                                 setSelectedIds(new Set(data.selectedIds || []));
                                 setTempGuests(data.tempGuests || []);
                                 setStep(data.step || 1);
                                 setSessionTitle(data.sessionTitle || "");
                                 if (data.settings?.finance) {
                                     setFirstPrize(data.settings.finance.firstPrize);
                                     setBottom25Late(data.settings.finance.bottom25Late);
                                     setBottom25Penalty(data.settings.finance.bottom25Penalty);
                                     setAccountInfo(data.settings.finance.accountInfo);
                                 }
                            }} 
                        />
                    </div>
                </header>

                <div className="flex-1 px-6 space-y-6 overflow-y-auto no-scrollbar pb-32">
                    <section className="space-y-4">
                        <div className="flex items-center justify-between border-b border-white/5 pb-2">
                            <h3 className="text-[10px] font-black text-white/40 tracking-[0.3em] uppercase">Members List</h3>
                            <button 
                                onClick={() => setSelectedIds(new Set())}
                                className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[8px] font-black text-white/30 uppercase tracking-[0.2em] active:scale-95 transition-all hover:text-[#4ADE80] hover:border-[#4ADE80]/30 hover:bg-[#4ADE80]/5"
                            >
                                전체 해제
                            </button>
                        </div>
                    <div className="grid grid-cols-4 gap-2 mb-10">
                        {[...allMembers, ...tempGuests].map(m => {
                            const isSelected = selectedIds.has(m.id);
                            return (
                                <div
                                    key={m.id}
                                    onClick={() => toggleMember(m.id)}
                                    className={`h-14 rounded-2xl border transition-all flex items-center justify-center cursor-pointer text-center px-1
                                    ${isSelected ? 'bg-[#D4AF37]/20 border-[#D4AF37] shadow-[0_5px_15px_rgba(212,175,55,0.1)]' : 'bg-white/[0.02] border-white/5 opacity-40 hover:opacity-100'}`}
                                >
                                    <span className={`text-[11px] font-black break-keep ${isSelected ? 'text-[#D4AF37]' : 'text-white/50'}`}>
                                        {m.nickname}{m.is_guest ? ' (G)' : ''}
                                    </span>
                                </div>
                            );
                        })}

                        {showGuestInput ? (
                            <div className="h-14 rounded-2xl border border-[#D4AF37] bg-black/40 px-2 flex items-center gap-1 animate-in zoom-in-95">
                                <input
                                    autoFocus
                                    value={newGuestName}
                                    onChange={(e) => setNewGuestName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') addQuickGuest();
                                        if (e.key === 'Escape') setShowGuestInput(false);
                                    }}
                                    placeholder="이름"
                                    className="w-full bg-transparent text-[11px] font-black text-[#D4AF37] outline-none text-center"
                                />
                                <button onClick={() => addQuickGuest()} className="text-[#D4AF37] text-xs pr-1">↵</button>
                            </div>
                        ) : (
                            <button onClick={() => setShowGuestInput(true)} className="h-14 rounded-2xl border border-dashed border-white/10 text-white/10 flex items-center justify-center active:scale-95 hover:bg-white/5 transition-all">
                                <span className="text-xl font-light">+</span>
                            </button>
                        )}
                    </div>

                    </section>

                    {/* Removed ArchiveSection per user request for clean Step 1 */}
                </div>

                <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#0A0A0F] to-transparent z-20">
                    <button onClick={handleStep1Confirm} className="w-full max-w-md mx-auto py-5 bg-[#D4AF37] text-black font-black text-lg rounded-[28px] shadow-2xl active:scale-95 flex items-center justify-center gap-2">
                        참석자 확정 및 설정 ➡️
                    </button>
                </div>

                {showResetConfirm && (
                    <CustomConfirmModal 
                        title="초기화 확인" 
                        message="모든 데이터를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다." 
                        onConfirm={confirmReset} 
                        onCancel={() => setShowResetConfirm(false)} 
                    />
                )}
                {showWarning && (
                    <WarningModal 
                        message={warningMsg} 
                        onClose={() => setShowWarning(false)} 
                    />
                )}
            </main>
        );
    }

    // --- Step 2: Settings Dashboard ---
    if (step === 2) {
        const attendees = Array.from(selectedIds).map(id => {
            const m = [...allMembers, ...tempGuests].find(x => x.id === id);
            return { id, name: m?.nickname || 'Unknown', is_guest: !!m?.is_guest };
        });
        const timeOptions = ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"];

        const availablePlayersForPartnering = [...allMembers, ...tempGuests].filter(m => selectedIds.has(m.id) && !fixedPartners.flat().includes(m.id));

        return (
            <main className="flex flex-col min-h-screen bg-[#14141F] text-white font-sans max-w-4xl mx-auto p-4 pb-48">
                {((genMode === 'WINNER' || genMode === 'AGE') && !showGuestDataModal && !hasSkippedGuestInfo && attendees.some(m => m.is_guest && (attendeeConfigs[m.id]?.age === undefined || attendeeConfigs[m.id]?.isWinner === undefined))) && (
                    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
                        <div className="bg-[#1C1C28] border border-[#D4AF37]/30 rounded-[32px] p-8 max-w-md w-full shadow-2xl space-y-6 animate-in zoom-in-95">
                            <div className="text-center space-y-2">
                                <span className="text-[10px] font-black text-[#D4AF37] tracking-[0.4em] uppercase">Data Required</span>
                                <h3 className="text-xl font-black italic text-white tracking-tighter uppercase">게스트 상세 정보 필요</h3>
                                <p className="text-[10px] font-bold text-white/40 leading-relaxed uppercase tracking-widest">이 모드는 게스트의 나이와 입상 여부가 필요합니다.</p>
                            </div>
                            <button 
                                onClick={() => setShowGuestDataModal(true)}
                                className="w-full py-4 bg-[#D4AF37] text-black font-black rounded-2xl shadow-xl active:scale-95 transition-all text-xs uppercase tracking-widest"
                            >
                                정보 입력하기 ➡️
                            </button>
                        </div>
                    </div>
                )}

                {showGuestDataModal && (
                    <GuestDataModal 
                        guests={attendees.filter(m => m.is_guest)} 
                        configs={attendeeConfigs} 
                        onSave={handleGuestDataSave} 
                        onClose={() => { setShowGuestDataModal(false); setHasSkippedGuestInfo(true); }} 
                    />
                )}

                <header className="flex flex-col items-center mb-10 pt-[calc(1rem+var(--safe-top))]">
                    <span className="text-[10px] font-black text-[#D4AF37] tracking-[0.5em] uppercase px-3 py-1 bg-[#D4AF37]/10 rounded-full border border-[#D4AF37]/20 mb-2">Step 02</span>
                    <h1 className="text-3xl font-black italic tracking-tighter text-center uppercase">Tournament Dashboard</h1>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 px-4">
                    <div className="lg:col-span-12 mb-4">
                        <span className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-4 block">Archive Title</span>
                        <input 
                            type="text" 
                            value={sessionTitle} 
                            onChange={(e) => setSessionTitle(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm font-bold text-white focus:border-[#D4AF37]/50 transition-all outline-none"
                            placeholder="Ex: 2026-03-27 테연 정기전"
                        />
                    </div>

                    <div className="lg:col-span-7 space-y-6">
                        <section className="bg-white/[0.02] border border-white/5 rounded-[32px] p-6 backdrop-blur-md">
                            <h3 className="text-[10px] font-black text-[#D4AF37] tracking-[0.3em] uppercase mb-6 px-2">Attendee Matrix</h3>
                            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                                {attendees.map(m => {
                                    const config = attendeeConfigs[m.id] || { id: m.id, name: m.name, startTime: "19:00", endTime: "22:00", group: "A" };
                                    return (
                                        <div key={m.id} className="bg-black/20 border border-white/5 rounded-2xl p-4 flex items-center justify-between gap-4">
                                            <div className="flex flex-col min-w-[80px]">
                                                <span className="text-xs font-black text-white">{m.name}</span>
                                                <span className="text-[8px] font-bold text-white/20 uppercase tracking-tighter">{m.is_guest ? 'Guest' : 'Member'}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 flex-1 justify-end">
                                                <button 
                                                    onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, isLate: !config.isLate } }))}
                                                    className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all ${config.isLate ? 'bg-orange-500/20 border-orange-500/50 text-orange-500' : 'bg-white/5 border-white/10 text-white/20 hover:text-white/40'}`}
                                                    title="지각 처리"
                                                >
                                                    🕒
                                                </button>
                                                <select value={config.startTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, startTime: e.target.value } }))} className="bg-white/5 border border-white/10 rounded-xl px-2 py-2 text-[10px] font-bold text-white/60 outline-none">
                                                    {timeOptions.map(t => <option key={t} value={t} className="text-black">{t}</option>)}
                                                </select>
                                                <span className="text-[8px] font-black text-white/10">TO</span>
                                                <select value={config.endTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, endTime: e.target.value } }))} className="bg-white/5 border border-white/10 rounded-xl px-2 py-2 text-[10px] font-bold text-white/60 outline-none">
                                                    {timeOptions.map(t => <option key={t} value={t} className="text-black">{t}</option>)}
                                                </select>
                                                <div className="flex bg-white/5 rounded-xl border border-white/10 p-0.5 ml-2">
                                                    {['A', 'B'].map(g => (
                                                        <button key={g} onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: g as any } }))} className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${config.group === g ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-white/20 hover:text-white/40'}`}>{g}</button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    </div>

                    <div className="lg:col-span-5 space-y-6">
                        <section className="bg-[#D4AF37]/5 border border-[#D4AF37]/20 rounded-[32px] p-8 space-y-6">
                            <div>
                                <h4 className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.3em] mb-4">Core Strategy</h4>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['RANDOM', 'LEVEL', 'MBTI', 'WINNER', 'AGE'] as const).map(mode => (
                                        <button key={mode} onClick={() => setGenMode(mode)} className={`py-4 rounded-2xl border text-[10px] font-black transition-all ${genMode === mode ? 'bg-[#D4AF37] border-[#D4AF37] text-black shadow-xl' : 'bg-white/5 border-white/10 text-white/40'}`}>
                                            {mode === 'LEVEL' ? '실력(ABC)' : mode === 'WINNER' ? '입상자' : mode === 'AGE' ? '연령(OB/YB)' : mode}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center justify-between px-2">
                                    <h4 className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.3em]">Fixed Partnering</h4>
                                    <button onClick={() => setFixedTeamMode(!fixedTeamMode)} className={`px-3 py-1.5 rounded-full text-[9px] font-black transition-all border ${fixedTeamMode ? 'bg-[#D4AF37] text-black border-[#D4AF37]' : 'text-white/20 border-white/10'}`}>
                                        {fixedTeamMode ? 'TEAM MODE ON' : 'TEAM MODE OFF'}
                                    </button>
                                </div>
                                
                                <div className="space-y-2">
                                    {fixedPartners.map((pair, idx) => (
                                        <div key={idx} className="flex items-center justify-between bg-white/5 p-3 rounded-2xl border border-white/10">
                                            <div className="flex items-center gap-2 text-xs font-bold text-white/60">
                                                <span>{getPlayerName(pair[0])}</span>
                                                <span className="text-[#D4AF37]">♥</span>
                                                <span>{getPlayerName(pair[1])}</span>
                                            </div>
                                            <button onClick={() => setFixedPartners(prev => prev.filter((_, i) => i !== idx))} className="text-red-500/60 text-lg leading-none">×</button>
                                        </div>
                                    ))}
                                    <button 
                                        onClick={() => setPartnerSelectSource('NEW')} 
                                        className="w-full py-4 border border-dashed border-white/10 rounded-2xl text-[10px] font-black text-white/20 uppercase hover:bg-white/5 hover:text-white transition-all"
                                    >
                                        + Add Fixed Partner (Round {fixedTeamMode ? 'All' : '1'})
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h4 className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.3em]">Constraints</h4>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between bg-black/20 p-4 rounded-2xl border border-white/5">
                                        <span className="text-[10px] font-black text-white/40 uppercase">Total Courts</span>
                                        <div className="flex items-center gap-4">
                                            <button onClick={() => setTotalCourts(Math.max(1, totalCourts - 1))} className="text-white/20 font-black">-</button>
                                            <span className="text-sm font-black text-[#D4AF37] w-4 text-center">{totalCourts}</span>
                                            <button onClick={() => setTotalCourts(totalCourts + 1)} className="text-white/20 font-black">+</button>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between bg-black/20 p-4 rounded-2xl border border-white/5">
                                        <span className="text-[10px] font-black text-white/40 uppercase">Match Time (mins)</span>
                                        <div className="flex items-center gap-4">
                                            <button onClick={() => setMatchTime(Math.max(30, matchTime - 30))} className="text-white/20 font-black">-</button>
                                            <span className="text-sm font-black text-[#D4AF37] w-4 text-center">{matchTime}</span>
                                            <button onClick={() => setMatchTime(matchTime + 30)} className="text-white/20 font-black">+</button>
                                        </div>
                                    </div>
                                    <div className="h-px bg-white/5 my-2" />
                                    <div className="flex items-center justify-between bg-black/20 p-4 rounded-2xl border border-white/5">
                                        <span className="text-[10px] font-black text-[#4ADE80] uppercase">First Prize</span>
                                        <div className="flex items-center gap-4">
                                            <button onClick={() => setFirstPrize(Math.max(0, firstPrize - 5000))} className="text-white/20 font-black">-</button>
                                            <span className="text-sm font-black text-white w-12 text-center">{(firstPrize/1000).toFixed(0)}k</span>
                                            <button onClick={() => setFirstPrize(firstPrize + 5000)} className="text-white/20 font-black">+</button>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between bg-black/20 p-4 rounded-2xl border border-white/5">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-black text-[#D4AF37] uppercase">Tier 1 Fine</span>
                                            <span className="text-[7px] text-white/20 uppercase font-bold">Bottom 25~50%</span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <button onClick={() => setBottom25Late(Math.max(0, bottom25Late - 1000))} className="text-white/20 font-black">-</button>
                                            <span className="text-sm font-black text-white w-12 text-center">{(bottom25Late/1000).toFixed(0)}k</span>
                                            <button onClick={() => setBottom25Late(bottom25Late + 1000)} className="text-white/20 font-black">+</button>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between bg-black/20 p-4 rounded-2xl border border-white/5">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-black text-red-500 uppercase">Tier 2 Penalty</span>
                                            <span className="text-[7px] text-white/20 uppercase font-bold">Bottom 0~25%</span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <button onClick={() => setBottom25Penalty(Math.max(0, bottom25Penalty - 1000))} className="text-white/20 font-black">-</button>
                                            <span className="text-sm font-black text-white w-12 text-center">{(bottom25Penalty/1000).toFixed(0)}k</span>
                                            <button onClick={() => setBottom25Penalty(bottom25Penalty + 1000)} className="text-white/20 font-black">+</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="pt-6 border-t border-[#D4AF37]/10 space-y-4">
                                <h4 className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.3em] mb-2">Rules & Financials</h4>
                                <textarea value={matchRules} onChange={(e) => setMatchRules(e.target.value)} className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-[11px] font-bold text-white/60 min-h-[100px] outline-none" placeholder="Match Rules..." />
                            </div>

                            <button 
                                onClick={generateKDK}
                                disabled={isGenerating}
                                className={`w-full py-6 rounded-[32px] font-black uppercase text-xs tracking-[0.2em] transition-all shadow-2xl relative overflow-hidden group ${isGenerating ? 'bg-white/10 text-white/20' : 'bg-[#D4AF37] text-black hover:scale-[1.02] active:scale-95'}`}
                            >
                                {isGenerating ? 'GENERATE...' : '최종 대진 자동 생성! 🚀'}
                            </button>
                        </section>

                        {/* Partner Selection Overlay */}
                        {partnerSelectSource && (
                            <div className="fixed inset-0 bg-[#0A0A0F]/90 backdrop-blur-md z-[100] flex items-center justify-center p-6">
                                <div className="bg-[#1C1C28] border border-white/10 rounded-[40px] w-full max-w-md p-8 space-y-6 shadow-2xl">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-xs font-black text-[#D4AF37] uppercase tracking-[0.4em]">Select Pair</h3>
                                        <button onClick={() => setPartnerSelectSource(null)} className="text-white/20 text-2xl">×</button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                        {availablePlayersForPartnering.map(p => {
                                            const isSelected = partnerSelectSource !== 'NEW' && partnerSelectSource === p.id;
                                            return (
                                                <button 
                                                    key={p.id}
                                                    onClick={() => {
                                                        if (partnerSelectSource === 'NEW') {
                                                            setPartnerSelectSource(p.id);
                                                        } else {
                                                            setFixedPartners(prev => [...prev, [partnerSelectSource as string, p.id]]);
                                                            setPartnerSelectSource(null);
                                                        }
                                                    }}
                                                    className={`p-4 rounded-2xl border transition-all text-[11px] font-bold text-left ${isSelected ? 'bg-[#D4AF37] border-[#D4AF37] text-black' : 'bg-white/5 border-white/5 text-white/60 hover:border-white/20'}`}
                                                >
                                                    {p.nickname}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <p className="text-[9px] text-white/20 font-medium text-center uppercase tracking-widest">
                                        {partnerSelectSource === 'NEW' ? 'Select first player' : 'Select partner for ' + getPlayerName(partnerSelectSource)}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-[#0A0A0F] via-[#0A0A0F]/95 to-transparent z-40 flex flex-col items-center gap-4 text-center">
                    <button onClick={() => setStep(1)} className="text-[10px] font-black text-white/20 uppercase tracking-[0.5em] hover:text-[#D4AF37]">Back to Attendance</button>
                </div>

                {showWarning && (
                    <WarningModal 
                        message={warningMsg} 
                        onClose={() => setShowWarning(false)} 
                    />
                )}
            </main>
        );
    }

    // --- Step 3: Live Dashboard ---
    const activeMatchForScore = showScoreModal ? matches.find(m => m.id === showScoreModal) : null;

    return (
        <main className="flex flex-col min-h-screen bg-[#000000] text-white font-sans max-w-lg mx-auto pb-40 relative">
            <header className="p-6 pt-[calc(1.5rem+var(--safe-top))] flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                    <Link href="/" className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-transform mr-1">
                        <span className="text-xl">←</span>
                    </Link>
                    <img src="/logo.png" className="w-10 h-auto" alt="TEYEON Logo" />
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-[#D4AF37] tracking-[0.4em] uppercase mb-1">Live Tournament</span>
                        <div className="flex items-center gap-1 opacity-20">
                            <div className="w-1 h-1 rounded-full bg-[#D4AF37] animate-pulse" />
                            <span className="text-[8px] font-bold uppercase tracking-widest">Active Session</span>
                        </div>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={copyMatchTable} className="w-10 h-10 bg-[#D4AF37]/10 border border-[#D4AF37]/20 rounded-full flex items-center justify-center text-[#D4AF37] text-sm active:scale-90 transition-all" title="대진표 공유">📋</button>
                    <button onClick={copyFinalResults} className="w-10 h-10 bg-[#D4AF37]/10 border border-[#D4AF37]/20 rounded-full flex items-center justify-center text-[#D4AF37] text-sm active:scale-90 transition-all" title="결과 보고">🏆</button>
                    <button onClick={resetSession} className="w-10 h-10 bg-white/5 border border-white/10 rounded-full flex items-center justify-center text-white/40 text-sm active:scale-90 transition-all">×</button>
                </div>
            </header>

            <div className="px-6 mb-8">
                <div className="bg-gradient-to-br from-[#1E1E2E] to-[#14141F] border border-[#D4AF37]/30 rounded-[32px] p-6 shadow-2xl space-y-4 relative overflow-hidden">
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <span className="text-[8px] font-black text-[#D4AF37] uppercase tracking-[0.4em]">Tournament Info</span>
                            <span className="text-white/20 text-[10px]">✏️</span>
                        </div>
                        <input 
                            value={sessionTitle} 
                            onChange={(e) => setSessionTitle(e.target.value)}
                            className="w-full bg-transparent text-xl font-black italic text-white tracking-tighter outline-none border-b border-transparent focus:border-[#D4AF37]/20 transition-all"
                            placeholder="Session Title"
                        />
                    </div>
                    <div className="h-px bg-white/5" />
                    <div className="grid grid-cols-[1.5fr_1fr] gap-4">
                        <div className="space-y-1 overflow-hidden">
                            <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Match Rules</span>
                            <input 
                                value={matchRules} 
                                onChange={(e) => setMatchRules(e.target.value)}
                                className="w-full bg-black/20 border border-white/5 rounded-xl px-3 h-10 text-[9px] font-bold text-white/60 outline-none focus:border-[#D4AF37]/20 truncate"
                                placeholder="Rules..."
                            />
                        </div>
                        <div className="space-y-1">
                            <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Prizes & Penalties</span>
                            <div className="bg-black/20 border border-white/5 rounded-xl p-3 space-y-1">
                                <p className="text-[9px] font-bold text-[#D4AF37]">🥇 {firstPrize.toLocaleString()}원</p>
                                <p className="text-[9px] font-bold text-red-400/80">📉 {bottom25Late.toLocaleString()}~{bottom25Penalty.toLocaleString()}원</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 p-6 space-y-8 overflow-y-auto">
                {activeTab === 'MATCHES' ? (
                    <>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between px-2">
                                <h3 className="text-[10px] font-black text-white/30 tracking-[0.3em] uppercase">Now Playing</h3>
                                {activeMatchIds.length > 0 && <span className="text-[8px] font-black text-[#D4AF37] bg-[#D4AF37]/10 px-2 py-0.5 rounded border border-[#D4AF37]/20">{activeMatchIds.length} ACTIVE</span>}
                            </div>
                            {activeMatchIds.length === 0 ? (
                                <div className="py-20 text-center opacity-20 text-[10px] uppercase font-black tracking-widest border border-dashed border-white/5 rounded-[32px]">Waiting for next round...</div>
                            ) : (
                                <div className="grid grid-cols-2 gap-3">
                                    {activeMatchIds.map((mId) => {
                                        const m = matches.find(x => x.id === mId);
                                        if (!m) return null;
                                        const p0 = m.playerIds[0];
                                        const p0Group = attendeeConfigs[p0]?.group || allMembers.find(x => x.id === p0)?.position || 'A';
                                        const isGroupB = (p0Group || 'A').toUpperCase().includes('B');

                                        return (
                                            <div key={mId} className="group relative bg-[#1E1E2E] border border-white/10 rounded-[32px] p-4 shadow-xl active:scale-95 transition-all flex flex-col justify-between min-h-[140px]">
                                                <div className="absolute top-3 left-3 px-2 py-0.5 rounded bg-white/5 border border-white/10">
                                                    <span className={`text-[8px] font-black italic ${isGroupB ? 'text-blue-400' : 'text-[#D4AF37]'}`}>{isGroupB ? 'B' : 'A'}조</span>
                                                </div>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); updateMatchCourt(mId); }}
                                                    className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-[10px] font-black italic text-[#D4AF37] border border-white/10"
                                                >
                                                    #{m.court}
                                                </button>
                                                <div onClick={() => { setTempScores({ s1: m.score1 ?? 1, s2: m.score2 ?? 1 }); setShowScoreModal(mId); }} className="space-y-3">
                                                    <div className="flex justify-between items-start px-1 pt-4">
                                                        <div className="flex flex-col gap-0.5 max-w-[45%]">
                                                            <p className="text-[11px] font-black text-white/80 truncate">{getPlayerName(m.playerIds[0])}</p>
                                                            <p className="text-[11px] font-black text-white/80 truncate">{getPlayerName(m.playerIds[1])}</p>
                                                        </div>
                                                        <span className="text-[8px] font-black text-[#D4AF37]/40 italic pt-1 text-center flex-1">VS</span>
                                                        <div className="flex flex-col gap-0.5 max-w-[45%] text-right">
                                                            <p className="text-[11px] font-black text-white/80 truncate">{getPlayerName(m.playerIds[2])}</p>
                                                            <p className="text-[11px] font-black text-white/80 truncate">{getPlayerName(m.playerIds[3])}</p>
                                                        </div>
                                                    </div>
                                                    <div className="w-full py-2 bg-white/[0.03] rounded-xl text-center">
                                                        <span className="text-[8px] font-black text-white/20 uppercase tracking-widest group-hover:text-[#D4AF37] transition-colors">Score Input</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="space-y-8">
                            {(() => {
                                const waitingMatches = matches.filter(m => m.status === 'waiting');
                                if (waitingMatches.length === 0) return (
                                    <div className="py-10 text-center opacity-10 text-[10px] uppercase font-black tracking-widest border border-dashed border-white/5 rounded-[32px]">No Matches in Queue</div>
                                );

                                return [ 'A', 'B' ].map(group => {
                                    const groupMatches = waitingMatches.filter(m => {
                                        const p0 = m.playerIds[0];
                                        const p0Group = attendeeConfigs[p0]?.group || allMembers.find(x => x.id === p0)?.position || 'A';
                                        
                                        const normalizedGroup = (p0Group || 'A').toUpperCase().includes('B') ? 'B' : 'A';
                                        return normalizedGroup === group;
                                    });

                                    if (groupMatches.length === 0) return null;

                                    return (
                                        <div key={group} className="space-y-4">
                                            <h3 className="text-[10px] font-black text-[#D4AF37] tracking-[0.3em] uppercase px-2 flex items-center gap-2">
                                                <span className={`w-4 h-4 rounded flex items-center justify-center text-[8px] text-black font-black ${group === 'A' ? 'bg-[#D4AF37]' : 'bg-blue-500'}`}>{group}</span>
                                                {group}조 대기 경기
                                            </h3>
                                            <div className="grid grid-cols-1 gap-2">
                                                {groupMatches.map(m => {
                                                    const busyPlayers = m.playerIds.filter(pid => busyPlayerIds.has(pid));
                                                    const hasConflict = busyPlayers.length > 0;
                                                    return (
                                                        <div key={m.id} className={`bg-white/[0.03] border border-white/5 p-5 rounded-[24px] flex items-center justify-between transition-all ${hasConflict ? 'opacity-30' : ''}`}>
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[8px] font-bold text-white/20 uppercase">Round {m.round}</span>
                                                                    {hasConflict && (
                                                                        <span className="text-[7px] font-black text-red-500/60 uppercase tracking-tighter">
                                                                            Conflict: {busyPlayers.map(pid => getPlayerName(pid)).join(', ')}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <span className={`text-xs font-bold transition-colors ${hasConflict ? 'text-white/20' : 'text-white/60'}`}>
                                                                    {getPlayerName(m.playerIds[0])}/{getPlayerName(m.playerIds[1])} vs {getPlayerName(m.playerIds[2])}/{getPlayerName(m.playerIds[3])}
                                                                </span>
                                                            </div>
                                                            <button 
                                                                disabled={hasConflict}
                                                                onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); startMatch(m.id); }} 
                                                                className={`text-[10px] font-black uppercase px-3 py-1 rounded-lg ${hasConflict ? 'bg-white/5 text-white/5 cursor-not-allowed' : 'bg-[#D4AF37] text-black active:scale-95'}`}
                                                            >
                                                                {hasConflict ? 'BUSY' : '투입 🚀'}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>

                        {matches.some(m => m.status === 'complete') && (
                            <div className="space-y-4 pt-8">
                                <h3 className="text-[10px] font-black text-[#D4AF37]/40 tracking-[0.3em] uppercase px-2">Completed Matches</h3>
                                <div className="grid grid-cols-1 gap-3">
                                    {matches.filter(m => m.status === 'complete').reverse().map(m => (
                                        <div key={m.id} onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); setShowScoreModal(m.id); }} className="bg-white/[0.02] border border-white/5 p-6 rounded-[32px] flex flex-col items-center gap-3 backdrop-blur-sm grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all group">
                                            <div className="flex items-center gap-4 w-full justify-center">
                                                <span className="text-[10px] font-bold text-white/40 truncate flex-1 text-right">{getPlayerName(m.playerIds[0])} / {getPlayerName(m.playerIds[1])}</span>
                                                <div className="flex flex-col items-center px-4">
                                                    <span className="text-xl font-black text-[#4ADE80] drop-shadow-[0_0_10px_rgba(74,222,128,0.4)]">{m.score1} : {m.score2}</span>
                                                </div>
                                                <span className="text-[10px] font-bold text-white/40 truncate flex-1 text-left">{getPlayerName(m.playerIds[2])} / {getPlayerName(m.playerIds[3])}</span>
                                            </div>
                                            <span className="text-[8px] font-black text-white/10 uppercase tracking-widest group-hover:text-[#D4AF37]/40">Tap to edit result</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="pb-40">
                        <RankingView 
                            sessionMatches={matches} 
                            configs={attendeeConfigs} 
                            allPlayers={allPlayersInRanking}
                            prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty, account: accountInfo }} 
                            copyMatchTable={copyMatchTable}
                            copyFinalResults={copyFinalResults}
                        />
                    </div>
                )}
            </div>

            <nav className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black via-black/95 to-transparent z-50">
                <div className="max-w-xs mx-auto bg-white/5 border border-white/10 backdrop-blur-2xl rounded-full p-1.5 flex shadow-2xl">
                    {(['MATCHES', 'RANKING'] as const).map(t => (
                        <button key={t} onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); setActiveTab(t); }} className={`flex-1 py-3 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === t ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-white/40 hover:text-white'}`}>{t === 'MATCHES' ? '🔥 Matches' : '📊 Ranking'}</button>
                    ))}
                </div>
            </nav>

            {showRankingModal && (
                <div className="fixed inset-0 z-[100] flex flex-col bg-black/98 backdrop-blur-2xl">
                    <header className="p-6 border-b border-white/5 flex items-center justify-between bg-[#14141F]">
                        <h2 className="text-xl font-black italic tracking-tighter text-white">LIVE LEADERBOARD</h2>
                        <button onClick={() => setShowRankingModal(false)} className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-xl text-white">×</button>
                    </header>
                    <div className="flex-1 overflow-y-auto p-4">
                        <RankingView 
                            sessionMatches={matches} 
                            configs={attendeeConfigs} 
                            allPlayers={allPlayersInRanking}
                            prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty, account: accountInfo }} 
                            copyMatchTable={copyMatchTable}
                            copyFinalResults={copyFinalResults}
                        />
                    </div>
                </div>
            )}

            {activeMatchForScore && (
                <div className="fixed inset-0 z-[200] flex items-end justify-center">
                    <div className="absolute inset-0 bg-black/95 backdrop-blur-xl" onClick={() => setShowScoreModal(null)}></div>
                    <div className="relative w-full max-w-lg bg-[#14141F] border-t border-white/10 rounded-t-[40px] p-8 pb-10 shadow-2xl animate-in slide-in-from-bottom duration-300">
                        <header className="flex flex-col items-center gap-2 mb-8 text-center px-4">
                            <span className="text-[10px] font-black text-[#D4AF37] tracking-[0.3em] uppercase">Set Final Result</span>
                            <div className="mt-2 py-2 px-6 bg-[#D4AF37]/10 rounded-2xl border border-[#D4AF37]/20">
                                <h3 className="text-xl font-black italic text-white tracking-tight">🏆 WINNER SELECTION</h3>
                            </div>
                        </header>
                        <div className="grid grid-cols-2 gap-8 mb-10">
                            {[0, 1].map(side => (
                                <div key={side} className="flex flex-col gap-4">
                                    <span className="text-[10px] font-black text-white/40 uppercase tracking-widest text-center truncate">{getPlayerName(activeMatchForScore.playerIds[side*2])} & {getPlayerName(activeMatchForScore.playerIds[side*2+1])}</span>
                                    <div className="text-5xl font-black text-[#D4AF37] text-center mb-2">{side === 0 ? tempScores.s1 : tempScores.s2}</div>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[0,1,2,3,4,5,6].map(n => (
                                            <button 
                                                key={n} 
                                                onClick={() => {
                                                    if (window.navigator?.vibrate) window.navigator.vibrate(50); // 탁!
                                                    setTempScores(p => side === 0 ? ({ ...p, s1: n }) : ({ ...p, s2: n }));
                                                }} 
                                                className={`h-12 rounded-xl text-lg font-black transition-all ${ (side === 0 ? tempScores.s1 : tempScores.s2) === n ? 'bg-[#D4AF37] text-black scale-105' : 'bg-white/5 text-white/30'}`}
                                            >
                                                {n}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-4">
                            <button onClick={() => setShowScoreModal(null)} className="flex-1 py-5 bg-white/5 border border-white/10 text-white font-black rounded-[28px] uppercase text-xs tracking-widest">Cancel</button>
                            <button disabled={tempScores.s1 === tempScores.s2} onClick={() => finishMatch(activeMatchForScore.id, tempScores.s1, tempScores.s2)} className="flex-[2] py-5 bg-[#D4AF37] text-black font-black rounded-[28px] uppercase text-xs tracking-widest shadow-xl disabled:opacity-20 font-black">Confirm Score 🏆</button>
                        </div>
                    </div>
                </div>
            )}
            {showResetConfirm && (
                <CustomConfirmModal 
                    title="초기화 확인" 
                    message="모든 데이터를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다." 
                    onConfirm={confirmReset} 
                    onCancel={() => setShowResetConfirm(false)} 
                />
            )}
            {showWarning && (
                <WarningModal 
                    message={warningMsg} 
                    onClose={() => setShowWarning(false)} 
                />
            )}
        </main>
    );
}

function ManualRecoveryButton({ onRestore }: { onRestore: (data: any) => void }) {
    const [hasSession, setHasSession] = useState(false);
    useEffect(() => {
        const saved = localStorage.getItem('kdk_live_session');
        if (saved) setHasSession(true);
    }, []);

    if (!hasSession) return null;

    return (
        <button 
            onClick={() => {
                const saved = localStorage.getItem('kdk_live_session');
                if (saved) {
                    try {
                        const data = JSON.parse(saved);
                        onRestore(data);
                    } catch (e) { console.error(e); }
                }
            }} 
            className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-[9px] font-black text-white/40 uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all active:scale-95 group whitespace-nowrap"
        >
            <span className="text-[12px] group-hover:scale-110 transition-transform grayscale group-hover:grayscale-0">📂</span>
            <span>이전 데이터 불러오기</span>
        </button>
    );
}

function GuestDataModal({ guests, configs, onSave, onClose }: { guests: any[], configs: Record<string, AttendeeConfig>, onSave: (id: string, age: number, isWinner: boolean) => void, onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={onClose}></div>
            <div className="relative w-full max-w-md bg-[#1C1C28] border border-white/10 rounded-[40px] p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto custom-scrollbar animate-in slide-in-from-bottom-8">
                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-[#D4AF37] tracking-[0.4em] uppercase mb-1">Guest Registry</span>
                        <h3 className="text-xl font-black italic text-white tracking-tighter uppercase">게스트 상세 정보</h3>
                    </div>
                    <button onClick={onClose} className="text-white/20 text-3xl">×</button>
                </div>
                
                <div className="space-y-4">
                    {guests.map(g => {
                        const conf = configs[g.id] || {};
                        return (
                            <div key={g.id} className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-black text-white">{g.name}</span>
                                    <span className="text-[8px] font-black text-[#D4AF37] uppercase tracking-[0.2em] bg-[#D4AF37]/10 px-2 py-1 rounded">Guest</span>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[9px] font-black text-white/30 uppercase tracking-widest">Age (나이)</label>
                                        <input 
                                            type="number" 
                                            placeholder="나이"
                                            value={conf.age || ''}
                                            onChange={(e) => onSave(g.id, parseInt(e.target.value) || 0, !!conf.isWinner)}
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs font-bold text-white outline-none focus:border-[#D4AF37]/50"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[9px] font-black text-white/30 uppercase tracking-widest">Winner? (입상여부)</label>
                                        <button 
                                            onClick={() => onSave(g.id, conf.age || 0, !conf.isWinner)}
                                            className={`w-full py-3 rounded-xl border font-black text-[10px] tracking-widest transition-all ${conf.isWinner ? 'bg-[#D4AF37] border-[#D4AF37] text-black shadow-lg shadow-[#D4AF37]/20' : 'bg-white/5 border-white/10 text-white/20'}`}
                                        >
                                            {conf.isWinner ? '🏆 YES (OB)' : 'NO (YB)'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="pt-4">
                    <button 
                        onClick={onClose}
                        className="w-full py-5 bg-gradient-to-r from-[#D4AF37] to-[#B8860B] text-black font-black rounded-2xl shadow-2xl active:scale-95 transition-all text-xs uppercase tracking-[0.2em]"
                    >
                        Save & Continue ➡️
                    </button>
                </div>
            </div>
        </div>
    );
}

function CustomConfirmModal({ title, message, onConfirm, onCancel }: { title: string, message: string, onConfirm: () => void, onCancel: () => void }) {
    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onCancel}></div>
            <div className="relative w-full max-w-sm bg-[#1C1C28] border border-white/10 rounded-[32px] p-8 shadow-2xl animate-in zoom-in-95 duration-200">
                <h3 className="text-lg font-black italic text-white mb-2 uppercase tracking-tighter">{title}</h3>
                <p className="text-xs font-bold text-white/40 mb-8 leading-relaxed">{message}</p>
                <div className="flex gap-3">
                    <button onClick={onCancel} className="flex-1 py-4 bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl">Cancel</button>
                    <button onClick={onConfirm} className="flex-1 py-4 bg-red-500 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl shadow-lg shadow-red-500/20">Confirm</button>
                </div>
            </div>
        </div>
    );
}


function ArchiveSection({ onLoad }: { onLoad: (session: any) => void }) {
    const [archives, setArchives] = useState<any[]>([]);
    useEffect(() => {
        supabase.from('matches_archive').select('*').order('created_at', { ascending: false }).limit(5)
            .then(({ data }) => { if (data) setArchives(data); });
    }, []);
    
    const handleLoad = (raw: any) => {
        const session = {
            id: raw.id,
            title: raw.title,
            ...(raw.data || {})
        };
        onLoad(session);
    };

    if (archives.length === 0) return null;
    return (
        <section className="space-y-4">
            <h3 className="text-[10px] font-black text-white/30 tracking-[0.3em] uppercase px-2 flex items-center gap-2">📦 Load History</h3>
            <div className="space-y-2">
                {archives.map(a => (
                    <button key={a.id} onClick={() => handleLoad(a)} className="w-full bg-white/[0.03] border border-white/5 p-4 rounded-[20px] flex items-center justify-between group hover:border-[#D4AF37]/30 transition-all text-left">
                        <div className="flex flex-col"><span className="text-xs font-black text-white/60">{a.note?.startsWith('{') ? JSON.parse(a.note).title : a.note}</span><span className="text-[8px] font-bold text-white/20 uppercase">{new Date(a.created_at).toLocaleDateString()}</span></div>
                        <span className="text-[10px] font-black text-[#D4AF37]">OPEN →</span>
                    </button>
                ))}
            </div>
        </section>
    );
}

function RankingView({ sessionMatches, configs, prizes, allPlayers: players, copyMatchTable, copyFinalResults }: any) {
    const [sortKey, setSortKey] = useState<string>('rk');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    const toggleSort = (key: string) => {
        if (sortKey === key) {
            setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir(key === 'age' ? 'asc' : 'desc'); // Default to youngest first for age, desc for others
        }
    };

    const calculateSettlement = (p: any, idx: number, total: number) => {
        let amount = 0;
        let note = "";
        
        const isWinner = idx === 0 && !p.is_guest;

        // Bottom 50% split logic:
        // Total players = T
        // Bottom group size B = ceil(T/2)
        // Penalty group P (Tier 2) = ceil(B/2)
        // Fine group F (Tier 1) = B - P
        const bottomHalfCount = Math.ceil(total / 2);
        const penaltyCount = Math.ceil(bottomHalfCount / 2);
        const fineCount = bottomHalfCount - penaltyCount;

        const isPenaltyTier = idx >= (total - penaltyCount); // Very bottom
        const isFineTier = !isPenaltyTier && idx >= (total - bottomHalfCount); // Next bottom
        
        let performancePenalty = 0;
        if (isWinner) {
            performancePenalty = prizes.first || 10000;
            note = `👑 우승 상물 (+${(performancePenalty/1000).toFixed(0)}k)`;
        } else if (isPenaltyTier) {
            performancePenalty = -(prizes.l2 || 5000);
            note = `📉 패널티 (-${(Math.abs(performancePenalty)/1000).toFixed(0)}k)`;
        } else if (isFineTier) {
            performancePenalty = -(prizes.l1 || 3000);
            note = `📉 하위권 벌금 (-${(Math.abs(performancePenalty)/1000).toFixed(0)}k)`;
        }

        if (p.is_guest) {
            amount = -5000 + performancePenalty;
            note = performancePenalty !== 0 
                ? `❗ 게스트(-5k) + ${note.split(' ')[1]}`
                : "❗ 게스트 (-5,000)";
        } else {
            amount = performancePenalty;
        }
        
        return { amount, note, isWinner, isPenaltyTier, isFineTier };
    };

    const generatePlayerList = (filterGroup?: string) => {
        return players
            .filter((p: any) => !filterGroup || p.group === filterGroup);
    };

    const getSortedPlayers = (pList: any[]) => {
        const sorted = [...pList].map((p, i) => ({ ...p, rk: i + 1 }));
        return sorted.sort((a, b) => {
            let valA = a[sortKey];
            let valB = b[sortKey];

            if (sortKey === 'rk') {
                valA = a.rk;
                valB = b.rk;
            }

            if (valA < valB) return sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    };

    const hasGroups = Object.values(configs).some((c: any) => c.group === 'B');

    const getPlayerName = (id: string) => {
        const p = players.find((x: any) => x.id === id);
        return p?.name || "Unknown";
    };

    const RankingTable = ({ players, title }: { players: any[], title: string }) => (
        <section className="space-y-4 mb-8">
            <h3 className="text-[10px] font-black text-[#D4AF37] tracking-[0.3em] uppercase px-2 flex items-center justify-between">
                <span>{title}</span>
                <span className="text-white/20">{players.length} Players</span>
            </h3>
            <div className="bg-white/[0.03] border border-white/5 rounded-[32px] overflow-hidden overflow-x-auto">
                <table className="min-w-[600px] w-full text-[10px] border-collapse">
                    <thead>
                        <tr className="bg-white/5 text-white/40 font-black uppercase tracking-tighter text-[11px]">
                            <th onClick={() => toggleSort('rk')} className="py-5 px-4 text-center w-10 cursor-pointer hover:text-white transition-colors">Rk {sortKey === 'rk' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th onClick={() => toggleSort('name')} className="py-5 px-2 text-left cursor-pointer hover:text-white transition-colors">Player {sortKey === 'name' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th className="py-5 px-1 text-center">Fine</th>
                            <th onClick={() => toggleSort('diff')} className="py-5 px-1 text-center cursor-pointer hover:text-white transition-colors">Diff {sortKey === 'diff' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th onClick={() => toggleSort('age')} className="py-5 px-1 text-center cursor-pointer hover:text-[#D4AF37] transition-colors text-[#D4AF37]/60">Age {sortKey === 'age' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th onClick={() => toggleSort('wins')} className="py-5 px-1 text-center cursor-pointer hover:text-white transition-colors">W {sortKey === 'wins' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th onClick={() => toggleSort('losses')} className="py-5 px-1 text-center cursor-pointer hover:text-white transition-colors">L {sortKey === 'losses' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th className="py-5 px-1 text-center">Gm</th>
                            <th className="py-5 px-4 text-right">Note</th>
                        </tr>
                    </thead>
                    <tbody className="text-[13px]">
                        {getSortedPlayers(players).map((p) => {
                            const originalIdx = players.findIndex((x: any) => x.id === p.id);
                            const { amount, note, isWinner, isPenaltyTier, isFineTier } = calculateSettlement(p, originalIdx, players.length);
                            const isBottom = isPenaltyTier || isFineTier;
                            return (
                                <tr key={p.id} className={`border-t border-white/5 last:border-0 hover:bg-white/[0.04] transition-all ${isWinner ? 'bg-[#D4AF37]/5' : isBottom ? 'bg-red-500/[0.02]' : ''}`}>
                                    <td className={`py-5 px-4 text-center font-black italic ${isWinner ? 'text-[#D4AF37] text-lg' : isBottom ? 'text-red-500/40' : 'text-white/20'}`}>
                                        {isWinner ? '👑' : players.findIndex((x: any) => x.id === p.id) + 1}
                                    </td>
                                    <td className="py-5 px-2">
                                        <div className="flex flex-col">
                                            <span className={`font-bold ${isWinner ? 'text-[#D4AF37] text-base' : 'text-white'}`}>{p.name} {p.is_guest ? '(G)' : ''}</span>
                                            {isWinner && <span className="text-[9px] font-black text-[#D4AF37]/60 uppercase tracking-widest">Tournament MVP</span>}
                                        </div>
                                    </td>
                                    <td className={`py-5 px-1 text-center font-black text-xs ${amount > 0 ? 'text-[#4ADE80]' : amount < 0 ? 'text-red-500' : 'text-white/20'}`}>
                                        {amount !== 0 ? `${amount > 0 ? '+' : ''}${amount.toLocaleString()}` : '-'}
                                    </td>
                                    <td className={`py-5 px-1 text-center font-black ${p.diff > 0 ? 'text-white' : 'text-white/40'}`}>
                                        {p.diff > 0 ? `+${p.diff}` : p.diff}
                                    </td>
                                    <td className="py-5 px-1 text-center font-bold text-white/40">{p.age || '-'}</td>
                                    <td className="py-5 px-1 text-center font-bold text-[#4ADE80]">{p.wins}</td>
                                    <td className="py-5 px-1 text-center font-bold text-red-500/60">{p.losses}</td>
                                    <td className="py-5 px-1 text-center font-bold text-white/20">{p.games}</td>
                                    <td className="py-5 px-4 text-right font-black text-[10px] whitespace-nowrap">
                                        <span className={`px-2 py-1 rounded-lg ${amount > 0 ? 'bg-[#D4AF37]/10 text-[#D4AF37]' : amount < 0 ? 'bg-red-500/10 text-red-500' : 'text-white/20'}`}>
                                            {note || '-'}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );

    const exportToMemberStats = async () => {
        if (!confirm("전체 경기를 종료하고 멤버별 통계 DB로 데이터를 전송하시겠습니까?")) return;
        
        try {
            if (window.navigator?.vibrate) window.navigator.vibrate([200, 100, 200]);
            
            const statsToInsert = players.map((p: any) => ({
                member_name: p.name,
                wins: p.wins,
                losses: p.losses,
                score_diff: p.diff,
                total_games: p.games,
                tournament_date: new Date().toISOString(),
                is_guest: p.is_guest
            }));

            const { error } = await supabase.from('member_stats').insert(statsToInsert);
            if (error) throw error;
            
            alert("✅ 테연 데이터베이스로 성공적으로 저장되었습니다!");
        } catch (e: any) {
            console.error(e);
            alert("저장 실패: " + e.message);
        }
    };

    return (
        <div className="space-y-6 pb-40">
            <RankingTable players={players} title="🏆 실시간 통합 랭킹" />
            
            {hasGroups && (
                <>
                    <div className="h-px bg-white/5 mx-6 my-10" />
                    <RankingTable players={generatePlayerList('A')} title="🅰️ A조 순위" />
                    <RankingTable players={generatePlayerList('B')} title="🅱️ B조 순위" />
                </>
            )}

            <div className="flex items-center gap-2">
                <button 
                    onClick={copyMatchTable}
                    className="flex-1 py-4 bg-white/5 border border-white/10 text-white/60 text-[11px] font-black uppercase tracking-widest rounded-3xl hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                >
                    <span>📋 대진표 공유</span>
                </button>
                <button 
                    onClick={copyFinalResults}
                    className="flex-1 py-4 bg-[#D4AF37] text-black text-[11px] font-black uppercase tracking-widest rounded-3xl hover:scale-[1.02] active:scale-95 transition-all shadow-lg flex items-center justify-center gap-2"
                >
                    <span>🏆 최종결과 공유</span>
                </button>
            </div>

            <div className="bg-[#1E1E2E] border border-[#D4AF37]/20 rounded-[32px] p-8 space-y-6 shadow-2xl relative overflow-hidden">
               <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                   <svg width="100" height="100" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
               </div>
               <div className="text-center space-y-2">
                   <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.4em] block">Data Finalization</span>
                   <h4 className="text-xl font-black italic text-white tracking-tighter">TOURNAMENT STATS SYNC</h4>
               </div>
               <button 
                  onClick={exportToMemberStats}
                  className="w-full py-5 bg-[#D4AF37] text-black text-[13px] font-black rounded-2xl shadow-xl hover:scale-[1.02] active:scale-95 transition-all"
               >
                  테연 데이터로 저장 🚀
               </button>
               <div className="flex items-center justify-between px-2 pt-2 text-[10px] font-bold text-white/20 uppercase">
                   <span>Stats Archive</span>
                   <span>member_stats table</span>
               </div>
            </div>
        </div>
    );
}

function WarningModal({ message, onClose }: { message: string, onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="w-full max-w-xs bg-[#1E1E2E] border border-white/10 rounded-[40px] p-8 shadow-2xl flex flex-col items-center text-center space-y-6 animate-in zoom-in-95 duration-300">
                <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                </div>
                <div className="space-y-2">
                    <h3 className="text-xl font-black text-white italic tracking-tighter uppercase underline decoration-[#D4AF37]/30 underline-offset-4">Warning</h3>
                    <p className="text-sm font-bold text-white/60 leading-relaxed whitespace-pre-wrap">{message}</p>
                </div>
                <button 
                    onClick={onClose}
                    className="w-full py-4 bg-[#D4AF37] text-black font-black rounded-[20px] shadow-xl active:scale-95 transition-all text-sm uppercase tracking-widest"
                >
                    확인했습니다
                </button>
            </div>
        </div>
    );
}
