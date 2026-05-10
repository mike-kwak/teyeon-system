'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { generateKdkMatches, Player as KdkPlayer, Match as KdkMatch } from '@/lib/kdk';
import { RotateCw, CheckCircle2 } from 'lucide-react';
import PremiumSpinner from '@/components/PremiumSpinner';
import { DataStateView } from '@/components/DataStateView';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
import RankingTab from '@/components/RankingTab';
import { useRanking } from '@/hooks/useRanking';
import { Member, Match, AttendeeConfig, KDKConcept, UserRole } from '@/lib/tournament_types';
import MemberSelector from '@/components/tournament/MemberSelector';
import { WarningModal, CustomConfirmModal } from '@/components/tournament/Modals';
import { PlayingMatchCard, WaitingMatchCard, CompletedMatchCard } from '@/components/tournament/LiveCourtCards';
import { ScoreEntryModal } from '@/components/tournament/ScoreEntryModal';

export default function KDKPage() {
    const router = useRouter();
    const { role, hasPermission, getRestrictionMessage } = useAuth();
    const [showToast, setShowToast] = useState(false);
    const [toastMsg, setToastMsg] = useState("결과가 안전하게 기록되었습니다");

    // [v12.0] 개방형 권한 시스템: Admin 여부 판별 (ADMIN 포함)
    const isAdmin = role === 'CEO' || role === 'ADMIN';
    const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";

    // 권한 제한 알림 헬퍼
    const triggerAccessDenied = (msg: string = "관리자만 대진을 생성/수정할 수 있습니다.") => {
        setToastMsg(msg);
        setShowToast(true);
        if (window.navigator?.vibrate) window.navigator.vibrate([100, 50, 100]);
        setTimeout(() => setShowToast(false), 3000);
    };

    useEffect(() => {
        // Force unregister stale service workers
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(registrations => {
                for(let registration of registrations) {
                    registration.unregister();
                }
            });
        }
        console.clear();
        console.log("🏁 TEYEON SYSTEM v5.1 STABLE: ALL SYSTEMS GO");
    }, []);

    // [v12.0] REDIRECT REMOVED: Guests can now view the portal
    /* 
    useEffect(() => {
        if (role === 'GUEST') {
            alert("정회원 이상만 이용 가능한 메뉴입니다. 대시보드로 이동합니다.");
            router.push('/');
        }
    }, [role, router]);
    */

    const [step, setStep] = useState(0);
    const [generationMode, setGenerationMode] = useState<'AUTO' | 'MANUAL' | null>(null);
    const [manualInputMode, setManualInputMode] = useState<'PASTE' | 'DIRECT' | 'OCR' | null>(null);
    const [manualStep, setManualStep] = useState<'INPUT' | 'MATCH_NAMES' | 'RULES'>('INPUT');
    const [kdkEntryMode, setKdkEntryMode] = useState<'CHECKING' | 'CHOOSE' | 'CREATE' | 'LIVE'>('CHECKING');
    const [hasRestoredSession, setHasRestoredSession] = useState(false);
    const kdkEntryModeRef = useRef<'CHECKING' | 'CHOOSE' | 'CREATE' | 'LIVE'>('CHECKING');
    const hasInitializedKdkRef = useRef(false);
    const updateKdkEntryMode = (mode: 'CHECKING' | 'CHOOSE' | 'CREATE' | 'LIVE') => {
        kdkEntryModeRef.current = mode;
        setKdkEntryMode(mode);
    };
    const [syncTick, setSyncTick] = useState(0);
    const [adminModeManual, setAdminModeManual] = useState(true); // [v35.11] Admin UI Visibility Toggle

    // [v25.0] React Stale Closure Resolution for Realtime Sync
    useEffect(() => {
        if (syncTick > 0) syncActiveSession();
    }, [syncTick]);

    useEffect(() => {
        kdkEntryModeRef.current = kdkEntryMode;
    }, [kdkEntryMode]);

    const [allMembers, setAllMembers] = useState<Member[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [tempGuests, setTempGuests] = useState<Member[]>([]);
    const [showGuestInput, setShowGuestInput] = useState(false);
    const [newGuestName, setNewGuestName] = useState("");

    const [sessionId, setSessionId] = useState<string>(() => {
        const d = new Date();
        const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
        return `KDK-${dateStr}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    });
    const [sessionTitle, setSessionTitle] = useState(() => {
        const d = new Date();
        const yy = String(d.getFullYear()).slice(-2);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yy}${mm}${dd}_KDK_01`;
    });
    const [matches, setMatches] = useState<Match[]>([]);
    // [v18.0] Derived state: activeMatchIds is now reactive from matches.
    const activeMatchIds = useMemo(() => {
        return matches.filter(m => m.status === 'playing').map(m => m.id);
    }, [matches]);
    const [attendeeConfigs, setAttendeeConfigs] = useState<Record<string, AttendeeConfig>>({});

    const [genMode, setGenMode] = useState<KDKConcept>('RANDOM');
    const [totalCourts, setTotalCourts] = useState(99); // [v17.0] 무제한 코트 지원 (CEO 지시)
    const [totalCourtsInput, setTotalCourtsInput] = useState('99');
    const [matchTime, setMatchTime] = useState(30);
    const [fixedPartners, setFixedPartners] = useState<[string, string][]>([]);
    const [fixedTeamMode, setFixedTeamMode] = useState(false);
    const [partnerSelectSource, setPartnerSelectSource] = useState<string | null>(null);
    const [targetGames, setTargetGames] = useState(4);
    const [matchRules, setMatchRules] = useState("1:1 시작, 노에드, 타이 3:3 시작 7포인트 선승");

    const [manualPasteText, setManualPasteText] = useState("");
    const [manualNameOverrides, setManualNameOverrides] = useState<Record<string, string>>({});

    const [firstPrize, setFirstPrize] = useState(10000);
    const [bottom25Late, setBottom25Late] = useState(3000);
    const [bottom25Penalty, setBottom25Penalty] = useState(5000);

    useEffect(() => {
        setTotalCourtsInput(String(totalCourts));
    }, [totalCourts]);

    const [accountInfo, setAccountInfo] = useState("카카오뱅크 3333-01-5235337 (곽민섭)");
    const [currentTime, setCurrentTime] = useState("");
    const [showScoreModal, setShowScoreModal] = useState<string | null>(null);
    const [tempScores, setTempScores] = useState({ s1: 0, s2: 0 });
    const [showRankingModal, setShowRankingModal] = useState(false);
    const [userRole, setUserRole] = useState<UserRole>('GUEST');
    const [allActiveSessions, setAllActiveSessions] = useState<{ id: string, title: string, matchCount: number, playerCount: number, lastActivity: string }[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const activeSessionId = selectedSessionId || sessionId;
    const [showGateway, setShowGateway] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [activeTab, setActiveTab] = useState<'MATCHES' | 'RANKING'>('MATCHES');
    
    // [v32.2] Sync Integrity States
    const [syncStatus, setSyncStatus] = useState<'IDLE' | 'HEALTHY' | 'WARNING' | 'ERROR'>('IDLE');
    const [lastSyncTime, setLastSyncTime] = useState<string>("");
    const [isLegacySync, setIsLegacySync] = useState(false);
    const [syncErrorMsg, setSyncErrorMsg] = useState<string | null>(null);
    const [hasProfileError, setHasProfileError] = useState(false); // [v34.4] Prevent 400 spam
    const [hasArchiveError, setHasArchiveError] = useState(false); // [v34.5] Prevent 404 spam

    const [showWarning, setShowWarning] = useState(false);
    const [warningMsg, setWarningMsg] = useState("");

    const [showMemberEditModal, setShowMemberEditModal] = useState(false);
    const [showArchiveSuccess, setShowArchiveSuccess] = useState(false);
    const [showConfetti, setShowConfetti] = useState(false);
    const [celebrationMode, setCelebrationMode] = useState(false);
    const [isMembersLoading, setIsMembersLoading] = useState(true);
    const [isMembersError, setIsMembersError] = useState(false);
    const [showCeremony, setShowCeremony] = useState(false);
    const [spinningMatchId, setSpinningMatchId] = useState<string | null>(null);
    const [isCheckingTitle, setIsCheckingTitle] = useState(false);
    const [isStartingMatch, setIsStartingMatch] = useState(false);

    // [v16.0] Real-time participation tracker
    const busyPlayerIds = useMemo(() => {
        const playing = matches.filter(m => m.status === 'playing');
        const ids = new Set<string>();
        playing.forEach(m => {
            (m.playerIds || []).forEach(pid => ids.add(pid));
        });
        return ids;
    }, [matches]);

    // [v14.0] 제목 중복 방지: 자동으로 다음 번호(KDK_02 등)를 찾는 헬퍼
    const getDisplayUrl = () => {
        const targetSessionId = activeSessionId?.trim();
        if (!targetSessionId) return null;
        return `/kdk/display?session=${encodeURIComponent(targetSessionId)}`;
    };

    const openDisplayBoard = () => {
        const displayUrl = getDisplayUrl();
        if (!displayUrl) {
            alert("먼저 KDK 세션을 생성하거나 불러와 주세요.");
            return;
        }
        window.open(displayUrl, '_blank', 'noopener,noreferrer');
    };

    const copyDisplayBoardUrl = async () => {
        const displayUrl = getDisplayUrl();
        if (!displayUrl) {
            alert("먼저 KDK 세션을 생성하거나 불러와 주세요.");
            return;
        }

        const absoluteUrl = `${window.location.origin}${displayUrl}`;
        try {
            await navigator.clipboard.writeText(absoluteUrl);
            alert("전광판 주소가 복사되었습니다.");
        } catch {
            alert(`전광판 주소: ${absoluteUrl}`);
        }
    };

    const getPlayingPlayerIdsInMatch = (match: Match) => {
        return (match.playerIds || []).filter((playerId) => busyPlayerIds.has(playerId));
    };

    const findNextAvailableTitle = async () => {
        const d = new Date();
        const yy = String(d.getFullYear()).slice(-2);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const prefix = `${yy}${mm}${dd}_KDK_`;
        
        try {
            setIsCheckingTitle(true);
            // 1. 로컬 스토리지 확인
            const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
            const localTitles = failovers.map((f: any) => f.raw_data?.title || '');

            if (hasArchiveError) return;
            // 2. 서버 아카이브 확인 (최근 20개만) - 테이블이 없을 수 있으므로 안전하게 처리
            const { data: serverData, error: archiveError } = await supabase
                .from('teyeon_archive_v1')
                .select('raw_data')
                .limit(20);
            
            if (archiveError) {
                console.warn("Archive sync failed. Silencing further checks.");
                setHasArchiveError(true);
            }
            const serverTitles = (serverData || []).map(d => d.raw_data?.title || '');
            
            // 3. 현재 진행 중인 세션들 확인
            const activeTitles = allActiveSessions.map(s => s.title);
            
            const allTitles = [...localTitles, ...serverTitles, ...activeTitles];
            
            let maxSuffix = 0;
            const regex = new RegExp(`^${prefix}(\\d{2})$`);
            
            allTitles.forEach(t => {
                const match = t.match(regex);
                if (match) {
                    const suffix = parseInt(match[1]);
                    if (suffix > maxSuffix) maxSuffix = suffix;
                }
            });
            
        } catch (err) {
            console.error("Failed to find next title:", err);
        } finally {
            setIsCheckingTitle(false);
        }
    };

    // --- [v7.0 ABSOLUTE] 12전 13기: 서버 굴복 및 로컬 강제 저장 통합 헬퍼 ---
    const absoluteSyncRPC = async (data: any) => {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        
        // 1. 현장 DB ID 경보 (CEO Verification)
        const projectId = supabaseUrl.split('//')[1]?.split('.')[0] || 'Unknown';
        console.log(`🏙️ [ABSOLUTE] TARGET PROJECT ID: ${projectId}`);
        console.table(data);

        try {
            const endpoint = `${supabaseUrl}/rest/v1/rpc/final_sync_v7_absolute`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Prefer': 'params=single-object', // 마법의 헤더: JSON 전체를 단일 인자로 매핑
                    'x-client-info': 'teyeon-absolute-v7.0'
                },
                body: JSON.stringify(data) // 래핑 없이 순수 객체 전송
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errText}`);
            }
            console.log("✅ [ABSOLUTE] SERVER SYNC SUCCESS");
            return { error: null };
        } catch (err: any) {
            console.error("❌ [ABSOLUTE] SERVER SYNC FAILED, FORCING LOCAL SAVE:", err);
            
            // 3. '12전 13기' 로컬 강제 저장 (Offline First)
            try {
                const queue = JSON.parse(localStorage.getItem('teyeon_offline_sync_queue') || '[]');
                queue.push({ ...data, timestamp: new Date().toISOString() });
                localStorage.setItem('teyeon_offline_sync_queue', JSON.stringify(queue));
                console.warn("🛡️ [ABSOLUTE] DATA SECURED IN LOCAL STORAGE");
                return { error: null }; // 성공으로 간주하여 화면 진행
            } catch (localErr) {
                console.error("CRITICAL: Local storage save failed", localErr);
                return { error: err };
            }
        }
    };

    const allMatchesScored = useMemo(() => {
        return matches.length > 0 && matches.every(m => m.status === 'complete');
    }, [matches]);

    // Stage 1: Reveal & Ceremony
    const handleStartCeremony = () => {
        if (window.navigator?.vibrate) window.navigator.vibrate([100, 50, 100]);
        setActiveTab('RANKING');
        setShowCeremony(true);
        // Auto-scroll to top for the banner
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Stage 2: Official Archive & Shutdown (Admin Only)
    const handleFinalArchive = async () => {
        if (!confirm("🏆 대회를 공식적으로 종료하고 '심층 기록소'에 박제하시겠습니까?\n(라이브 데이터가 삭제되고 아카이브 포털로 즉시 이동합니다.)")) return;

        try {
            // [CEO 현장 검증 로직 가동]
            setIsGenerating(true);
            const today = new Date();
            const dateStr = today.toISOString().split('T')[0];

            // 1. Snapshot Ranking Data
            const rankingSnapshot = allPlayersInRanking.map(p => {
                const member = (allMembers || []).find(x => x?.id === p.id) || (tempGuests || []).find(x => x?.id === p.id);
                return {
                    id: p.id,
                    name: p.name,
                    wins: p.wins || 0,
                    losses: p.losses || 0,
                    diff: p.diff || 0,
                    avatar: member?.avatar_url || ''
                };
            });

            const rawDataPayload = {
                title: sessionTitle || `Tournament ${dateStr}`,
                date: dateStr,
                ranking_data: rankingSnapshot,
                snapshot_data: matches.map(m => {
                    const pNames = m.playerIds.map(pid => getPlayerName(pid));
                    const pAvatars = m.playerIds.map(pid => {
                        const mem = (allMembers || []).find(x => x?.id === pid) || (tempGuests || []).find(x => x?.id === pid);
                        return mem?.avatar_url || '';
                    });
                    return {
                        ...m,
                        player_ids: m.playerIds || [], 
                        player_names: pNames,
                        player_avatars: pAvatars,
                        group_name: m.groupName || 'A'
                    };
                }),
                player_metadata: attendeeConfigs,
                total_matches: matches.length,
                total_rounds: (matches.length > 0) ? Math.max(...matches.map(m => m.round || 1)) : 1
            };

            // [v10.0 SAVE OR DIE] 통신 전 로컬에 즉시 박제 (Safety First)
            try {
                const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
                const failoverItem = {
                    id: sessionId,
                    raw_data: rawDataPayload,
                    failover: true, // 서버 확인 전까지는 임시 상태
                    created_at: new Date().toISOString()
                };
                const filtered = failovers.filter((f: any) => f.id !== sessionId);
                filtered.push(failoverItem);
                localStorage.setItem('kdk_archive_failover', JSON.stringify(filtered));
                console.warn("🛡️ [v10.0] PRE-EMPTIVE LOCAL BACKUP SECURED");
            } catch (err) {
                console.error("Local backup failed", err);
            }

            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
            const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
            const endpoint = `${supabaseUrl}/rest/v1/teyeon_archive_v1`;

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${supabaseKey}`,
                        'Prefer': 'resolution=merge-duplicates',
                        'Cache-Control': 'no-cache'
                    },
                    body: JSON.stringify({ id: sessionId, raw_data: rawDataPayload })
                });

                if (!response.ok) {
                    const errText = await response.text();
                    console.error(`❌ [v14.0] SERVER REJECTED (${response.status}):`, errText);
                    throw new Error(`Server Rejected: ${errText}`);
                }
                console.log("✅ [v14.0] SERVER ARCHIVE SUCCESS");
            } catch (err: any) {
                console.error("❌ [v14.0] CRITICAL SYNC ERROR:", err);
                // [v10.0] CEO Request: Specific wording
                alert(`서버 통신 지연으로 기기에 임시 저장되었습니다. (${err.message})\n아카이브에서 확인 가능합니다.`);
            }

            // [v10.0] Championship Celebration (금색 가루 뿌리기)
            setShowArchiveSuccess(true);
            setShowConfetti(true);
            setCelebrationMode(true);
            if (window.navigator?.vibrate) window.navigator.vibrate([200, 100, 200, 100, 200]);
            
            // Celebration Delay for pure satisfaction
            await new Promise(r => setTimeout(r, 4500));

            // 3. Cleanup Live Data from Supabase
            const { error: delError } = await supabase.from('matches').delete().eq('session_id', sessionId);
            if (delError) console.error("Cleanup Error (Non-Fatal):", delError);

            // 4. Clear Local State
            actualReset();

            // 5. Redirect to Archive Portal
            router.push(`/archive?session=${sessionId}`);

        } catch (err: any) {
            alert("공식 종료 실패: " + err.message);
        } finally {
            setIsGenerating(false);
        }
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

    const resetSession = async () => {
        // --- 0. Delete active matches from DB (Prevents ghost resurrection) ---
        const targetSessionId = selectedSessionId || sessionId;
        if (targetSessionId) {
            try {
                await supabase.from('matches').delete().eq('session_id', targetSessionId);
            } catch (err) {
                console.error("DB reset error:", err);
            }
        }

        // --- 1. Immediate Storage Purge ---
        localStorage.removeItem('kdk_live_session');

        // --- 2. Brutal Page Refresh (Ensures 100% state cleanup) ---
        window.location.href = window.location.pathname;
    };

    const confirmReset = () => {
        setShowResetConfirm(true);
    };

    const actualReset = async () => {
        await resetSession();
    };


    const restoreSession = () => {
        try {
            const saved = localStorage.getItem('kdk_live_session');
            if (!saved) return false;

            const data = JSON.parse(saved);
            const hasSavedMatches = Array.isArray(data.matches) && data.matches.length > 0;
            const hasSavedLiveSession = Boolean(data.sessionId && (hasSavedMatches || data.step >= 3));
            if (data.matches) setMatches(data.matches || []);
            if (data.attendeeConfigs) setAttendeeConfigs(data.attendeeConfigs || {});
            if (data.selectedIds) setSelectedIds(new Set(data.selectedIds || []));
            if (data.tempGuests) setTempGuests(data.tempGuests || []);
            if (hasSavedLiveSession) {
                setStep(3);
                updateKdkEntryMode('CHOOSE');
                setHasRestoredSession(true);
            } else if (data.step) {
                setStep(data.step || 1);
                updateKdkEntryMode('CREATE');
            }
            if (data.generationMode) {
                setGenerationMode(data.generationMode);
            } else if (data.step === 1 || data.step === 2) {
                setGenerationMode('AUTO');
            }
            if (data.manualInputMode) setManualInputMode(data.manualInputMode);
            if (data.manualStep) setManualStep(data.manualStep);
            if (data.manualPasteText) setManualPasteText(data.manualPasteText);
            if (data.manualNameOverrides) setManualNameOverrides(data.manualNameOverrides || {});
            if (data.sessionTitle) setSessionTitle(data.sessionTitle);
            if (data.sessionId) setSessionId(data.sessionId);
            if (data.selectedSessionId || hasSavedLiveSession) setSelectedSessionId(data.selectedSessionId || data.sessionId);

            console.log("Session restored from LocalStorage");
            return hasSavedLiveSession;
        } catch (e) {
            console.error("Session Restoration Error:", e);
            return false;
        }
    };

    useEffect(() => {
        if (!hasInitializedKdkRef.current) {
            hasInitializedKdkRef.current = true;
            fetchMembers();
            restoreSession();

            const entryMode = new URLSearchParams(window.location.search).get('entry');
            if (entryMode === 'live') {
                updateKdkEntryMode('LIVE');
                setActiveTab('MATCHES');
                setStep(3);
                setShowGateway(false);
                window.history.replaceState(null, '', window.location.pathname);
            } else if (entryMode === 'create') {
                updateKdkEntryMode('CREATE');
                setShowGateway(false);
                setSelectedSessionId(null);
                setMatches([]);
                setSelectedIds(new Set());
                setAttendeeConfigs({});
                setTempGuests([]);
                setGenerationMode(null);
                setManualInputMode(null);
                setManualStep('INPUT');
                setManualPasteText("");
                setManualNameOverrides({});
                setActiveTab('MATCHES');
                setSessionId(createFreshSessionId());
                setSessionTitle(getSuggestedSessionTitle());
                setStep(0);
                window.history.replaceState(null, '', window.location.pathname);
            }

            // [v14.0] 초기 구동 시 제목 중복 체크
            setTimeout(() => {
                findNextAvailableTitle();
            }, 1500);

            // Migrate all 18:00 configs to 19:00
            setAttendeeConfigs(prev => {
                const next = { ...prev };
                let changed = false;
                Object.keys(next).forEach(id => {
                    if (next[id].startTime === '18:00') {
                        next[id] = { ...next[id], startTime: '19:00' };
                        changed = true;
                    }
                });
                return changed ? next : prev;
            });
        }

        const timer = setInterval(() => {
            setCurrentTime(new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' }));
        }, 1000);

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (selectedIds.size > 0 || step > 1) {
                e.preventDefault();
                e.returnValue = '';
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        // [v33.0] Club-Scoped Realtime Subscription (Simplification for Global Sync)
        const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
        const currentSid = showGateway ? null : activeSessionId;
        const realtimeFilter = `club_id=eq.${clubId}`;

        const matchesChannel = supabase.channel(`sync-kdk-club-${clubId}`)
            .on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: 'matches', 
                filter: realtimeFilter
            }, (payload: any) => {
                const updatedSessionId = payload.new?.session_id || payload.old?.session_id;
                
                // [v35.2] STRICT SESSION FILTER: Only trigger refresh for the active session or if in gateway
                if (currentSid && updatedSessionId === currentSid) {
                    fetchMatches(currentSid);
                } else if (currentSid) {
                } else if (!currentSid) {
                    console.log('[KDK Realtime] session list change:', updatedSessionId);
                    syncActiveSession();
                }
            })
            .subscribe((status) => {
                console.log('[KDK Realtime] status:', status);
            });

        return () => {
            clearInterval(timer);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            supabase.removeChannel(matchesChannel);
        };
    }, [activeSessionId, showGateway]);

    // [v25.0] Guest Access Auto Router
    useEffect(() => {
        if (!isAdmin && step < 3) {
            setStep(3);
            if (!selectedSessionId) setShowGateway(true);
        }
    }, [isAdmin, step, selectedSessionId]);

    // Save to LocalStorage
    useEffect(() => {
        if (step > 1 || selectedIds.size > 0 || generationMode === 'MANUAL') {
            const data = {
                matches,
                attendeeConfigs,
                selectedIds: Array.from(selectedIds),
                tempGuests,
                step,
                generationMode,
                manualInputMode,
                manualStep,
                manualPasteText,
                manualNameOverrides,
                sessionTitle,
                sessionId,
                selectedSessionId
            };
            localStorage.setItem('kdk_live_session', JSON.stringify(data));
        }
    }, [matches, attendeeConfigs, selectedIds, tempGuests, step, generationMode, manualInputMode, manualStep, manualPasteText, manualNameOverrides, sessionTitle, sessionId, selectedSessionId]);

    // Independent Score Buffer for Active Modal
    useEffect(() => {
        if (showScoreModal && (tempScores.s1 > 0 || tempScores.s2 > 0)) {
            localStorage.setItem(`kdk_score_buffer_${showScoreModal}`, JSON.stringify(tempScores));
        }
    }, [tempScores, showScoreModal]);

    // Restore Score Buffer on Open
    useEffect(() => {
        if (showScoreModal) {
            const saved = localStorage.getItem(`kdk_score_buffer_${showScoreModal}`);
            if (saved) {
                try {
                    setTempScores(JSON.parse(saved));
                } catch (e) { console.error(e); }
            }
        }
    }, [showScoreModal]);

    const fetchMembers = async () => {
        try {
            setIsMembersLoading(true);
            setIsMembersError(false);
            const { data: { user } } = await supabase.auth.getUser();
            if (user && !hasProfileError) {
                // Defensive profile check: app roles now live in profiles.role.
                try {
                    const { data: profile, error: profError } = await supabase
                        .from('profiles')
                        .select('role')
                        .eq('id', user.id)
                        .maybeSingle();
                    if (profError) {
                        console.warn("Profile check failed. Continuing with AuthContext role.", profError);
                        setHasProfileError(true);
                    } else if (profile) {
                        setUserRole((profile as any).role as UserRole);
                    }
                } catch (e) {
                    console.warn("Profile check skipped. Continuing with AuthContext role.", e);
                    setHasProfileError(true);
                }
            }

            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";

            let query = supabase.from('members').select('*');
            if (clubId) {
                query = query.eq('club_id', clubId);
            }

            const { data, error } = await query.order('nickname');

            if (error) throw error;
            setAllMembers(data || []);
            
            // After fetching members, check for active session in DB
            await syncActiveSession();
        } catch (err) {
            console.error("Fetch Members Error:", err);
            setIsMembersError(true);
            if (kdkEntryMode === 'CHECKING') {
                setHasRestoredSession(false);
                updateKdkEntryMode('CREATE');
                setStep(0);
            }
        } finally {
            setIsMembersLoading(false);
        }
    };

    const fetchMatches = async (targetSessionId: string) => {
        if (!targetSessionId) return;

        try {
            const { data, error } = await supabase
                .from('matches')
                .select('*')
                .eq('club_id', clubId)
                .eq('session_id', targetSessionId)
                .order('round', { ascending: true })
                .order('court', { ascending: true });

            if (error) throw error;

            const mappedMatches = (data || []).map(m => ({
                id: m.id,
                playerIds: m.player_ids || m.playerIds || [],
                playerNames: m.player_names || m.playerNames || [],
                court: m.court,
                status: m.status,
                score1: m.score1,
                score2: m.score2,
                mode: m.mode || 'KDK',
                round: m.round,
                teams: m.teams,
                groupName: m.group_name || m.groupName || 'A'
            })) as Match[];

            setMatches(mappedMatches);
            setLastSyncTime(new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        } catch (err) {
            console.error('[KDK Realtime] fetchMatches failed:', err);
        }
    };

    const syncActiveSession = async () => {
        try {
            
            let query = supabase
                .from('matches')
                .select('*')
                .eq('club_id', clubId);

            const shouldLoadAllSessions = !selectedSessionId && (showGateway || kdkEntryMode === 'CHECKING' || kdkEntryMode === 'CHOOSE' || (step === 1 && matches.length === 0));
            if (activeSessionId && !shouldLoadAllSessions) {
                query = query.eq('session_id', activeSessionId);
            }

            const { data, error } = await query;

            if (error) throw error;

            if (data && data.length > 0) {
                // Group by session
                const sessionsMap: Record<string, { id: string, title: string, matches: any[], players: Set<string>, lastActivity: string }> = {};
                
                data.forEach(m => {
                    const sId = m.session_id || 'LEGACY';
                    if (!sessionsMap[sId]) {
                        sessionsMap[sId] = {
                            id: sId,
                            title: m.session_title || 'Unnamed Tournament',
                            matches: [],
                            players: new Set(),
                            lastActivity: m.created_at
                        };
                    }
                    sessionsMap[sId].matches.push(m);
                    (m.playerIds || []).forEach((pid: string) => sessionsMap[sId].players.add(pid));
                });

                const sessionList = Object.values(sessionsMap).map(s => ({
                    id: s.id,
                    title: s.title,
                    matchCount: s.matches.length,
                    playerCount: s.players.size,
                    lastActivity: s.lastActivity
                }));

                setAllActiveSessions(prev => {
                    const nextJson = JSON.stringify(sessionList);
                    if (JSON.stringify(prev) === nextJson) return prev;
                    return sessionList;
                });

                // [v35.3] SESSION LOCK: If we already have a selected session, NEVER let auto-logic overwrite it
                const latestEntryMode = kdkEntryModeRef.current;
                if (!selectedSessionId && latestEntryMode !== 'CREATE' && latestEntryMode !== 'LIVE') {
                    if (sessionList.length === 1) {
                        // Auto-entry if only one session
                        const soleSession = sessionsMap[sessionList[0].id];
                        const mappedMatches = soleSession.matches.map(m => ({
                            id: m.id,
                            playerIds: m.player_ids || m.playerIds || [],
                            playerNames: m.player_names || m.playerNames || [],
                            court: m.court,
                            status: m.status,
                            score1: m.score1,
                            score2: m.score2,
                            mode: m.mode || 'KDK',
                            round: m.round,
                            teams: m.teams,
                            groupName: m.group_name || m.groupName || 'A'
                        }));
                        setMatches(prev => {
                            const nextJson = JSON.stringify(mappedMatches);
                            if (JSON.stringify(prev) === nextJson) return prev;
                            return mappedMatches;
                        });
                        setSessionId(soleSession.id);
                        setSessionTitle(soleSession.title);
                        setSelectedSessionId(soleSession.id);
                        setHasRestoredSession(true);
                        updateKdkEntryMode('CHOOSE');
                        setShowGateway(false);
                        setStep(3);
                    } else if (sessionList.length > 1) {
                        setHasRestoredSession(true);
                        updateKdkEntryMode('CHOOSE');
                        setShowGateway(true);
                        setStep(3);
                    }
                } else if (selectedSessionId) {
                    // Refresh current session data if already selected
                    const currentSession = sessionsMap[selectedSessionId];
                    if (currentSession) {
                        // [v34.1] Read extended metadata from Server Truth
                        const refreshingMatches = currentSession.matches.map((m: any) => ({
                            id: m.id,
                            playerIds: m.player_ids || m.playerIds || [],
                            playerNames: m.player_names || m.playerNames || [],
                            court: m.court,
                            status: m.status,
                            score1: m.score1,
                            score2: m.score2,
                            mode: m.mode || 'KDK',
                            round: m.round,
                            teams: m.teams,
                            groupName: m.group_name || m.groupName || 'A'
                        }));

                        // [v34.1] GUEST RECOVERY: Re-materialize tempGuests from match data if names are missing locally
                        const guestMappings: Record<string, string> = {};
                        refreshingMatches.forEach((rm: any) => {
                            rm.playerIds.forEach((pid: string, idx: number) => {
                                if (pid?.startsWith('g-') || pid?.startsWith('manual-guest-')) {
                                    const rawName = rm.playerNames?.[idx] || "";
                                    const cleanName = rawName.replace(/\s*\(G\)$/i, '').replace(/\s+g$/i, '').trim();
                                    if (cleanName) guestMappings[pid] = cleanName;
                                }
                            });
                        });

                        if (Object.keys(guestMappings).length > 0) {
                            setTempGuests(prev => {
                                const next = [...prev];
                                let changed = false;
                                Object.entries(guestMappings).forEach(([gid, gname]) => {
                                    if (!next.some(p => p.id === gid)) {
                                        next.push({ id: gid, nickname: gname, is_guest: true });
                                        changed = true;
                                    }
                                });
                                return changed ? next : prev;
                            });
                        }

                        setMatches(prev => {
                            const nextJson = JSON.stringify(refreshingMatches);
                            if (JSON.stringify(prev) === nextJson) return prev;
                            return refreshingMatches;
                        });
                        // Also sync Title in case it was changed
                        if (currentSession.title !== sessionTitle) {
                            setSessionTitle(currentSession.title);
                        }
                    }
                }
                setLastSyncTime(new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
                
                // [v34.2] Detect Sync Integrity
                const hasModernMetadata = sessionList.length > 0 && data.some((m: any) => m.player_names && m.player_names.length > 0);
                if (sessionList.length > 0 && !hasModernMetadata) {
                    setIsLegacySync(true);
                    setSyncStatus('WARNING');
                } else {
                    setIsLegacySync(false);
                    setSyncStatus('HEALTHY');
                    setSyncErrorMsg(null);
                }
            } else {
                const latestEntryMode = kdkEntryModeRef.current;
                if (latestEntryMode !== 'CREATE') {
                    setAllActiveSessions([]);
                }
                setShowGateway(false);
                if (latestEntryMode === 'CHECKING') {
                    setHasRestoredSession(false);
                    updateKdkEntryMode('CREATE');
                    setStep(0);
                }
                if (!isAdmin) {
                    setShowGateway(true);
                    updateKdkEntryMode('LIVE');
                    setStep(3);
                }
            }
        } catch (err) {
            console.error("Active session sync failure:", err);
            if (kdkEntryModeRef.current === 'CHECKING') {
                setHasRestoredSession(false);
                updateKdkEntryMode('CREATE');
                setStep(0);
            }
        }
    };

    const enterSession = (sId: string) => {
        const target = allActiveSessions.find(s => s.id === sId);
        if (target) {
            setSelectedSessionId(sId);
            setShowGateway(false);
            setSessionId(sId);
            setSessionTitle(target.title);
            updateKdkEntryMode('LIVE');
            setStep(3);
            // Trigger a re-sync to get the full match data for this session
            syncActiveSession();
        }
    };

    const createFreshSessionId = () => {
        const d = new Date();
        const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
        return `KDK-${dateStr}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    };

    const getSuggestedSessionTitle = () => {
        const d = new Date();
        const yy = String(d.getFullYear()).slice(-2);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const prefix = `${yy}${mm}${dd}_KDK_`;
        const titles = [sessionTitle, ...allActiveSessions.map(s => s.title)].filter(Boolean);
        const maxSequence = titles.reduce((max, title) => {
            if (!title.startsWith(prefix)) return max;
            const value = Number(title.slice(prefix.length));
            return Number.isFinite(value) ? Math.max(max, value) : max;
        }, 0);
        return `${prefix}${String(maxSequence + 1).padStart(2, '0')}`;
    };

    const openExistingLiveCourt = () => {
        updateKdkEntryMode('LIVE');
        setActiveTab('MATCHES');
        setStep(3);
        if (allActiveSessions.length > 1 && !selectedSessionId) {
            setShowGateway(true);
        } else {
            setShowGateway(false);
        }
    };

    const startNewKdkCreation = () => {
        if (!isAdmin) {
            triggerAccessDenied("새로운 경기는 관리자만 생성 가능합니다.");
            return;
        }

        updateKdkEntryMode('CREATE');
        setShowGateway(false);
        setSelectedSessionId(null);
        setMatches([]);
        setSelectedIds(new Set());
        setAttendeeConfigs({});
        setTempGuests([]);
        setGenerationMode(null);
        setManualInputMode(null);
        setManualStep('INPUT');
        setManualPasteText("");
        setManualNameOverrides({});
        setActiveTab('MATCHES');
        setSessionId(createFreshSessionId());
        setSessionTitle(getSuggestedSessionTitle());
        setStep(0);
    };

    const clampTotalCourts = (value: number) => {
        const numericValue = Number.isFinite(value) ? Math.trunc(value) : 1;
        return Math.min(99, Math.max(1, numericValue));
    };

    const commitTotalCourts = (value: number) => {
        const nextValue = clampTotalCourts(value);
        setTotalCourts(nextValue);
        setTotalCourtsInput(String(nextValue));
    };

    const handleTotalCourtsInputChange = (value: string) => {
        const digitsOnly = value.replace(/[^\d]/g, '');
        setTotalCourtsInput(digitsOnly);
        if (!digitsOnly) return;
        commitTotalCourts(Number(digitsOnly));
    };

    const handleTotalCourtsInputBlur = () => {
        commitTotalCourts(Number(totalCourtsInput || totalCourts || 1));
    };

    const toggleMember = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
            // Auto-populate attendee config if member has data
            const member = allMembers.find(m => m.id === id);
            if (member && !attendeeConfigs[id]) {
                const isAwardWinner = (member.achievements || '').includes('우승') ||
                    (member.achievements || '').includes('준우승') ||
                    (member.achievements || '').includes('입상');

                setAttendeeConfigs(prev => ({
                    ...prev,
                    [id]: {
                        id,
                        name: member.nickname,
                        group: (member.position || '').toUpperCase().includes('B') ? 'B' : 'A',
                        startTime: '19:00',
                        endTime: '22:00',
                        age: member.age,
                        isWinner: isAwardWinner
                    }
                }));
            }
        }
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


    const isLikelyPlayerId = (value?: string) => {
        if (!value) return false;
        const trimmed = value.trim();
        return (
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed) ||
            /^\d+$/.test(trimmed) ||
            /^manual-guest-/i.test(trimmed) ||
            /^(g|guest)-\d+/i.test(trimmed) ||
            /^[0-9a-f]{24,}$/i.test(trimmed)
        );
    };

    const getManualGuestDisplayName = (value?: string) => {
        const trimmed = (value || "").trim();
        if (!trimmed.toLowerCase().startsWith('manual-guest-')) return "";
        const name = trimmed.replace(/^manual-guest-/i, '').replace(/\s*\(G\)$/i, '').trim();
        return name ? `${name}(G)` : "게스트(G)";
    };

    const stripGuestSuffix = (value?: string) => {
        return (value || "").replace(/\s*\(G\)$/i, '').replace(/\s+g$/i, '').trim();
    };

    const cleanDisplayName = (value?: string) => {
        const manualGuestName = getManualGuestDisplayName(value);
        if (manualGuestName) return stripGuestSuffix(manualGuestName);
        const cleaned = stripGuestSuffix(value);
        return cleaned && !isLikelyPlayerId(cleaned) ? cleaned : "";
    };

    const findMatchPlayerName = (id: string, matchId?: string) => {
        const sourceMatches = matchId
            ? matches.filter(mx => mx.id === matchId)
            : matches.filter(mx => (mx.playerIds || []).includes(id));

        for (const match of sourceMatches) {
            const idx = match.playerIds?.indexOf(id) ?? -1;
            if (idx === -1) continue;

            const metadataName = cleanDisplayName(match.playerNames?.[idx]);
            if (metadataName) return metadataName;

            const teamIndex = idx >= 2 ? 1 : 0;
            const teamPlayerIndex = idx % 2;
            const teamName = cleanDisplayName((match as any).teams?.[teamIndex]?.[teamPlayerIndex]);
            if (teamName) return teamName;
        }

        return "";
    };

    const getPlayerName = (id: string, matchId?: string) => {
        if (!id) return "";
        
        // [v34.4] HYBRID LOOKUP: Try primary source first
        const m = [...(allMembers || []), ...(tempGuests || [])].find(x => x?.id === id);
        let name = cleanDisplayName(m?.nickname || (m as any)?.name || attendeeConfigs?.[id]?.name || "");
        
        // [v34.4] FALLBACK to Match Metadata (If lookup failed but DB has the original name)
        if (!name) name = findMatchPlayerName(id, matchId);

        const manualGuestName = getManualGuestDisplayName(id);
        if (!name && manualGuestName) return manualGuestName;

        if (!name) {
            return isLikelyPlayerId(id) ? "이름 확인중" : id;
        }
        
        // [v34.1] More robust guest detection
        const isGuest = (id.startsWith('g-')) || (id.startsWith('manual-guest-')) || (m?.is_guest === true) || ((m as any)?.isGuest === true) || (attendeeConfigs?.[id]?.is_guest === true);
        return isGuest ? `${name}(G)` : name;
    };

    const getPlayerAvatar = (id: string) => {
        if (!id) return "";
        const m = [...(allMembers || []), ...(tempGuests || [])].find(x => x?.id === id);
        return m?.avatar_url || "";
    };

    const PlayerAvatar = ({ id, size = 20 }: { id: string, size?: number }) => {
        const url = getPlayerAvatar(id);
        return (
            <div 
                className="rounded-full overflow-hidden bg-white/10 flex-shrink-0 border border-white/10" 
                style={{ width: `${size}px`, height: `${size}px` }}
            >
                {url ? (
                    <img 
                        src={url} 
                        alt="p" 
                        className="w-full h-full object-cover" 
                        onError={(e) => { (e.target as any).style.display = 'none'; }}
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center opacity-30">
                        <svg viewBox="0 0 24 24" fill="currentColor" width={size*0.6} height={size*0.6}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08s5.97 1.09 6 3.08c-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
                    </div>
                )}
            </div>
        );
    };

    const generateKDK = async () => {
        // Late Gaming: Permission Check at Final Button
        if (hasPermission('kdk') !== 'WRITE') {
            alert(getRestrictionMessage('kdk'));
            return;
        }

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
                const conf = attendeeConfigs[id] || { group: 'A', startTime: '19:00', endTime: '22:00' };
                return {
                    id,
                    name: m?.nickname || "Unknown",
                    group: conf.group,
                    times: [conf.startTime, conf.endTime] as [string, string],
                    isGuest: m?.is_guest,
                    achievements: !!conf.isWinner, // Use actual isWinner flag
                    age: conf.age,
                    mbti: m?.mbti,
                    birthdate: conf.age ? String(new Date().getFullYear() - conf.age) : undefined, // Encode age as birth year for engine
                } as any;
            });

            const groupCourtMap: Record<string, number[]> = {
                'A': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                'B': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            };

            const kdkMatches = generateKdkMatches(attendees, groupCourtMap, targetGames, genMode, fixedPartners, fixedTeamMode);

            // [v20.0] Validation: Check if all fixed partners were honored
            if (fixedPartners.length > 0 && !fixedTeamMode) {
                const unfulfilledPairs = fixedPartners.filter(([idA, idB]) => {
                    const nameA = attendees.find(a => a.id === idA)?.name;
                    const nameB = attendees.find(a => a.id === idB)?.name;
                    if (!nameA || !nameB) return false;
                    
                    const matchedCount = kdkMatches.filter(m => {
                        const t1 = m.team1.includes(nameA) && m.team1.includes(nameB);
                        const t2 = m.team2.includes(nameA) && m.team2.includes(nameB);
                        return t1 || t2;
                    }).length;

                    return matchedCount === 0;
                });

                if (unfulfilledPairs.length > 0) {
                    setTimeout(() => {
                        setWarningMsg("고정 파트너가 너무 많아 100% 매칭이 불가능합니다.\\n일부 대진은 수동으로 조정해 주세요.");
                        setShowWarning(true);
                    }, 500);
                }
            }

            // Convert KdkMatch to internal Match
            const formattedMatches: Match[] = kdkMatches.map(km => ({
                id: km.id,
                playerIds: [...km.team1, ...km.team2].map(name => attendees.find(a => a.name === name)?.id || name),
                court: km.court,
                status: 'waiting',
                mode: 'KDK',
                round: km.round,
                teams: [km.team1, km.team2],
                groupName: km.group
            })) as any;

            // [v34.2] Resilient Sync: Try Full Sync first, Fallback to Legacy if DB schema is stale
            try {
                const fullDbMatches = formattedMatches.map(m => ({
                    id: String(m.id),
                    club_id: clubId,
                    session_id: sessionId,
                    session_title: sessionTitle || 'Tournament',
                    round: m.round || 1,
                    court: m.court || 1,
                    player_ids: (m as any).playerIds || [],
                    player_names: (m as any).playerIds?.map((pid: string) => getPlayerName(pid)) || [],
                    mode: m.mode || 'KDK',
                    group_name: m.groupName || 'A',
                    score1: m.score1 ?? 1,
                    score2: m.score2 ?? 1,
                    status: m.status || 'waiting'
                }));

                const { error: fullError } = await supabase
                    .from('matches')
                    .upsert(fullDbMatches, { onConflict: 'id' });
                
                if (fullError) {
                    const isSchemaError = fullError.message?.includes('column') || fullError.message?.includes('schema cache');
                    if (isSchemaError) {
                        // [v35.1] Detailed diagnostic for developer/admin
                        console.warn("⚠️ Full sync restricted. Missing columns or stale cache detector on:", fullError.message);
                        const legacyDbMatches = fullDbMatches.map(({ player_names, mode, group_name, score1, score2, ...rest }: any) => rest);
                        const { error: legacyError } = await supabase
                            .from('matches')
                            .upsert(legacyDbMatches, { onConflict: 'id' });
                        if (legacyError) throw legacyError;
                        
                        setIsLegacySync(true);
                        setSyncStatus('WARNING');
                        // setSyncErrorMsg(...) removed to prevent popup
                        console.log("ℹ️ Legacy Fallback Sync Active");
                    } else {
                        throw fullError;
                    }
                } else {
                    setIsLegacySync(false);
                    setSyncStatus('HEALTHY');
                    setSyncErrorMsg(null);
                    console.log("✅ Full Live Match Sync Success");
                }
            } catch (err: any) {
                console.error("Critical Sync Failure:", err);
                alert(`🚨 DB 통신 중대한 에러!\n${err.message}`);
            }

            if (window.navigator?.vibrate) window.navigator.vibrate([100, 50, 100]); // 딩-동!
            setMatches(formattedMatches);
            updateKdkEntryMode('LIVE');
            setStep(3);
        } catch (err: any) {
            console.error(err);
            alert("대진 생성 실패: " + err.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const saveManualKDKMatches = async () => {
        if (isGenerating) return;

        if (hasPermission('kdk') !== 'WRITE') {
            alert(getRestrictionMessage('kdk'));
            return;
        }

        const title = sessionTitle.trim();
        if (!title) {
            alert('세션명을 입력해 주세요.');
            return;
        }

        if (manualPastePreview.length === 0) {
            alert('저장할 수동 대진이 없습니다.');
            return;
        }

        const invalidRow = manualPastePreview.find(row => !row.isValid);
        if (invalidRow) {
            alert(`형식을 확인해 주세요: ${invalidRow.raw}`);
            return;
        }

        setIsGenerating(true);
        const summarizeSupabaseError = (error: any) => ({
            message: error?.message || String(error || 'Unknown error'),
            details: error?.details,
            hint: error?.hint,
            code: error?.code,
        });
        let lastManualError: any = null;
        try {
            const manualSessionId = sessionId?.trim() || (() => {
                const d = new Date();
                const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
                return `KDK-${dateStr}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
            })();

            const seenMatchSignatures = new Set<string>();
            const manualGuests = new Map<string, Member>();
            const nextSelectedIds = new Set(selectedIds);
            const nextAttendeeConfigs = { ...attendeeConfigs };

            const formattedMatches = manualPastePreview.map((row, index) => {
                const group = normalizeManualGroup(row.group);
                const resolvedPlayers = [...row.teamA, ...row.teamB].map(getManualResolvedPlayer);
                const playerIds = resolvedPlayers.map(player => player.id);
                const playerNames = resolvedPlayers.map(player => player.name);
                const uniquePlayers = new Set(playerIds);

                if (uniquePlayers.size !== 4) {
                    throw new Error(`${getManualGroupLabel(group)} ${row.order}번 경기 안에 같은 선수가 중복되어 있습니다.`);
                }

                const signature = `${group}|${playerIds.join('|')}|${row.time || ''}`;
                if (seenMatchSignatures.has(signature)) {
                    throw new Error(`${getManualGroupLabel(group)} ${row.order}번 경기와 같은 대진이 중복되어 있습니다.`);
                }
                seenMatchSignatures.add(signature);

                playerIds.forEach((playerId, playerIndex) => {
                    const resolved = resolvedPlayers[playerIndex];
                    const isGuest = resolved.isGuest;
                    const displayName = resolved.name.replace(/\(G\)$/i, '').trim();
                    nextSelectedIds.add(playerId);
                    nextAttendeeConfigs[playerId] = {
                        ...(nextAttendeeConfigs[playerId] || {}),
                        id: playerId,
                        name: displayName || resolved.rawName || 'Guest',
                        is_guest: isGuest,
                        group: group === 'B' ? 'B' : 'A',
                        startTime: row.time || nextAttendeeConfigs[playerId]?.startTime || '19:00',
                        endTime: nextAttendeeConfigs[playerId]?.endTime || '22:00',
                    };

                    if (isGuest) {
                        manualGuests.set(playerId, {
                            id: playerId,
                            nickname: displayName || resolved.rawName || 'Guest',
                            is_guest: true,
                            position: group,
                        });
                    }
                });

                return {
                    id: crypto.randomUUID(),
                    playerIds,
                    playerNames,
                    court: row.order || index + 1,
                    status: 'waiting',
                    score1: 1,
                    score2: 1,
                    mode: 'KDK',
                    round: row.order || index + 1,
                    teams: [playerNames.slice(0, 2), playerNames.slice(2, 4)] as [string[], string[]],
                    groupName: group,
                } as Match;
            });

            const fullDbMatches = formattedMatches.map(m => ({
                id: String(m.id),
                club_id: clubId,
                session_id: manualSessionId,
                session_title: title,
                round: m.round || 1,
                court: m.court || 1,
                player_ids: (m as any).playerIds || [],
                player_names: (m as any).playerNames || [],
                mode: m.mode || 'KDK',
                group_name: m.groupName || 'A',
                score1: m.score1 ?? 1,
                score2: m.score2 ?? 1,
                status: m.status || 'waiting',
            }));
            const { error: fullError } = await supabase
                .from('matches')
                .upsert(fullDbMatches, { onConflict: 'id' });

            if (fullError) {
                lastManualError = fullError;
                const isSchemaError = fullError.message?.includes('column') || fullError.message?.includes('schema cache');
                if (isSchemaError) {
                    console.warn('[Manual KDK Save Fallback]', summarizeSupabaseError(fullError));
                    const legacyDbMatches = fullDbMatches.map(({ player_names, mode, group_name, score1, score2, ...rest }: any) => rest);
                    const { error: legacyError } = await supabase
                        .from('matches')
                        .upsert(legacyDbMatches, { onConflict: 'id' });
                    if (legacyError) {
                        lastManualError = legacyError;
                        console.error('[Manual KDK Save Failure]', summarizeSupabaseError(legacyError));
                        throw legacyError;
                    }
                    setIsLegacySync(true);
                    setSyncStatus('WARNING');
                } else {
                    console.error('[Manual KDK Save Failure]', summarizeSupabaseError(fullError));
                    throw fullError;
                }
            } else {
                setIsLegacySync(false);
                setSyncStatus('HEALTHY');
                setSyncErrorMsg(null);
            }

            setSessionId(manualSessionId);
            setSelectedSessionId(manualSessionId);
            setSessionTitle(title);
            setShowGateway(false);
            setTempGuests(prev => {
                const next = new Map(prev.map(guest => [guest.id, guest]));
                manualGuests.forEach((guest, id) => next.set(id, guest));
                return Array.from(next.values());
            });
            setSelectedIds(nextSelectedIds);
            setAttendeeConfigs(nextAttendeeConfigs);
            setMatches(formattedMatches);
            setGenerationMode(null);
            setManualInputMode(null);
            setManualStep('INPUT');
            setActiveTab('MATCHES');
            updateKdkEntryMode('LIVE');
            setStep(3);

            if (window.navigator?.vibrate) window.navigator.vibrate([100, 50, 100]);
            alert('수동 대진이 생성되었습니다.');
        } catch (err: any) {
            if (lastManualError !== err) {
                console.error('[Manual KDK Save Failure]', summarizeSupabaseError(err));
            }
            alert(`수동 대진 생성 실패: ${err.message || String(err)}`);
        } finally {
            setIsGenerating(false);
        }
    };

    const startMatch = async (matchId: string) => {
        if (isStartingMatch) return;

        // [v8.0] Safety Guard: Prevent redundant entry & enforce court limits
        const targetMatch = matches.find(m => m.id === matchId);
        if (!targetMatch) return;
        
        if (targetMatch.status === 'playing') {
            setToastMsg("이미 활성화된 경기입니다");
            setShowToast(true);
            setTimeout(() => setShowToast(false), 3000);
            return;
        }

        // 1. Court Limit Check REMOVED (CEO: "코트 수는 무제한이라 생각하면 돼")
        // No check against totalCourts here anymore.

        // 2. Participant Conflict Check
        const conflictPlayers = (targetMatch.playerIds || []).filter(pid => busyPlayerIds.has(pid));
        if (conflictPlayers.length > 0) {
            const names = conflictPlayers.map(pid => getPlayerName(pid)).join(', ');
            setToastMsg(`참여자 중복: ${names} 선수가 이미 경기 중입니다`);
            setShowToast(true);
            if (window.navigator?.vibrate) window.navigator.vibrate([100, 50, 100]);
            setTimeout(() => setShowToast(false), 3000);
            return;
        }

        try {
            setIsStartingMatch(true);

            // [v19.0] Required for court number allocation
            const playingMatches = matches.filter(m => m.status === 'playing');

            // Find lowest available court number
            const inUseCourts = playingMatches.map(m => m.court || 0);
            let nextCourt = 1;
            while (inUseCourts.includes(nextCourt)) nextCourt++;

            const nextMatches = matches.map(m => m.id === matchId ? { ...m, status: 'playing' as const, court: nextCourt } : m);
            
            // Local state update
            setMatches(nextMatches);

            // DB Sync via Native Update (RPC 우회)
            const { error: updateError } = await supabase
                .from('matches')
                .update({ status: 'playing', court: nextCourt })
                .eq('id', String(matchId));
                
            if (updateError) throw updateError;

            // Manual Invalidation (sync state from server)
            await syncActiveSession();
        } finally {
            setIsStartingMatch(false);
        }
    };

    // [v35.6] Manual Repair: Force Push local names/metadata to server
    const execFullRepair = async () => {
        if (!isAdmin || isGenerating) return;
        
        try {
            setIsGenerating(true);
            const fullDbMatches = matches.map(m => ({
                id: String(m.id),
                club_id: clubId,
                session_id: sessionId,
                session_title: sessionTitle || 'Tournament',
                round: m.round || 1,
                court: m.court || 1,
                player_ids: (m as any).playerIds || [],
                player_names: (m as any).playerIds?.map((pid: string) => getPlayerName(pid)) || [],
                mode: m.mode || 'KDK',
                group_name: m.groupName || 'A',
                score1: m.score1 ?? 1,
                score2: m.score2 ?? 1,
                status: m.status || 'waiting'
            }));

            const { error } = await supabase
                .from('matches')
                .upsert(fullDbMatches, { onConflict: 'id' });

            if (error) throw error;

            console.log("✅ Full Live Match Sync Success");
            setIsLegacySync(false);
            setSyncStatus('HEALTHY');
            setSyncErrorMsg(null);
            setToastMsg("데이터 구조가 성공적으로 복구되었습니다!");
            setShowToast(true);
            setTimeout(() => setShowToast(false), 3000);
            
            await syncActiveSession();
        } catch (err: any) {
            console.error("Repair Failed:", err);
            alert(`🚨 복구 실패: ${err.message}\n\n[종합 선물 세트 SQL]을 먼저 실행했는지 확인해 주세요.`);
        } finally {
            setIsGenerating(false);
        }
    };

    const cancelMatch = async (matchId: string) => {
        try {
            if (window.navigator?.vibrate) window.navigator.vibrate(50);
            setSpinningMatchId(matchId); // Start spin feedback
            // 1. Supabase Sync via Native Update (RPC 우회)
            const { error: syncError } = await supabase
                .from('matches')
                .update({ status: 'waiting', court: null, score1: 1, score2: 1 })
                .eq('id', String(matchId));

            if (syncError) console.error("❌ Cancel match sync error:", syncError);

            // 2. Local State Update & Invalidation (Removed setActiveMatchIds)
            setMatches(prev => prev.map(m => m.id === matchId ? { ...m, status: 'waiting', court: null } : m));

            // 3. Manual Invalidation (sync state from server)
            await syncActiveSession();

            setTimeout(() => setSpinningMatchId(null), 500); // 0.5s Fast spin as requested
        } catch (err: any) {
            console.error("Cancel match error:", err);
            setSpinningMatchId(null);
            alert("경기 취소 중 오류가 발생했습니다: " + err.message);
        }
    };

    const updateMatchCourt = (matchId: string) => {
        const courtStr = prompt("변경할 코트 번호를 입력하세요", "1");
        if (courtStr === null) return;
        const courtNum = parseInt(courtStr) || 1;
        setMatches(prev => prev.map(m => m.id === matchId ? { ...m, court: courtNum } : m));
    };

    const syncMatchScore = async (matchId: string) => {
        try {
            if (window.navigator?.vibrate) window.navigator.vibrate(50);
            setSpinningMatchId(matchId);
            const { data, error } = await supabase.from('matches').select('score1, score2').eq('id', matchId).single();
            if (!error && data) {
                setMatches(prev => prev.map(m => m.id === matchId ? { ...m, score1: data.score1 ?? m.score1, score2: data.score2 ?? m.score2 } : m));
                if (showScoreModal === matchId) setTempScores({ s1: data.score1 || 0, s2: data.score2 || 0 });
            }
            setTimeout(() => setSpinningMatchId(null), 1000);
        } catch (err) {
            console.error(err);
            setSpinningMatchId(null);
        }
    };

    const handleMemberEditConfirm = async () => {
        const result = validateGroups();
        if (!result.ok) {
            setWarningMsg(result.msg);
            setShowWarning(true);
            return;
        }

        // Mid-tournament re-generate logic
        const completedMatches = matches.filter(m => m.status === 'complete');
        const activeMatches = matches.filter(m => m.status === 'playing');

        setIsGenerating(true);
        try {
            // Re-map players
            const attendees = Array.from(selectedIds).map(id => {
                const m = allMembers.find(x => x.id === id) || tempGuests.find(x => x.id === id);
                const conf = attendeeConfigs[id] || { group: 'A', startTime: '19:00', endTime: '22:00' };
                return {
                    id,
                    name: m?.nickname || "Unknown",
                    group: conf.group,
                    times: [conf.startTime, conf.endTime] as [string, string],
                    isGuest: m?.is_guest,
                    achievements: !!conf.isWinner,
                    age: conf.age,
                    mbti: m?.mbti,
                    birthdate: conf.age ? String(new Date().getFullYear() - conf.age) : undefined,
                } as any;
            });

            const groupCourtMap: Record<string, number[]> = { 'A': [1, 2, 3, 4, 5, 6], 'B': [1, 2, 3, 4, 5, 6] };

            // DECISION: We keep COMPLETED and PLAYING matches as is.
            // We re-generate only the FUTURE matches.
            const newMatches = generateKdkMatches(
                attendees,
                groupCourtMap,
                targetGames,
                genMode,
                fixedPartners,
                fixedTeamMode,
                [...completedMatches, ...activeMatches] as any
            );

            // Convert to internal format
            const formattedMatches: Match[] = newMatches.map(km => {
                const existing = matches.find(em => em.id === km.id);
                if (existing) return existing; // Keep existing status/score

                return {
                    id: km.id,
                    playerIds: km.playerIds || [],
                    court: km.court,
                    status: 'waiting',
                    mode: 'KDK',
                    round: km.round,
                    score1: 1,
                    score2: 1
                };
            }) as any;

            setMatches(formattedMatches);
            setShowMemberEditModal(false);
        } catch (err: any) {
            alert("대진 재구성 실패: " + err.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const finishMatch = async (matchId: string, s1: number, s2: number) => {
        try {
            // 1. Prepare match data for archiving
            const matchToFinish = matches.find(m => m.id === matchId);
            if (!matchToFinish) return;

            // Type Safety: Ensure scores are numbers
            const numS1 = Number(s1);
            const numS2 = Number(s2);

            // Data Sanitization: Exclude internal UI fields like 'teams' (array of arrays) that may fail DB serialization
            const { teams, ...safeMatchData } = matchToFinish as any;

            const pNames = matchToFinish.playerIds?.map(pid => getPlayerName(pid)) || [];
            const finishedMatchData: any = {
                ...safeMatchData,
                score1: numS1,
                score2: numS2,
                status: 'complete',
                player_names: pNames,
                session_title: sessionTitle,
                match_date: new Date().toISOString()
            };

            // 2. Local state update for immediate feedback (MUST HAVE playerIds for UI)
            const nextMatches = matches.map(m => m.id === matchId ? finishedMatchData : m);
            setMatches(nextMatches);
            setShowScoreModal(null);
            if (window.navigator?.vibrate) window.navigator.vibrate([100, 50, 100]);

            // 3. Automated Server Archiving: Sanitized for DB
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            const matchDateStr = `${yyyy}-${mm}-${dd}`;

            // Deterministic Unique ID for Upsert (Session + Round + Court)
            const deterministicId = `arch-${sessionId}-${matchToFinish.round}-${matchToFinish.court}`;

            // 3. DB Sync via Native Update (RPC 우회)
            const { error: syncError } = await supabase
                .from('matches')
                .update({ status: 'complete', score1: numS1, score2: numS2 })
                .eq('id', String(matchId));
            
            if (syncError) {
                console.error("Match result sync error:", syncError);
                throw syncError;
            }

            // 4. Immediate 'Invalidation' (Manual State Refresh)
            await syncActiveSession(); 
            // window.location.reload(); // [DELETED] No more hard reloads for premium UX

            // Success: Trigger Toast instead of Alert
            setShowToast(true);
            setTimeout(() => setShowToast(false), 3000);

            // Clear Score Buffer
            localStorage.removeItem(`kdk_score_buffer_${matchId}`);
        } catch (err: any) {
            console.error("Critical Finish Match Failure:", err);
            alert("경기 결과 저장에 실패했습니다: " + (err.message || "Unknown error"));
            // We do NOT revert local state here to avoid confusion, 
            // the user can retry or check the archive later.
        }
    };

    // [v34.0] Centralized Ranking Hook (Portable for Special Match/Custom Mode)
    const { ranking: allPlayersInRanking, playerStats } = useRanking(
        matches,
        allMembers,
        tempGuests,
        selectedIds,
        attendeeConfigs
    );


    const execCopySchedule = () => {
        if (!matches || matches.length === 0) {
            alert("데이터를 불러오는 중입니다...");
            return;
        }

        // [v3.2 - FINAL REQUESTED TEMPLATE]
        let text = `📌 오늘의 대진표: ${sessionTitle || 'Live Tournament'}\n`;
        text += `⚖️ 규칙: ${matchRules || '1:1 시작, 노에드, 타이 3:3 시작 7포인트 선승'}\n`;
        text += `💰 상벌금: 우승 ${firstPrize.toLocaleString()} / 벌금 ${bottom25Late.toLocaleString()} / 벌금 ${bottom25Penalty.toLocaleString()}\n`;
        text += `━━━━━━━━━━━━━━\n`;

        const uniqueGroups = [...new Set(matches.map(m => m.groupName || 'A'))].sort();
        const hasMultipleGroups = uniqueGroups.length > 1;

        uniqueGroups.forEach(group => {
            if (hasMultipleGroups) {
                text += `\n📍 '${group}'조 대진표\n`;
            }

            const groupMatches = matches.filter(m => (m.groupName || 'A') === group);
            const rounds = [...new Set(groupMatches.map(m => m.round || 1))].sort((a, b) => a - b);

            rounds.forEach(r => {
                text += `\n📍 ${r}라운드\n`;
                const roundMatches = groupMatches.filter(m => m.round === r).sort((a, b) => (a.id || '').localeCompare(b.id || ''));
                roundMatches.forEach(m => {
                    const teamA = `${getPlayerName(m.playerIds[0])}/${getPlayerName(m.playerIds[1])}`;
                    const teamB = `${getPlayerName(m.playerIds[2])}/${getPlayerName(m.playerIds[3])}`;
                    // STRICT FORMAT: No court, just players
                    text += `${teamA} vs ${teamB}\n`;
                });
            });

            if (hasMultipleGroups) {
                text += `\n━━━━━━━━━━━━━━\n`;
            }
        });

        text = text.trim();
        if (!hasMultipleGroups) {
            text += `\n━━━━━━━━━━━━━━`;
        }
        text += `\n※ 상세 결과 확인: https://teyeon-system.vercel.app/kdk`;

        console.log("Copied Match Schedule v3.2 (No Courts, No '지각')");
        navigator.clipboard.writeText(text);
        alert("실시간 대진표가 클립보드에 복사되었습니다! ✅");
    };

    const copyFinalResults = () => {
        if (!matches || matches.length === 0) {
            alert("데이터를 불러오는 중입니다...");
            return;
        }

        let text = `🏆 오늘의 최종 결과: ${sessionTitle || 'Live Tournament'}\n`;
        text += `🏦 계좌: ${accountInfo}\n`;
        text += `━━━━━━━━━━━━━━\n\n`;

        const sortedPlayers = [...allPlayersInRanking];
        const totalCount = sortedPlayers.length;

        // Logical Settlement Rules (MBTI/AGE/RANDOM Consistency)
        const bottomHalfCount = Math.ceil(totalCount / 2);
        const penaltyCount = Math.ceil(bottomHalfCount / 2);
        const fineCount = bottomHalfCount - penaltyCount;

        sortedPlayers.forEach((p, i) => {
            const originalRank = i + 1;
            let rankPrefix = (originalRank === 1) ? '🥇 ' : (originalRank === 2) ? '🥈 ' : (originalRank === 3) ? '🥉 ' : `${originalRank}위 `;

            const isPenaltyTier = i >= (totalCount - penaltyCount);
            const isFineTier = !isPenaltyTier && i >= (totalCount - bottomHalfCount);

            let prizePenaltyText = '';
            if (originalRank === 1 && !p.is_guest) {
                prizePenaltyText = ` [💰 +${firstPrize.toLocaleString()}원]`;
            } else if (isPenaltyTier) {
                prizePenaltyText = ` [💸 -${bottom25Penalty.toLocaleString()}원]`;
            } else if (isFineTier) {
                prizePenaltyText = ` [💸 -${bottom25Late.toLocaleString()}원]`;
            } else {
                prizePenaltyText = ` [0원]`;
            }

            text += `${rankPrefix}${p.name}${p.is_guest ? ' (G)' : ''}: ${p.wins}승 ${p.losses}패${prizePenaltyText}\n`;
        });

        text += `\n━━━━━━━━━━━━━━\n`;
        text += `※ 전체 아카이브 확인: https://teyeon-system.vercel.app/archive?session=${sessionId}`;

        navigator.clipboard.writeText(text);
        alert("최종 결과 및 정산 현황이 복사되었습니다! ✅");
    };

    function addMinutesToTime(time: string, mins: number) {
        const [h, m] = time.split(':').map(Number);
        const total = h * 60 + m + mins;
        const nh = Math.floor(total / 60) % 24;
        const nm = total % 60;
        return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
    }

    type ManualPastePreviewMatch = {
        order: number;
        group: string;
        teamA: [string, string];
        teamB: [string, string];
        time: string;
        raw: string;
        isValid: boolean;
    };

    const normalizeManualGroup = (value?: string) => {
        const normalized = (value || 'A').trim().replace(/조$/i, '').toUpperCase();
        return /^[A-Z]$/.test(normalized) ? normalized : 'A';
    };

    const getManualGroupLabel = (group?: string) => `${normalizeManualGroup(group)}조`;

    const getManualGroupFromToken = (token?: string) => {
        if (!token) return "";
        const trimmed = token.trim();
        const match = trimmed.match(/^([A-Za-z])\s*조?$/i);
        return match ? normalizeManualGroup(match[1]) : "";
    };

    const parseManualPasteMatches = (input: string): ManualPastePreviewMatch[] => {
        const rows: ManualPastePreviewMatch[] = [];
        let currentGroup = 'A';

        input
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .forEach(line => {
                const sectionGroup = getManualGroupFromToken(line);
                if (sectionGroup) {
                    currentGroup = sectionGroup;
                    return;
                }

                const columnParts = line.split(/\t+|\s{2,}/).map(part => part.trim()).filter(Boolean);

                if (columnParts.length >= 5) {
                    const firstGroup = getManualGroupFromToken(columnParts[0]);
                    const hasGroupColumn = Boolean(firstGroup) && columnParts.length >= 6;
                    const group = hasGroupColumn ? firstGroup : currentGroup;
                    const orderRaw = hasGroupColumn ? columnParts[1] : columnParts[0];
                    const playerOffset = hasGroupColumn ? 2 : 1;
                    const a1 = columnParts[playerOffset] || "";
                    const a2 = columnParts[playerOffset + 1] || "";
                    const b1 = columnParts[playerOffset + 2] || "";
                    const b2 = columnParts[playerOffset + 3] || "";
                    const timeRaw = columnParts[playerOffset + 4] || "";

                    rows.push({
                        order: Number(orderRaw) || rows.length + 1,
                        group,
                        teamA: [a1, a2],
                        teamB: [b1, b2],
                        time: timeRaw,
                        raw: line,
                        isValid: Boolean(a1 && a2 && b1 && b2),
                    });
                    return;
                }

                const timeMatch = line.match(/(\d{1,2}:\d{2})\s*$/);
                const timeToken = timeMatch ? timeMatch[0] : "";
                const time = timeMatch ? timeMatch[1] : "";
                let withoutTime = timeToken ? line.replace(timeToken, '').trim() : line;
                let group = currentGroup;

                const groupPrefixMatch = withoutTime.match(/^([A-Za-z])\s*조?\s+(?=\d)/i);
                if (groupPrefixMatch) {
                    group = normalizeManualGroup(groupPrefixMatch[1]);
                    withoutTime = withoutTime.slice(groupPrefixMatch[0].length).trim();
                }

                const orderMatch = withoutTime.match(/^(\d+)[\).\s-]*/);
                const order = orderMatch ? Number(orderMatch[1]) : rows.length + 1;
                const body = orderMatch ? withoutTime.slice(orderMatch[0].length).trim() : withoutTime;
                const vsParts = body.split(/\s+vs\s+|\s+VS\s+|\s+v\s+/i).map(part => part.trim());
                const teamA = (vsParts[0] || '').split(/[\/,]/).map(part => part.trim()).filter(Boolean);
                const teamB = (vsParts[1] || '').split(/[\/,]/).map(part => part.trim()).filter(Boolean);

                rows.push({
                    order,
                    group,
                    teamA: [teamA[0] || "", teamA[1] || ""],
                    teamB: [teamB[0] || "", teamB[1] || ""],
                    time,
                    raw: line,
                    isValid: Boolean(teamA[0] && teamA[1] && teamB[0] && teamB[1]),
                });
            });

        return rows;
    };

    const manualPastePreview = useMemo(() => parseManualPasteMatches(manualPasteText), [manualPasteText]);
    const manualGroups = useMemo(() => Array.from(new Set(manualPastePreview.map(row => row.group))).sort(), [manualPastePreview]);

    type ManualNameMatch = {
        originalName: string;
        selectedValue: string;
        memberId: string | null;
        displayName: string;
        status: 'MEMBER' | 'GUEST';
        guestKey: string;
        candidates: Member[];
    };

    const normalizeManualName = (name: string) => name.trim().replace(/\s+/g, '').toLowerCase();
    const getManualMemberName = (member: Member) => member.nickname || (member as any).name || 'Unknown';
    const isManualGuestMember = (member?: Member) => {
        const id = member?.id || "";
        return Boolean(member?.is_guest === true || (member as any)?.isGuest === true || id.startsWith('g-') || id.startsWith('manual-guest-'));
    };
    const getManualMemberCandidates = (rawName: string, memberPool: Member[] = [...allMembers, ...tempGuests]) => {
        const target = normalizeManualName(rawName);
        if (!target) return [];

        const realMembers = memberPool.filter(member => !isManualGuestMember(member));
        const guestMembers = memberPool.filter(member => isManualGuestMember(member));
        const byId = new Map<string, Member>();
        const append = (members: Member[]) => members.forEach(member => byId.set(member.id, member));
        const exact = (members: Member[]) => members.filter(member => normalizeManualName(getManualMemberName(member)) === target);
        const partial = (members: Member[]) => members.filter(member => {
            const memberName = normalizeManualName(getManualMemberName(member));
            return memberName !== target && (memberName.includes(target) || target.includes(memberName));
        });

        append(exact(realMembers));
        append(partial(realMembers));
        append(exact(guestMembers));
        append(partial(guestMembers));

        return Array.from(byId.values());
    };

    const manualPlayerNames = useMemo(() => {
        const seen = new Set<string>();
        const names: string[] = [];

        manualPastePreview.forEach(row => {
            [...row.teamA, ...row.teamB].forEach(name => {
                const trimmed = name.trim();
                const key = normalizeManualName(trimmed);
                if (!trimmed || seen.has(key)) return;
                seen.add(key);
                names.push(trimmed);
            });
        });

        return names;
    }, [manualPastePreview]);

    const manualNameMatches = useMemo<ManualNameMatch[]>(() => {
        const memberPool = [...allMembers, ...tempGuests];

        return manualPlayerNames.map(originalName => {
            const candidates = getManualMemberCandidates(originalName, memberPool);
            const override = manualNameOverrides[originalName];
            const selectedMember = override && override !== 'guest'
                ? memberPool.find(member => member.id === override)
                : candidates[0];
            const useGuest = override === 'guest' || !selectedMember || isManualGuestMember(selectedMember);
            const guestKey = `manual-guest-${normalizeManualName(originalName) || originalName}`;

            return {
                originalName,
                selectedValue: useGuest ? 'guest' : selectedMember.id,
                memberId: useGuest ? null : selectedMember.id,
                displayName: useGuest ? `${originalName}(G)` : getManualMemberName(selectedMember),
                status: useGuest ? 'GUEST' : 'MEMBER',
                guestKey,
                candidates,
            };
        });
    }, [allMembers, tempGuests, manualPlayerNames, manualNameOverrides]);

    const manualNameMatchMap = useMemo(() => {
        const map = new Map<string, ManualNameMatch>();
        manualNameMatches.forEach(match => map.set(normalizeManualName(match.originalName), match));
        return map;
    }, [manualNameMatches]);

    const getManualResolvedName = (name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return '확인 필요';
        const match = manualNameMatchMap.get(normalizeManualName(trimmed));
        return match?.displayName || trimmed;
    };

    const getManualResolvedPlayer = (name: string) => {
        const trimmed = name.trim();
        const match = manualNameMatchMap.get(normalizeManualName(trimmed));
        const forceGuest = match?.selectedValue === 'guest';
        const memberPool = [...allMembers, ...tempGuests];
        const matchedMember = !forceGuest && match?.memberId
            ? memberPool.find(member => member.id === match.memberId)
            : null;
        const fallbackMember = !forceGuest
            ? getManualMemberCandidates(trimmed, memberPool).find(member => !isManualGuestMember(member))
            : null;
        const selectedMember = matchedMember || fallbackMember || null;
        const isGuest = !selectedMember;
        const guestKey = match?.guestKey || `manual-guest-${normalizeManualName(trimmed) || trimmed}`;
        const memberName = selectedMember ? getManualMemberName(selectedMember) : "";

        return {
            id: selectedMember ? selectedMember.id : guestKey,
            name: isGuest ? (trimmed ? `${trimmed}(G)` : "이름 확인중") : memberName,
            rawName: trimmed,
            isGuest,
        };
    };


    const hasExistingKdkSession = hasRestoredSession || matches.length > 0 || allActiveSessions.length > 0 || Boolean(selectedSessionId);

    if (kdkEntryMode === 'CHECKING') {
        return (
            <main className="flex min-h-screen w-full flex-col items-center justify-center bg-black px-6 text-white font-sans">
                <PremiumSpinner />
                <p className="mt-6 text-[11px] font-black uppercase tracking-[0.28em] text-[#C9B075]/70">
                    Checking KDK Session
                </p>
            </main>
        );
    }

    if (kdkEntryMode === 'CHOOSE' && hasExistingKdkSession) {
        const sessionCount = allActiveSessions.length || (matches.length > 0 ? 1 : 0);
        const primaryTitle = selectedSessionId
            ? (allActiveSessions.find(s => s.id === selectedSessionId)?.title || sessionTitle)
            : (allActiveSessions[0]?.title || sessionTitle);

        return (
            <main className="flex min-h-screen w-full flex-col bg-black px-6 py-8 text-white font-sans">
                <header className="mx-auto flex w-full max-w-lg flex-col items-center text-center">
                    <span className="mb-3 rounded-full border border-[#C9B075]/25 bg-[#C9B075]/10 px-4 py-1 text-[10px] font-black uppercase tracking-[0.35em] text-[#C9B075]">
                        KDK Entry
                    </span>
                    <h1 className="text-3xl font-black italic uppercase tracking-tight text-white">
                        진행 중인 대진이 있습니다
                    </h1>
                    <p className="mt-3 max-w-sm text-[12px] font-bold leading-relaxed text-white/45">
                        기존 대진을 이어서 운영하거나, 새 대진 생성 화면으로 이동할 수 있습니다.
                    </p>
                </header>

                <section className="mx-auto mt-10 grid w-full max-w-lg gap-4">
                    <Link
                        href="/kdk?entry=live"
                        onClick={openExistingLiveCourt}
                        className="group block rounded-[28px] border border-[#C9B075]/35 bg-[#181818] p-6 text-left shadow-[0_18px_50px_rgba(0,0,0,0.35)] transition-all active:scale-[0.98]"
                    >
                        <div className="mb-7 flex items-center justify-between gap-4">
                            <span className="rounded-full bg-[#C9B075] px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-black">
                                Live Court
                            </span>
                            <span className="text-2xl text-[#C9B075] transition-transform group-active:translate-x-1">→</span>
                        </div>
                        <h2 className="text-2xl font-black tracking-tight text-white">기존 라이브 코트 보기</h2>
                        <p className="mt-3 text-[12px] font-bold leading-relaxed text-white/50">
                            {sessionCount > 1 ? `${sessionCount}개의 진행 중인 세션 중 선택합니다.` : `${primaryTitle || '현재 세션'}을 이어서 운영합니다.`}
                        </p>
                    </Link>

                    <Link
                        href="/kdk?entry=create"
                        onClick={startNewKdkCreation}
                        className="group block rounded-[28px] border border-white/10 bg-white/[0.04] p-6 text-left shadow-[0_18px_50px_rgba(0,0,0,0.25)] transition-all active:scale-[0.98]"
                    >
                        <div className="mb-7 flex items-center justify-between gap-4">
                            <span className="rounded-full border border-[#C9B075]/25 bg-[#C9B075]/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-[#C9B075]">
                                New Draw
                            </span>
                            <span className="text-2xl text-white/40 transition-transform group-active:translate-x-1">→</span>
                        </div>
                        <h2 className="text-2xl font-black tracking-tight text-white">새 대진 생성하기</h2>
                        <p className="mt-3 text-[12px] font-bold leading-relaxed text-white/50">
                            기존 세션은 보존하고, 자동 생성 또는 수동 구성 Step 0부터 새로 시작합니다.
                        </p>
                    </Link>
                </section>
            </main>
        );
    }

    // --- Step 0: Generation Mode Selection ---
    if (step === 0) {
        return (
            <main className="flex min-h-screen w-full flex-col bg-black px-6 py-8 text-white font-sans">
                <header className="mx-auto flex w-full max-w-lg flex-col items-center text-center">
                    <span className="mb-3 rounded-full border border-[#C9B075]/25 bg-[#C9B075]/10 px-4 py-1 text-[10px] font-black uppercase tracking-[0.35em] text-[#C9B075]">
                        KDK Setup
                    </span>
                    <h1 className="text-3xl font-black italic uppercase tracking-tight text-white">
                        생성 방식 선택
                    </h1>
                    <p className="mt-3 max-w-sm text-[12px] font-bold leading-relaxed text-white/45">
                        자동 생성과 수동 구성을 먼저 분리해서 안정적으로 대진을 준비합니다.
                    </p>
                </header>

                <section className="mx-auto mt-10 grid w-full max-w-lg gap-4">
                    <button
                        type="button"
                        onClick={() => {
                            setGenerationMode('AUTO');
                            setManualInputMode(null);
                            setStep(1);
                        }}
                        className="group rounded-[32px] border border-[#C9B075]/30 bg-[#181818] p-6 text-left shadow-[0_18px_50px_rgba(0,0,0,0.35)] transition-all active:scale-[0.98]"
                    >
                        <div className="mb-8 flex items-center justify-between">
                            <span className="rounded-full bg-[#C9B075] px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-black">
                                Default
                            </span>
                            <span className="text-2xl text-[#C9B075] transition-transform group-active:translate-x-1">→</span>
                        </div>
                        <h2 className="text-2xl font-black tracking-tight text-white">자동 생성</h2>
                        <p className="mt-3 text-[13px] font-bold leading-relaxed text-white/50">
                            참가자와 조건을 선택하면 앱이 기존 KDK 로직으로 대진을 자동 생성합니다.
                        </p>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            setGenerationMode('MANUAL');
                            commitTotalCourts(4);
                            setManualInputMode(null);
                            setManualStep('INPUT');
                            setStep(1);
                        }}
                        className="group rounded-[32px] border border-white/10 bg-white/[0.04] p-6 text-left shadow-[0_18px_50px_rgba(0,0,0,0.25)] transition-all active:scale-[0.98]"
                    >
                        <div className="mb-8 flex items-center justify-between">
                            <span className="rounded-full border border-[#C9B075]/25 bg-[#C9B075]/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-[#C9B075]">
                                Manual
                            </span>
                            <span className="text-2xl text-white/40 transition-transform group-active:translate-x-1">→</span>
                        </div>
                        <h2 className="text-2xl font-black tracking-tight text-white">수동 구성</h2>
                        <p className="mt-3 text-[13px] font-bold leading-relaxed text-white/50">
                            직접 만든 대진, 엑셀/텍스트 붙여넣기, 캡처 인식 방식으로 대진을 구성합니다.
                        </p>
                    </button>
                </section>
            </main>
        );
    }

    // --- Manual Configuration Flow ---
    if (step === 1 && generationMode === 'MANUAL') {
        const manualPasteMatchCount = manualPastePreview.length;
        const canProceedToNameMatching = manualInputMode === 'PASTE' && manualStep === 'INPUT' && manualPasteMatchCount > 0;

        return (
            <main className="flex min-h-screen w-full flex-col overflow-y-auto bg-black px-6 py-6 text-white font-sans" style={{ paddingBottom: 'calc(180px + env(safe-area-inset-bottom))' }}>
                <header className="grid h-12 grid-cols-3 items-center">
                    <div className="flex items-center">
                        <button
                            type="button"
                            onClick={() => {
                                if (manualInputMode) {
                                    if (manualStep !== 'INPUT') {
                                        setManualStep('INPUT');
                                    } else {
                                        setManualInputMode(null);
                                    }
                                } else {
                                    setGenerationMode(null);
                                    setManualStep('INPUT');
                                    setStep(0);
                                }
                            }}
                            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#C9B075]/30 bg-[#C9B075]/10 text-[#C9B075] transition-all active:scale-95"
                        >
                            ←
                        </button>
                    </div>
                    <div className="flex flex-col items-center text-center">
                        <span className="mb-1 inline-block rounded-full border border-[#C9B075]/20 bg-[#C9B075]/10 px-3 py-1 text-[10px] font-black uppercase leading-none tracking-[0.4em] text-[#C9B075]">
                            Manual
                        </span>
                        <h1 className="whitespace-nowrap text-2xl font-black italic uppercase leading-none tracking-tight text-white">
                            수동 구성
                        </h1>
                    </div>
                    <div />
                </header>

                <section className="mx-auto mt-8 w-full max-w-lg space-y-4 pb-40">
                    {!manualInputMode && (
                        <>
                            <button
                                type="button"
                                onClick={() => {
                                    setManualInputMode('PASTE');
                                    setManualStep('INPUT');
                                }}
                                className="w-full rounded-[24px] border border-[#C9B075]/35 bg-[#171717] p-5 text-left shadow-[0_18px_45px_rgba(0,0,0,0.3)] transition-all active:scale-[0.98]"
                            >
                                <div className="mb-6 flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase tracking-[0.24em] text-[#C9B075]">Preview Ready</span>
                                    <span className="rounded-full bg-[#C9B075] px-3 py-1 text-[10px] font-black text-black">1차</span>
                                </div>
                                <h2 className="text-xl font-black text-white">대진 붙여넣기</h2>
                                <p className="mt-2 text-[12px] font-bold leading-relaxed text-white/45">
                                    엑셀, 카톡, 메모장 텍스트를 붙여넣어 경기 순서와 팀 구성을 미리 확인합니다.
                                </p>
                            </button>

                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setManualInputMode('DIRECT');
                                        setManualStep('INPUT');
                                    }}
                                    className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4 text-left transition-all active:scale-[0.98]"
                                >
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30">Coming Soon</span>
                                    <h3 className="mt-4 text-base font-black text-white">직접 만들기</h3>
                                    <p className="mt-2 text-[11px] font-bold leading-relaxed text-white/35">경기별 팀 직접 구성</p>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setManualInputMode('OCR');
                                        setManualStep('INPUT');
                                    }}
                                    className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4 text-left transition-all active:scale-[0.98]"
                                >
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30">Coming Soon</span>
                                    <h3 className="mt-4 text-base font-black text-white">캡처 인식</h3>
                                    <p className="mt-2 text-[11px] font-bold leading-relaxed text-white/35">이미지/OCR 기반 인식</p>
                                </button>
                            </div>
                        </>
                    )}

                    {manualInputMode === 'PASTE' && manualStep === 'INPUT' && (
                        <div className="space-y-4">
                            <div className="overflow-visible rounded-[24px] border border-[#C9B075]/20 bg-[#141414] p-5">
                                <div className="mb-4">
                                    <span className="text-[10px] font-black uppercase tracking-[0.24em] text-[#C9B075]/80">Paste Matches</span>
                                    <h2 className="mt-1 text-xl font-black text-white">대진 붙여넣기</h2>
                                </div>
                                <div className="mb-4 rounded-[16px] border border-[#C9B075]/20 bg-black/30 p-3">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#C9B075]">입력 예시</span>
                                        <span className="text-[9px] font-bold text-white/35">탭 구분 텍스트 지원</span>
                                    </div>
                                     <pre className="whitespace-pre-wrap break-keep text-[11px] font-bold leading-relaxed text-white/55">
{`A조
1 봉준/상윤 vs 영호/광현 19:00
B조
1 민준/상준 vs 강정호/구봉준 20:00
A    1    봉준    상윤    영호    광현    19:00`}
                                     </pre>
                                    <p className="mt-2 text-[10px] font-bold text-white/35">
                                        조 표기가 없으면 A조로 인식됩니다.
                                    </p>
                                 </div>
                                <textarea
                                    value={manualPasteText}
                                    onChange={(e) => {
                                        setManualPasteText(e.target.value);
                                        setManualNameOverrides({});
                                    }}
                                    className="min-h-[160px] w-full resize-y rounded-[18px] border border-white/10 bg-black/35 px-4 py-4 text-[13px] font-bold leading-relaxed text-white outline-none transition-all placeholder:text-white/25 focus:border-[#C9B075]/50"
                                    placeholder={"예: 1 봉준/상윤 vs 영호/광현 19:00"}
                                />
                            </div>

                            <div className="overflow-visible rounded-[24px] border border-white/10 bg-[#111111] p-4">
                                <div className="mb-3 flex items-center justify-between gap-3 px-1">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Preview</span>
                                    <span className="text-[10px] font-black text-[#C9B075]">
                                        {manualPasteMatchCount} matches · {manualPlayerNames.length} names · {manualGroups.length || 0} groups
                                    </span>
                                </div>

                                {manualPasteMatchCount === 0 ? (
                                    <div className="rounded-[18px] border border-dashed border-white/10 py-8 text-center text-[12px] font-bold text-white/35">
                                        대진을 붙여넣으면 경기 미리보기가 표시됩니다.
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {manualPastePreview.map((row, index) => (
                                            <div
                                                key={`${row.raw}-${index}`}
                                                className={`overflow-visible rounded-[16px] border px-3 py-3 ${row.isValid ? 'border-white/10 bg-white/[0.04]' : 'border-red-500/30 bg-red-500/10'}`}
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="flex min-w-[52px] shrink-0 items-center justify-center rounded-full bg-[#C9B075] px-2.5 py-1.5 text-[10px] font-black text-black">
                                                        {getManualGroupLabel(row.group)} · {row.order}
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[12px] font-black text-white">
                                                            <span className="truncate text-right">{row.teamA.filter(Boolean).join(' / ') || '확인 필요'}</span>
                                                            <span className="rounded-full border border-[#C9B075]/35 px-2 py-0.5 text-[9px] font-black text-[#C9B075]">VS</span>
                                                            <span className="truncate">{row.teamB.filter(Boolean).join(' / ') || '확인 필요'}</span>
                                                        </div>
                                                        {!row.isValid && (
                                                            <p className="mt-1 text-center text-[10px] font-bold text-red-300">
                                                                형식을 확인해 주세요.
                                                            </p>
                                                        )}
                                                    </div>
                                                    <span className="shrink-0 text-[10px] font-black text-white/40">{row.time || '--:--'}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="mt-4 border-t border-white/10 pt-4">
                                    <button
                                        type="button"
                                        disabled={!canProceedToNameMatching}
                                        onClick={() => setManualStep('MATCH_NAMES')}
                                        className="flex min-h-[54px] w-full items-center justify-center rounded-[18px] px-5 text-[14px] font-black uppercase tracking-[0.12em] transition-all active:scale-[0.98] disabled:cursor-not-allowed"
                                        style={{
                                            background: canProceedToNameMatching
                                                ? 'linear-gradient(135deg, #f7d77a 0%, #d6b85c 52%, #b89432 100%)'
                                                : 'rgba(255,255,255,0.08)',
                                            color: canProceedToNameMatching ? '#050505' : 'rgba(255,255,255,0.38)',
                                            border: canProceedToNameMatching
                                                ? '1px solid rgba(255,232,150,0.9)'
                                                : '1px solid rgba(255,255,255,0.16)',
                                            boxShadow: canProceedToNameMatching
                                                ? '0 0 24px rgba(247,215,122,0.38), 0 14px 34px rgba(0,0,0,0.35)'
                                                : 'none',
                                            WebkitTextFillColor: canProceedToNameMatching ? '#050505' : 'rgba(255,255,255,0.38)',
                                        }}
                                    >
                                        다음: 이름 매칭
                                    </button>
                                    {!canProceedToNameMatching && (
                                        <p className="mt-2 text-center text-[10px] font-bold text-white/35">
                                            대진을 1개 이상 붙여넣으면 이름 매칭으로 이동할 수 있습니다.
                                        </p>
                                    )}
                                </div>
                            </div>

                            <p className="px-1 text-[10px] font-bold leading-relaxed text-white/35">
                                다음 단계에서 이름을 멤버/게스트와 매칭합니다. 아직 저장은 하지 않습니다.
                            </p>
                        </div>
                    )}

                    {manualInputMode === 'PASTE' && manualStep === 'MATCH_NAMES' && (
                        <div className="space-y-4">
                            <button
                                type="button"
                                onClick={() => setManualStep('INPUT')}
                                className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] font-black text-white/55 transition-all active:scale-95"
                            >
                                ← 붙여넣기로 돌아가기
                            </button>

                            <div className="overflow-visible rounded-[24px] border border-[#C9B075]/20 bg-[#141414] p-5">
                                <div className="mb-4 flex items-start justify-between gap-3">
                                    <div>
                                        <span className="text-[10px] font-black uppercase tracking-[0.24em] text-[#C9B075]/80">Name Matching</span>
                                        <h2 className="mt-1 text-xl font-black text-white">이름 매칭</h2>
                                        <p className="mt-2 text-[11px] font-bold leading-relaxed text-white/45">
                                            붙여넣은 이름을 멤버 또는 게스트와 연결합니다.
                                        </p>
                                    </div>
                                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-black text-white/45">
                                        {manualPlayerNames.length} names
                                    </span>
                                </div>

                                <div className="space-y-2">
                                    {manualNameMatches.map(match => (
                                        <div key={match.originalName} className="overflow-visible rounded-[16px] border border-white/10 bg-black/25 p-3">
                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-white/25">Original</span>
                                                    <span className="block truncate text-sm font-black text-white">{match.originalName}</span>
                                                </div>
                                                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${match.status === 'MEMBER' ? 'bg-[#C9B075] text-black' : 'bg-white/10 text-white/55'}`}>
                                                    {match.status}
                                                </span>
                                            </div>
                                            <select
                                                value={match.selectedValue}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setManualNameOverrides(prev => ({ ...prev, [match.originalName]: value }));
                                                }}
                                                className="w-full rounded-[14px] border border-white/10 bg-[#0A0A0A] px-3 py-3 text-[12px] font-black text-white outline-none focus:border-[#C9B075]/50"
                                            >
                                                {match.candidates.map(candidate => (
                                                    <option key={candidate.id} value={candidate.id} className="bg-[#111111] text-white">
                                                        {getManualMemberName(candidate)} / 멤버
                                                    </option>
                                                ))}
                                                <option value="guest" className="bg-[#111111] text-white">
                                                    {match.originalName}(G) / 게스트로 사용
                                                </option>
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="overflow-visible rounded-[24px] border border-white/10 bg-[#111111] p-4">
                                <div className="mb-3 flex items-center justify-between gap-3 px-1">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Matched Preview</span>
                                    <span className="text-[10px] font-black text-[#C9B075]">{manualPastePreview.length} matches · {manualGroups.length || 0} groups</span>
                                </div>
                                <div className="space-y-2">
                                    {manualPastePreview.map((row, index) => (
                                        <div key={`${row.raw}-matched-${index}`} className="overflow-visible rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="flex min-w-[52px] shrink-0 items-center justify-center rounded-full bg-[#C9B075] px-2.5 py-1.5 text-[10px] font-black text-black">
                                                    {getManualGroupLabel(row.group)} · {row.order}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[12px] font-black text-white">
                                                        <span className="truncate text-right">{row.teamA.map(getManualResolvedName).join(' / ')}</span>
                                                        <span className="rounded-full border border-[#C9B075]/35 px-2 py-0.5 text-[9px] font-black text-[#C9B075]">VS</span>
                                                        <span className="truncate">{row.teamB.map(getManualResolvedName).join(' / ')}</span>
                                                    </div>
                                                </div>
                                                <span className="shrink-0 text-[10px] font-black text-white/40">{row.time || '--:--'}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => {
                                    commitTotalCourts(4);
                                    setManualStep('RULES');
                                    setStep(2);
                                }}
                                className="flex min-h-[54px] w-full items-center justify-center rounded-[18px] px-5 text-[14px] font-black uppercase tracking-[0.12em] transition-all active:scale-[0.98]"
                                style={{
                                    background: 'linear-gradient(135deg, #f7d77a 0%, #d6b85c 52%, #b89432 100%)',
                                    color: '#050505',
                                    border: '1px solid rgba(255,232,150,0.9)',
                                    boxShadow: '0 0 24px rgba(247,215,122,0.38), 0 14px 34px rgba(0,0,0,0.35)',
                                    WebkitTextFillColor: '#050505',
                                }}
                            >
                                다음: 룰 설정
                            </button>
                        </div>
                    )}

                    {manualInputMode === 'PASTE' && manualStep === 'RULES' && (
                        <div className="rounded-[24px] border border-[#C9B075]/20 bg-[#141414] px-5 py-8 text-center">
                            <p className="text-lg font-black text-white">룰 설정은 다음 단계에서 연결됩니다.</p>
                            <p className="mt-3 text-[12px] font-bold leading-relaxed text-white/40">
                                이번 작업에서는 이름 매칭과 매칭 적용 미리보기까지만 저장 없이 준비했습니다.
                            </p>
                            <button
                                type="button"
                                onClick={() => setManualStep('MATCH_NAMES')}
                                className="mt-6 rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-[11px] font-black text-white/60 transition-all active:scale-95"
                            >
                                이름 매칭으로 돌아가기
                            </button>
                        </div>
                    )}

                    {manualInputMode === 'DIRECT' && (
                        <div className="rounded-[30px] border border-white/10 bg-white/[0.04] px-5 py-8 text-center">
                            <p className="text-lg font-black text-white">직접 만들기 준비 중</p>
                            <p className="mt-3 text-[12px] font-bold leading-relaxed text-white/40">
                                추후 참가자를 선택하고 경기별 팀을 직접 구성하는 방식으로 확장합니다.
                            </p>
                        </div>
                    )}

                    {manualInputMode === 'OCR' && (
                        <div className="rounded-[30px] border border-white/10 bg-white/[0.04] px-5 py-8 text-center">
                            <p className="text-lg font-black text-white">캡처 인식 Coming Soon</p>
                            <p className="mt-3 text-[12px] font-bold leading-relaxed text-white/40">
                                이미지/OCR 기반 대진 인식은 안정화 이후 별도 단계로 검토합니다.
                            </p>
                        </div>
                    )}
                </section>
            </main>
        );
    }

    // --- Step 1: Attendee Selection (Refactored to MemberSelector) ---
    if (step === 1) {
        return (
            <MemberSelector
                allMembers={allMembers}
                tempGuests={tempGuests}
                selectedIds={selectedIds}
                isMembersLoading={isMembersLoading}
                isMembersError={isMembersError}
                onToggle={toggleMember}
                onAddGuest={(name) => {
                    const guest: Member = { id: `g-${Date.now()}`, nickname: name, is_guest: true };
                    setTempGuests(prev => [...prev, guest]);
                    const next = new Set(selectedIds);
                    next.add(guest.id);
                    setSelectedIds(next);
                }}
                onFetchMembers={fetchMembers}
                onConfirm={handleStep1Confirm}
                onReset={() => setShowResetConfirm(true)}
                onBack={() => {
                    setGenerationMode(null);
                    setStep(0);
                }}
                onRestore={(data) => {
                    setMatches(data.matches || []);
                    setAttendeeConfigs(data.attendeeConfigs || {});
                    setSelectedIds(new Set(data.selectedIds || []));
                    setTempGuests(data.tempGuests || []);
                    setStep(data.step || 1);
                    setGenerationMode(data.generationMode || 'AUTO');
                    setManualInputMode(data.manualInputMode || null);
                    setSessionTitle(data.sessionTitle || "");
                    if (data.settings?.finance) {
                        setFirstPrize(data.settings.finance.firstPrize);
                        setBottom25Late(data.settings.finance.bottom25Late);
                        setBottom25Penalty(data.settings.finance.bottom25Penalty);
                        setAccountInfo(data.settings.finance.accountInfo);
                    }
                }}
            />
        );
    }

    // --- Step 2: Settings Dashboard ---
    if (step === 2) {
        const isManualRulesMode = generationMode === 'MANUAL';
        const attendees = Array.from(selectedIds).map(id => {
            const m = [...allMembers, ...tempGuests].find(x => x.id === id);
            return { id, name: m?.nickname || 'Unknown', is_guest: !!m?.is_guest };
        });
        const manualMatchedRows = manualPastePreview.map(row => ({
            ...row,
            teamAResolved: row.teamA.map(getManualResolvedName),
            teamBResolved: row.teamB.map(getManualResolvedName),
        }));
        const manualMatchedGroups = manualGroups.map(group => ({
            group,
            rows: manualMatchedRows.filter(row => row.group === group),
        }));
        const isStep2ButtonDisabled = isGenerating;
        const timeOptions = ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"];
        const availablePlayersForPartnering = [...allMembers, ...tempGuests].filter(m => 
            selectedIds.has(m.id) && (partnerSelectSource === 'NEW' ? true : m.id !== partnerSelectSource)
        );

        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative pb-60" style={{ paddingBottom: 'calc(220px + env(safe-area-inset-bottom))' }}>

                <header className="grid grid-cols-3 px-6 mb-4 items-center h-12 shrink-0">
                    <div className="flex items-center">
                        <button
                            onClick={() => {
                                if (isManualRulesMode) {
                                    setManualStep('MATCH_NAMES');
                                }
                                setStep(1);
                            }}
                            className="w-10 h-10 rounded-full flex items-center justify-center border border-[#C9B075]/30 bg-[#C9B075]/10 hover:bg-[#C9B075]/20 active:scale-95 transition-all text-[#C9B075] shadow-[0_0_15px_rgba(201,176,117,0.1)]"
                        >
                            <span className="text-xl leading-none -mt-0.5">←</span>
                        </button>
                    </div>

                    <div className="text-center flex flex-col items-center gap-2">
                        <div className="flex flex-col items-center">
                            <span className="text-[10px] font-black text-[#C9B075] tracking-[0.5em] uppercase px-3 py-1 bg-[#C9B075]/10 rounded-full border border-[#C9B075]/20 mb-1 inline-block leading-none scale-90">Step 02</span>
                            <h1 className="text-3xl font-black italic tracking-tighter uppercase whitespace-nowrap text-white leading-none">경기 대진 설정</h1>
                        </div>
                        {isAdmin && (
                            <div className="flex items-center gap-1.5 px-3 py-1 bg-[#C9B075] rounded-full shadow-[0_5px_15px_rgba(201,176,117,0.3)] animate-in fade-in zoom-in duration-500">
                                <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                                <span className="text-[9px] font-black text-black uppercase tracking-widest leading-none">CEO MODE</span>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end">
                        <button
                            onClick={() => {
                                if (!isAdmin) return triggerAccessDenied();
                                setShowResetConfirm(true);
                            }}
                            className="h-9 px-3 rounded-full bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-500/80 hover:bg-red-500/20 transition-all active:scale-95 group"
                            title="전체 데이터 초기화"
                        >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="group-hover:rotate-180 transition-transform duration-500"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                            <span className="text-[9px] font-black uppercase tracking-tighter">초기화</span>
                        </button>
                    </div>
                </header>

                <div className="px-6 space-y-12 max-w-lg mx-auto w-full">

                    <section className="space-y-4">
                        <div className="flex items-center gap-3 px-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#C9B075]" />
                            <h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.2em]">Archive Title</h3>
                        </div>
                        <input
                            type="text"
                            value={sessionTitle}
                            onChange={(e) => setSessionTitle(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-[24px] px-6 py-5 text-sm font-black text-white focus:border-[#C9B075]/50 focus:bg-white/[0.08] transition-all outline-none"
                            placeholder="Ex: 2026-03-27 테연 정기전"
                        />
                    </section>

                    {!isManualRulesMode ? (
                    <section style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '40px', padding: '32px', marginBottom: '12px' }}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-[13px] font-bold text-[#C9B075] tracking-[0.3em] uppercase flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-[#C9B075]" />
                                ATTENDEE MATRIX
                            </h3>
                            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">{attendees.length} ACTIVE</span>
                        </div>
                        <div className="space-y-2 no-scrollbar" style={{ maxHeight: '480px', overflowY: 'auto' }}>
                            {attendees.map(m => {
                                const config = attendeeConfigs[m.id] || { id: m.id, name: m.name, startTime: "19:00", endTime: "22:00", group: "A" };
                                return (
                                    <div key={m.id} style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '20px', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>

                                        <span style={{ fontSize: '14px', fontWeight: 900, color: 'rgba(255,255,255,0.9)' }}>
                                            {m.name}{m.is_guest ? ' (G)' : ''}
                                        </span>

                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <button
                                                    onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, isLate: !config.isLate } }))}
                                                    style={{ width: '32px', height: '32px', borderRadius: '10px', border: config.isLate ? '1px solid #f97316' : '1px solid rgba(255,255,255,0.1)', background: config.isLate ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '16px' }}
                                                >🕒</button>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#0A0A0A', borderRadius: '12px', padding: '4px 8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                                                    <select value={config.startTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, startTime: e.target.value } }))} style={{ background: 'transparent', color: '#ffffff', fontSize: '13px', fontWeight: 700, outline: 'none', appearance: 'none', textAlign: 'center', width: '46px', cursor: 'pointer' }}>
                                                        {timeOptions.map(t => <option key={t} value={t} style={{ background: '#1C1C28' }}>{t}</option>)}
                                                    </select>
                                                    <span style={{ color: '#6B7280', fontSize: '10px', fontWeight: 700 }}>TO</span>
                                                    <select value={config.endTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, endTime: e.target.value } }))} style={{ background: 'transparent', color: '#ffffff', fontSize: '13px', fontWeight: 700, outline: 'none', appearance: 'none', textAlign: 'center', width: '46px', cursor: 'pointer' }}>
                                                        {timeOptions.map(t => <option key={t} value={t} style={{ background: '#1C1C28' }}>{t}</option>)}
                                                    </select>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button
                                                    onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'A' } }))}
                                                    style={{ width: '40px', height: '40px', borderRadius: '12px', background: config.group === 'A' ? '#C9B075' : '#0A0A0A', color: config.group === 'A' ? '#000' : '#fff', border: config.group === 'A' ? 'none' : '1px solid #555', fontWeight: 900, fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s' }}
                                                >A</button>
                                                <button
                                                    onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'B' } }))}
                                                    style={{ width: '40px', height: '40px', borderRadius: '12px', background: config.group === 'B' ? '#C9B075' : '#0A0A0A', color: config.group === 'B' ? '#000' : '#fff', border: config.group === 'B' ? 'none' : '1px solid #555', fontWeight: 900, fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s' }}
                                                >B</button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                    ) : (
                    <section style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '40px', padding: '32px', marginBottom: '12px', overflow: 'visible' }}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-[13px] font-bold text-[#C9B075] tracking-[0.3em] uppercase flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-[#C9B075]" />
                                MANUAL MATCH SUMMARY
                            </h3>
                            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">{manualMatchedRows.length} MATCHES</span>
                        </div>
                        <div className="mt-4 space-y-4">
                            {manualMatchedGroups.map(({ group, rows }) => (
                                <div key={`manual-rules-group-${group}`} className="space-y-2">
                                    <div className="flex items-center gap-2 px-1">
                                        <span className="rounded-full border border-[#C9B075]/35 bg-[#C9B075]/10 px-3 py-1 text-[10px] font-black text-[#C9B075]">
                                            {getManualGroupLabel(group)}
                                        </span>
                                        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/25">
                                            {rows.length} matches
                                        </span>
                                    </div>
                                    {rows.map((row, index) => (
                                        <div key={`${row.raw}-rules-${group}-${index}`} style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '20px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <span style={{ width: '28px', height: '28px', borderRadius: '999px', background: '#C9B075', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 1000, flexShrink: 0 }}>{row.order}</span>
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[12px] font-black text-white">
                                                    <span className="truncate text-right">{row.teamAResolved.join(' / ')}</span>
                                                    <span className="rounded-full border border-[#C9B075]/35 px-2 py-0.5 text-[9px] font-black text-[#C9B075]">VS</span>
                                                    <span className="truncate">{row.teamBResolved.join(' / ')}</span>
                                                </div>
                                            </div>
                                            <span style={{ fontSize: '10px', fontWeight: 900, color: 'rgba(255,255,255,0.35)', flexShrink: 0 }}>{row.time || '--:--'}</span>
                                        </div>
                                    ))}
                                </div>
                            ))}
                            <div style={{ borderRadius: '18px', border: '1px solid rgba(201,176,117,0.18)', background: 'rgba(201,176,117,0.06)', padding: '12px 14px' }}>
                                <p className="text-[11px] font-bold leading-relaxed text-white/45">
                                    수동 구성은 승리 점수 6점 고정, 1:1 시작을 기본 전제로 사용합니다.
                                </p>
                            </div>
                        </div>
                    </section>
                    )}


                    {!isManualRulesMode && (
                    <section style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '40px', padding: '32px', marginBottom: '12px' }}>
                        <div className="space-y-6">
                            <h4 className="text-[13px] font-bold text-[#C9B075] uppercase tracking-[0.3em] flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-[#C9B075]" />
                                CORE STRATEGY
                            </h4>
                            <div className="grid grid-cols-2 gap-4" style={{ marginTop: '20px' }}>
                                {(['RANDOM', 'AGE', 'AWARD', 'MBTI'] as const).map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => setGenMode(mode)}
                                        style={{
                                            background: '#141414',
                                            border: genMode === mode ? '1px solid #C9B075' : '1px solid #2A2A2A',
                                            color: genMode === mode ? '#C9B075' : '#6B7280',
                                            transform: genMode === mode ? 'scale(1.03)' : 'scale(1)',
                                            borderRadius: '24px',
                                            padding: '24px 8px',
                                            fontSize: '14px',
                                            fontWeight: 1000,
                                            cursor: 'pointer',
                                            transition: 'all 0.15s'
                                        }}
                                    >
                                        {mode === 'RANDOM' ? 'RANDOM' : mode === 'AGE' ? 'YB/OB' : mode === 'AWARD' ? '입상/비입상' : 'MBTI'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-6 mt-10">
                            <div className="flex items-center justify-between">
                                <h4 className="text-[13px] font-bold text-[#C9B075] uppercase tracking-[0.3em] flex items-center gap-3">
                                    <span className="w-2 h-2 rounded-full bg-[#C9B075]" />
                                    FIXED PARTNERS
                                </h4>
                                <button
                                    onClick={() => setFixedTeamMode(!fixedTeamMode)}
                                    style={{
                                        padding: '6px 14px',
                                        borderRadius: '99px',
                                        fontSize: '12px',
                                        fontWeight: 800,
                                        border: fixedTeamMode ? '1px solid #C9B075' : '1px solid rgba(255,255,255,0.3)',
                                        background: fixedTeamMode ? '#C9B075' : 'transparent',
                                        color: fixedTeamMode ? '#000' : 'rgba(255,255,255,0.7)',
                                        cursor: 'pointer',
                                        letterSpacing: '0.05em',
                                        textTransform: 'uppercase'
                                    }}
                                >
                                    {fixedTeamMode ? 'TEAM MODE' : 'ROUND 1 ONLY'}
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
                                {fixedPartners.map((pair, idx) => (
                                    <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#141414', padding: '20px 24px', borderRadius: '24px', border: '1px solid #2A2A2A' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: '15px', fontWeight: 1000, color: '#FFFFFF' }}>
                                            <span>{getPlayerName(pair[0])}</span>
                                            <span style={{ color: '#C9B075', fontSize: '18px' }}>♥</span>
                                            <span>{getPlayerName(pair[1])}</span>
                                        </div>
                                        <button onClick={() => setFixedPartners(prev => prev.filter((_, i) => i !== idx))} className="w-10 h-10 rounded-full bg-[#1C1C1C] flex items-center justify-center text-red-500/50 hover:bg-red-500/20 hover:text-red-500 transition-all text-2xl leading-none">×</button>
                                    </div>
                                ))}
                                <button
                                    onClick={() => setPartnerSelectSource('NEW')}
                                    style={{
                                        width: '100%', padding: '14px 0',
                                        border: '1px dashed #555',
                                        borderRadius: '20px',
                                        fontSize: '13px',
                                        fontWeight: 900,
                                        color: '#A0A0A0',
                                        background: '#141414',
                                        cursor: 'pointer',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.1em',
                                        transition: 'all 0.15s'
                                    }}
                                >
                                    + ADD FIXED PARTNER
                                </button>
                            </div>
                        </div>
                    </section>
                    )}


                    <section style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '40px', padding: '28px 24px', marginTop: '12px', overflow: 'visible' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <h4 style={{ fontSize: '13px', fontWeight: 900, color: '#C9B075', textTransform: 'uppercase', letterSpacing: '0.3em', display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#C9B075', flexShrink: 0, display: 'inline-block' }} />
                                CONSTRAINTS
                            </h4>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#141414', padding: '0 20px', height: '80px', borderRadius: '20px', border: '1px solid #222' }}>
                                <span style={{ fontSize: '13px', fontWeight: 800, color: '#D1D5DB', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Courts</span>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '170px', height: '40px' }}>
                                    <button type="button" onClick={() => commitTotalCourts(totalCourts - 1)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
                                    <input
                                        aria-label="Total Courts"
                                        inputMode="numeric"
                                        max={99}
                                        min={1}
                                        onBlur={handleTotalCourtsInputBlur}
                                        onChange={(event) => handleTotalCourtsInputChange(event.target.value)}
                                        pattern="[0-9]*"
                                        type="text"
                                        value={totalCourtsInput}
                                        style={{
                                            width: '70px',
                                            height: '40px',
                                            borderRadius: '12px',
                                            border: '1px solid rgba(201,176,117,0.28)',
                                            background: 'rgba(0,0,0,0.28)',
                                            color: '#C9B075',
                                            fontSize: '28px',
                                            fontWeight: 900,
                                            textAlign: 'center',
                                            outline: 'none',
                                            flex: 'none',
                                            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)'
                                        }}
                                    />
                                    <button type="button" onClick={() => commitTotalCourts(totalCourts + 1)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#141414', padding: '0 20px', height: '80px', borderRadius: '20px', border: '1px solid #222' }}>
                                <span style={{ fontSize: '13px', fontWeight: 800, color: '#D1D5DB', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Match Mins</span>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '160px', height: '40px' }}>
                                    <button onClick={() => setMatchTime(Math.max(30, matchTime - 30))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
                                    <span style={{ fontSize: '28px', fontWeight: 900, color: '#C9B075', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', flex: 'none' }}>{matchTime}</span>
                                    <button onClick={() => setMatchTime(matchTime + 30)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '24px' }}>
                            <h4 style={{ fontSize: '13px', fontWeight: 900, color: '#4ADE80', textTransform: 'uppercase', letterSpacing: '0.3em', display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ADE80', flexShrink: 0, display: 'inline-block' }} />
                                FINANCIALS
                            </h4>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#141414', padding: '0 20px', height: '80px', borderRadius: '20px', border: '1px solid #222' }}>
                                <span style={{ fontSize: '13px', fontWeight: 800, color: '#D1D5DB', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prize Gold</span>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '160px', height: '40px' }}>
                                    <button onClick={() => setFirstPrize(Math.max(0, firstPrize - 5000))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
                                    <span style={{ fontSize: '28px', fontWeight: 900, color: '#ffffff', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', flex: 'none' }}>{(firstPrize / 1000).toFixed(0)}k</span>
                                    <button onClick={() => setFirstPrize(firstPrize + 5000)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#141414', padding: '0 20px', height: '80px', borderRadius: '20px', border: '1px solid #222' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#FACC15', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tier 1 Fine</span>
                                    <span style={{ fontSize: '10px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Bottom 25%~50%</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '160px', height: '40px' }}>
                                    <button onClick={() => setBottom25Late(Math.max(0, bottom25Late - 1000))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
                                    <span style={{ fontSize: '28px', fontWeight: 900, color: '#ffffff', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', flex: 'none' }}>{(bottom25Late / 1000).toFixed(0)}k</span>
                                    <button onClick={() => setBottom25Late(bottom25Late + 1000)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#141414', padding: '0 20px', height: '80px', borderRadius: '20px', border: '1px solid #222' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tier 2 Fine</span>
                                    <span style={{ fontSize: '10px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Bottom 0%~25%</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '160px', height: '40px' }}>
                                    <button onClick={() => setBottom25Penalty(Math.max(0, bottom25Penalty - 1000))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
                                    <span style={{ fontSize: '28px', fontWeight: 900, color: '#ffffff', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', flex: 'none' }}>{(bottom25Penalty / 1000).toFixed(0)}k</span>
                                    <button onClick={() => setBottom25Penalty(bottom25Penalty + 1000)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>
                        </div>


                        <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid #333' }}>
                            <h4 style={{ fontSize: '13px', fontWeight: 900, color: '#C9B075', textTransform: 'uppercase', letterSpacing: '0.3em', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#C9B075', flexShrink: 0, display: 'inline-block' }} />
                                TOURNAMENT RULES
                            </h4>
                            <textarea
                                value={matchRules}
                                onChange={(e) => setMatchRules(e.target.value)}
                                style={{ width: '100%', background: '#141414', border: '1px solid #333', borderRadius: '16px', padding: '16px', fontSize: '14px', fontWeight: 600, color: '#E5E7EB', minHeight: '120px', outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.6 }}
                                placeholder="토너먼트 규칙을 입력하세요..."
                            />
                        </div>
                    </section>



                </div>



                {isAdmin && (
                    <div style={{ position: 'fixed', bottom: '120px', left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '450px', padding: '0 20px', zIndex: 9999, pointerEvents: 'none', boxSizing: 'border-box' }}>
                        <div style={{ width: '100%', margin: '0 auto', pointerEvents: 'auto' }}>
                            <button
                                disabled={isStep2ButtonDisabled}
                                onClick={() => {
                                    if (isManualRulesMode) {
                                        saveManualKDKMatches();
                                        return;
                                    }
                                    generateKDK();
                                }}
                                style={{
                                    width: '100%',
                                    padding: '8px 0',
                                    borderRadius: '999px',
                                    background: isStep2ButtonDisabled ? '#1A1A1A' : '#C9B075',
                                    color: '#000000',
                                    border: '1px solid rgba(255, 255, 255, 0.4)',
                                    fontSize: '14px',
                                    fontWeight: 1000,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    cursor: isStep2ButtonDisabled ? 'not-allowed' : 'pointer',
                                    WebkitTextFillColor: '#000000',
                                    transition: 'all 0.15s',
                                    boxShadow: '0 10px 30px rgba(201,176,117,0.4)',
                                }}
                            >
                                {isManualRulesMode ? (isGenerating ? '생성 중...' : '붙여넣은 대진으로 생성') : isGenerating ? 'GENERATE...' : '최종 대진 자동 생성! 🚀'}
                            </button>
                        </div>
                    </div>
                )}


                {!isManualRulesMode && partnerSelectSource && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
                        <div style={{ background: '#1C1C1C', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '32px', width: '100%', maxWidth: '400px', padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                                <div>
                                    <div style={{ fontSize: '11px', fontWeight: 900, color: '#C9B075', letterSpacing: '0.4em', textTransform: 'uppercase', marginBottom: '6px' }}>Strategy</div>
                                    <h3 style={{ fontSize: '22px', fontWeight: 900, color: '#ffffff', margin: 0, letterSpacing: '-0.02em' }}>SELECT PARTNER</h3>
                                </div>
                                <button onClick={() => setPartnerSelectSource(null)} style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>×</button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '360px', overflowY: 'auto' }}>
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
                                            style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                padding: '16px 20px',
                                                borderRadius: '16px',
                                                background: isSelected ? '#C9B075' : '#252525',
                                                border: isSelected ? 'none' : '1px solid rgba(255,255,255,0.08)',
                                                color: isSelected ? '#000' : '#fff',
                                                fontSize: '16px', fontWeight: 800,
                                                cursor: 'pointer',
                                                transition: 'all 0.15s',
                                                textAlign: 'left'
                                            }}
                                        >
                                            <span>{p.nickname}{p.is_guest ? ' (G)' : ''}</span>
                                            <span style={{ fontSize: '11px', fontWeight: 600, color: isSelected ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{p.is_guest ? 'GUEST' : 'MEMBER'}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            <p style={{ textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', margin: 0 }}>
                                {partnerSelectSource === 'NEW' ? '첫 번째 플레이어를 선택하세요' : (allMembers.find(x => x.id === partnerSelectSource)?.nickname + (allMembers.find(x => x.id === partnerSelectSource)?.is_guest ? ' (G)' : '')) + '의 파트너를 선택하세요'}
                            </p>
                        </div>
                    </div>
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

    // --- Step 3: Live Dashboard ---
    const activeMatchForScore = showScoreModal ? matches.find(m => m.id === showScoreModal) : null;

    if (showGateway && step === 3) {
        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-black to-zinc-900 opacity-50" />
                
                <header className="relative z-10 p-8 flex flex-col items-center text-center">
                    <span className="text-[10px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent tracking-[0.5em] uppercase mb-4 animate-pulse">
                        Live Court Gateway
                    </span>
                    <h1 className="text-4xl font-black italic tracking-tighter text-white uppercase drop-shadow-2xl">
                        중계 세션 선택
                    </h1>
                    <div className="mt-4 h-1 w-24 bg-gradient-to-r from-transparent via-[#C9B075] to-transparent opacity-40" />
                </header>

                <div className="relative z-10 flex-1 px-6 pb-20 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
                    {allActiveSessions.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-center px-12 opacity-20 group">
                            <div className="w-20 h-20 rounded-full border border-dashed border-white/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <span className="text-4xl">📡</span>
                            </div>
                            <h2 className="text-lg font-black uppercase tracking-widest mb-2">No Active Matches</h2>
                            <p className="text-[10px] font-medium leading-relaxed uppercase tracking-tighter max-w-xs">
                                현재 진행 중인 공개 세션이 없습니다.<br />관리자가 경기를 생성하면 여기에 표시됩니다.
                            </p>
                        </div>
                    ) : (
                        allActiveSessions.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()).map((s, idx) => {
                            const isLatest = idx === 0;
                            return (
                                <button
                                    key={s.id}
                                    onClick={() => enterSession(s.id)}
                                    className={`
                                        relative w-full rounded-[24px] p-8 text-left transition-all active:scale-[0.98] group overflow-hidden
                                        bg-white/5 backdrop-blur-3xl border-t border-t-white/20 border-l border-l-white/10
                                        shadow-[0_40px_80px_-15px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(255,255,255,0.3)]
                                        ${isLatest ? 'border-[#C9B075]/30' : ''}
                                    `}
                                >
                                    {isLatest && (
                                        <div className="absolute -inset-[3px] rounded-[42px] bg-gradient-to-b from-[#C9B075] via-[#C9B075]/10 to-transparent -z-10 opacity-40 blur-[4px]" />
                                    )}

                                    <div className="flex items-start justify-between mb-8">
                                        <div className="flex flex-col gap-1">
                                            <span className={`text-[10px] font-black tracking-[0.3em] uppercase ${isLatest ? 'text-[#C9B075]' : 'text-white/40'}`}>
                                                {s.id.includes('KDK') ? '정기 KDK 매치' : '스페셜 매치'}
                                            </span>
                                            <h2 className="text-2xl font-black italic tracking-tighter text-white uppercase group-hover:text-[#C9B075] transition-colors leading-none">
                                                {s.title}
                                            </h2>
                                        </div>
                                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
                                            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                                            <span className="text-[9px] font-black text-red-500/80 uppercase tracking-widest">LIVE</span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-4 border-t border-white/5 pt-6">
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-1 font-mono">참가 인원</span>
                                            <span className="text-lg font-black text-white italic">{s.playerCount}<span className="text-[10px] ml-0.5 opacity-30">명</span></span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-1 font-mono">진행 경기</span>
                                            <span className="text-lg font-black text-white italic">{s.matchCount}<span className="text-[10px] ml-0.5 opacity-30">회</span></span>
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <span className="text-[10px] font-black text-[#C9B075] uppercase tracking-tighter mt-2">입장하기 ➡️</span>
                                        </div>
                                    </div>

                                    {/* Pulse Background */}
                                    {isLatest && (
                                        <div className="absolute inset-0 bg-gradient-to-tr from-[#C9B075]/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>

                { (allActiveSessions.length === 0 || isAdmin) && (
                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-full px-8 pb-4">
                        <button
                            onClick={startNewKdkCreation}
                            className="w-full py-5 rounded-full bg-white/5 border border-white/10 text-white/40 font-black text-[11px] uppercase tracking-[0.3em] active:scale-95 transition-all hover:bg-white/10 hover:text-white"
                        >
                            {isAdmin ? '+ 새로운 대회 생성하기' : '준비 된 경기가 없습니다'}
                        </button>
                    </div>
                )}
            </main>
        );
    }

    return (
        <main className="flex flex-col min-h-screen bg-gradient-to-br from-[#0a0a0b] via-[#121214] to-[#0a0a0b] text-white font-sans w-full relative pb-60" style={{ paddingBottom: 'calc(240px + env(safe-area-inset-bottom))' }}>
            {/* [v35.11] Redesigned Master Header: Minimalist 3-Column Layout */}
            <header className="px-6 py-4 flex items-center justify-between h-18 relative z-[200] bg-[#09090B] border-b border-white/5 shadow-[0_4px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl">
                {/* LEFT: ADMIN TOGGLE & RESET */}
                <div className="flex-1 flex items-center gap-4">
                    {isAdmin && (
                        <div className="flex items-center gap-3">
                            <button 
                                onClick={() => setAdminModeManual(!adminModeManual)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all active:scale-95 ${adminModeManual ? 'bg-[#C9B075] border-[#C9B075] text-black shadow-[0_5px_15px_rgba(201,176,117,0.3)]' : 'bg-white/5 border-white/10 text-white/40'}`}
                            >
                                <div className={`w-2 h-2 rounded-full ${adminModeManual ? 'bg-black animate-pulse' : 'bg-white/20'}`} />
                                <span className="text-[9px] font-[1000] uppercase tracking-widest leading-none">ADMIN</span>
                            </button>
                            {adminModeManual && (
                                <button
                                    onClick={() => setShowResetConfirm(true)}
                                    className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500/60 hover:text-red-500 hover:bg-red-500/20 transition-all active:scale-90"
                                    title="초기화"
                                >
                                    <RotateCw className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    )}
                    {!isAdmin && (
                        <div className="flex items-center gap-2">
                             <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500/50" />
                                <span className="text-[9px] font-black text-white/40 uppercase tracking-widest leading-none">VIEWER</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* CENTER: SESSION NAME (Strong Emphasis) */}
                <div className="flex-[2] flex min-w-0 flex-col items-center">
                    <span className="text-[10px] font-black text-[#C9B075] tracking-[0.4em] uppercase opacity-40 leading-none mb-1">Session</span>
                    <div className="flex max-w-full min-w-0 items-center justify-center gap-2">
                        <h1 className="max-w-[152px] whitespace-nowrap text-[clamp(14px,3.75vw,18px)] font-black italic tracking-[-0.065em] text-white uppercase sm:max-w-[220px] sm:text-2xl sm:tracking-tighter leading-none [text-shadow:0_2px_10px_rgba(0,0,0,0.5)]">
                            {sessionTitle || '260417_KDK_01'}
                        </h1>
                        <button
                            type="button"
                            onClick={openDisplayBoard}
                            disabled={!activeSessionId}
                            className="shrink-0 rounded-full border border-[#C9B075]/35 bg-[#C9B075]/10 px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.18em] text-[#C9B075] shadow-[0_0_12px_rgba(201,176,117,0.08)] transition-all active:scale-95 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/25"
                            title="전광판 열기"
                        >
                            TV
                        </button>
                        <button
                            type="button"
                            onClick={copyDisplayBoardUrl}
                            disabled={!activeSessionId}
                            className="hidden shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] text-white/45 transition-all hover:border-[#C9B075]/30 hover:text-[#C9B075] active:scale-95 disabled:cursor-not-allowed disabled:text-white/20 sm:inline-flex"
                            title="전광판 주소 복사"
                        >
                            COPY
                        </button>
                    </div>
                </div>

                {/* RIGHT: ACTION & STATUS INDICATOR */}
                <div className="flex-1 flex items-center justify-end gap-3">
                    <div className="flex items-center gap-2">
                        <button onClick={execCopySchedule} className="w-8 h-8 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center text-[#C9B075] hover:bg-[#C9B075]/20 active:scale-90 transition-all" title="결과 복사">📋</button>
                        <button onClick={copyFinalResults} className="w-8 h-8 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center text-[#C9B075] hover:bg-[#C9B075]/20 active:scale-90 transition-all" title="결과 보고">🏆</button>
                    </div>
                    
                    {/* Integrated Sync Indicator */}
                    <div className="flex flex-col items-end pr-1">
                        <div className="flex items-center gap-1.5">
                            <div className={`w-1.5 h-1.5 rounded-full ${syncStatus === 'HEALTHY' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : syncStatus === 'ERROR' ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'}`} />
                            <span className="text-[8px] font-black text-white/40 uppercase tracking-tighter">
                                {syncStatus === 'HEALTHY' ? '연결됨' : syncStatus === 'IDLE' ? '대기중' : '동기화 중'}
                            </span>
                        </div>
                        <span className="text-[7px] font-mono text-white/20 leading-none mt-0.5">{lastSyncTime || '--:--'}</span>
                    </div>
                </div>
            </header>

            <div
                className={`w-full px-5 flex flex-col gap-2 relative z-50 py-4 ${activeTab === 'RANKING' ? 'border-b border-white/5 pb-2 pt-2' : 'border-b border-white/10'}`}
                style={{ background: 'rgba(9, 9, 11, 0.85)', backdropFilter: 'blur(32px)', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
            >
                {/* SUB-HEADER: Financials & Rules (Cleaner Integration) */}
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 shrink-0">
                        <div className="flex items-center gap-1">
                            <span className="text-[8px] font-black text-[#C9B075] uppercase tracking-widest opacity-50">WIN:</span>
                            <span className="text-[9px] font-bold text-white tracking-tighter uppercase">{firstPrize/1000}K</span>
                        </div>
                        <div className="w-px h-2 bg-white/5" />
                        <div className="flex items-center gap-1">
                            <span className="text-[8px] font-black text-[#C9B075] uppercase tracking-widest opacity-50">PEN:</span>
                            <span className="text-[9px] font-bold text-white tracking-tighter uppercase">{bottom25Penalty/1000}K</span>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3 overflow-hidden">
                        <span className="text-[8px] font-black text-[#C9B075] uppercase tracking-widest opacity-50 shrink-0">RULES:</span>
                        <span className="text-[9px] font-bold text-white/60 tracking-tighter italic uppercase truncate">
                            {matchRules?.slice(0, 30) || '1:1 시작, 노에드, 타이 3:3'}
                        </span>
                        {adminModeManual && isAdmin && (
                             <button onClick={() => setShowMemberEditModal(true)} className="flex items-center justify-center w-5 h-5 bg-white/5 rounded-full text-[#C9B075]/40 hover:text-[#C9B075] text-[10px] transition-all active:scale-90">⚙️</button>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 px-4 space-y-0 overflow-y-auto pb-60 no-scrollbar antialiased" style={{ background: '#14161a', paddingBottom: 'calc(240px + env(safe-area-inset-bottom))' }}>
                {activeTab === 'MATCHES' && (
                    <>
                        <section className="h-auto" style={{ marginTop: '12px', position: 'relative', zIndex: 10 }}>
                            <div className="flex flex-col" style={{ marginBottom: '16px' }}>
                                <div className="flex items-center gap-3 ml-2">
                                    <h2 className="text-xl font-black italic tracking-tighter uppercase text-white">NOW PLAYING</h2>
                                    {activeMatchIds.length > 0 && (
                                        <span className="flex items-center gap-1.5 px-3 py-1 bg-red-500/20 text-red-400 rounded-full text-[10px] font-black tracking-widest uppercase border border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                            {activeMatchIds.length} LIVE
                                        </span>
                                    )}
                                </div>
                                <div className="mt-2 h-1 w-32 ml-2 bg-gradient-to-r from-[#C9B075] via-[#C9B075]/20 to-transparent" />
                            </div>

                            {activeMatchIds.length === 0 ? (
                                <div className="py-16 text-center text-white/20 border border-dashed border-white/10 rounded-2xl text-[12px] uppercase font-black tracking-widest">Waiting for next round...</div>
                            ) : (
                                <div className="grid grid-cols-2 gap-x-3 gap-y-5 mt-4">
                                    {activeMatchIds
                                        .map(mId => ({ id: mId, match: matches.find(x => x.id === mId) }))
                                        .filter(x => x.match)
                                        .sort((a, b) => {
                                            if (a.match!.round !== b.match!.round) return (a.match!.round || 0) - (b.match!.round || 0);
                                            return (a.match!.id || '').localeCompare(b.match!.id || '');
                                        })
                                        .map(({ id: mId, match: m }) => {
                                            if (!m) return null;
                                            const allMatchesInGroupSorted = matches.filter(mx => {
                                                const p0 = mx.playerIds?.[0];
                                                if (!p0) return false;
                                                const pGroup = attendeeConfigs[p0]?.group || (allMembers || []).find(x => x.id === p0)?.position || 'A';
                                                const nGroup = (pGroup || 'A').toUpperCase().includes('B') ? 'B' : 'A';
                                                return nGroup === (m.groupName || 'A');
                                            }).sort((a, b) => {
                                                if (a.round !== b.round) return (a.round || 0) - (b.round || 0);
                                                return (a.id || '').localeCompare(b.id || '');
                                            });
                                            const matchNo = allMatchesInGroupSorted.findIndex(x => x.id === m.id) + 1;

                                            return (
                                                <PlayingMatchCard 
                                                    key={m.id}
                                                    match={m}
                                                    getPlayerName={getPlayerName}
                                                    isAdmin={isAdmin && adminModeManual}
                                                    onCancel={(id) => cancelMatch(id)}
                                                    spinningMatchId={spinningMatchId}
                                                    matchNo={matchNo}
                                                    onInputScore={(id, s1, s2) => {
                                                        setTempScores({ s1, s2 });
                                                        setShowScoreModal(id);
                                                    }}
                                                />
                                            );
                                    })}
                                </div>
                            )}
                        </section>
                        <div style={{ marginTop: '32px' }}>
                            {(() => {
                                const waitingMatches = matches.filter(m => m.status === 'waiting');
                                if (waitingMatches.length === 0) return (
                                    <div className="py-10 text-center opacity-10 text-[10px] uppercase font-black tracking-widest border border-dashed border-white/5 rounded-[32px]">No Matches in Queue</div>
                                );

                                return ['A', 'B'].map(group => {
                                    const groupMatches = waitingMatches.filter(m => {
                                        const p0 = m.playerIds[0];
                                        const p0Group = attendeeConfigs[p0]?.group || allMembers.find(x => x.id === p0)?.position || 'A';
                                        const normalizedGroup = (p0Group || 'A').toUpperCase().includes('B') ? 'B' : 'A';
                                        return normalizedGroup === group;
                                    }).sort((a, b) => {
                                        if (a.round !== b.round) return (a.round || 0) - (b.round || 0);
                                        return a.id.localeCompare(b.id);
                                    });

                                    if (groupMatches.length === 0) return null;

                                    const isB = group === 'B';
                                    const col = isB ? '#00E5FF' : '#C9B075';

                                    return (
                                        <div key={group} className="space-y-3">
                                            <div className="flex flex-col" style={{ marginBottom: '16px', marginTop: '32px' }}>
                                                <h3 className="text-lg font-black italic tracking-tighter uppercase text-white ml-2" style={{ filter: 'drop-shadow(0 2px 4px rgba(255,255,255,0.2))' }}>{isB ? 'BLUE' : 'GOLD'} WAITING</h3>
                                                <div className="mt-2 h-1 w-32 ml-2" style={{ background: `linear-gradient(to right, ${col}, ${col}33, transparent)` }} />
                                            </div>
                                            <div className="flex flex-col gap-6">
                                                {(() => {
                                                    const roundsInGroup = [...new Set(groupMatches.map(m => m.round || 1))].sort((a, b) => a - b);
                                                    return roundsInGroup.map(roundNum => {
                                                        const matchesInRound = groupMatches.filter(m => (m.round || 1) === roundNum);
                                                        return (
                                                            <div key={roundNum} className="space-y-3">
                                                                <div className="flex items-center gap-2 ml-2 mb-1 opacity-60">
                                                                    <div className="h-[1px] w-4" style={{ background: col }} />
                                                                    <span className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: col }}>ROUND {roundNum}</span>
                                                                    <div className="h-[1px] flex-1" style={{ background: `linear-gradient(to right, ${col}66, transparent)` }} />
                                                                </div>
                                                                {matchesInRound.map((m, idx) => {
                                                                    const allMatchesInGroupSorted = matches.filter(mx => {
                                                                        const p0 = mx.playerIds[0];
                                                                        const pGroup = attendeeConfigs[p0]?.group || allMembers.find(x => x.id === p0)?.position || 'A';
                                                                        const nGroup = (pGroup || 'A').toUpperCase().includes('B') ? 'B' : 'A';
                                                                        return nGroup === group;
                                                                    }).sort((a, b) => {
                                                                        if (a.round !== b.round) return (a.round || 0) - (b.round || 0);
                                                                        return a.id.localeCompare(b.id);
                                                                    });
                                                                    const matchNo = allMatchesInGroupSorted.findIndex(x => x.id === m.id) + 1;
                                                                    const playingPlayerIdsInMatch = getPlayingPlayerIdsInMatch(m);
                                                                    const hasConflict = busyPlayerIds.has(m.playerIds[0]) || busyPlayerIds.has(m.playerIds[1]) || busyPlayerIds.has(m.playerIds[2]) || busyPlayerIds.has(m.playerIds[3]);

                                                                    return (
                                                                        <div key={m.id} className={`relative rounded-2xl ${playingPlayerIdsInMatch.length > 0 ? 'ring-1 ring-red-500/25 shadow-[0_0_18px_rgba(239,68,68,0.16)]' : ''}`}>
                                                                        <WaitingMatchCard 
                                                                            key={m.id}
                                                                            match={m}
                                                                            index={idx}
                                                                            matchNo={matchNo}
                                                                            getPlayerName={getPlayerName}
                                                                            isAdmin={isAdmin && adminModeManual}
                                                                            isStartingMatch={isStartingMatch}
                                                                            hasConflict={hasConflict}
                                                                            onStart={(id) => {
                                                                                if (!isAdmin || !adminModeManual) return triggerAccessDenied("경기 투입은 관리자 모드에서만 가능합니다.");
                                                                                startMatch(id);
                                                                            }}
                                                                        />
                                                                            {playingPlayerIdsInMatch.length > 0 && (
                                                                                <div className="pointer-events-none absolute left-[58px] right-[86px] top-[18px] z-20 grid grid-cols-[1fr_18px_1fr] items-start">
                                                                                    <div className="grid grid-cols-2 gap-1 px-1">
                                                                                        {[0, 1].map((playerIndex) => (
                                                                                            <div key={playerIndex} className="flex justify-center">
                                                                                                {busyPlayerIds.has(m.playerIds[playerIndex]) && (
                                                                                                    <span className="rounded-full border border-red-400/45 bg-red-500/22 px-1.5 py-0.5 text-[7px] font-black leading-none text-red-50 shadow-[0_0_10px_rgba(239,68,68,0.32)]">
                                                                                                        LIVE
                                                                                                    </span>
                                                                                                )}
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                    <div />
                                                                                    <div className="grid grid-cols-2 gap-1 px-1">
                                                                                        {[2, 3].map((playerIndex) => (
                                                                                            <div key={playerIndex} className="flex justify-center">
                                                                                                {busyPlayerIds.has(m.playerIds[playerIndex]) && (
                                                                                                    <span className="rounded-full border border-red-400/45 bg-red-500/22 px-1.5 py-0.5 text-[7px] font-black leading-none text-red-50 shadow-[0_0_10px_rgba(239,68,68,0.32)]">
                                                                                                        LIVE
                                                                                                    </span>
                                                                                                )}
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        );
                                                    });
                                                })()}
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>

                        {matches.some(m => m.status === 'complete') && (
                            <div style={{ marginTop: '32px' }}>
                                <h3 className="text-xl font-black italic tracking-tighter uppercase text-white ml-2" style={{ filter: 'drop-shadow(0 2px 4px rgba(255,255,255,0.2))' }}>COMPLETED MATCHES</h3>
                                <div className="mt-2 h-1.5 w-48 ml-2 bg-gradient-to-r from-[#C9B075] via-[#C9B075]/20 to-transparent" style={{ marginBottom: '16px' }} />
                                <div className="grid grid-cols-2 gap-3 mt-4">
                                    {matches.filter(m => m.status === 'complete')
                                        .sort((a, b) => {
                                            const gA = a.groupName || 'A';
                                            const gB = b.groupName || 'A';
                                            if (gA !== gB) return gA.localeCompare(gB);
                                            const groupMatchesSorted = matches.filter(mx => (mx.groupName || 'A') === gA).sort((x, y) => (x.round || 0) - (y.round || 0) || String(x.id).localeCompare(String(y.id)));
                                            return groupMatchesSorted.findIndex(x => x.id === a.id) - groupMatchesSorted.findIndex(x => x.id === b.id);
                                        })
                                        .map((m, idx) => {
                                            const groupMatchesSorted = matches.filter(mx => (mx.groupName || 'A') === (m.groupName || 'A')).sort((a, b) => {
                                                if (a.round !== b.round) return (a.round || 0) - (b.round || 0);
                                                return String(a.id).localeCompare(String(b.id));
                                            });
                                            const gMatchNo = groupMatchesSorted.findIndex(x => x.id === m.id) + 1;

                                            return (
                                                <CompletedMatchCard 
                                                    key={m.id}
                                                    match={m}
                                                    index={idx}
                                                    matchNo={gMatchNo}
                                                    getPlayerName={getPlayerName}
                                                    isAdmin={isAdmin}
                                                    onResetStatus={(id) => {
                                                        if (window.confirm("이 경기를 다시 '진행 중(ONGOING)' 상태로 되돌리시겠습니까?\n(점수가 1:1로 초기화되며 랭킹에서 일시 제외됩니다)")) {
                                                            supabase.from('matches').update({ status: 'playing', score1: 1, score2: 1 }).eq('id', id).then(() => {
                                                                setSyncTick(t => t + 1);
                                                            });
                                                        }
                                                    }}
                                                    onEdit={(match) => {
                                                        if (!isAdmin) return triggerAccessDenied();
                                                        setTempScores({ s1: match.score1 ?? 0, s2: match.score2 ?? 0 });
                                                        setShowScoreModal(match.id);
                                                    }}
                                                />
                                            );
                                        })}
                                </div>
                            </div>
                        )}
                    </>
                )}
                {activeTab === 'RANKING' && (
                    <div className="flex-1 animate-in fade-in slide-in-from-bottom-5 duration-500">
                        <RankingTab
                            players={allPlayersInRanking}
                            sessionTitle={sessionTitle}
                            isArchive={false}
                            isAdmin={isAdmin}
                            prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty }}
                            onShareMatch={execCopySchedule}
                            onShareResult={copyFinalResults}
                            onFinalize={handleFinalArchive}
                            isGenerating={isGenerating}
                            ceremonyMode={showCeremony}
                        />
                    </div>
                )}

            </div>

            <nav className="fixed bottom-24 bg-white/5 backdrop-blur-2xl border border-white/10 shadow-[0_20px_100px_rgba(0,0,0,0.8)] left-1/2 -translate-x-1/2 rounded-[32px] p-2 w-[94%] max-w-[440px] flex items-center justify-between gap-3 z-[90]">
                <button
                    onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); setActiveTab('MATCHES'); }}
                    className={`flex-1 rounded-[24px] py-6 flex items-center justify-center gap-5 transition-all active:scale-95 uppercase tracking-tighter ${activeTab === 'MATCHES' ? 'bg-[#C9B075]/10 text-[#C9B075] font-black text-[22px] shadow-[0_0_20px_rgba(201,176,117,0.2),inset_0_0_10px_rgba(201,176,117,0.1)] border border-[#C9B075]/30' : 'text-white/40 font-bold text-[20px] hover:text-white/60'}`}
                >
                    🔥 MATCHES
                </button>
                <button
                    onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); setActiveTab('RANKING'); }}
                    className={`flex-1 rounded-[24px] py-6 flex items-center justify-center gap-5 transition-all active:scale-95 uppercase tracking-tighter ${activeTab === 'RANKING' ? 'bg-white/10 text-white font-black text-[22px] shadow-[0_0_20px_rgba(255,255,255,0.05)] border border-white/20' : 'text-white/40 font-bold text-[20px] hover:text-white/60'}`}
                >
                    📊 RANKING
                </button>

            </nav>


            {allMatchesScored && step === 3 && activeTab === 'MATCHES' && (
                <div className="fixed bottom-[200px] left-1/2 -translate-x-1/2 w-full max-w-[450px] px-6 z-[60] animate-in slide-in-from-bottom-10 fade-in duration-500">
                    <button
                        onClick={handleStartCeremony}
                        className="w-full py-5 bg-gradient-to-r from-[#C9B075] to-[#B8860B] text-black font-bold rounded-full shadow-[0_20px_60px_rgba(212,175,55,0.4)] active:scale-95 transition-all text-[13px] tracking-[0.2em] uppercase flex items-center justify-center gap-3 border border-white/20 animate-pulse"
                    >
                        <span>🏆 즉시 순위 및 축하 화면 보러가기</span>
                    </button>
                </div>
            )}

            {showRankingModal && (
                <div className="fixed inset-0 z-[100] flex flex-col bg-black/98 backdrop-blur-2xl">
                    <header className="p-6 border-b border-white/5 flex items-center justify-between bg-[#14141F]">
                        <h2 className="text-xl font-black italic tracking-tighter text-white">LIVE LEADERBOARD</h2>
                        <button onClick={() => setShowRankingModal(false)} className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-xl text-white">×</button>
                    </header>
                    <div className="flex-1 overflow-y-auto p-4">
                        <RankingTab
                            players={allPlayersInRanking}
                            sessionTitle={sessionTitle}
                            isArchive={false}
                            isAdmin={role === 'CEO'}
                            prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty }}
                            onShareMatch={execCopySchedule}
                            onShareResult={copyFinalResults}
                            onFinalize={handleFinalArchive}
                            isGenerating={isGenerating}
                            ceremonyMode={showCeremony}
                        />
                    </div>
                </div>
            )}

            {activeMatchForScore && (
                <ScoreEntryModal 
                    match={activeMatchForScore}
                    tempScores={tempScores}
                    setTempScores={setTempScores}
                    onSave={finishMatch}
                    onCancel={() => setShowScoreModal(null)}
                    getPlayerName={getPlayerName}
                />
            )}

            {showMemberEditModal && (
                <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-2xl flex flex-col p-6 overflow-hidden">
                    <header className="flex items-center justify-between mb-8 border-b border-white/10 pb-6">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent tracking-[0.4em] uppercase mb-1">Live Management</span>
                            <h2 className="text-2xl font-black italic text-white uppercase tracking-tighter">참석자 수시 수정</h2>
                        </div>
                        <button onClick={() => setShowMemberEditModal(false)} className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center text-white/20 text-3xl hover:bg-white/10 transition-colors">×</button>
                    </header>
                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
                        <section className="space-y-4">
                            <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.3em] uppercase">Toggle Active Players</h3>
                            <div className="grid grid-cols-4 gap-3">
                                {[...allMembers, ...tempGuests].map(m => {
                                    const isSelected = selectedIds.has(m.id);
                                    const isBusy = busyPlayerIds.has(m.id);
                                    return (
                                        <div
                                            key={m.id}
                                            onClick={() => {
                                                if (isBusy) {
                                                    alert("현재 경기 중인 선수는 기권 처리할 수 없습니다. 경기가 끝난 후 조정해 주세요.");
                                                    return;
                                                }
                                                toggleMember(m.id);
                                            }}
                                            className={`h-16 rounded-2xl border transition-all flex flex-col items-center justify-center cursor-pointer text-center px-1
                                            ${isSelected
                                                    ? 'bg-[#C9B075] border-[#C9B075] text-black shadow-lg scale-105'
                                                    : 'bg-white/[0.05] border-white/10 text-white/40'}
                                            ${isBusy ? 'opacity-30 border-dashed cursor-not-allowed' : ''}`}
                                        >
                                            <span className="text-[10px] font-black truncate w-full px-1">{m.nickname}</span>
                                            {isBusy && <span className="text-[6px] font-bold text-red-500 uppercase">Busy</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                        <p className="text-[10px] font-bold text-white/30 leading-relaxed uppercase tracking-widest text-center italic">
                            💡 선수를 추가하거나 제거하면, <br />아직 투입되지 않은 모든 자동 대진이 다시 생성됩니다.
                        </p>
                    </div>
                    <div className="mt-8">
                        <button
                            disabled={isGenerating}
                            onClick={handleMemberEditConfirm}
                            className={`w-full py-5 rounded-full font-black text-xs uppercase tracking-[0.2em] shadow-2xl ${isGenerating ? 'bg-white/10 text-white/10' : 'bg-[#C9B075] text-black'}`}
                        >
                            {isGenerating ? '대진 재구성 중...' : '💾 실시간 인원 변경사항 적용'}
                        </button>
                    </div>
                </div>
            )}

            {showResetConfirm && (
                <CustomConfirmModal
                    title="대진표 초기화"
                    message="현재 진행 중인 모든 대진과 선택된 멤버 정보를 삭제하고 처음부터 다시 시작하시겠습니까?"
                    onConfirm={actualReset}
                    onCancel={() => setShowResetConfirm(false)}
                />
            )}
            {showWarning && (
                <WarningModal
                    message={warningMsg}
                    onClose={() => setShowWarning(false)}
                />
            )}
            {showArchiveSuccess && (
                <div className="fixed inset-0 z-[5000] bg-black flex flex-col items-center justify-center animate-in fade-in duration-1000">
                    {/* [v10.0] Golden Confetti Sprinkling */}
                    <div className="absolute inset-0 pointer-events-none z-[5001] overflow-hidden">
                        {[...Array(50)].map((_, i) => (
                            <div 
                                key={i} 
                                className="absolute top-[-20px] w-2 h-2 rounded-full animate-bounce" 
                                style={{ 
                                    left: `${Math.random() * 100}%`, 
                                    animation: `falling ${2 + Math.random() * 3}s linear infinite`,
                                    background: i % 2 === 0 ? '#C9B075' : '#E5D29B',
                                    opacity: Math.random(),
                                    transform: `scale(${0.5 + Math.random()})`
                                }} 
                            />
                        ))}
                    </div>
                    <style jsx>{`
                        @keyframes falling {
                            0% { transform: translateY(-10vh) rotate(0deg); }
                            100% { transform: translateY(110vh) rotate(720deg); }
                        }
                    `}</style>
                    <div className="absolute inset-0 bg-gradient-to-t from-[#C9B075]/30 via-transparent to-transparent" />
                    <div className="relative z-10 flex flex-col items-center text-center px-12 space-y-8">
                        <div className="w-40 h-40 rounded-full bg-[#C9B075]/10 border-2 border-[#C9B075]/50 flex items-center justify-center animate-bounce shadow-[0_0_80px_rgba(201,176,117,0.5)]">
                            <span className="text-8xl drop-shadow-2xl">🏆</span>
                        </div>
                        <div className="space-y-4">
                            <h2 className="text-5xl font-black italic text-white uppercase tracking-tighter drop-shadow-[0_0_30px_rgba(201,176,117,0.8)]">
                                Match<br />Completed
                            </h2>
                            <p className="text-[#C9B075] text-xs font-black uppercase tracking-[0.6em] animate-pulse">
                                테연 클럽 아카이브 저장 완료!
                            </p>
                        </div>
                        <div className="flex gap-3">
                            {[...Array(5)].map((_, i) => (
                                <div key={i} className="w-2 h-2 rounded-full bg-[#C9B075] animate-ping" style={{ animationDelay: `${i * 0.2}s` }} />
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
