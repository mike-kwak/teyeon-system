'use client';

// MATCH SPOTLIGHT — /kdk 화면용 두 부분.
//   · KdkSpotlightEntry(기본 export): LIVE 대진표 상단 TODAY'S SPOTLIGHT 배너(누구나). 공개(published) 상태일 때만 노출.
//     조회는 anon 공개 RPC(get_public_kdk_spotlight_link) — slug 만 받는다.
//   · KdkSpotlightManager: [세션 관리] 모달 안의 MATCH SPOTLIGHT 화면(CEO·ADMIN·KDK 관리자).
//     생성 → 미리보기(draft) → 공개 / 비공개 · 공유 문구 및 링크 복사. 쓰기는 서버 route(권한 재검증).
//     자체 오버레이 없음(세션 관리 모달 본문에 그대로 렌더 → 중첩 모달 없음). 변경 시 배너에 이벤트로 알린다.
//   · SQL 미적용 환경: 배너는 조용히 숨김, 관리 화면은 "SQL 미적용" 안내만.
//   · KDK 경기 진행 로직·Realtime 과 무관(독립 조회 · 실패해도 대진표 영향 없음).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Sparkles, ChevronRight, ChevronLeft, Copy, Check, RefreshCw, Image as ImageIcon, MessageSquareQuote } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import SpotlightView from './SpotlightView';
import dynamic from 'next/dynamic';
import { REASON_TEXT, spotlightFailText } from './spotlightMessages';
import { copyText, postSpotlightAction } from './spotlightClientApi';
import { buildSpotlightShareText, parsePublicSpotlightPayload, type PublicSpotlightPayload } from '@/lib/kdk/analytics/publicSpotlight';
import { operatorInputFromPayload, sameOperatorInput, type OperatorInput } from '@/lib/kdk/analytics/spotlightOperator';
import { fetchPublicSpotlight, spotlightPublicPath, spotlightPublicUrl } from '@/lib/kdk/spotlightPublicService';

type AdminRun = {
  id: string; status: 'draft' | 'published' | 'unpublished'; revision: number; public_slug: string;
  generated_at: string; published_at: string | null; payload: PublicSpotlightPayload | null;
};

export { spotlightFailText };

// 운영진 편집 · 공유 이미지(Canvas)는 열 때만 불러온다 — KDK LIVE 화면(현장 휴대폰) 첫 로딩에 싣지 않는다.
const LoadingNote = () => <div style={{ fontSize: 12.5, fontWeight: 700, color: '#5B6B80' }}>불러오는 중…</div>;
const SpotlightOperatorEditor = dynamic(() => import('./SpotlightOperatorEditor'), { ssr: false, loading: LoadingNote });
const SpotlightPosterPanel = dynamic(() => import('./SpotlightPosterPanel'), { ssr: false, loading: LoadingNote });

const sumCounts = (o: unknown): number =>
  o && typeof o === 'object' ? Object.values(o as Record<string, unknown>).reduce<number>((s, v) => s + (Number(v) || 0), 0) : 0;

// 배너 ↔ 관리 화면 동기화(같은 페이지 안 · 공개/비공개 직후 배너 갱신).
const CHANGED_EVENT = 'teyeon:kdk-spotlight-changed';

const fmtTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const hasOperator = (i: OperatorInput): boolean => i.points.length > 0 || !!i.pick;
/** 공개본과 같은 운영진 입력인가(공개본엔 PICK 교체 대상이 남지 않으므로 경기 번호만 비교). */
const sameAsPublished = (a: OperatorInput, published: OperatorInput): boolean =>
  sameOperatorInput({ points: a.points, pick: a.pick ? { matchNo: a.pick.matchNo, replace: null } : null }, published);

export default function KdkSpotlightEntry({ sessionId }: { sessionId: string | null }) {
  const [link, setLink] = useState<{ slug: string; count: number } | null>(null);

  const loadLink = useCallback(async () => {
    if (!sessionId) { setLink(null); return; }
    try {
      const { data, error } = await supabase.rpc('get_public_kdk_spotlight_link', { p_session_id: sessionId });
      if (error || !data || (data as any).ok !== true) { setLink(null); return; }
      setLink({ slug: String((data as any).public_slug), count: Number((data as any).item_count) || 0 });
    } catch { setLink(null); }
  }, [sessionId]);
  useEffect(() => { void loadLink(); }, [loadLink]);
  useEffect(() => {
    const h = () => { void loadLink(); };
    window.addEventListener(CHANGED_EVENT, h);
    return () => window.removeEventListener(CHANGED_EVENT, h);
  }, [loadLink]);

  if (!sessionId || !link) return null;

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Link href={spotlightPublicPath(link.slug)} aria-label="오늘의 주목 경기 보기"
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 16, textDecoration: 'none', background: 'linear-gradient(100deg, #0F2747 0%, #17375F 70%, #1E4A7A 100%)', boxShadow: '0 6px 18px rgba(15,39,71,0.18)' }}>
          <span aria-hidden style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(233,216,166,0.16)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Sparkles size={18} color="#E9D8A6" />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 900, letterSpacing: '0.16em', color: '#E9D8A6' }}>TODAY&apos;S SPOTLIGHT</span>
            <span style={{ display: 'block', fontSize: 14.5, fontWeight: 900, color: '#FFFFFF', overflowWrap: 'anywhere', wordBreak: 'keep-all' }}>
              오늘의 주목 경기{link.count > 0 ? ` ${link.count}선` : ''}
            </span>
          </span>
          <ChevronRight size={18} color="#FFFFFF" style={{ flexShrink: 0 }} aria-hidden />
      </Link>
    </div>
  );
}

/** [세션 관리] 모달 본문에 렌더되는 MATCH SPOTLIGHT 관리 화면(오버레이 없음 · 스크롤은 모달 본문이 담당). */
export function KdkSpotlightManager({ sessionId }: { sessionId: string }) {
  const onChanged = useCallback(() => {
    try { window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { sessionId } })); } catch { /* 배너 갱신 실패는 무시 */ }
  }, [sessionId]);
  const [runs, setRuns] = useState<AdminRun[] | null>(null);
  const [ledgerHealthy, setLedgerHealthy] = useState(true);
  const [sqlMissing, setSqlMissing] = useState(false);
  const [busy, setBusy] = useState<null | 'generate' | 'publish' | 'unpublish'>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 관리 화면 안 하위 화면(중첩 모달 없이 전환): 기본 · 운영진 관전 포인트 · 공유 이미지
  const [view, setView] = useState<'main' | 'operator' | 'poster'>('main');
  // 운영진이 "적용"한 입력(공개 · 재공개 때 서버로 보냄) + 그 입력의 서버 미리보기
  const [opInput, setOpInput] = useState<OperatorInput>({ points: [], pick: null });
  const [opPreview, setOpPreview] = useState<PublicSpotlightPayload | null>(null);
  const initRunId = useRef<string | null | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_kdk_spotlight_admin', { p_session_id: sessionId });
      if (error) {
        if (error.code === 'PGRST202' || error.code === '42883') setSqlMissing(true);
        else setMsg(REASON_TEXT[error.code === '42501' ? 'forbidden' : 'db_unavailable']);
        setRuns([]);
        return;
      }
      const d = (data || {}) as any;
      setLedgerHealthy(d.ledger_healthy !== false);
      setRuns((Array.isArray(d.runs) ? d.runs : []).map((r: any) => ({
        id: String(r.id), status: r.status, revision: Number(r.revision) || 0, public_slug: String(r.public_slug || ''),
        generated_at: String(r.generated_at || ''), published_at: r.published_at || null,
        payload: parsePublicSpotlightPayload(r.public_payload),
      })));
    } catch { setRuns([]); setMsg(REASON_TEXT.db_unavailable); }
  }, [sessionId]);
  useEffect(() => { void reload(); }, [reload]);

  const call = async (kind: 'generate' | 'publish' | 'unpublish', body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(kind); setMsg(null); setCopied(false);
    try {
      const res = await postSpotlightAction(body);
      const j = res.j;
      if (!res.ok) {
        setMsg(spotlightFailText(j, res.status));
      } else if (kind === 'generate') {
        setOpPreview(null);   // 새 회차 — 운영진 입력은 유지하되 미리보기는 다시 확인
        const blocked = sumCounts(j.blocked);
        setMsg(`생성 완료 — 분석 ${j.predicted}경기 · 주목 ${j.selected}경기${j.shortfall ? ' (기준 충족 경기가 적어 3개 미만)' : ''}`
          + `${blocked ? ` · 시작 전 증명 불가 ${blocked}경기 제외` : ''}. 미리보기를 확인한 뒤 공개하세요.`);
      } else if (kind === 'publish') {
        const extra = [j.invalidated ? `선수 변경 ${j.invalidated}경기 제외` : '', j.droppedForPrivacy ? `비공개 회원 ${j.droppedForPrivacy}경기 제외` : ''].filter(Boolean).join(' · ');
        setMsg(`${body.republish ? '변경 내용으로 다시 공개했습니다(같은 링크)' : '공개되었습니다'}${extra ? ` (${extra})` : ''}.`);
        setOpPreview(null);
      } else {
        setMsg('비공개로 전환했습니다.');
      }
      await reload();
      onChanged();
    } catch {
      setMsg(REASON_TEXT.db_unavailable);
    } finally {
      setBusy(null);
    }
  };

  const latest = runs?.[0] || null;
  const published = runs?.find((r) => r.status === 'published') || null;
  const canPublish = !!latest && (latest.status === 'draft' || latest.status === 'unpublished');
  const publishedInput = published?.payload ? operatorInputFromPayload(published.payload) : { points: [], pick: null };
  // 공개 중인 최신 회차의 운영진 입력과 지금 적용한 입력이 다르면 → 같은 회차 재공개(링크 유지)
  const canRepublish = !!latest && !!published && latest.id === published.id && !sameAsPublished(opInput, publishedInput);
  const preview = opPreview && latest?.status !== 'published' ? opPreview
    : opPreview && canRepublish ? opPreview
      : latest?.payload || null;

  // 운영진 입력은 회차 단위 — 최신 회차가 바뀔 때마다 그 회차의 저장 payload 에서 복원한다.
  //   공개 중 · 비공개 전환된 회차 = 마지막 공개본의 관전 포인트 · PICK 그대로(미리보기 = 공개 요청 일치),
  //   새로 생성한 draft = 운영진 필드 없음 → 빈 입력(이전 회차 입력이 따라오지 않는다).
  useEffect(() => {
    if (runs === null) return;
    const id = latest?.id ?? null;
    if (initRunId.current === id) return;
    initRunId.current = id;
    setOpInput(latest?.payload ? operatorInputFromPayload(latest.payload) : { points: [], pick: null });
    setOpPreview(null);
  }, [runs, latest]);

  const publishBody = (republish: boolean, input: OperatorInput): Record<string, unknown> => ({
    action: 'publish', runId: latest?.id, ...(hasOperator(input) || republish ? { operator: input } : {}), ...(republish ? { republish: true } : {}),
  });
  // 공개본에서 복원한 PICK 은 교체 대상(자동 TOP 의 어느 경기)이 남지 않는다 → 공개 직전에 자동 TOP(서버 미리보기)과
  // 복원 원본(이 회차의 저장 payload)을 비교해 빠진 경기를 교체 대상으로 채운다. 못 찾으면 그대로(서버가 판정 · 안내).
  const withPickReplace = async (input: OperatorInput): Promise<OperatorInput> => {
    if (!input.pick || input.pick.replace != null || !latest) return input;
    try {
      const r = await postSpotlightAction({ action: 'preview', runId: latest.id });
      const base = r.ok ? parsePublicSpotlightPayload(r.j.payload) : null;
      if (!base || base.items.length < 5) return input;
      const kept = new Set((latest.payload?.items || []).map((i) => i.matchNo));
      const replaced = base.items.find((i) => !kept.has(i.matchNo));
      return replaced ? { ...input, pick: { matchNo: input.pick.matchNo, replace: replaced.matchNo } } : input;
    } catch { return input; }
  };
  const doPublish = async (republish: boolean) => {
    if (busy || !latest) return;
    const input = await withPickReplace(opInput);
    if (input !== opInput) setOpInput(input);
    await call('publish', publishBody(republish, input));
  };

  // 공유 문구 = 공개 페이지 · 공유 이미지와 같은 공개 조회(get_public_kdk_spotlight) 결과로 만든다.
  //   운영진 미리보기(관리자 RPC 의 저장 payload)는 쓰지 않는다 → 공개 후 선수가 바뀐 경기는 공개 페이지처럼 빠진다.
  //   공개 해제 · 조회 실패면 복사하지 않는다(오래된 문구 공유 금지).
  const [copying, setCopying] = useState(false);
  const copyShare = async () => {
    if (!published || copying) return;
    setCopying(true); setCopied(false); setMsg(null);
    try {
      const r = await fetchPublicSpotlight(published.public_slug);
      if (r.state !== 'ok') {
        setMsg(r.state === 'not_found'
          ? '지금 공개 중인 SPOTLIGHT 가 없어 공유 문구를 복사하지 않았습니다(비공개 전환됨).'
          : '공개 데이터를 불러오지 못해 공유 문구를 복사하지 않았습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      const ok = await copyText(buildSpotlightShareText(r.payload, spotlightPublicUrl(published.public_slug)));
      setCopied(ok);
      if (!ok) setMsg('복사하지 못했습니다. 브라우저 권한을 확인해 주세요.');
    } catch {
      setMsg('공개 데이터를 불러오지 못해 공유 문구를 복사하지 않았습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setCopying(false);
    }
  };

  const btn = (label: React.ReactNode, onClick: () => void, opts: { primary?: boolean; disabled?: boolean } = {}) => (
    <button type="button" onClick={onClick} disabled={opts.disabled || !!busy}
      style={{ flex: '1 1 0', minWidth: 0, height: 42, borderRadius: 12, fontSize: 13, fontWeight: 900, cursor: opts.disabled || busy ? 'not-allowed' : 'pointer',
        border: opts.primary ? 'none' : '1px solid #C9D9EC', background: opts.disabled ? '#EEF2F7' : opts.primary ? '#0F2747' : '#FFFFFF',
        color: opts.disabled ? '#94A3B8' : opts.primary ? '#FFFFFF' : '#0F2747', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      {label}
    </button>
  );

  const backRow = (title: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <button type="button" onClick={() => setView('main')} aria-label="SPOTLIGHT 관리로 돌아가기"
        style={{ flexShrink: 0, minHeight: 40, padding: '0 12px 0 8px', borderRadius: 999, border: '1px solid #C9D9EC', background: '#FFFFFF', color: '#0F2747',
          fontSize: 12.5, fontWeight: 900, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <ChevronLeft size={16} aria-hidden /> SPOTLIGHT 관리
      </button>
      <span style={{ fontSize: 13.5, fontWeight: 900, color: '#0F2747', minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'keep-all' }}>{title}</span>
    </div>
  );

  if (!sqlMissing && view === 'operator' && latest) {
    return (
      <section aria-label="SPOTLIGHT 관리" data-spotlight-manager="" data-view="operator" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        {backRow('운영진 관전 포인트 · PICK')}
        <SpotlightOperatorEditor
          sessionId={sessionId} runId={latest.id} initial={opInput}
          publishedPayload={published?.payload || null}
          onApply={(input, p) => {
            setOpInput(input); setOpPreview(p); setView('main');
            setMsg(hasOperator(input)
              ? `운영진 관전 포인트 ${input.points.length}개${input.pick ? ' · 운영진 PICK 1경기' : ''}를 적용했습니다. ${latest.status === 'published' ? '"변경 내용으로 재공개"' : '"공개"'}를 누르면 반영됩니다.`
              : '운영진 입력을 모두 비웠습니다. 자동 분석 그대로 공개됩니다.');
          }}
        />
      </section>
    );
  }
  if (!sqlMissing && view === 'poster' && published) {
    return (
      <section aria-label="SPOTLIGHT 관리" data-spotlight-manager="" data-view="poster" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        {backRow('공유 이미지')}
        {/* 포스터 데이터는 공개 페이지와 같은 공개 조회(get_public_kdk_spotlight)로 받는다 — slug 만 넘긴다. */}
        <SpotlightPosterPanel slug={published.public_slug} />
      </section>
    );
  }

  return (
    <section aria-label="SPOTLIGHT 관리" data-spotlight-manager="" data-view="main"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {sqlMissing ? (
            <div style={{ padding: 14, borderRadius: 12, background: '#FFFFFF', fontSize: 13, fontWeight: 700, color: '#5B6B80' }}>{REASON_TEXT.sql_not_applied}</div>
          ) : (
            <>
              <div style={{ padding: '10px 12px', borderRadius: 12, background: '#FFFFFF', border: '1px solid rgba(15,39,71,0.08)', fontSize: 12.5, fontWeight: 700, color: '#5B6B80', lineHeight: 1.6 }}>
                {runs === null ? '상태 확인 중…' : latest
                  ? <>최근 생성 {latest.revision}회차 · {fmtTime(latest.generated_at)} · <b style={{ color: '#0F2747' }}>{latest.status === 'draft' ? '미리보기(비공개)' : latest.status === 'published' ? '공개 중' : '비공개 전환됨'}</b>
                      {published && published.id !== latest.id ? <><br />공개 중: {published.revision}회차</> : null}</>
                  : '아직 생성되지 않았습니다. 대기 중인 경기만 분석하며, 이미 시작한 경기는 예측하지 않습니다.'}
                {!ledgerHealthy && <><br /><span style={{ color: '#B91C1C' }}>경기 이력 기록 장치 비활성 — 생성이 차단됩니다.</span></>}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {btn(<><RefreshCw size={14} aria-hidden />{busy === 'generate' ? '분석 중…' : latest ? '재생성' : 'SPOTLIGHT 생성'}</>, () => void call('generate', { action: 'generate', sessionId }), { primary: !latest })}
                {canRepublish
                  ? btn(busy === 'publish' ? '재공개 중…' : '변경 내용으로 재공개', () => void doPublish(true), { primary: true })
                  : btn(busy === 'publish' ? '공개 중…' : '공개', () => void doPublish(false), { primary: canPublish, disabled: !canPublish })}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {btn(<><MessageSquareQuote size={14} aria-hidden />운영진 관전 포인트{hasOperator(opInput) ? ` (${opInput.points.length}${opInput.pick ? '+PICK' : ''})` : ''}</>, () => { setMsg(null); setView('operator'); }, { disabled: !latest })}
                {btn(<><ImageIcon size={14} aria-hidden />공유 이미지</>, () => { setMsg(null); setView('poster'); }, { disabled: !published?.payload })}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {btn(copied ? <><Check size={14} aria-hidden />복사됨</> : <><Copy size={14} aria-hidden />{copying ? '공개 데이터 확인 중…' : '공유 문구 및 링크 복사'}</>, () => void copyShare(), { disabled: !published || copying })}
                {btn(busy === 'unpublish' ? '처리 중…' : '비공개', () => void call('unpublish', { action: 'unpublish', sessionId }), { disabled: !published })}
              </div>
              {msg && <div role="status" style={{ fontSize: 12.5, fontWeight: 700, color: '#0F2747', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{msg}</div>}

              {preview && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.12em', color: '#94A3B8', margin: '4px 0 8px' }}>
                    {preview === opPreview && opPreview ? '미리보기 — 운영진 관전 포인트 반영(아직 공개 전)'
                      : latest?.status === 'published' ? '공개 화면' : '미리보기 — 아직 회원에게 보이지 않습니다'}
                  </div>
                  <SpotlightView payload={preview} />
                </div>
              )}
            </>
          )}
    </section>
  );
}
