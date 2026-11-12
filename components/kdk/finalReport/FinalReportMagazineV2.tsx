// TEYEON KDK FINAL REPORT — SPORTS MAGAZINE v2.1(edition 2 공개본 전용 · 서버 컴포넌트 · 클라이언트 상태 없음).
//   COVER(헤드라인 · 우승자 한 줄) → THE PODIUM(챔피언 큰 숫자 · 2 · 3위 압축) → THE RECORDS(중복 제외) → MATCH REVIEW → FINAL STANDINGS → CLOSING.
//   ⚠ 표시만 한다: 헤드라인 · 기록 카드 · 선수 기록 · 경기 노트는 서버가 발행 때 공식 기록으로 만든 값(공개본) 그대로.
//     순위 · 승패 · 점수 재계산 · 재정렬 없음. 운영진 문구는 있을 때만, 없으면 기록 한 줄로 대신한다(문장 지어내기 없음).
//   v2.1 원칙: 같은 기록을 여러 곳에 반복하지 않는다 — 우승자 배지는 PODIUM 에만, 우승자 단독 기록은 RECORDS 에서 제외.
//   v1 공개본(edition 없음)은 FinalReportMagazine 의 기존 화면이 그대로 그린다.

import React from 'react';
import FinalReportShareButtons from './FinalReportShareButtons';
import { Closing, GroupChip, Section, Standings, TONE, TeamRow, text, wrap } from './FinalReportMagazine';
import type { ShareData } from '@/lib/kdk/finalReport/finalReportShare';
import type { FinalReportPublicPayload, PublicFeatured, PublicPodium } from '@/lib/kdk/finalReport/finalReportModel';
import type { PublicHighlight, PublicPlayerRecord } from '@/lib/kdk/finalReport/finalReportStory';
import {
  CLOSING_DEFAULT, FRV, FRV_DISPLAY, FRV_SERIF, PODIUM_LABEL, RESULT_LABEL, badgeLabel, chaptersOfV2, closeSummary, formatDiff, formatReportDate,
  heroIndex, matchFallbackLine, matchMeta, matchWinner, recordsView, tagList, type Chapter,
} from '@/lib/kdk/finalReport/finalReportView';

const SILVER = '#7F8D9C';
const SILVER_WASH = '#F3F6F9';
const BRONZE = '#A8743F';

export default function FinalReportMagazineV2({ payload, officialHref, share }: { payload: FinalReportPublicPayload; officialHref: string | null; share: ShareData | null }) {
  const chapters = chaptersOfV2(payload);
  const ch = (id: Chapter['id']) => chapters.find((c) => c.id === id) as Chapter;
  const rv = recordsView(payload);
  return (
    <main data-fr="magazine" data-fr-edition="2"
      style={{ minHeight: '100dvh', width: '100%', background: FRV.bg, color: FRV.ink, overflowX: 'hidden', boxSizing: 'border-box' }}>
      <CoverV2 payload={payload} chapters={chapters} share={share} />
      <div style={{ ...wrap, padding: '0 16px' }}>
        <Section chapter={ch('podium')}>
          <PodiumV2 rows={payload.podium} />
        </Section>
        {rv.any && (
          <Section chapter={ch('records')}>
            <Records players={rv.players} matchStats={rv.matchStats} />
          </Section>
        )}
        {payload.featured.length > 0 && (
          <Section chapter={ch('review')}>
            <ReviewV2 featured={payload.featured} mode={payload.featuredMode === 'manual' ? 'manual' : 'auto'} summary={closeSummary(payload)} />
          </Section>
        )}
        <Section chapter={ch('standings')}>
          <Standings rows={payload.standings} />
        </Section>
      </div>
      <Closing payload={payload} officialHref={officialHref} share={share} defaultText={CLOSING_DEFAULT} />
    </main>
  );
}

// ── 공통 조각 ─────────────────────────────────────────────────────────────────
function Badges({ rec, rank, onDark }: { rec: PublicPlayerRecord | null | undefined; rank: number; onDark?: boolean }) {
  if (!rec || rec.badges.length === 0) return null;
  return (
    <div data-fr="badges" style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {rec.badges.map((b) => (
        <span key={b.kind} data-fr-badge={b.kind} data-joint={b.joint ? '1' : '0'} style={{
          display: 'inline-flex', alignItems: 'center', minHeight: 22, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 900, letterSpacing: '0.02em',
          color: onDark ? FRV.navyDeep : FRV.goldInk, background: onDark ? FRV.goldSoft : FRV.goldWash, border: `1px solid ${onDark ? FRV.gold : 'rgba(201,162,75,0.45)'}`,
        }}>{badgeLabel(b, rank)}</span>
      ))}
    </div>
  );
}
function resultTone(r: 'W' | 'L' | 'D', onDark?: boolean): React.CSSProperties {
  if (r === 'W') return { color: onDark ? FRV.navyDeep : '#FFFFFF', background: onDark ? FRV.goldSoft : FRV.navy };
  if (r === 'L') return { color: onDark ? FRV.onNavySub : FRV.muted, background: onDark ? 'rgba(255,255,255,0.08)' : FRV.lineSoft };
  return { color: onDark ? FRV.onNavy : FRV.sub, background: onDark ? 'rgba(255,255,255,0.14)' : FRV.line };
}
/** 운영진 스토리 = 인용구. 없으면 기록 한 줄. */
function Quote({ story, summary, onDark, size = 'lg' }: { story: string | null; summary: string | null | undefined; onDark?: boolean; size?: 'lg' | 'sm' }) {
  if (story) {
    return (
      <blockquote data-fr="story" style={{ ...text, margin: '16px 0 0', padding: size === 'lg' ? '2px 0 0 18px' : '0 0 0 14px', position: 'relative', borderLeft: `${size === 'lg' ? 3 : 2}px solid ${FRV.gold}`,
        fontFamily: FRV_SERIF, fontSize: size === 'lg' ? 17.5 : 14.5, fontWeight: size === 'lg' ? 600 : 500, lineHeight: 1.6, color: onDark ? '#FFFFFF' : FRV.ink }}>
        {story}
      </blockquote>
    );
  }
  if (!summary) return null;
  return (
    <p data-fr="story-record" style={{ ...text, margin: '14px 0 0', fontSize: 13, fontWeight: 700, lineHeight: 1.5, color: onDark ? FRV.onNavySub : FRV.muted }}>
      <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '0.14em', marginRight: 6, color: onDark ? FRV.goldSoft : FRV.goldInk }}>RECORD</span>{summary}
    </p>
  );
}

// ── COVER ─────────────────────────────────────────────────────────────────────
function CoverV2({ payload, chapters, share }: { payload: FinalReportPublicPayload; chapters: Chapter[]; share: ShareData | null }) {
  const s = payload.session;
  const champ = payload.podium[0];
  return (
    <header data-fr="cover" style={{
      width: '100%', color: FRV.onNavy, position: 'relative', overflow: 'hidden',
      background: `radial-gradient(120% 70% at 85% 0%, rgba(227,199,126,0.18) 0%, rgba(227,199,126,0) 55%), linear-gradient(180deg, ${FRV.navy} 0%, ${FRV.navyDeep} 100%)`,
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)', paddingBottom: 32,
    }}>
      <div style={{ ...wrap, padding: '0 20px' }}>
        {/* 좁은 화면(320px)에서는 오른쪽 라벨이 다음 줄로 내려간다(겹침 방지). */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 10, rowGap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/teyeon-logo-transparent.png" alt="" width={28} height={28} style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }} />
            <span data-fr="brand" style={{ fontFamily: FRV_DISPLAY, fontWeight: 700, fontSize: 13.5, letterSpacing: '0.24em', color: FRV.goldSoft, whiteSpace: 'nowrap' }}>TEYEON MAGAZINE</span>
          </div>
          <span data-fr="brand-sub" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: FRV.onNavySub, whiteSpace: 'nowrap', flexShrink: 0 }}>KDK FINAL REPORT</span>
        </div>

        <div style={{ marginTop: 36, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ height: 1, width: 30, background: FRV.gold, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.24em', color: FRV.goldSoft }}>THE FINAL STORY</span>
        </div>
        <p data-fr="session" style={{ ...text, margin: '8px 0 0', fontSize: 13, fontWeight: 700, lineHeight: 1.45, color: FRV.onNavySub }}>
          {[s.date ? formatReportDate(s.date) : '', s.title || 'TEYEON KDK'].filter(Boolean).join(' · ')}
        </p>
        {/* 화면에서 가장 강한 요소 = 헤드라인 */}
        {payload.headline && (
          <h1 data-fr="headline" style={{ ...text, margin: '14px 0 0', fontFamily: FRV_SERIF, fontWeight: 700, fontSize: 'clamp(30px, 9vw, 42px)', lineHeight: 1.2, letterSpacing: '-0.02em', color: '#FFFFFF' }}>
            {payload.headline}
          </h1>
        )}

        {/* 우승자: 이름 + 핵심 기록 한 줄(배지는 PODIUM 에서만) */}
        {champ && (
          <div data-fr="cover-champion" style={{ marginTop: 22, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', padding: '12px 0', borderTop: `1px solid ${FRV.navyLine}`, borderBottom: `1px solid ${FRV.navyLine}` }}>
            <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '0.22em', color: FRV.goldSoft, flexShrink: 0 }}>CHAMPION</span>
            <span data-fr="cover-champion-name" style={{ ...text, fontSize: 'clamp(19px, 5.6vw, 23px)', fontWeight: 900, lineHeight: 1.3, color: '#FFFFFF', minWidth: 0 }}>{champ.name}</span>
            <span data-fr="cover-champion-record" style={{ ...text, fontSize: 13, fontWeight: 800, color: FRV.goldSoft }}>
              {champ.record?.summary || `${champ.wins}승 ${champ.losses}패 · 득실 ${formatDiff(champ.diff)}`}
            </span>
          </div>
        )}

        {payload.opening && (
          <p data-fr="opening" style={{ ...text, margin: '20px 0 0', paddingLeft: 12, borderLeft: `2px solid ${FRV.gold}`, fontFamily: FRV_SERIF, fontSize: 15.5, lineHeight: 1.6, color: FRV.onNavy }}>
            {payload.opening}
          </p>
        )}

        <div data-fr="cover-stats" style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', border: `1px solid ${FRV.navyLine}`, borderRadius: 14 }}>
          <CoverStatV2 label="참가" value={String(s.participantCount)} unit="명" />
          <CoverStatV2 label="경기" value={String(s.matchCount)} unit="경기" divider />
          <CoverStatV2 label="기록" value="공식" unit="확정" divider />
        </div>

        <nav aria-label="챕터" style={{ marginTop: 22, display: 'grid', gap: 2 }}>
          {chapters.map((c) => (
            <a key={c.id} href={`#fr-${c.id}`} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', color: FRV.onNavy, textDecoration: 'none', borderTop: `1px solid ${FRV.navyLine}` }}>
              <span style={{ fontFamily: FRV_DISPLAY, fontWeight: 700, fontSize: 12, letterSpacing: '0.12em', color: FRV.goldSoft, width: 22, flexShrink: 0 }}>{c.no}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '0.14em', whiteSpace: 'nowrap' }}>{c.title}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, color: FRV.onNavySub, textAlign: 'right', minWidth: 0 }}>{c.kicker}</span>
            </a>
          ))}
        </nav>
        {share && <div style={{ marginTop: 18 }}><FinalReportShareButtons data={share} variant="cover" /></div>}
      </div>
    </header>
  );
}
function CoverStatV2({ label, value, unit, divider }: { label: string; value: string; unit: string; divider?: boolean }) {
  return (
    <div style={{ padding: '10px 4px', textAlign: 'center', borderLeft: divider ? `1px solid ${FRV.navyLine}` : undefined, minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: FRV.onNavySub }}>{label}</div>
      <div style={{ marginTop: 2, whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: FRV_DISPLAY, fontSize: 20, fontWeight: 700, color: '#FFFFFF' }}>{value}</span>
        <span style={{ marginLeft: 2, fontSize: 11, fontWeight: 700, color: FRV.goldSoft }}>{unit}</span>
      </div>
    </div>
  );
}

// ── THE PODIUM ────────────────────────────────────────────────────────────────
function PodiumV2({ rows }: { rows: PublicPodium[] }) {
  const [first, second, third] = rows;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {first && <ChampionCardV2 p={first} />}
      {second && <RunnerUpCard p={second} />}
      {third && <ThirdCard p={third} />}
    </div>
  );
}
/** 경기별 기록(라운드 · 승패 · 점수 · 파트너 · 상대). */
function MatchLog({ rec, onDark }: { rec: PublicPlayerRecord | null | undefined; onDark?: boolean }) {
  if (!rec || rec.matches.length === 0) return null;
  return (
    <ol data-fr="match-log" style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 6 }}>
      {rec.matches.map((m, i) => (
        <li key={i} data-fr="match-log-row" style={{
          display: 'grid', gridTemplateColumns: '26px 26px auto minmax(0, 1fr)', gap: 8, alignItems: 'center',
          padding: '7px 8px', borderRadius: 10, background: onDark ? 'rgba(255,255,255,0.05)' : '#F7F9FB', border: `1px solid ${onDark ? FRV.navyLine : FRV.lineSoft}`,
        }}>
          <span style={{ fontFamily: FRV_DISPLAY, fontSize: 12.5, fontWeight: 700, color: onDark ? FRV.goldSoft : FRV.goldInk, whiteSpace: 'nowrap' }}>{m.round != null ? `R${m.round}` : '–'}</span>
          <span data-fr-result={m.result} style={{ ...resultTone(m.result, onDark), display: 'grid', placeItems: 'center', height: 22, borderRadius: 6, fontSize: 11.5, fontWeight: 900 }}>{RESULT_LABEL[m.result]}</span>
          <span style={{ fontFamily: FRV_DISPLAY, fontSize: 17, fontWeight: 700, color: onDark ? '#FFFFFF' : FRV.ink, whiteSpace: 'nowrap' }}>{m.scoreFor}:{m.scoreAgainst}</span>
          <span style={{ ...text, fontSize: 12, fontWeight: 600, lineHeight: 1.4, color: onDark ? FRV.onNavySub : FRV.muted, minWidth: 0 }}>
            {m.partner && <>파트너 <b style={{ fontWeight: 800, color: onDark ? FRV.onNavy : FRV.sub }}>{m.partner}</b> · </>}
            상대 {m.opponents.filter(Boolean).join('·')}
          </span>
        </li>
      ))}
    </ol>
  );
}
/** 라운드별 결과 칩(압축) — 2 · 3위. */
function ResultChips({ rec }: { rec: PublicPlayerRecord | null | undefined }) {
  if (!rec || rec.matches.length === 0) return null;
  return (
    <div data-fr="result-chips" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {rec.matches.map((m, i) => (
        <span key={i} data-fr-chip={m.result} title={`${m.round != null ? `R${m.round} ` : ''}${m.scoreFor}:${m.scoreAgainst}`} style={{
          ...resultTone(m.result), display: 'inline-flex', alignItems: 'baseline', gap: 4, height: 26, padding: '0 8px', borderRadius: 7, fontSize: 11.5, fontWeight: 900, lineHeight: '26px', whiteSpace: 'nowrap',
        }}>
          {RESULT_LABEL[m.result]}<span style={{ fontFamily: FRV_DISPLAY, fontSize: 12.5, fontWeight: 700, opacity: 0.85 }}>{m.scoreFor}:{m.scoreAgainst}</span>
        </span>
      ))}
    </div>
  );
}
/** 상세 경기 기록 접기/펼치기(기본 접힘 · 스크립트 없이 details). */
function LogToggle({ rec }: { rec: PublicPlayerRecord | null | undefined }) {
  if (!rec || rec.matches.length === 0) return null;
  return (
    <details data-fr="log-toggle" style={{ marginTop: 10 }}>
      <summary style={{ listStyle: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', minHeight: 32, fontSize: 12, fontWeight: 800, color: FRV.sub }}>
        경기별 파트너 · 상대 보기 ▾
      </summary>
      <MatchLog rec={rec} />
    </details>
  );
}
function ChampionCardV2({ p }: { p: PublicPodium }) {
  return (
    <article data-fr="champion" style={{
      position: 'relative', borderRadius: 20, padding: '18px 16px 16px', color: FRV.onNavy, overflow: 'hidden',
      background: `radial-gradient(90% 80% at 100% 0%, rgba(227,199,126,0.22) 0%, rgba(227,199,126,0) 60%), linear-gradient(160deg, ${FRV.navy} 0%, ${FRV.navyDeep} 100%)`,
      border: '1px solid rgba(201,162,75,0.55)', boxShadow: '0 14px 34px rgba(6,17,31,0.22)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: FRV_DISPLAY, fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: FRV.navyDeep, background: FRV.goldSoft, borderRadius: 6, padding: '2px 7px' }}>NO.1</span>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.26em', color: FRV.goldSoft }}>{PODIUM_LABEL[1]}</span>
        <span style={{ marginLeft: 'auto' }}><GroupChip group={p.group} onDark /></span>
      </div>
      <p style={{ ...text, margin: '12px 0 0', fontSize: 'clamp(25px, 8vw, 33px)', fontWeight: 900, lineHeight: 1.18, letterSpacing: '-0.02em', color: '#FFFFFF' }}>{p.name}</p>
      {/* Hero Typography — 승-패 큰 숫자 + 득실 */}
      <div data-fr="hero-score" style={{ marginTop: 4, display: 'flex', alignItems: 'flex-end', gap: 18, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: FRV_DISPLAY, fontSize: 'clamp(58px, 18vw, 76px)', fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.02em', color: FRV.goldSoft, whiteSpace: 'nowrap' }}>
            {p.wins}<span style={{ color: 'rgba(227,199,126,0.55)', margin: '0 0.06em' }}>–</span>{p.losses}
          </div>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.2em', color: FRV.onNavySub }}>WIN – LOSS</div>
        </div>
        <div>
          <div style={{ fontFamily: FRV_DISPLAY, fontSize: 34, fontWeight: 700, lineHeight: 1.3, color: '#FFFFFF', whiteSpace: 'nowrap' }}>{formatDiff(p.diff)}</div>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.2em', color: FRV.onNavySub }}>DIFF</div>
        </div>
      </div>
      {p.record?.badges.length ? <div style={{ marginTop: 14 }}><Badges rec={p.record} rank={1} onDark /></div> : null}
      <Quote story={p.story} summary={p.record?.summary} onDark />
      {p.record && p.record.matches.length > 0 && (
        <p style={{ margin: '18px 0 0', fontSize: 10.5, fontWeight: 900, letterSpacing: '0.2em', color: FRV.goldSoft }}>ROAD TO THE TITLE</p>
      )}
      <MatchLog rec={p.record} onDark />
    </article>
  );
}
/** 2위 — 실버 · 밝은 바탕 카드(이름 · 성적 · 배지 · 결과 칩 · 접힌 상세). */
function RunnerUpCard({ p }: { p: PublicPodium }) {
  return (
    <article data-fr="place-2" style={{
      borderRadius: 18, padding: '15px 15px 13px', background: `linear-gradient(180deg, ${SILVER_WASH} 0%, #FFFFFF 70%)`,
      border: `1px solid ${FRV.line}`, borderLeft: `4px solid ${SILVER}`, boxShadow: '0 4px 14px rgba(18,35,58,0.07)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: FRV_DISPLAY, fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: '#FFFFFF', background: SILVER, borderRadius: 6, padding: '2px 7px' }}>NO.2</span>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.22em', color: SILVER }}>{PODIUM_LABEL[2]}</span>
        <span style={{ marginLeft: 'auto' }}><GroupChip group={p.group} /></span>
      </div>
      <p style={{ ...text, margin: '8px 0 0', fontSize: 22, fontWeight: 900, lineHeight: 1.25, color: FRV.ink }}>{p.name}</p>
      <p data-fr="place-record" style={{ ...text, margin: '2px 0 0', fontSize: 13, fontWeight: 800, color: FRV.sub }}>
        {p.record?.summary || `${p.wins}승 ${p.losses}패 · 득실 ${formatDiff(p.diff)}`}
      </p>
      {p.record?.badges.length ? <div style={{ marginTop: 8 }}><Badges rec={p.record} rank={2} /></div> : null}
      <div style={{ marginTop: 10 }}><ResultChips rec={p.record} /></div>
      {p.story && <Quote story={p.story} summary={null} size="sm" />}
      <LogToggle rec={p.record} />
    </article>
  );
}
/** 3위 — 브론즈 · 가장 압축된 카드. */
function ThirdCard({ p }: { p: PublicPodium }) {
  return (
    <article data-fr="place-3" style={{ borderRadius: 14, padding: '12px 14px 10px', background: FRV.surface, border: `1px solid ${FRV.line}`, borderLeft: `4px solid ${BRONZE}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: FRV_DISPLAY, fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', color: '#FFFFFF', background: BRONZE, borderRadius: 6, padding: '1px 6px' }}>NO.3</span>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.2em', color: BRONZE }}>{PODIUM_LABEL[3]}</span>
        <span style={{ marginLeft: 'auto' }}><GroupChip group={p.group} /></span>
      </div>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...text, fontSize: 18, fontWeight: 900, lineHeight: 1.3, color: FRV.ink, minWidth: 0 }}>{p.name}</span>
        <span data-fr="place-record" style={{ ...text, fontSize: 12.5, fontWeight: 800, color: FRV.sub }}>
          {p.record?.summary || `${p.wins}승 ${p.losses}패 · 득실 ${formatDiff(p.diff)}`}
        </span>
      </div>
      {p.record?.badges.length ? <div style={{ marginTop: 6 }}><Badges rec={p.record} rank={3} /></div> : null}
      <div style={{ marginTop: 8 }}><ResultChips rec={p.record} /></div>
      {p.story && <Quote story={p.story} summary={null} size="sm" />}
      <LogToggle rec={p.record} />
    </article>
  );
}

// ── THE RECORDS ───────────────────────────────────────────────────────────────
function Records({ players, matchStats }: { players: PublicHighlight[]; matchStats: PublicHighlight[] }) {
  return (
    <div data-fr="records" style={{ display: 'grid', gap: 8 }}>
      {players.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {players.map((h, i) => {
            const more = h.total - h.names.length;
            const wide = players.length % 2 === 1 && i === players.length - 1; // 홀수면 마지막 카드는 가로 전체
            return (
              <article key={h.kind} data-fr-record={h.kind} data-joint={h.joint ? '1' : '0'} data-wide={wide ? '1' : '0'} style={{
                gridColumn: wide ? '1 / -1' : undefined, minWidth: 0, borderRadius: 14, padding: '12px 12px 11px', background: FRV.surface, border: `1px solid ${FRV.line}`,
                boxShadow: '0 1px 2px rgba(18,35,58,0.04)',
              }}>
                <p style={{ ...text, margin: 0, fontSize: 11.5, fontWeight: 900, letterSpacing: '0.04em', color: FRV.goldInk }}>{h.label}</p>
                <p data-fr="record-value" style={{ ...text, margin: '4px 0 0', fontFamily: FRV_DISPLAY, fontSize: 25, fontWeight: 700, lineHeight: 1.2, color: FRV.ink }}>{h.value}</p>
                {h.names.length > 0 && (
                  <p data-fr="record-names" style={{ ...text, margin: '6px 0 0', fontSize: 12.5, fontWeight: 800, lineHeight: 1.4, color: FRV.sub }}>
                    {h.names.join(' · ')}{more > 0 ? ` 외 ${more}명` : ''}
                  </p>
                )}
                {h.joint && <p style={{ margin: '3px 0 0', fontSize: 11, fontWeight: 700, color: FRV.muted }}>공동 기록 · {h.total}명</p>}
              </article>
            );
          })}
        </div>
      )}
      {matchStats.length > 0 && (
        <article data-fr="record-matches" style={{ borderRadius: 14, padding: '12px 14px', background: FRV.navy, color: FRV.onNavy, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '0.18em', color: FRV.goldSoft }}>MATCH STATS</span>
          {matchStats.map((h) => (
            <span key={h.kind} data-fr-record={h.kind} data-joint="0" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: FRV.onNavySub }}>{h.label}</span>
              <span data-fr="record-value" style={{ fontFamily: FRV_DISPLAY, fontSize: 22, fontWeight: 700, lineHeight: 1.2, color: '#FFFFFF' }}>{h.value}</span>
            </span>
          ))}
        </article>
      )}
    </div>
  );
}

// ── MATCH REVIEW ──────────────────────────────────────────────────────────────
function ReviewV2({ featured, mode, summary }: { featured: PublicFeatured[]; mode: 'auto' | 'manual'; summary: string | null }) {
  const hi = heroIndex(featured);
  const hero = featured[hi];
  const rest = featured.filter((_, i) => i !== hi);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p data-fr="review-mode" data-mode={mode} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: FRV.muted, lineHeight: 1.5 }}>
        <span style={{
          flexShrink: 0, fontSize: 10.5, fontWeight: 900, letterSpacing: '0.06em', padding: '3px 8px', borderRadius: 999,
          ...(mode === 'manual' ? { color: '#FFFFFF', background: FRV.navy } : { color: FRV.teal, background: FRV.tealWash, border: '1px solid rgba(14,143,132,0.25)' }),
        }}>{mode === 'manual' ? '운영진 선정' : '기록 기준 추천'}</span>
        <span style={{ wordBreak: 'keep-all' }}>{mode === 'manual' ? '운영진이 고른 경기입니다.' : '1점 차 접전 · TOP3 맞대결 · 완봉 등 기록 특징이 다른 경기를 골랐습니다.'}</span>
      </p>
      {hero && <HeroMatch m={hero} />}
      {rest.map((m, i) => <CompactMatch key={i} m={m} />)}
      {summary && <p data-fr="close-summary" style={{ ...text, margin: '2px 0 0', fontSize: 12.5, fontWeight: 700, color: FRV.sub }}>{summary}</p>}
    </div>
  );
}
function Tags({ m }: { m: PublicFeatured }) {
  const tags = tagList(m.tags.filter((t) => t !== 'MATCH_OF_THE_DAY'));
  if (!tags.length) return null;
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {tags.map((t) => (
        <span key={t.key} data-fr-tag={t.key} style={{ ...TONE[t.tone], display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{t.label}</span>
      ))}
    </div>
  );
}
function HeroMatch({ m }: { m: PublicFeatured }) {
  const win = matchWinner(m);
  return (
    <article data-fr="match-hero" style={{
      borderRadius: 20, overflow: 'hidden', background: FRV.surface, border: '1px solid rgba(201,162,75,0.7)', boxShadow: '0 12px 28px rgba(138,106,32,0.13)',
    }}>
      <div style={{ padding: '12px 14px', background: `linear-gradient(160deg, ${FRV.navy} 0%, ${FRV.navyDeep} 100%)`, color: FRV.onNavy }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 900, letterSpacing: '0.24em', color: FRV.goldSoft }}>MATCH OF THE DAY</p>
        <p style={{ margin: '3px 0 0', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', color: FRV.onNavySub }}>{matchMeta(m) || 'KDK'}</p>
      </div>
      <div style={{ padding: '12px 14px 14px' }}>
        <Tags m={m} />
        <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          <TeamRow names={m.teamA} score={m.score1} state={win === 'A' ? 'win' : win === 'B' ? 'loss' : 'draw'} />
          <TeamRow names={m.teamB} score={m.score2} state={win === 'B' ? 'win' : win === 'A' ? 'loss' : 'draw'} />
        </div>
        <ReviewLine m={m} large />
      </div>
    </article>
  );
}
function CompactMatch({ m }: { m: PublicFeatured }) {
  const win = matchWinner(m);
  const side = (names: [string, string], score: number, on: boolean) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
      <span style={{ ...text, fontSize: 14, fontWeight: on ? 900 : 700, lineHeight: 1.35, color: on ? FRV.ink : FRV.sub }}>{names.filter(Boolean).join(' · ')}</span>
      <span style={{ fontFamily: FRV_DISPLAY, fontSize: 24, fontWeight: 700, lineHeight: 1.3, color: on ? FRV.ink : FRV.muted }}>{score}</span>
    </div>
  );
  return (
    <article data-fr="match" style={{ borderRadius: 16, padding: '12px 13px', background: FRV.surface, border: `1px solid ${FRV.line}`, boxShadow: '0 1px 2px rgba(18,35,58,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: FRV.muted }}>{matchMeta(m)}</span>
        <Tags m={m} />
      </div>
      <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
        {side(m.teamA, m.score1, win === 'A')}
        {side(m.teamB, m.score2, win === 'B')}
      </div>
      <ReviewLine m={m} />
    </article>
  );
}
/** 운영진 리뷰가 있으면 리뷰, 없으면 점수 기록 한 줄. */
function ReviewLine({ m, large }: { m: PublicFeatured; large?: boolean }) {
  if (m.review) {
    return (
      <p data-fr="review" style={{ ...text, margin: '12px 0 0', padding: '10px 12px', borderRadius: 12, background: FRV.goldWash, borderLeft: `3px solid ${FRV.gold}`, fontFamily: FRV_SERIF, fontSize: large ? 15 : 14, lineHeight: 1.6, color: FRV.ink }}>
        {m.review}
      </p>
    );
  }
  return (
    <p data-fr="review-record" style={{ ...text, margin: '10px 0 0', fontSize: 12.5, fontWeight: 700, lineHeight: 1.5, color: FRV.sub }}>
      <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '0.14em', marginRight: 6, color: FRV.goldInk }}>RECORD</span>{matchFallbackLine(m)}
    </p>
  );
}
