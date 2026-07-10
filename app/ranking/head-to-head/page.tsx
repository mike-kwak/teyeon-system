'use client';

export const dynamic = 'force-dynamic';

// TEYEON 회원 상대전적 — 공식 KDK Archive 경기 기준 두 회원 맞대결.
//   · 데이터: loadRankingInputs()(archive + members) 1회 조회, computeHeadToHead 순수 계산(추가 조회 없음).
//   · 개인정보 미노출(이름·공개 아바타·공식 기록만). 게스트 제외. MEMBER/OPERATOR 등 로그인 회원만.
//   · 회원 사진/이름 클릭 → 기존 PlayerCardModal(stable memberId). A/B 선택 상태는 유지.

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Search, X, ArrowLeftRight, ChevronRight, Swords, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { loadRankingInputs } from '@/lib/ranking/clubRankingService';
import { computeHeadToHead, computePartnerRecord, type HeadToHeadResult, type PartnerRecordSummary, type HeadToHeadMemberRef } from '@/lib/ranking/headToHead';
import type { KdkArchiveRow } from '@/lib/kdkArchiveStats';
import { normalizeAvatarUrl } from '@/lib/memberDisplayResolver';
import { fetchMemberOfficialStats, type PlayerCardStats } from '@/lib/profile/getMemberOfficialStats';
import { PlayerCardModal, MEMBER_LIST_COLS, type PlayerCardMember, type VisibilityLevel } from '@/components/players/PlayerCardModal';

const C = {
  text: '#0F172A', sub: '#64748B', faint: '#94A3B8', teal: '#0D9488', tealBg: 'rgba(13,148,136,0.08)',
  card: '#FFFFFF', border: 'rgba(15,23,42,0.07)', gold: '#B8891C', goldBg: 'rgba(201,168,76,0.12)', red: '#DC2626', redBg: 'rgba(220,38,38,0.06)',
};
const cardStyle: React.CSSProperties = { backgroundColor: C.card, borderRadius: 16, border: `1px solid ${C.border}`, boxShadow: '0 2px 10px rgba(15,23,42,0.05)' };

function Avatar({ name, url, size }: { name: string; url: string | null; size: number }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `1px solid ${C.border}`, backgroundColor: '#EEF2F7' }} />;
  }
  return <div aria-hidden style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, backgroundColor: C.tealBg, color: C.teal, border: '1px solid rgba(13,148,136,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.max(11, Math.round(size * 0.42)), fontWeight: 800 }}>{(name || '?').slice(0, 1)}</div>;
}

type Member = { id: string; name: string; avatarUrl: string | null };

// ── 회원 선택 시트 (검색 + 목록) — BottomNav 위까지 안전 노출 ──────────────────
function MemberPickerSheet({ title, members, excludeId, onPick, onClose }: {
  title: string; members: Member[]; excludeId: string | null;
  onPick: (id: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  useEffect(() => { const p = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = p; }; }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const filtered = members.filter((m) => m.id !== excludeId && (q.trim() === '' || m.name.includes(q.trim())));
  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, zIndex: 490, backgroundColor: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, backgroundColor: C.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '82dvh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <p style={{ flex: 1, margin: 0, fontSize: 14, fontWeight: 900, color: C.text }}>{title}</p>
            <button type="button" onClick={onClose} aria-label="닫기" style={{ width: 32, height: 32, borderRadius: '50%', border: `1px solid ${C.border}`, background: 'transparent', color: C.sub, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={16} /></button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, backgroundColor: '#F1F5F9' }}>
            <Search size={15} color={C.faint} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 검색"
              aria-label="회원 이름 검색"
              style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, fontWeight: 600, color: C.text }} />
          </div>
        </div>
        <div role="listbox" aria-label="회원 목록" style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '8px 10px', paddingBottom: 'calc(var(--bottom-nav-area, 88px) + 16px)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: C.faint }}>검색 결과가 없습니다.</div>
          ) : filtered.map((m) => (
            <button key={m.id} type="button" role="option" onClick={() => onPick(m.id)} className="rank-row"
              aria-label={`${m.name} 선택`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', borderRadius: 12, background: C.card, border: `1px solid ${C.border}`, textAlign: 'left', font: 'inherit', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
              <Avatar name={m.name} url={m.avatarUrl} size={34} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 800, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
              <ChevronRight size={14} color={C.faint} style={{ flexShrink: 0 }} aria-hidden />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 회원 슬롯 (선택/변경) ──────────────────────────────────────────────────────
function MemberSlot({ label, member, accent, onOpen, onCard }: {
  label: string; member: Member | null; accent: string;
  onOpen: () => void; onCard: (id: string) => void;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, ...cardStyle, padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
      <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: '0.08em', color: accent }}>{label}</span>
      {member ? (
        <>
          <button type="button" onClick={() => onCard(member.id)} aria-label={`${member.name} 회원 프로필 보기`} className="rank-row"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>
            <Avatar name={member.name} url={member.avatarUrl} size={54} />
            <span style={{ fontSize: 14, fontWeight: 900, color: C.text, maxWidth: 120, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.name}</span>
          </button>
          <button type="button" onClick={onOpen} style={{ fontSize: 11, fontWeight: 700, color: C.teal, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>변경</button>
        </>
      ) : (
        <button type="button" onClick={onOpen} aria-label={`${label} 회원 선택`}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 8px', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>
          <div style={{ width: 54, height: 54, borderRadius: '50%', border: `2px dashed ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: 22 }}>+</div>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: C.sub }}>회원 선택</span>
        </button>
      )}
    </div>
  );
}

function HeadToHeadInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { user, role, isLoading } = useAuth();

  const [inputs, setInputs] = useState<{ archiveRows: KdkArchiveRow[]; members: Member[] } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [aId, setAId] = useState<string | null>(sp.get('memberA'));
  const [bId, setBId] = useState<string | null>(sp.get('memberB'));
  const [view, setView] = useState<'opponent' | 'partner'>(sp.get('view') === 'partner' ? 'partner' : 'opponent');
  const [picker, setPicker] = useState<null | 'a' | 'b'>(null);
  const [showAll, setShowAll] = useState(false);
  const mountedRef = useRef(false);
  const selfAppliedRef = useRef(false);

  const gateOk = !!user && String(role || '').toUpperCase() !== 'GUEST';

  const reload = useCallback(async () => {
    setLoadError(false);
    try {
      const inp = await loadRankingInputs();
      const members = inp.members.map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl ?? null }));
      setInputs({ archiveRows: inp.archiveRows, members });
    } catch { setLoadError(true); }
  }, []);
  useEffect(() => { if (gateOk) void reload(); }, [gateOk, reload]);

  const memberIds = useMemo(() => new Set((inputs?.members || []).map((m) => m.id)), [inputs]);
  // URL id 검증 — 목록에 없으면 해당 선택만 초기화.
  useEffect(() => {
    if (!inputs) return;
    if (aId && !memberIds.has(aId)) setAId(null);
    if (bId && !memberIds.has(bId)) setBId(null);
  }, [inputs, memberIds, aId, bId]);

  // 본인 자동 선택(A 미선택 + URL 미지정 시). members.auth_user_id 로 본인 member id 1회 조회.
  useEffect(() => {
    if (!gateOk || !inputs || selfAppliedRef.current) return;
    if (sp.get('memberA') || aId) { selfAppliedRef.current = true; return; }
    selfAppliedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from('members').select('id').eq('auth_user_id', user!.id).maybeSingle();
        if (!cancelled && data?.id && memberIds.has(String(data.id))) setAId(String(data.id));
      } catch { /* 연결 없음 — 직접 선택 */ }
    })();
    return () => { cancelled = true; };
  }, [gateOk, inputs, memberIds, aId, sp, user]);

  // URL 동기화(회원 선택 + 탭 view).
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    const qs = [aId ? `memberA=${aId}` : '', bId ? `memberB=${bId}` : '', `view=${view}`].filter(Boolean).join('&');
    router.replace(`/ranking/head-to-head${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [aId, bId, view, router]);

  const memberById = useCallback((id: string | null): Member | null => (id && inputs ? inputs.members.find((m) => m.id === id) ?? null : null), [inputs]);
  const aMember = memberById(aId);
  const bMember = memberById(bId);

  const memberRefs: HeadToHeadMemberRef[] = useMemo(() => (inputs?.members || []).map((m) => ({ id: m.id, name: m.name })), [inputs]);
  const result: HeadToHeadResult | null = useMemo(() => {
    if (!inputs || !aId || !bId || aId === bId) return null;
    return computeHeadToHead(inputs.archiveRows, aId, bId, memberRefs);
  }, [inputs, aId, bId, memberRefs]);
  // 파트너 전적(같은 팀) — 동일 fetch 로 함께 계산(A/B 순서 무관하게 동일).
  const partnerResult: PartnerRecordSummary | null = useMemo(() => {
    if (!inputs || !aId || !bId || aId === bId) return null;
    return computePartnerRecord(inputs.archiveRows, aId, bId, memberRefs);
  }, [inputs, aId, bId, memberRefs]);
  useEffect(() => {
    if (result && result.excludedUnresolvedMatches > 0) console.info('[HeadToHead] 식별 불가 경기 제외 수:', result.excludedUnresolvedMatches);
  }, [result]);
  // 탭 전환 시 "전체 보기" 초기화.
  useEffect(() => { setShowAll(false); }, [view]);

  const swap = () => { setAId(bId); setBId(aId); setShowAll(false); };
  const pick = (id: string) => { if (picker === 'a') { if (id === bId) setBId(null); setAId(id); } else if (picker === 'b') { if (id === aId) setAId(null); setBId(id); } setPicker(null); setShowAll(false); };

  // ── PlayerCardModal (stable memberId — 상대전적 상태 유지) ──
  const [selMemberId, setSelMemberId] = useState<string | null>(null);
  const [selMember, setSelMember] = useState<PlayerCardMember | null>(null);
  const [selStats, setSelStats] = useState<PlayerCardStats | undefined>(undefined);
  const [selLoading, setSelLoading] = useState(false);
  const openMember = useCallback((id: string) => { if (id) setSelMemberId(id); }, []);
  const closeMember = useCallback(() => { setSelMemberId(null); setSelMember(null); }, []);
  useEffect(() => {
    if (!selMemberId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: row, error } = await supabase.from('members').select(MEMBER_LIST_COLS).eq('id', selMemberId).maybeSingle();
        if (error || !row) { if (!cancelled) setSelMemberId(null); return; }
        let profileAvatar: string | undefined; let visibility: VisibilityLevel | undefined;
        try {
          if ((row as any).auth_user_id) {
            const { data: p } = await supabase.from('profiles').select('avatar_url, profile_visibility_level').eq('id', (row as any).auth_user_id).maybeSingle();
            profileAvatar = normalizeAvatarUrl(p?.avatar_url) || undefined;
            visibility = (p?.profile_visibility_level as VisibilityLevel | undefined) || undefined;
          }
        } catch { /* keep */ }
        const member: PlayerCardMember = { ...(row as any), nickname: (row as any).nickname || '', profile_avatar_url: profileAvatar, profile_visibility_level: visibility };
        if (!cancelled) setSelMember(member);
      } catch { if (!cancelled) setSelMemberId(null); }
    })();
    return () => { cancelled = true; };
  }, [selMemberId]);
  useEffect(() => {
    if (!selMember) { setSelStats(undefined); return; }
    let cancelled = false; setSelStats(undefined); setSelLoading(true);
    fetchMemberOfficialStats({ id: selMember.id, name: selMember.nickname })
      .then((r) => { if (!cancelled) setSelStats(r.playerCardStats); })
      .catch(() => { /* placeholder */ })
      .finally(() => { if (!cancelled) setSelLoading(false); });
    return () => { cancelled = true; };
  }, [selMember]);
  const isOwnCard = !!(selMember && (selMember as any).auth_user_id && user?.id && (selMember as any).auth_user_id === user.id);
  const selAvatar = selMember ? (normalizeAvatarUrl((selMember as any).avatar_url) || normalizeAvatarUrl((selMember as any).profile_avatar_url) || undefined) : undefined;

  // ── 권한/로딩 ──
  if (isLoading) return <main style={{ minHeight: '60dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint }}>불러오는 중…</main>;
  if (!gateOk) return (
    <main style={{ padding: 24, textAlign: 'center' }}>
      <p style={{ fontSize: 14, fontWeight: 800, color: C.text }}>회원 전용 기능입니다.</p>
      <p style={{ fontSize: 12, color: C.sub, marginTop: 6 }}>로그인한 클럽 회원만 상대전적을 볼 수 있습니다.</p>
      <Link href="/ranking" style={{ display: 'inline-block', marginTop: 12, fontSize: 12.5, fontWeight: 700, color: C.teal }}>← 랭킹으로</Link>
    </main>
  );

  const recent = result ? (showAll ? result.matches : result.matches.slice(0, 5)) : [];
  const leaderName = result?.leader === 'a' ? aMember?.name : result?.leader === 'b' ? bMember?.name : null;
  const partnerRecent = partnerResult ? (showAll ? partnerResult.matches : partnerResult.matches.slice(0, 5)) : [];

  return (
    <main style={{ width: '100%', backgroundColor: '#F2F4F7', display: 'flex', flexDirection: 'column', alignItems: 'center', overflowX: 'clip' }}>
      <div style={{ width: '100%', maxWidth: 430, padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <style>{`.rank-row{transition:filter .15s,opacity .1s}.rank-row:hover{filter:brightness(0.98)}.rank-row:active{opacity:.9}`}</style>

        <div style={{ display: 'flex', alignItems: 'center', gap: 11, paddingTop: 16 }}>
          <Link href="/ranking" aria-label="랭킹으로" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.sub, flexShrink: 0, textDecoration: 'none' }}>
            <ChevronLeft size={19} />
          </Link>
          <div>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', color: C.teal }}>CLUB RANKING</p>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: C.text, letterSpacing: '0.02em' }}>상대전적</h1>
          </div>
        </div>

        {/* 회원 선택 */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
          <MemberSlot label="기준 회원 A" member={aMember} accent={C.teal} onOpen={() => setPicker('a')} onCard={openMember} />
          <button type="button" onClick={swap} disabled={!aId && !bId} aria-label="A/B 교체"
            style={{ alignSelf: 'center', width: 40, height: 40, borderRadius: '50%', border: `1px solid ${C.border}`, background: C.card, color: C.sub, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: (aId || bId) ? 'pointer' : 'default', flexShrink: 0, opacity: (aId || bId) ? 1 : 0.5 }}>
            <ArrowLeftRight size={16} />
          </button>
          <MemberSlot label="상대 회원 B" member={bMember} accent={C.gold} onOpen={() => setPicker('b')} onCard={openMember} />
        </div>

        {/* 탭: 상대 전적 / 파트너 전적 — 같은 A/B 조합을 유지한 채 전환 */}
        <div role="tablist" aria-label="전적 종류" style={{ display: 'flex', gap: 6, padding: 4, borderRadius: 12, backgroundColor: '#EAEEF3' }}>
          {([['opponent', '상대 전적', Swords], ['partner', '파트너 전적', Users]] as const).map(([key, label, Icon]) => {
            const on = view === key;
            return (
              <button key={key} type="button" role="tab" aria-selected={on} onClick={() => setView(key)}
                style={{
                  flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '9px 6px', borderRadius: 9, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  backgroundColor: on ? C.card : 'transparent', color: on ? C.teal : C.sub, fontSize: 12.5, fontWeight: on ? 900 : 700,
                  boxShadow: on ? '0 1px 3px rgba(15,23,42,0.12)' : 'none', transition: 'background-color .15s,color .15s',
                }}>
                <Icon size={14} aria-hidden style={{ flexShrink: 0 }} /> {label}
              </button>
            );
          })}
        </div>

        {loadError ? (
          <div style={{ ...cardStyle, padding: 20, borderColor: 'rgba(239,68,68,0.25)', backgroundColor: C.redBg, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: C.red }}>기록을 불러오지 못했습니다.</p>
            <button type="button" onClick={() => void reload()} style={{ marginTop: 10, padding: '8px 16px', borderRadius: 10, border: 'none', background: C.teal, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>다시 시도</button>
          </div>
        ) : aId && bId && aId === bId ? (
          <div style={{ ...cardStyle, padding: 22, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: C.text }}>서로 다른 두 회원을 선택하세요</p>
            <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 600, color: C.sub }}>같은 회원끼리는 상대전적을 계산할 수 없습니다.</p>
          </div>
        ) : !aId || !bId ? (
          <div style={{ ...cardStyle, padding: 22, textAlign: 'center' }}>
            <Swords size={22} color={C.faint} style={{ margin: '0 auto 8px' }} />
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: C.text }}>두 회원을 선택하세요</p>
            <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 600, color: C.sub }}>공식 KDK 경기 기준 상대 전적과 파트너 전적을 보여드립니다.</p>
          </div>
        ) : view === 'opponent' ? (
          result && result.totalGames === 0 ? (
            <div style={{ ...cardStyle, padding: 22, textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: C.text }}>아직 공식 맞대결 기록이 없습니다.</p>
              <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 600, color: C.sub }}>두 회원이 서로 상대 팀으로 출전한 공식 경기가 없습니다(같은 팀 경기는 제외).</p>
            </div>
          ) : result ? (
            <>
              {/* 상대 전적 요약 */}
              <section style={{ ...cardStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.teal }}>{result.aWins}</p>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.sub }}>{aMember?.name} 승</p>
                  </div>
                  <div style={{ textAlign: 'center', minWidth: 64 }}>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: C.faint }}>총 {result.totalGames}경기</p>
                    <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 700, color: C.sub }}>A 승률 {result.aWinRate}%</p>
                  </div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.gold }}>{result.bWins}</p>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.sub }}>{bMember?.name} 승</p>
                  </div>
                </div>
                <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 800, color: result.leader === 'tie' ? C.sub : C.text }}>
                  {result.leader === 'tie' ? '현재 동률입니다' : `현재 우세: ${leaderName}`}
                </div>
              </section>

              {result.hasUnresolvableRecords && (
                <p style={{ margin: '0 2px', fontSize: 10.5, fontWeight: 600, color: C.faint, lineHeight: 1.5 }}>
                  일부 과거 기록은 회원 식별이 어려워 집계에서 제외되었습니다.
                </p>
              )}

              {/* 최근 맞대결 */}
              <section>
                <p style={{ margin: '2px 0 8px', fontSize: 12, fontWeight: 900, color: C.text }}>최근 맞대결</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {recent.map((m, i) => (
                    <div key={`${m.archiveId}-${i}`} style={{ ...cardStyle, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: C.faint }}>{m.date}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, fontWeight: 700, color: C.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.sessionTitle}</span>
                        <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 999, color: m.aWon ? C.teal : C.red, backgroundColor: m.aWon ? C.tealBg : C.redBg }}>
                          {m.aWon ? `${aMember?.name} 승` : `${bMember?.name} 승`}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.aTeamNames.join(' · ')}</span>
                        <span style={{ fontSize: 14, fontWeight: 900, color: C.text, flexShrink: 0 }}>{m.scoreA} : {m.scoreB}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: C.text, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.bTeamNames.join(' · ')}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {result.matches.length > 5 && (
                  <button type="button" onClick={() => setShowAll((v) => !v)}
                    style={{ marginTop: 10, width: '100%', padding: '10px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.teal, fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                    {showAll ? '최근 5경기만 보기' : `전체 ${result.matches.length}경기 보기`}
                  </button>
                )}
              </section>
            </>
          ) : null
        ) : (
          partnerResult && partnerResult.totalGames === 0 ? (
            <div style={{ ...cardStyle, padding: 22, textAlign: 'center' }}>
              <Users size={22} color={C.faint} style={{ margin: '0 auto 8px' }} />
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: C.text }}>아직 함께 출전한 공식 경기 기록이 없습니다.</p>
              <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 600, color: C.sub }}>두 회원이 같은 팀으로 출전한 공식 경기가 없습니다(상대 팀 경기는 제외).</p>
            </div>
          ) : partnerResult ? (
            <>
              {/* 파트너 전적 요약 — 협업 구도(양쪽 동일 팀) */}
              <section style={{ ...cardStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: C.faint }}>파트너 승률</p>
                  <p style={{ margin: '1px 0 0', fontSize: 26, fontWeight: 900, color: C.teal }}>{partnerResult.winRate}%</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
                  <div style={{ flex: 1, textAlign: 'center', padding: '8px 4px', borderRadius: 10, backgroundColor: '#F1F5F9' }}>
                    <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: C.text }}>{partnerResult.totalGames}</p>
                    <p style={{ margin: '1px 0 0', fontSize: 10.5, fontWeight: 700, color: C.sub }}>함께한 경기</p>
                  </div>
                  <div style={{ flex: 1, textAlign: 'center', padding: '8px 4px', borderRadius: 10, backgroundColor: C.tealBg }}>
                    <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: C.teal }}>{partnerResult.wins}</p>
                    <p style={{ margin: '1px 0 0', fontSize: 10.5, fontWeight: 700, color: C.sub }}>공동 승리</p>
                  </div>
                  <div style={{ flex: 1, textAlign: 'center', padding: '8px 4px', borderRadius: 10, backgroundColor: C.redBg }}>
                    <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: C.red }}>{partnerResult.losses}</p>
                    <p style={{ margin: '1px 0 0', fontSize: 10.5, fontWeight: 700, color: C.sub }}>공동 패배</p>
                  </div>
                </div>
                <div style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: C.sub }}>
                  {aMember?.name} · {bMember?.name} 함께 {partnerResult.totalGames}경기 · {partnerResult.wins}승 {partnerResult.losses}패
                </div>
              </section>

              {partnerResult.hasUnresolvableRecords && (
                <p style={{ margin: '0 2px', fontSize: 10.5, fontWeight: 600, color: C.faint, lineHeight: 1.5 }}>
                  일부 과거 기록은 회원 식별이 어려워 집계에서 제외되었습니다.
                </p>
              )}

              {/* 최근 함께한 경기 */}
              <section>
                <p style={{ margin: '2px 0 8px', fontSize: 12, fontWeight: 900, color: C.text }}>최근 함께한 경기</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {partnerRecent.map((m, i) => (
                    <div key={`${m.archiveId}-${i}`} style={{ ...cardStyle, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: C.faint }}>{m.date}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, fontWeight: 700, color: C.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.sessionTitle}</span>
                        <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 999, color: m.won ? C.teal : C.red, backgroundColor: m.won ? C.tealBg : C.redBg }}>
                          {m.won ? '승' : '패'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 800, color: C.teal, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.pairTeamNames.join(' · ')}</span>
                        <span style={{ fontSize: 14, fontWeight: 900, color: C.text, flexShrink: 0 }}>{m.pairScore} : {m.oppScore}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: C.text, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.oppTeamNames.join(' · ')}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {partnerResult.matches.length > 5 && (
                  <button type="button" onClick={() => setShowAll((v) => !v)}
                    style={{ marginTop: 10, width: '100%', padding: '10px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.teal, fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                    {showAll ? '최근 5경기만 보기' : `전체 ${partnerResult.matches.length}경기 보기`}
                  </button>
                )}
              </section>
            </>
          ) : null
        )}

        <div style={{ height: 'var(--page-bottom-safe, 88px)' }} aria-hidden />
      </div>

      {picker && inputs && (
        <MemberPickerSheet
          title={picker === 'a' ? '기준 회원 A 선택' : '상대 회원 B 선택'}
          members={inputs.members}
          excludeId={picker === 'a' ? bId : aId}
          onPick={pick}
          onClose={() => setPicker(null)}
        />
      )}

      {selMember && (
        <PlayerCardModal member={selMember} finalAvatar={selAvatar} isOwnCard={isOwnCard} stats={selStats} isStatsLoading={selLoading} onClose={closeMember} />
      )}
    </main>
  );
}

export default function HeadToHeadPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: '60dvh' }} />}>
      <HeadToHeadInner />
    </Suspense>
  );
}
