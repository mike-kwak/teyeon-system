'use client';

// TEYEON KDK FINAL REPORT — 공개 페이지 열람기(MAINT-002 · 회원 전용 순위).
//
//   보안 원칙
//     · 서버 렌더(HTML · RSC payload)에는 공개 뷰만 있다. 회원용 전체 리포트는 마운트 후 Bearer API(no-store)로만 받는다.
//     · 비로그인이면 요청하지 않는다. 열람 자격은 서버(DB auth.uid())가 판정하고, 비허용 응답에는 데이터가 없다.
//     · 받은 데이터는 메모리(state)에만 둔다(저장소 · 캐시 없음). 로그아웃 · 계정 변경 즉시 비우고 공개본으로 돌아간다.
//   UX
//     · 회원 안내는 한 곳(공개본 본문)에만. 비로그인 → 카카오 로그인(같은 리포트로 복귀), 이미 로그인한 비회원 → 로그인 안내 없음.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/context/AuthContext';
import FinalReportPublicEdition from './FinalReportPublicEdition';
import FinalReportStateCard from './FinalReportStateCard';
import type { ShareData } from '@/lib/kdk/finalReport/finalReportShare';
import type { FinalReportPublicPayload } from '@/lib/kdk/finalReport/finalReportModel';
import { parsePublicFinalReport } from '@/lib/kdk/finalReport/finalReportModel';
import { MEMBER_ONLY_NOTICE, type FinalReportPublicView } from '@/lib/kdk/finalReport/finalReportPublicView';
import type { OfficialResultSummary } from '@/lib/kdk/finalReportPublicService';
import { FRV, FRV_SERIF } from '@/lib/kdk/finalReport/finalReportView';

// 회원용 전체 매거진(기존 화면 그대로) — 회원 확인 뒤에만 불러온다.
const FinalReportMagazine = dynamic(() => import('./FinalReportMagazine'), { ssr: false });

export type ReaderInitial =
  | { kind: 'ok'; view: FinalReportPublicView }
  | { kind: 'corrected'; title: string; date: string };

type Access =
  | { kind: 'auth_loading' } | { kind: 'anon' } | { kind: 'checking' } | { kind: 'forbidden' } | { kind: 'not_available' } | { kind: 'error' }
  | { kind: 'member'; payload: FinalReportPublicPayload }
  | { kind: 'member_corrected'; title: string; date: string; official: OfficialResultSummary | null };

export const FR_MEMBER_API = '/api/kdk/final-report/member';

export default function FinalReportReader({ slug, initial, share, retryHref }: {
  slug: string; initial: ReaderInitial; share: ShareData | null; retryHref: string;
}) {
  const { session, isLoading, signInWithKakao } = useAuth();
  const token = session?.access_token ?? null;
  const uid = session?.user?.id ?? null;
  const [access, setAccess] = useState<Access>({ kind: 'auth_loading' });
  const reqId = useRef(0);

  const load = useCallback(async (t: string) => {
    const my = ++reqId.current;
    setAccess({ kind: 'checking' });
    try {
      const res = await fetch(`${FR_MEMBER_API}?slug=${encodeURIComponent(slug)}`, {
        method: 'GET', headers: { authorization: `Bearer ${t}` }, cache: 'no-store', credentials: 'omit',
      });
      const j = await res.json().catch(() => null);
      if (my !== reqId.current) return;
      if (res.status === 401) { setAccess({ kind: 'anon' }); return; }
      if (res.status === 403) { setAccess({ kind: 'forbidden' }); return; }
      if (res.status === 404 || res.status === 503) { setAccess({ kind: 'not_available' }); return; }
      if (!res.ok || j?.ok !== true) { setAccess({ kind: 'error' }); return; }
      if (j.state === 'corrected') {
        setAccess({ kind: 'member_corrected', title: String(j.title || ''), date: String(j.date || ''), official: j.official ?? null });
        return;
      }
      const payload = parsePublicFinalReport(j.payload);
      setAccess(payload ? { kind: 'member', payload } : { kind: 'error' });
    } catch {
      if (my === reqId.current) setAccess({ kind: 'error' });
    }
  }, [slug]);

  // 로그인 상태 · 사용자 변경 → 이전 회원 데이터 즉시 폐기 후 다시 판정
  useEffect(() => {
    reqId.current += 1;
    if (isLoading) { setAccess({ kind: 'auth_loading' }); return; }
    if (!token) { setAccess({ kind: 'anon' }); return; }
    void load(token);
  }, [token, uid, isLoading, load]);

  if (access.kind === 'member') {
    return <div data-fr-access="member"><FinalReportMagazine payload={access.payload} officialHref={null} reportSlug={slug} share={share} /></div>;
  }
  if (access.kind === 'member_corrected') {
    return <FinalReportStateCard kind="corrected" title={access.title} date={access.date} official={access.official} retryHref={retryHref} />;
  }

  const notice = <MemberNotice state={access.kind} onLogin={() => { void signInWithKakao(); }} onRetry={() => { if (token) void load(token); }} />;
  if (initial.kind === 'corrected') {
    return <FinalReportStateCard kind="corrected" title={initial.title} date={initial.date} retryHref={retryHref} publicOnly notice={<div style={{ marginTop: 14 }}>{notice}</div>} />;
  }
  return <FinalReportPublicEdition view={initial.view} share={share} notice={notice} />;
}

type NoticeState = 'auth_loading' | 'anon' | 'checking' | 'forbidden' | 'not_available' | 'error';
const SUB: Record<NoticeState, string | null> = {
  auth_loading: '회원 정보를 확인하고 있습니다.',
  checking: '회원 정보를 확인하고 있습니다.',
  anon: '로그인하면 이 리포트로 다시 돌아옵니다.',
  forbidden: '이 계정은 TEYEON 회원 계정으로 확인되지 않아 공개 리포트만 볼 수 있습니다.',
  not_available: '지금은 회원용 리포트를 열 수 없습니다. 잠시 후 다시 확인해 주세요.',
  error: '회원 정보를 불러오지 못했습니다.',
};

function MemberNotice({ state, onLogin, onRetry }: { state: NoticeState; onLogin: () => void; onRetry: () => void }) {
  return (
    <section data-fr="member-notice" data-member-state={state} aria-live="polite" style={{
      borderRadius: 18, background: FRV.surface, border: `1px solid ${FRV.line}`, borderTop: `3px solid ${FRV.gold}`,
      padding: '18px 18px 18px', boxShadow: '0 1px 2px rgba(18,35,58,0.05)',
    }}>
      <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.22em', color: FRV.goldInk }}>MEMBERS ONLY</p>
      <h2 style={{ margin: '6px 0 0', fontFamily: FRV_SERIF, fontSize: 21, fontWeight: 700, lineHeight: 1.25, color: FRV.ink }}>FINAL STANDINGS</h2>
      <p style={{ margin: '10px 0 0', fontSize: 14.5, fontWeight: 700, lineHeight: 1.6, color: FRV.ink, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{MEMBER_ONLY_NOTICE}</p>
      {SUB[state] && (
        <p data-fr="member-notice-sub" style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 600, lineHeight: 1.55, color: FRV.sub, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{SUB[state]}</p>
      )}
      {state === 'anon' && (
        <button type="button" data-fr="member-login" onClick={onLogin} style={{
          marginTop: 14, width: '100%', minHeight: 48, borderRadius: 13, border: 'none', cursor: 'pointer',
          background: '#FEE500', color: '#191600', fontSize: 14.5, fontWeight: 900,
        }}>카카오로 로그인</button>
      )}
      {state === 'error' && (
        <button type="button" data-fr="member-retry" onClick={onRetry} style={{
          marginTop: 14, width: '100%', minHeight: 46, borderRadius: 13, cursor: 'pointer',
          background: FRV.surface, color: FRV.ink, border: `1px solid ${FRV.line}`, fontSize: 14, fontWeight: 900,
        }}>다시 시도</button>
      )}
    </section>
  );
}
