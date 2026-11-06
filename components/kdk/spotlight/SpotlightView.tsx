// MATCH SPOTLIGHT 표시 — 공개 페이지(/club/spotlight/[slug])와 운영진 미리보기가 공유.
//   hook 없음(서버 컴포넌트에서도 렌더). 접기는 <details>(JS 없이 동작).
//   입력은 parsePublicSpotlightPayload 를 거친 allow-list DTO 만. 숫자 확률 없음(1차 정책).
//   긴 이름: 말줄임 대신 줄바꿈(overflow-wrap:anywhere) — 첫 글자 잘림·카드 넘침 방지.

import React from 'react';
import type { PublicMatchAnalysis, PublicSpotlightItem, PublicSpotlightPayload } from '@/lib/kdk/analytics/publicSpotlight';
import { OPERATOR_PICK_LABEL, OPERATOR_POINT_NOTICE, SPOTLIGHT_BADGE_LABEL } from '@/lib/kdk/analytics/publicSpotlight';
import type { SpotlightType } from '@/lib/kdk/analytics/spotlight';

const C = {
  bg: '#F4F8FC', card: '#FFFFFF', text: '#0F2747', sub: '#5B6B80', faint: '#94A3B8',
  border: 'rgba(15,39,71,0.09)', teal: '#0D9488', navy: '#0F2747', gold: '#B8891C',
};

// 배지 배경은 불투명 — 카드 상단 navy 띠 위에서도 대비 유지(반투명이면 navy 와 섞여 글자가 묻힘).
const BADGE_TONE: Record<SpotlightType, { color: string; bg: string; border: string }> = {
  RIVAL: { color: '#B91C1C', bg: '#FDECEC', border: 'rgba(220,38,38,0.28)' },
  HOT_STREAK: { color: '#C2410C', bg: '#FFF1E6', border: 'rgba(234,88,12,0.28)' },
  CLOSE: { color: '#0F766E', bg: '#E6F6F4', border: 'rgba(13,148,136,0.28)' },
  POWER: { color: '#1D4ED8', bg: '#EAF0FD', border: 'rgba(29,78,216,0.26)' },
};

const wrapText: React.CSSProperties = { overflowWrap: 'anywhere', wordBreak: 'keep-all', minWidth: 0 };

function Badge({ type }: { type: SpotlightType }) {
  const t = BADGE_TONE[type];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: 999, fontSize: 11, fontWeight: 900, letterSpacing: '0.06em', color: t.color, background: t.bg, border: `1px solid ${t.border}`, whiteSpace: 'nowrap' }}>
      {SPOTLIGHT_BADGE_LABEL[type]}
    </span>
  );
}

function PickBadge() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: 999, fontSize: 11, fontWeight: 900, letterSpacing: '0.04em', color: '#0F2747', background: '#E9D8A6', border: '1px solid rgba(184,137,28,0.45)', whiteSpace: 'nowrap' }}>
      {OPERATOR_PICK_LABEL}
    </span>
  );
}

/** 운영진 관전 포인트 — 공식 분석과 구분(금색 테두리 · "운영진" 라벨). 운영진이 승인한 문구 그대로. */
function OperatorPoint({ text }: { text: string }) {
  return (
    <div style={{ borderRadius: 12, padding: '10px 12px', background: '#FFF9EA', border: '1px solid rgba(184,137,28,0.32)', borderLeft: '4px solid #B8891C' }}>
      <div style={{ fontSize: 11, fontWeight: 900, color: C.gold, letterSpacing: '0.06em', marginBottom: 3 }}>운영진 관전 포인트</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, lineHeight: 1.5, ...wrapText }}>{text}</div>
    </div>
  );
}

function predictionText(m: PublicMatchAnalysis): { text: string; tone: string } {
  if (m.prediction.kind === 'insufficient') return { text: '데이터 부족', tone: C.faint };
  return { text: m.prediction.text, tone: m.prediction.text === '박빙' ? C.teal : C.navy };
}

function sampleText(m: PublicMatchAnalysis): string {
  const parts: string[] = [];
  if (m.sampleRange) {
    parts.push(m.sampleRange.min === m.sampleRange.max
      ? `선수별 공식 ${m.sampleRange.min}경기`
      : `선수별 공식 ${m.sampleRange.min}~${m.sampleRange.max}경기`);
  }
  if (m.unanalyzedPlayers > 0) parts.push(`분석 제외 ${m.unanalyzedPlayers}명`);
  parts.push(`신뢰도 ${m.confidence}`);
  return parts.join(' · ');
}

function Teams({ m, size = 15 }: { m: PublicMatchAnalysis; size?: number }) {
  const team = (names: [string, string], label: string) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: C.faint, letterSpacing: '0.1em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: size, fontWeight: 800, color: C.text, lineHeight: 1.35, ...wrapText }}>
        {names.filter(Boolean).join(' · ') || '미정'}
      </div>
    </div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {team(m.teamA, 'TEAM A')}
      <span aria-hidden style={{ flexShrink: 0, fontSize: 11, fontWeight: 900, color: '#FFFFFF', background: C.navy, borderRadius: 6, padding: '3px 7px', letterSpacing: '0.08em' }}>VS</span>
      <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: C.faint, letterSpacing: '0.1em', marginBottom: 2 }}>TEAM B</div>
        <div style={{ fontSize: size, fontWeight: 800, color: C.text, lineHeight: 1.35, ...wrapText }}>
          {m.teamB.filter(Boolean).join(' · ') || '미정'}
        </div>
      </div>
    </div>
  );
}

function matchMeta(m: PublicMatchAnalysis): string {
  return [`R${m.round}`, `${m.matchNo}경기`, m.group ? `${m.group}조` : ''].filter(Boolean).join(' · ');
}

function SpotlightCard({ item, rank }: { item: PublicSpotlightItem; rank: number }) {
  const p = predictionText(item);
  return (
    <article style={{ background: C.card, borderRadius: 18, border: `1px solid ${C.border}`, boxShadow: '0 4px 16px rgba(15,39,71,0.06)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'linear-gradient(90deg, #0F2747 0%, #17375F 100%)', color: '#FFFFFF' }}>
        <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.08em', color: '#E9D8A6' }}>#{rank}</span>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', opacity: 0.92, flex: 1, minWidth: 0, ...wrapText }}>{matchMeta(item)}</span>
        {item.operatorPick && <PickBadge />}
        <Badge type={item.badge} />
      </div>
      <div style={{ padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Teams m={item} />
        <div style={{ background: C.bg, borderRadius: 12, padding: '10px 12px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 900, color: C.faint, letterSpacing: '0.06em', marginBottom: 3 }}>공식 KDK 기록 분석</div>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: C.text, marginBottom: 3, ...wrapText }}>{item.headline}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, lineHeight: 1.5, ...wrapText }}>{item.viewpoint}</div>
        </div>
        {item.operatorPoint && <OperatorPoint text={item.operatorPoint} />}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px' }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: p.tone }}>{p.text}</span>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: C.faint, ...wrapText }}>{sampleText(item)}</span>
        </div>
      </div>
    </article>
  );
}

function MatchRow({ m }: { m: PublicMatchAnalysis }) {
  const p = predictionText(m);
  return (
    <div style={{ padding: '12px 0', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: C.sub }}>{matchMeta(m)}</span>
        {m.badge && <Badge type={m.badge} />}
        <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 900, color: p.tone }}>{p.text}</span>
      </div>
      <Teams m={m} size={13.5} />
      <div style={{ fontSize: 11, fontWeight: 600, color: C.faint, ...wrapText }}>{sampleText(m)}</div>
      {m.operatorPoint && <OperatorPoint text={m.operatorPoint} />}
    </div>
  );
}

export default function SpotlightView({ payload }: { payload: PublicSpotlightPayload }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section aria-label="오늘의 주목 경기" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {payload.items.length === 0 ? (
          <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: '20px 16px', textAlign: 'center', fontSize: 13.5, fontWeight: 700, color: C.sub, lineHeight: 1.6, ...wrapText }}>
            오늘은 공식 기록상 특별히 주목할 경기가 선정되지 않았습니다.<br />아래 전체 경기 분석을 확인해 보세요.
          </div>
        ) : payload.items.map((it, i) => <SpotlightCard key={`${it.matchNo}-${i}`} item={it} rank={i + 1} />)}
      </section>

      <details style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: '0 14px' }}>
        <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '14px 0', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 900, color: C.text }}>
          <span style={{ flex: 1 }}>전체 경기 분석</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>{payload.matches.length}경기 · 펼쳐 보기</span>
        </summary>
        <div style={{ paddingBottom: 6 }}>
          {payload.matches.length === 0
            ? <div style={{ padding: '12px 0', fontSize: 12.5, color: C.faint }}>분석 가능한 경기가 없습니다.</div>
            : payload.matches.map((m) => <MatchRow key={m.matchNo} m={m} />)}
        </div>
      </details>

      <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: C.faint, lineHeight: 1.6, textAlign: 'center', ...wrapText }}>
        {payload.disclaimer}<br />우세 · 박빙은 과거 공식 기록 기반 설명이며, 게스트 등 기록이 확인되지 않는 선수는 분석에서 제외됩니다.
        {payload.matches.some((m) => m.operatorPoint) || payload.items.some((m) => m.operatorPoint) ? <><br />{OPERATOR_POINT_NOTICE}</> : null}
      </p>
    </div>
  );
}
