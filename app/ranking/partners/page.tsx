'use client';

export const dynamic = 'force-dynamic';

// TEYEON MY PARTNER — 나와 잘 맞는 파트너.
//   · 데이터: 상대전적 · MY RIVAL 과 같은 loadRankingInputs()(공식 KDK Archive + 회원 명단) 1회 조회 → computeMyPartners(순수 계산).
//     승패 · 득실은 computePartnerRecord 를 그대로 사용 → 카드의 "파트너 전적 상세" 와 수치가 항상 같다.
//   · 권한: 상대전적 · MY RIVAL 과 동일(로그인 회원, GUEST 역할 제외). 기준 회원은 본인(members.auth_user_id) 고정 —
//     다른 회원을 고르는 입력이 없고, 본인 연결이 없으면 다른 회원 기록으로 대체하지 않고 안내만 표시한다.
//   · 보정 승률 (승+2)/(경기+4) 은 정렬에만 쓰고 화면에는 실제 기록만 표시한다.
//   · 운영 DB 쓰기 없음. 신규 테이블 · SQL 없음.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Handshake, Sparkles, Repeat } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { loadRankingInputs } from '@/lib/ranking/clubRankingService';
import { computeMyPartners, PARTNER_MIN_GAMES, PRIOR_WINS, PRIOR_GAMES, type MyPartnerResult, type PartnerStat } from '@/lib/ranking/myPartner';
import type { KdkArchiveRow } from '@/lib/kdkArchiveStats';

const C = {
  text: '#0F172A', sub: '#64748B', faint: '#94A3B8', teal: '#0D9488', tealBg: 'rgba(13,148,136,0.08)',
  card: '#FFFFFF', border: 'rgba(15,23,42,0.07)', gold: '#B8891C', goldBg: 'rgba(201,168,76,0.12)', red: '#DC2626', redBg: 'rgba(220,38,38,0.06)',
  indigo: '#4F46E5', indigoBg: 'rgba(79,70,229,0.08)',
};
const cardStyle: React.CSSProperties = { backgroundColor: C.card, borderRadius: 16, border: `1px solid ${C.border}`, boxShadow: '0 2px 10px rgba(15,23,42,0.05)' };

type Member = { id: string; name: string; avatarUrl: string | null };

function Avatar({ name, url, size }: { name: string; url: string | null; size: number }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `1px solid ${C.border}`, backgroundColor: '#EEF2F7' }} />;
  }
  return <div aria-hidden style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, backgroundColor: C.tealBg, color: C.teal, border: '1px solid rgba(13,148,136,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.max(11, Math.round(size * 0.42)), fontWeight: 800 }}>{(name || '?').slice(0, 1)}</div>;
}

/** 최근 함께 뛴 흐름(최근 → 과거, 최대 5) — 승 teal · 패 red. */
function FormDots({ form }: { form: boolean[] }) {
  return (
    <span aria-label={`최근 ${form.length}경기 ${form.map((w) => (w ? '승' : '패')).join(' ')}`} style={{ display: 'inline-flex', gap: 3, flexShrink: 0 }}>
      {form.map((w, i) => (
        <span key={i} aria-hidden style={{ width: 16, height: 16, borderRadius: 5, fontSize: 9, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: w ? C.teal : C.red, backgroundColor: w ? C.tealBg : C.redBg }}>{w ? '승' : '패'}</span>
      ))}
    </span>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function PartnerCard({ p, kind, meId, avatar, rank }: { p: PartnerStat; kind: 'best' | 'more'; meId: string; avatar: string | null; rank: number }) {
  const accent = kind === 'best' ? C.gold : C.indigo;
  const href = `/ranking/head-to-head?memberA=${encodeURIComponent(meId)}&memberB=${encodeURIComponent(p.partnerId)}&view=partner`;
  const l = p.latest;
  return (
    <article data-partner-card={kind} data-partner-id={p.partnerId} style={{ ...cardStyle, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, borderLeft: `3px solid ${accent}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Avatar name={p.partnerName} url={avatar} size={42} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.08em', color: accent }}>{kind === 'best' ? `BEST ${rank}` : `TOGETHER ${rank}`}</p>
          <p data-partner="name" style={{ margin: '1px 0 0', fontSize: 15, fontWeight: 900, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.partnerName}</p>
          <p style={{ margin: '1px 0 0', fontSize: 11, fontWeight: 700, color: C.sub }}>함께 <span data-partner="games">{p.totalGames}</span>경기</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p data-partner="rate" style={{ margin: 0, fontSize: 20, fontWeight: 900, color: kind === 'best' ? C.gold : C.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{p.winRate}%</p>
          <p style={{ margin: '2px 0 0', fontSize: 10, fontWeight: 800, color: C.faint }}>함께 승률</p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'center', padding: '7px 4px', borderRadius: 10, backgroundColor: C.tealBg }}>
          <p data-partner="wins" style={{ margin: 0, fontSize: 17, fontWeight: 900, color: C.teal, fontVariantNumeric: 'tabular-nums' }}>{p.wins}</p>
          <p style={{ margin: '1px 0 0', fontSize: 10, fontWeight: 700, color: C.sub }}>승</p>
        </div>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'center', padding: '7px 4px', borderRadius: 10, backgroundColor: C.redBg }}>
          <p data-partner="losses" style={{ margin: 0, fontSize: 17, fontWeight: 900, color: C.red, fontVariantNumeric: 'tabular-nums' }}>{p.losses}</p>
          <p style={{ margin: '1px 0 0', fontSize: 10, fontWeight: 700, color: C.sub }}>패</p>
        </div>
        <div style={{ flex: 1.3, minWidth: 0, textAlign: 'center', padding: '7px 4px', borderRadius: 10, backgroundColor: '#F8FAFC' }}>
          <p data-partner="diff" style={{ margin: 0, fontSize: 17, fontWeight: 900, color: p.pointDiff >= 0 ? C.teal : C.red, fontVariantNumeric: 'tabular-nums' }}>{signed(p.pointDiff)}</p>
          <p style={{ margin: '1px 0 0', fontSize: 10, fontWeight: 700, color: C.sub, whiteSpace: 'nowrap' }}>득실 <span data-partner="points">{p.pointsFor}:{p.pointsAgainst}</span></p>
        </div>
      </div>

      {l && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 6 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: C.faint, flexShrink: 0 }}>최근</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.sub, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{l.date}</span>
          <span data-partner="latest" style={{ fontSize: 10.5, fontWeight: 900, padding: '2px 8px', borderRadius: 999, color: l.won ? C.teal : C.red, backgroundColor: l.won ? C.tealBg : C.redBg, flexShrink: 0 }}>
            {l.won ? '승' : '패'} {l.pairScore}:{l.oppScore}
          </span>
          <span style={{ flex: 1 }} />
          <FormDots form={p.recentForm} />
        </div>
      )}

      <Link href={href} data-partner="detail" className="rank-row"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 40, borderRadius: 10, border: `1px solid ${C.border}`, color: C.teal, fontSize: 12.5, fontWeight: 800, textDecoration: 'none', backgroundColor: '#F8FAFC' }}>
        파트너 전적 상세 보기 <ChevronRight size={14} aria-hidden />
      </Link>
    </article>
  );
}

function Section({ kind, list, meId, avatarOf }: { kind: 'best' | 'more'; list: PartnerStat[]; meId: string; avatarOf: (id: string) => string | null }) {
  const best = kind === 'best';
  const Icon = best ? Sparkles : Repeat;
  return (
    <section data-partner-section={kind} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px 0' }}>
        <span aria-hidden style={{ width: 28, height: 28, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backgroundColor: best ? C.goldBg : C.indigoBg, color: best ? C.gold : C.indigo, flexShrink: 0 }}><Icon size={15} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: C.text }}>{best ? 'BEST PARTNER' : 'MORE TOGETHER'}</h2>
          <p style={{ margin: '1px 0 0', fontSize: 10.5, fontWeight: 700, color: C.faint, wordBreak: 'keep-all' }}>
            {best ? '함께 뛸 때 가장 좋은 결과를 낸 파트너' : '조금 더 호흡을 맞춰 볼 파트너'}
          </p>
        </div>
      </div>
      {list.map((p, i) => <PartnerCard key={p.partnerId} p={p} kind={kind} meId={meId} avatar={avatarOf(p.partnerId)} rank={i + 1} />)}
    </section>
  );
}

function Skeleton() {
  const bar = (h: number, w = '100%') => <div style={{ height: h, width: w, borderRadius: 12, background: 'linear-gradient(90deg,#E8ECF1,#F3F5F8,#E8ECF1)' }} />;
  return <div data-partner="loading" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{bar(92)}{bar(18, '40%')}{bar(170)}{bar(18, '40%')}{bar(170)}</div>;
}

export default function MyPartnerPage() {
  const { user, role, isLoading } = useAuth();
  const gateOk = !!user && String(role || '').toUpperCase() !== 'GUEST';

  const [inputs, setInputs] = useState<{ archiveRows: KdkArchiveRow[]; members: Member[]; activeIds: Set<string> } | null>(null);
  const [meId, setMeId] = useState<string | null | undefined>(undefined); // undefined = 확인 중, null = 본인 기록 사용 불가(selfBlock 참조)
  const [selfBlock, setSelfBlock] = useState<'unlinked' | 'withdrawn' | null>(null);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoadError(false); setInputs(null); setMeId(undefined); setSelfBlock(null);
    try {
      const [inp, self] = await Promise.all([
        loadRankingInputs(),
        supabase.from('members').select('id').eq('auth_user_id', user.id).maybeSingle(),
      ]);
      const toMember = (m: { id: string; name: string; avatarUrl?: string | null }): Member => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl ?? null });
      setInputs({ archiveRows: inp.archiveRows, members: inp.members.map(toMember), activeIds: new Set(inp.activeMembers.map((m) => m.id)) });
      // 본인 조회 자체가 실패하면 미연결로 단정하지 않고 오류(다시 시도)로 처리한다.
      if (self.error) throw self.error;
      const id = self.data?.id ? String(self.data.id) : null;
      if (!id) { setSelfBlock('unlinked'); setMeId(null); return; }
      if (!inp.activeMembers.some((m) => m.id === id)) { setSelfBlock('withdrawn'); setMeId(null); return; }
      setMeId(id);
    } catch { setLoadError(true); }
  }, [user]);
  useEffect(() => { if (gateOk) void reload(); }, [gateOk, reload]);

  const result: MyPartnerResult | null = useMemo(() => {
    if (!inputs || !meId) return null;
    return computeMyPartners(inputs.archiveRows, meId, inputs.members.map((m) => ({ id: m.id, name: m.name })), inputs.activeIds);
  }, [inputs, meId]);
  const me = inputs && meId ? inputs.members.find((m) => m.id === meId) ?? null : null;
  const avatarOf = useCallback((id: string) => inputs?.members.find((m) => m.id === id)?.avatarUrl ?? null, [inputs]);

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, paddingTop: 16 }}>
      <Link href="/ranking" aria-label="랭킹으로" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.sub, flexShrink: 0, textDecoration: 'none' }}>
        <ChevronLeft size={19} />
      </Link>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', color: C.teal }}>CLUB RANKING</p>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: C.text, letterSpacing: '0.02em' }}>MY PARTNER</h1>
      </div>
    </div>
  );

  const wrap = (body: React.ReactNode) => (
    <main data-partner="page" style={{ width: '100%', backgroundColor: '#F2F4F7', display: 'flex', flexDirection: 'column', alignItems: 'center', overflowX: 'clip' }}>
      <div style={{ width: '100%', maxWidth: 430, padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box' }}>
        <style>{`.rank-row{transition:filter .15s,opacity .1s}.rank-row:hover{filter:brightness(0.98)}.rank-row:active{opacity:.9}`}</style>
        {header}
        {body}
      </div>
    </main>
  );

  if (isLoading) return wrap(<Skeleton />);
  if (!gateOk) return wrap(
    <div data-partner="gate" style={{ ...cardStyle, padding: 22, textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.text }}>회원 전용 기능입니다.</p>
      <p style={{ margin: '6px 0 0', fontSize: 12, color: C.sub }}>로그인한 클럽 회원만 MY PARTNER 를 볼 수 있습니다.</p>
      <Link href="/ranking" style={{ display: 'inline-block', marginTop: 12, fontSize: 12.5, fontWeight: 700, color: C.teal }}>← 랭킹으로</Link>
    </div>,
  );
  if (loadError) return wrap(
    <div data-partner="error" style={{ ...cardStyle, padding: 20, borderColor: 'rgba(239,68,68,0.25)', backgroundColor: C.redBg, textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: C.red }}>기록을 불러오지 못했습니다.</p>
      <button type="button" onClick={() => void reload()} style={{ marginTop: 10, minHeight: 40, padding: '8px 16px', borderRadius: 10, border: 'none', background: C.teal, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>다시 시도</button>
    </div>,
  );
  if (!inputs || meId === undefined) return wrap(<Skeleton />);
  if (meId === null && selfBlock === 'withdrawn') return wrap(
    <div data-partner="withdrawn" style={{ ...cardStyle, padding: 22, textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: C.text }}>현재 활동 회원만 MY PARTNER 를 볼 수 있어요.</p>
      <p style={{ margin: '6px 0 0', fontSize: 12, color: C.sub, lineHeight: 1.55, wordBreak: 'keep-all' }}>탈회 상태로 확인되어 MY PARTNER 를 표시하지 않습니다. 회원 상태 확인이 필요하면 운영진에게 문의해 주세요.</p>
      <Link href="/ranking" style={{ display: 'inline-block', marginTop: 12, fontSize: 12.5, fontWeight: 700, color: C.teal }}>← 랭킹으로</Link>
    </div>,
  );
  if (meId === null) return wrap(
    <div data-partner="unlinked" style={{ ...cardStyle, padding: 22, textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: C.text }}>회원 정보와 계정이 아직 연결되지 않았어요.</p>
      <p style={{ margin: '6px 0 0', fontSize: 12, color: C.sub, lineHeight: 1.55 }}>운영진에게 계정 연결을 요청하면 나의 공식 기록으로 MY PARTNER 를 볼 수 있습니다.</p>
      <Link href="/ranking/head-to-head?view=partner" style={{ display: 'inline-block', marginTop: 12, fontSize: 12.5, fontWeight: 700, color: C.teal }}>파트너 전적 보기 →</Link>
    </div>,
  );

  const r = result!;
  return wrap(
    <>
      {/* HERO */}
      <section data-partner="hero" style={{ ...cardStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: 'linear-gradient(160deg, #FFFFFF 0%, #FBF7EC 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.goldBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Handshake size={19} color={C.gold} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 9.5, fontWeight: 900, letterSpacing: '0.16em', color: C.gold }}>MY PARTNER</p>
            <p style={{ margin: '1px 0 0', fontSize: 16, fontWeight: 900, color: C.text }}>나와 잘 맞는 파트너</p>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: C.sub }}>공식 KDK 기록 기반 · 함께 {PARTNER_MIN_GAMES}경기 이상 뛴 파트너</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.8)', border: `1px solid ${C.border}`, minWidth: 0 }}>
          <Avatar name={me?.name || ''} url={me?.avatarUrl ?? null} size={36} />
          <span data-partner="me" style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 900, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me?.name}</span>
          <span data-partner="met" style={{ fontSize: 11, fontWeight: 800, color: C.sub, flexShrink: 0 }}>함께 뛴 파트너 {r.partnersMet}명</span>
        </div>
      </section>

      {r.qualified === 0 ? (
        <div data-partner="empty" style={{ ...cardStyle, padding: '22px 18px', textAlign: 'center' }}>
          <Handshake size={22} color={C.faint} style={{ margin: '0 auto 8px' }} aria-hidden />
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: C.text, lineHeight: 1.6, wordBreak: 'keep-all' }}>
            아직 함께 {PARTNER_MIN_GAMES}경기 이상 뛴 파트너가 없어요.
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 600, color: C.sub, lineHeight: 1.6, wordBreak: 'keep-all' }}>
            {r.partnersMet > 0
              ? `지금까지 ${r.partnersMet}명과 함께 뛰었고, 가장 많이 함께한 기록은 ${r.maxGamesBelowMin}경기입니다. 공식 KDK 경기가 쌓이면 BEST PARTNER 를 확인할 수 있습니다.`
              : '공식 KDK 경기가 쌓이면 BEST PARTNER 를 확인할 수 있습니다.'}
          </p>
        </div>
      ) : (
        <>
          <Section kind="best" list={r.best} meId={meId} avatarOf={avatarOf} />
          {r.moreTogether.length > 0 ? (
            <Section kind="more" list={r.moreTogether} meId={meId} avatarOf={avatarOf} />
          ) : (
            <p data-partner="more-note" style={{ margin: '0 2px', fontSize: 11.5, fontWeight: 700, color: C.sub, lineHeight: 1.55, wordBreak: 'keep-all' }}>
              함께 {PARTNER_MIN_GAMES}경기 이상 뛴 파트너가 더 생기면 MORE TOGETHER 가 표시됩니다.
            </p>
          )}
        </>
      )}

      {r.hasUnresolvableRecords && (
        <p style={{ margin: '0 2px', fontSize: 10.5, fontWeight: 600, color: C.faint, lineHeight: 1.5 }}>일부 과거 기록은 회원 식별이 어려워 집계에서 제외되었습니다.</p>
      )}
      <p data-partner="rule" style={{ margin: '0 2px', fontSize: 10.5, fontWeight: 600, color: C.faint, lineHeight: 1.5, wordBreak: 'keep-all' }}>
        공식 KDK 경기만 집계합니다(게스트 · 탈회 회원 제외). 순서는 경기 수를 반영한 보정 승률 (승+{PRIOR_WINS})/(경기+{PRIOR_GAMES}) 기준이며, 카드에는 실제 기록을 표시합니다. 수치는 파트너 전적과 같습니다.
      </p>
    </>,
  );
}
