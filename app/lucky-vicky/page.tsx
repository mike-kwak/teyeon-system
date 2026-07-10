'use client';

export const dynamic = 'force-dynamic';

// TEYEON 클럽 문화 — 러키비키(LUCKY VICKY) 전용 페이지 (1차).
//   · 회원 전용(useTennisLogAccess 공유 whitelist). 게스트/비로그인 = 안내 + 메인 복귀(기존 패턴 재사용).
//   · 데이터는 lib/luckyVickyData(중앙 정적) 만 사용 — 실제 확정 정보만. 가짜 팀/대회/결과 생성 금지.
//   · Cool Premium Light + soft gold/ivory. 별도 앱처럼 보이지 않게, 과한 게임/도박 UI 금지.

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, Clover, Sparkles, Users2, Target, Gift, Lock,
} from 'lucide-react';
import { useTennisLogAccess } from '@/hooks/useTennisLogAccess';
import {
  roundTeamCount,
  type LuckyVickyRound,
  type LuckyVickyTeam,
  type LuckyVickyTeamStatus,
  type LuckyVickySupportStatus,
} from '@/lib/luckyVickyData';
import { fetchLuckyVickyView } from '@/lib/luckyVickyService';

// ── 디자인 토큰 (Cool Premium Light + soft gold / ivory) ──────────────────────
const C = {
  text: '#0F172A', sub: '#64748B', faint: '#94A3B8',
  card: '#FFFFFF', border: 'rgba(15,23,42,0.08)',
  ivory: '#FFFDF7', ivoryBorder: 'rgba(199,154,50,0.20)',
  gold: '#C79A32', goldText: '#8E6B17', goldBg: 'rgba(199,154,50,0.10)',
  teal: '#0D9488', tealBg: 'rgba(13,148,136,0.08)',
  slateBg: '#F1F5F9',
};
const cardStyle: React.CSSProperties = { backgroundColor: C.card, borderRadius: 16, border: `1px solid ${C.border}`, boxShadow: '0 2px 10px rgba(15,23,42,0.05)' };

// ── 상태 → 표시 라벨/색 (지원 대상 ≠ 지원 완료, 결과 대기 ≠ 미지원 — 분리 유지) ──
const TEAM_STATUS: Record<LuckyVickyTeamStatus, { label: string; color: string; bg: string }> = {
  selecting_tournament: { label: '대회 선택 중', color: '#8E6B17', bg: C.goldBg },
  preparing: { label: '출전 준비', color: '#0E7C76', bg: C.tealBg },
  registered: { label: '참가 신청 완료', color: '#2563EB', bg: 'rgba(37,99,235,0.10)' },
  completed: { label: '출전 완료', color: '#475569', bg: C.slateBg },
};
const SUPPORT_STATUS: Record<LuckyVickySupportStatus, { label: string; color: string; bg: string }> = {
  pending_result: { label: '결과 대기', color: '#64748B', bg: C.slateBg },
  eligible: { label: '지원 대상', color: '#8E6B17', bg: C.goldBg },
  supported: { label: '지원 완료', color: '#0E7C76', bg: C.tealBg },
  not_eligible: { label: '미지원', color: '#94A3B8', bg: C.slateBg },
};

function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10.5, fontWeight: 800, color, backgroundColor: bg, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>{label}</span>;
}

// ── 파트너 팀 카드 (실제 데이터가 있는 팀만 렌더) ──────────────────────────────
function TeamCard({ team, muted }: { team: LuckyVickyTeam; muted?: boolean }) {
  const names = (team.memberNames || []).filter(Boolean);
  const ts = TEAM_STATUS[team.status];
  const ss = SUPPORT_STATUS[team.supportStatus];
  const row = (label: string, value?: string) =>
    value && value.trim()
      ? (
        <div style={{ display: 'flex', gap: 8, fontSize: 11.5, lineHeight: 1.6 }}>
          <span style={{ flexShrink: 0, minWidth: 58, fontWeight: 800, color: C.faint }}>{label}</span>
          <span style={{ fontWeight: 700, color: C.text, wordBreak: 'keep-all' }}>{value}</span>
        </div>
      )
      : null;
  return (
    <div style={{ ...cardStyle, padding: 14, opacity: muted ? 0.92 : 1, borderColor: muted ? C.border : C.ivoryBorder, backgroundColor: muted ? C.card : C.ivory }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Users2 size={15} color={C.gold} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 900, color: C.text, wordBreak: 'keep-all' }}>
          {names.length > 0 ? names.join(' · ') : '파트너 정보 입력 대기'}
        </span>
        <Badge {...ts} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {row('출전 대회', team.tournamentName)}
        {row('출전 날짜', team.tournamentDate)}
        {row('목표 성적', team.targetResult)}
        {row('실제 결과', team.actualResult)}
        {row('비고', team.note)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
        <Gift size={13} color={C.faint} />
        <span style={{ fontSize: 11, fontWeight: 700, color: C.sub }}>참가비 지원</span>
        <span style={{ flex: 1 }} />
        <Badge {...ss} />
      </div>
    </div>
  );
}

function EmptyCard({ title, body, muted }: { title: string; body: string; muted?: boolean }) {
  return (
    <div style={{ ...cardStyle, padding: 20, textAlign: 'center', backgroundColor: muted ? C.card : C.ivory, borderColor: muted ? C.border : C.ivoryBorder }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: C.text }}>{title}</p>
      <p style={{ margin: '5px 0 0', fontSize: 11.5, fontWeight: 600, color: C.sub, lineHeight: 1.6 }}>{body}</p>
    </div>
  );
}

// ── 운영 방식 4단계 ───────────────────────────────────────────────────────────
const STEPS: { icon: React.ReactNode; title: string; desc: string }[] = [
  { icon: <Clover size={16} />, title: '파트너 선정', desc: '회원 중 2명을 무작위·제비뽑기로 파트너로 선정합니다.' },
  { icon: <Users2 size={16} />, title: '대회 협의', desc: '선정된 두 회원이 함께 출전할 대회를 직접 상의해 정합니다.' },
  { icon: <Target size={16} />, title: '목표 도전', desc: '회차·팀별로 정해진 목표 성적에 도전합니다.' },
  { icon: <Gift size={16} />, title: '참가비 지원', desc: '목표 성적을 달성하면 TEYEON에서 참가비를 지원합니다.' },
];

function LuckyVickyInner() {
  const router = useRouter();
  // DB 조회(회원 전용 RLS). 실패/미적용 → 빈 결과 폴백(service) → empty state. 화면 전체 깨짐 방지.
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<LuckyVickyRound | null>(null);
  const [past, setPast] = useState<LuckyVickyRound[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchLuckyVickyView()
      .then(({ active, past }) => { if (!cancelled) { setActive(active); setPast(past); } })
      .catch(() => { if (!cancelled) { setActive(null); setPast([]); } })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);
  const pastWithData = past.filter((r) => r.teams.length > 0);

  return (
    <main style={{ width: '100%', backgroundColor: '#F6F5F0', display: 'flex', flexDirection: 'column', alignItems: 'center', overflowX: 'clip' }}>
      <div style={{ width: '100%', maxWidth: 430, padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, paddingTop: 16 }}>
          <button type="button" onClick={() => router.push('/')} aria-label="메인으로"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.sub, flexShrink: 0, cursor: 'pointer' }}>
            <ChevronLeft size={19} />
          </button>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 800, letterSpacing: '0.18em', color: C.gold }}>TEYEON CLUB CULTURE</p>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: C.text, letterSpacing: '0.02em' }}>LUCKY VICKY</h1>
          </div>
        </div>

        {/* Hero */}
        <section style={{ ...cardStyle, padding: 18, backgroundColor: C.ivory, borderColor: C.ivoryBorder, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: C.goldBg, color: C.gold, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Clover size={20} />
            </span>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 9.5, fontWeight: 900, letterSpacing: '0.16em', color: C.gold }}>LUCKY VICKY</p>
              <p style={{ margin: '1px 0 0', fontSize: 15, fontWeight: 900, color: C.text }}>랜덤 파트너 대회 도전</p>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.sub, lineHeight: 1.65 }}>
            무작위로 선정된 파트너와 함께 대회에 도전하는 TEYEON만의 문화입니다.
          </p>
          {active && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start', padding: '7px 12px', borderRadius: 999, backgroundColor: C.card, border: `1px solid ${C.ivoryBorder}` }}>
              <Sparkles size={13} color={C.gold} />
              <span style={{ fontSize: 12, fontWeight: 800, color: C.text }}>
                <b style={{ color: C.goldText }}>{active.round}회차</b> 진행 중 · {roundTeamCount(active)}팀 출전 준비
              </span>
            </div>
          )}
        </section>

        {/* 러키비키 소개 (4단계) */}
        <section style={{ ...cardStyle, padding: 16 }}>
          <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 900, color: C.text, letterSpacing: '0.02em' }}>진행 방식</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                <span style={{ position: 'relative', width: 32, height: 32, borderRadius: 9, backgroundColor: C.goldBg, color: C.gold, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {s.icon}
                  <span style={{ position: 'absolute', right: -3, bottom: -3, width: 15, height: 15, borderRadius: '50%', backgroundColor: C.gold, color: '#fff', fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: C.text }}>{s.title}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 600, color: C.sub, lineHeight: 1.55, wordBreak: 'keep-all' }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {!loaded ? (
          <div style={{ ...cardStyle, padding: 20, textAlign: 'center', color: C.faint, fontSize: 12.5, fontWeight: 700 }}>불러오는 중…</div>
        ) : (
          <>
            {/* 현재 회차 */}
            {active && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '0 2px' }}>
                  <span style={{ fontSize: 20, fontWeight: 900, color: C.goldText }}>{active.round}회차</span>
                  <Badge label="진행 중" color="#0E7C76" bg={C.tealBg} />
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: C.sub }}>선정 {roundTeamCount(active)}팀</span>
                </div>
                {active.teams.length > 0 ? (
                  active.teams.map((t) => <TeamCard key={t.id} team={t} />)
                ) : (
                  <EmptyCard title="선정 팀 정보 입력 대기" body={active.note || '각 파트너가 출전할 대회를 협의 중입니다.'} />
                )}
              </section>
            )}

            {/* 지난 회차 History */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ margin: '4px 2px 0', fontSize: 12, fontWeight: 900, color: C.text }}>지난 회차</p>
              {pastWithData.length > 0 ? (
                pastWithData.map((r) => (
                  <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px' }}>
                      <span style={{ fontSize: 14, fontWeight: 900, color: C.sub }}>{r.title}</span>
                      <Badge label="종료" color="#475569" bg={C.slateBg} />
                    </div>
                    {r.teams.map((t) => <TeamCard key={t.id} team={t} muted />)}
                  </div>
                ))
              ) : (
                <EmptyCard title="지난 회차 기록을 정리 중입니다." body="1·2회차 기록이 입력되면 회차별로 표시됩니다." muted />
              )}
            </section>
          </>
        )}

        <div style={{ height: 'var(--page-bottom-safe, 88px)' }} aria-hidden />
      </div>
    </main>
  );
}

export default function LuckyVickyPage() {
  const router = useRouter();
  const access = useTennisLogAccess();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { if (access === 'unauthenticated') router.replace('/'); }, [access, router]);

  if (!mounted || access === 'loading') return null;
  if (access === 'unauthenticated') return null;

  // 게스트/비회원 → 회원 전용 안내 + 메인 복귀 (기존 TENNIS LOG 가드 패턴 재사용).
  if (access === 'locked') {
    return (
      <div style={{ width: '100%', maxWidth: 450, margin: '0 auto', padding: '0 16px', minHeight: '60dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 340, backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: '0 2px 14px rgba(0,0,0,0.05)', padding: '28px 22px 24px', textAlign: 'center', boxSizing: 'border-box' }}>
          <div style={{ width: 48, height: 48, margin: '0 auto', borderRadius: '50%', backgroundColor: 'rgba(100,116,139,0.10)', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Lock size={22} strokeWidth={2.2} />
          </div>
          <h1 style={{ margin: '14px 0 0', fontSize: 17, fontWeight: 900, color: C.text, wordBreak: 'keep-all' }}>TEYEON 회원 전용 콘텐츠</h1>
          <p style={{ margin: '10px 0 0', fontSize: 13, fontWeight: 600, color: C.sub, lineHeight: 1.6, wordBreak: 'keep-all' }}>
            러키비키는 TEYEON 회원 전용 클럽 문화 기록입니다. 게스트 계정은 이용할 수 없습니다.
          </p>
          <button type="button" onClick={() => router.replace('/')}
            style={{ marginTop: 20, width: '100%', height: 46, borderRadius: 12, border: 'none', backgroundColor: C.teal, color: '#FFFFFF', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
            메인으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return <LuckyVickyInner />;
}
