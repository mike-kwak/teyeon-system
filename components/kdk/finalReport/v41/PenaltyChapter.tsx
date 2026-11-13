'use client';

// TEYEON FINAL REPORT V4.1 — 07 PENALTY SETTLEMENT(회원 전용 · 발행 시점 스냅샷 · 읽기 전용).
//
//   보안 원칙
//     · 공개본 · HTML 초기 데이터에는 정산이 없다. 이 장은 "로그인 세션이 있고 + 이 장이 화면에 열렸을 때"만 서버에 요청한다.
//     · 비로그인 · 운영진 미리보기(slug 없음)는 요청 자체를 하지 않는다(잠금 안내만 · CSS 로 숨기는 방식 아님).
//     · 열람 자격은 서버(DB auth.uid())가 판정한다. 비허용 응답에는 데이터가 없다.
//     · 받은 데이터는 메모리에만 둔다(저장소 · 캐시 없음). 로그아웃 · 사용자 변경 즉시 비운다.
//     · 조회 실패 · 형식 오류는 '불러오지 못함'으로만 표시한다(0원 · 전원 완납 표시 금지).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  SETTLEMENT_STATUS_LABEL, parseSettlementSnapshot, settlementNoteLabel, type SettlementSnapshot,
} from '@/lib/kdk/finalReport/v41/settlementSnapshot';

const C = { navy: '#0B2340', teal: '#0E8A9C', gold: '#C9A955', sub: '#5B6B79', muted: '#7A8A98', line: '#EEF2F5', ink: '#33434F' };
const LOGO = '/logos/teyeon-logo-transparent.png';
const won = (n: number): string => `${n.toLocaleString('ko-KR')}원`;
const CHIP: Record<string, [string, string]> = { PAID: ['#2E7D62', '#E3F4EE'], UNPAID: ['#8A5A12', '#FBF1DE'], PENDING: ['#3D6FA8', '#EAF1F9'], REVIEW: ['#5B6B79', '#EEF2F5'] };

type View =
  | { kind: 'preview' } | { kind: 'auth_loading' } | { kind: 'public' } | { kind: 'loading' } | { kind: 'forbidden' }
  | { kind: 'not_available' } | { kind: 'error' } | { kind: 'ok'; snapshot: SettlementSnapshot; capturedAt: string | null };

export default function PenaltyChapter({ no, slug, active, sessionDate }: { no: number; slug: string | null; active: boolean; sessionDate: string }) {
  const { session, isLoading, signInWithKakao } = useAuth();
  const token = session?.access_token ?? null;
  const uid = session?.user?.id ?? null;
  const [view, setView] = useState<View>({ kind: slug ? 'auth_loading' : 'preview' });
  const reqId = useRef(0);

  const load = useCallback(async () => {
    if (!slug || !token) return;
    const my = ++reqId.current;
    setView({ kind: 'loading' });
    try {
      const res = await fetch(`/api/kdk/final-report/settlement?slug=${encodeURIComponent(slug)}`, {
        method: 'GET', headers: { authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit',
      });
      const j = await res.json().catch(() => null);
      if (my !== reqId.current) return;
      if (res.status === 401) { setView({ kind: 'public' }); return; }
      if (res.status === 403) { setView({ kind: 'forbidden' }); return; }
      if (res.status === 404) { setView({ kind: 'not_available' }); return; }
      const snap = res.ok && j?.ok === true ? parseSettlementSnapshot(j.snapshot) : null;
      if (!snap) { setView({ kind: 'error' }); return; }
      setView({ kind: 'ok', snapshot: snap, capturedAt: typeof j.capturedAt === 'string' ? j.capturedAt : null });
    } catch {
      if (my === reqId.current) setView({ kind: 'error' });
    }
  }, [slug, token]);

  // 로그인 상태 · 사용자 변경 → 이전 데이터 즉시 폐기
  useEffect(() => {
    reqId.current += 1;
    if (!slug) { setView({ kind: 'preview' }); return; }
    if (isLoading) { setView({ kind: 'auth_loading' }); return; }
    if (!token) { setView({ kind: 'public' }); return; }
    setView({ kind: 'auth_loading' });
  }, [slug, token, uid, isLoading]);
  // 장이 열렸을 때만 요청
  useEffect(() => {
    if (active && token && slug && view.kind === 'auth_loading' && !isLoading) void load();
  }, [active, token, slug, view.kind, isLoading, load]);

  const login = () => {
    try { const u = new URL(window.location.href); u.searchParams.set('ch', 'penalty'); window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}`); } catch { /* ignore */ }
    void signInWithKakao();
  };

  const mode = view.kind === 'ok' ? 'MEMBER · 조회 전용' : view.kind === 'forbidden' ? 'NO ACCESS' : 'MEMBERS ONLY';
  return (
    <div data-v41="penalty" data-penalty-state={view.kind} style={{ position: 'absolute', inset: 0, background: '#FFFFFF', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', padding: 'calc(env(safe-area-inset-top, 0px) + 7cqh) 6cqw 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2cqw' }}>
        {/* 장 제목 · 상태 배지 한 줄(Pretendard 폭 고려: 크기 · 자간 축소, 줄바꿈 없음) */}
        <div style={{ fontSize: '2.8cqw', fontWeight: 700, letterSpacing: '0.16em', color: C.sub, whiteSpace: 'nowrap' }}>{String(no).padStart(2, '0')} · PENALTY SETTLEMENT</div>
        <div style={{ fontSize: '2.5cqw', fontWeight: 700, padding: '2px 5px', borderRadius: 2, whiteSpace: 'nowrap', flex: 'none',
          color: view.kind === 'ok' ? '#FFFFFF' : C.navy, background: view.kind === 'ok' ? C.teal : '#EEF2F5' }}>{mode}</div>
      </div>
      {view.kind === 'ok' ? <Open snap={view.snapshot} capturedAt={view.capturedAt} sessionDate={sessionDate} />
        : view.kind === 'error' ? <Failure onRetry={() => { setView({ kind: 'auth_loading' }); }} />
        : <Locked view={view.kind} onLogin={login} />}
    </div>
  );
}

function Locked({ view, onLogin }: { view: View['kind']; onLogin: () => void }) {
  const note = {
    preview: '발행 후 TEYEON 회원에게만 발행 시점 정산 현황이 표시됩니다. 미리보기에는 정산 정보를 불러오지 않습니다.',
    auth_loading: '회원 정보를 확인하고 있습니다.',
    loading: '회원 자격을 확인하고 있습니다.',
    public: '로그인 후 회원 자격이 확인되면 이 페이지에서 볼 수 있습니다.',
    forbidden: '로그인했지만 TEYEON 회원 자격을 확인할 수 없습니다. 재무 담당 운영진에게 문의해 주세요.',
    not_available: '이 리포트에는 표시할 회원 정산 정보가 없습니다.',
  }[view as 'preview'] ?? '';
  return (
    <div data-v41="penalty-locked" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '2cqh 8cqw calc(76px + env(safe-area-inset-bottom, 0px))' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO} alt="Team TEYEON" style={{ width: '16cqw', height: '16cqw', objectFit: 'contain', display: 'block' }} />
      <div style={{ marginTop: '3cqh', fontSize: '3.4cqw', fontWeight: 700, letterSpacing: '0.34em', color: C.teal }}>MEMBERS ONLY</div>
      <div style={{ marginTop: '1.2cqh', fontSize: '9.4cqw', fontWeight: 800, color: C.navy, lineHeight: 1.15, wordBreak: 'keep-all' }}>회원 전용<br />정산 현황</div>
      <div style={{ marginTop: '2.2cqh', width: '12cqw', height: 3, background: C.gold }} />
      <div style={{ marginTop: '2.2cqh', fontSize: '4cqw', color: C.ink, lineHeight: 1.6, wordBreak: 'keep-all' }}>벌금 납부 현황은 TEYEON 회원만 확인할 수 있습니다.</div>
      <div data-v41="penalty-note" style={{ marginTop: '1cqh', fontSize: '3.4cqw', color: C.muted, lineHeight: 1.6, wordBreak: 'keep-all' }}>{note}</div>
      {view === 'public' && (
        <button type="button" data-v41="penalty-login" onClick={onLogin} style={{ marginTop: '3cqh', height: '13cqw', maxHeight: 52, minHeight: 44, background: C.navy, color: '#FFFFFF', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '4cqw', fontWeight: 700, borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>TEYEON 회원 로그인</button>
      )}
    </div>
  );
}

function Failure({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-v41="penalty-error" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4cqh 6cqw calc(84px + env(safe-area-inset-bottom, 0px))' }}>
      <div style={{ fontSize: '8cqw', fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>KDK 벌금 납부 현황</div>
      <div style={{ marginTop: '2cqh', padding: '2.4cqh 4cqw', background: '#FBF1DE', borderRadius: 4 }}>
        <div style={{ fontSize: '4.2cqw', fontWeight: 700, color: '#8A5A12' }}>납부 현황을 불러오지 못했습니다.</div>
        <div style={{ marginTop: '0.8cqh', fontSize: '3.4cqw', color: C.sub, lineHeight: 1.55, wordBreak: 'keep-all' }}>일시적인 문제일 수 있습니다. 이 화면은 &quot;미납 없음&quot;이나 &quot;전원 납부 완료&quot;를 뜻하지 않습니다.</div>
        <button type="button" data-v41="penalty-retry" onClick={onRetry} style={{ marginTop: '1.4cqh', padding: '8px 14px', border: '1px solid #D9B98A', background: 'transparent', color: '#8A5A12', fontSize: '3.4cqw', fontWeight: 700, borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit' }}>다시 시도</button>
      </div>
    </div>
  );
}

function Open({ snap, capturedAt, sessionDate }: { snap: SettlementSnapshot; capturedAt: string | null; sessionDate: string }) {
  const when = capturedAt ? new Date(capturedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }) : '';
  const t = snap.totals; const c = snap.counts;
  const pct = (n: number) => (t.charged ? `${((n / t.charged) * 100).toFixed(1)}%` : '0%');
  // 날짜 띠: 실제로 확인되는 날짜만(공식 경기일 · 정산 스냅샷 저장 시각 = 리포트 발행). 재무 확인 기준일은 데이터가 없어 표시하지 않는다.
  const dates = [
    /^\d{4}-\d{2}-\d{2}$/.test(sessionDate) ? { l: '경기일', v: sessionDate.slice(5).replace('-', '.') } : null,
    when ? { l: '정산 기준(리포트 발행)', v: when.replace(/\.\s?/g, '.').replace(/\.$/, '').replace(/\.(\d{2}:)/, ' $1') } : null,
  ].filter((x): x is { l: string; v: string } => !!x);
  return (
    <div data-vscroll="1" data-v41="penalty-open" style={{ flex: 1, minHeight: 0, overflowY: 'auto', touchAction: 'pan-y', padding: '1cqh 6cqw calc(84px + env(safe-area-inset-bottom, 0px))' }}>
      <div style={{ fontSize: '8cqw', fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>KDK 벌금 납부 현황</div>
      {dates.length > 0 && (
        <div data-v41="penalty-dates" style={{ marginTop: '1.6cqh', display: 'grid', gridTemplateColumns: `repeat(${dates.length}, minmax(0,1fr))`, borderTop: '1px solid #E3E9EF', borderBottom: '1px solid #E3E9EF' }}>
          {dates.map((d, i) => (
            <div key={d.l} style={{ padding: '1.2cqh 0 1.2cqh 2cqw', borderLeft: i ? `1px solid ${C.line}` : 'none' }}>
              <div style={{ fontSize: '2.7cqw', color: C.muted, wordBreak: 'keep-all' }}>{d.l}</div>
              <div style={{ marginTop: '0.4cqh', fontSize: '3.2cqw', fontWeight: 700, color: C.navy, fontVariantNumeric: 'tabular-nums' }}>{d.v}</div>
            </div>
          ))}
        </div>
      )}
      {snap.mode === 'legacy_closed' && (
        <Banner data="legacy" bg="#E3F4EE" color="#2E7D62" text="이 회차 벌금은 재무 담당 운영진이 수납을 완료했습니다(운영 확인). 개인별 납부 기록은 이 리포트에 제공하지 않습니다." />
      )}
      {snap.mode === 'unconfigured' && <Banner data="unconfigured" bg="#EEF2F5" color="#33434F" text="이 회차는 정산 공개 기준이 아직 설정되지 않아 금액과 명단을 표시하지 않습니다. 미납이나 완납을 뜻하지 않습니다." />}
      {snap.mode === 'not_ready' &&<Banner data="not-ready" bg="#EAF1F9" color="#2F5B8C" text="발행 시점에 공식 정산이 확정되지 않았습니다. 정산 금액이 없다는 뜻이 아닙니다." />}
      {snap.mode === 'none' && (
        <div data-v41="penalty-none" style={{ padding: '6cqh 0', textAlign: 'center' }}>
          <div style={{ fontSize: '6cqw', fontWeight: 800, color: C.navy, wordBreak: 'keep-all' }}>이번 KDK 벌금 대상자가 없습니다.</div>
          <div style={{ marginTop: '1cqh', fontSize: '3.6cqw', color: C.muted }}>공식 정산 기준</div>
        </div>
      )}
      {snap.mode === 'live' && (
        <>
          {c.unpaid === 0 && c.pending === 0 && c.review === 0 && c.paid > 0 && <Banner data="allpaid" bg="#E3F4EE" color="#2E7D62" text="전원 납부 완료 · 함께해 주셔서 감사합니다." />}
          {c.pending > 0 && <Banner data="progress" bg="#EAF1F9" color="#2F5B8C" text="재무 확인 중인 항목이 있습니다. 확인 중 금액은 미납이 아닙니다." />}
          <div data-v41="penalty-amounts" style={{ marginTop: '1.4cqh', display: 'flex', flexDirection: 'column' }}>
            {[{ l: '총 청구', v: t.charged, color: C.navy, dot: C.navy, fs: '7cqw' }, { l: '납부 완료', v: t.paid, color: '#2E7D62', dot: '#5FB79A', fs: '5.2cqw' },
              { l: '확인 중', v: t.pending, color: t.pending ? '#3D6FA8' : '#A3B0BB', dot: '#8DB0D6', fs: '5.2cqw' }, { l: '미납 확정', v: t.unpaid, color: t.unpaid ? '#8A5A12' : '#A3B0BB', dot: '#E1B868', fs: '5.2cqw' }].map((a) => (
              <div key={a.l} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '3cqw', padding: '1.3cqh 0', borderBottom: `1px solid ${C.line}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2cqw', fontSize: '3.8cqw', color: C.sub }}><span style={{ width: '2.2cqw', height: '2.2cqw', borderRadius: '50%', background: a.dot }} />{a.l}</div>
                <div style={{ fontSize: a.fs, fontWeight: 800, color: a.color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{won(a.v)}</div>
              </div>
            ))}
          </div>
          <div aria-hidden style={{ marginTop: '1.8cqh', height: 7, display: 'flex', gap: 2, borderRadius: 3, overflow: 'hidden', background: C.line }}>
            <div style={{ width: pct(t.paid), background: '#5FB79A' }} /><div style={{ width: pct(t.pending), background: '#8DB0D6' }} /><div style={{ width: pct(t.unpaid), background: '#E1B868' }} />
          </div>
          <div data-v41="penalty-counts" style={{ marginTop: '1.4cqh', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
            {[['대상', c.targets], ['완료', c.paid], ['확인 중', c.pending], ['미납 확정', c.unpaid]].map(([l, n]) => (
              <div key={l as string}><div style={{ fontSize: '5.6cqw', fontWeight: 800, color: C.navy, fontVariantNumeric: 'tabular-nums' }}>{n}명</div><div style={{ fontSize: '2.9cqw', color: C.muted }}>{l}</div></div>
            ))}
          </div>
          {c.review > 0 && <div data-v41="penalty-review" style={{ marginTop: '1.2cqh', fontSize: '3.2cqw', color: C.sub, lineHeight: 1.5 }}>기록 확인이 필요한 {c.review}건은 금액 집계에서 제외했습니다.</div>}
          <div style={{ marginTop: '3cqh', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: '3cqw', fontWeight: 700, letterSpacing: '0.22em', color: C.teal }}>MEMBER DETAIL</div>
            <div style={{ fontSize: '2.9cqw', color: C.muted }}>{snap.rows.length}명 · 조회 전용</div>
          </div>
          <div style={{ marginTop: '1cqh', display: 'flex', fontSize: '2.9cqw', fontWeight: 700, color: C.muted, paddingBottom: '0.8cqh', borderBottom: `2px solid ${C.navy}` }}>
            <div style={{ flex: 1 }}>이름</div><div style={{ width: '22cqw', textAlign: 'right' }}>벌금</div><div style={{ width: '25cqw', textAlign: 'right' }}>상태</div>
          </div>
          {snap.rows.map((r, i) => {
            const [fg, bg] = CHIP[r.status];
            const note = settlementNoteLabel(r);
            return (
              <div key={i} data-v41="penalty-row" data-status={r.status} style={{ minHeight: '11cqw', display: 'flex', alignItems: 'center', borderBottom: `1px solid ${C.line}`, gap: '1cqw' }}>
                <div style={{ flex: 1, minWidth: 0, padding: '0.8cqh 0' }}>
                  <div style={{ fontSize: '4.1cqw', fontWeight: 600, color: C.navy, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{r.name}</div>
                  {note && <div style={{ fontSize: '2.9cqw', color: C.muted, marginTop: 2 }}>{note}</div>}
                </div>
                <div style={{ width: '22cqw', textAlign: 'right', fontSize: '4cqw', fontWeight: 700, color: C.navy, fontVariantNumeric: 'tabular-nums' }}>{r.status === 'REVIEW' ? '—' : won(r.charged)}</div>
                <div style={{ width: '25cqw', display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ fontSize: '3cqw', fontWeight: 700, color: fg, background: bg, padding: '3px 6px', borderRadius: 2, whiteSpace: 'nowrap' }}>{SETTLEMENT_STATUS_LABEL[r.status]}</div>
                </div>
              </div>
            );
          })}
        </>
      )}
      <div data-v41="penalty-snapshot-note" style={{ marginTop: '2cqh', padding: '1.6cqh 3cqw', background: '#F7F9FB', borderRadius: 3, fontSize: '3.2cqw', color: C.sub, lineHeight: 1.6, wordBreak: 'keep-all' }}>
        이 정산표는 리포트 발행 시점{when ? `(${when})` : ''}의 스냅샷입니다. 이후 변경은 최신 Finance 화면에서 확인할 수 있습니다.
        <a href="/finance" style={{ display: 'block', marginTop: '0.8cqh', fontWeight: 700, color: C.teal }}>최신 Finance 현황 보기 →</a>
      </div>
    </div>
  );
}

function Banner({ bg, color, text, data }: { bg: string; color: string; text: string; data: string }) {
  return <div data-v41={`penalty-banner-${data}`} style={{ marginTop: '2cqh', padding: '1.4cqh 3cqw', background: bg, color, fontSize: '3.6cqw', fontWeight: 700, lineHeight: 1.5, borderRadius: 3, wordBreak: 'keep-all' }}>{text}</div>;
}
