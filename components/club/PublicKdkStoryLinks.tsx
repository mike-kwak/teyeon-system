'use client';

// 공개 KDK 상세(/club/kdk/[sessionId]) → MATCH SPOTLIGHT(미리보기) · FINAL REPORT 연결.
//   - 조회는 이미 anon 에 공개된 기존 RPC 만 사용(새 공개 권한 없음):
//       get_public_kdk_spotlight_link    — 공개(published) 상태일 때만 slug
//       get_public_kdk_final_report_link — 발행 · 공식 · 비테스트 · 기록 지문 일치일 때만 slug
//   - 응답에서 slug 만 사용(세션 내부 정보 · 벌금/정산 정보 없음). 링크 대상 페이지도 기존 공개 페이지.
//   - 둘 다 없으면 아무것도 렌더하지 않는다(화면 무변화). 조회 실패도 조용히 숨김.
import React from 'react';
import Link from 'next/link';
import { BookOpen, ChevronRight, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { SLUG_RE, spotlightPublicPath } from '@/lib/kdk/spotlightPublicService';
import { finalReportPublicPath } from '@/lib/kdk/finalReportPublicService';

export default function PublicKdkStoryLinks({ sessionId, state }: { sessionId: string; state: string }) {
    const [spotlight, setSpotlight] = React.useState<string | null>(null);
    const [report, setReport] = React.useState<string | null>(null);

    React.useEffect(() => {
        let alive = true;
        if (!sessionId) return;
        (async () => {
            try {
                const { data, error } = await supabase.rpc('get_public_kdk_spotlight_link', { p_session_id: sessionId });
                const slug = !error && data && (data as { ok?: boolean }).ok === true ? (data as { public_slug?: unknown }).public_slug : null;
                if (alive) setSpotlight(typeof slug === 'string' && SLUG_RE.test(slug) ? slug : null);
            } catch { if (alive) setSpotlight(null); }
            if (state !== 'finished') { if (alive) setReport(null); return; } // FINAL REPORT 는 공식 확정 세션만
            try {
                const { data, error } = await supabase.rpc('get_public_kdk_final_report_link', { p_session_id: sessionId });
                const slug = !error && data && (data as { ok?: boolean }).ok === true ? (data as { publicSlug?: unknown }).publicSlug : null;
                if (alive) setReport(typeof slug === 'string' && SLUG_RE.test(slug) ? slug : null);
            } catch { if (alive) setReport(null); }
        })();
        return () => { alive = false; };
    }, [sessionId, state]);

    if (!spotlight && !report) return null;
    return (
        <nav aria-label="경기 이야기" data-kdk-story-links style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {spotlight && (
                <StoryLink href={spotlightPublicPath(spotlight)} icon={<Sparkles size={15} />} title="MATCH SPOTLIGHT" sub="오늘의 주목 경기 미리보기" />
            )}
            {report && (
                <StoryLink href={finalReportPublicPath(report)} icon={<BookOpen size={15} />} title="FINAL REPORT" sub="공식 확정 결과 리포트" />
            )}
        </nav>
    );
}

function StoryLink({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub: string }) {
    return (
        <Link href={href} style={{
            display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '10px 14px', borderRadius: 14,
            background: '#FFFFFF', border: '1px solid rgba(15,23,42,0.08)', boxShadow: '0 1px 4px rgba(15,23,42,0.05)',
            textDecoration: 'none', color: '#0F172A',
        }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(15,159,152,0.10)', color: '#0E7C76', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 900, letterSpacing: '0.04em' }}>{title}</span>
                <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748B', marginTop: 1 }}>{sub}</span>
            </span>
            <ChevronRight size={16} color="#94A3B8" style={{ flexShrink: 0 }} />
        </Link>
    );
}
