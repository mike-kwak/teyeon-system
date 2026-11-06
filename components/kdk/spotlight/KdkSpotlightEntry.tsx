'use client';

// /kdk 대진표 상단 — TODAY'S SPOTLIGHT 배너(누구나) + SPOTLIGHT 관리(CEO·ADMIN·KDK 관리자, 관리자 모드).
//   · 배너: 공개(published) 상태일 때만 노출. 조회는 anon 공개 RPC(get_public_kdk_spotlight_link) — slug 만 받는다.
//   · 관리: 생성 → 미리보기(draft) → 공개 / 비공개 · 공유 문구 및 링크 복사. 쓰기는 서버 route(권한 재검증).
//   · SQL 미적용 환경: 배너는 조용히 숨김, 관리 패널은 "SQL 미적용" 안내만.
//   · KDK 경기 진행 로직·Realtime 과 무관(독립 조회 · 실패해도 대진표 영향 없음).

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles, ChevronRight, X, Copy, Check, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import SpotlightView from './SpotlightView';
import { buildSpotlightShareText, parsePublicSpotlightPayload, type PublicSpotlightPayload } from '@/lib/kdk/analytics/publicSpotlight';
import { spotlightPublicPath, spotlightPublicUrl } from '@/lib/kdk/spotlightPublicService';

type AdminRun = {
  id: string; status: 'draft' | 'published' | 'unpublished'; revision: number; public_slug: string;
  generated_at: string; published_at: string | null; payload: PublicSpotlightPayload | null;
};

const REASON_TEXT: Record<string, string> = {
  login_required: '로그인이 필요합니다.',
  forbidden: 'CEO · ADMIN · KDK 관리자만 사용할 수 있습니다.',
  not_configured: '서버 설정(service role)이 없어 생성할 수 없습니다.',
  sql_not_applied: 'SPOTLIGHT SQL 이 아직 적용되지 않았습니다.',
  db_unavailable: '데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  visibility_unavailable: '회원 공개 범위를 확인하지 못해 중단했습니다(비공개 보호).',
  session_not_found: '세션 경기를 찾을 수 없습니다.',
  no_predictable_matches: '시작 전(대기) 경기 중 분석할 수 있는 경기가 없습니다.',
  stale_matches: '경기 상태가 바뀌어 저장하지 못했습니다. 다시 시도해 주세요.',
  ledger_unhealthy: '경기 이력 기록 장치가 비활성 상태라 생성을 막았습니다.',
  session_archived: '이미 종료(Archive)된 세션입니다.',
  not_latest: '더 최근 생성본이 있습니다. 최신본을 공개해 주세요.',
  not_publishable: '공개할 수 없는 상태입니다.',
};

const fmtTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
}

export default function KdkSpotlightEntry({ sessionId, isAdmin }: { sessionId: string | null; isAdmin: boolean }) {
  const [link, setLink] = useState<{ slug: string; count: number } | null>(null);
  const [open, setOpen] = useState(false);

  const loadLink = useCallback(async () => {
    if (!sessionId) { setLink(null); return; }
    try {
      const { data, error } = await supabase.rpc('get_public_kdk_spotlight_link', { p_session_id: sessionId });
      if (error || !data || (data as any).ok !== true) { setLink(null); return; }
      setLink({ slug: String((data as any).public_slug), count: Number((data as any).item_count) || 0 });
    } catch { setLink(null); }
  }, [sessionId]);
  useEffect(() => { void loadLink(); }, [loadLink]);

  if (!sessionId || (!link && !isAdmin)) return null;

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {link && (
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
      )}
      {isAdmin && (
        <button type="button" onClick={() => setOpen(true)}
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', borderRadius: 999, border: '1px solid #C9D9EC', background: '#FFFFFF', color: '#0F2747', fontSize: 12.5, fontWeight: 900, cursor: 'pointer' }}>
          <Sparkles size={14} color="#0D9488" aria-hidden /> SPOTLIGHT 관리
        </button>
      )}
      {isAdmin && open && (
        <SpotlightAdminSheet sessionId={sessionId} onClose={() => setOpen(false)} onChanged={loadLink} />
      )}
    </div>
  );
}

function SpotlightAdminSheet({ sessionId, onClose, onChanged }: { sessionId: string; onClose: () => void; onChanged: () => void }) {
  const [runs, setRuns] = useState<AdminRun[] | null>(null);
  const [ledgerHealthy, setLedgerHealthy] = useState(true);
  const [sqlMissing, setSqlMissing] = useState(false);
  const [busy, setBusy] = useState<null | 'generate' | 'publish' | 'unpublish'>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { const p = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = p; }; }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

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
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) { setMsg(REASON_TEXT.login_required); return; }
      const res = await fetch('/api/kdk/spotlight', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok !== true) {
        setMsg(REASON_TEXT[String(j.reason)] || `처리하지 못했습니다(${String(j.reason || res.status)}).`);
      } else if (kind === 'generate') {
        setMsg(`생성 완료 — 분석 ${j.predicted}경기 · 주목 ${j.selected}경기${j.shortfall ? ' (기준 충족 경기가 적어 3개 미만)' : ''}. 미리보기를 확인한 뒤 공개하세요.`);
      } else if (kind === 'publish') {
        const extra = [j.invalidated ? `선수 변경 ${j.invalidated}경기 제외` : '', j.droppedForPrivacy ? `비공개 회원 ${j.droppedForPrivacy}경기 제외` : ''].filter(Boolean).join(' · ');
        setMsg(`공개되었습니다${extra ? ` (${extra})` : ''}.`);
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
  const preview = latest?.payload || null;

  const copyShare = async () => {
    const target = published || null;
    if (!target?.payload) return;
    const ok = await copyText(buildSpotlightShareText(target.payload, spotlightPublicUrl(target.public_slug)));
    setCopied(ok);
    if (!ok) setMsg('복사하지 못했습니다. 브라우저 권한을 확인해 주세요.');
  };

  const btn = (label: React.ReactNode, onClick: () => void, opts: { primary?: boolean; disabled?: boolean } = {}) => (
    <button type="button" onClick={onClick} disabled={opts.disabled || !!busy}
      style={{ flex: '1 1 0', minWidth: 0, height: 42, borderRadius: 12, fontSize: 13, fontWeight: 900, cursor: opts.disabled || busy ? 'not-allowed' : 'pointer',
        border: opts.primary ? 'none' : '1px solid #C9D9EC', background: opts.disabled ? '#EEF2F7' : opts.primary ? '#0F2747' : '#FFFFFF',
        color: opts.disabled ? '#94A3B8' : opts.primary ? '#FFFFFF' : '#0F2747', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      {label}
    </button>
  );

  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label="SPOTLIGHT 관리"
      style={{ position: 'fixed', inset: 0, zIndex: 520, backgroundColor: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, maxHeight: '88dvh', background: '#F4F8FC', borderTopLeftRadius: 20, borderTopRightRadius: 20, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px 10px', borderBottom: '1px solid rgba(15,39,71,0.08)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '0.16em', color: '#0D9488' }}>MATCH SPOTLIGHT</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#0F2747' }}>오늘의 주목 경기 관리</div>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid #C9D9EC', background: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={16} color="#5B6B80" /></button>
        </div>

        <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '12px 16px', paddingBottom: 'calc(var(--bottom-nav-area, 88px) + 16px)', display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                {btn(busy === 'publish' ? '공개 중…' : '공개', () => latest && void call('publish', { action: 'publish', runId: latest.id }), { primary: canPublish, disabled: !canPublish })}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {btn(copied ? <><Check size={14} aria-hidden />복사됨</> : <><Copy size={14} aria-hidden />공유 문구 및 링크 복사</>, () => void copyShare(), { disabled: !published })}
                {btn(busy === 'unpublish' ? '처리 중…' : '비공개', () => void call('unpublish', { action: 'unpublish', sessionId }), { disabled: !published })}
              </div>
              {msg && <div role="status" style={{ fontSize: 12.5, fontWeight: 700, color: '#0F2747', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{msg}</div>}

              {preview && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.12em', color: '#94A3B8', margin: '4px 0 8px' }}>
                    {latest?.status === 'published' ? '공개 화면' : '미리보기 — 아직 회원에게 보이지 않습니다'}
                  </div>
                  <SpotlightView payload={preview} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
