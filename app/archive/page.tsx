'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import nextDynamic from 'next/dynamic';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useGuideRecording } from '@/hooks/useGuideRecording';
import { Trash2, ArrowRight, ArrowLeft, Users, Trophy, CheckCircle2, Calendar, MapPin } from 'lucide-react';
import { InitialAvatar } from '@/components/tournament/InitialAvatar';
import { type ArchiveMatchEntry } from '@/components/archive/ArchiveResultShare';
import { sortOfficialKdkRanking } from '@/lib/kdk/officialRanking';
// 성능: 결과 공유 렌더러(canvas 이미지 생성)는 아카이브 상세 화면에서만 로드.
const ArchiveResultShare = nextDynamic(() => import('@/components/archive/ArchiveResultShare'), { ssr: false });
import KdkFinancePenaltyModal from '@/components/archive/KdkFinancePenaltyModal';
import { canManageFinance } from '@/lib/finance/getFinancePermissions';
import { fetchAllMembers, type FinanceMember } from '@/lib/finance/duesService';
import { buildKdkPenaltyPreview, fetchExistingKdkPenalties } from '@/lib/finance/kdkPenaltyService';

/**
 * ArchivePage (v1.15.1): ABSOLUTE PRECISION & MUTED ELEGANCE
 * - Reverted excessive rounding to rounded-xl (12px) to prevent clipping as requested
 * - Unified Official Name: "테연" (TEYEON)
 * - Muted Gold UI: Champagne matte gold tones from user's edit
 * - Safety Padding: Increased horizontal and vertical inner padding to secure all data
 */

const ARCHIVE_GUEST_RE = /\s*\(G\)\s*$/i;

// 게스트 G badge — (G) 문자열 대신 사용(중복 금지).
function ArchiveGuestBadge() {
  return (
    <span aria-label="게스트" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 13, height: 13, borderRadius: '50%',
      background: '#FFF4DE', border: '1px solid #F4C979', color: '#B7791F',
      fontSize: 8, fontWeight: 900, lineHeight: 1, flexShrink: 0,
    }}>G</span>
  );
}

// 경기 카드 선수명 1명 — 1줄 우선(한글 단어 단위 keep-all), 너무 길면 최대 2줄, 폭 좁으면 자동 축소.
// 승리팀: deep navy + semibold / 패배팀: opacity 낮춤. (G)는 badge 로 분리(점수 쪽 정렬).
function ArchiveMatchName({ name, win, align = 'center' }: { name: string; win: boolean; align?: 'left' | 'right' | 'center' }) {
  const isGuest = ARCHIVE_GUEST_RE.test(name);
  const clean = name.replace(ARCHIVE_GUEST_RE, '');
  const justify = align === 'right' ? 'flex-end' : align === 'left' ? 'flex-start' : 'center';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: justify, gap: 3,
      width: '100%', minWidth: 0, maxWidth: '100%',
      fontSize: 'clamp(11px, 3.2vw, 12.5px)',
      fontWeight: win ? 800 : 600,
      color: '#0F2747', opacity: win ? 1 : 0.58,
      lineHeight: 1.2,
    }}>
      <span style={{
        minWidth: 0,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        overflow: 'hidden', textAlign: align,
        wordBreak: 'keep-all', overflowWrap: 'anywhere',
      }}>{clean}</span>
      {isGuest && <ArchiveGuestBadge />}
    </span>
  );
}

export default function ArchivePage() {
  const { user, role } = useAuth();
  const { guardWriteAction, shouldHideAdminControls } = useGuideRecording();
  const searchParams = useSearchParams();
  const [archives, setArchives] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mainTab, setMainTab] = useState<'RECORDS' | 'RANKING'>('RECORDS');
  // Archive status filter: 공식 기록(OFFICIAL) 또는 미확정·테스트(PENDING)
  const [recordFilter, setRecordFilter] = useState<'OFFICIAL' | 'PENDING'>('OFFICIAL');
  // Detail view: 전체 순위 / 조별 순위 토글
  const [archiveDetailGroup, setArchiveDetailGroup] = useState<'ALL' | 'A' | 'B'>('ALL');
  
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const CEO_EMAIL = process.env.NEXT_PUBLIC_CEO_EMAIL || 'cws786@nate.com';
  const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',');
  // 촬영 보호 모드/미리보기에서는 관리자 컨트롤을 숨긴다(기존 조건 유지 + 촬영 숨김 조건 추가).
  //   일반 모드에서는 shouldHideAdminControls=false 라 기존과 동일(영향 0).
  const isAdmin = ((userEmail && (userEmail === CEO_EMAIL || ADMIN_EMAILS.includes(userEmail))) || role === 'ADMIN' || role === 'CEO') && !shouldHideAdminControls;
  // Finance 벌금 등록 권한: CEO / ADMIN / FINANCE_MANAGER 만. 일반 회원에게는 노출되지 않는다.
  //   (Finance 로직/모달은 미변경 — 촬영 중에는 진입 버튼만 숨겨 모달 도달 자체를 막는다.)
  const canRegisterFinancePenalty = canManageFinance(role) && !shouldHideAdminControls;

  // Finance 벌금 등록 모달 + 세션별 등록 상태(등록 완료 / 일부 등록) 뱃지.
  const [showFinancePenaltyModal, setShowFinancePenaltyModal] = useState(false);
  const [penaltyStatus, setPenaltyStatus] = useState<{ registered: number; linkable: number } | null>(null);

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);
  // Period filters for the list view: 'ALL' or a specific year/month.
  const [yearFilter, setYearFilter] = useState<'ALL' | number>('ALL');
  const [monthFilter, setMonthFilter] = useState<'ALL' | number>('ALL');

  // v1.18.0: Hard Reset Logic to break stubborn PWA Cache
  useEffect(() => {
    const VERSION = "1.20.5";
    const savedVersion = localStorage.getItem("TEYEON_ARCHIVE_VER_V2");
    if (savedVersion !== VERSION) {
        localStorage.setItem("TEYEON_ARCHIVE_VER_V2", VERSION);
        window.location.reload();
    }
  }, []);

  useEffect(() => {
    checkUser();
    fetchArchives();
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    const sessionFromUrl = searchParams.get('session');
    if (sessionFromUrl) setSelectedSessionId(sessionFromUrl);
  }, [searchParams]);

  // 세션 전환 시 그룹 필터 초기화
  useEffect(() => {
    setArchiveDetailGroup('ALL');
  }, [selectedSessionId]);

  async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setUserEmail(user.email || null);
  }

  const unknownPlayerName = '\uBBF8\uD655\uC778';
  const genericGuestName = '\uAC8C\uC2A4\uD2B8';

  const isLikelyArchiveId = (value?: string) => {
    const raw = String(value || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
      || /^[a-z0-9-]{18,}$/i.test(raw);
  };

  const sanitizeArchivePlayerName = (value?: string) => {
    const trimmed = String(value || '').trim();
    if (!trimmed || trimmed === '?' || /^unknown$/i.test(trimmed)) return '';

    if (/^manual-guest-/i.test(trimmed)) {
      const guestName = trimmed
        .replace(/^manual-guest-/i, '')
        .replace(/\s*\(G\)$/i, '')
        .replace(/\s+g$/i, '')
        .trim();
      if (!guestName || /^guest$/i.test(guestName) || guestName === genericGuestName) return '';
      return `${guestName}(G)`;
    }

    if (/\s+g$/i.test(trimmed)) {
      const guestName = trimmed.replace(/\s+g$/i, '').trim();
      return guestName ? `${guestName}(G)` : '';
    }

    const normalized = trimmed.replace(/\s*\(G\)$/i, '(G)');
    if (/^guest$/i.test(normalized) || normalized === genericGuestName) return '';
    if (isLikelyArchiveId(normalized)) return '';
    return normalized;
  };

  const resolveArchivePlayerName = (name?: string, playerId?: string, metadata: Record<string, any> = {}) => {
    const directName = sanitizeArchivePlayerName(name);
    if (directName) return directName;

    const meta = playerId ? metadata[playerId] : null;
    const metaName = sanitizeArchivePlayerName(meta?.name || meta?.nickname);
    if (metaName) return metaName;

    const idName = sanitizeArchivePlayerName(playerId);
    if (idName) return idName;

    return unknownPlayerName;
  };

  const normalizeArchiveGroup = (value?: string) => {
    const raw = String(value || '').trim().toUpperCase();
    if (raw.includes('B') || raw.includes('BLUE')) return 'B';
    if (raw.includes('A') || raw.includes('GOLD')) return 'A';
    return '';
  };

  const getArchiveGroupLabel = (value?: string) => {
    const group = normalizeArchiveGroup(value);
    if (group === 'B') return 'B\uC870';
    if (group === 'A') return 'A\uC870';
    return '';
  };

  // 2-way 상태: 공식 기록 / 미확정·테스트 (테스트 + 검토 대기 통합)
  const getArchiveStatusMeta = (archive: any) => {
    if (archive?.is_official) {
      return {
        label: '공식 기록',
        bg: '#E0F5EB', border: '#B6E2CB', color: '#16A085',
      };
    }
    return {
      label: '미확정·테스트',
      bg: '#FFF4DE', border: '#F4C979', color: '#B7791F',
    };
  };

  const renderArchiveStatusBadge = (archive: any) => {
    const status = getArchiveStatusMeta(archive);
    return (
      <span
        style={{
          display: 'inline-flex', alignItems: 'center',
          borderRadius: 999, padding: '4px 10px',
          fontSize: 10, fontWeight: 900, letterSpacing: '0.08em',
          background: status.bg, border: `1px solid ${status.border}`, color: status.color,
        }}
      >
        {status.label}
      </span>
    );
  };

  const removeLocalArchiveFailover = (sessionId: string) => {
    try {
      const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
      const nextFailovers = Array.isArray(failovers)
        ? failovers.filter((record: any) => record?.id !== sessionId)
        : [];
      localStorage.setItem('kdk_archive_failover', JSON.stringify(nextFailovers));
    } catch (error) {
      console.warn('[Archive] local failover cleanup skipped:', error);
    }
  };

  async function fetchArchives() {
    try {
      setLoading(true);
      const { data, error } = await supabase
          .from('teyeon_archive_v1')
          .select('*')
          .order('created_at', { ascending: false });

      if (error) throw error;
      
      const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
      const serverRecords = data || [];
      const serverIds = new Set(serverRecords.map((record: any) => record.id));
      const localOnlyRecords = failovers
        .map((f:any) => ({...f, isLocal: true}))
        .filter((record: any) => !serverIds.has(record.id));
      const combinedData: any[] = [...serverRecords, ...localOnlyRecords];
      
      combinedData.sort((a,b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

      const reconstructedMatches: any[] = [];
      const seenIds = new Set();

      combinedData.forEach(record => {
          if (seenIds.has(record.id)) return;
          seenIds.add(record.id);

          const raw = record.raw_data || {};
          const matchesArr = raw.snapshot_data || [];
          matchesArr.forEach((m: any) => {
              const pIds = m.player_ids || m.playerIds || [];
              const meta = raw.player_metadata || {};
              const sourceNames = m.player_names || m.playerNames || [];
              const playerCount = Math.max(4, pIds.length, sourceNames.length);
              const resolvedNames = Array.from({ length: playerCount }, (_, idx) => (
                  resolveArchivePlayerName(sourceNames[idx], pIds[idx], meta)
              ));
              const resolvedAvatars = m.player_avatars || pIds.map((pid: string) => meta[pid]?.avatar || '');
              const archiveGroup = normalizeArchiveGroup(m.group_name || m.groupName || m.group);

              reconstructedMatches.push({
                  ...m,
                  session_id: record.id,
                  session_title: raw.title,
                  match_date: raw.date,
                  created_at: record.created_at,
                  isLocal: !!record.isLocal,
                  player_names: resolvedNames,
                  player_ids: pIds,
                  player_avatars: resolvedAvatars,
                  group_name: archiveGroup || m.group_name,
                  archive_group_key: archiveGroup,
                  archive_ranking_data: raw.ranking_data || [],
                  archive_settlement_data: raw.settlement_data || [],
                  archive_settlement_meta: raw.settlement_meta || null,
                  archive_player_metadata: meta,
                  archive_type: record.archive_type || raw.archive_type || 'kdk',
                  is_official: Boolean(record.is_official ?? raw.is_official ?? false),
                  is_test: Boolean(record.is_test ?? raw.is_test ?? false),
                  confirmed_at: record.confirmed_at || raw.confirmed_at || null,
                  confirmed_by: record.confirmed_by || raw.confirmed_by || '',
                  profile_reflected: Boolean(record.profile_reflected ?? raw.profile_reflected ?? false)
              });
          });
      });
      setArchives(reconstructedMatches);
    } catch (err: any) {
      console.error("Archive Fetch Error:", err);
    } finally {
      setLoading(false);
    }
  }

  const filteredRecords = archives.filter(m => {
    // 미확정·테스트 = !is_official (모든 비공식 기록을 묶음: 테스트 + 검토 대기)
    const passesRecordFilter =
      recordFilter === 'OFFICIAL' ? !!m.is_official : !m.is_official;
    if (!passesRecordFilter) return false;
    if (yearFilter === 'ALL' && monthFilter === 'ALL') return true;
    const d = new Date(m.match_date);
    if (Number.isNaN(d.getTime())) return yearFilter === 'ALL' && monthFilter === 'ALL';
    if (yearFilter !== 'ALL' && d.getFullYear() !== yearFilter) return false;
    if (monthFilter !== 'ALL' && d.getMonth() + 1 !== monthFilter) return false;
    return true;
  });

  // Years that actually have records, sorted newest first.
  const availableYears = useMemo(() => {
    const ys = new Set<number>();
    archives.forEach(m => {
      const d = new Date(m.match_date);
      if (!Number.isNaN(d.getTime())) ys.add(d.getFullYear());
    });
    return Array.from(ys).sort((a, b) => b - a);
  }, [archives]);

  // Months that have records under the currently selected year filter.
  const availableMonths = useMemo(() => {
    if (yearFilter === 'ALL') return [] as number[];
    const ms = new Set<number>();
    archives.forEach(m => {
      const d = new Date(m.match_date);
      if (Number.isNaN(d.getTime())) return;
      if (d.getFullYear() !== yearFilter) return;
      ms.add(d.getMonth() + 1);
    });
    return Array.from(ms).sort((a, b) => a - b);
  }, [archives, yearFilter]);

  const sessions = useMemo(() => {
    const groups: Record<string, any> = {};
    filteredRecords.forEach(m => {
        const title = m.session_title || "Untitled";
        const dateKey = m.match_date || 'nodate';
        const groupKey = m.session_id || `${title}_${dateKey}`;
        if (!groups[groupKey]) {
            groups[groupKey] = { 
                id: m.session_id, 
                title, 
                date: m.match_date, 
                created_at: m.created_at, 
                matches: [], 
                matchCount: 0,
                playerSet: new Set(),
                rankingData: m.archive_ranking_data || [],
                settlementData: m.archive_settlement_data || [],
                settlementMeta: m.archive_settlement_meta || null,
                playerMetadata: m.archive_player_metadata || {},
                archive_type: m.archive_type || 'kdk',
                is_official: !!m.is_official,
                is_test: !!m.is_test,
                confirmed_at: m.confirmed_at || null,
                confirmed_by: m.confirmed_by || '',
                profile_reflected: !!m.profile_reflected,
                isLocal: !!m.isLocal
            };
        }
        groups[groupKey].matches.push(m);
        groups[groupKey].matchCount++;
        (m.player_names || []).forEach((n:string) => groups[groupKey].playerSet.add(n));
        if ((!groups[groupKey].rankingData || groups[groupKey].rankingData.length === 0) && m.archive_ranking_data?.length) {
            groups[groupKey].rankingData = m.archive_ranking_data;
        }
        if ((!groups[groupKey].settlementData || groups[groupKey].settlementData.length === 0) && m.archive_settlement_data?.length) {
            groups[groupKey].settlementData = m.archive_settlement_data;
            groups[groupKey].settlementMeta = m.archive_settlement_meta || groups[groupKey].settlementMeta;
        }
        groups[groupKey].playerMetadata = { ...(groups[groupKey].playerMetadata || {}), ...(m.archive_player_metadata || {}) };
    });

    return Object.values(groups)
      .map(s => ({ ...s, participantCount: s.playerSet.size }))
      .sort((a:any, b:any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [filteredRecords]);

  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  // 선택된 공식·비테스트 세션의 Finance 벌금 등록 현황을 조회 — 상세 화면의 등록 상태 뱃지용.
  const loadPenaltyStatus = React.useCallback(async () => {
    const s = selectedSession;
    if (!canRegisterFinancePenalty || !s?.id || !s.is_official || s.is_test) {
      setPenaltyStatus(null);
      return;
    }
    const settlement = Array.isArray(s.settlementData) ? s.settlementData : [];
    if (settlement.length === 0) { setPenaltyStatus(null); return; }
    try {
      const [members, existing] = await Promise.all([
        fetchAllMembers(),
        fetchExistingKdkPenalties(s.id),
      ]);
      const rows = buildKdkPenaltyPreview(settlement, members as FinanceMember[], existing);
      const linkable = rows.filter(r => r.status !== 'needs_link').length;
      const registered = rows.filter(r => r.status === 'registered').length;
      setPenaltyStatus({ registered, linkable });
    } catch {
      setPenaltyStatus(null);
    }
  }, [selectedSession, canRegisterFinancePenalty]);

  React.useEffect(() => { loadPenaltyStatus(); }, [loadPenaltyStatus]);

  const buildArchiveRankingResults = (session: any) => {
    const savedRanking = Array.isArray(session?.rankingData) ? session.rankingData : [];
    if (savedRanking.length > 0) {
        return savedRanking.map((p: any) => ({
            name: resolveArchivePlayerName(p.name, p.id, session?.playerMetadata || {}),
            wins: Number(p.wins || 0),
            losses: Number(p.losses || 0),
            diff: Number(p.diff || 0),
            avatar: p.avatar || p.avatar_url || '',
            played: Number(p.games || p.played || 0) || Number(p.wins || 0) + Number(p.losses || 0)
        }));
    }

    const stats: Record<string, { name: string, wins: number, losses: number, diff: number, pf: number, pa: number, avatar: string, played: number }> = {};
    (session?.matches || []).forEach((m: any) => {
        const pNames = m.player_names || [];
        const pIds = m.player_ids || m.playerIds || [];
        const pAvatars = m.player_avatars || [];
        pNames.forEach((name: string, k: number) => {
            const safeName = resolveArchivePlayerName(name, pIds[k], session?.playerMetadata || {});
            if (!stats[safeName]) stats[safeName] = { name: safeName, wins: 0, losses: 0, diff: 0, pf: 0, pa: 0, avatar: pAvatars[k] || '', played: 0 };
            const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
            const win = k < 2 ? (s1 > s2) : (s2 > s1);
            stats[safeName].played++;
            if (win) stats[safeName].wins++; else stats[safeName].losses++;
            stats[safeName].pf += (k < 2 ? s1 : s2);
            stats[safeName].pa += (k < 2 ? s2 : s1);
            stats[safeName].diff = stats[safeName].pf - stats[safeName].pa;
        });
    });

    // 재계산 fallback 도 공식 comparator 사용 (저장된 ranking_data 가 있으면 위에서 그대로 반환 —
    // 과거 공식 기록은 절대 재정렬하지 않음). id 미보존 경로라 playerId 는 표시명으로 대체.
    return sortOfficialKdkRanking(
        Object.values(stats).map((s) => ({ ...s, playerId: s.name })),
    );
  };

  // Aggregate stats for the list-view hero card.
  const officialSessions = sessions.filter((s: any) => s.is_official);
  const totalSessionCount = sessions.length;
  const totalOfficialCount = officialSessions.length;
  const totalMatchCount = sessions.reduce((sum: number, s: any) => sum + (s.matchCount || 0), 0);
  const latestOfficialWinner = (() => {
    const latest = officialSessions[0];
    if (!latest) return '';
    const ranking = buildArchiveRankingResults(latest);
    return ranking[0]?.name || '';
  })();
  const pendingOfficialCount = isAdmin
    ? sessions.filter((s: any) => !s.is_official && !s.is_test && !s.isLocal).length
    : 0;

  const formatArchiveDate = (raw?: string) => {
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}.${m}.${day}`;
  };
  const formatArchiveDateTime = (raw?: string) => {
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}.${m}.${day} ${hh}:${mm}`;
  };
  // 장소 데이터가 실제 저장되어 있을 때만 반환. 임시값/하드코딩 금지.
  const getSessionVenue = (s: any): string | null => {
    const candidates = [s?.venue, s?.location, s?.place, s?.court_name, s?.court];
    for (const c of candidates) {
      const v = String(c || '').trim();
      if (v) return v;
    }
    return null;
  };

  const archiveTypeLabel = (t?: string) => {
    const raw = String(t || '').toLowerCase();
    if (raw === 'kdk-manual' || raw === 'manual') return '방식 KDK 수동';
    if (raw === 'kdk-auto' || raw === 'auto') return '방식 KDK 자동';
    return '방식 KDK';
  };

  return (
    <main
      className="relative w-full font-sans"
      style={{
        minHeight: '100dvh',
        marginBottom: 'calc(-1 * var(--page-bottom-safe))',
        backgroundColor: '#F4F8FC',
        color: '#0F2747',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 520, margin: '0 auto',
          padding: '20px 16px var(--page-bottom-safe)', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        {/* HEADER */}
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => selectedSessionId ? setSelectedSessionId(null) : window.history.back()}
              aria-label={selectedSessionId ? '목록으로' : '뒤로'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 44, height: 44, borderRadius: '50%',
                border: '1px solid #DCE8F5', backgroundColor: '#FFFFFF',
                color: '#3B5A85', boxShadow: '0 4px 12px rgba(15,45,85,0.06)',
                cursor: 'pointer',
              }}
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                {selectedSessionId ? '기록 상세' : 'ARCHIVE'}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 10, fontWeight: 900, color: '#3B82F6', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
                {selectedSessionId ? 'OFFICIAL RECORD' : 'OFFICIAL RECORDS'}
              </p>
            </div>
          </div>
          {!selectedSessionId && (
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                borderRadius: 999, padding: '6px 12px',
                border: '1px solid #C7DCF1', background: '#EAF3FC',
                fontSize: 10, fontWeight: 900,
                letterSpacing: '0.2em', textTransform: 'uppercase',
                color: '#1F5FB5',
              }}
            >
              <Trophy size={11} />
              ARCHIVE
            </span>
          )}
        </header>

        {loading ? (
          <div
            style={{
              padding: '60px 16px', textAlign: 'center',
              borderRadius: 22, background: '#FFFFFF',
              border: '1px solid #DCE8F5',
              boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
              fontSize: 12, fontWeight: 700, color: '#7A93B3',
              letterSpacing: '0.12em', textTransform: 'uppercase',
            }}
          >
            Loading archive...
          </div>
        ) : selectedSessionId && selectedSession ? (
          /* ============================ DETAIL VIEW ============================ */
          renderArchiveDetailView()
        ) : (
          /* ============================ LIST VIEW ============================ */
          <>
            {/* HERO CARD */}
            <section
              style={{
                position: 'relative',
                borderRadius: 24, background: '#FFFFFF',
                border: '1px solid #DCE8F5', padding: 22,
                boxShadow: '0 14px 32px rgba(15,45,85,0.07)',
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 52, height: 52, flexShrink: 0, borderRadius: 16,
                    background: 'linear-gradient(135deg, #FFF4DE 0%, #F4C979 100%)',
                    color: '#B7791F',
                    boxShadow: '0 8px 18px rgba(244,201,121,0.30)',
                  }}
                >
                  <Trophy size={22} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#3B82F6' }}>
                    TEYEON OFFICIAL RECORDS
                  </p>
                  <h1 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 900, lineHeight: 1.15, letterSpacing: '-0.02em', color: '#0F2747' }}>
                    공식 기록 보관함
                  </h1>
                </div>
              </div>
              <p style={{ margin: '12px 0 0', fontSize: 12.5, fontWeight: 700, lineHeight: 1.55, color: '#3F5B82' }}>
                정식 확정된 KDK 세션 기록을 보관합니다. 우승자·순위·결과가 공식 기록으로 남습니다.
              </p>
            </section>

            {/* Ranking 은 독립 메뉴로 분리 — Archive 는 공식 기록에 집중. 과한 CTA 없이 작은 보조 링크 1개만 유지. */}
            <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: '#56729A', lineHeight: 1.5 }}>
              클럽 순위와 회원 전적은 <Link href="/ranking" style={{ color: '#2563EB', fontWeight: 800, textDecoration: 'none' }}>랭킹 보기 →</Link> 에서 확인할 수 있습니다.
            </p>

            {/* STATS GRID (2x2) */}
            <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ borderRadius: 18, background: '#FFFFFF', border: '1px solid #DCE8F5', padding: 14, boxShadow: '0 6px 16px rgba(15,45,85,0.05)' }}>
                <p style={{ margin: 0, fontSize: 24, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.02em' }}>{totalSessionCount}</p>
                <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 700, color: '#56729A' }}>총 공식 세션</p>
              </div>
              <div style={{ borderRadius: 18, background: '#FFFFFF', border: '1px solid #DCE8F5', padding: 14, boxShadow: '0 6px 16px rgba(15,45,85,0.05)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <InitialAvatar name={latestOfficialWinner || 'TEYEON'} size={32} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 14.5, fontWeight: 900, color: '#0F2747', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>
                    {latestOfficialWinner || '—'}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 700, color: '#56729A' }}>최근 우승자</p>
                </div>
              </div>
              <div style={{ borderRadius: 18, background: '#FFFFFF', border: '1px solid #DCE8F5', padding: 14, boxShadow: '0 6px 16px rgba(15,45,85,0.05)' }}>
                <p style={{ margin: 0, fontSize: 24, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.02em' }}>{totalMatchCount.toLocaleString()}</p>
                <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 700, color: '#56729A' }}>총 경기 기록</p>
              </div>
              <div style={{ borderRadius: 18, background: '#FFFFFF', border: '1px solid #DCE8F5', padding: 14, boxShadow: '0 6px 16px rgba(15,45,85,0.05)' }}>
                <p style={{ margin: 0, fontSize: 24, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.02em' }}>{totalOfficialCount}</p>
                <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 700, color: '#56729A' }}>공식 확정 기록</p>
              </div>
            </section>

            {/* PERIOD FILTER (year + month chips) */}
            {availableYears.length > 0 && (
              <section
                style={{
                  borderRadius: 16, background: '#FFFFFF', border: '1px solid #DCE8F5',
                  padding: 14,
                  boxShadow: '0 6px 16px rgba(15,45,85,0.05)',
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#3B82F6',
                  }}>
                    기간 · PERIOD
                  </span>
                  {(yearFilter !== 'ALL' || monthFilter !== 'ALL') && (
                    <button
                      type="button"
                      onClick={() => { setYearFilter('ALL'); setMonthFilter('ALL'); }}
                      style={{
                        padding: '4px 10px', borderRadius: 999,
                        background: '#F6FAFD', border: '1px solid #DCE8F5',
                        color: '#56729A', fontSize: 10.5, fontWeight: 800,
                        letterSpacing: '0.04em', cursor: 'pointer',
                      }}
                    >
                      초기화
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(['ALL', ...availableYears] as const).map((y) => {
                    const active = yearFilter === y;
                    const label = y === 'ALL' ? '전체' : `${y}`;
                    return (
                      <button
                        key={`y-${y}`}
                        type="button"
                        onClick={() => {
                          setYearFilter(y);
                          if (y === 'ALL') setMonthFilter('ALL');
                          else if (monthFilter !== 'ALL') {
                            // Reset month if it's not present under the new year.
                            const yearMonths = new Set<number>();
                            archives.forEach(m => {
                              const d = new Date(m.match_date);
                              if (!Number.isNaN(d.getTime()) && d.getFullYear() === y) yearMonths.add(d.getMonth() + 1);
                            });
                            if (!yearMonths.has(monthFilter as number)) setMonthFilter('ALL');
                          }
                        }}
                        style={{
                          padding: '6px 12px', borderRadius: 999,
                          background: active ? 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)' : '#F8FBFE',
                          border: active ? 'none' : '1px solid #DCE8F5',
                          color: active ? '#FFFFFF' : '#3F5B82',
                          fontSize: 12, fontWeight: 900, letterSpacing: '0.02em',
                          boxShadow: active ? '0 6px 14px rgba(37,99,235,0.22)' : 'none',
                          cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {yearFilter !== 'ALL' && availableMonths.length > 0 && (
                  <div
                    style={{
                      display: 'flex', gap: 6,
                      overflowX: 'auto', paddingBottom: 2,
                      WebkitOverflowScrolling: 'touch',
                    }}
                  >
                    {(['ALL', ...availableMonths] as const).map((mo) => {
                      const active = monthFilter === mo;
                      const label = mo === 'ALL' ? '전체' : `${mo}월`;
                      return (
                        <button
                          key={`m-${mo}`}
                          type="button"
                          onClick={() => setMonthFilter(mo)}
                          style={{
                            flexShrink: 0,
                            padding: '5px 12px', borderRadius: 999,
                            background: active ? '#EEF6FF' : '#FFFFFF',
                            border: active ? '1.5px solid #2563EB' : '1px solid #DCE8F5',
                            color: active ? '#1F5FB5' : '#56729A',
                            fontSize: 11.5, fontWeight: 900, letterSpacing: '0.02em',
                            cursor: 'pointer', whiteSpace: 'nowrap',
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* STATUS FILTER — 일반 회원: 공식 기록만 / 관리자: 공식 ↔ 미확정·테스트 */}
            {isAdmin ? (
              <section
                style={{
                  display: 'flex', alignItems: 'center', padding: 4,
                  borderRadius: 16, background: '#FFFFFF', border: '1px solid #DCE8F5',
                  boxShadow: '0 6px 16px rgba(15,45,85,0.05)',
                }}
              >
                {([
                  { key: 'OFFICIAL', label: '공식 기록' },
                  { key: 'PENDING', label: '미확정·테스트' },
                ] as const).map((opt) => {
                  const active = recordFilter === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setRecordFilter(opt.key)}
                      style={{
                        flex: 1, height: 36, borderRadius: 12,
                        background: active ? 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)' : 'transparent',
                        color: active ? '#FFFFFF' : '#56729A',
                        border: 'none',
                        fontSize: 12.5, fontWeight: 900, letterSpacing: '0.02em',
                        boxShadow: active ? '0 6px 14px rgba(37,99,235,0.22)' : 'none',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </section>
            ) : (
              <section
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '10px 14px',
                  borderRadius: 16, background: '#FFFFFF', border: '1px solid #DCE8F5',
                  boxShadow: '0 6px 16px rgba(15,45,85,0.05)',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 800, color: '#3F5B82', letterSpacing: '-0.01em' }}>
                  공식 기록만 보고 있어요
                </span>
                <span
                  style={{
                    display: 'inline-flex', alignItems: 'center',
                    borderRadius: 999, padding: '4px 10px',
                    background: '#E0F5EB', border: '1px solid #B6E2CB', color: '#16A085',
                    fontSize: 10, fontWeight: 900, letterSpacing: '0.08em',
                  }}
                >
                  공식 기록
                </span>
              </section>
            )}

            {/* ADMIN PENDING BANNER */}
            {isAdmin && pendingOfficialCount > 0 && (
              <section
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  borderRadius: 16, background: '#EEF5FB', border: '1px solid #C7DCF1',
                  padding: '10px 14px',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <CheckCircle2 size={14} color="#1F5FB5" />
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: '#1F5FB5', letterSpacing: '-0.01em' }}>
                    관리자 · 공식 확정 대기 <span style={{ color: '#0F2747' }}>{pendingOfficialCount}건</span>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setRecordFilter('PENDING')}
                  style={{
                    flexShrink: 0, height: 30, padding: '0 14px', borderRadius: 999,
                    background: 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                    color: '#FFFFFF', border: 'none',
                    fontSize: 11, fontWeight: 900, letterSpacing: '0.02em',
                    boxShadow: '0 6px 14px rgba(37,99,235,0.22)',
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  확정 관리
                </button>
              </section>
            )}

            {/* SESSION CARDS */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sessions.length === 0 ? (
                <div
                  style={{
                    padding: '40px 20px', textAlign: 'center',
                    borderRadius: 22, background: '#FFFFFF',
                    border: '1px dashed #C7DCF1',
                  }}
                >
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#56729A' }}>
                    {recordFilter === 'OFFICIAL' ? '공식 기록이 없습니다' : '저장된 기록이 없습니다'}
                  </p>
                </div>
              ) : sessions.map((s: any) => {
                const topRanking = buildArchiveRankingResults(s).slice(0, 3);
                const cardStatus = getArchiveStatusMeta(s);
                return (
                  <article
                    key={s.id}
                    style={{
                      borderRadius: 22, background: '#FFFFFF',
                      border: '1px solid #DCE8F5', padding: 18,
                      boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                      display: 'flex', flexDirection: 'column', gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.01em', wordBreak: 'keep-all' }}>
                          {s.title}
                        </h3>
                        <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 700, color: '#56729A' }}>
                          {[formatArchiveDate(s.date), getSessionVenue(s), `참가 ${s.participantCount}명`].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <span
                        style={{
                          flexShrink: 0,
                          borderRadius: 999, padding: '4px 10px',
                          fontSize: 9.5, fontWeight: 900,
                          letterSpacing: '0.08em',
                          background: cardStatus.bg,
                          border: `1px solid ${cardStatus.border}`,
                          color: cardStatus.color,
                        }}
                      >
                        {cardStatus.label}
                      </span>
                    </div>

                    {topRanking.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {topRanking.map((p: any, idx: number) => (
                          <span
                            key={`${s.id}-top-${idx}`}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              padding: '4px 10px', borderRadius: 999,
                              background: idx === 0 ? '#FFF4DE' : '#F6FAFD',
                              border: idx === 0 ? '1px solid #F4C979' : '1px solid #DCE8F5',
                              fontSize: 11, fontWeight: 800,
                              color: idx === 0 ? '#B7791F' : '#3F5B82',
                              maxWidth: '100%',
                            }}
                          >
                            <span style={{ fontWeight: 900 }}>{idx + 1}</span>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.name}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        type="button"
                        onClick={() => setSelectedSessionId(s.id)}
                        style={{
                          flex: 1, height: 44, borderRadius: 14,
                          background: '#FFFFFF', border: '1px solid #DCE8F5',
                          color: '#1F5FB5', fontSize: 13, fontWeight: 900,
                          letterSpacing: '0.02em',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          cursor: 'pointer',
                        }}
                      >
                        상세 보기
                        <ArrowRight size={14} />
                      </button>
                      {isAdmin && !s.is_official && !s.isLocal && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); deleteSession(s); }}
                          aria-label="기록 삭제"
                          style={{
                            flexShrink: 0,
                            width: 44, height: 44, borderRadius: 14,
                            background: '#FFFFFF', border: '1px solid #F4C7C7',
                            color: '#C0392B',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer',
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          </>
        )}
      </div>
    </main>
  );

  function renderArchiveDetailView() {
    if (!selectedSession) return null;
    const session = selectedSession;
    const matches = session.matches || [];
    // 조별 순위 계산을 위해 matches를 그룹 기준으로 필터링한 가상 세션 생성
    const sessionForGroup = (group: 'A' | 'B') => ({
      ...session,
      matches: matches.filter((m: any) => normalizeArchiveGroup(m.group_name || m.groupName || m.group) === group),
      rankingData: [], // group별로는 저장된 ranking을 사용하지 않고 matches에서 재계산
    });
    const overallRanking = buildArchiveRankingResults(session);
    const groupHasA = matches.some((m: any) => normalizeArchiveGroup(m.group_name || m.groupName || m.group) === 'A');
    const groupHasB = matches.some((m: any) => normalizeArchiveGroup(m.group_name || m.groupName || m.group) === 'B');
    const hasGroupSplit = groupHasA && groupHasB;
    const activeGroup = hasGroupSplit ? archiveDetailGroup : 'ALL';
    const ranking = activeGroup === 'A'
      ? buildArchiveRankingResults(sessionForGroup('A'))
      : activeGroup === 'B'
        ? buildArchiveRankingResults(sessionForGroup('B'))
        : overallRanking;
    const top3 = overallRanking.slice(0, 3);
    const others = overallRanking.slice(3);

    // ── 결과 공유: 저장된 확정 데이터만으로 이미지 입력 구성 (LIVE COURT state 미참조) ──
    // 정산 스냅샷(settlement_data)이 있으면 벌금·게스트비·상금·최종을 함께 표기. 없으면 득실까지만.
    const settlementData: any[] = Array.isArray(session.settlementData) ? session.settlementData : [];
    const hasSettlement = settlementData.length > 0;
    const normNameKey = (s?: string) => String(s || '').replace(/\(G\)/gi, '').replace(/\s+/g, '').trim().toLowerCase();
    const settlementByName = new Map<string, any>();
    settlementData.forEach((e) => {
      const k = normNameKey(e?.player_name);
      if (k && !settlementByName.has(k)) settlementByName.set(k, e);
    });
    const toEntrySettlement = (e: any) => e ? {
      penaltyAmount: Number(e.penalty_amount || 0),
      guestFeeAmount: Number(e.guest_fee_amount || 0),
      prizeAmount: Number(e.prize_amount || 0),
      finalAmount: Number(e.final_amount || 0),
    } : undefined;
    const baseEntry = (p: any) => ({
      name: String(p?.name ?? ''),
      wins: Number(p?.wins || 0),
      losses: Number(p?.losses || 0),
      diff: Number(p?.diff || 0),
    });
    // 전체: 정산도 전체 순위 순서이므로 인덱스 우선, 이름 보조 매칭.
    const shareOverall = overallRanking.map((p: any, i: number) => ({
      ...baseEntry(p),
      settlement: toEntrySettlement(settlementData[i] ?? settlementByName.get(normNameKey(p?.name))),
    }));
    // 조별: 이름으로 정산 매칭.
    const toGroupEntry = (p: any) => ({
      ...baseEntry(p),
      settlement: toEntrySettlement(settlementByName.get(normNameKey(p?.name))),
    });
    const shareGroupA = groupHasA ? buildArchiveRankingResults(sessionForGroup('A')).map(toGroupEntry) : [];
    const shareGroupB = groupHasB ? buildArchiveRankingResults(sessionForGroup('B')).map(toGroupEntry) : [];

    // 정산 요약(결과 확인용) — 스냅샷 집계만, 재계산 없음.
    const settlementSummary = (() => {
      if (!hasSettlement) return null;
      let prizeCount = 0, penaltyCount = 0, guestCount = 0, payTotal = 0, receiveTotal = 0;
      settlementData.forEach((e) => {
        if (Number(e?.prize_amount || 0) > 0) prizeCount += 1;
        if (Number(e?.penalty_amount || 0) < 0) penaltyCount += 1;
        if (Number(e?.guest_fee_amount || 0) < 0) guestCount += 1;
        const f = Number(e?.final_amount || 0);
        if (f < 0) payTotal += f; else if (f > 0) receiveTotal += f;
      });
      return { prizeCount, penaltyCount, guestCount, payTotal, receiveTotal };
    })();
    const fmtMoneyKo = (n: number) => (n > 0 ? `+${n.toLocaleString()}` : n < 0 ? `-${Math.abs(n).toLocaleString()}` : '0');
    const shareMatches: ArchiveMatchEntry[] = [...matches]
      .map((m: any, idx: number) => ({ m, idx }))
      .sort((a, b) => {
        const ga = normalizeArchiveGroup(a.m.group_name || a.m.groupName || a.m.group);
        const gb = normalizeArchiveGroup(b.m.group_name || b.m.groupName || b.m.group);
        if (ga !== gb) return ga.localeCompare(gb);
        const ra = Number(a.m.round || 0), rb = Number(b.m.round || 0);
        if (ra !== rb) return ra - rb;
        return a.idx - b.idx;
      })
      .map(({ m, idx }, seq) => {
        const names = Array.from({ length: 4 }, (_, k) =>
          resolveArchivePlayerName(m.player_names?.[k], (m.player_ids || m.playerIds || [])[k], session.playerMetadata || {}));
        const gk = normalizeArchiveGroup(m.group_name || m.groupName || m.group);
        return {
          groupKey: (gk === 'A' || gk === 'B' ? gk : '') as 'A' | 'B' | '',
          round: m.round != null ? Number(m.round) : null,
          matchNo: Number(m.order ?? m.matchNo ?? m.court ?? (seq + 1)) || (seq + 1),
          teamA: `${names[0]} / ${names[1]}`,
          teamB: `${names[2]} / ${names[3]}`,
          score1: Number(m.score1 || 0),
          score2: Number(m.score2 || 0),
        };
      });

    return (
      <>
        {/* SESSION HEADER CARD */}
        <section
          style={{
            borderRadius: 24, background: '#FFFFFF',
            border: '1px solid #DCE8F5', padding: 18,
            boxShadow: '0 14px 32px rgba(15,45,85,0.07)',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.02em', wordBreak: 'keep-all' }}>
            {session.title}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: '#EEF5FB', border: '1px solid #DCE8F5', fontSize: 11, fontWeight: 800, color: '#1F5FB5' }}>
              <Calendar size={11} />
              {formatArchiveDate(session.date)}
            </span>
            {getSessionVenue(session) && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: '#EEF5FB', border: '1px solid #DCE8F5', fontSize: 11, fontWeight: 800, color: '#1F5FB5' }}>
                <MapPin size={11} />
                {getSessionVenue(session)}
              </span>
            )}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: '#EEF5FB', border: '1px solid #DCE8F5', fontSize: 11, fontWeight: 800, color: '#1F5FB5' }}>
              <Users size={11} />
              참가 {session.participantCount}명
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 999, background: '#EEF5FB', border: '1px solid #DCE8F5', fontSize: 11, fontWeight: 800, color: '#1F5FB5' }}>
              {archiveTypeLabel(session.archive_type)}
            </span>
          </div>
        </section>

        {/* STATUS CARD — 2-way: 공식 기록 확정됨 / 미확정·테스트 */}
        <section
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            borderRadius: 16, padding: '12px 14px',
            ...(session.is_official
              ? { background: '#E0F5EB', border: '1px solid #B6E2CB' }
              : { background: '#FFF4DE', border: '1px solid #F4C979' }),
          }}
        >
          <CheckCircle2 size={22} color={session.is_official ? '#16A085' : '#B7791F'} style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: session.is_official ? '#16A085' : '#B7791F' }}>
              {session.is_official ? '공식 기록 확정됨' : '미확정·테스트 기록'}
            </p>
            {session.is_official && session.confirmed_at && (
              <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 700, color: '#3F5B82' }}>
                {formatArchiveDateTime(session.confirmed_at)}{session.confirmed_by ? ` · 관리자 ${session.confirmed_by} 확인` : ''}
              </p>
            )}
            {!session.is_official && (
              <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 700, color: '#3F5B82' }}>
                {session.is_test
                  ? '테스트 기록입니다. 공식 확정 시 멤버 프로필 누적 기록에 반영됩니다.'
                  : '관리자가 공식 확정해야 멤버 프로필 누적 기록에 반영됩니다.'}
              </p>
            )}
          </div>
        </section>

        {/* ADMIN STATUS CONTROLS */}
        {isAdmin && !session.isLocal && (
          <section style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {session.is_official ? (
              <button
                type="button"
                onClick={() => updateArchiveRecordStatus(session.id, 'unofficial')}
                style={{
                  padding: '8px 14px', borderRadius: 999,
                  background: '#FFFFFF', border: '1px solid #DCE8F5',
                  color: '#3B5A85', fontSize: 11.5, fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                공식 해제
              </button>
            ) : (
              <button
                type="button"
                onClick={() => updateArchiveRecordStatus(session.id, 'official')}
                style={{
                  padding: '8px 14px', borderRadius: 999,
                  background: 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                  color: '#FFFFFF', border: 'none',
                  fontSize: 11.5, fontWeight: 900,
                  boxShadow: '0 6px 14px rgba(37,99,235,0.22)',
                  cursor: 'pointer',
                }}
              >
                공식 기록으로 확정
              </button>
            )}
            {session.is_test ? (
              <button
                type="button"
                onClick={() => updateArchiveRecordStatus(session.id, 'unofficial')}
                style={{
                  padding: '8px 14px', borderRadius: 999,
                  background: '#FFFFFF', border: '1px solid #DCE8F5',
                  color: '#3B5A85', fontSize: 11.5, fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                테스트 해제
              </button>
            ) : !session.is_official ? (
              <button
                type="button"
                onClick={() => updateArchiveRecordStatus(session.id, 'test')}
                style={{
                  padding: '8px 14px', borderRadius: 999,
                  background: '#FFFFFF', border: '1px solid #F4C7C7',
                  color: '#C0392B', fontSize: 11.5, fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                테스트 기록으로 변경
              </button>
            ) : null}
          </section>
        )}

        {/* FINANCE 벌금 등록 — CEO / ADMIN / FINANCE_MANAGER 전용. 일반 회원 미노출. */}
        {canRegisterFinancePenalty && !session.isLocal && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                disabled={!(session.is_official && !session.is_test)}
                onClick={() => setShowFinancePenaltyModal(true)}
                style={{
                  padding: '9px 16px', borderRadius: 999, border: 'none',
                  fontSize: 11.5, fontWeight: 900,
                  cursor: session.is_official && !session.is_test ? 'pointer' : 'not-allowed',
                  background: session.is_official && !session.is_test
                    ? 'linear-gradient(90deg, #0F9F98 0%, #16A085 100%)'
                    : '#E2E8F0',
                  color: session.is_official && !session.is_test ? '#FFFFFF' : '#94A3B8',
                  boxShadow: session.is_official && !session.is_test ? '0 6px 14px rgba(15,159,152,0.22)' : 'none',
                }}
              >
                Finance 벌금 등록
              </button>
              {session.is_official && !session.is_test && (
                <Link
                  href={`/finance/kdk/${encodeURIComponent(session.id)}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '9px 16px', borderRadius: 999,
                    background: '#FFFFFF', border: '1px solid #0F9F98',
                    color: '#0E7C76', fontSize: 11.5, fontWeight: 900,
                    textDecoration: 'none',
                  }}
                >
                  벌금·상금 정산 관리
                </Link>
              )}
              {session.is_official && !session.is_test && penaltyStatus && penaltyStatus.registered > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', padding: '5px 11px', borderRadius: 999,
                  background: penaltyStatus.registered >= penaltyStatus.linkable ? '#E0F5EB' : '#FFF4DE',
                  border: `1px solid ${penaltyStatus.registered >= penaltyStatus.linkable ? '#B6E2CB' : '#F4C979'}`,
                  color: penaltyStatus.registered >= penaltyStatus.linkable ? '#16A085' : '#B7791F',
                  fontSize: 11, fontWeight: 900,
                }}>
                  {penaltyStatus.registered >= penaltyStatus.linkable ? 'Finance 등록 완료' : '일부 등록'}
                </span>
              )}
            </div>
            {!(session.is_official && !session.is_test) && (
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#B7791F', wordBreak: 'keep-all' }}>
                공식 기록으로 확정된 KDK만 Finance에 반영할 수 있습니다.
              </p>
            )}
          </section>
        )}

        {/* TOP 3 HIGHLIGHT */}
        {top3.length > 0 && (
          <section
            style={{
              borderRadius: 22, background: '#FFFFFF',
              border: '1px solid #DCE8F5', padding: 16,
              boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #F4C979, #B7791F)', borderRadius: 2 }} />
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F2747' }}>TOP 3</h3>
              <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9CB2CC' }}>HIGHLIGHT</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 10 }}>
              {[1, 0, 2].map((idx) => {
                const p = top3[idx];
                if (!p) return <div key={`top-empty-${idx}`} style={{ flex: idx === 0 ? '0 0 36%' : '0 0 28%' }} />;
                const isFirst = idx === 0;
                const medal = isFirst ? '🏆' : idx === 1 ? '🥈' : '🥉';
                const rankLabel = isFirst ? 'CHAMPION' : idx === 1 ? '2ND' : '3RD';
                return (
                  <div
                    key={`top-${idx}-${p.name}`}
                    style={{
                      flex: isFirst ? '0 0 38%' : '0 0 28%',
                      borderRadius: 18,
                      background: isFirst ? 'linear-gradient(180deg, #FFF8E6 0%, #FFFFFF 100%)' : '#FFFFFF',
                      border: isFirst ? '2px solid #F4C979' : '1px solid #DCE8F5',
                      padding: '14px 8px',
                      textAlign: 'center',
                      boxShadow: isFirst ? '0 12px 28px rgba(244,201,121,0.20)' : '0 6px 16px rgba(15,45,85,0.05)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    }}
                  >
                    <span style={{ fontSize: isFirst ? 32 : 24, lineHeight: 1 }}>{medal}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: '0.14em', color: isFirst ? '#B7791F' : '#9CB2CC' }}>{rankLabel}</span>
                    <span style={{ fontSize: isFirst ? 16 : 13.5, fontWeight: 900, color: '#0F2747', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#56729A' }}>
                      {p.wins}승 {p.losses}패
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* RANKING — 전체 / A조 / B조 */}
        {(overallRanking.length > 0 || ranking.length > 0) && (
          <section
            style={{
              borderRadius: 22, background: '#FFFFFF',
              border: '1px solid #DCE8F5', padding: 16,
              boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #2563EB, #1F5FB5)', borderRadius: 2 }} />
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F2747' }}>
                {activeGroup === 'ALL' ? '전체 순위' : `${activeGroup}조 순위`}
              </h3>
              <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9CB2CC' }}>RANKING</span>
            </div>
            {hasGroupSplit && (
              <div
                style={{
                  display: 'flex', alignItems: 'center', padding: 4, marginBottom: 12,
                  borderRadius: 14, background: '#F8FBFE', border: '1px solid #E1EAF5',
                }}
              >
                {(['ALL', 'A', 'B'] as const).map((g) => {
                  const active = archiveDetailGroup === g;
                  const label = g === 'ALL' ? '전체' : `${g}조`;
                  return (
                    <button
                      key={`grp-${g}`}
                      type="button"
                      onClick={() => setArchiveDetailGroup(g)}
                      style={{
                        flex: 1, height: 32, borderRadius: 10,
                        background: active ? 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)' : 'transparent',
                        color: active ? '#FFFFFF' : '#56729A',
                        border: 'none',
                        fontSize: 11.5, fontWeight: 900, letterSpacing: '0.02em',
                        boxShadow: active ? '0 4px 10px rgba(37,99,235,0.18)' : 'none',
                        cursor: 'pointer', whiteSpace: 'nowrap',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid #DCE8F5' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#EEF5FB', borderBottom: '1px solid #DCE8F5' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 900, color: '#1F5FB5', letterSpacing: '0.06em', fontSize: 11 }}>순위</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 900, color: '#1F5FB5', letterSpacing: '0.06em', fontSize: 11 }}>이름</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 900, color: '#1F5FB5', letterSpacing: '0.06em', fontSize: 11 }}>승/패</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 900, color: '#1F5FB5', letterSpacing: '0.06em', fontSize: 11 }}>득실</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((p: any, idx: number) => {
                    const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#F8FBFE';
                    const isLast = idx === ranking.length - 1;
                    return (
                      <tr key={`row-${idx}`} style={{ background: rowBg, borderBottom: isLast ? 'none' : '1px solid #E1EAF5' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 900, color: idx < 3 ? '#1F5FB5' : '#3F5B82' }}>
                          {idx + 1}
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 800, color: '#0F2747' }}>
                          {p.name}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, color: '#3F5B82' }}>
                          {p.wins}/{p.losses}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 900, color: p.diff > 0 ? '#16A085' : p.diff < 0 ? '#C0392B' : '#7A93B3' }}>
                          {p.diff > 0 ? `+${p.diff}` : p.diff}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* MATCHES */}
        {matches.length > 0 && (
          <section
            style={{
              borderRadius: 22, background: '#FFFFFF',
              border: '1px solid #DCE8F5', padding: 16,
              boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #2563EB, #1F5FB5)', borderRadius: 2 }} />
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F2747' }}>경기별 결과</h3>
              <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9CB2CC' }}>MATCHES</span>
            </div>
            {/* A조 / B조 섹션 그룹화 + 1열 compact row 카드 (chip | 팀1 | 점수 | 팀2). 카드 전체 A/B 색상 유지. */}
            {(() => {
              const norm = (m: any) => normalizeArchiveGroup(m.group_name || m.groupName || m.group);
              const sections = ([
                { key: 'A', label: 'A조 경기', accent: '#2563EB', softBg: '#EEF6FF', softBorder: '#C7DCF1', list: matches.filter((m: any) => norm(m) === 'A') },
                { key: 'B', label: 'B조 경기', accent: '#C2710C', softBg: '#FFF4E2', softBorder: '#F3D29B', list: matches.filter((m: any) => norm(m) === 'B') },
                { key: 'X', label: '조 미지정 경기', accent: '#64748B', softBg: '#F4F7FB', softBorder: '#D9E3EF', list: matches.filter((m: any) => { const g = norm(m); return g !== 'A' && g !== 'B'; }) },
              ]).filter(s => s.list.length > 0);

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {sections.map((sec) => (
                    <div key={sec.key}>
                      {/* 섹션 헤더 — 동일 A/B 색상 체계 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ width: 4, height: 16, borderRadius: 2, background: sec.accent }} />
                        <h4 style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: sec.accent, letterSpacing: '-0.01em' }}>{sec.label}</h4>
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#9CB2CC' }}>{sec.list.length}경기</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {sec.list.map((m: any, idx: number) => {
                          const names = Array.from({ length: 4 }, (_, k) => resolveArchivePlayerName(m.player_names?.[k], (m.player_ids || m.playerIds || [])[k], session.playerMetadata || {}));
                          const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                          const team1Win = s1 > s2;
                          const team2Win = s2 > s1;
                          const courtNo = m.court || ((idx % 4) + 1);
                          const roundNo = m.round || Math.floor(idx / 4) + 1;
                          return (
                            <div
                              key={m.id || `match-${sec.key}-${idx}`}
                              style={{
                                borderRadius: 14,
                                background: sec.softBg,
                                border: `1px solid ${sec.softBorder}`,
                                boxShadow: '0 4px 12px rgba(15,45,85,0.04)',
                                padding: '10px 12px',
                                minHeight: 72,
                                display: 'grid',
                                gridTemplateColumns: 'auto minmax(0,1fr) auto minmax(0,1fr)',
                                alignItems: 'center', columnGap: 10,
                              }}
                            >
                              {/* 경기번호 chip */}
                              <span style={{
                                flexShrink: 0,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                padding: '3px 7px', borderRadius: 8,
                                background: '#FFFFFF', border: `1px solid ${sec.softBorder}`,
                                fontSize: 9.5, fontWeight: 900, color: sec.accent,
                                letterSpacing: '0.02em', whiteSpace: 'nowrap',
                              }}>
                                C{courtNo}-R{roundNo}
                              </span>
                              {/* 팀1 — 점수 방향(우측) 정렬, 선수별 독립 줄 */}
                              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
                                <ArchiveMatchName name={names[0]} win={team1Win} align="right" />
                                <ArchiveMatchName name={names[1]} win={team1Win} align="right" />
                              </div>
                              {/* 점수 — 중앙 고정, 최강조 */}
                              <span style={{
                                flexShrink: 0, minWidth: 42, textAlign: 'center', padding: '0 2px',
                                fontSize: 19, fontWeight: 900, color: '#1F5FB5',
                                fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', lineHeight: 1,
                              }}>
                                {s1}:{s2}
                              </span>
                              {/* 팀2 — 점수 방향(좌측) 정렬 */}
                              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
                                <ArchiveMatchName name={names[2]} win={team2Win} align="left" />
                                <ArchiveMatchName name={names[3]} win={team2Win} align="left" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </section>
        )}

        {/* SETTLEMENT SUMMARY */}
        <section
          style={{
            borderRadius: 22, background: '#FFFFFF',
            border: '1px solid #DCE8F5', padding: 16,
            boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #2563EB, #1F5FB5)', borderRadius: 2 }} />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F2747' }}>정산 요약</h3>
            <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9CB2CC' }}>SUMMARY</span>
          </div>
          <div style={{ borderRadius: 14, border: '1px solid #E1EAF5', overflow: 'hidden' }}>
            {(settlementSummary
              ? [
                  { label: '상금 대상', sub: `${settlementSummary.prizeCount}명`, value: settlementSummary.receiveTotal > 0 ? `+${settlementSummary.receiveTotal.toLocaleString()}` : '-', color: settlementSummary.receiveTotal > 0 ? '#047857' : '#0F2747' },
                  { label: '벌금 대상', sub: `${settlementSummary.penaltyCount}명`, value: '참고', color: '#C0392B' },
                  { label: '게스트비 대상', sub: `${settlementSummary.guestCount}명`, value: '참고', color: '#C0392B' },
                  { label: '최종 납부/지급', sub: '', value: `납부 ${fmtMoneyKo(settlementSummary.payTotal)} · 지급 ${fmtMoneyKo(settlementSummary.receiveTotal)}`, color: '#0F2747' },
                ]
              : [
                  { label: '게스트비', sub: '(정보 없음)', value: '-', color: '#0F2747' },
                  { label: '벌금', sub: '(정보 없음)', value: '-', color: '#0F2747' },
                  { label: '우승 상금', sub: '', value: '-', color: '#0F2747' },
                ]
            ).map((row, i, arr) => (
              <div
                key={row.label}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '12px 14px',
                  background: i % 2 === 0 ? '#FFFFFF' : '#F8FBFE',
                  borderBottom: i < arr.length - 1 ? '1px solid #E1EAF5' : 'none',
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 800, color: '#3F5B82', flexShrink: 0 }}>
                  {row.label}
                  {row.sub && <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 700, color: '#9CB2CC' }}>{row.sub}</span>}
                </span>
                <span style={{ fontSize: 13, fontWeight: 900, color: row.color, textAlign: 'right' }}>{row.value}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 10.5, fontWeight: 700, lineHeight: 1.5, color: '#7A93B3' }}>
            {settlementSummary
              ? '* 공식 확정 시점에 박제된 정산 스냅샷입니다. 실제 수납 처리는 Finance에서 진행됩니다.'
              : '* 이 기록에는 정산 스냅샷이 없습니다. 금액은 임의로 계산하지 않습니다.'}
          </p>
        </section>

        {/* SHARE — Archive 확정 데이터 기반 결과표 재생성 / 공유 */}
        <ArchiveResultShare
          sessionTitle={session.title || 'KDK SESSION'}
          sessionDateLabel={formatArchiveDate(session.date)}
          confirmedAtLabel={session.confirmed_at ? formatArchiveDateTime(session.confirmed_at) : undefined}
          isOfficial={!!session.is_official}
          hasSettlement={hasSettlement}
          overall={shareOverall}
          groupA={shareGroupA}
          groupB={shareGroupB}
          matches={shareMatches}
          hasGroupSplit={hasGroupSplit}
        />

        {/* FINANCE 벌금 등록 모달 — 운영진 전용. */}
        {showFinancePenaltyModal && canRegisterFinancePenalty && (
          <KdkFinancePenaltyModal
            session={{
              id: session.id,
              title: session.title,
              date: session.date,
              venue: getSessionVenue(session) || null,
              is_official: !!session.is_official,
              is_test: !!session.is_test,
              participantCount: session.participantCount,
              settlementData: Array.isArray(session.settlementData) ? session.settlementData : [],
            }}
            createdBy={user?.id || null}
            onClose={() => setShowFinancePenaltyModal(false)}
            onRegistered={loadPenaltyStatus}
          />
        )}
      </>
    );
  }

  async function updateArchiveRecordStatus(sessionId: string, status: 'official' | 'unofficial' | 'test') {
    if (!guardWriteAction('공식 기록 변경')) return; // 촬영 보호 모드 차단
    if (!isAdmin) return;

    const confirmedBy = userEmail || user?.email || user?.id || '';
    const payload =
      status === 'official'
        ? {
            is_official: true,
            is_test: false,
            confirmed_at: new Date().toISOString(),
            confirmed_by: confirmedBy,
            archive_type: 'kdk'
          }
        : status === 'test'
          ? {
              is_official: false,
              is_test: true,
              confirmed_at: null,
              confirmed_by: null,
              profile_reflected: false,
              archive_type: 'kdk'
            }
          : {
              is_official: false,
              is_test: false,
              confirmed_at: null,
              confirmed_by: null,
              profile_reflected: false
            };

    try {
      const { error } = await supabase
        .from('teyeon_archive_v1')
        .update(payload)
        .eq('id', sessionId);

      if (error) throw error;
      await fetchArchives();
    } catch (err: any) {
      alert(`Archive 상태 변경 실패: ${err.message || err}`);
    }
  }

  async function deleteSession(session: any) {
    if (!guardWriteAction('Archive 기록 삭제')) return; // 촬영 보호 모드 차단
    if (!isAdmin) return;
    const sessionId = String(session?.id || '');
    const title = session?.title || 'Archive';
    if (!sessionId) return;
    if (session?.is_official) {
      alert('공식 기록은 먼저 공식 해제 후 삭제하세요.');
      return;
    }
    if (!confirm(`[${title}] 이 Archive 기록을 삭제할까요? 삭제 후 복구할 수 없습니다.`)) return;
    try {
        if (session?.isLocal) {
            removeLocalArchiveFailover(sessionId);
        } else {
            const { error } = await supabase.from('teyeon_archive_v1').delete().eq('id', sessionId);
            if (error) throw error;
            removeLocalArchiveFailover(sessionId);
        }
        if (selectedSessionId === sessionId) setSelectedSessionId(null);
        await fetchArchives();
    } catch (err: any) { alert("삭제 실패: " + err.message); }
  }
}
