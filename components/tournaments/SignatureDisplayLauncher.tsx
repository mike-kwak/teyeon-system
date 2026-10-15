'use client';

// TEYEON OPEN · Signature 전광판 진입 (Admin 대회 운영 화면 · Control Center 전용).
//
//   운영진이 주소를 입력하지 않고 Signature 전광판 3종을 새 탭으로 연다. 전광판마다 두 가지 실행 방법:
//     실전 화면   — 지금 보고 있는 대회의 운영 데이터(읽기 전용 · CEO/ADMIN 만 경기 정보가 보인다)
//       예선 전광판   → /tournaments/{slug}/signature/prelim?view=focus
//       본선 전광판   → /tournaments/{slug}/signature/knockout?view=focus
//       코트 현황판   → /tournaments/{slug}/signature/courts?layout=2x5
//     테스트 화면 — 가상 fixture 만 쓰는 디자인 Demo(대진 확정 전에도 열린다 · 실제 대회 데이터를 읽거나 쓰지 않는다)
//       예선 전광판   → /tournaments/arena-design/signature/prelim?view=focus
//       본선 전광판   → /tournaments/arena-design/signature?view=focus
//       코트 현황판   → /tournaments/arena-design/signature/courts?layout=2x5
//     테스트 화면은 캔버스에 'DEMO · TEST DATA' 가 작게 보인다. 실전 화면에는 없다.
//   ⚠ 링크(<a target="_blank">)로만 연다 — 사용자의 탭 동작 그대로라 모바일 · 태블릿의 팝업 차단에 걸리지 않는다.
//     기존 관리 화면(Control Center 등)은 원래 탭에 그대로 남는다.
//   ⚠ slug 는 지금 보고 있는 대회의 값을 받는다(특정 대회를 박지 않는다). 테스트 화면 주소에는 slug 가 없다(대회와 무관한 가상 데이터).
//   ⚠ 보안은 이 버튼이 아니다 — /admin/** 는 서버(middleware)가 CEO/ADMIN 만 들이고,
//     전광판 데이터는 운영 RPC 가 CEO/ADMIN 에게만 준다. 이 컴포넌트는 길 안내만 한다.
//   ⚠ 기존 운영 Arena(ARENA TV 열기)를 바꾸거나 대신하지 않는다 — 추가 선택지다.

import React from 'react';
import { FlaskConical, LayoutGrid, MonitorPlay, Radio, Trophy } from 'lucide-react';

const INK = '#0F172A';
const INK_SOFT = '#334155';
const MUTED = '#64748B';
const FAINT = '#94A3B8';
const LINE = '#E2E8F0';
const NAVY = '#102A3D';
const LABEL = 'var(--font-rajdhani), sans-serif';

/** 테스트 화면(가상 fixture Demo) 경로 — 대회 slug 와 무관하다. */
export const SIGNATURE_TEST_BASE = '/tournaments/arena-design/signature';

export type SignatureDisplayKey = 'prelim' | 'knockout' | 'courts';

export interface SignatureDisplayLink {
  key: SignatureDisplayKey;
  title: string;
  desc: string;
  note: string;
  /** 실전 화면(운영 데이터 · 읽기 전용). */
  liveHref: string;
  /** 테스트 화면(가상 fixture). */
  testHref: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
}

/** 대회 slug → 전광판 3종의 실전 · 테스트 주소. encodeURIComponent 로 slug 를 안전하게 넣는다. */
export function signatureDisplayLinks(slug: string): SignatureDisplayLink[] {
  const base = `/tournaments/${encodeURIComponent(slug)}/signature`;
  return [
    {
      key: 'prelim', title: '예선 전광판', desc: '조별 순위 · 진행 현황', note: '코트 포함 모드는 전광판 안에서 바꿀 수 있습니다.',
      liveHref: `${base}/prelim?view=focus`, testHref: `${SIGNATURE_TEST_BASE}/prelim?view=focus`, Icon: LayoutGrid,
    },
    {
      key: 'knockout', title: '본선 전광판', desc: '전체 대진표 · 경기 결과', note: '코트 포함 모드는 전광판 안에서 바꿀 수 있습니다.',
      liveHref: `${base}/knockout?view=focus`, testHref: `${SIGNATURE_TEST_BASE}?view=focus`, Icon: Trophy,
    },
    {
      key: 'courts', title: '코트 현황판', desc: '10개 코트 · NOW / NEXT', note: '5열 × 2행은 전광판 안에서 바꿀 수 있습니다. NEXT 는 지정 기능 전까지 ‘미정’입니다.',
      liveHref: `${base}/courts?layout=2x5`, testHref: `${SIGNATURE_TEST_BASE}/courts?layout=2x5`, Icon: MonitorPlay,
    },
  ];
}

const btnBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  minHeight: 40, padding: '8px 10px', borderRadius: 9, boxSizing: 'border-box',
  fontSize: 13, fontWeight: 800, textDecoration: 'none', cursor: 'pointer', textAlign: 'center', whiteSpace: 'nowrap',
};
const liveBtn: React.CSSProperties = { ...btnBase, border: `1px solid ${NAVY}`, background: NAVY, color: '#fff' };
const testBtn: React.CSSProperties = { ...btnBase, border: '1px dashed #94A3B8', background: '#fff', color: INK_SOFT };

/**
 * @param variant  section = 설명 카드 3장(대회 운영 화면) · compact = 한 줄(Control Center — 관제 화면을 밀어내지 않게)
 */
export default function SignatureDisplayLauncher({ slug, variant = 'section' }: {
  slug: string; variant?: 'section' | 'compact';
}) {
  if (!slug) return null;
  const links = signatureDisplayLinks(slug);

  if (variant === 'compact') {
    return (
      <div data-signature-launcher="compact" style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0,
        background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '9px 12px',
      }}>
        <span style={{ fontFamily: LABEL, fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', color: FAINT, whiteSpace: 'nowrap' }}>
          SIGNATURE 전광판
        </span>
        {links.map((l) => (
          <span key={l.key} data-signature-group={l.key} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0,
            border: `1px solid ${LINE}`, borderRadius: 9, padding: 3, background: '#F8FAFC',
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 6px', fontSize: 12, fontWeight: 800, color: INK_SOFT, whiteSpace: 'nowrap' }}>
              <l.Icon size={14} strokeWidth={2.3} />{l.title}
            </span>
            <a href={l.liveHref} target="_blank" rel="noopener noreferrer" data-signature-open={l.key} data-signature-mode="live"
              title={`${l.title} 실전 화면(운영 데이터) — 새 탭에서 열립니다`}
              style={{ ...liveBtn, minHeight: 32, padding: '5px 9px', fontSize: 12 }}>
              실전
            </a>
            <a href={l.testHref} target="_blank" rel="noopener noreferrer" data-signature-open={l.key} data-signature-mode="test"
              title={`${l.title} 테스트 화면(가상 데이터) — 새 탭에서 열립니다`}
              style={{ ...testBtn, minHeight: 32, padding: '5px 9px', fontSize: 12 }}>
              테스트
            </a>
          </span>
        ))}
      </div>
    );
  }

  return (
    <section data-signature-launcher="section" aria-labelledby="signature-launcher-title" style={{
      background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 15, marginBottom: 10,
    }}>
      <p style={{ margin: 0, fontFamily: LABEL, fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', color: FAINT }}>
        DISPLAY BOARD
      </p>
      <h2 id="signature-launcher-title" style={{ margin: '3px 0 0', fontSize: 15.5, fontWeight: 900, color: INK }}>
        TEYEON OPEN · 전광판
      </h2>
      <p style={{ margin: '4px 0 12px', fontSize: 12.5, fontWeight: 600, color: MUTED, lineHeight: 1.6 }}>
        대회 진행 상황을 TV 또는 외부 모니터에 표시합니다. 새 탭에서 열린 뒤, 전광판 안의 ‘전체화면’ 버튼을 눌러 주세요.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
        {links.map((l) => (
          <div key={l.key} data-signature-card={l.key} style={{
            display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
            border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, background: '#F8FAFC',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
              <span aria-hidden style={{
                width: 34, height: 34, flexShrink: 0, borderRadius: 9, display: 'grid', placeItems: 'center',
                background: '#fff', border: `1px solid ${LINE}`,
              }}>
                <l.Icon size={18} strokeWidth={2.2} color={NAVY} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: INK }}>{l.title}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>{l.desc}</div>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: FAINT, lineHeight: 1.55, wordBreak: 'keep-all' }}>{l.note}</p>
            {/* 카드가 좁으면(태블릿 3열 등) 두 버튼을 위아래로 쌓는다 — 글자가 겹치거나 잘리지 않게. */}
            <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 6 }}>
              <a href={l.liveHref} target="_blank" rel="noopener noreferrer" data-signature-open={l.key} data-signature-mode="live"
                title="운영 데이터 · 새 탭" style={liveBtn}>
                <Radio size={13} strokeWidth={2.4} />
                실전 화면 열기
              </a>
              <a href={l.testHref} target="_blank" rel="noopener noreferrer" data-signature-open={l.key} data-signature-mode="test"
                title="가상 데이터 · 새 탭" style={testBtn}>
                <FlaskConical size={13} strokeWidth={2.4} />
                테스트 화면 열기
              </a>
            </div>
          </div>
        ))}
      </div>
      <div style={{ margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, fontWeight: 600, color: FAINT, lineHeight: 1.55, wordBreak: 'keep-all' }}>
        <span><b style={{ color: INK_SOFT }}>실전 화면</b> — 이 대회의 운영 데이터를 읽기만 합니다. CEO · ADMIN 계정으로 로그인한 브라우저에서만 경기 정보가 보입니다.</span>
        <span><b style={{ color: INK_SOFT }}>테스트 화면</b> — 가상 데이터로 디자인을 확인합니다(대진 확정 전에도 열림 · ‘DEMO · TEST DATA’ 표시). 실제 대회 데이터에 영향이 없습니다.</span>
        <span>기존 ARENA TV 화면도 그대로 사용할 수 있습니다.</span>
      </div>
    </section>
  );
}
