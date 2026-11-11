'use client';

// Archive 상세 → KDK FINAL REPORT 진입점(P3).
//   · 공개 리포트 보기: 발행 중 · 공식 · 비테스트 · 기록 지문 일치일 때만(anon RPC get_public_kdk_final_report_link) — 누구나.
//   · 작성 · 관리: 서버 route 가 권한(CEO · ADMIN · KDK 관리자)을 확인한 사용자에게만. 공식 확정된 비테스트 KDK 에서만 활성.
//   · Archive 확정 · 정정 · 삭제 · 순위 로직과 무관(읽기 · 버튼만). 조회 실패 시 조용히 숨긴다.

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { BookOpen, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { postFinalReportAction } from './finalReportClientApi';
import { finalReportPublicPath } from '@/lib/kdk/finalReportPublicService';
import { FRV } from '@/lib/kdk/finalReport/finalReportView';

const FinalReportEditor = dynamic(() => import('./FinalReportEditor'), { ssr: false });

// 같은 화면에서 여러 세션을 열어도 권한 확인은 사용자당 한 번.
let accessCache: { userId: string; ok: boolean } | null = null;

export interface FinalReportArchiveSession {
  id: string;
  archive_type?: string | null;
  is_official?: boolean | null;
  is_test?: boolean | null;
  isLocal?: boolean;
}

export default function FinalReportArchiveEntry({ session }: { session: FinalReportArchiveSession }) {
  const { user } = useAuth();
  const isKdk = (session.archive_type || 'kdk') === 'kdk' && !session.isLocal;
  const eligible = isKdk && session.is_official === true && session.is_test !== true;
  const [slug, setSlug] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [open, setOpen] = useState(false);

  const loadLink = useCallback(async () => {
    if (!eligible) { setSlug(null); return; }
    try {
      const { data, error } = await supabase.rpc('get_public_kdk_final_report_link', { p_session_id: session.id });
      setSlug(!error && data && (data as any).ok === true && typeof (data as any).publicSlug === 'string' ? (data as any).publicSlug : null);
    } catch { setSlug(null); }
  }, [eligible, session.id]);
  useEffect(() => { void loadLink(); }, [loadLink]);

  useEffect(() => {
    let alive = true;
    const uid = (user as any)?.id ? String((user as any).id) : '';
    if (!uid || !isKdk) { setCanEdit(false); return; }
    if (accessCache && accessCache.userId === uid) { setCanEdit(accessCache.ok); return; }
    (async () => {
      const r = await postFinalReportAction({ action: 'access' });
      // 401 · 403 은 권한 없음으로 확정, 네트워크 · 서버 오류는 다음에 다시 확인.
      if (r.ok || r.status === 401 || r.status === 403) accessCache = { userId: uid, ok: r.ok };
      if (alive) setCanEdit(r.ok);
    })();
    return () => { alive = false; };
  }, [user, isKdk]);

  if (!slug && !canEdit) return null;

  return (
    <section data-fr-entry style={{ borderRadius: 18, padding: '12px 14px', background: `linear-gradient(120deg, ${FRV.navy} 0%, #142B4A 100%)`, color: FRV.onNavy, boxShadow: '0 8px 20px rgba(6,17,31,0.16)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(227,199,126,0.16)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <BookOpen size={17} color={FRV.goldSoft} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 10.5, fontWeight: 900, letterSpacing: '0.18em', color: FRV.goldSoft }}>FINAL REPORT</p>
          <p style={{ margin: '1px 0 0', fontSize: 13.5, fontWeight: 900, wordBreak: 'keep-all' }}>{slug ? '경기 결과 리포트가 공개되어 있습니다' : '경기 결과 리포트'}</p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {slug && (
          <Link data-fr-entry="view" href={finalReportPublicPath(slug)} style={{ ...pill, background: FRV.goldSoft, color: FRV.navyDeep, border: `1px solid ${FRV.gold}` }}>
            공개 리포트 보기 <ChevronRight size={14} />
          </Link>
        )}
        {canEdit && (
          <button type="button" data-fr-entry="edit" disabled={!eligible} onClick={() => setOpen(true)}
            style={{ ...pill, background: 'transparent', color: eligible ? '#FFFFFF' : 'rgba(244,241,232,0.5)', border: '1px solid rgba(255,255,255,0.35)', cursor: eligible ? 'pointer' : 'not-allowed' }}>
            {slug ? '리포트 수정 · 관리' : 'FINAL REPORT 작성'}
          </button>
        )}
      </div>
      {canEdit && !eligible && (
        <p data-fr-entry="ineligible" style={{ margin: '8px 0 0', fontSize: 11.5, fontWeight: 700, color: 'rgba(244,241,232,0.75)', wordBreak: 'keep-all' }}>
          공식 확정된 KDK 기록(테스트 제외)에서만 작성할 수 있습니다.
        </p>
      )}
      {open && <FinalReportEditor sessionId={session.id} onClose={() => { setOpen(false); void loadLink(); }} onChanged={() => { void loadLink(); }} />}
    </section>
  );
}

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 38, padding: '0 14px', borderRadius: 999,
  fontSize: 12.5, fontWeight: 900, textDecoration: 'none', whiteSpace: 'nowrap',
};
