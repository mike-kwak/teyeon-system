'use client';

// TEYEON Digital Handbook — 대상별 목차 (Handoff §5.B).
//   좌: 챕터 카드(세리프 번호) > 기능 행(읽음 dot / 제목 flex:1 / mode 칩 / 준비 상태 pill / chevron).
//   우(≥1024): sticky rail — 읽음 진행률 + 다음 추천 + 최근 본.
//   읽음 dot(사용자 학습)과 준비 상태 pill(콘텐츠 제작)은 시각적으로 분리 유지.

import React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChevronRight, ChevronLeft, Search } from 'lucide-react';
import { HB, HB_SHADOW, HB_SERIF } from '@/components/handbook/handbookTokens';
import { AUDIENCE_SLUGS } from '@/lib/handbook/types';
import { audienceMeta, chaptersOf, getModule, moduleHref, modulesInChapter, modulesOf } from '@/lib/handbook/modules';
import { BadgeRow, GuideStatusBadge, ModeBadge } from '@/components/handbook/HandbookBadges';
import GuideSearchOverlay, { useGuideSearch } from '@/components/handbook/GuideSearchOverlay';
import { useHandbookProgress } from '@/lib/handbook/useHandbookProgress';

export default function HandbookAudiencePage() {
  const params = useParams<{ audience: string }>();
  const router = useRouter();
  const [searchOpen, openSearch, closeSearch] = useGuideSearch();
  const { loaded, readIds, recent } = useHandbookProgress();

  const audience = AUDIENCE_SLUGS[String(params?.audience || '')];
  if (!audience) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: HB.textPrimary }}>존재하지 않는 핸드북입니다.</p>
        <Link href="/handbook" style={{ display: 'inline-block', marginTop: 10, fontSize: 13, fontWeight: 700, color: HB.teal }}>← 핸드북 홈으로</Link>
      </div>
    );
  }
  const meta = audienceMeta(audience);
  const chapters = chaptersOf(audience);
  const all = modulesOf(audience);
  const readCount = loaded ? all.filter((m) => readIds.has(m.id)).length : 0;
  const nextGuide = all.find((m) => m.handbook_status !== 'DRAFT' && (!loaded || !readIds.has(m.id))) || all.find((m) => !loaded || !readIds.has(m.id));
  const recentModule = loaded ? recent.map((r) => getModule(r.id)).find((m) => m && m.audience.includes(audience)) : undefined;

  const card: React.CSSProperties = { backgroundColor: HB.surface, borderRadius: 18, border: `1px solid ${HB.border}`, boxShadow: HB_SHADOW.card };

  const railProgress = (
    <div style={{ ...card, padding: 16 }}>
      <p style={{ margin: '0 0 8px', fontSize: 12.5, fontWeight: 800, letterSpacing: '.12em', color: HB.textTertiary }}>읽음 진행률</p>
      <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: HB.textPrimary }}>
        {readCount}<span style={{ fontSize: 13, fontWeight: 700, color: HB.textTertiary }}> / {all.length}</span>
      </p>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={all.length} aria-valuenow={readCount}
        style={{ marginTop: 8, height: 6, borderRadius: 999, backgroundColor: HB.surfaceSub, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${all.length ? Math.round((readCount / all.length) * 100) : 0}%`, borderRadius: 999, background: HB.tealGrad, transition: 'width .3s ease' }} />
      </div>
      {nextGuide && (
        <Link href={moduleHref(nextGuide)} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '9px 11px', borderRadius: 12, backgroundColor: HB.surfaceSoft, textDecoration: 'none', minHeight: 44 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 800, color: HB.teal }}>다음 추천</p>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, fontWeight: 700, color: HB.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nextGuide.title}</p>
          </div>
          <ChevronRight size={14} style={{ color: HB.textTertiary, flexShrink: 0 }} />
        </Link>
      )}
    </div>
  );

  return (
    // 반응형은 실제 컨테이너 폭 기준(@container) — 비관리자 셸 450px 고정(뷰포트 미디어쿼리 부적합).
    <div style={{ backgroundColor: HB.bg, minHeight: '100%', width: '100%', wordBreak: 'keep-all', containerType: 'inline-size', containerName: 'hbk' }}>
      <div className="hb-page" style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* 상단 바 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <button type="button" onClick={() => router.push('/handbook')} aria-label="핸드북 홈"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 12, border: `1px solid ${HB.border}`, backgroundColor: HB.surface, color: HB.textSecondary, cursor: 'pointer', flexShrink: 0 }}>
            <ChevronLeft size={17} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '.2em', color: meta.accent }}>TEYEON HANDBOOK</p>
            <h1 style={{ margin: '2px 0 0', fontSize: 21, fontWeight: 800, color: HB.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.label} 핸드북</h1>
          </div>
          <button type="button" onClick={openSearch} aria-label="검색"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 999, border: `1px solid ${HB.border}`, backgroundColor: HB.surface, color: HB.textSecondary, cursor: 'pointer', flexShrink: 0 }}>
            <Search size={16} />
          </button>
        </div>

        {/* 모바일: 진행률 상단 카드 */}
        <div className="hb-rail-inline" style={{ marginBottom: 14 }}>{railProgress}</div>

        <div className="hb-index-grid">
          {/* 좌: 챕터 목록 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {chapters.map((c) => {
              const mods = modulesInChapter(audience, c.title);
              return (
                <section key={c.title} style={{ ...card, padding: '14px 14px 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, padding: '0 4px 8px' }}>
                    <span style={{ fontFamily: HB_SERIF, fontStyle: 'italic', fontSize: 17, fontWeight: 700, color: meta.accent, flexShrink: 0 }}>{c.order}</span>
                    <h2 style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 16, fontWeight: 800, color: HB.textPrimary }}>{c.title}</h2>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: HB.textTertiary, whiteSpace: 'nowrap', flexShrink: 0 }}>{mods.length}개</span>
                  </div>
                  {mods.length === 0 && (
                    <p style={{ margin: '0 4px 10px', fontSize: 12.5, fontWeight: 600, color: HB.textTertiary }}>가이드 준비 중입니다.</p>
                  )}
                  {mods.map((m) => {
                    const isRead = loaded && readIds.has(m.id);
                    return (
                      <Link key={m.id} href={moduleHref(m)} className="hb-row"
                        style={{ display: 'block', padding: '11px 4px', borderTop: `1px solid ${HB.borderSub}`, textDecoration: 'none', minHeight: 48 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <span aria-hidden title={isRead ? '읽음' : '아직 안 봄'}
                            style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, backgroundColor: isRead ? HB.teal : HB.textDisabled }} />
                          <span style={{ flex: 1, minWidth: 120, fontSize: 14.5, fontWeight: 700, color: HB.textPrimary }}>
                            {m.title}
                            {isRead && <span className="sr-only"> (읽음)</span>}
                          </span>
                          <ChevronRight size={15} style={{ color: HB.textTertiary, flexShrink: 0 }} />
                        </div>
                        <BadgeRow style={{ marginTop: 6, paddingLeft: 17 }}>
                          <ModeBadge mode={m.write_mode} />
                          <GuideStatusBadge status={m.recording_status} />
                        </BadgeRow>
                      </Link>
                    );
                  })}
                </section>
              );
            })}
          </div>

          {/* 우 rail(컨테이너 ≥1024, sticky — 스크롤포트가 헤더 아래에서 시작하므로 top 은 여백만) */}
          <aside className="hb-rail" style={{ position: 'sticky', top: 16, alignSelf: 'start', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {railProgress}
            {recentModule && (
              <div style={{ ...card, padding: 16 }}>
                <p style={{ margin: '0 0 8px', fontSize: 12.5, fontWeight: 800, letterSpacing: '.12em', color: HB.textTertiary }}>최근 본 기능</p>
                <Link href={moduleHref(recentModule)} style={{ fontSize: 13.5, fontWeight: 700, color: HB.textPrimary, textDecoration: 'none' }}>{recentModule.title}</Link>
              </div>
            )}
            <div style={{ ...card, padding: 16 }}>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: HB.textTertiary, lineHeight: 1.6 }}>
                다른 대상 핸드북은 <Link href="/handbook" style={{ color: HB.teal, fontWeight: 800, textDecoration: 'none' }}>홈에서 전환</Link>할 수 있어요.
              </p>
            </div>
          </aside>
        </div>
      </div>

      <GuideSearchOverlay open={searchOpen} onClose={closeSearch} />

      <style>{`
        .hb-page { padding: 20px 16px 28px; }
        .hb-index-grid { display: block; }
        .hb-rail { display: none; }
        .hb-rail-inline { display: block; }
        .hb-row:focus-visible { outline: 2px solid ${HB.teal}; outline-offset: 2px; border-radius: 10px; }
        .hb-row:hover { background: ${HB.surfaceSoft}; border-radius: 10px; }
        .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
        @container hbk (min-width: 768px) { .hb-page { padding: 24px 24px 32px; } }
        @container hbk (min-width: 1024px) {
          .hb-page { padding: 28px 32px 40px; }
          .hb-index-grid { display: grid; grid-template-columns: 1fr 300px; gap: 24px; align-items: start; }
          .hb-rail { display: flex; }
          .hb-rail-inline { display: none; }
        }
      `}</style>
    </div>
  );
}
