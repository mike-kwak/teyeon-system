'use client';

// TEYEON Digital Handbook — Home (Handoff §5.A Motion-first).
//   좌: 타이틀 + 대상 선택 카드 4장 ↔ 중: 폰 preview(crossfade·progress) ↔ 우: 챕터 + CTA.
//   하단: 최근 본 가이드 / 새로 추가된 가이드 / 빠른 기능. 1차: preview 는 poster placeholder.
//   반응형: 1024px 미만 단일 컬럼 스택(대상 카드는 가로 스와이프 칩).

import React from 'react';
import Link from 'next/link';
import { Search, BookOpen, ChevronRight } from 'lucide-react';
import { HB, HB_SHADOW, HB_SERIF } from '@/components/handbook/handbookTokens';
import { AUDIENCES, chaptersOf, getModule, moduleHref, modulesInChapter, modulesOf } from '@/lib/handbook/modules';
import type { HandbookAudience } from '@/lib/handbook/types';
import { GuideStatusBadge } from '@/components/handbook/HandbookBadges';
import GuideSearchOverlay, { useGuideSearch } from '@/components/handbook/GuideSearchOverlay';
import { useHandbookProgress } from '@/lib/handbook/useHandbookProgress';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

export default function HandbookHomePage() {
  const [selected, setSelected] = React.useState<HandbookAudience>('MEMBER');
  const [searchOpen, openSearch, closeSearch] = useGuideSearch();
  const reduced = usePrefersReducedMotion();
  const { loaded, recent } = useHandbookProgress();

  const meta = AUDIENCES.find((a) => a.id === selected)!;
  const chapters = chaptersOf(selected).slice(0, 3);
  const total = modulesOf(selected).length;
  const recentModule = loaded && recent[0] ? getModule(recent[0].id) : undefined;
  const newest = [...modulesOf('MEMBER')].filter((m) => m.handbook_status !== 'DRAFT').slice(0, 2);
  const quick = ['member-ranking', 'member-attendance', 'member-kdk-view', 'member-finance']
    .map(getModule).filter(Boolean);

  const card: React.CSSProperties = { backgroundColor: HB.surface, borderRadius: 18, border: `1px solid ${HB.border}`, boxShadow: HB_SHADOW.card };

  return (
    // 반응형은 실제 컨테이너 폭 기준(@container) — 비관리자 셸 450px 고정(뷰포트 미디어쿼리 부적합).
    <div style={{ backgroundColor: HB.bg, minHeight: '100%', width: '100%', wordBreak: 'keep-all', containerType: 'inline-size', containerName: 'hbk' }}>
      <div className="hb-page" style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* 서브 헤더(GlobalHeader 아래) — 로고 텍스트 + 검색 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 18 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, letterSpacing: '.24em', color: HB.teal }}>TEYEON · SINCE 2025</p>
            <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 800, color: HB.textPrimary }}>DIGITAL HANDBOOK</p>
          </div>
          <button type="button" onClick={openSearch}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 44, padding: '0 16px', borderRadius: 999, border: `1px solid ${HB.border}`, backgroundColor: HB.surface, color: HB.textSecondary, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <Search size={15} /> 가이드 검색
          </button>
        </div>

        {/* 3열(≥1024) / 스택 */}
        <div className="hb-home-grid">
          {/* 좌: 타이틀 + 대상 선택 */}
          <section>
            <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, letterSpacing: '.2em', color: HB.textTertiary }}>OFFICIAL GUIDE</p>
            <h1 style={{ margin: '8px 0 0', fontSize: 26, fontWeight: 800, lineHeight: 1.35, color: HB.textPrimary, textWrap: 'pretty' as never }}>
              실제 화면으로 배우는{' '}
              <em style={{ fontFamily: HB_SERIF, fontStyle: 'italic', fontWeight: 700, color: HB.tealDeep }}>TEYEON 가이드</em>
            </h1>
            <p style={{ margin: '10px 0 18px', fontSize: 15, fontWeight: 500, lineHeight: 1.6, color: HB.textSecondary }}>
              누구로 시작할까요? 대상을 선택하면 맞춤 목차와 사용 영상이 준비됩니다.
            </p>
            <div className="hb-audience-list" role="radiogroup" aria-label="대상 선택">
              {AUDIENCES.map((a) => {
                const on = a.id === selected;
                return (
                  <button key={a.id} type="button" role="radio" aria-checked={on}
                    onClick={() => setSelected(a.id)}
                    className="hb-audience-card"
                    style={{
                      ...card, textAlign: 'left', cursor: 'pointer', padding: '14px 16px',
                      border: on ? `2px solid ${a.accent}` : `1px solid ${HB.border}`,
                      boxShadow: on ? HB_SHADOW.selected : HB_SHADOW.card,
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: a.accent, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 15.5, fontWeight: 800, color: HB.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.label}</span>
                      {on && <span style={{ fontSize: 10.5, fontWeight: 800, color: a.accent, whiteSpace: 'nowrap', flexShrink: 0 }}>보는 중</span>}
                    </div>
                    <p className="hb-audience-tagline" style={{ margin: '5px 0 0', fontSize: 12.5, fontWeight: 600, color: HB.textSecondary, lineHeight: 1.5 }}>{a.tagline}</p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 중: 폰 preview (1차: poster placeholder + crossfade) */}
          <section className="hb-preview" aria-hidden style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ backgroundColor: HB.device, borderRadius: 42, padding: 8, boxShadow: HB_SHADOW.device, width: '100%', maxWidth: 272 }}>
              <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 35, aspectRatio: '9 / 19', backgroundColor: HB.darkCard }}>
                {AUDIENCES.map((a) => (
                  <div key={a.id} style={{
                    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20, textAlign: 'center',
                    background: `linear-gradient(165deg, #13293F 0%, ${a.accent}55 130%)`,
                    opacity: a.id === selected ? 1 : 0,
                    transition: reduced ? 'none' : 'opacity 0.45s ease',
                  }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.24em', color: 'rgba(255,255,255,.65)' }}>PREVIEW</span>
                    <p style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#fff' }}>{a.previewLabel}</p>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.7)', lineHeight: 1.6 }}>대표 화면 미리보기<br />(영상 준비 중)</p>
                  </div>
                ))}
                {/* accent progress line */}
                <div style={{ position: 'absolute', left: 16, right: 16, bottom: 14, height: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,.18)', overflow: 'hidden' }}>
                  <div className={reduced ? undefined : 'hb-progress-anim'} style={{ height: '100%', width: reduced ? '35%' : undefined, borderRadius: 999, backgroundColor: meta.accent }} />
                </div>
              </div>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 12, fontWeight: 600, color: HB.textTertiary }}>무음 자동재생 preview</p>
          </section>

          {/* 우: 선택 대상 요약 + 챕터 + CTA */}
          <section style={{ ...card, padding: 20, alignSelf: 'center' }}>
            <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, letterSpacing: '.2em', color: meta.accent }}>{meta.label.toUpperCase?.() || meta.label}</p>
            <p style={{ margin: '6px 0 0', fontSize: 17, fontWeight: 800, color: HB.textPrimary }}>{meta.label} 핸드북</p>
            <p style={{ margin: '6px 0 14px', fontSize: 13.5, fontWeight: 600, color: HB.textSecondary, lineHeight: 1.6 }}>{meta.tagline}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {chapters.map((c) => (
                <div key={c.title} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 12, backgroundColor: HB.surfaceSub }}>
                  <span style={{ fontFamily: HB_SERIF, fontStyle: 'italic', fontSize: 13, fontWeight: 700, color: meta.accent, flexShrink: 0 }}>{c.order}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: HB.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: HB.textTertiary, whiteSpace: 'nowrap', flexShrink: 0 }}>{modulesInChapter(selected, c.title).length}개</span>
                </div>
              ))}
            </div>
            <p style={{ margin: '0 0 10px', fontSize: 11.5, fontWeight: 600, color: HB.textTertiary }}>총 {total}개 가이드</p>
            <Link href={`/handbook/${meta.slug}`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, borderRadius: 14, background: meta.id === 'MEMBER' ? HB.tealGrad : meta.accent, color: meta.accentInk, fontSize: 15, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap', boxShadow: meta.id === 'MEMBER' ? HB_SHADOW.ctaTeal : HB_SHADOW.card }}>
              <BookOpen size={16} /> {meta.label} 핸드북 열기
            </Link>
          </section>
        </div>

        {/* 하단 3열: 최근 본 / 새 가이드 / 빠른 기능 */}
        <div className="hb-home-bottom">
          <section style={{ ...card, padding: 18 }}>
            <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 800, letterSpacing: '.14em', color: HB.textTertiary }}>최근 본 가이드</p>
            {recentModule ? (
              <Link href={moduleHref(recentModule)} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', minHeight: 48 }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <p style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: HB.textPrimary }}>{recentModule.title}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 600, color: HB.textTertiary }}>{recentModule.chapter}</p>
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', height: 36, padding: '0 13px', borderRadius: 999, backgroundColor: HB.successBg, color: HB.successInk, fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', flexShrink: 0 }}>이어보기</span>
              </Link>
            ) : (
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: HB.textTertiary, lineHeight: 1.6 }}>아직 본 가이드가 없어요.<br />대상을 선택해 시작해보세요.</p>
            )}
          </section>
          <section style={{ ...card, padding: 18 }}>
            <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 800, letterSpacing: '.14em', color: HB.textTertiary }}>새로 추가된 가이드</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {newest.map((m) => (
                <Link key={m.id} href={moduleHref(m)} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', minHeight: 44 }}>
                  <span style={{ flex: 1, minWidth: 120, fontSize: 13.5, fontWeight: 700, color: HB.textPrimary }}>{m.title}</span>
                  <GuideStatusBadge status={m.recording_status} />
                </Link>
              ))}
            </div>
          </section>
          <section style={{ ...card, padding: 18 }}>
            <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 800, letterSpacing: '.14em', color: HB.textTertiary }}>빠른 기능</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {quick.map((m) => m && (
                <Link key={m.id} href={moduleHref(m)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 46, padding: '8px 11px', borderRadius: 12, backgroundColor: HB.surfaceSoft, textDecoration: 'none' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: HB.textPrimary, lineHeight: 1.35 }}>{m.title}</span>
                  <ChevronRight size={14} style={{ color: HB.textTertiary, flexShrink: 0 }} />
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>

      <GuideSearchOverlay open={searchOpen} onClose={closeSearch} />

      <style>{`
        .hb-page { padding: 20px 16px 28px; }
        .hb-home-grid { display: flex; flex-direction: column; gap: 22px; }
        .hb-home-bottom { display: flex; flex-direction: column; gap: 12px; margin-top: 26px; }
        .hb-audience-list { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(170px, 220px); gap: 10px; overflow-x: auto; padding-bottom: 6px; scrollbar-width: thin; }
        .hb-audience-tagline { display: none; }
        .hb-preview { max-width: 340px; margin: 0 auto; }
        @container hbk (min-width: 640px) {
          .hb-audience-tagline { display: block; }
        }
        @container hbk (min-width: 768px) { .hb-page { padding: 24px 24px 32px; } }
        @container hbk (min-width: 1024px) {
          .hb-page { padding: 28px 32px 40px; }
          .hb-home-grid { display: grid; grid-template-columns: minmax(280px,380px) minmax(290px,1fr) minmax(250px,330px); gap: 28px; align-items: center; }
          .hb-home-bottom { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-top: 32px; }
          .hb-audience-list { display: flex; flex-direction: column; overflow-x: visible; padding-bottom: 0; }
          .hb-preview { max-width: none; margin: 0; }
        }
        .hb-audience-card:focus-visible { outline: 2px solid ${HB.teal}; outline-offset: 2px; }
        @keyframes hbProgress { from { width: 0%; } to { width: 100%; } }
        .hb-progress-anim { animation: hbProgress 5s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .hb-progress-anim { animation: none; width: 35%; } }
      `}</style>
    </div>
  );
}
