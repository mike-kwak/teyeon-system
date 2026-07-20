'use client';

// TEYEON Digital Handbook — 기능 상세 (Handoff §5.C 데스크톱 양면 / §5.D 모바일 단면).
//   양면(컨테이너 ≥1024): 좌 설명·준비·단계·주의·CTA·관련·이전다음 + 우 sticky 영상(폰 프레임).
//     ※ 비관리자 셸은 450px 고정이라 현행에서는 단면만 노출 — 셸 확장 승인 시 자동 활성(@container).
//   모바일(단면): 영상(4:5) → 제목 → 요약 → 배지 → 준비 → 단계 → 주의 → sticky CTA → 관련 → 이전·다음.
//   sticky CTA 는 BottomNav 위(bottom: 0 — GlobalMain 의 --page-bottom-safe 패딩이 nav 영역 예약) — 공통 정책 무수정.
//   진입 시 읽음 + 최근 본 처리(localStorage). DRAFT 모듈은 "가이드 준비 중" 안내.

import React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, ExternalLink, TriangleAlert, Info, Shield, Camera, Check } from 'lucide-react';
import { HB, HB_SHADOW, HB_SERIF } from '@/components/handbook/handbookTokens';
import { AUDIENCE_SLUGS } from '@/lib/handbook/types';
import { audienceMeta, chaptersOf, getModule, moduleHref, prevNextOf } from '@/lib/handbook/modules';
import { BadgeRow, GuideStatusBadge, HighlightBadge, ModeBadge, PermissionBadge, PrivacyBadge } from '@/components/handbook/HandbookBadges';
import GuideVideoPlayer from '@/components/handbook/GuideVideoPlayer';
import { useHandbookProgress } from '@/lib/handbook/useHandbookProgress';

// 경고 카드 4종(Handoff §8 — gold/amber wash, red 금지)
function WarningCard({ kind, roles }: { kind: 'save' | 'privacy' | 'recording' | 'role'; roles?: string[] }) {
  const map = {
    save: { icon: <TriangleAlert size={15} />, text: '이 기능을 실행하면 실제 데이터가 저장됩니다.', bg: HB.dangerBg, border: HB.dangerBorder, ink: HB.dangerInk },
    privacy: { icon: <Info size={15} />, text: '사용 중 개인정보가 표시될 수 있습니다.', bg: HB.warningBg, border: HB.warningBorder, ink: HB.warningInk },
    recording: { icon: <Camera size={15} />, text: '공식 가이드 촬영 시 테스트 또는 마스킹 데이터를 사용합니다.', bg: HB.warningBg, border: HB.warningBorder, ink: HB.warningInk },
    role: { icon: <Shield size={15} />, text: '이 기능은 지정된 운영 권한에서만 표시됩니다.', bg: '#EDF1F5', border: '#DCE3EA', ink: HB.textPrimary },
  }[kind];
  return (
    <div role="note" style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '11px 13px', borderRadius: 14, backgroundColor: map.bg, border: `1px solid ${map.border}`, color: map.ink }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>{map.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, lineHeight: 1.55 }}>{map.text}</p>
        {kind === 'role' && roles && roles.length > 0 && (
          <BadgeRow style={{ marginTop: 7 }}>{roles.map((r) => <PermissionBadge key={r} role={r} />)}</BadgeRow>
        )}
      </div>
    </div>
  );
}

export default function HandbookModulePage() {
  const params = useParams<{ audience: string; module: string }>();
  const router = useRouter();
  const { markRead, pushRecent } = useHandbookProgress();
  const [activeStep, setActiveStep] = React.useState(0);
  // 모바일 sticky CTA 표시 제어 — 첫 진입 화면(제목·영상·배지)을 덮지 않도록,
  // 헤더 블록(제목~배지)이 화면에서 벗어난 뒤에만 표시한다(IntersectionObserver 센티널).
  const headerRef = React.useRef<HTMLElement | null>(null);
  const [ctaShown, setCtaShown] = React.useState(false);

  const audience = AUDIENCE_SLUGS[String(params?.audience || '')];
  const mod = getModule(String(params?.module || ''));
  const valid = !!audience && !!mod && mod.audience.includes(audience);

  React.useEffect(() => {
    if (valid && mod) { markRead(mod.id); pushRecent(mod.id); }
  }, [valid, mod, markRead, pushRecent]);

  React.useEffect(() => {
    const el = headerRef.current; // DRAFT/무효 모듈은 헤더가 없어 자동 no-op
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCtaShown(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [valid, mod]);

  if (!valid || !mod) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: HB.textPrimary }}>존재하지 않는 가이드입니다.</p>
        <Link href="/handbook" style={{ display: 'inline-block', marginTop: 10, fontSize: 13, fontWeight: 700, color: HB.teal }}>← 핸드북 홈으로</Link>
      </div>
    );
  }

  const meta = audienceMeta(audience);
  const chapterNo = chaptersOf(audience).find((c) => c.title === mod.chapter)?.order;
  const { prev, next } = prevNextOf(audience, mod.id);
  const isDraft = mod.handbook_status === 'DRAFT';
  const videoReady = mod.recording_status === 'RECORDED' || mod.recording_status === 'REVIEWED';
  const related = mod.related_modules.map(getModule).filter(Boolean);
  const card: React.CSSProperties = { backgroundColor: HB.surface, borderRadius: 18, border: `1px solid ${HB.border}`, boxShadow: HB_SHADOW.card };

  const videoBlock = (variant: 'phone' | 'card') => (
    <GuideVideoPlayer
      title={mod.title}
      videoFile={mod.video_file}
      posterFile={mod.poster_file}
      ready={videoReady && !!mod.video_file}
      stepCount={mod.steps.length}
      activeStep={activeStep}
      onSelectStep={setActiveStep}
      variant={variant}
    />
  );

  const badges = (
    <BadgeRow>
      {/* 핵심 메시지 칩('앱 설치 불필요' 등) — 파생 배지보다 앞에 배치 */}
      {(mod.highlight_badges || []).map((b) => <HighlightBadge key={b} label={b} />)}
      <ModeBadge mode={mod.write_mode} />
      <PrivacyBadge level={mod.privacy_level} />
      <GuideStatusBadge status={mod.recording_status} />
    </BadgeRow>
  );

  const warningCards = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {mod.write_mode === 'WRITES_DATA' && <WarningCard kind="save" />}
      {mod.privacy_level !== 'LOW' && <WarningCard kind="privacy" />}
      {mod.role_requirement && mod.role_requirement.length > 0 && <WarningCard kind="role" roles={mod.role_requirement} />}
    </div>
  );

  const prerequisites = mod.prerequisites.length > 0 && (
    <section>
      <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 800, letterSpacing: '.14em', color: HB.textTertiary }}>준비사항</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {mod.prerequisites.map((p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 999, backgroundColor: HB.successBg, color: HB.successInk, flexShrink: 0 }}><Check size={11} /></span>
            <span style={{ fontSize: 14, fontWeight: 600, color: HB.textSecondary }}>{p}</span>
          </div>
        ))}
      </div>
    </section>
  );

  const stepsBlock = mod.steps.length > 0 && (
    <section>
      <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 800, letterSpacing: '.14em', color: HB.textTertiary }}>핵심 단계</p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {mod.steps.map((s, i) => {
          const on = i === activeStep;
          return (
            <li key={i}>
              <button type="button" onClick={() => setActiveStep(i)} aria-current={on ? 'step' : undefined}
                style={{
                  width: '100%', display: 'flex', alignItems: 'flex-start', gap: 11, minHeight: 48,
                  padding: '11px 13px', borderRadius: 13, textAlign: 'left', cursor: 'pointer',
                  border: on ? `1px solid ${HB.teal}` : `1px solid ${HB.borderSub}`,
                  backgroundColor: on ? HB.successBg : HB.surface,
                }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 999, flexShrink: 0,
                  fontSize: 12, fontWeight: 800, backgroundColor: on ? HB.teal : HB.surfaceSub, color: on ? '#fff' : HB.textTertiary,
                }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: on ? 700 : 600, lineHeight: 1.6, color: HB.textPrimary }}>{s}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );

  const cautions = mod.warnings.length > 0 && (
    <section>
      <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 800, letterSpacing: '.14em', color: HB.textTertiary }}>주의사항</p>
      <div style={{ borderLeft: `3px solid ${HB.gold}`, backgroundColor: HB.warningBg, border: `1px solid ${HB.warningBorder}`, borderLeftWidth: 3, borderLeftColor: HB.gold, borderRadius: 12, padding: '11px 14px' }}>
        {mod.warnings.map((w, i) => (
          <p key={i} style={{ margin: i === 0 ? 0 : '6px 0 0', fontSize: 13.5, fontWeight: 600, lineHeight: 1.6, color: HB.warningInk }}>{w}</p>
        ))}
      </div>
    </section>
  );

  // CTA — 기본은 실제 기능 링크. cta_disabled 모듈(확정 경로 없음 — 예: 토큰형 Guest Pass)은
  // 링크 대신 안내형(비활성)으로 표시한다. 가짜 URL 을 만들어 연결하지 않는다.
  const ctaDisabled = !!mod.cta_disabled || !mod.route;
  const ctaLabel = mod.cta_label || '실제 기능으로 이동';
  const cta = (full: boolean) => ctaDisabled ? (
    <span aria-disabled="true"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        height: full ? 52 : 48, width: full ? '100%' : undefined, padding: full ? undefined : '0 22px',
        borderRadius: 14, backgroundColor: HB.surfaceSub, border: `1px solid ${HB.border}`,
        color: HB.textTertiary, fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap', cursor: 'default',
      }}>
      {ctaLabel}
    </span>
  ) : (
    <Link href={mod.route}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        height: full ? 52 : 48, width: full ? '100%' : undefined, padding: full ? undefined : '0 22px',
        borderRadius: 14, background: HB.tealGrad, color: '#fff', fontSize: 15, fontWeight: 800,
        textDecoration: 'none', whiteSpace: 'nowrap', boxShadow: HB_SHADOW.ctaTeal,
      }}>
      {ctaLabel} <ExternalLink size={15} />
    </Link>
  );

  const relatedBlock = related.length > 0 && (
    <section>
      <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 800, letterSpacing: '.14em', color: HB.textTertiary }}>관련 가이드</p>
      <BadgeRow>
        {related.map((r) => r && (
          <Link key={r.id} href={moduleHref(r)}
            style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 15px', borderRadius: 999, border: `1px solid ${HB.border}`, backgroundColor: HB.surface, color: HB.textPrimary, fontSize: 13, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            {r.title}
          </Link>
        ))}
      </BadgeRow>
    </section>
  );

  const prevNext = (
    <nav aria-label="이전 다음 가이드" style={{ display: 'flex', gap: 10 }}>
      {prev ? (
        <Link href={moduleHref(prev)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7, padding: '12px 13px', borderRadius: 14, border: `1px solid ${HB.border}`, backgroundColor: HB.surface, textDecoration: 'none', minHeight: 52 }}>
          <ChevronLeft size={15} style={{ color: HB.textTertiary, flexShrink: 0 }} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 800, color: HB.textTertiary }}>이전</span>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: HB.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prev.title}</span>
          </span>
        </Link>
      ) : <span style={{ flex: 1 }} />}
      {next ? (
        <Link href={moduleHref(next)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 7, padding: '12px 13px', borderRadius: 14, border: `1px solid ${HB.border}`, backgroundColor: HB.surface, textDecoration: 'none', minHeight: 52, textAlign: 'right' }}>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 800, color: HB.textTertiary }}>다음</span>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: HB.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{next.title}</span>
          </span>
          <ChevronRight size={15} style={{ color: HB.textTertiary, flexShrink: 0 }} />
        </Link>
      ) : <span style={{ flex: 1 }} />}
    </nav>
  );

  return (
    // 반응형은 뷰포트가 아닌 '실제 컨테이너 폭' 기준(@container) — 비관리자 셸은 450px 고정이라
    // 뷰포트 미디어쿼리로는 PC(1280 뷰포트 × 450 컨테이너)에서 two-pane 이 눌려 깨진다.
    <div style={{ backgroundColor: HB.bg, minHeight: '100%', width: '100%', wordBreak: 'keep-all', containerType: 'inline-size', containerName: 'hbk' }}>
      {/* compact sticky breadcrumb — 스크롤포트(GlobalMain)가 GlobalHeader 아래에서 시작하므로 top: 0 */}
      <nav aria-label="현재 위치"
        style={{ position: 'sticky', top: 0, zIndex: 20, backgroundColor: 'rgba(244,247,249,.92)', backdropFilter: 'blur(8px)', borderBottom: `1px solid ${HB.borderSub}` }}>
        <div className="hb-crumb" style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Link href={`/handbook/${meta.slug}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 800, color: meta.accent, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0, minHeight: 44 }}>
            <ChevronLeft size={13} /> {meta.label}용
          </Link>
          <span aria-hidden style={{ color: HB.textDisabled }}>›</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: HB.textTertiary, whiteSpace: 'nowrap', flexShrink: 0 }}>{chapterNo != null ? `${chapterNo}. ` : ''}{mod.chapter}</span>
          <span aria-hidden style={{ color: HB.textDisabled }}>›</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: HB.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mod.title}</span>
          {mod.steps.length > 0 && (
            <span className="hb-crumb-step" style={{ fontSize: 11.5, fontWeight: 700, color: HB.textTertiary, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {activeStep + 1}/{mod.steps.length} 단계
            </span>
          )}
        </div>
      </nav>

      <div className="hb-page" style={{ maxWidth: 1280, margin: '0 auto' }}>
        {isDraft ? (
          <div style={{ ...card, padding: '28px 20px', textAlign: 'center', marginTop: 8 }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: HB.textPrimary }}>{mod.title}</p>
            <p style={{ margin: '8px 0 0', fontSize: 13.5, fontWeight: 600, color: HB.textSecondary, lineHeight: 1.65 }}>
              이 가이드는 준비 중입니다. 기능은 아래 바로가기에서 바로 사용할 수 있어요.
            </p>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>{cta(false)}</div>
            <button type="button" onClick={() => router.push(`/handbook/${meta.slug}`)}
              style={{ marginTop: 12, background: 'none', border: 'none', fontSize: 12.5, fontWeight: 700, color: HB.teal, cursor: 'pointer' }}>
              ← {meta.label} 목차로
            </button>
          </div>
        ) : (
          <div className="hb-detail-grid">
            {/* 모바일 전용: 최상단 영상 */}
            <div className="hb-video-mobile">{videoBlock('card')}</div>

            {/* 좌: 본문 */}
            <article style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
              <header ref={headerRef}>
                <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, letterSpacing: '.2em', color: meta.accent }}>{meta.label.toUpperCase?.() || meta.label} GUIDE</p>
                <h1 style={{ margin: '8px 0 0', fontSize: 27, fontWeight: 800, lineHeight: 1.3, color: HB.textPrimary, textWrap: 'pretty' as never }}>{mod.title}</h1>
                <p style={{ margin: '10px 0 12px', fontSize: 15.5, fontWeight: 500, lineHeight: 1.65, color: HB.textSecondary }}>{mod.summary}</p>
                {badges}
              </header>
              {warningCards}
              {prerequisites}
              {stepsBlock}
              {cautions}
              {/* 안내형(비활성) CTA 는 sticky 모바일 CTA 를 쓰지 않으므로 전 폭에서 본문에 표시 */}
              <div className={ctaDisabled ? undefined : 'hb-cta-desktop'}>{cta(false)}</div>
              {relatedBlock}
              {prevNext}
            </article>

            {/* 우: sticky 영상(컨테이너 ≥1024 — 현행 450px 셸에서는 잠복, 셸 확장 시 자동 활성) */}
            <aside className="hb-video-desktop" style={{ position: 'sticky', top: 56, alignSelf: 'start' }}>
              <div style={{ ...card, padding: 20, boxShadow: HB_SHADOW.stickyVideo, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {videoBlock('phone')}
              </div>
            </aside>
          </div>
        )}
      </div>

      {/* 모바일 sticky bottom CTA — 공통 정책 무수정.
          GlobalMain 의 paddingBottom(--page-bottom-safe = BottomNav+24px)이 이미 nav 영역을 예약하고
          sticky 앵커도 그 패딩 위에서 잡히므로 bottom: 0 이면 BottomNav 위에 정착한다
          (여기에 nav 토큰을 다시 더하면 이중 보정 → nav 위 ~100px 부유). safe-area 도 토큰에 포함 완료. */}
      {!isDraft && !ctaDisabled && (
        <div className="hb-cta-mobile" aria-hidden={!ctaShown}
          style={{
            position: 'sticky', bottom: 0, zIndex: 25, padding: '10px 16px 12px',
            background: 'linear-gradient(180deg, rgba(244,247,249,0), rgba(244,247,249,.95) 35%)',
            // 최상단(헤더 블록 노출 중)에는 숨김 — visibility 로 탭 순서·a11y 트리에서도 제외.
            opacity: ctaShown ? 1 : 0,
            visibility: ctaShown ? 'visible' : 'hidden',
            transform: ctaShown ? 'none' : 'translateY(6px)',
            pointerEvents: ctaShown ? 'auto' : 'none',
            transition: 'opacity .25s ease, transform .25s ease, visibility .25s',
          }}>
          {cta(true)}
        </div>
      )}

      <style>{`
        .hb-page { padding: 18px 16px 24px; }
        .hb-crumb { padding: 0 16px; min-height: 48px; }
        .hb-detail-grid { display: flex; flex-direction: column; gap: 20px; }
        .hb-video-mobile { display: block; }
        .hb-video-desktop { display: none; }
        .hb-cta-desktop { display: none; }
        .hb-cta-mobile { display: block; }
        .hb-crumb-step { display: none; }
        @container hbk (min-width: 640px) { .hb-crumb-step { display: inline; } }
        @container hbk (min-width: 768px) { .hb-page { padding: 22px 24px 30px; } .hb-crumb { padding: 0 24px; } .hb-video-mobile { max-width: 430px; margin: 0 auto; width: 100%; } }
        @container hbk (min-width: 1024px) {
          .hb-page { padding: 26px 32px 40px; }
          .hb-crumb { padding: 0 32px; }
          .hb-detail-grid { display: grid; grid-template-columns: 1fr 380px; gap: 40px; align-items: start; }
          .hb-video-mobile { display: none; }
          .hb-video-desktop { display: block; }
          .hb-cta-desktop { display: block; }
          .hb-cta-mobile { display: none; }
        }
        @container hbk (min-width: 1280px) { .hb-detail-grid { grid-template-columns: 1fr 440px; gap: 56px; } }
        a:focus-visible, button:focus-visible { outline: 2px solid ${HB.teal}; outline-offset: 2px; }
      `}</style>
    </div>
  );
}
