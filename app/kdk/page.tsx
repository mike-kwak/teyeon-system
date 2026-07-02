'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import nextDynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useGuideRecording } from '@/hooks/useGuideRecording';
import { useLoading } from '@/context/LoadingContext';
import { generateKdkMatches, Player as KdkPlayer, Match as KdkMatch } from '@/lib/kdk';
import { RotateCw, CheckCircle2, Settings } from 'lucide-react';
import PremiumSpinner from '@/components/PremiumSpinner';
import { DataStateView } from '@/components/DataStateView';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
// 성능: RankingTab(1894줄 + canvas 이미지 생성 3개)은 순위/정산 탭에서만 렌더 → 지연 로드.
const RankingTab = nextDynamic(() => import('@/components/RankingTab'), { ssr: false });
import { useRanking } from '@/hooks/useRanking';
import { computeSettlement, isAssociateGuestFeeMember, isGuestRankedPlayer } from '@/lib/kdk/settlement';
import { loadKdkSession } from '@/lib/finance/kdkSettlementService';
import { Member, Match, AttendeeConfig, KDKConcept, UserRole } from '@/lib/tournament_types';
import MemberSelector from '@/components/tournament/MemberSelector';
import { WarningModal, CustomConfirmModal } from '@/components/tournament/Modals';
import { PlayingMatchCard, WaitingMatchCard, CompletedMatchCard } from '@/components/tournament/LiveCourtCards';
import { ScoreEntryModal } from '@/components/tournament/ScoreEntryModal';
import { fetchClubSchedules } from '@/lib/clubScheduleService';
import type { ClubSchedule } from '@/lib/clubScheduleData';


// KDK 대진 생성 스텝 공통 하단 여백 — inline-CTA(다음/생성) 스텝의 실제 스크롤 콘텐츠 끝에
// 적용해 마지막 CTA가 BottomNav 아래로 깔리지 않게 한다.
//   · 스텝 root 의 음수 margin(-page-bottom-safe)을 제거했으므로 GlobalMain 의 기존
//     하단 padding(var(--page-bottom-safe) = BottomNav 높이 + 24px)이 그대로 살아 nav 를 비운다.
//   · 그 위에 이 값(64px + safe-area)을 콘텐츠 wrapper 에 더해 CTA 아래 실제 빈 공간을 확보한다.
//   · 결과적으로 CTA 는 BottomNav 위로 약 88px(노치 시 더 큼) 떠서 절대 가려지지 않는다.
// 단일 스크롤러 구조에서 각 KDK 문서형 단계의 하단 clearance.
//   기존 64px 는 BottomNav 영역(72px+safe)보다 작아 마지막 CTA 가 nav 뒤로 ~8px 가림(실측).
//   공통 토큰 var(--page-bottom-safe) = calc((72px+safe)+24px) 로 맞춰 nav 위 24px 여백을 보장(safe-area 는 한 번만 계산).
const KDK_STEP_BOTTOM_PADDING = 'var(--page-bottom-safe)';

// LIVE COURT 복원 — 마지막으로 보던 세션/탭을 사용자별 localStorage 에 저장(핵심 복원값).
//   · sessionStorage 는 PWA/앱 프로세스 종료 시 사라져 복원에 부적합 → localStorage 사용.
//   · uid 단위 key 로 분리(로그아웃/다른 계정 로그인 시 이전 사용자 상태 재사용 방지).
//   · 경기 데이터 자체는 저장하지 않는다(세션 id/탭만). 최신 데이터는 진입 후 Supabase 에서 재조회.
const KDK_LAST_LIVE_KEY_PREFIX = 'teyeon:kdk:last-live-session:';
type KdkLiveTab = 'MATCHES' | 'RANKING';
interface KdkLastLiveSession { sessionId: string; tab: KdkLiveTab; at: number; }

function kdkLastLiveKey(uid: string): string {
    return `${KDK_LAST_LIVE_KEY_PREFIX}${uid}`;
}
function readLastLiveSession(uid: string | null | undefined): KdkLastLiveSession | null {
    if (!uid || typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(kdkLastLiveKey(uid));
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (p && typeof p.sessionId === 'string' && p.sessionId) {
            return { sessionId: p.sessionId, tab: p.tab === 'RANKING' ? 'RANKING' : 'MATCHES', at: Number(p.at) || 0 };
        }
        return null;
    } catch {
        return null;
    }
}
function writeLastLiveSession(uid: string | null | undefined, value: KdkLastLiveSession): void {
    if (!uid || typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(kdkLastLiveKey(uid), JSON.stringify(value));
    } catch {
        /* 저장 실패해도 운영 화면은 정상 동작 */
    }
}
function clearLastLiveSession(uid: string | null | undefined): void {
    if (!uid || typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(kdkLastLiveKey(uid));
    } catch {
        /* noop */
    }
}

type ActiveKdkSession = {
    id: string;
    title: string;
    matchCount: number;
    playerCount: number;
    lastActivity: string;
};

type KdkEntryBackTarget = 'ENTRY_CHOICE' | 'MAIN' | null;

// ── 공식 기록 확정/완료 화면 — Cool Premium Light 공용 스타일 ─────────────────
const FINALIZE_OVERLAY: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9000,
    background: 'linear-gradient(180deg, #F4F9FD 0%, #E8F0F8 100%)',
    overflowY: 'auto',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: `max(20px, env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom))`,
    WebkitOverflowScrolling: 'touch',
};
const FINALIZE_CARD: React.CSSProperties = {
    width: '100%', maxWidth: 380,
    background: '#FFFFFF', border: '1px solid #E1EAF5', borderRadius: 20,
    padding: 24, boxShadow: '0 18px 48px rgba(15,39,71,0.12)',
    margin: 'auto',
};
const FINALIZE_SESSION_BOX: React.CSSProperties = {
    marginTop: 14, padding: '12px 14px', borderRadius: 12,
    background: '#F8FBFE', border: '1px solid #E1EAF5',
};
const FINALIZE_BTN_PRIMARY: React.CSSProperties = {
    flex: 1, height: 46, borderRadius: 12, border: 'none',
    background: 'linear-gradient(90deg, #16A085 0%, #1F5FB5 100%)',
    color: '#FFFFFF', fontSize: 13.5, fontWeight: 800, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 8px 18px rgba(31,95,181,0.20)', WebkitTapHighlightColor: 'transparent',
};
const FINALIZE_BTN_SECONDARY: React.CSSProperties = {
    flex: 1, height: 46, borderRadius: 12,
    border: '1px solid #DCE8F5', background: '#FFFFFF',
    color: '#1F5FB5', fontSize: 13.5, fontWeight: 800, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
};
function FinalizeRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 14px', background: '#FFFFFF' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#64748B', flexShrink: 0 }}>{label}</span>
            <span style={{ fontSize: strong ? 14 : 13, fontWeight: strong ? 900 : 800, color: '#0F2747', textAlign: 'right', wordBreak: 'keep-all', lineHeight: 1.35 }}>{value}</span>
        </div>
    );
}

export default function KDKPage() {
    const router = useRouter();
    const { role, hasPermission, getRestrictionMessage, user } = useAuth();
    const uid = user?.id ?? null;
    const uidRef = useRef<string | null>(null); // 비동기 syncActiveSession 에서 최신 uid 참조용
    const { guardWriteAction, shouldHideAdminControls } = useGuideRecording();
    const { showLoading, hideLoading } = useLoading();
    const [showToast, setShowToast] = useState(false);
    const [toastMsg, setToastMsg] = useState("결과가 안전하게 기록되었습니다");

    // [v12.0] 개방형 권한 시스템: Admin 여부 판별 (ADMIN 포함)
    //   촬영 보호 모드/미리보기에서는 운영 UI 를 숨긴다(기존 권한 조건 유지 + 촬영 숨김 조건 추가).
    //   일반 모드에서는 shouldHideAdminControls=false 라 기존과 동일하게 동작(영향 0).
    const isAdmin = (role === 'CEO' || role === 'ADMIN') && !shouldHideAdminControls;
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
    const [sessionSelectorBackTarget, setSessionSelectorBackTarget] = useState<KdkEntryBackTarget>(null);
    const [createBackTarget, setCreateBackTarget] = useState<KdkEntryBackTarget>(null);
    const [hasRestoredSession, setHasRestoredSession] = useState(false);
    const kdkEntryModeRef = useRef<'CHECKING' | 'CHOOSE' | 'CREATE' | 'LIVE'>('CHECKING');
    const hasInitializedKdkRef = useRef(false);
    const updateKdkEntryMode = (mode: 'CHECKING' | 'CHOOSE' | 'CREATE' | 'LIVE') => {
        kdkEntryModeRef.current = mode;
        setKdkEntryMode(mode);
    };
    const [syncTick, setSyncTick] = useState(0);
    const [adminModeManual, setAdminModeManual] = useState(true); // [v35.11] Admin UI Visibility Toggle

    const [isMobileTitle, setIsMobileTitle] = useState(false);
    useEffect(() => {
        const check = () => setIsMobileTitle(window.innerWidth < 768);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

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
    // 게스트비(원) — kdk_session_meta.guest_fee 가 유일한 source of truth. null = 미설정(0은 유효 확정값).
    const [guestFee, setGuestFee] = useState<number | null>(null);
    // 이 세션의 guest_fee 가 DB 에 저장되어 있는지(=비-레거시). 레거시(null)는 자동 덮어쓰지 않는다.
    const guestFeeStoredRef = useRef(false);
    // 진행/완료 경기가 있는 상태에서 게스트비를 최초 변경할 때 1회 확인. 이후 ± 클릭마다 재확인하지 않는다.
    const guestFeeEditAckRef = useRef(false);
    // 공식 결과 확정(teyeon_archive_v1.is_official) 후 게스트비 수정 잠금.
    //   Archive 스냅샷과 라이브 값이 어긋나지 않도록, 확정된 세션은 guest_fee 를 바꿀 수 없다.
    const [officialLocked, setOfficialLocked] = useState(false);

    useEffect(() => {
        setTotalCourtsInput(String(totalCourts));
    }, [totalCourts]);

    const [accountInfo, setAccountInfo] = useState("카카오뱅크 3333-01-5235337 (곽민섭)");
    const [currentTime, setCurrentTime] = useState("");
    const [showScoreModal, setShowScoreModal] = useState<string | null>(null);
    const [tempScores, setTempScores] = useState({ s1: 0, s2: 0 });
    const [showRankingModal, setShowRankingModal] = useState(false);
    const [userRole, setUserRole] = useState<UserRole>('GUEST');
    const [allActiveSessions, setAllActiveSessions] = useState<ActiveKdkSession[]>([]);
    const [sessionDeleteTarget, setSessionDeleteTarget] = useState<ActiveKdkSession | null>(null);
    const [isDeletingSession, setIsDeletingSession] = useState(false);
    // 완료 경기 → 대기로 되돌리기 2차 확인 대상(matchId).
    const [resetMatchTarget, setResetMatchTarget] = useState<string | null>(null);
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
    const [archiveSuccessUrl, setArchiveSuccessUrl] = useState("");
    const [showConfetti, setShowConfetti] = useState(false);
    const [celebrationMode, setCelebrationMode] = useState(false);
    // 공식 기록 확정 전 확인 모달 + 확정/완료 화면 공용 요약(기존 정산식 재사용, 새 계산 없음).
    const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false);
    const [finalizeSummary, setFinalizeSummary] = useState<{
        title: string; dateLabel: string; participants: number; matchCount: number;
        winner: string | null; guestFee: number | null; penaltyCount: number; penaltyTotal: number;
    } | null>(null);
    const [isMembersLoading, setIsMembersLoading] = useState(true);
    const [isMembersError, setIsMembersError] = useState(false);
    // isMembersLoading → LoadingOverlay 연동 (fetchMembers 로직 무변경)
    useEffect(() => {
        if (isMembersLoading) showLoading();
        else hideLoading();

        return () => {
            hideLoading();
        };
    }, [isMembersLoading, showLoading, hideLoading]);
    const [showCeremony, setShowCeremony] = useState(false);
    const [spinningMatchId, setSpinningMatchId] = useState<string | null>(null);
    const [isCheckingTitle, setIsCheckingTitle] = useState(false);
    const [isStartingMatch, setIsStartingMatch] = useState(false);

    // [동시 조작 안정화] 액션별 in-flight lock — 전역 단일 boolean 대신 `action:matchId` 키로 구분.
    //   ref = 동기 재진입(더블탭) 차단, state = 버튼 disable/문구용.
    const pendingActionsRef = useRef<Set<string>>(new Set());
    const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
    const isActionPending = (key: string) => pendingActions.has(key);
    const beginAction = (key: string): boolean => {
        if (pendingActionsRef.current.has(key)) return false;
        pendingActionsRef.current.add(key);
        setPendingActions(new Set(pendingActionsRef.current));
        return true;
    };
    const endAction = (key: string) => {
        pendingActionsRef.current.delete(key);
        setPendingActions(new Set(pendingActionsRef.current));
    };

    // [동시 조작 안정화] Realtime refresh debounce + stale 응답 폐기.
    const realtimeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fetchMatchesSeqRef = useRef(0);
    const scheduleRealtimeRefresh = (fn: () => void) => {
        if (realtimeRefreshTimerRef.current) clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = setTimeout(fn, 220);
    };

    // 전광판 티커 수동 메시지
    const [tickerMsg, setTickerMsg] = useState('');
    const [tickerSaving, setTickerSaving] = useState(false);
    const [tickerSaveOk, setTickerSaveOk] = useState(false);

    // KDK 세션 → TEYEON 정모(club_schedule_id) 연결.
    // 운영진이 명시적으로 선택해야만 연결됨 — 자동 매칭 금지.
    // 연결되면 Guest Pass 의 'KDK 경기 안내' 카드가 세션 상태에 따라 자동 전환.
    const [upcomingSchedules, setUpcomingSchedules] = useState<ClubSchedule[]>([]);
    const [linkedScheduleId, setLinkedScheduleId] = useState<string | null>(null);
    const [linkSaving, setLinkSaving] = useState(false);

    // 조별 전용 코트 운영(세션 관리 모달). kdk_session_meta.group_courts 래핑형 jsonb 와 1:1.
    //   enabled=false 또는 빈 groups → 전체 코트 자동 배정(기존 동작). 저장은 별도 버튼.
    type GroupCourtsState = { enabled: boolean; groups: Record<string, number[]> };
    const [groupCourts, setGroupCourts] = useState<GroupCourtsState>({ enabled: false, groups: {} });
    const [groupCourtsSaving, setGroupCourtsSaving] = useState(false);
    const [groupCourtsSaveOk, setGroupCourtsSaveOk] = useState(false);

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

    // DB jsonb(group_courts) → 안전한 GroupCourtsState. 잘못된 형태는 비활성으로 해석.
    const normalizeGroupCourts = (raw: any): GroupCourtsState => {
        if (!raw || typeof raw !== 'object') return { enabled: false, groups: {} };
        const groupsRaw = (raw.groups && typeof raw.groups === 'object') ? raw.groups : {};
        const groups: Record<string, number[]> = {};
        for (const key of Object.keys(groupsRaw)) {
            const arr = Array.isArray(groupsRaw[key]) ? groupsRaw[key] : [];
            const courts = Array.from(new Set(
                arr.map((n: any) => Math.trunc(Number(n))).filter((n: number) => Number.isInteger(n) && n > 0)
            )).sort((a, b) => a - b);
            groups[key] = courts;
        }
        return { enabled: raw.enabled === true, groups };
    };

    const loadTickerMsg = async (sid: string) => {
        if (!sid) return;
        // ticker_message + club_schedule_id + group_courts 동시 로드. 컬럼 미적용 환경
        // (마이그레이션 전) 대비 fallback.
        let row: any = null;
        const { data, error } = await supabase
            .from('kdk_session_meta')
            .select('ticker_message, club_schedule_id, group_courts, guest_fee')
            .eq('session_id', sid)
            .maybeSingle();
        if (error && /club_schedule_id|group_courts|guest_fee/i.test(`${error.message || ''} ${error.details || ''}`)) {
            const fb = await supabase
                .from('kdk_session_meta')
                .select('ticker_message')
                .eq('session_id', sid)
                .maybeSingle();
            row = fb.data ?? null;
        } else {
            row = data ?? null;
        }
        setTickerMsg(row?.ticker_message ?? '');
        setLinkedScheduleId(row?.club_schedule_id ?? null);
        setGroupCourts(normalizeGroupCourts(row?.group_courts));
        // 게스트비 snapshot 복원 — kdk_session_meta.guest_fee 단일 출처. null = 미설정 → guestFee=null 유지.
        //   상수 fallback(10,000) 금지. 0 은 유효한 확정값이므로 null 과 반드시 구분한다.
        const storedFee = row?.guest_fee;
        if (typeof storedFee === 'number' && storedFee >= 0) {
            setGuestFee(storedFee);
            guestFeeStoredRef.current = true;
        } else {
            setGuestFee(null);
            guestFeeStoredRef.current = false;
        }
        // 공식 결과 확정 여부 — 이 세션에 공식 Archive(is_official)가 있으면 게스트비 수정 잠금.
        //   조회 실패 시엔 잠그지 않는다(저장 직전 재확인이 최종 방어선).
        try {
            const archived = await loadKdkSession(sid);
            setOfficialLocked(!!archived?.isOfficial);
        } catch {
            setOfficialLocked(false);
        }
    };

    // 가까운 일정 목록 로드 (KDK ↔ 정모 연결용). 최초 마운트 1회 + 세션 변경 시 갱신.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const all = await fetchClubSchedules();
                if (cancelled) return;
                // 오늘 ± 14 일 + 정모 / 번개 / 단체전 연습만 표시 (회식 / 기타 제외).
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const lower = new Date(today); lower.setDate(lower.getDate() - 14);
                const upper = new Date(today); upper.setDate(upper.getDate() + 30);
                const filtered = all.filter((cs) => {
                    if (cs.id.startsWith('demo-')) return false;
                    if (!['정모', '번개', '단체전 연습'].includes(cs.schedule_type)) return false;
                    const d = new Date(cs.schedule_date);
                    return d >= lower && d <= upper;
                }).sort((a, b) => a.schedule_date.localeCompare(b.schedule_date));
                setUpcomingSchedules(filtered);
            } catch {
                /* swallow — 연결 UI 만 영향, KDK 본체 기능에 영향 X */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const OFFICIAL_LOCK_MSG = '공식 결과가 확정되어 게스트비를 수정할 수 없습니다.';

    // 게스트비 snapshot 저장 — kdk_session_meta.guest_fee upsert(해당 컬럼만 갱신).
    //   운영자 직접 수정에서만 호출. 성공 시에만 true 를 반환하며, 실패 시 사용자에게 명확히 알린다
    //   (console warning 만 남기고 성공처럼 보이게 두지 않는다). 저장 직전 공식 확정 여부를 재확인해
    //   화면을 오래 열어둔 사이 다른 운영자가 확정한 경우에도 저장을 차단한다.
    const saveGuestFee = async (value: number): Promise<boolean> => {
        if (!activeSessionId) return false;
        const fee = Math.max(0, Math.trunc(value));

        // 저장 직전 공식 Archive 재확인(동시성 방어) — fail-closed.
        //   isOfficial=true → 차단. isOfficial=false → 진행.
        //   조회 실패/상태 미확인 → 저장 차단(성공처럼 보이게 하지 않는다). UI 로드 단계의 관대한 처리와 달리,
        //   실제 write 직전에는 공식 상태를 확인하지 못하면 절대 저장하지 않는다.
        try {
            const archived = await loadKdkSession(activeSessionId);
            if (archived?.isOfficial) {
                setOfficialLocked(true);
                alert(OFFICIAL_LOCK_MSG);
                return false;
            }
        } catch {
            alert('공식 결과 확정 여부를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.');
            return false;
        }

        const { error } = await supabase
            .from('kdk_session_meta')
            .upsert(
                { session_id: activeSessionId, club_id: clubId, guest_fee: fee, updated_at: new Date().toISOString() },
                { onConflict: 'session_id' },
            );
        if (error) {
            const msg = `${error.message || ''} ${error.details || ''}`;
            if (/guest_fee/i.test(msg)) {
                console.warn('[KDK/guestFee] guest_fee 컬럼 미적용 — supabase/add_kdk_session_guest_fee.sql 적용 필요.');
                alert('게스트비를 저장하지 못했습니다.\n\n운영 환경에 guest_fee 컬럼이 아직 적용되지 않았습니다.\n(supabase/add_kdk_session_guest_fee.sql 적용 필요)');
            } else {
                console.warn('[KDK/guestFee] 저장 실패:', msg);
                alert('게스트비 저장 중 오류가 발생했습니다.\n' + (error.message || '잠시 후 다시 시도해주세요.'));
            }
            return false;
        }
        guestFeeStoredRef.current = true;
        return true;
    };

    // 게스트비 운영자 변경 — 0원 이상, 1,000원 단위.
    //   공식 확정된 세션(officialLocked): 수정 불가.
    //   경기 전(진행/완료 경기 없음): 바로 저장.
    //   진행 중/완료 경기 존재: 최초 변경 시 1회 확인(현재/변경 금액 + 영향 범위). 취소하면 변경하지 않는다.
    //   ⚠️ 게스트비만 재계산에 반영되며 점수·대진·순위·벌금 자체는 바뀌지 않는다.
    //   상태(setGuestFee)는 DB 저장이 실제 성공했을 때만 갱신한다(저장 실패를 성공처럼 보이게 하지 않는다).
    const changeGuestFee = async (next: number) => {
        if (officialLocked) {
            alert(OFFICIAL_LOCK_MSG);
            return;
        }
        const fee = Math.max(0, Math.trunc(next));
        const hasProgress = matches.some(m => m.status === 'playing' || m.status === 'complete');
        if (hasProgress && !guestFeeEditAckRef.current) {
            const currentLabel = guestFee == null ? '미설정' : `${guestFee.toLocaleString()}원`;
            const ok = window.confirm(
                '이미 진행 중이거나 완료된 경기가 있습니다.\n\n' +
                `현재 게스트비: ${currentLabel}\n` +
                `변경할 게스트비: ${fee.toLocaleString()}원\n\n` +
                '영향 범위: 순위표·결과·정산의 게스트비 금액이 다시 계산됩니다.\n' +
                '점수·대진·순위·벌금 자체는 바뀌지 않습니다.\n\n' +
                '변경하시겠습니까?'
            );
            if (!ok) return;
            guestFeeEditAckRef.current = true;
        }
        // 저장 성공 시에만 화면 값 갱신. 실패(잠금/컬럼 미적용/오류)는 saveGuestFee 가 알린다.
        const saved = await saveGuestFee(fee);
        if (saved) setGuestFee(fee);
    };

    // 정모 연결 변경 — 운영진이 명시적으로 선택한 경우만 저장. 자동 추정 금지.
    // 1:1 보장 — 이미 다른 KDK 세션이 연결된 정모를 선택하면 안내 후 저장 중단.
    const saveLinkedSchedule = async (scheduleId: string | null) => {
        if (!activeSessionId) return;
        if (!guardWriteAction('공식 기록 연결')) return; // 촬영 보호 모드 차단
        setLinkSaving(true);
        try {
            if (scheduleId) {
                // 다른 세션이 이미 이 정모에 연결돼 있는지 사전 점검 (unique partial index 위반 회피).
                const { data: existing, error: checkErr } = await supabase
                    .from('kdk_session_meta')
                    .select('session_id')
                    .eq('club_schedule_id', scheduleId)
                    .neq('session_id', activeSessionId)
                    .limit(1)
                    .maybeSingle();
                if (checkErr) {
                    const msg = `${checkErr.message || ''} ${checkErr.details || ''}`;
                    if (!/club_schedule_id/i.test(msg)) {
                        throw checkErr;
                    }
                    // 컬럼 미적용 환경은 아래 upsert 단계에서 처리.
                }
                if (existing?.session_id) {
                    alert('이 정모에는 이미 연결된 KDK 세션이 있습니다.');
                    return;
                }
            }
            const { error } = await supabase
                .from('kdk_session_meta')
                .upsert(
                    {
                        session_id: activeSessionId,
                        club_id: clubId,
                        club_schedule_id: scheduleId,
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'session_id' }
                );
            if (error) {
                const msg = `${error.message || ''} ${error.details || ''}`;
                if (/club_schedule_id/i.test(msg)) {
                    alert('정모 연결 컬럼이 운영 DB에 아직 없습니다. supabase/add_kdk_session_club_schedule_link.sql 을 적용해 주세요.');
                } else if (/duplicate key/i.test(msg) || /unique/i.test(msg)) {
                    // 동시성 등으로 unique 위반 — 안전 안내.
                    alert('이 정모에는 이미 연결된 KDK 세션이 있습니다.');
                } else {
                    throw error;
                }
            } else {
                setLinkedScheduleId(scheduleId);
                // 단일 출처 정책: 정모 연결만 저장하고 게스트비는 자동 시드/저장하지 않는다(§6).
                //   게스트비는 KDK 설정에서 운영자가 직접 입력해야 확정된다. 미입력이면 guest_fee=null(미설정).
            }
        } catch (e: any) {
            alert(e?.message || '정모 연결 저장에 실패했습니다.');
        } finally {
            setLinkSaving(false);
        }
    };

    const saveTickerMsg = async () => {
        if (!activeSessionId) return;
        if (!guardWriteAction('전광판 메시지 저장')) return; // 촬영 보호 모드 차단
        setTickerSaving(true);
        try {
            const { error } = await supabase
                .from('kdk_session_meta')
                .upsert(
                    { session_id: activeSessionId, club_id: clubId, ticker_message: tickerMsg.trim(), updated_at: new Date().toISOString() },
                    { onConflict: 'session_id' }
                );
            if (error) throw error;
            setTickerSaveOk(true);
            setTimeout(() => setTickerSaveOk(false), 2000);
        } catch {
            // silent
        } finally {
            setTickerSaving(false);
        }
    };

    // 조별 전용 코트 토글 — 빈 groups 로 켜면 A/B 기본 칸 노출. 저장은 별도 버튼에서.
    const toggleGroupCourtsEnabled = (next: boolean) => {
        setGroupCourts(prev => {
            if (!next) return { ...prev, enabled: false };
            // 켤 때 groups 가 비어 있으면 A/B 빈 배열을 만들어 UI 가 두 조를 노출하게 한다.
            const groups = (prev.groups && Object.keys(prev.groups).length > 0)
                ? prev.groups
                : { A: [], B: [] };
            return { enabled: true, groups };
        });
    };

    // 특정 조의 코트 번호 토글(선택/해제).
    const toggleGroupCourt = (group: string, court: number) => {
        setGroupCourts(prev => {
            const cur = prev.groups[group] || [];
            const exists = cur.includes(court);
            const nextArr = exists ? cur.filter(c => c !== court) : [...cur, court].sort((a, b) => a - b);
            return { ...prev, groups: { ...prev.groups, [group]: nextArr } };
        });
    };

    // 조별 코트 설정 저장 — 입력 검증 후 kdk_session_meta.group_courts upsert.
    //   변경은 다음 신규 투입부터 적용(진행 중 경기 코트는 건드리지 않음).
    const saveGroupCourts = async () => {
        if (!activeSessionId) return;
        if (!guardWriteAction('조별 코트 설정 저장')) return; // 촬영 보호 모드 차단
        // 검증: 활성 상태에서는 각 조에 최소 1개 코트, 조 간 코트 중복 금지(1차 정책).
        if (groupCourts.enabled) {
            const activeGroups = Object.keys(groupCourts.groups);
            for (const g of activeGroups) {
                if ((groupCourts.groups[g] || []).length === 0) {
                    alert(`${g}조에 사용할 코트를 1개 이상 선택해주세요.`);
                    return;
                }
            }
            const seen = new Map<number, string>();
            for (const g of activeGroups) {
                for (const c of (groupCourts.groups[g] || [])) {
                    if (seen.has(c)) {
                        alert('같은 코트를 여러 조에 중복 지정할 수 없습니다.');
                        return;
                    }
                    seen.set(c, g);
                }
            }
        }
        setGroupCourtsSaving(true);
        try {
            // 저장 payload — 코트 번호는 정수/양수/조 내 중복 제거 후 정렬(normalize 와 동일 규칙).
            const cleanGroups: Record<string, number[]> = {};
            for (const g of Object.keys(groupCourts.groups)) {
                cleanGroups[g] = Array.from(new Set(
                    (groupCourts.groups[g] || [])
                        .map(n => Math.trunc(Number(n)))
                        .filter(n => Number.isInteger(n) && n > 0)
                )).sort((a, b) => a - b);
            }
            const payload = { enabled: groupCourts.enabled, groups: cleanGroups };
            const { error } = await supabase
                .from('kdk_session_meta')
                .upsert(
                    { session_id: activeSessionId, club_id: clubId, group_courts: payload, updated_at: new Date().toISOString() },
                    { onConflict: 'session_id' }
                );
            if (error) {
                const msg = `${error.message || ''} ${error.details || ''}`;
                if (/group_courts/i.test(msg)) {
                    alert('조별 코트 컬럼이 운영 DB에 아직 없습니다. supabase/add_kdk_group_courts.sql 을 적용해 주세요.');
                } else {
                    throw error;
                }
                return;
            }
            setGroupCourts({ enabled: payload.enabled, groups: payload.groups });
            setGroupCourtsSaveOk(true);
            setTimeout(() => setGroupCourtsSaveOk(false), 2000);
        } catch (e: any) {
            alert(e?.message || '조별 코트 설정 저장에 실패했습니다.');
        } finally {
            setGroupCourtsSaving(false);
        }
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

    const getArchiveUrl = (targetSessionId = sessionId) => {
        const archiveSessionId = targetSessionId?.trim();
        if (!archiveSessionId) return null;
        const path = `/archive?session=${encodeURIComponent(archiveSessionId)}`;
        if (typeof window === 'undefined') return path;
        return `${window.location.origin}${path}`;
    };

    const openArchiveSuccessLink = () => {
        const archiveUrl = archiveSuccessUrl || getArchiveUrl(sessionId);
        if (!archiveUrl) {
            alert("Archive 링크를 만들 수 없습니다.");
            return;
        }
        window.location.href = archiveUrl;
    };

    const copyArchiveSuccessLink = async () => {
        const archiveUrl = archiveSuccessUrl || getArchiveUrl(sessionId);
        if (!archiveUrl) {
            alert("Archive 링크를 만들 수 없습니다.");
            return;
        }

        try {
            await navigator.clipboard.writeText(archiveUrl);
            alert("Archive 링크가 복사되었습니다.");
        } catch {
            alert(`Archive 링크: ${archiveUrl}`);
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
    // 공식 기록 확정 요청 — 곧바로 저장하지 않고 확인 모달을 연다.
    //   guestFee null 차단은 기존 정책 유지(모달 이전에 차단). 요약은 기존 정산식(computeSettlement) 재사용.
    const requestFinalArchive = () => {
        if (!guardWriteAction('공식 기록 확정/아카이브')) return; // 촬영 보호 모드 차단
        if (guestFee == null) {
            alert('게스트비가 설정되지 않았습니다.\n\nKDK 설정에서 이번 게스트비를 입력한 후 결과를 확정해주세요.');
            return;
        }
        // 벌금 요약 — 화면/Archive 와 동일한 정산식. 게스트비와 합치지 않고 벌금(penaltyAmount)만 집계.
        const settlementPrizes = { first: firstPrize, l1: bottom25Late, l2: bottom25Penalty };
        const total = resolvedRanking.length;
        let penaltyCount = 0;
        let penaltyTotal = 0;
        resolvedRanking.forEach((p, idx) => {
            const s = computeSettlement(p, idx, total, settlementPrizes, guestFee);
            if (s.penaltyAmount < 0) { penaltyCount += 1; penaltyTotal += Math.abs(s.penaltyAmount); }
        });
        const now = new Date();
        const dateLabel = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
        setFinalizeSummary({
            title: sessionTitle || 'KDK 세션',
            dateLabel,
            participants: total,
            matchCount: matches.length,
            winner: resolvedRanking[0]?.name ?? null,
            guestFee,
            penaltyCount,
            penaltyTotal,
        });
        setShowFinalizeConfirm(true);
    };

    const handleFinalArchive = async () => {
        if (!guardWriteAction('공식 기록 확정/아카이브')) return; // 촬영 보호 모드 차단
        // 게스트비 미설정(null)이면 공식 확정 차단 — settlement_data 에 임의 금액(10,000)을 박제하지 않는다.
        //   0원은 유효한 확정값이므로 차단하지 않는다(== null 로만 판단). (확인 모달 이전에도 이미 차단됨)
        if (guestFee == null) {
            alert('게스트비가 설정되지 않았습니다.\n\nKDK 설정에서 이번 게스트비를 입력한 후 결과를 확정해주세요.');
            return;
        }
        setShowFinalizeConfirm(false); // 확인 모달을 닫고 저장을 시작한다.

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

            // 1-b. 정산 스냅샷 — 확정 시점의 상금/벌금/게스트비/최종 금액을 박제.
            //      RankingTab 과 동일한 정산식(lib/kdk/settlement)을 그대로 사용하며,
            //      화면과 동일한 prizes(firstPrize / bottom25Late=L1 / bottom25Penalty=L2)를 적용한다.
            const settlementPrizes = { first: firstPrize, l1: bottom25Late, l2: bottom25Penalty };
            const totalRankedPlayers = resolvedRanking.length;
            const settlementSnapshot = resolvedRanking.map((p, idx) => {
                const s = computeSettlement(p, idx, totalRankedPlayers, settlementPrizes, guestFee);
                return {
                    player_id: p.id ?? null,
                    player_name: p.name,
                    is_guest: isGuestRankedPlayer(p),
                    is_associate_guest_fee_member: isAssociateGuestFeeMember(p),
                    rank: idx + 1,
                    wins: p.wins || 0,
                    losses: p.losses || 0,
                    points_for: (p as any).pf || 0,
                    points_against: (p as any).pa || 0,
                    diff: p.diff || 0,
                    penalty_level: s.penaltyLevel,
                    penalty_amount: s.penaltyAmount,
                    guest_fee_amount: s.guestFeeAmount,
                    prize_amount: s.prizeAmount,
                    final_amount: s.finalAmount,
                };
            });

            const rawDataPayload = {
                title: sessionTitle || `Tournament ${dateStr}`,
                date: dateStr,
                ranking_data: rankingSnapshot,
                settlement_data: settlementSnapshot,
                settlement_meta: {
                    guest_fee: guestFee,
                    prizes: settlementPrizes,
                    generated_at: new Date().toISOString(),
                },
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

            // 서버 저장이 실제 확인됐을 때만 완료 화면을 띄운다(로컬 백업만으론 성공으로 표시하지 않음).
            let serverArchived = false;
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
                serverArchived = true;
            } catch (err: any) {
                console.error("❌ [v14.0] CRITICAL SYNC ERROR:", err);
                // 서버 Archive 저장 미확인 — 로컬 백업만 성공. 성공으로 표시하지 않고 재시도를 안내한다.
                alert(`로컬 백업은 완료되었지만 Archive 저장을 확인하지 못했습니다.\n잠시 후 다시 시도해주세요. (${err.message})`);
            }

            // 서버 저장이 확인된 경우에만 완료 화면 + 라이브 정리.
            //   서버 미확인(로컬 백업만): 성공 화면/정리 없이 종료 → 결과·라이브 데이터·로컬 백업 유지, 재시도 가능.
            //   (payload / 저장 순서 / 로컬 백업 정책은 변경하지 않는다.)
            if (!serverArchived) {
                return; // finally 에서 setIsGenerating(false).
            }

            // [v10.0] Championship Celebration
            const archiveUrl = getArchiveUrl(sessionId);
            if (archiveUrl) setArchiveSuccessUrl(archiveUrl);
            setShowArchiveSuccess(true);
            setShowConfetti(true);
            setCelebrationMode(true);
            if (window.navigator?.vibrate) window.navigator.vibrate([200, 100, 200, 100, 200]);

            // 3. Cleanup Live Data from Supabase (서버 저장 확인 후에만 라이브 데이터 삭제)
            const { error: delError } = await supabase.from('matches').delete().eq('session_id', sessionId);
            if (delError) console.error("Cleanup Error (Non-Fatal):", delError);

            // 4. Clear live-session cache while keeping Archive actions visible.
            localStorage.removeItem('kdk_live_session');

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
        if (!guardWriteAction('세션 초기화')) return; // 촬영 보호 모드 차단
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
            if (hasSavedLiveSession) {
                // Do not restore live matches from device-local cache.
                // Supabase active sessions are the source of truth across devices.
                setHasRestoredSession(true);
                return true;
            } else if (data.step) {
                if (data.matches) setMatches(data.matches || []);
                if (data.attendeeConfigs) setAttendeeConfigs(data.attendeeConfigs || {});
                if (data.selectedIds) setSelectedIds(new Set(data.selectedIds || []));
                if (data.tempGuests) setTempGuests(data.tempGuests || []);
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
                setSessionSelectorBackTarget(null);
                setCreateBackTarget(null);
                updateKdkEntryMode('LIVE');
                setActiveTab('MATCHES');
                setStep(3);
                setShowGateway(false);
                window.history.replaceState(null, '', window.location.pathname);
            } else if (entryMode === 'create') {
                setSessionSelectorBackTarget(null);
                setCreateBackTarget('MAIN');
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
        const currentSid = (showGateway || kdkEntryMode === 'CHOOSE' || kdkEntryMode === 'CHECKING') ? null : activeSessionId;
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
                // [동시 조작 안정화] 이벤트마다 즉시 재조회하지 않고 220ms debounce 후 1회만 재조회.
                if (currentSid && updatedSessionId === currentSid) {
                    scheduleRealtimeRefresh(() => fetchMatches(currentSid));
                } else if (currentSid) {
                } else if (!currentSid) {
                    scheduleRealtimeRefresh(() => syncActiveSession());
                }
            })
            .subscribe((status) => {
                console.log('[KDK Realtime] status:', status);
            });

        return () => {
            clearInterval(timer);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            if (realtimeRefreshTimerRef.current) clearTimeout(realtimeRefreshTimerRef.current);
            supabase.removeChannel(matchesChannel);
        };
    }, [activeSessionId, showGateway, kdkEntryMode]);

    // 전광판 ticker 메시지: 세션 진입 시 로드
    useEffect(() => {
        if (activeSessionId && kdkEntryMode === 'LIVE') {
            loadTickerMsg(activeSessionId);
        }
    }, [activeSessionId, kdkEntryMode]);

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

    // uid 최신값 동기화(비동기 syncActiveSession 복원 로직에서 참조).
    useEffect(() => { uidRef.current = uid; }, [uid]);

    // LIVE COURT 복원값 저장 — 세션 운영 화면(선택된 세션 + 게이트웨이 아님)을 보는 동안 마지막 세션/탭 기록.
    //   entry=live 진입이든 게이트웨이 선택이든 모두 포함. 경기 데이터는 저장하지 않고 sessionId/tab 만 저장.
    useEffect(() => {
        if (selectedSessionId && !showGateway && uid) {
            writeLastLiveSession(uid, { sessionId: selectedSessionId, tab: activeTab, at: Date.now() });
        }
    }, [selectedSessionId, showGateway, activeTab, uid]);

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

    const normalizeStoredKdkGroup = (value?: string) => {
        const raw = String(value || '').trim().toUpperCase();
        if (raw.includes('BLUE') || raw === 'B' || raw.startsWith('B조'.toUpperCase())) return 'B';
        if (raw.includes('GOLD') || raw === 'A' || raw.startsWith('A조'.toUpperCase())) return 'A';
        if (raw.includes('B')) return 'B';
        if (raw.includes('A')) return 'A';
        return '';
    };

    const manualGroupCacheRef = useRef<Record<string, Record<string, string>>>({});
    const manualSessionIdsRef = useRef<Set<string>>(new Set());

    const getManualGroupCacheKey = (targetSessionId: string) => `kdk_manual_group_cache_${targetSessionId}`;
    const getManualSessionIdsKey = () => 'kdk_manual_session_ids';

    const rememberManualSessionId = (targetSessionId?: string) => {
        if (!targetSessionId) return;
        manualSessionIdsRef.current.add(targetSessionId);
        try {
            localStorage.setItem(getManualSessionIdsKey(), JSON.stringify(Array.from(manualSessionIdsRef.current)));
        } catch {}
    };

    const hydrateManualSessionIds = () => {
        if (manualSessionIdsRef.current.size > 0) return;
        try {
            const raw = localStorage.getItem(getManualSessionIdsKey());
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                manualSessionIdsRef.current = new Set(parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0));
            }
        } catch {}
    };

    const isManualSession = (targetSessionId?: string) => {
        if (!targetSessionId) return false;
        hydrateManualSessionIds();
        return manualSessionIdsRef.current.has(targetSessionId);
    };

    const persistManualGroupCache = (targetSessionId: string, groupMap: Record<string, string>) => {
        if (!targetSessionId || Object.keys(groupMap).length === 0) return;
        manualGroupCacheRef.current[targetSessionId] = {
            ...(manualGroupCacheRef.current[targetSessionId] || {}),
            ...groupMap,
        };
        try {
            localStorage.setItem(getManualGroupCacheKey(targetSessionId), JSON.stringify(manualGroupCacheRef.current[targetSessionId]));
        } catch {}
    };

    const loadManualGroupCache = (targetSessionId?: string) => {
        if (!targetSessionId) return {};
        if (manualGroupCacheRef.current[targetSessionId]) {
            return manualGroupCacheRef.current[targetSessionId];
        }
        try {
            const raw = localStorage.getItem(getManualGroupCacheKey(targetSessionId));
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                manualGroupCacheRef.current[targetSessionId] = parsed;
                return parsed;
            }
        } catch {}
        return {};
    };

    const getManualGroupFromCache = (targetSessionId?: string, matchId?: string) => {
        if (!targetSessionId || !matchId) return '';
        const cache = loadManualGroupCache(targetSessionId);
        return normalizeStoredKdkGroup(cache[String(matchId)]);
    };

    const buildGroupCacheFromRows = (rows: any[]) =>
        rows.reduce<Record<string, string>>((acc, row) => {
            const group = normalizeStoredKdkGroup(row?.group_name || row?.groupName || row?.group);
            if (row?.id && group) acc[String(row.id)] = group;
            return acc;
        }, {});

    const buildGroupCacheFromMatches = (sourceMatches: Match[]) =>
        sourceMatches.reduce<Record<string, string>>((acc, match) => {
            const group = normalizeStoredKdkGroup(match.groupName || (match as any).group);
            if (match?.id && group) acc[String(match.id)] = group;
            return acc;
        }, {});

    const resolveDbMatchGroupName = (row: any) => {
        const direct = normalizeStoredKdkGroup(row?.group_name || row?.groupName || row?.group);
        if (direct) return direct;

        const cached = getManualGroupFromCache(row?.session_id, String(row?.id ?? ''));
        if (cached) {
            console.warn('[Manual KDK Group Restore] Restored missing group from cache', {
                id: row?.id,
                session_id: row?.session_id,
                restored_group: cached,
            });
            return cached;
        }

        console.warn('[Manual KDK Group Missing] Falling back to A', {
            id: row?.id,
            session_id: row?.session_id,
            group_name: row?.group_name,
            groupName: row?.groupName,
        });
        return 'A';
    };

    const mapDbMatchToMatch = (m: any): Match => ({
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
        groupName: resolveDbMatchGroupName(m)
    });

    const fetchMatches = async (targetSessionId: string) => {
        if (!targetSessionId) return;
        const seq = ++fetchMatchesSeqRef.current; // 최신 요청 식별

        try {
            const { data, error } = await supabase
                .from('matches')
                .select('*')
                .eq('club_id', clubId)
                .eq('session_id', targetSessionId)
                .order('round', { ascending: true })
                .order('court', { ascending: true });

            if (error) throw error;

            // stale 응답 폐기: 이 요청 이후 더 최신 fetch 가 시작됐으면 반영하지 않음
            // (연속 Realtime 이벤트 / 세션 전환 시 이전 snapshot 이 최신 화면을 덮는 것 방지).
            if (seq !== fetchMatchesSeqRef.current) return;

            persistManualGroupCache(targetSessionId, buildGroupCacheFromRows(data || []));
            const mappedMatches = (data || []).map(mapDbMatchToMatch);

            setMatches(mappedMatches);
            setLastSyncTime(new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        } catch (err) {
            console.error('[KDK Realtime] fetchMatches failed:', err);
        }
    };

    const syncActiveSession = async () => {
        try {
            const { data, error } = await supabase
                .from('matches')
                .select('*')
                .eq('club_id', clubId);

            if (error) throw error;

            const rows = data || [];
            const latestEntryMode = kdkEntryModeRef.current;

            if (rows.length === 0) {
                setAllActiveSessions([]);
                setHasRestoredSession(false);
                if (latestEntryMode === 'LIVE') {
                    clearLastLiveSession(uidRef.current); // 활성 세션 0개 → 저장된 복원 세션 폐기
                    setSelectedSessionId(null);
                    setMatches([]);
                    setShowGateway(true);
                    setStep(3);
                } else if (latestEntryMode === 'CHECKING' || latestEntryMode === 'CHOOSE') {
                    setSelectedSessionId(null);
                    setMatches([]);
                    setShowGateway(false);
                    setCreateBackTarget('MAIN');
                    setSessionSelectorBackTarget(null);
                    updateKdkEntryMode('CREATE');
                    setStep(0);
                }
                setSyncStatus('IDLE');
                return;
            }

            const sessionsMap: Record<string, { id: string, title: string, matches: any[], players: Set<string>, lastActivity: string }> = {};

            rows.forEach((m: any) => {
                const sId = m.session_id || 'LEGACY';
                const activity = m.updated_at || m.match_date || m.created_at || '';
                if (!sessionsMap[sId]) {
                    sessionsMap[sId] = {
                        id: sId,
                        title: m.session_title || 'Unnamed Tournament',
                        matches: [],
                        players: new Set(),
                        lastActivity: activity,
                    };
                }
                sessionsMap[sId].matches.push(m);
                const currentActivity = Date.parse(sessionsMap[sId].lastActivity || '');
                const nextActivity = Date.parse(activity || '');
                if (!Number.isFinite(currentActivity) || (Number.isFinite(nextActivity) && nextActivity > currentActivity)) {
                    sessionsMap[sId].lastActivity = activity;
                }
                (m.player_ids || m.playerIds || []).forEach((pid: string) => sessionsMap[sId].players.add(pid));
            });

            const sessionList = Object.values(sessionsMap)
                .map(s => ({
                    id: s.id,
                    title: s.title,
                    matchCount: s.matches.length,
                    playerCount: s.players.size,
                    lastActivity: s.lastActivity,
                }))
                .sort((a, b) => new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime());

            setAllActiveSessions(prev => {
                const nextJson = JSON.stringify(sessionList);
                if (JSON.stringify(prev) === nextJson) return prev;
                return sessionList;
            });

            setHasRestoredSession(true);

            const applySession = (targetSessionId: string) => {
                const currentSession = sessionsMap[targetSessionId];
                if (!currentSession) return false;

                const localGroupCache = selectedSessionId === targetSessionId || sessionId === targetSessionId
                    ? buildGroupCacheFromMatches(matches)
                    : {};
                persistManualGroupCache(targetSessionId, buildGroupCacheFromRows(currentSession.matches));
                persistManualGroupCache(targetSessionId, localGroupCache);

                const refreshingMatches = currentSession.matches.map(mapDbMatchToMatch);

                const guestMappings: Record<string, string> = {};
                refreshingMatches.forEach((rm: any) => {
                    rm.playerIds.forEach((pid: string, idx: number) => {
                        if (pid?.startsWith('g-') || pid?.startsWith('manual-guest-')) {
                            const rawName = rm.playerNames?.[idx] || pid.replace(/^manual-guest-/, '');
                            const cleanName = rawName.replace(/^manual-guest-/, '').replace(/\s*\(G\)$/i, '').replace(/\s+g$/i, '').trim();
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
                setSessionId(currentSession.id);
                setSessionTitle(currentSession.title);
                setSelectedSessionId(currentSession.id);
                setShowGateway(false);
                setStep(3);
                return true;
            };

            if (latestEntryMode === 'CREATE') {
                // Creation flow is isolated from active session restore.
            } else if (selectedSessionId) {
                if (!applySession(selectedSessionId)) {
                    setSelectedSessionId(null);
                    setMatches([]);
                    if (latestEntryMode === 'LIVE') {
                        setShowGateway(true);
                        setStep(3);
                    } else if (latestEntryMode === 'CHECKING') {
                        updateKdkEntryMode('CHOOSE');
                        setStep(3);
                    }
                }
            } else if (latestEntryMode === 'LIVE') {
                // LIVE COURT 복원 우선순위:
                //   (1) 마지막으로 보던 세션이 아직 활성 → 바로 복귀(+마지막 탭)
                //   (2) 없거나 stale → 가장 최근 활성 세션 자동 진입(섹션 선택 화면 생략)
                // sessionList 는 lastActivity desc 정렬이며, 이 분기는 rows.length>0(활성 세션 존재)에서만 도달.
                const stored = readLastLiveSession(uidRef.current);
                if (stored?.sessionId && sessionsMap[stored.sessionId]) {
                    applySession(stored.sessionId);
                    setActiveTab(stored.tab);
                } else {
                    if (stored?.sessionId) clearLastLiveSession(uidRef.current); // 완료/삭제/접근불가 세션 → 저장값 폐기
                    applySession(sessionList[0].id);
                }
            } else if (latestEntryMode === 'CHECKING') {
                setCreateBackTarget(null);
                setSessionSelectorBackTarget(null);
                updateKdkEntryMode('CHOOSE');
                setShowGateway(false);
                setStep(3);
            } else if (latestEntryMode === 'CHOOSE') {
                setShowGateway(false);
                setStep(3);
            }

            setLastSyncTime(new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));

            const hasModernMetadata = sessionList.length > 0 && rows.some((m: any) => m.player_names && m.player_names.length > 0);
            if (sessionList.length > 0 && !hasModernMetadata) {
                setIsLegacySync(true);
                setSyncStatus('WARNING');
            } else {
                setIsLegacySync(false);
                setSyncStatus('HEALTHY');
                setSyncErrorMsg(null);
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
            setSessionSelectorBackTarget(null);
            setCreateBackTarget(null);
            setSelectedSessionId(sId);
            setShowGateway(false);
            setSessionId(sId);
            setSessionTitle(target.title);
            updateKdkEntryMode('LIVE');
            setStep(3);
            fetchMatches(sId);
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

    const returnToEntryChoice = () => {
        setSelectedSessionId(null);
        setMatches([]);
        setShowGateway(false);
        setGenerationMode(null);
        setManualInputMode(null);
        setManualStep('INPUT');
        setSessionSelectorBackTarget(null);
        setCreateBackTarget(null);
        setActiveTab('MATCHES');
        updateKdkEntryMode('CHOOSE');
        setStep(3);
    };

    const handleGenerationModeBack = () => {
        if (createBackTarget === 'ENTRY_CHOICE' || allActiveSessions.length > 0) {
            returnToEntryChoice();
            return;
        }

        router.push('/');
    };

    const openExistingLiveCourt = () => {
        setSessionSelectorBackTarget('ENTRY_CHOICE');
        setCreateBackTarget(null);
        updateKdkEntryMode('LIVE');
        setActiveTab('MATCHES');
        setStep(3);
        if (allActiveSessions.length === 1) {
            enterSession(allActiveSessions[0].id);
        } else if (allActiveSessions.length > 1) {
            setSelectedSessionId(null);
            setMatches([]);
            setShowGateway(true);
        } else {
            setSelectedSessionId(null);
            setMatches([]);
            setShowGateway(true);
        }
    };

    const startNewKdkCreation = () => {
        if (!isAdmin) {
            triggerAccessDenied("새로운 경기는 관리자만 생성 가능합니다.");
            return;
        }

        setCreateBackTarget(kdkEntryModeRef.current === 'CHOOSE' ? 'ENTRY_CHOICE' : 'MAIN');
        setSessionSelectorBackTarget(null);
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

    const handleDeleteActiveSession = async () => {
        if (!sessionDeleteTarget) return;
        if (isDeletingSession) return; // 처리 중 중복 클릭 방지
        if (!guardWriteAction('세션 삭제')) { setSessionDeleteTarget(null); return; } // 촬영 보호 모드 차단
        if (!isAdmin) {
            triggerAccessDenied("진행 중인 세션 삭제는 관리자만 가능합니다.");
            setSessionDeleteTarget(null);
            return;
        }

        const target = sessionDeleteTarget;
        setIsDeletingSession(true);
        try {
            // matches 는 RLS 로 직접 DELETE 가 막혀 있어, SECURITY DEFINER RPC 로 삭제한다.
            // (공식 Archive 는 건드리지 않고 라이브 matches 행만 제거 → 세션이 목록에서 사라짐)
            let deletedCount = 0;

            const rpcRes = await supabase.rpc('delete_kdk_live_session', {
                p_session_id: target.id,
                p_club_id: clubId,
            });

            if (!rpcRes.error) {
                // RPC 반환값 = 실제 삭제된 matches 행 수.
                deletedCount = typeof rpcRes.data === 'number' ? rpcRes.data : Number(rpcRes.data ?? 0);
            } else {
                const err: any = rpcRes.error;
                const code = err.code || '';
                const detail = `${err.message || ''} ${err.details || ''}`;
                // 내부 콘솔에는 실제 code / message / details 를 남긴다.
                console.error('[KDK] delete_kdk_live_session RPC error:', { code, message: err.message, details: err.details, hint: err.hint });

                const notDeployed = code === 'PGRST202' || /could not find the function|schema cache/i.test(detail);
                const noPermission = code === '42501' || /not authorized|permission denied/i.test(detail);

                if (noPermission) {
                    throw new Error('세션 삭제 권한이 없습니다.');
                }
                if (!notDeployed) {
                    throw new Error('진행 중인 세션 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.');
                }
                // PGRST202(함수 미배포)일 때만 직접 DELETE 폴백 + .select() 로 삭제 행 검증.
                console.warn('[KDK] delete_kdk_live_session RPC 미배포 — 직접 DELETE 폴백');
                const { data: delRows, error: delError } = await supabase
                    .from('matches')
                    .delete()
                    .eq('club_id', clubId)
                    .eq('session_id', target.id)
                    .select('id');
                if (delError) {
                    console.error('[KDK] fallback DELETE error:', { code: (delError as any).code, message: delError.message, details: (delError as any).details });
                    throw new Error('세션 삭제 함수가 준비되지 않았습니다. 관리자에게 문의해주세요.');
                }
                deletedCount = (delRows || []).length;
                // 폴백도 0건이면(RLS 차단 등) 성공으로 처리하지 않는다.
                if (deletedCount === 0) {
                    throw new Error('세션 삭제 함수가 준비되지 않았습니다. 관리자에게 문의해주세요.');
                }
            }

            // 서버에서 실제 삭제가 0건이면 성공으로 처리하지 않는다 — 목록에 다시 나타나는 원인.
            if (deletedCount === 0) {
                throw new Error('삭제할 경기 데이터가 없습니다. 최신 상태를 다시 확인해주세요.');
            }

            // 삭제 확정 → 로컬 상태/캐시 정리 후 전체 재조회(Realtime 만 기다리지 않음).
            if (selectedSessionId === target.id || sessionId === target.id) {
                setSelectedSessionId(null);
                setMatches([]);
                localStorage.removeItem('kdk_live_session');
                updateKdkEntryMode('LIVE');
                setShowGateway(true);
                setStep(3);
            }
            setAllActiveSessions(prev => prev.filter(session => session.id !== target.id));
            await syncActiveSession();
            alert('세션이 삭제되었습니다.');
        } catch (error: any) {
            console.error('[KDK] Active session delete failed:', error?.code, error?.message, error);
            alert(error?.message || '진행 중인 세션 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        } finally {
            setIsDeletingSession(false);
            setSessionDeleteTarget(null);
        }
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
        const name = trimmed.replace(/^manual-guest-/i, '').replace(/\s*\(G\)$/i, '').replace(/\s+g$/i, '').trim();
        return name ? `${name}(G)` : "게스트(G)";
    };

    const stripGuestSuffix = (value?: string) => {
        return (value || "").replace(/\s*\(G\)$/i, '').replace(/\s+g$/i, '').trim();
    };

    const isGenericGuestDisplayName = (value?: string) => {
        const normalized = stripGuestSuffix(value).trim();
        return normalized.toLowerCase() === 'guest' || normalized === '게스트';
    };

    const cleanDisplayName = (value?: string) => {
        const manualGuestName = getManualGuestDisplayName(value);
        if (manualGuestName) return stripGuestSuffix(manualGuestName);
        const cleaned = stripGuestSuffix(value);
        return cleaned && !isLikelyPlayerId(cleaned) && !isGenericGuestDisplayName(cleaned) ? cleaned : "";
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

    const normalizeKdkGroup = (value?: string) => normalizeStoredKdkGroup(value) || 'A';

    const getGroupedMatchesForDisplay = (groupValue?: string) => {
        const normalizedGroup = normalizeKdkGroup(groupValue);
        return matches
            .filter(mx => normalizeKdkGroup(mx.groupName || (mx as any).group) === normalizedGroup)
            .sort((a, b) => {
                if ((a.round || 0) !== (b.round || 0)) return (a.round || 0) - (b.round || 0);
                if ((a.court || 99) !== (b.court || 99)) return (a.court || 99) - (b.court || 99);
                return String(a.id || '').localeCompare(String(b.id || ''));
            });
    };

    const getDisplayMatchNo = (match: Match) => {
        const groupedMatches = getGroupedMatchesForDisplay(match.groupName || (match as any).group);
        const index = groupedMatches.findIndex(item => item.id === match.id);
        return index >= 0 ? index + 1 : 1;
    };

    const getFallbackGroupFromSupportData = (match: Match) => {
        const firstPlayerId = match.playerIds?.[0];
        if (!firstPlayerId) return null;
        const attendeeGroup = attendeeConfigs[firstPlayerId]?.group;
        if (attendeeGroup) return attendeeGroup;
        const memberPosition = allMembers.find(member => member.id === firstPlayerId)?.position;
        return memberPosition || null;
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
        if (!guardWriteAction('대진 생성/저장')) return; // 촬영 보호 모드 차단
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

            persistManualGroupCache(sessionId, buildGroupCacheFromMatches(formattedMatches));

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
        if (!guardWriteAction('수동 대진 저장')) return; // 촬영 보호 모드 차단

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
            const manualRoundByTime = new Map<string, number>();
            let nextManualRound = 1;

            const formattedMatches = manualPastePreview.map((row, index) => {
                const group = normalizeManualGroup(row.group);
                const roundKey = row.time?.trim() ? `TIME_${row.time.trim()}` : `ORDER_${row.order || index + 1}`;
                if (!manualRoundByTime.has(roundKey)) {
                    manualRoundByTime.set(roundKey, nextManualRound++);
                }
                const round = manualRoundByTime.get(roundKey) || 1;
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
                    round,
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

            const manualGroupCache = formattedMatches.reduce<Record<string, string>>((acc, match) => {
                const group = normalizeStoredKdkGroup(match.groupName);
                if (group) acc[String(match.id)] = group;
                return acc;
            }, {});

            rememberManualSessionId(manualSessionId);
            persistManualGroupCache(manualSessionId, manualGroupCache);

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
        if (isStartingMatch) return;                  // 전역 투입 진행 중(코트 계산 충돌 완화)
        if (!guardWriteAction('코트 투입/경기 시작')) return; // 촬영 보호 모드 차단
        const lockKey = `start:${matchId}`;
        if (!beginAction(lockKey)) return;            // 같은 경기 더블탭 동기 차단

        try {
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

            setIsStartingMatch(true);

            // [2차] 원자적 투입 RPC — 코트 번호는 DB 가 최종 결정. 로컬 코트 계산/optimistic 없음.
            //   세션 단위 advisory lock 으로 동시 투입 직렬화 + 선수 중복/상태 전제조건을 서버에서 검사.
            //   ⚠️ RPC 미배포 시 직접 update 로 fallback 하지 않는다(원자성 보호).
            const { data, error: rpcError } = await supabase.rpc('start_kdk_match', {
                p_match_id: String(matchId),
                p_club_id: clubId,
            });

            if (rpcError) {
                const code = (rpcError as any).code || '';
                const detail = `${rpcError.message || ''} ${(rpcError as any).details || ''}`;
                console.error('[KDK] start_kdk_match RPC error:', { code, message: rpcError.message, details: (rpcError as any).details });
                if (code === '42501' || /not authorized|permission denied/i.test(detail)) {
                    alert('경기 투입 권한이 없습니다.');
                } else if (code === 'PGRST202' || /could not find the function|schema cache/i.test(detail)) {
                    alert('경기 투입 함수가 준비되지 않았습니다. 관리자에게 문의해주세요.');
                } else {
                    alert('경기 투입에 실패했습니다. 최신 상태로 갱신합니다.');
                }
                await syncActiveSession();
                return;
            }

            const result = (data || {}) as { ok?: boolean; reason?: string; court?: number; group?: string };
            if (!result.ok) {
                switch (result.reason) {
                    case 'player_busy':
                        alert('이미 경기 중인 선수가 포함되어 있어 투입할 수 없습니다.');
                        break;
                    case 'not_found':
                        alert('경기 정보를 찾을 수 없습니다. 최신 상태로 갱신합니다.');
                        break;
                    case 'group_courts_full':
                        // 해당 조 전용 코트가 모두 진행 중 — 다른 조 빈 코트로 우회하지 않음.
                        alert(`${result.group || ''}조 사용 코트가 모두 진행 중입니다.`);
                        break;
                    case 'group_court_config_missing':
                        // 조별 전용 코트가 켜져 있는데 이 경기 조의 코트 설정을 찾지 못함.
                        alert('이 경기의 조별 코트 설정을 확인해주세요.');
                        break;
                    case 'court_conflict':
                        // partial unique index(matches_playing_court_uniq) 최종 방어 — 같은 코트에
                        //   다른 경기가 먼저 배정됨(23505). optimistic 없이 최신 상태로 갱신.
                        alert('다른 경기가 먼저 해당 코트에 배정되었습니다. 최신 상태로 갱신합니다.');
                        break;
                    default: // not_waiting / already_changed / invalid_session
                        alert('다른 운영자가 먼저 처리했습니다. 최신 상태로 갱신합니다.');
                        break;
                }
                await syncActiveSession();
                return;
            }

            // 성공 — 서버가 정한 court 반영을 위해 전체 재조회(optimistic 없음).
            await syncActiveSession();
        } catch (err: any) {
            console.error('[KDK] startMatch failed:', err);
            await syncActiveSession();
            alert('경기 투입에 실패했습니다. 최신 상태로 갱신합니다.');
        } finally {
            setIsStartingMatch(false);
            endAction(lockKey);
        }
    };

    // [v35.6] Manual Repair: Force Push local names/metadata to server
    const execFullRepair = async () => {
        if (!guardWriteAction('데이터 강제 동기화')) return; // 촬영 보호 모드 차단
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
        if (!guardWriteAction('경기 취소(대기 이동)')) return; // 촬영 보호 모드 차단
        const lockKey = `cancel:${matchId}`;
        if (!beginAction(lockKey)) return; // 더블탭/중복 실행 차단
        try {
            if (window.navigator?.vibrate) window.navigator.vibrate(50);
            setSpinningMatchId(matchId); // Start spin feedback

            // DB 먼저 — 현재 'playing' 일 때만 복귀 + 실제 변경 행 검증.
            const { data: rows, error: syncError } = await supabase
                .from('matches')
                .update({ status: 'waiting', court: null, score1: 1, score2: 1 })
                .eq('id', String(matchId))
                .eq('status', 'playing')
                .select('id');

            if (syncError) throw syncError;

            if (!rows || rows.length === 0) {
                // 다른 운영자가 이미 상태 변경 — optimistic 적용하지 않고 최신 상태로 갱신.
                setSpinningMatchId(null);
                await syncActiveSession();
                alert('다른 운영자가 먼저 처리했습니다. 최신 상태로 갱신합니다.');
                return;
            }

            // 성공 시에만 로컬 반영 + 전체 재조회.
            setMatches(prev => prev.map(m => m.id === matchId ? { ...m, status: 'waiting', court: null } : m));
            await syncActiveSession();
            setTimeout(() => setSpinningMatchId(null), 500);
        } catch (err: any) {
            console.error("Cancel match error:", err);
            setSpinningMatchId(null);
            await syncActiveSession();
            alert("경기 취소 중 오류가 발생했습니다. 최신 상태로 갱신합니다.");
        } finally {
            endAction(lockKey);
        }
    };

    // 완료 경기 → 대기로 되돌리기. 곧바로 playing 복귀(옛 court 재사용)하지 않고
    //   waiting + court=null + 점수 1:1 로 되돌린다. 이후 재투입은 start_kdk_match RPC 가
    //   새 빈 코트를 원자적으로 배정 → 코트/선수 중복을 서버에서 보호.
    const handleReopenMatch = async (matchId: string) => {
        if (!guardWriteAction('경기 되돌리기')) return; // 촬영 보호 모드 차단
        const lockKey = `edit:${matchId}`;
        if (!beginAction(lockKey)) return; // 같은 경기 재수정 더블탭/중복 차단
        try {
            const { data, error } = await supabase.from('matches')
                .update({ status: 'waiting', court: null, score1: 1, score2: 1 })
                .eq('id', String(matchId))
                .eq('status', 'complete') // 완료 상태일 때만 되돌림
                .select('id, status, court, score1, score2');
            if (error) {
                console.error('[KDK] reopen match error:', error);
                alert('경기 상태 변경에 실패했습니다. 최신 상태로 갱신합니다.');
                await syncActiveSession();
            } else if (!data || data.length === 0) {
                alert('다른 운영자가 먼저 처리했습니다. 최신 상태로 갱신합니다.');
                await syncActiveSession();
            } else {
                await syncActiveSession();
            }
        } finally {
            setResetMatchTarget(null);
            endAction(lockKey);
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
        if (!guardWriteAction('참가자 이름 매칭 저장')) return; // 촬영 보호 모드 차단
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
        if (!guardWriteAction('점수 입력/경기 완료')) return; // 촬영 보호 모드 차단
        const lockKey = `finish:${matchId}`;
        if (!beginAction(lockKey)) return; // 저장 더블탭/중복 실행 차단(UI disable 와 별개의 재진입 가드)
        try {
            const matchToFinish = matches.find(m => m.id === matchId);
            if (!matchToFinish) return;

            const numS1 = Number(s1);
            const numS2 = Number(s2);

            // 최초 완료(playing→complete) / 완료 결과 재수정(complete→complete) 을 기대 상태로 구분.
            const expectedStatus = matchToFinish.status === 'complete' ? 'complete' : 'playing';

            // DB 먼저 — 기대 상태일 때만 변경 + 실제 변경 행 검증. 성공 전에는 모달을 닫지 않는다.
            const { data: updatedRows, error: syncError } = await supabase
                .from('matches')
                .update({ status: 'complete', score1: numS1, score2: numS2 })
                .eq('id', String(matchId))
                .eq('status', expectedStatus)
                .select('id, status, score1, score2');

            if (syncError) {
                console.error("Match result sync error:", syncError);
                throw syncError;
            }

            if (!updatedRows || updatedRows.length === 0) {
                // 다른 운영자가 먼저 완료/변경 — 모달을 성공으로 닫지 않고 최신 상태 안내.
                await syncActiveSession();
                alert('다른 운영자가 먼저 경기 결과를 변경했습니다. 최신 상태를 확인해주세요.');
                return;
            }

            // 성공 → 로컬 반영 + 모달 닫기 (player_names/match_date 등은 로컬 표시용; 점수 계산식 무변경).
            const { teams, ...safeMatchData } = matchToFinish as any;
            const pNames = matchToFinish.playerIds?.map(pid => getPlayerName(pid)) || [];
            const finishedMatchData: any = {
                ...safeMatchData,
                score1: numS1,
                score2: numS2,
                status: 'complete',
                player_names: pNames,
                session_title: sessionTitle,
                match_date: new Date().toISOString(),
            };
            setMatches(prev => prev.map(m => m.id === matchId ? finishedMatchData : m));
            setShowScoreModal(null);
            if (window.navigator?.vibrate) window.navigator.vibrate([100, 50, 100]);
            localStorage.removeItem(`kdk_score_buffer_${matchId}`);

            await syncActiveSession();
            setShowToast(true);
            setTimeout(() => setShowToast(false), 3000);
        } catch (err: any) {
            console.error("Critical Finish Match Failure:", err);
            alert("경기 결과 저장에 실패했습니다: " + (err.message || "Unknown error"));
        } finally {
            endAction(lockKey);
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

    // Enrich allPlayersInRanking names via getPlayerName (resolves real guest names from match metadata)
    const resolvedRanking = useMemo(() => {
        return allPlayersInRanking.map(player => {
            const resolved = getPlayerName(player.id);
            if (resolved && resolved !== '이름 확인중') {
                return { ...player, name: resolved };
            }
            const isRawId = !player.name
                || player.name === player.id
                || /^g-\d+/i.test(player.name)
                || /^manual-guest-/i.test(player.name);
            if (isRawId && (player.is_guest || /^g-\d+/i.test(player.id) || /^manual-guest-/i.test(player.id))) {
                return { ...player, name: '게스트(G)' };
            }
            return player;
        });
    }, [allPlayersInRanking, allMembers, tempGuests, attendeeConfigs, matches]);

    type PlayerDetailedResult = {
        id: string;
        rank: number;
        name: string;
        group: string;
        wins: number;
        losses: number;
        pointsForByMatch: number[];
        pointsAgainstByMatch: number[];
        pointsForTotal: number;
        pointsAgainstTotal: number;
        diff: number;
    };

    const playerDetailedResults = useMemo<PlayerDetailedResult[]>(() => {
        const detailsById = new Map<string, PlayerDetailedResult>();

        const ensureDetail = (playerId: string, fallbackName?: string, fallbackGroup?: string) => {
            const existing = detailsById.get(playerId);
            if (existing) return existing;

            const rankingIndex = allPlayersInRanking.findIndex(player => player.id === playerId);
            const rankingPlayer = rankingIndex >= 0 ? allPlayersInRanking[rankingIndex] : null;
            const resolvedName = getPlayerName(playerId);
            const name = resolvedName && resolvedName !== '이름 확인중'
                ? resolvedName
                : (fallbackName || rankingPlayer?.name || '이름 확인중');

            const detail: PlayerDetailedResult = {
                id: playerId,
                rank: rankingIndex >= 0 ? rankingIndex + 1 : detailsById.size + 1,
                name,
                group: rankingPlayer?.group || fallbackGroup || 'A',
                wins: 0,
                losses: 0,
                pointsForByMatch: [],
                pointsAgainstByMatch: [],
                pointsForTotal: 0,
                pointsAgainstTotal: 0,
                diff: 0,
            };

            detailsById.set(playerId, detail);
            return detail;
        };

        allPlayersInRanking.forEach((player, index) => {
            const resolvedName = getPlayerName(player.id);
            const name = resolvedName && resolvedName !== '이름 확인중' ? resolvedName : player.name;
            detailsById.set(player.id, {
                id: player.id,
                rank: index + 1,
                name,
                group: player.group || 'A',
                wins: 0,
                losses: 0,
                pointsForByMatch: [],
                pointsAgainstByMatch: [],
                pointsForTotal: 0,
                pointsAgainstTotal: 0,
                diff: 0,
            });
        });

        const completedMatches = matches
            .filter(match => match.status === 'complete')
            .sort((a, b) => {
                const dateA = Date.parse((a as any).match_date || '');
                const dateB = Date.parse((b as any).match_date || '');
                if (Number.isFinite(dateA) && Number.isFinite(dateB) && dateA !== dateB) return dateA - dateB;

                const groupCompare = String(a.groupName || 'A').localeCompare(String(b.groupName || 'A'));
                if (groupCompare !== 0) return groupCompare;
                return (a.round || 0) - (b.round || 0)
                    || (a.court || 99) - (b.court || 99)
                    || String(a.id).localeCompare(String(b.id));
            });

        completedMatches.forEach(match => {
            const score1 = Number(match.score1 ?? 0);
            const score2 = Number(match.score2 ?? 0);

            (match.playerIds || []).forEach((playerId, index) => {
                if (!playerId) return;

                const isTeamA = index < 2;
                const pointsFor = isTeamA ? score1 : score2;
                const pointsAgainst = isTeamA ? score2 : score1;
                const fallbackName = getPlayerName(playerId, match.id);
                const detail = ensureDetail(playerId, fallbackName, match.groupName || (match as any).group || 'A');

                detail.pointsForByMatch.push(pointsFor);
                detail.pointsAgainstByMatch.push(pointsAgainst);
                detail.pointsForTotal += pointsFor;
                detail.pointsAgainstTotal += pointsAgainst;
                detail.diff = detail.pointsForTotal - detail.pointsAgainstTotal;

                if (pointsFor > pointsAgainst) detail.wins += 1;
                else detail.losses += 1;
            });
        });

        const rankedRows = allPlayersInRanking.map((player, index) => {
            const detail = ensureDetail(player.id, player.name, player.group);
            return {
                ...detail,
                rank: index + 1,
            };
        });

        const rankedIds = new Set(rankedRows.map(row => row.id));
        const extraRows = Array.from(detailsById.values())
            .filter(row => !rankedIds.has(row.id))
            .sort((a, b) => b.wins - a.wins || b.diff - a.diff || b.pointsForTotal - a.pointsForTotal || a.name.localeCompare(b.name))
            .map((row, index) => ({ ...row, rank: rankedRows.length + index + 1 }));

        return [...rankedRows, ...extraRows];
    }, [matches, allPlayersInRanking, allMembers, tempGuests, attendeeConfigs]);


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
        // 게스트비 미설정이면 임의 금액으로 결과를 만들지 않는다(0원은 유효 → 진행).
        if (guestFee == null) {
            alert('게스트비가 설정되지 않았습니다.\nKDK 설정에서 이번 게스트비를 입력한 후 결과를 공유해주세요.');
            return;
        }

        let text = `🏆 오늘의 최종 결과: ${sessionTitle || 'Live Tournament'}\n`;
        text += `🏦 계좌: ${accountInfo}\n`;
        text += `💰 상금/벌금: 1위 ${firstPrize.toLocaleString()} / L1 ${bottom25Late.toLocaleString()} / L2 ${bottom25Penalty.toLocaleString()} / 게스트 ${guestFee.toLocaleString()}\n`;
        text += `━━━━━━━━━━━━━━\n\n`;

        const sortedPlayers = [...allPlayersInRanking];
        const totalCount = sortedPlayers.length;
        const finalResultGuestFee = guestFee; // 세션 게스트비 단일 출처(하드코딩 10,000 제거)
        const formatFinalResultPlayerName = (p: any) => {
            const manualFromName = getManualGuestDisplayName(p.name);
            const manualFromId = getManualGuestDisplayName(p.id);
            if (manualFromName && !isGenericGuestDisplayName(manualFromName)) return manualFromName;
            if (manualFromId) return manualFromId;

            const resolvedById = getPlayerName(p.id);
            const resolvedClean = cleanDisplayName(resolvedById);
            const sourceClean = cleanDisplayName(p.name);
            const baseName = (resolvedClean && resolvedClean !== "이름 확인중" && resolvedClean !== "미확인") ? resolvedClean : sourceClean;
            if (!baseName) return "미확인";

            const isGuest = p.is_guest
                || p.isGuest
                || /^manual-guest-/i.test(String(p.id || ''))
                || /^g-/i.test(String(p.id || ''))
                || /^manual-guest-/i.test(String(p.name || ''))
                || /\s*\(G\)$/i.test(String(p.name || ''))
                || /\s+g$/i.test(String(p.name || ''))
                || /\(G\)$/i.test(String(resolvedById || ''));

            return isGuest ? `${stripGuestSuffix(baseName)}(G)` : stripGuestSuffix(baseName);
        };
        const isFinalResultGuest = (p: any) => {
            return p.is_guest === true
                || p.isGuest === true
                || /^manual-guest-/i.test(String(p.id || ''))
                || /^g-/i.test(String(p.id || ''))
                || /^manual-guest-/i.test(String(p.name || ''))
                || /\s*\(G\)$/i.test(String(p.name || ''))
                || /\s+g$/i.test(String(p.name || ''));
        };

        // Logical Settlement Rules (MBTI/AGE/RANDOM Consistency)
        const bottomHalfCount = Math.ceil(totalCount / 2);
        const penaltyCount = Math.ceil(bottomHalfCount / 2);
        const fineCount = bottomHalfCount - penaltyCount;

        sortedPlayers.forEach((p, i) => {
            const originalRank = i + 1;
            let rankPrefix = (originalRank === 1) ? '🥇 ' : (originalRank === 2) ? '🥈 ' : (originalRank === 3) ? '🥉 ' : `${originalRank}위 `;

            const isPenaltyTier = i >= (totalCount - penaltyCount);
            const isFineTier = !isPenaltyTier && i >= (totalCount - bottomHalfCount);
            const isGuestPlayer = isFinalResultGuest(p);

            let finalAmount = 0;
            if (!isGuestPlayer && originalRank === 1) {
                finalAmount = firstPrize;
            } else if (isPenaltyTier) {
                finalAmount = -bottom25Penalty;
            } else if (isFineTier) {
                finalAmount = -bottom25Late;
            }
            if (isGuestPlayer) {
                finalAmount -= finalResultGuestFee;
            }

            let prizePenaltyText = '';
            if (finalAmount > 0) {
                prizePenaltyText = ` [💰 +${finalAmount.toLocaleString()}원]`;
            } else if (finalAmount < 0) {
                prizePenaltyText = ` [💸 -${Math.abs(finalAmount).toLocaleString()}원]`;
            } else {
                prizePenaltyText = ` [0원]`;
            }

            text += `${rankPrefix}${formatFinalResultPlayerName(p)}: ${p.wins}승 ${p.losses}패${prizePenaltyText}\n`;
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


    const renderActiveSessionSelector = () => (
        <main
            className="relative w-full font-sans"
            style={{
                minHeight: '100dvh',
                backgroundColor: '#F4F8FC',
                color: '#0F2747',
                boxSizing: 'border-box',
            }}
        >
            <div style={{ width: '100%', maxWidth: 520, margin: '0 auto', padding: `20px 16px ${KDK_STEP_BOTTOM_PADDING}`, boxSizing: 'border-box' }}>
                {/* HEADER ROW */}
                <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    {sessionSelectorBackTarget === 'ENTRY_CHOICE' ? (
                        <button
                            type="button"
                            onClick={returnToEntryChoice}
                            aria-label="뒤로"
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: 44, height: 44, borderRadius: '50%',
                                border: '1px solid #DCE8F5', backgroundColor: '#FFFFFF',
                                color: '#3B5A85', boxShadow: '0 4px 12px rgba(15,45,85,0.06)',
                                cursor: 'pointer',
                            }}
                        >
                            <span style={{ fontSize: 20, lineHeight: 1 }}>←</span>
                        </button>
                    ) : <span style={{ width: 44, height: 44 }} />}
                    <span
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            borderRadius: 999, padding: '6px 12px',
                            border: '1px solid #F4C7C7', background: '#FDEEEE',
                            fontSize: 10, fontWeight: 900,
                            letterSpacing: '0.2em', textTransform: 'uppercase',
                            color: '#C0392B',
                        }}
                    >
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF4444' }} />
                        LIVE COURT
                    </span>
                </header>

                {/* HERO CARD */}
                <section
                    style={{
                        width: '100%', boxSizing: 'border-box',
                        borderRadius: 24, background: '#FFFFFF',
                        border: '1px solid #DCE8F5', padding: 20,
                        marginBottom: 18,
                        boxShadow: '0 14px 32px rgba(15,45,85,0.07)',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: 48, height: 48, flexShrink: 0, borderRadius: 14,
                                background: 'linear-gradient(135deg, #3B82F6 0%, #22B8CF 100%)',
                                color: '#FFFFFF', boxShadow: '0 8px 18px rgba(37,99,235,0.24)',
                                fontSize: 22,
                            }}
                        >
                            🎾
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#3B82F6' }}>
                                ACTIVE SESSIONS
                            </p>
                            <h1 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 900, lineHeight: 1.15, letterSpacing: '-0.02em', color: '#0F2747' }}>
                                진행 중인 세션 선택
                            </h1>
                        </div>
                    </div>
                    <p style={{ margin: '12px 0 0', fontSize: 12.5, fontWeight: 700, lineHeight: 1.55, color: '#3F5B82' }}>
                        기존 KDK 세션을 선택해 이어서 운영합니다.
                    </p>
                </section>

                {/* SESSION LIST */}
                {allActiveSessions.length === 0 ? (
                    <section
                        style={{
                            width: '100%', boxSizing: 'border-box',
                            borderRadius: 22, background: '#FFFFFF',
                            border: '1px solid #DCE8F5', padding: '28px 20px',
                            textAlign: 'center',
                            boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                        }}
                    >
                        <div
                            style={{
                                width: 64, height: 64, margin: '0 auto 14px',
                                borderRadius: '50%', border: '1px dashed #C7DCF1',
                                background: '#F6FAFD',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 28,
                            }}
                        >
                            🎾
                        </div>
                        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.01em' }}>
                            진행 중인 세션이 없습니다
                        </h2>
                        <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 600, lineHeight: 1.55, color: '#56729A' }}>
                            새 대진을 생성해 LIVE COURT를 시작하세요.
                        </p>
                        {isAdmin && (
                            <button
                                type="button"
                                onClick={startNewKdkCreation}
                                style={{
                                    marginTop: 18,
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    width: '100%', maxWidth: 320, height: 52, borderRadius: 16,
                                    background: 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                                    color: '#FFFFFF', fontSize: 14, fontWeight: 800,
                                    letterSpacing: '0.02em', border: 'none', cursor: 'pointer',
                                    boxShadow: '0 12px 26px rgba(37,99,235,0.24)',
                                }}
                            >
                                대진 생성으로 이동 →
                            </button>
                        )}
                    </section>
                ) : (
                    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {allActiveSessions.map((s, idx) => {
                            const isLatest = idx === 0;
                            const lastActivityLabel = s.lastActivity
                                ? new Date(s.lastActivity).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                                : '--';
                            return (
                                <div
                                    key={s.id}
                                    style={{
                                        width: '100%', boxSizing: 'border-box',
                                        borderRadius: 22, background: '#FFFFFF',
                                        border: isLatest ? '2px solid #2563EB' : '1px solid #DCE8F5',
                                        padding: 16,
                                        boxShadow: isLatest
                                            ? '0 12px 28px rgba(37,99,235,0.14)'
                                            : '0 8px 20px rgba(15,45,85,0.05)',
                                    }}
                                >
                                    <button
                                        type="button"
                                        onClick={() => enterSession(s.id)}
                                        style={{
                                            width: '100%', textAlign: 'left',
                                            background: 'transparent', border: 'none',
                                            padding: 0, cursor: 'pointer',
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                                            <span style={{
                                                fontSize: 10, fontWeight: 900,
                                                letterSpacing: '0.22em', textTransform: 'uppercase',
                                                color: isLatest ? '#1F5FB5' : '#7A93B3',
                                            }}>
                                                {isLatest ? 'LATEST SESSION' : 'ACTIVE SESSION'}
                                            </span>
                                            <span style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                                borderRadius: 999, padding: '4px 10px',
                                                border: '1px solid #F4C7C7', background: '#FDEEEE',
                                                fontSize: 9, fontWeight: 900,
                                                letterSpacing: '0.18em', textTransform: 'uppercase',
                                                color: '#C0392B',
                                            }}>
                                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#EF4444' }} />
                                                LIVE
                                            </span>
                                        </div>

                                        <h2 style={{
                                            margin: 0, fontSize: 18, fontWeight: 900,
                                            letterSpacing: '-0.02em', color: '#0F2747',
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>
                                            {s.title}
                                        </h2>
                                        <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 700, color: '#7A93B3' }}>
                                            {lastActivityLabel}
                                        </p>

                                        <div style={{
                                            marginTop: 14, paddingTop: 12,
                                            borderTop: '1px solid #E1EAF5',
                                            display: 'grid',
                                            gridTemplateColumns: '1fr 1fr auto',
                                            alignItems: 'center', gap: 10,
                                        }}>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9CB2CC' }}>
                                                    참가 인원
                                                </span>
                                                <span style={{ marginTop: 2, fontSize: 16, fontWeight: 900, color: '#0F2747' }}>
                                                    {s.playerCount}
                                                    <span style={{ marginLeft: 2, fontSize: 10, fontWeight: 700, color: '#7A93B3' }}>명</span>
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9CB2CC' }}>
                                                    경기 수
                                                </span>
                                                <span style={{ marginTop: 2, fontSize: 16, fontWeight: 900, color: '#0F2747' }}>
                                                    {s.matchCount}
                                                    <span style={{ marginLeft: 2, fontSize: 10, fontWeight: 700, color: '#7A93B3' }}>개</span>
                                                </span>
                                            </div>
                                            <span style={{
                                                fontSize: 12, fontWeight: 900,
                                                color: '#1F5FB5',
                                                whiteSpace: 'nowrap',
                                            }}>
                                                입장하기 →
                                            </span>
                                        </div>
                                    </button>

                                    {isAdmin && (
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setSessionDeleteTarget(s);
                                            }}
                                            style={{
                                                marginTop: 12, width: '100%',
                                                borderRadius: 12,
                                                border: '1px solid #F4C7C7',
                                                background: '#FFFFFF',
                                                padding: '8px 14px',
                                                fontSize: 11, fontWeight: 800,
                                                letterSpacing: '0.06em',
                                                color: '#C0392B',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            세션 삭제
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </section>
                )}
            </div>

            {sessionDeleteTarget && (
                <CustomConfirmModal
                    title="세션 삭제"
                    message={`"${sessionDeleteTarget.title}" 세션의 진행 중인 경기 데이터가 삭제됩니다. 공식 확정된 Archive 기록은 삭제되지 않습니다.`}
                    confirmText={isDeletingSession ? "삭제 중..." : "세션 삭제"}
                    icon="🗑️"
                    onConfirm={handleDeleteActiveSession}
                    onCancel={() => {
                        if (!isDeletingSession) setSessionDeleteTarget(null);
                    }}
                />
            )}
        </main>
    );

    const hasExistingKdkSession = hasRestoredSession || allActiveSessions.length > 0;

    if (kdkEntryMode === 'CHECKING') {
        return (
            <main
                className="relative w-full font-sans"
                style={{
                    minHeight: '100dvh',
                    marginBottom: 'calc(-1 * var(--page-bottom-safe))',
                    backgroundColor: '#F4F8FC',
                    color: '#0F2747',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '32px 16px',
                    boxSizing: 'border-box',
                }}
            >
                <PremiumSpinner />
                <p style={{ marginTop: 20, fontSize: 11, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#1F5FB5' }}>
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
            <main
                className="relative w-full font-sans"
                style={{
                    minHeight: '100dvh',
                    backgroundColor: '#F4F8FC',
                    color: '#0F2747',
                    boxSizing: 'border-box',
                }}
            >
                <div
                    style={{
                        width: '100%',
                        maxWidth: 520,
                        margin: '0 auto',
                        padding: `20px 16px ${KDK_STEP_BOTTOM_PADDING}`,
                        boxSizing: 'border-box',
                    }}
                >
                    {/* HEADER: back placeholder + KDK ENTRY badge */}
                    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 20 }}>
                        <span
                            style={{
                                display: 'inline-block', borderRadius: 999,
                                border: '1px solid #C7DCF1', backgroundColor: '#EAF3FC',
                                padding: '6px 14px', fontSize: 10, fontWeight: 900,
                                letterSpacing: '0.2em', textTransform: 'uppercase',
                                color: '#1F5FB5',
                            }}
                        >
                            KDK ENTRY
                        </span>
                    </header>

                    {/* HERO CARD */}
                    <section
                        style={{
                            width: '100%', boxSizing: 'border-box',
                            borderRadius: 24, background: '#FFFFFF',
                            border: '1px solid #DCE8F5', padding: 22,
                            marginBottom: 20,
                            boxShadow: '0 14px 32px rgba(15,45,85,0.07)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                            <div
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: 52, height: 52, flexShrink: 0, borderRadius: 16,
                                    background: 'linear-gradient(135deg, #3B82F6 0%, #22B8CF 100%)',
                                    color: '#FFFFFF', boxShadow: '0 8px 18px rgba(37,99,235,0.26)',
                                    fontSize: 24,
                                }}
                            >
                                🎾
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#3B82F6' }}>
                                    TEYEON KDK
                                </p>
                                <h1 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 900, lineHeight: 1.15, letterSpacing: '-0.02em', color: '#0F2747' }}>
                                    진행 중인 대진이 있습니다
                                </h1>
                            </div>
                        </div>
                        <p style={{ margin: '14px 0 0', fontSize: 13, fontWeight: 700, lineHeight: 1.6, color: '#3F5B82' }}>
                            기존 대진을 이어서 운영하거나, 새 대진 생성으로 이동할 수 있습니다.
                        </p>
                    </section>

                    {/* ENTRY CHOICE CARDS */}
                    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <Link
                            href="/kdk?entry=live"
                            onClick={openExistingLiveCourt}
                            style={{
                                display: 'block', width: '100%', textAlign: 'left', textDecoration: 'none',
                                boxSizing: 'border-box', borderRadius: 22,
                                background: '#FFFFFF', border: '2px solid #2563EB', padding: 18,
                                boxShadow: '0 12px 28px rgba(37,99,235,0.14)',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
                                <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    borderRadius: 999, padding: '4px 10px',
                                    background: '#FDEEEE', border: '1px solid #F4C7C7',
                                    fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase',
                                    color: '#C0392B',
                                }}>
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF4444' }} />
                                    LIVE
                                </span>
                                <span style={{ fontSize: 12, fontWeight: 900, color: '#1F5FB5' }}>입장하기 →</span>
                            </div>
                            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.02em' }}>
                                기존 라이브 코트 보기
                            </h2>
                            <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 600, lineHeight: 1.55, color: '#56729A' }}>
                                {sessionCount > 1 ? `${sessionCount}개의 진행 중인 세션 중 선택합니다.` : `${primaryTitle || '현재 세션'}을 이어서 운영합니다.`}
                            </p>
                        </Link>

                        <Link
                            href="/kdk?entry=create"
                            onClick={startNewKdkCreation}
                            style={{
                                display: 'block', width: '100%', textAlign: 'left', textDecoration: 'none',
                                boxSizing: 'border-box', borderRadius: 22,
                                background: '#FFFFFF', border: '1px solid #DCE8F5', padding: 18,
                                boxShadow: '0 8px 20px rgba(15,45,85,0.06)',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
                                <span style={{
                                    borderRadius: 999, padding: '4px 10px',
                                    background: '#EEF6FF', border: '1px solid #C7DCF1',
                                    fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase',
                                    color: '#1F5FB5',
                                }}>
                                    NEW DRAW
                                </span>
                                <span style={{ fontSize: 12, fontWeight: 900, color: '#56729A' }}>시작 →</span>
                            </div>
                            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.02em' }}>
                                새 대진 생성하기
                            </h2>
                            <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 600, lineHeight: 1.55, color: '#56729A' }}>
                                기존 세션은 보존하고, 자동 또는 수동 방식으로 새 대진을 준비합니다.
                            </p>
                        </Link>
                    </section>
                </div>
            </main>
        );
    }

    // --- Step 0: Generation Mode Selection (Cool Light redesign) ---
    if (step === 0) {
        const step0Selected: 'MANUAL' | 'AUTO' = generationMode === 'AUTO' ? 'AUTO' : 'MANUAL';
        const stepDots = [
            { num: 1, label: '방식', active: true },
            { num: 2, label: '참가자', active: false },
            { num: 3, label: '룰', active: false },
            { num: 4, label: '요약', active: false },
        ];
        const goToNext = () => {
            if (step0Selected === 'AUTO') {
                setGenerationMode('AUTO');
                setManualInputMode(null);
                setStep(1);
            } else {
                setGenerationMode('MANUAL');
                commitTotalCourts(4);
                setManualInputMode('PASTE');
                setManualStep('INPUT');
                setStep(1);
            }
        };
        return (
            <main
                className="relative w-full font-sans"
                style={{
                    minHeight: '100dvh',
                    backgroundColor: '#F4F8FC',
                    color: '#0F2747',
                    boxSizing: 'border-box',
                }}
            >
                <div
                    style={{
                        width: '100%',
                        maxWidth: '520px',
                        margin: '0 auto',
                        padding: `20px 16px ${KDK_STEP_BOTTOM_PADDING}`,
                        boxSizing: 'border-box',
                    }}
                >
                    {/* HEADER: back + KDK SETUP badge */}
                    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                        <button
                            type="button"
                            onClick={handleGenerationModeBack}
                            aria-label="뒤로"
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: 44, height: 44, borderRadius: '50%',
                                border: '1px solid #DCE8F5', backgroundColor: '#FFFFFF',
                                color: '#3B5A85', boxShadow: '0 4px 12px rgba(15,45,85,0.06)',
                                cursor: 'pointer',
                            }}
                        >
                            <span style={{ fontSize: 20, lineHeight: 1 }}>←</span>
                        </button>
                        <span
                            style={{
                                display: 'inline-block', borderRadius: 999,
                                border: '1px solid #C7DCF1', backgroundColor: '#EAF3FC',
                                padding: '6px 14px', fontSize: 10, fontWeight: 900,
                                letterSpacing: '0.2em', textTransform: 'uppercase',
                                color: '#1F5FB5',
                            }}
                        >
                            KDK SETUP
                        </span>
                    </header>

                    {/* HERO CARD */}
                    <section
                        style={{
                            width: '100%', boxSizing: 'border-box',
                            borderRadius: 24, background: '#FFFFFF',
                            border: '1px solid #DCE8F5', padding: 22,
                            marginBottom: 20,
                            boxShadow: '0 14px 32px rgba(15,45,85,0.07)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                            <div
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: 52, height: 52, flexShrink: 0, borderRadius: 16,
                                    background: 'linear-gradient(135deg, #3B82F6 0%, #22B8CF 100%)',
                                    color: '#FFFFFF', boxShadow: '0 8px 18px rgba(37,99,235,0.26)',
                                    fontSize: 24,
                                }}
                            >
                                ⚡
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#3B82F6' }}>
                                    TEYEON KDK
                                </p>
                                <h1 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 900, lineHeight: 1.15, letterSpacing: '-0.02em', color: '#0F2747' }}>
                                    KDK 대진 생성
                                </h1>
                            </div>
                        </div>
                        <p style={{ margin: '14px 0 0', fontSize: 13, fontWeight: 700, lineHeight: 1.6, color: '#3F5B82' }}>
                            자동 KDK 또는 수동 붙여넣기로 대진을 준비합니다.
                        </p>
                    </section>

                    {/* STEP INDICATOR */}
                    <section style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 18 }}>
                        {stepDots.map((s, i) => (
                            <div key={s.num} style={{ display: 'flex', alignItems: 'center', flex: i === 3 ? '0 0 auto' : '1 1 auto' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                    <div
                                        style={{
                                            width: 28, height: 28, borderRadius: '50%',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            background: s.active ? 'linear-gradient(135deg, #3B82F6, #1F5FB5)' : '#FFFFFF',
                                            border: s.active ? 'none' : '1px solid #DCE8F5',
                                            color: s.active ? '#FFFFFF' : '#9CB2CC',
                                            fontSize: 12, fontWeight: 900,
                                            boxShadow: s.active ? '0 6px 14px rgba(37,99,235,0.32)' : 'none',
                                        }}
                                    >
                                        {s.num}
                                    </div>
                                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: s.active ? '#1F5FB5' : '#9CB2CC' }}>{s.label}</span>
                                </div>
                                {i < 3 && (
                                    <div style={{ flex: '1 1 auto', height: 2, background: '#E1EAF5', margin: '0 4px', marginBottom: 14 }} />
                                )}
                            </div>
                        ))}
                    </section>

                    {/* STEP 0 TITLE */}
                    <section style={{ marginBottom: 12 }}>
                        <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#3B82F6' }}>
                            STEP 0
                        </p>
                        <h2 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.01em' }}>
                            생성 방식 선택
                        </h2>
                        <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 600, color: '#56729A' }}>
                            현재는 수동 붙여넣기 흐름이 안정적이며, 자동 모드도 사용 가능합니다.
                        </p>
                    </section>

                    {/* MODE CARDS */}
                    <section style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
                        {/* 수동 붙여넣기 (RECOMMENDED) */}
                        <button
                            type="button"
                            onClick={() => setGenerationMode('MANUAL')}
                            style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                boxSizing: 'border-box', borderRadius: 20,
                                background: step0Selected === 'MANUAL' ? '#FFFFFF' : '#FFFFFF',
                                border: step0Selected === 'MANUAL' ? '2px solid #2563EB' : '1px solid #DCE8F5',
                                padding: 16,
                                boxShadow: step0Selected === 'MANUAL'
                                    ? '0 10px 24px rgba(37,99,235,0.16)'
                                    : '0 6px 16px rgba(15,45,85,0.05)',
                                cursor: 'pointer',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: 44, height: 44, flexShrink: 0, borderRadius: 14,
                                    background: '#EEF6FF', color: '#2563EB', fontSize: 20,
                                }}>📋</div>
                                <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 800, color: '#0F2747' }}>수동 붙여넣기</h3>
                                        <span style={{
                                            borderRadius: 999, padding: '2px 8px',
                                            background: '#2563EB', color: '#FFFFFF',
                                            fontSize: 9, fontWeight: 900, letterSpacing: '0.1em',
                                        }}>추천</span>
                                    </div>
                                    <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 600, lineHeight: 1.55, color: '#56729A' }}>
                                        엑셀/카톡 대진표 텍스트를 붙여넣어 빠르게 시작합니다.
                                    </p>
                                </div>
                                {step0Selected === 'MANUAL' && (
                                    <div style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        width: 22, height: 22, flexShrink: 0, borderRadius: '50%',
                                        background: '#2563EB', color: '#FFFFFF',
                                        fontSize: 13, fontWeight: 900,
                                    }}>✓</div>
                                )}
                            </div>
                        </button>

                        {/* 자동 KDK */}
                        <button
                            type="button"
                            onClick={() => setGenerationMode('AUTO')}
                            style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                boxSizing: 'border-box', borderRadius: 20,
                                background: '#FFFFFF',
                                border: step0Selected === 'AUTO' ? '2px solid #2563EB' : '1px solid #DCE8F5',
                                padding: 16,
                                boxShadow: step0Selected === 'AUTO'
                                    ? '0 10px 24px rgba(37,99,235,0.16)'
                                    : '0 6px 16px rgba(15,45,85,0.05)',
                                cursor: 'pointer',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: 44, height: 44, flexShrink: 0, borderRadius: 14,
                                    background: '#EEF6FF', color: '#2563EB', fontSize: 20,
                                }}>⚡</div>
                                <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
                                    <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 800, color: '#0F2747' }}>자동 KDK</h3>
                                    <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 600, lineHeight: 1.55, color: '#56729A' }}>
                                        참가자와 조건을 선택하면 KDK 로직이 대진을 자동 생성합니다.
                                    </p>
                                </div>
                                {step0Selected === 'AUTO' && (
                                    <div style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        width: 22, height: 22, flexShrink: 0, borderRadius: '50%',
                                        background: '#2563EB', color: '#FFFFFF',
                                        fontSize: 13, fontWeight: 900,
                                    }}>✓</div>
                                )}
                            </div>
                        </button>

                        {/* 직접 만들기 (COMING SOON) */}
                        <div
                            style={{
                                display: 'block', width: '100%', boxSizing: 'border-box',
                                borderRadius: 20, background: '#F6FAFD',
                                border: '1px solid #E1EAF5', padding: 16, opacity: 0.7,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: 44, height: 44, flexShrink: 0, borderRadius: 14,
                                    background: '#E8F0F9', color: '#9CB2CC', fontSize: 18,
                                }}>🎯</div>
                                <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#56729A' }}>직접 만들기</h3>
                                        <span style={{
                                            borderRadius: 999, padding: '2px 8px',
                                            background: '#E1EAF5', color: '#56729A',
                                            fontSize: 9, fontWeight: 900, letterSpacing: '0.1em',
                                        }}>COMING SOON</span>
                                    </div>
                                    <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 600, lineHeight: 1.55, color: '#7A93B3' }}>
                                        경기별 팀을 운영자가 직접 구성합니다.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* 캡처 인식 (COMING SOON) */}
                        <div
                            style={{
                                display: 'block', width: '100%', boxSizing: 'border-box',
                                borderRadius: 20, background: '#F6FAFD',
                                border: '1px solid #E1EAF5', padding: 16, opacity: 0.7,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: 44, height: 44, flexShrink: 0, borderRadius: 14,
                                    background: '#E8F0F9', color: '#9CB2CC', fontSize: 18,
                                }}>📷</div>
                                <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#56729A' }}>캡처 인식</h3>
                                        <span style={{
                                            borderRadius: 999, padding: '2px 8px',
                                            background: '#E1EAF5', color: '#56729A',
                                            fontSize: 9, fontWeight: 900, letterSpacing: '0.1em',
                                        }}>COMING SOON</span>
                                    </div>
                                    <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 600, lineHeight: 1.55, color: '#7A93B3' }}>
                                        이미지/OCR 기반 자동 대진 인식.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* PRIMARY CTA */}
                    <button
                        type="button"
                        onClick={goToNext}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            width: '100%', height: 60, boxSizing: 'border-box', borderRadius: 18,
                            background: 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                            color: '#FFFFFF', fontSize: 15, fontWeight: 800, letterSpacing: '0.02em',
                            border: 'none', cursor: 'pointer',
                            boxShadow: '0 14px 28px rgba(37,99,235,0.24)',
                        }}
                    >
                        다음: {step0Selected === 'AUTO' ? '참가자 선택' : '대진 붙여넣기'} →
                    </button>
                </div>
            </main>
        );
    }

    // --- Manual Configuration Flow ---
    if (step === 1 && generationMode === 'MANUAL') {
        const manualPasteMatchCount = manualPastePreview.length;
        const canProceedToNameMatching = manualInputMode === 'PASTE' && manualStep === 'INPUT' && manualPasteMatchCount > 0;

        return (
            <main
                className="relative w-full font-sans"
                style={{
                    minHeight: '100dvh',
                    backgroundColor: '#F4F8FC',
                    color: '#0F2747',
                    padding: `20px 16px ${KDK_STEP_BOTTOM_PADDING}`,
                    boxSizing: 'border-box',
                }}
            >
                <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 520, margin: '0 auto 16px', width: '100%' }}>
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
                        aria-label="뒤로"
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 44, height: 44, borderRadius: '50%',
                            border: '1px solid #DCE8F5', backgroundColor: '#FFFFFF',
                            color: '#3B5A85', boxShadow: '0 4px 12px rgba(15,45,85,0.06)',
                            cursor: 'pointer',
                        }}
                    >
                        <span style={{ fontSize: 20, lineHeight: 1 }}>←</span>
                    </button>
                    <span
                        style={{
                            display: 'inline-block', borderRadius: 999,
                            border: '1px solid #C7DCF1', backgroundColor: '#EAF3FC',
                            padding: '6px 14px', fontSize: 10, fontWeight: 900,
                            letterSpacing: '0.2em', textTransform: 'uppercase',
                            color: '#1F5FB5',
                        }}
                    >
                        MANUAL READY
                    </span>
                </header>

                <section style={{ maxWidth: 520, margin: '0 auto', width: '100%' }}>
                    {!manualInputMode && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <button
                                type="button"
                                onClick={() => {
                                    setManualInputMode('PASTE');
                                    setManualStep('INPUT');
                                }}
                                style={{
                                    display: 'block', width: '100%', textAlign: 'left',
                                    boxSizing: 'border-box', borderRadius: 20,
                                    background: '#FFFFFF', border: '2px solid #2563EB', padding: 18,
                                    boxShadow: '0 10px 24px rgba(37,99,235,0.14)', cursor: 'pointer',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                    <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#3B82F6' }}>대진 붙여넣기</span>
                                    <span style={{ borderRadius: 999, background: '#2563EB', color: '#FFFFFF', padding: '2px 10px', fontSize: 9, fontWeight: 900, letterSpacing: '0.1em' }}>추천</span>
                                </div>
                                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0F2747' }}>엑셀/카톡 텍스트 붙여넣기</h2>
                                <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 600, lineHeight: 1.55, color: '#56729A' }}>
                                    경기 순서와 팀 구성을 미리 확인합니다.
                                </p>
                            </button>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <div style={{ borderRadius: 16, background: '#F6FAFD', border: '1px solid #E1EAF5', padding: 14, opacity: 0.7 }}>
                                    <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#9CB2CC' }}>COMING SOON</span>
                                    <h3 style={{ margin: '8px 0 4px', fontSize: 13.5, fontWeight: 800, color: '#56729A' }}>직접 만들기</h3>
                                    <p style={{ margin: 0, fontSize: 11, fontWeight: 600, lineHeight: 1.5, color: '#7A93B3' }}>경기별 팀 직접 구성</p>
                                </div>
                                <div style={{ borderRadius: 16, background: '#F6FAFD', border: '1px solid #E1EAF5', padding: 14, opacity: 0.7 }}>
                                    <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#9CB2CC' }}>COMING SOON</span>
                                    <h3 style={{ margin: '8px 0 4px', fontSize: 13.5, fontWeight: 800, color: '#56729A' }}>캡처 인식</h3>
                                    <p style={{ margin: 0, fontSize: 11, fontWeight: 600, lineHeight: 1.5, color: '#7A93B3' }}>이미지/OCR 인식</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {manualInputMode === 'PASTE' && manualStep === 'INPUT' && (
                        // 이 div 가 '다음: 이름 매칭' CTA 를 직접 감싸는 스크롤 콘텐츠 끝.
                        // 자체적으로 BottomNav 높이 + 48px + safe-area 만큼 하단 여백을 두어
                        // (바깥 wrapper 의존 없이) CTA 가 BottomNav 아래로 깔리지 않게 한다.
                        <div
                            data-kdk-manual-input-scroll-end
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 14,
                                paddingBottom: 'calc(var(--bottom-nav-area, 72px) + 48px + env(safe-area-inset-bottom))',
                            }}
                        >
                            {/* PASTE CARD */}
                            <div style={{
                                borderRadius: 22, background: '#FFFFFF',
                                border: '1px solid #DCE8F5', padding: 18,
                                boxShadow: '0 12px 28px rgba(15,45,85,0.06)',
                            }}>
                                <div style={{ marginBottom: 10 }}>
                                    <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#3B82F6' }}>STEP 2 · 대진 붙여넣기</span>
                                    <h2 style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.01em' }}>엑셀/카톡 대진표 붙여넣기</h2>
                                </div>
                                <div style={{
                                    marginBottom: 12, borderRadius: 14,
                                    background: '#EEF5FB', border: '1px solid #D7E5F4', padding: 12,
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                                        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#1F5FB5' }}>입력 예시</span>
                                        <span style={{ fontSize: 9, fontWeight: 700, color: '#56729A' }}>탭 구분 텍스트 지원</span>
                                    </div>
                                    <pre style={{ margin: 0, maxHeight: 100, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'keep-all', fontSize: 11, fontWeight: 600, lineHeight: 1.55, color: '#3F5B82', fontFamily: 'inherit' }}>
{`A조
1 봉준/상윤 vs 영호/광현 19:00
B조
1 민준/상준 vs 강정호/구봉준 20:00
A    1    봉준    상윤    영호    광현    19:00`}
                                    </pre>
                                    <p style={{ margin: '6px 0 0', fontSize: 10, fontWeight: 700, color: '#7A93B3' }}>조 표기가 없으면 A조로 인식됩니다.</p>
                                </div>
                                <textarea
                                    value={manualPasteText}
                                    onChange={(e) => {
                                        setManualPasteText(e.target.value);
                                        setManualNameOverrides({});
                                    }}
                                    placeholder="예: 1 봉준/상윤 vs 영호/광현 19:00"
                                    style={{
                                        minHeight: 140, width: '100%', resize: 'vertical',
                                        borderRadius: 14, border: '1px solid #DCE8F5',
                                        background: '#F8FBFE', padding: '12px 14px',
                                        fontSize: 13, fontWeight: 600, lineHeight: 1.55,
                                        color: '#0F2747', outline: 'none', boxSizing: 'border-box',
                                        fontFamily: 'inherit',
                                    }}
                                />
                            </div>

                            {/* PREVIEW CARD */}
                            <div style={{
                                borderRadius: 22, background: '#FFFFFF',
                                border: '1px solid #DCE8F5', padding: 16,
                                boxShadow: '0 12px 28px rgba(15,45,85,0.06)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                                    <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#3B82F6' }}>매칭 미리보기</span>
                                    <span style={{ fontSize: 10, fontWeight: 800, color: '#1F5FB5', textAlign: 'right' }}>
                                        {manualPasteMatchCount} matches · {manualPlayerNames.length} names · {manualGroups.length || 0} groups
                                    </span>
                                </div>

                                {manualPasteMatchCount === 0 ? (
                                    <div style={{
                                        borderRadius: 14, border: '1px dashed #D7E5F4',
                                        padding: '24px 0', textAlign: 'center',
                                        fontSize: 12, fontWeight: 700, color: '#7A93B3',
                                    }}>
                                        대진을 붙여넣으면 경기 미리보기가 표시됩니다.
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {manualPastePreview.map((row, index) => {
                                            const ok = row.isValid;
                                            return (
                                                <div
                                                    key={`${row.raw}-${index}`}
                                                    style={{
                                                        borderRadius: 14,
                                                        border: ok ? '1px solid #E1EAF5' : '1px solid #F4C7C7',
                                                        background: ok ? '#F8FBFE' : '#FDEEEE',
                                                        padding: '10px 12px',
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                                                        <span style={{
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            minWidth: 52, padding: '4px 8px', borderRadius: 999,
                                                            background: '#2563EB', color: '#FFFFFF',
                                                            fontSize: 10, fontWeight: 900, flexShrink: 0,
                                                        }}>
                                                            {getManualGroupLabel(row.group)} · {row.order}
                                                        </span>
                                                        <div style={{ minWidth: 0, flex: 1 }}>
                                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 800, color: '#0F2747' }}>
                                                                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{row.teamA.filter(Boolean).join(' / ') || '확인 필요'}</span>
                                                                <span style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 999, border: '1px solid #C7DCF1', color: '#1F5FB5', fontSize: 9, fontWeight: 900 }}>VS</span>
                                                                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.teamB.filter(Boolean).join(' / ') || '확인 필요'}</span>
                                                            </div>
                                                            {!ok && (
                                                                <p style={{ margin: '4px 0 0', fontSize: 10, fontWeight: 700, textAlign: 'center', color: '#C0392B' }}>
                                                                    형식을 확인해 주세요.
                                                                </p>
                                                            )}
                                                        </div>
                                                        <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, color: '#7A93B3' }}>{row.time || '--:--'}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #E1EAF5' }}>
                                    <button
                                        type="button"
                                        data-kdk-next-name-matching
                                        disabled={!canProceedToNameMatching}
                                        onClick={() => setManualStep('MATCH_NAMES')}
                                        style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            width: '100%', height: 54, boxSizing: 'border-box', borderRadius: 16,
                                            background: canProceedToNameMatching
                                                ? 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)'
                                                : '#E1EAF5',
                                            color: canProceedToNameMatching ? '#FFFFFF' : '#9CB2CC',
                                            border: 'none', fontSize: 14, fontWeight: 800,
                                            letterSpacing: '0.02em', cursor: canProceedToNameMatching ? 'pointer' : 'not-allowed',
                                            boxShadow: canProceedToNameMatching ? '0 12px 24px rgba(37,99,235,0.22)' : 'none',
                                        }}
                                    >
                                        다음: 이름 매칭 →
                                    </button>
                                    {!canProceedToNameMatching && (
                                        <p style={{ margin: '8px 0 0', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#7A93B3' }}>
                                            대진을 1개 이상 붙여넣으면 이름 매칭으로 이동할 수 있습니다.
                                        </p>
                                    )}
                                </div>
                            </div>

                            <p style={{ margin: '0 4px', fontSize: 11, fontWeight: 600, lineHeight: 1.55, color: '#7A93B3' }}>
                                다음 단계에서 이름을 멤버/게스트와 매칭합니다. 아직 저장은 하지 않습니다.
                            </p>
                        </div>
                    )}

                    {manualInputMode === 'PASTE' && manualStep === 'MATCH_NAMES' && (
                        // 이름 매칭(MATCH_NAMES) 단계의 실제 스크롤 콘텐츠 끝 — '다음: 룰 설정' CTA 포함.
                        // INPUT 단계와 동일하게 self-contained 하단 여백을 두어 CTA 가 BottomNav 아래로 깔리지 않게 한다.
                        <div
                            data-kdk-match-names-scroll-end
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 14,
                                paddingBottom: 'calc(var(--bottom-nav-area, 72px) + 48px + env(safe-area-inset-bottom))',
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => setManualStep('INPUT')}
                                style={{
                                    alignSelf: 'flex-start', borderRadius: 999,
                                    border: '1px solid #DCE8F5', background: '#FFFFFF',
                                    padding: '8px 14px', fontSize: 11, fontWeight: 800,
                                    color: '#3B5A85', cursor: 'pointer',
                                }}
                            >
                                ← 붙여넣기로 돌아가기
                            </button>

                            <div style={{
                                borderRadius: 22, background: '#FFFFFF',
                                border: '1px solid #DCE8F5', padding: 18,
                                boxShadow: '0 12px 28px rgba(15,45,85,0.06)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
                                    <div>
                                        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#3B82F6' }}>NAME MATCHING</span>
                                        <h2 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 900, color: '#0F2747' }}>이름 매칭</h2>
                                        <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 600, lineHeight: 1.55, color: '#56729A' }}>
                                            붙여넣은 이름을 멤버 또는 게스트와 연결합니다.
                                        </p>
                                    </div>
                                    <span style={{ flexShrink: 0, borderRadius: 999, border: '1px solid #DCE8F5', background: '#F6FAFD', padding: '4px 10px', fontSize: 10, fontWeight: 800, color: '#56729A' }}>
                                        {manualPlayerNames.length} names
                                    </span>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {manualNameMatches.map(match => (
                                        <div key={match.originalName} style={{
                                            borderRadius: 14, border: '1px solid #E1EAF5',
                                            background: '#F8FBFE', padding: 12,
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                                                <div style={{ minWidth: 0 }}>
                                                    <span style={{ display: 'block', fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9CB2CC' }}>ORIGINAL</span>
                                                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, fontWeight: 800, color: '#0F2747' }}>{match.originalName}</span>
                                                </div>
                                                <span style={{
                                                    flexShrink: 0, borderRadius: 999, padding: '4px 10px',
                                                    fontSize: 9, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase',
                                                    background: match.status === 'MEMBER' ? '#2563EB' : '#FFF4DE',
                                                    color: match.status === 'MEMBER' ? '#FFFFFF' : '#B7791F',
                                                    border: match.status === 'MEMBER' ? 'none' : '1px solid #F4C979',
                                                }}>
                                                    {match.status === 'MEMBER' ? 'MEMBER' : 'GUEST'}
                                                </span>
                                            </div>
                                            <select
                                                value={match.selectedValue}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setManualNameOverrides(prev => ({ ...prev, [match.originalName]: value }));
                                                }}
                                                style={{
                                                    width: '100%', borderRadius: 12,
                                                    border: '1px solid #DCE8F5', background: '#FFFFFF',
                                                    padding: '10px 12px', fontSize: 12.5, fontWeight: 700,
                                                    color: '#0F2747', outline: 'none', boxSizing: 'border-box',
                                                }}
                                            >
                                                {match.candidates.map(candidate => (
                                                    <option key={candidate.id} value={candidate.id}>
                                                        {getManualMemberName(candidate)} / 멤버
                                                    </option>
                                                ))}
                                                <option value="guest">
                                                    {match.originalName}(G) / 게스트로 사용
                                                </option>
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div style={{
                                borderRadius: 22, background: '#FFFFFF',
                                border: '1px solid #DCE8F5', padding: 16,
                                boxShadow: '0 12px 28px rgba(15,45,85,0.06)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                                    <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#3B82F6' }}>매칭 적용 미리보기</span>
                                    <span style={{ fontSize: 10, fontWeight: 800, color: '#1F5FB5', textAlign: 'right' }}>{manualPastePreview.length} matches · {manualGroups.length || 0} groups</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {manualPastePreview.map((row, index) => (
                                        <div key={`${row.raw}-matched-${index}`} style={{
                                            borderRadius: 14, border: '1px solid #E1EAF5',
                                            background: '#F8FBFE', padding: '10px 12px',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                                                <span style={{
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    minWidth: 52, padding: '4px 8px', borderRadius: 999,
                                                    background: '#2563EB', color: '#FFFFFF',
                                                    fontSize: 10, fontWeight: 900, flexShrink: 0,
                                                }}>
                                                    {getManualGroupLabel(row.group)} · {row.order}
                                                </span>
                                                <div style={{ minWidth: 0, flex: 1 }}>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 800, color: '#0F2747' }}>
                                                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{row.teamA.map(getManualResolvedName).join(' / ')}</span>
                                                        <span style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 999, border: '1px solid #C7DCF1', color: '#1F5FB5', fontSize: 9, fontWeight: 900 }}>VS</span>
                                                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.teamB.map(getManualResolvedName).join(' / ')}</span>
                                                    </div>
                                                </div>
                                                <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, color: '#7A93B3' }}>{row.time || '--:--'}</span>
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
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: '100%', height: 60, boxSizing: 'border-box', borderRadius: 18,
                                    background: 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                                    color: '#FFFFFF', fontSize: 15, fontWeight: 800,
                                    letterSpacing: '0.02em', border: 'none', cursor: 'pointer',
                                    boxShadow: '0 14px 28px rgba(37,99,235,0.24)',
                                }}
                            >
                                다음: 룰 설정 →
                            </button>
                        </div>
                    )}

                    {manualInputMode === 'PASTE' && manualStep === 'RULES' && (
                        <div style={{
                            borderRadius: 22, background: '#FFFFFF',
                            border: '1px solid #DCE8F5', padding: '24px 20px',
                            textAlign: 'center', boxShadow: '0 12px 28px rgba(15,45,85,0.06)',
                        }}>
                            <p style={{ margin: 0, fontSize: 17, fontWeight: 900, color: '#0F2747' }}>룰 설정은 다음 단계에서 연결됩니다.</p>
                            <p style={{ margin: '10px 0 0', fontSize: 12, fontWeight: 600, lineHeight: 1.55, color: '#56729A' }}>
                                이번 단계에서는 이름 매칭과 매칭 적용 미리보기까지 저장 없이 준비합니다.
                            </p>
                            <button
                                type="button"
                                onClick={() => setManualStep('MATCH_NAMES')}
                                style={{
                                    marginTop: 18, borderRadius: 999,
                                    border: '1px solid #DCE8F5', background: '#F6FAFD',
                                    padding: '10px 18px', fontSize: 12, fontWeight: 800,
                                    color: '#3B5A85', cursor: 'pointer',
                                }}
                            >
                                이름 매칭으로 돌아가기
                            </button>
                        </div>
                    )}

                    {manualInputMode === 'DIRECT' && (
                        <div style={{
                            borderRadius: 22, background: '#F6FAFD',
                            border: '1px solid #E1EAF5', padding: '28px 20px', textAlign: 'center',
                        }}>
                            <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0F2747' }}>직접 만들기 준비 중</p>
                            <p style={{ margin: '8px 0 0', fontSize: 12, fontWeight: 600, lineHeight: 1.55, color: '#56729A' }}>
                                추후 참가자를 선택하고 경기별 팀을 직접 구성합니다.
                            </p>
                        </div>
                    )}

                    {manualInputMode === 'OCR' && (
                        <div style={{
                            borderRadius: 22, background: '#F6FAFD',
                            border: '1px solid #E1EAF5', padding: '28px 20px', textAlign: 'center',
                        }}>
                            <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0F2747' }}>캡처 인식 Coming Soon</p>
                            <p style={{ margin: '8px 0 0', fontSize: 12, fontWeight: 600, lineHeight: 1.55, color: '#56729A' }}>
                                이미지/OCR 기반 대진 인식은 다음 단계에서 검토합니다.
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
        const manualExpectedSummary = (() => {
            const groupCounts = manualPastePreview.reduce<Record<string, number>>((acc, row) => {
                const group = normalizeManualGroup(row.group);
                acc[group] = (acc[group] || 0) + 1;
                return acc;
            }, {});
            const timeList = Array.from(new Set(
                manualPastePreview
                    .map(row => row.time?.trim())
                    .filter((time): time is string => Boolean(time))
            ));
            const roundKeys = Array.from(new Set(manualPastePreview.map((row, index) => (
                row.time?.trim() ? `TIME_${row.time.trim()}` : `ORDER_${row.order || index + 1}`
            ))));
            const guestNames = manualNameMatches
                .filter(match => match.status === 'GUEST')
                .map(match => match.displayName);
            const unmatchedNames = manualNameMatches
                .filter(match => match.status === 'GUEST' && match.candidates.length === 0)
                .map(match => match.displayName);
            const invalidRows = manualPastePreview.filter(row => !row.isValid);
            const rowsWithoutGroup = manualPastePreview.filter(row => !row.group?.trim());
            const rowsWithoutTime = manualPastePreview.filter(row => !row.time?.trim());
            const warnings = [
                ...(manualPastePreview.length === 0 ? ['No manual matches'] : []),
                ...((groupCounts.A || 0) === 0 ? ['A group has 0 matches'] : []),
                ...((groupCounts.B || 0) === 0 ? ['B group has 0 matches'] : []),
                ...(unmatchedNames.length > 0 ? [`Unmatched names: ${unmatchedNames.join(', ')}`] : []),
                ...(invalidRows.length > 0 ? [`Invalid rows: ${invalidRows.length}`] : []),
                ...(rowsWithoutGroup.length > 0 ? [`Missing groupName rows: ${rowsWithoutGroup.length}`] : []),
                ...(rowsWithoutTime.length > 0 ? [`Rows without time: ${rowsWithoutTime.length}`] : []),
                ...(totalCourts < 1 || totalCourts > 99 ? [`Invalid courts: ${totalCourts}`] : []),
            ];

            return {
                totalMatches: manualPastePreview.length,
                groupA: groupCounts.A || 0,
                groupB: groupCounts.B || 0,
                totalRounds: roundKeys.length,
                timeList,
                guestNames,
                unmatchedNames,
                rowsWithoutGroup,
                rowsWithoutTime,
                warnings,
                isReady: warnings.length === 0,
            };
        })();
        const isStep2ButtonDisabled = isGenerating || (isManualRulesMode && (
            manualExpectedSummary.totalMatches === 0 ||
            totalCourts < 1 ||
            totalCourts > 99
        ));
        const timeOptions = ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"];
        const availablePlayersForPartnering = [...allMembers, ...tempGuests].filter(m => 
            selectedIds.has(m.id) && (partnerSelectSource === 'NEW' ? true : m.id !== partnerSelectSource)
        );

        return (
            <main
                className="relative w-full font-sans"
                data-kdk-rules-scroll-end
                style={{
                    // minHeight:100dvh 제거: flex 자식이 640으로 shrink 되면 콘텐츠가 넘쳐(visible overflow)
                    //   marginBottom 음수(-page-bottom-safe)를 상쇄할 GlobalMain 공통 padding 이 반영되지 않아
                    //   마지막 CTA 가 nav 뒤로 들어간다(실측 +18). 콘텐츠 흐름 높이로 두면 공통 padding 이 정상 반영된다.
                    marginBottom: 'calc(-1 * var(--page-bottom-safe))',
                    backgroundColor: '#F4F8FC',
                    color: '#0F2747',
                    paddingBottom: 'calc(var(--bottom-nav-area, 72px) + 48px)',
                    boxSizing: 'border-box',
                }}
            >
                <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 520, margin: '0 auto', padding: '20px 16px 16px', width: '100%', boxSizing: 'border-box' }}>
                    <button
                        onClick={() => {
                            if (isManualRulesMode) {
                                setManualStep('MATCH_NAMES');
                            }
                            setStep(1);
                        }}
                        aria-label="뒤로"
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 44, height: 44, borderRadius: '50%',
                            border: '1px solid #DCE8F5', backgroundColor: '#FFFFFF',
                            color: '#3B5A85', boxShadow: '0 4px 12px rgba(15,45,85,0.06)',
                            cursor: 'pointer',
                        }}
                    >
                        <span style={{ fontSize: 20, lineHeight: 1 }}>←</span>
                    </button>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <span style={{
                            display: 'inline-block', borderRadius: 999,
                            border: '1px solid #C7DCF1', backgroundColor: '#EAF3FC',
                            padding: '4px 12px', fontSize: 10, fontWeight: 900,
                            letterSpacing: '0.22em', textTransform: 'uppercase',
                            color: '#1F5FB5',
                        }}>
                            STEP 3 · RULES
                        </span>
                        {isAdmin && (
                            <span style={{
                                display: 'inline-block', borderRadius: 999,
                                background: '#FFF4DE', border: '1px solid #F4C979',
                                padding: '2px 10px', fontSize: 9, fontWeight: 900,
                                letterSpacing: '0.15em', textTransform: 'uppercase',
                                color: '#B7791F',
                            }}>
                                CEO
                            </span>
                        )}
                    </div>

                    <button
                        onClick={() => {
                            if (!isAdmin) return triggerAccessDenied();
                            setShowResetConfirm(true);
                        }}
                        title="전체 데이터 초기화"
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                            height: 36, padding: '0 12px', borderRadius: 999,
                            background: '#FDEEEE', border: '1px solid #F4C7C7',
                            color: '#C0392B', fontSize: 10, fontWeight: 900,
                            letterSpacing: '0.04em', cursor: 'pointer',
                        }}
                    >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                        <span>초기화</span>
                    </button>
                </header>

                <div style={{ maxWidth: 520, margin: '0 auto', width: '100%', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14, boxSizing: 'border-box' }}>

                    <section style={{
                        borderRadius: 18, background: '#FFFFFF',
                        border: '1px solid #DCE8F5', padding: 16,
                        boxShadow: '0 8px 20px rgba(15,45,85,0.05)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563EB' }} />
                            <h3 style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#1F5FB5' }}>ARCHIVE TITLE</h3>
                        </div>
                        <input
                            type="text"
                            value={sessionTitle}
                            onChange={(e) => setSessionTitle(e.target.value)}
                            style={{
                                width: '100%', borderRadius: 14,
                                background: '#F8FBFE', border: '1px solid #DCE8F5',
                                padding: '14px 16px', fontSize: 13.5, fontWeight: 700,
                                color: '#0F2747', outline: 'none', boxSizing: 'border-box',
                            }}
                            placeholder="Ex: 2026-03-27 테연 정기전"
                        />
                    </section>

                    {!isManualRulesMode ? (
                    <section style={{
                        background: '#FFFFFF', border: '1px solid #DCE8F5',
                        borderRadius: 22, padding: 18, marginBottom: 0,
                        boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <h3 style={{
                                margin: 0, display: 'flex', alignItems: 'center', gap: 8,
                                fontSize: 12, fontWeight: 900, color: '#1F5FB5',
                                letterSpacing: '0.22em', textTransform: 'uppercase',
                            }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563EB' }} />
                                ATTENDEE MATRIX
                            </h3>
                            <span style={{
                                borderRadius: 999, padding: '4px 10px',
                                background: '#F6FAFD', border: '1px solid #DCE8F5',
                                fontSize: 10, fontWeight: 900, color: '#56729A',
                                letterSpacing: '0.14em', textTransform: 'uppercase',
                            }}>
                                {attendees.length} ACTIVE
                            </span>
                        </div>
                        <div className="no-scrollbar" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 480, overflowY: 'auto' }}>
                            {attendees.map(m => {
                                const config = attendeeConfigs[m.id] || { id: m.id, name: m.name, startTime: "19:00", endTime: "22:00", group: "A" };
                                return (
                                    <div key={m.id} style={{
                                        background: '#F8FBFE', border: '1px solid #E1EAF5',
                                        borderRadius: 16, padding: '12px 14px',
                                        display: 'flex', flexDirection: 'column', gap: 8,
                                    }}>
                                        <span style={{ fontSize: 14, fontWeight: 800, color: '#0F2747' }}>
                                            {m.name}{m.is_guest ? ' (G)' : ''}
                                        </span>

                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <button
                                                    onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, isLate: !config.isLate } }))}
                                                    style={{
                                                        width: 32, height: 32, borderRadius: 10,
                                                        border: config.isLate ? '1px solid #F4C979' : '1px solid #DCE8F5',
                                                        background: config.isLate ? '#FFF4DE' : '#FFFFFF',
                                                        color: config.isLate ? '#B7791F' : '#7A93B3',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        cursor: 'pointer', fontSize: 14,
                                                    }}
                                                >🕒</button>
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                    background: '#FFFFFF', borderRadius: 12,
                                                    padding: '4px 8px', border: '1px solid #DCE8F5',
                                                }}>
                                                    <select value={config.startTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, startTime: e.target.value } }))} style={{ background: 'transparent', color: '#0F2747', fontSize: 13, fontWeight: 700, outline: 'none', appearance: 'none', textAlign: 'center', width: 46, cursor: 'pointer', border: 'none' }}>
                                                        {timeOptions.map(t => <option key={t} value={t} style={{ background: '#FFFFFF', color: '#0F2747' }}>{t}</option>)}
                                                    </select>
                                                    <span style={{ color: '#9CB2CC', fontSize: 10, fontWeight: 700 }}>TO</span>
                                                    <select value={config.endTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, endTime: e.target.value } }))} style={{ background: 'transparent', color: '#0F2747', fontSize: 13, fontWeight: 700, outline: 'none', appearance: 'none', textAlign: 'center', width: 46, cursor: 'pointer', border: 'none' }}>
                                                        {timeOptions.map(t => <option key={t} value={t} style={{ background: '#FFFFFF', color: '#0F2747' }}>{t}</option>)}
                                                    </select>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <button
                                                    onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'A' } }))}
                                                    style={{
                                                        width: 40, height: 40, borderRadius: 12,
                                                        background: config.group === 'A' ? '#2563EB' : '#FFFFFF',
                                                        color: config.group === 'A' ? '#FFFFFF' : '#56729A',
                                                        border: config.group === 'A' ? 'none' : '1px solid #DCE8F5',
                                                        fontWeight: 900, fontSize: 15,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        cursor: 'pointer',
                                                        boxShadow: config.group === 'A' ? '0 6px 14px rgba(37,99,235,0.24)' : 'none',
                                                        transition: 'all 0.15s',
                                                    }}
                                                >A</button>
                                                <button
                                                    onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'B' } }))}
                                                    style={{
                                                        width: 40, height: 40, borderRadius: 12,
                                                        background: config.group === 'B' ? '#2563EB' : '#FFFFFF',
                                                        color: config.group === 'B' ? '#FFFFFF' : '#56729A',
                                                        border: config.group === 'B' ? 'none' : '1px solid #DCE8F5',
                                                        fontWeight: 900, fontSize: 15,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        cursor: 'pointer',
                                                        boxShadow: config.group === 'B' ? '0 6px 14px rgba(37,99,235,0.24)' : 'none',
                                                        transition: 'all 0.15s',
                                                    }}
                                                >B</button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                    ) : (
                    <section style={{
                        background: '#FFFFFF', border: '1px solid #DCE8F5',
                        borderRadius: 22, padding: 18, marginBottom: 0,
                        boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                        overflow: 'visible',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <h3 style={{
                                margin: 0, display: 'flex', alignItems: 'center', gap: 8,
                                fontSize: 12, fontWeight: 900, color: '#1F5FB5',
                                letterSpacing: '0.22em', textTransform: 'uppercase',
                            }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563EB' }} />
                                MANUAL MATCH SUMMARY
                            </h3>
                            <span style={{
                                borderRadius: 999, padding: '4px 10px',
                                background: '#F6FAFD', border: '1px solid #DCE8F5',
                                fontSize: 10, fontWeight: 900, color: '#56729A',
                                letterSpacing: '0.14em', textTransform: 'uppercase',
                            }}>
                                {manualMatchedRows.length} MATCHES
                            </span>
                        </div>
                        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {manualMatchedGroups.map(({ group, rows }) => (
                                <div key={`manual-rules-group-${group}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px' }}>
                                        <span style={{
                                            borderRadius: 999, padding: '4px 10px',
                                            background: '#FFF4DE', border: '1px solid #F4C979',
                                            fontSize: 10, fontWeight: 900, color: '#B7791F',
                                            letterSpacing: '0.06em',
                                        }}>
                                            {getManualGroupLabel(group)}
                                        </span>
                                        <span style={{
                                            fontSize: 10, fontWeight: 800,
                                            letterSpacing: '0.16em', textTransform: 'uppercase',
                                            color: '#7A93B3',
                                        }}>
                                            {rows.length} matches
                                        </span>
                                    </div>
                                    {rows.map((row, index) => (
                                        <div key={`${row.raw}-rules-${group}-${index}`} style={{
                                            background: '#F8FBFE', border: '1px solid #E1EAF5',
                                            borderRadius: 16, padding: '12px 14px',
                                            display: 'flex', alignItems: 'center', gap: 12,
                                        }}>
                                            <span style={{
                                                width: 28, height: 28, borderRadius: '50%',
                                                background: '#2563EB', color: '#FFFFFF',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 11, fontWeight: 900, flexShrink: 0,
                                            }}>
                                                {row.order}
                                            </span>
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                                <div style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
                                                    alignItems: 'center', gap: 8,
                                                    fontSize: 12, fontWeight: 800, color: '#0F2747',
                                                }}>
                                                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                                                        {row.teamAResolved.join(' / ')}
                                                    </span>
                                                    <span style={{
                                                        flexShrink: 0, padding: '1px 6px',
                                                        borderRadius: 999, border: '1px solid #C7DCF1',
                                                        color: '#1F5FB5', fontSize: 9, fontWeight: 900,
                                                    }}>
                                                        VS
                                                    </span>
                                                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {row.teamBResolved.join(' / ')}
                                                    </span>
                                                </div>
                                            </div>
                                            <span style={{ fontSize: 10, fontWeight: 800, color: '#7A93B3', flexShrink: 0 }}>
                                                {row.time || '--:--'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            ))}
                            <div style={{
                                borderRadius: 14, border: '1px solid #F4C979',
                                background: '#FFF8E6', padding: '12px 14px',
                            }}>
                                <p style={{
                                    margin: 0, fontSize: 11.5, fontWeight: 700,
                                    lineHeight: 1.55, color: '#8A6A20',
                                }}>
                                    수동 구성은 승리 점수 6점 고정, 1:1 시작을 기본 전제로 사용합니다.
                                </p>
                            </div>
                        </div>
                    </section>
                    )}


                    {!isManualRulesMode && (
                    <section style={{
                        background: '#FFFFFF', border: '1px solid #DCE8F5',
                        borderRadius: 22, padding: 18, marginBottom: 0,
                        boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                    }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <h4 style={{
                                margin: 0, display: 'flex', alignItems: 'center', gap: 8,
                                fontSize: 12, fontWeight: 900, color: '#1F5FB5',
                                letterSpacing: '0.22em', textTransform: 'uppercase',
                            }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563EB' }} />
                                CORE STRATEGY
                            </h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                                {(['RANDOM', 'AGE', 'AWARD', 'MBTI'] as const).map(mode => {
                                    const active = genMode === mode;
                                    return (
                                        <button
                                            key={mode}
                                            onClick={() => setGenMode(mode)}
                                            style={{
                                                background: active ? '#EEF6FF' : '#FFFFFF',
                                                border: active ? '2px solid #2563EB' : '1px solid #DCE8F5',
                                                color: active ? '#1F5FB5' : '#56729A',
                                                borderRadius: 16,
                                                padding: '18px 8px',
                                                fontSize: 13.5,
                                                fontWeight: 900,
                                                cursor: 'pointer',
                                                boxShadow: active ? '0 8px 18px rgba(37,99,235,0.16)' : '0 4px 12px rgba(15,45,85,0.04)',
                                                transition: 'all 0.15s',
                                            }}
                                        >
                                            {mode === 'RANDOM' ? 'RANDOM' : mode === 'AGE' ? 'YB/OB' : mode === 'AWARD' ? '입상/비입상' : 'MBTI'}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <h4 style={{
                                    margin: 0, display: 'flex', alignItems: 'center', gap: 8,
                                    fontSize: 12, fontWeight: 900, color: '#1F5FB5',
                                    letterSpacing: '0.22em', textTransform: 'uppercase',
                                }}>
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563EB' }} />
                                    FIXED PARTNERS
                                </h4>
                                <button
                                    onClick={() => setFixedTeamMode(!fixedTeamMode)}
                                    style={{
                                        padding: '6px 12px',
                                        borderRadius: 999,
                                        fontSize: 11,
                                        fontWeight: 800,
                                        border: fixedTeamMode ? 'none' : '1px solid #DCE8F5',
                                        background: fixedTeamMode ? '#2563EB' : '#FFFFFF',
                                        color: fixedTeamMode ? '#FFFFFF' : '#56729A',
                                        cursor: 'pointer',
                                        letterSpacing: '0.05em',
                                        textTransform: 'uppercase',
                                        boxShadow: fixedTeamMode ? '0 6px 14px rgba(37,99,235,0.24)' : 'none',
                                    }}
                                >
                                    {fixedTeamMode ? 'TEAM MODE' : 'ROUND 1 ONLY'}
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {fixedPartners.map((pair, idx) => (
                                    <div key={idx} style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        background: '#F8FBFE', border: '1px solid #E1EAF5',
                                        padding: '12px 14px', borderRadius: 16,
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, fontWeight: 800, color: '#0F2747' }}>
                                            <span>{getPlayerName(pair[0])}</span>
                                            <span style={{ color: '#2563EB', fontSize: 16 }}>♥</span>
                                            <span>{getPlayerName(pair[1])}</span>
                                        </div>
                                        <button
                                            onClick={() => setFixedPartners(prev => prev.filter((_, i) => i !== idx))}
                                            style={{
                                                width: 32, height: 32, borderRadius: '50%',
                                                background: '#FDEEEE', border: '1px solid #F4C7C7',
                                                color: '#C0392B', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 18, lineHeight: 1, cursor: 'pointer',
                                            }}
                                        >×</button>
                                    </div>
                                ))}
                                <button
                                    onClick={() => setPartnerSelectSource('NEW')}
                                    style={{
                                        width: '100%', padding: '14px 0',
                                        border: '2px dashed #B6D2EE',
                                        borderRadius: 16,
                                        fontSize: 12.5,
                                        fontWeight: 900,
                                        color: '#1F5FB5',
                                        background: '#F6FAFD',
                                        cursor: 'pointer',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.1em',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    + ADD FIXED PARTNER
                                </button>
                            </div>
                        </div>
                    </section>
                    )}


                    <section style={{ background: '#FFFFFF', border: '1px solid #DCE8F5', borderRadius: '22px', padding: '20px', marginTop: '0', overflow: 'visible', boxShadow: '0 10px 24px rgba(15,45,85,0.05)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <h4 style={{ fontSize: '12px', fontWeight: 900, color: '#1F5FB5', textTransform: 'uppercase', letterSpacing: '0.22em', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#2563EB', flexShrink: 0, display: 'inline-block' }} />
                                STEP 3 · 규칙 설정
                            </h4>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F8FBFE', padding: '0 18px', height: '72px', borderRadius: '16px', border: '1px solid #E1EAF5' }}>
                                <span style={{ fontSize: '13px', fontWeight: 800, color: '#0F2747', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Courts</span>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '170px', height: '40px' }}>
                                    <button type="button" onClick={() => commitTotalCourts(totalCourts - 1)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#FFFFFF', border: '1px solid #DCE8F5', color: '#1F5FB5', fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
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
                                            border: '1px solid #C7DCF1',
                                            background: '#EAF3FC',
                                            color: '#1F5FB5',
                                            fontSize: '24px',
                                            fontWeight: 900,
                                            textAlign: 'center',
                                            outline: 'none',
                                            flex: 'none',
                                            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)'
                                        }}
                                    />
                                    <button type="button" onClick={() => commitTotalCourts(totalCourts + 1)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#FFFFFF', border: '1px solid #DCE8F5', color: '#1F5FB5', fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F8FBFE', padding: '0 18px', height: '72px', borderRadius: '16px', border: '1px solid #E1EAF5' }}>
                                <span style={{ fontSize: '13px', fontWeight: 800, color: '#0F2747', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Match Mins</span>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '160px', height: '40px' }}>
                                    <button onClick={() => setMatchTime(Math.max(30, matchTime - 30))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#FFFFFF', border: '1px solid #DCE8F5', color: '#1F5FB5', fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
                                    <span style={{ fontSize: '24px', fontWeight: 900, color: '#1F5FB5', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', flex: 'none' }}>{matchTime}</span>
                                    <button onClick={() => setMatchTime(matchTime + 30)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#FFFFFF', border: '1px solid #DCE8F5', color: '#1F5FB5', fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '24px' }}>
                            <h4 style={{ fontSize: '12px', fontWeight: 900, color: '#1F5FB5', textTransform: 'uppercase', letterSpacing: '0.22em', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#2563EB', flexShrink: 0, display: 'inline-block' }} />
                                벌금 · 게스트비
                            </h4>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F8FBFE', padding: '0 18px', height: '72px', borderRadius: '16px', border: '1px solid #E1EAF5' }}>
                                <span style={{ fontSize: '13px', fontWeight: 800, color: '#0F2747', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prize Gold</span>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '160px', height: '40px' }}>
                                    <button onClick={() => setFirstPrize(Math.max(0, firstPrize - 5000))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#FFFFFF', border: '1px solid #DCE8F5', color: '#1F5FB5', fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
                                    <span style={{ fontSize: '22px', fontWeight: 900, color: '#0F2747', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', flex: 'none' }}>{(firstPrize / 1000).toFixed(0)}k</span>
                                    <button onClick={() => setFirstPrize(firstPrize + 5000)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#FFFFFF', border: '1px solid #DCE8F5', color: '#1F5FB5', fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F8FBFE', padding: '0 18px', height: '72px', borderRadius: '16px', border: '1px solid #E1EAF5' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#FACC15', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tier 1 Fine</span>
                                    <span style={{ fontSize: '10px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Bottom 25%~50%</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '160px', height: '40px' }}>
                                    <button onClick={() => setBottom25Late(Math.max(0, bottom25Late - 1000))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#FFFFFF', border: '1px solid #DCE8F5', color: '#1F5FB5', fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
                                    <span style={{ fontSize: '22px', fontWeight: 900, color: '#0F2747', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', flex: 'none' }}>{(bottom25Late / 1000).toFixed(0)}k</span>
                                    <button onClick={() => setBottom25Late(bottom25Late + 1000)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#FFFFFF', border: '1px solid #DCE8F5', color: '#1F5FB5', fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F8FBFE', padding: '0 18px', height: '72px', borderRadius: '16px', border: '1px solid #E1EAF5' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tier 2 Fine</span>
                                    <span style={{ fontSize: '10px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Bottom 0%~25%</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '160px', height: '40px' }}>
                                    <button onClick={() => setBottom25Penalty(Math.max(0, bottom25Penalty - 1000))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#FFFFFF', border: '1px solid #DCE8F5', color: '#1F5FB5', fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
                                    <span style={{ fontSize: '22px', fontWeight: 900, color: '#0F2747', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', flex: 'none' }}>{(bottom25Penalty / 1000).toFixed(0)}k</span>
                                    <button onClick={() => setBottom25Penalty(bottom25Penalty + 1000)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#FFFFFF', border: '1px solid #DCE8F5', color: '#1F5FB5', fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>

                            {/* 이번 KDK 게스트비 — kdk_session_meta.guest_fee 단일 출처. 정모·Guest Pass·순위표·결과에 동일 적용.
                                미설정(null)이면 '미설정' 표시, ± 클릭 시 확정 저장. 자동 시드/schedule fallback 없음. */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F8FBFE', padding: '0 18px', height: '72px', borderRadius: '16px', border: '1px solid #E1EAF5' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#16A085', textTransform: 'uppercase', letterSpacing: '0.05em' }}>이번 KDK 게스트비</span>
                                    <span style={{ fontSize: '10px', color: officialLocked ? '#B7791F' : '#9CA3AF', letterSpacing: '0.02em' }}>
                                        {officialLocked ? OFFICIAL_LOCK_MSG : '정모·Guest Pass·순위표·결과 동일 적용'}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '160px', height: '40px' }}>
                                    <button onClick={() => changeGuestFee((guestFee ?? 0) - 1000)} disabled={officialLocked} style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#FFFFFF', border: '1px solid #DCE8F5', color: '#1F5FB5', fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: officialLocked ? 'not-allowed' : 'pointer', opacity: officialLocked ? 0.4 : 1, flex: 'none' }}>−</button>
                                    <span style={{ fontSize: guestFee == null || guestFee === 0 ? '13px' : '22px', fontWeight: 900, color: guestFee == null ? '#9CA3AF' : '#0F2747', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', flex: 'none' }}>{guestFee == null ? '미설정' : guestFee === 0 ? '무료' : `${(guestFee / 1000).toFixed(0)}k`}</span>
                                    <button onClick={() => changeGuestFee((guestFee ?? 0) + 1000)} disabled={officialLocked} style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#FFFFFF', border: '1px solid #DCE8F5', color: '#1F5FB5', fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: officialLocked ? 'not-allowed' : 'pointer', opacity: officialLocked ? 0.4 : 1, flex: 'none' }}>+</button>
                                </div>
                            </div>
                        </div>


                        <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #E1EAF5' }}>
                            <h4 style={{ fontSize: '12px', fontWeight: 900, color: '#1F5FB5', textTransform: 'uppercase', letterSpacing: '0.22em', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#2563EB', flexShrink: 0, display: 'inline-block' }} />
                                토너먼트 규칙 메모
                            </h4>
                            <textarea
                                value={matchRules}
                                onChange={(e) => setMatchRules(e.target.value)}
                                style={{ width: '100%', background: '#F8FBFE', border: '1px solid #DCE8F5', borderRadius: '14px', padding: '14px', fontSize: 13, fontWeight: 600, color: '#0F2747', minHeight: '110px', outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.6 }}
                                placeholder="토너먼트 규칙을 입력하세요..."
                            />
                        </div>
                    </section>

                    {isManualRulesMode && (
                        <section style={{
                            borderRadius: 22, background: '#FFFFFF',
                            border: '1px solid #DCE8F5', padding: 18,
                            boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                                <div>
                                    <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#3B82F6' }}>STEP 4 · 대진 요약</p>
                                    <h4 style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 900, letterSpacing: '-0.01em', color: '#0F2747' }}>저장 전 확인</h4>
                                </div>
                                <span style={{
                                    borderRadius: 999, padding: '4px 12px',
                                    fontSize: 10, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase',
                                    background: manualExpectedSummary.isReady ? '#E0F5EB' : '#FDEEEE',
                                    color: manualExpectedSummary.isReady ? '#16A085' : '#C0392B',
                                    border: manualExpectedSummary.isReady ? '1px solid #B6E2CB' : '1px solid #F4C7C7',
                                }}>
                                    {manualExpectedSummary.isReady ? 'READY' : 'CHECK'}
                                </span>
                            </div>

                            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                                {[
                                    ['총 경기', manualExpectedSummary.totalMatches],
                                    ['코트', totalCourts],
                                    ['참가자', manualPlayerNames.length],
                                    ['게스트', manualExpectedSummary.guestNames.length],
                                    ['A조', manualExpectedSummary.groupA],
                                    ['B조', manualExpectedSummary.groupB],
                                    ['라운드', manualExpectedSummary.totalRounds],
                                    ['Group field', manualExpectedSummary.rowsWithoutGroup.length === 0 ? 'OK' : 'MISS'],
                                ].map(([label, value]) => (
                                    <div key={label} style={{
                                        borderRadius: 14, border: '1px solid #E1EAF5',
                                        background: '#F8FBFE', padding: '10px 12px',
                                    }}>
                                        <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7A93B3' }}>{label}</p>
                                        <p style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 900, color: '#0F2747' }}>{value}</p>
                                    </div>
                                ))}
                            </div>

                            <div style={{ marginTop: 14, borderRadius: 14, border: '1px solid #D7E5F4', background: '#EEF5FB', padding: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, fontSize: 11 }}>
                                    <span style={{ flexShrink: 0, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#1F5FB5' }}>Times</span>
                                    <span style={{ textAlign: 'right', fontWeight: 700, color: '#3F5B82' }}>
                                        {manualExpectedSummary.timeList.length > 0 ? manualExpectedSummary.timeList.join(', ') : 'No time'}
                                    </span>
                                </div>
                                <div style={{ marginTop: 6, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, fontSize: 11 }}>
                                    <span style={{ flexShrink: 0, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#1F5FB5' }}>Guests</span>
                                    <span style={{ textAlign: 'right', fontWeight: 700, color: '#3F5B82' }}>
                                        {manualExpectedSummary.guestNames.length > 0 ? manualExpectedSummary.guestNames.join(', ') : 'None'}
                                    </span>
                                </div>
                                <div style={{ marginTop: 6, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, fontSize: 11 }}>
                                    <span style={{ flexShrink: 0, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#1F5FB5' }}>Rules</span>
                                    <span style={{ textAlign: 'right', fontWeight: 700, color: '#3F5B82' }}>
                                        Win 6 / L1 {(bottom25Late / 1000).toFixed(0)}k / L2 {(bottom25Penalty / 1000).toFixed(0)}k / Guest {guestFee == null ? '미설정' : `${(guestFee / 1000).toFixed(0)}k`}
                                    </span>
                                </div>
                            </div>

                            {manualExpectedSummary.warnings.length > 0 && (
                                <div style={{ marginTop: 14, borderRadius: 14, border: '1px solid #F4C7C7', background: '#FDEEEE', padding: 12 }}>
                                    <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#C0392B' }}>Warnings</p>
                                    <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 11.5, fontWeight: 700, lineHeight: 1.55, color: '#9B2C2C' }}>
                                        {manualExpectedSummary.warnings.map(warning => (
                                            <li key={warning}>{warning}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </section>
                    )}



                    {/* STEP 4 저장 전 확인 — 액션 버튼을 fixed overlay 가 아닌 콘텐츠 최하단 일반 흐름으로 배치.
                        RULES/GUESTS/WARNINGS 아래, 스크롤 끝에서만 노출되어 카드를 가리지 않는다. */}
                    {isAdmin && (
                        <div data-kdk-rules-actions style={{ position: 'relative', width: '100%', marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <button
                                data-kdk-rules-primary-cta
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
                                    height: 56,
                                    borderRadius: 16,
                                    background: isStep2ButtonDisabled
                                        ? '#E1EAF5'
                                        : 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                                    color: isStep2ButtonDisabled ? '#9CB2CC' : '#FFFFFF',
                                    border: 'none',
                                    fontSize: 14.5,
                                    fontWeight: 800,
                                    letterSpacing: '0.02em',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 8,
                                    cursor: isStep2ButtonDisabled ? 'not-allowed' : 'pointer',
                                    boxShadow: isStep2ButtonDisabled ? 'none' : '0 14px 28px rgba(37,99,235,0.26)',
                                    transition: 'all 0.15s',
                                }}
                            >
                                {isGenerating ? '저장 중...' : (isManualRulesMode ? '대진 저장 후 LIVE COURT 이동' : '대진 자동 생성 후 LIVE COURT 이동')}
                            </button>
                            <button
                                type="button"
                                data-kdk-rules-draft-cta
                                onClick={() => {
                                    setShowWarning(true);
                                    setWarningMsg('임시 저장 기능은 다음 업데이트에서 제공됩니다.');
                                }}
                                style={{
                                    width: '100%',
                                    height: 44,
                                    borderRadius: 14,
                                    background: '#FFFFFF',
                                    color: '#3B5A85',
                                    border: '1px solid #DCE8F5',
                                    fontSize: 12.5,
                                    fontWeight: 700,
                                    letterSpacing: '0.02em',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 10px rgba(15,45,85,0.05)',
                                }}
                            >
                                임시 저장
                            </button>
                        </div>
                    )}

                </div>


                {!isManualRulesMode && partnerSelectSource && (
                    <div style={{
                        position: 'fixed', inset: 0,
                        background: 'rgba(15,45,85,0.45)', backdropFilter: 'blur(8px)',
                        zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: 24,
                    }}>
                        <div style={{
                            background: '#FFFFFF', border: '1px solid #DCE8F5',
                            borderRadius: 24, width: '100%', maxWidth: 400,
                            padding: 22, display: 'flex', flexDirection: 'column', gap: 18,
                            boxShadow: '0 24px 60px rgba(15,45,85,0.18)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                                <div>
                                    <div style={{ fontSize: 10, fontWeight: 900, color: '#3B82F6', letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 4 }}>Strategy</div>
                                    <h3 style={{ fontSize: 20, fontWeight: 900, color: '#0F2747', margin: 0, letterSpacing: '-0.02em' }}>SELECT PARTNER</h3>
                                </div>
                                <button
                                    onClick={() => setPartnerSelectSource(null)}
                                    aria-label="닫기"
                                    style={{
                                        width: 36, height: 36, borderRadius: '50%',
                                        background: '#F6FAFD', border: '1px solid #DCE8F5',
                                        color: '#56729A', fontSize: 18, lineHeight: 1,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                                    }}
                                >×</button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
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
                                                padding: '12px 16px',
                                                borderRadius: 14,
                                                background: isSelected ? '#EEF6FF' : '#F8FBFE',
                                                border: isSelected ? '2px solid #2563EB' : '1px solid #E1EAF5',
                                                color: '#0F2747',
                                                fontSize: 14.5, fontWeight: 800,
                                                cursor: 'pointer',
                                                textAlign: 'left',
                                                transition: 'all 0.15s',
                                                boxShadow: isSelected ? '0 6px 14px rgba(37,99,235,0.16)' : 'none',
                                            }}
                                        >
                                            <span>{p.nickname}{p.is_guest ? ' (G)' : ''}</span>
                                            <span style={{
                                                fontSize: 10, fontWeight: 800,
                                                color: p.is_guest ? '#B7791F' : '#1F5FB5',
                                                textTransform: 'uppercase', letterSpacing: '0.12em',
                                            }}>
                                                {p.is_guest ? 'GUEST' : 'MEMBER'}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>

                            <p style={{
                                textAlign: 'center', fontSize: 11, fontWeight: 800,
                                color: '#56729A', textTransform: 'uppercase',
                                letterSpacing: '0.14em', margin: 0,
                            }}>
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
        return renderActiveSessionSelector();
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
        <main
            className="relative flex w-full flex-col font-sans"
            style={{
                minHeight: '100dvh',
                marginBottom: 'calc(-1 * var(--page-bottom-safe))',
                backgroundColor: '#F4F8FC',
                color: '#0F2747',
                paddingBottom: 'calc(var(--page-bottom-safe) + 60px)',
                boxSizing: 'border-box',
            }}>
            {/* Master Header: 4 explicit rows (session, action buttons, info, ticker). */}
            <header
                className="relative z-[200] flex flex-col gap-3 px-4 py-3 sm:px-5 sm:py-3.5"
                style={{ backgroundColor: '#FFFFFF', borderBottom: '1px solid #DCE8F5', boxShadow: '0 4px 16px rgba(15,45,85,0.06)' }}
            >
                {/* ROW 1: SESSION label + name + sync state */}
                <div className="flex w-full items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <span style={{
                            display: 'block', fontSize: 10, fontWeight: 900,
                            color: '#3B82F6', letterSpacing: '0.22em', textTransform: 'uppercase',
                            lineHeight: 1, marginBottom: 4,
                        }}>
                            SESSION
                        </span>
                        <h1
                            data-debug-session-title="kdk-header-title"
                            style={{
                                margin: 0,
                                fontSize: 20,
                                fontWeight: 900,
                                color: '#0F2747',
                                letterSpacing: '-0.02em',
                                lineHeight: 1.15,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {sessionTitle || '260417_KDK_01'}
                        </h1>
                    </div>
                    <div
                        title={lastSyncTime || ''}
                        style={{
                            flexShrink: 0,
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            borderRadius: 999, padding: '4px 10px',
                            background: '#F6FAFD', border: '1px solid #DCE8F5',
                        }}
                    >
                        <span
                            className={syncStatus === 'ERROR' ? 'animate-pulse' : ''}
                            style={{
                                width: 7, height: 7, borderRadius: '50%',
                                background:
                                    syncStatus === 'HEALTHY' ? '#16A085' :
                                    syncStatus === 'ERROR' ? '#EF4444' : '#F4C979',
                                boxShadow: syncStatus === 'HEALTHY' ? '0 0 6px rgba(22,160,133,0.45)' : 'none',
                            }}
                        />
                        <span style={{
                            fontSize: 10, fontWeight: 800,
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                            color: '#56729A', whiteSpace: 'nowrap',
                        }}>
                            {syncStatus === 'HEALTHY' ? '연결됨' : syncStatus === 'IDLE' ? '대기중' : '동기화 중'}
                        </span>
                    </div>
                </div>

                {/* ROW 2: action buttons (전광판 / 링크복사 / 대진표 / 결과 / 설정) */}
                <div className="flex w-full flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={openDisplayBoard}
                        disabled={!activeSessionId}
                        className="shrink-0 inline-flex items-center justify-center whitespace-nowrap transition-all active:scale-95 disabled:cursor-not-allowed"
                        style={{
                            height: 36, padding: '0 14px', borderRadius: 999,
                            border: !activeSessionId ? '1px solid #E1EAF5' : '1px solid #2563EB',
                            background: !activeSessionId ? '#F6FAFD' : 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                            color: !activeSessionId ? '#9CB2CC' : '#FFFFFF',
                            fontSize: 12.5, fontWeight: 900, letterSpacing: '0.04em',
                            boxShadow: !activeSessionId ? 'none' : '0 6px 14px rgba(37,99,235,0.22)',
                        }}
                        title="전광판 열기"
                    >
                        전광판
                    </button>
                    <button
                        type="button"
                        onClick={copyDisplayBoardUrl}
                        disabled={!activeSessionId}
                        className="shrink-0 inline-flex items-center justify-center whitespace-nowrap transition-all active:scale-95 disabled:cursor-not-allowed"
                        style={{
                            height: 36, padding: '0 14px', borderRadius: 999,
                            border: '1px solid #DCE8F5', background: '#FFFFFF',
                            color: !activeSessionId ? '#9CB2CC' : '#1F5FB5',
                            fontSize: 12.5, fontWeight: 900, letterSpacing: '0.04em',
                        }}
                        title="전광판 링크 복사"
                    >
                        링크복사
                    </button>
                    <button
                        type="button"
                        onClick={execCopySchedule}
                        className="shrink-0 inline-flex items-center justify-center whitespace-nowrap transition-all active:scale-95"
                        style={{
                            height: 36, padding: '0 14px', borderRadius: 999,
                            border: '1px solid #DCE8F5', background: '#FFFFFF', color: '#3B5A85',
                            fontSize: 12.5, fontWeight: 900, letterSpacing: '0.04em',
                        }}
                        title="대진표 복사"
                    >
                        대진표
                    </button>
                    <button
                        type="button"
                        onClick={copyFinalResults}
                        className="shrink-0 inline-flex items-center justify-center whitespace-nowrap transition-all active:scale-95"
                        style={{
                            height: 36, padding: '0 14px', borderRadius: 999,
                            border: '1px solid #DCE8F5', background: '#FFFFFF', color: '#3B5A85',
                            fontSize: 12.5, fontWeight: 900, letterSpacing: '0.04em',
                        }}
                        title="결과 공유"
                    >
                        결과
                    </button>
                    {adminModeManual && isAdmin && (
                        <button
                            type="button"
                            onClick={() => setShowMemberEditModal(true)}
                            className="shrink-0 inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-all active:scale-95"
                            style={{
                                height: 36, padding: '0 14px', borderRadius: 999,
                                border: '1px solid #DCE8F5', background: '#FFFFFF', color: '#3B5A85',
                                fontSize: 12.5, fontWeight: 900, letterSpacing: '0.04em',
                            }}
                            title="세션 관리"
                        >
                            <Settings className="h-3.5 w-3.5" />
                            세션 관리
                        </button>
                    )}
                </div>

                {/* ROW 3: operation info pills (WIN / PEN / GUEST / RULES) */}
                <div className="flex w-full flex-wrap items-center gap-2">
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        borderRadius: 999, padding: '4px 10px',
                        background: '#EEF5FB', border: '1px solid #DCE8F5',
                    }}>
                        <span style={{ fontSize: 9, fontWeight: 900, color: '#1F5FB5', letterSpacing: '0.16em', textTransform: 'uppercase' }}>WIN</span>
                        <span style={{ fontSize: 11, fontWeight: 900, color: '#0F2747' }}>{firstPrize/1000}K</span>
                    </span>
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        borderRadius: 999, padding: '4px 10px',
                        background: '#EEF5FB', border: '1px solid #DCE8F5',
                    }}>
                        <span style={{ fontSize: 9, fontWeight: 900, color: '#1F5FB5', letterSpacing: '0.16em', textTransform: 'uppercase' }}>PEN</span>
                        <span style={{ fontSize: 11, fontWeight: 900, color: '#0F2747' }}>{bottom25Penalty/1000}K</span>
                    </span>
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        borderRadius: 999, padding: '4px 10px',
                        background: '#EEF5FB', border: '1px solid #DCE8F5',
                    }}>
                        <span style={{ fontSize: 9, fontWeight: 900, color: '#1F5FB5', letterSpacing: '0.16em', textTransform: 'uppercase' }}>GUEST</span>
                        <span style={{ fontSize: 11, fontWeight: 900, color: '#0F2747' }}>{guestFee == null ? '미설정' : guestFee === 0 ? '무료' : `${guestFee / 1000}K`}</span>
                    </span>
                    <span
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            minWidth: 0, flex: '1 1 100%',
                            borderRadius: 12, padding: '6px 10px',
                            background: '#F6FAFD', border: '1px solid #E1EAF5',
                        }}
                    >
                        <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 900, color: '#1F5FB5', letterSpacing: '0.16em', textTransform: 'uppercase' }}>RULES</span>
                        <span style={{
                            minWidth: 0, flex: 1,
                            fontSize: 11, fontWeight: 700, color: '#3F5B82', lineHeight: 1.4,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                            {matchRules?.slice(0, 60) || '1:1 시작, 노애드, 타이 3:3 시작 7포인트 선승'}
                        </span>
                    </span>
                </div>

                {/* 운영성 입력(TICKER · 정모 연결)은 상단에서 제거하고 [세션 관리] 모달의
                    "운영 설정" 영역으로 이동했다. 상단은 운영 정보 요약(WIN/PEN/GUEST/RULES)만 노출. */}
            </header>

            <div className="flex-1 space-y-0 overflow-y-auto px-3 antialiased no-scrollbar sm:px-4" style={{ background: '#F4F8FC', paddingBottom: 'calc(var(--page-bottom-safe) + 100px)' }}>
                {activeTab === 'MATCHES' && (
                    <>
                        {/* 헤더(RULES 요약) ↔ NOW PLAYING 사이 명확한 여백(한쪽에만 적용해 중복 마진 방지). */}
                        <section className="h-auto" style={{ marginTop: '16px', position: 'relative', zIndex: 10 }}>
                            <div className="flex flex-col" style={{ marginBottom: '16px' }}>
                                <div className="flex items-center gap-3 ml-2">
                                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', textTransform: 'uppercase', color: '#0F2747' }}>NOW PLAYING</h2>
                                    {activeMatchIds.length > 0 && (
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 5,
                                            padding: '4px 10px', borderRadius: 999,
                                            background: '#FDEEEE', border: '1px solid #F4C7C7',
                                            color: '#C0392B',
                                            fontSize: 10, fontWeight: 900,
                                            letterSpacing: '0.18em', textTransform: 'uppercase',
                                        }}>
                                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#EF4444' }} className="animate-pulse" />
                                            {activeMatchIds.length} LIVE
                                        </span>
                                    )}
                                </div>
                                <div className="mt-2 h-0.5 w-32 ml-2" style={{ background: 'linear-gradient(to right, #2563EB, rgba(37,99,235,0.2), transparent)' }} />
                            </div>

                            {activeMatchIds.length === 0 ? (
                                <div style={{ padding: '48px 0', textAlign: 'center', color: '#9CB2CC', border: '1px dashed #C7DCF1', borderRadius: 18, background: '#F8FBFE', fontSize: 12, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                                    Waiting for next round...
                                </div>
                            ) : (
                                <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-5">
                                    {activeMatchIds
                                        .map(mId => ({ id: mId, match: matches.find(x => x.id === mId) }))
                                        .filter(x => x.match)
                                        .sort((a, b) => {
                                            if (a.match!.round !== b.match!.round) return (a.match!.round || 0) - (b.match!.round || 0);
                                            return (a.match!.id || '').localeCompare(b.match!.id || '');
                                        })
                                        .map(({ id: mId, match: m }) => {
                                            if (!m) return null;
                                            const matchNo = getDisplayMatchNo(m);

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
                        {/* NOW PLAYING 카드 영역 ↔ WAITING 섹션 사이 명확한 분리(A조/B조 공통 wrapper, 한쪽에만). */}
                        <div style={{ marginTop: '40px' }}>
                            {(() => {
                                const waitingMatches = matches.filter(m => m.status === 'waiting');
                                if (waitingMatches.length === 0) return (
                                    <div style={{ padding: '36px 0', textAlign: 'center', color: '#9CB2CC', border: '1px dashed #C7DCF1', borderRadius: 18, background: '#F8FBFE', fontSize: 11, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase' }}>No Matches in Queue</div>
                                );

                                return ['A', 'B'].map(group => {
                                    const groupMatches = waitingMatches.filter(m => normalizeKdkGroup(m.groupName || (m as any).group) === group).sort((a, b) => {
                                        if (a.round !== b.round) return (a.round || 0) - (b.round || 0);
                                        if ((a.court || 99) !== (b.court || 99)) return (a.court || 99) - (b.court || 99);
                                        return a.id.localeCompare(b.id);
                                    });

                                    if (groupMatches.length === 0) return null;

                                    const isB = group === 'B';
                                    const col = isB ? '#00E5FF' : '#C9B075';

                                    return (
                                        <div key={group} className="space-y-3">
                                            <div className="flex flex-col" style={{ marginBottom: '16px', marginTop: '32px' }}>
                                                <h3 style={{ margin: 0, marginLeft: 8, fontSize: 16, fontWeight: 900, letterSpacing: '-0.02em', textTransform: 'uppercase', color: '#0F2747' }}>
                                                    {`${isB ? 'B조' : 'A조'} WAITING`}
                                                </h3>
                                                <div className="mt-2 h-0.5 w-32 ml-2" style={{ background: `linear-gradient(to right, ${isB ? '#C2710C' : '#2563EB'}, rgba(37,99,235,0.2), transparent)` }} />
                                            </div>
                                            <div className="flex flex-col gap-6">
                                                {(() => {
                                                    const roundsInGroup = [...new Set(groupMatches.map(m => m.round || 1))].sort((a, b) => a - b);
                                                    return roundsInGroup.map(roundNum => {
                                                        const matchesInRound = groupMatches.filter(m => (m.round || 1) === roundNum);
                                                        return (
                                                                <div key={roundNum} className="space-y-3">
                                                                <div className="mb-1 ml-2 flex items-center gap-2">
                                                                    <div className="h-[1px] w-4" style={{ background: isB ? '#C2710C' : '#2563EB' }} />
                                                                    <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: isB ? '#C2710C' : '#1F5FB5' }}>ROUND {roundNum}</span>
                                                                    <div className="h-[1px] flex-1" style={{ background: `linear-gradient(to right, ${isB ? '#C2710C' : '#2563EB'}66, transparent)` }} />
                                                                </div>
                                                                {matchesInRound.map((m, idx) => {
                                                                    const matchNo = getDisplayMatchNo(m);
                                                                    const playingPlayerIdsInMatch = getPlayingPlayerIdsInMatch(m);
                                                                    const hasConflict = busyPlayerIds.has(m.playerIds[0]) || busyPlayerIds.has(m.playerIds[1]) || busyPlayerIds.has(m.playerIds[2]) || busyPlayerIds.has(m.playerIds[3]);

                                                                    return (
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
                                <h3 style={{ margin: 0, marginLeft: 8, fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', textTransform: 'uppercase', color: '#56729A' }}>COMPLETED MATCHES</h3>
                                <div className="mt-2 h-0.5 w-48 ml-2" style={{ background: 'linear-gradient(to right, #56729A, rgba(86,114,154,0.2), transparent)', marginBottom: '16px' }} />
                                <div className="grid grid-cols-2 gap-3 mt-4">
                                    {matches.filter(m => m.status === 'complete')
                                        .sort((a, b) => {
                                            const gA = normalizeKdkGroup(a.groupName || (a as any).group);
                                            const gB = normalizeKdkGroup(b.groupName || (b as any).group);
                                            if (gA !== gB) return gA.localeCompare(gB);
                                            const groupMatchesSorted = getGroupedMatchesForDisplay(gA);
                                            return groupMatchesSorted.findIndex(x => x.id === a.id) - groupMatchesSorted.findIndex(x => x.id === b.id);
                                        })
                                        .map((m, idx) => {
                                            const gMatchNo = getDisplayMatchNo(m);

                                            return (
                                                <CompletedMatchCard 
                                                    key={m.id}
                                                    match={m}
                                                    index={idx}
                                                    matchNo={gMatchNo}
                                                    getPlayerName={getPlayerName}
                                                    isAdmin={isAdmin}
                                                    onResetStatus={(id) => setResetMatchTarget(id)}
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
                            players={resolvedRanking}
                            sessionTitle={sessionTitle}
                            isArchive={false}
                            isAdmin={isAdmin}
                            prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty }}
                            guestFee={guestFee}
                            onShareMatch={execCopySchedule}
                            onShareResult={copyFinalResults}
                            onFinalize={requestFinalArchive}
                            isGenerating={isGenerating}
                            ceremonyMode={showCeremony}
                            detailedResults={playerDetailedResults}
                            matches={matches}
                        />
                    </div>
                )}

            </div>

            <nav
                className="fixed left-1/2 z-[90] flex w-[94%] max-w-[440px] -translate-x-1/2 items-center justify-between gap-2 p-1.5 sm:gap-3 sm:p-2"
                style={{
                    bottom: 'calc(var(--bottom-nav-area) + 12px)',
                    borderRadius: 24,
                    background: '#FFFFFF',
                    border: '1px solid #DCE8F5',
                    boxShadow: '0 14px 32px rgba(15,45,85,0.10)',
                }}
            >
                <button
                    onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); setActiveTab('MATCHES'); }}
                    className="flex-1 flex items-center justify-center gap-2 transition-all active:scale-95 sm:gap-3"
                    style={{
                        padding: '12px 0',
                        borderRadius: 18,
                        background: activeTab === 'MATCHES' ? 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)' : 'transparent',
                        color: activeTab === 'MATCHES' ? '#FFFFFF' : '#56729A',
                        border: 'none',
                        fontSize: 15,
                        fontWeight: 900,
                        letterSpacing: '0.04em',
                        boxShadow: activeTab === 'MATCHES' ? '0 8px 18px rgba(37,99,235,0.24)' : 'none',
                        cursor: 'pointer',
                    }}
                >
                    🔥 경기
                </button>
                <button
                    onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); setActiveTab('RANKING'); }}
                    className="flex-1 flex items-center justify-center gap-2 transition-all active:scale-95 sm:gap-3"
                    style={{
                        padding: '12px 0',
                        borderRadius: 18,
                        background: activeTab === 'RANKING' ? 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)' : 'transparent',
                        color: activeTab === 'RANKING' ? '#FFFFFF' : '#56729A',
                        border: 'none',
                        fontSize: 15,
                        fontWeight: 900,
                        letterSpacing: '0.04em',
                        boxShadow: activeTab === 'RANKING' ? '0 8px 18px rgba(37,99,235,0.24)' : 'none',
                        cursor: 'pointer',
                    }}
                >
                    📊 순위
                </button>
            </nav>


            {allMatchesScored && step === 3 && activeTab === 'MATCHES' && (
                <div className="fixed left-1/2 -translate-x-1/2 w-full max-w-[450px] px-6 z-[60] animate-in slide-in-from-bottom-10 fade-in duration-500"
                    style={{ bottom: 'calc(var(--bottom-nav-area) + 84px)' }}
                >
                    <button
                        onClick={handleStartCeremony}
                        style={{
                            width: '100%', padding: '16px 0',
                            background: 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                            color: '#FFFFFF',
                            borderRadius: 16, border: 'none',
                            fontSize: 13, fontWeight: 900,
                            letterSpacing: '0.16em', textTransform: 'uppercase',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                            boxShadow: '0 16px 32px rgba(37,99,235,0.30)',
                            cursor: 'pointer',
                        }}
                        className="active:scale-95 transition-all"
                    >
                        <span>🏆 순위 및 축하 화면 보러가기</span>
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
                            players={resolvedRanking}
                            sessionTitle={sessionTitle}
                            isArchive={false}
                            isAdmin={role === 'CEO' && !shouldHideAdminControls}
                            prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty }}
                            guestFee={guestFee}
                            onShareMatch={execCopySchedule}
                            onShareResult={copyFinalResults}
                            onFinalize={requestFinalArchive}
                            isGenerating={isGenerating}
                            ceremonyMode={showCeremony}
                            detailedResults={playerDetailedResults}
                            matches={matches}
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
                    isSubmitting={isActionPending(`finish:${activeMatchForScore.id}`)}
                />
            )}

            {showMemberEditModal && (() => {
                // 설정 모달 → 세션 관리 화면으로 단순화.
                // 참석자 수시 수정 UI 는 비노출(렌더만 제거 — toggleMember / handleMemberEditConfirm 등 로직은 보존).
                const curSession = allActiveSessions.find(s => s.id === activeSessionId);
                const currentTitle = curSession?.title || sessionTitle;
                const playerCount = curSession?.playerCount ?? selectedIds.size;
                const isPlaying = matches.some(m => m.status === 'playing');
                const statusLabel = isPlaying ? '진행 중' : matches.length > 0 ? '대기 중' : '세션 없음';
                const statusTone = isPlaying
                    ? { bg: '#E0F5EB', color: '#16A085', border: '#B6E2CB' }   // 진행 중 — green
                    : matches.length > 0
                        ? { bg: '#EEF6FF', color: '#1F5FB5', border: '#C7DCF1' }   // 대기 — blue
                        : { bg: '#F1F5F9', color: '#64748B', border: '#E2E8F0' };  // 없음 — gray
                // 조별 코트 버튼 범위: totalCourts 가 99(무제한 개념)면 실제 운영 기준으로 환산.
                //   실제 사용 중 최대 코트 / 이미 선택된 코트 / 작은 totalCourts 를 반영, 4~12 범위로 클램프.
                const usedMaxCourt = matches.reduce((mx, m) => Math.max(mx, m.court || 0), 0);
                const selectedMaxCourt = Object.values(groupCourts.groups || {}).reduce(
                    (mx, arr) => Math.max(mx, ...(arr.length ? arr : [0])), 0
                );
                const realTotalCourts = totalCourts > 0 && totalCourts <= 12 ? totalCourts : 0;
                const courtButtonCount = Math.min(12, Math.max(4, usedMaxCourt, selectedMaxCourt, realTotalCourts));
                const courtButtons = Array.from({ length: courtButtonCount }, (_, i) => i + 1);
                return (
                <div
                    onClick={() => setShowMemberEditModal(false)}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 1200,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(15,45,85,0.45)', backdropFilter: 'blur(6px)',
                        padding: '16px',
                        paddingTop: 'calc(16px + env(safe-area-inset-top))',
                        paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
                        boxSizing: 'border-box',
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            // 카드는 스크롤하지 않고(overflow hidden), 내부 본문(modal-scroll-body)만 스크롤한다.
                            //   flex column 으로 헤더 고정 + 본문 flex:1 → 하단 BottomNav 에 가리지 않게 본문 끝까지 스크롤 가능.
                            display: 'flex', flexDirection: 'column',
                            width: '100%', maxWidth: 520,
                            maxHeight: 'calc(100dvh - 24px)',
                            overflow: 'hidden',
                            background: '#FFFFFF', borderRadius: 24,
                            border: '1px solid #DCE8F5',
                            boxShadow: '0 28px 80px rgba(15,45,85,0.22)',
                            boxSizing: 'border-box',
                        }}
                    >
                        {/* Header — 고정(스크롤 안 함) */}
                        <div style={{ flexShrink: 0, padding: '18px 18px 14px', borderBottom: '1px solid #EAF1F9' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                                <div style={{ minWidth: 0 }}>
                                    <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#3B82F6' }}>Live Management</p>
                                    <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.02em' }}>세션 관리</h2>
                                    <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 700, color: '#7A93B3' }}>현재 진행 중인 KDK 세션을 관리합니다.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowMemberEditModal(false)}
                                    aria-label="닫기"
                                    style={{
                                        flexShrink: 0, width: 36, height: 36, borderRadius: '50%',
                                        border: '1px solid #DCE8F5', background: '#F8FBFE', color: '#3B5A85',
                                        fontSize: 20, fontWeight: 700, lineHeight: 1,
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                                    }}
                                >
                                    ×
                                </button>
                            </div>
                        </div>

                        {/* Body — 실제 스크롤 영역(modal-scroll-body). 하단 BottomNav(약 96px)+safe-area 만큼
                            paddingBottom 확보해 Danger Zone 삭제 버튼 아래까지 완전히 스크롤되게 한다. */}
                        <div style={{
                            flex: 1, minHeight: 0,
                            overflowY: 'auto', WebkitOverflowScrolling: 'touch',
                            display: 'flex', flexDirection: 'column', gap: 14,
                            padding: 16,
                            paddingBottom: 'calc(96px + env(safe-area-inset-bottom))',
                        }}>
                            {/* 세션 정보 카드 */}
                            <section style={{ borderRadius: 16, background: '#EEF6FF', border: '1px solid #C7DCF1', padding: 14 }}>
                                <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#1F5FB5' }}>현재 세션</p>
                                <h3 style={{ margin: '6px 0 10px', fontSize: 16, fontWeight: 900, color: '#0F2747', lineHeight: 1.3, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{currentTitle}</h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 999,
                                        fontSize: 11, fontWeight: 900,
                                        background: statusTone.bg, color: statusTone.color, border: `1px solid ${statusTone.border}`,
                                    }}>
                                        {statusLabel}
                                    </span>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: '#56729A' }}>참가 {playerCount}명 · {matches.length}경기</span>
                                </div>
                            </section>

                            {/* 운영 설정 — CEO/ADMIN 만. 상단 헤더에서 이동한 전광판 티커 / 정모 연결.
                                기존 state·handler·upsert 로직을 그대로 재사용하고 위치만 모달로 옮김. */}
                            {isAdmin && (
                                <section style={{ borderRadius: 16, background: '#F8FBFE', border: '1px solid #E1EAF5', padding: 14 }}>
                                    <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#1F5FB5' }}>운영 설정</p>

                                    {/* 전광판 티커 */}
                                    <div style={{ marginTop: 12 }}>
                                        <label style={{ display: 'block', fontSize: 11.5, fontWeight: 900, color: '#3F5B82', marginBottom: 7 }}>전광판 티커</label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <input
                                                type="text"
                                                value={tickerMsg}
                                                onChange={(e) => setTickerMsg(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === 'Enter') saveTickerMsg(); }}
                                                maxLength={120}
                                                placeholder="전광판 티커 메시지 입력..."
                                                style={{
                                                    minWidth: 0, flex: 1, height: 38,
                                                    borderRadius: 10, border: '1px solid #DCE8F5',
                                                    background: '#FFFFFF', padding: '0 12px',
                                                    fontSize: 12.5, fontWeight: 700, color: '#0F2747', outline: 'none',
                                                }}
                                            />
                                            <button
                                                type="button"
                                                onClick={saveTickerMsg}
                                                disabled={tickerSaving || !activeSessionId}
                                                className="shrink-0 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                                                style={{
                                                    height: 38, padding: '0 16px', borderRadius: 999,
                                                    fontSize: 11.5, fontWeight: 900, letterSpacing: '0.04em',
                                                    background: tickerSaveOk ? '#E0F5EB' : 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                                                    border: tickerSaveOk ? '1px solid #B6E2CB' : 'none',
                                                    color: tickerSaveOk ? '#16A085' : '#FFFFFF',
                                                    boxShadow: tickerSaveOk ? 'none' : '0 6px 14px rgba(37,99,235,0.22)',
                                                    cursor: 'pointer', whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {tickerSaveOk ? '저장됨' : tickerSaving ? '···' : '저장'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* 정모 연결 — 기본값 '연결 안 함'. 운영 중 변경 가능, 기존 경기 데이터에 영향 없음. */}
                                    <div style={{ marginTop: 16 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                                            <label style={{ fontSize: 11.5, fontWeight: 900, color: '#3F5B82' }}>정모 연결</label>
                                            <span style={{ fontSize: 9.5, fontWeight: 800, color: '#94A3B8', letterSpacing: '0.02em' }}>
                                                {linkSaving ? '저장 중' : linkedScheduleId ? '연결됨' : '미연결'}
                                            </span>
                                        </div>
                                        <select
                                            value={linkedScheduleId ?? ''}
                                            onChange={(e) => saveLinkedSchedule(e.target.value || null)}
                                            disabled={linkSaving || !activeSessionId}
                                            style={{
                                                width: '100%', height: 38,
                                                borderRadius: 10, border: '1px solid #DCE8F5',
                                                background: '#FFFFFF', padding: '0 10px',
                                                fontSize: 12.5, fontWeight: 700, color: '#0F2747', outline: 'none',
                                            }}
                                        >
                                            <option value="">연결 안 함</option>
                                            {upcomingSchedules.map((cs) => (
                                                <option key={cs.id} value={cs.id}>
                                                    {cs.schedule_date.slice(5)} · {cs.title}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* 이번 KDK 게스트비 — kdk_session_meta.guest_fee 단일 출처.
                                        기존 changeGuestFee(officialLocked 차단 · 진행중 확인모달 · 저장직전 fail-closed · 성공시에만 반영)를
                                        그대로 재사용. 별도 저장 로직/저장 버튼 없이 ± 로 확정 저장한다. null=미설정, 0=무료(유효). */}
                                    <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px dashed #E1EAF5' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                            <label style={{ fontSize: 11.5, fontWeight: 900, color: '#3F5B82' }}>이번 KDK 게스트비</label>
                                            <span style={{ fontSize: 9.5, fontWeight: 800, color: officialLocked ? '#B7791F' : '#94A3B8', letterSpacing: '0.02em' }}>
                                                {officialLocked ? '확정 잠금' : guestFee == null ? '미설정' : guestFee === 0 ? '무료' : `${(guestFee / 1000).toFixed(0)}K`}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                                            <button
                                                type="button"
                                                onClick={() => changeGuestFee((guestFee ?? 0) - 1000)}
                                                disabled={officialLocked}
                                                aria-label="게스트비 1,000원 감소"
                                                style={{ width: 44, height: 44, borderRadius: 12, background: '#FFFFFF', border: '1px solid #DCE8F5', color: '#1F5FB5', fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: officialLocked ? 'not-allowed' : 'pointer', opacity: officialLocked ? 0.4 : 1, flex: 'none' }}
                                            >−</button>
                                            <span style={{ flex: 1, textAlign: 'center', fontSize: guestFee == null ? 14 : 18, fontWeight: 900, color: guestFee == null ? '#9CA3AF' : '#0F2747', letterSpacing: '-0.01em' }}>
                                                {guestFee == null ? '미설정' : guestFee === 0 ? '무료' : `${guestFee.toLocaleString()}원`}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => changeGuestFee((guestFee ?? 0) + 1000)}
                                                disabled={officialLocked}
                                                aria-label="게스트비 1,000원 증가"
                                                style={{ width: 44, height: 44, borderRadius: 12, background: '#FFFFFF', border: '1px solid #DCE8F5', color: '#1F5FB5', fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: officialLocked ? 'not-allowed' : 'pointer', opacity: officialLocked ? 0.4 : 1, flex: 'none' }}
                                            >+</button>
                                        </div>
                                        <p style={{ margin: '8px 0 0', fontSize: 10, fontWeight: 600, color: officialLocked ? '#B7791F' : '#94A3B8', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                                            {officialLocked
                                                ? OFFICIAL_LOCK_MSG
                                                : '이 금액은 정모 일정, Guest Pass, 순위표와 최종 결과에 동일하게 적용됩니다.'}
                                        </p>
                                    </div>

                                    {/* 조별 코트 운영 — 조마다 사용할 코트를 지정. 변경은 다음 신규 투입부터 적용. */}
                                    <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px dashed #E1EAF5' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                                            <span style={{ fontSize: 11.5, fontWeight: 900, color: '#3F5B82' }}>조별 전용 코트 사용</span>
                                            <input
                                                type="checkbox"
                                                checked={groupCourts.enabled}
                                                onChange={(e) => toggleGroupCourtsEnabled(e.target.checked)}
                                                style={{ width: 18, height: 18, accentColor: '#2563EB', cursor: 'pointer' }}
                                            />
                                        </label>

                                        {groupCourts.enabled && (
                                            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
                                                {['A', 'B'].map((g) => {
                                                    const selected = groupCourts.groups[g] || [];
                                                    return (
                                                        <div key={g}>
                                                            <p style={{ margin: '0 0 7px', fontSize: 11, fontWeight: 900, color: '#1F5FB5' }}>{g}조 사용 코트</p>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                                {courtButtons.map((c) => {
                                                                    const active = selected.includes(c);
                                                                    return (
                                                                        <button
                                                                            key={`${g}-${c}`}
                                                                            type="button"
                                                                            onClick={() => toggleGroupCourt(g, c)}
                                                                            style={{
                                                                                minWidth: 44, height: 40, padding: '0 12px',
                                                                                borderRadius: 12,
                                                                                background: active ? '#2563EB' : '#FFFFFF',
                                                                                border: active ? 'none' : '1px solid #DCE8F5',
                                                                                color: active ? '#FFFFFF' : '#56729A',
                                                                                fontSize: 14, fontWeight: 900,
                                                                                boxShadow: active ? '0 6px 14px rgba(37,99,235,0.24)' : 'none',
                                                                                cursor: 'pointer', transition: 'all 0.12s',
                                                                            }}
                                                                        >
                                                                            {c}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        <p style={{ margin: '12px 0 0', fontSize: 10.5, fontWeight: 700, lineHeight: 1.5, color: '#94A3B8' }}>
                                            변경된 코트 설정은 다음 경기 투입부터 적용됩니다. 진행 중인 경기 코트는 바뀌지 않습니다.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={saveGroupCourts}
                                            disabled={groupCourtsSaving || !activeSessionId}
                                            className="transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                                            style={{
                                                width: '100%', height: 40, marginTop: 10, borderRadius: 12,
                                                fontSize: 12, fontWeight: 900, letterSpacing: '0.04em',
                                                background: groupCourtsSaveOk ? '#E0F5EB' : 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                                                border: groupCourtsSaveOk ? '1px solid #B6E2CB' : 'none',
                                                color: groupCourtsSaveOk ? '#16A085' : '#FFFFFF',
                                                boxShadow: groupCourtsSaveOk ? 'none' : '0 8px 18px rgba(37,99,235,0.2)',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {groupCourtsSaveOk ? '저장됨' : groupCourtsSaving ? '저장 중...' : '조별 코트 설정 저장'}
                                        </button>
                                    </div>
                                </section>
                            )}

                            {/* Danger Zone — CEO/ADMIN 만 */}
                            {isAdmin && (
                                <section style={{ borderRadius: 16, background: '#FEF2F2', border: '1px solid #FBD0D0', padding: 14 }}>
                                    <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#DC2626' }}>Danger Zone</p>
                                    <p style={{ margin: '8px 0 2px', fontSize: 13.5, fontWeight: 900, color: '#B91C1C' }}>현재 세션 삭제</p>
                                    <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, lineHeight: 1.55, color: '#A16B6B' }}>
                                        진행 중인 경기 데이터를 삭제합니다.<br />
                                        공식 확정된 Archive 기록은 유지됩니다.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const target: ActiveKdkSession = curSession
                                                || { id: activeSessionId, title: sessionTitle, matchCount: matches.length, playerCount: selectedIds.size, lastActivity: '' };
                                            if (!target?.id) {
                                                alert('현재 세션을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.');
                                                return;
                                            }
                                            // 확인 모달 target 을 먼저 설정한 뒤 세션 관리 모달을 닫는다.
                                            setSessionDeleteTarget(target);
                                            setShowMemberEditModal(false);
                                        }}
                                        style={{
                                            width: '100%', height: 44, borderRadius: 12,
                                            background: '#DC2626', color: '#FFFFFF', border: 'none',
                                            fontSize: 12.5, fontWeight: 900, letterSpacing: '0.02em',
                                            cursor: 'pointer', boxShadow: '0 8px 18px rgba(220,38,38,0.22)',
                                        }}
                                    >
                                        현재 세션 삭제
                                    </button>
                                </section>
                            )}
                        </div>
                    </div>
                </div>
                );
            })()}

            {/* 현재 세션 삭제 2차 확인 — 세션 관리 모달과 독립된 최상위 sibling.
                (LIVE COURT return 에는 이 모달이 없어 Danger Zone 버튼을 눌러도 확인 모달이 뜨지 않던 버그 수정) */}
            {sessionDeleteTarget && (
                <CustomConfirmModal
                    title="현재 세션을 삭제할까요?"
                    message={`"${sessionDeleteTarget.title}" 세션의 진행 중인 경기 데이터가 삭제됩니다. 공식 확정된 Archive 기록은 유지됩니다.`}
                    confirmText={isDeletingSession ? "삭제 중..." : "세션 삭제"}
                    icon="🗑️"
                    onConfirm={handleDeleteActiveSession}
                    onCancel={() => { if (!isDeletingSession) setSessionDeleteTarget(null); }}
                />
            )}

            {resetMatchTarget && (
                <CustomConfirmModal
                    title="이 경기를 대기 상태로 되돌릴까요?"
                    message="다시 투입한 뒤 점수를 입력할 수 있습니다."
                    confirmText="대기로 되돌리기"
                    icon="↩️"
                    onConfirm={() => handleReopenMatch(resetMatchTarget)}
                    onCancel={() => setResetMatchTarget(null)}
                />
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
            {/* 공식 기록 확정 전 확인 — Cool Premium Light. 기존 정산 요약(finalizeSummary)만 표시. */}
            {showFinalizeConfirm && finalizeSummary && (() => {
                const fs = finalizeSummary;
                const feeText = fs.guestFee == null ? '미설정' : fs.guestFee === 0 ? '무료' : `${fs.guestFee.toLocaleString()}원`;
                const penaltyText = fs.penaltyCount === 0 ? '없음' : `${fs.penaltyCount}명 · 총 ${fs.penaltyTotal.toLocaleString()}원`;
                return (
                    <div style={FINALIZE_OVERLAY}>
                        <div style={FINALIZE_CARD}>
                            <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#1F5FB5' }}>공식 기록 확정</p>
                            <h2 style={{ margin: '8px 0 0', fontSize: 19, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.01em' }}>공식 기록으로 확정합니다</h2>
                            <p style={{ margin: '8px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                                확정된 결과는 Archive와 개인 공식 기록에 반영됩니다. 저장 후 일반 수정은 제한됩니다.
                            </p>

                            <div style={FINALIZE_SESSION_BOX}>
                                <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F2747', wordBreak: 'break-word', lineHeight: 1.35 }}>{fs.title}</p>
                                <p style={{ margin: '3px 0 0', fontSize: 11.5, fontWeight: 700, color: '#64748B' }}>{fs.dateLabel} · 참가 {fs.participants}명 · {fs.matchCount}경기</p>
                            </div>

                            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 1, borderRadius: 12, overflow: 'hidden', border: '1px solid #E1EAF5' }}>
                                <FinalizeRow label="최종 1위" value={fs.winner ?? '—'} strong />
                                <FinalizeRow label="게스트비" value={feeText} />
                                <FinalizeRow label="벌금" value={penaltyText} />
                            </div>

                            <div style={{ marginTop: 12, padding: '11px 13px', borderRadius: 12, background: '#F6FAFD', border: '1px solid #DCE8F5' }}>
                                <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.06em', color: '#3F5B82' }}>반영 범위</p>
                                <p style={{ margin: '5px 0 0', fontSize: 11.5, fontWeight: 700, color: '#56729A', lineHeight: 1.7 }}>
                                    Archive 공식 기록 · 멤버 개인 기록 · 최종 순위 및 정산 스냅샷
                                </p>
                                <p style={{ margin: '7px 0 0', fontSize: 11, fontWeight: 700, color: '#B7791F', lineHeight: 1.6 }}>
                                    확정 후 일반 수정은 제한됩니다.
                                </p>
                            </div>

                            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                                <button type="button" onClick={() => setShowFinalizeConfirm(false)} disabled={isGenerating} style={FINALIZE_BTN_SECONDARY}>취소</button>
                                <button type="button" onClick={handleFinalArchive} disabled={isGenerating} style={{ ...FINALIZE_BTN_PRIMARY, opacity: isGenerating ? 0.6 : 1 }}>
                                    {isGenerating ? '확정 중…' : '공식 기록 확정'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* 공식 기록 저장 완료 — Cool Premium Light. URL 원문 미노출, 복사 링크는 기존 handler 유지. */}
            {showArchiveSuccess && (() => {
                const fs = finalizeSummary;
                const feeText = !fs ? null : fs.guestFee == null ? '미설정' : fs.guestFee === 0 ? '무료' : `${fs.guestFee.toLocaleString()}원`;
                const penaltyText = !fs ? null : fs.penaltyCount === 0 ? '없음' : `${fs.penaltyCount}명 · 총 ${fs.penaltyTotal.toLocaleString()}원`;
                return (
                    <div style={FINALIZE_OVERLAY}>
                        <div style={FINALIZE_CARD}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(199,154,58,0.12)', border: '1px solid rgba(199,154,58,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <span style={{ fontSize: 27, lineHeight: 1 }}>🏆</span>
                                </div>
                                <h2 style={{ margin: '12px 0 0', fontSize: 19, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.01em' }}>공식 기록 저장 완료</h2>
                                <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', lineHeight: 1.6 }}>Archive에 공식 기록으로 저장되었습니다.</p>
                            </div>

                            {fs && (
                                <>
                                    <div style={{ ...FINALIZE_SESSION_BOX, marginTop: 16 }}>
                                        <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F2747', wordBreak: 'break-word', lineHeight: 1.35 }}>{fs.title}</p>
                                        <p style={{ margin: '3px 0 0', fontSize: 11.5, fontWeight: 700, color: '#64748B' }}>참가 {fs.participants}명 · 총 {fs.matchCount}경기</p>
                                    </div>
                                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 1, borderRadius: 12, overflow: 'hidden', border: '1px solid #E1EAF5' }}>
                                        <FinalizeRow label="최종 1위" value={fs.winner ?? '—'} strong />
                                        <FinalizeRow label="게스트비" value={feeText ?? '—'} />
                                        <FinalizeRow label="벌금" value={penaltyText ?? '—'} />
                                    </div>
                                </>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
                                <button type="button" onClick={openArchiveSuccessLink} style={FINALIZE_BTN_PRIMARY}>Archive에서 보기</button>
                                <button type="button" onClick={copyArchiveSuccessLink} style={FINALIZE_BTN_SECONDARY}>공유 링크 복사</button>
                                <button type="button" onClick={() => setShowArchiveSuccess(false)} style={{ height: 40, borderRadius: 12, border: 'none', background: 'transparent', color: '#64748B', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                    KDK 화면으로 돌아가기
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </main>
    );
}
