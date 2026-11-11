// TEYEON KDK FINAL REPORT — 공개 모바일 매거진(P2 · 서버 컴포넌트 · 클라이언트 상태 없음).
//   COVER → CHAPTER(THE PODIUM · MATCH REVIEW · FINAL STANDINGS) → CLOSING.
//   표시만 한다: 순위 · 승패 · 점수 · 태그는 공개본 그대로, 운영진 문구는 있을 때만(자동 생성 없음).

import React from 'react';
import Link from 'next/link';
import type { FinalReportPublicPayload, PublicFeatured, PublicPodium, PublicStanding } from '@/lib/kdk/finalReport/finalReportModel';
import {
  FRV, FRV_DISPLAY, FRV_SERIF, PODIUM_LABEL, chaptersOf, formatDiff, formatReportDate, groupLabel, hasGroups,
  matchMeta, matchWinner, tagList, type Chapter, type TagTone,
} from '@/lib/kdk/finalReport/finalReportView';

const wrap: React.CSSProperties = { width: '100%', maxWidth: 480, margin: '0 auto', boxSizing: 'border-box' };
const text: React.CSSProperties = { overflowWrap: 'anywhere', wordBreak: 'keep-all' };

export interface FinalReportMagazineProps {
  payload: FinalReportPublicPayload;
  /** 공식 결과 상세(/club/kdk/[id]) — 없으면 링크를 숨긴다. */
  officialHref: string | null;
}

export default function FinalReportMagazine({ payload, officialHref }: FinalReportMagazineProps) {
  const chapters = chaptersOf(payload);
  const ch = (id: Chapter['id']) => chapters.find((c) => c.id === id) as Chapter;
  return (
    <main
      data-fr="magazine"
      style={{ minHeight: '100dvh', width: '100%', background: FRV.bg, color: FRV.ink, overflowX: 'hidden', boxSizing: 'border-box' }}
    >
      <Cover payload={payload} chapters={chapters} />
      <div style={{ ...wrap, padding: '0 16px' }}>
        <Section chapter={ch('podium')}>
          <Podium rows={payload.podium} />
        </Section>
        {payload.featured.length > 0 && (
          <Section chapter={ch('review')}>
            <div style={{ display: 'grid', gap: 12 }}>
              {payload.featured.map((m, i) => <MatchCard key={i} m={m} />)}
            </div>
          </Section>
        )}
        <Section chapter={ch('standings')}>
          <Standings rows={payload.standings} />
        </Section>
      </div>
      <Closing payload={payload} officialHref={officialHref} />
    </main>
  );
}

// ── COVER ───────────────────────────────────────────────────────────────────────
function Cover({ payload, chapters }: { payload: FinalReportPublicPayload; chapters: Chapter[] }) {
  const s = payload.session;
  return (
    <header
      data-fr="cover"
      style={{
        width: '100%', color: FRV.onNavy, position: 'relative', overflow: 'hidden',
        background: `radial-gradient(120% 70% at 85% 0%, rgba(227,199,126,0.16) 0%, rgba(227,199,126,0) 55%), linear-gradient(180deg, ${FRV.navy} 0%, ${FRV.navyDeep} 100%)`,
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 22px)', paddingBottom: 34,
      }}
    >
      <div style={{ ...wrap, padding: '0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/teyeon-logo-transparent.png" alt="" width={30} height={30} style={{ width: 30, height: 30, objectFit: 'contain', flexShrink: 0 }} />
            <span style={{ fontFamily: FRV_DISPLAY, fontWeight: 700, fontSize: 15, letterSpacing: '0.32em', color: FRV.goldSoft }}>TEYEON</span>
          </div>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.16em', color: FRV.onNavySub, whiteSpace: 'nowrap' }}>KDK FINAL REPORT</span>
        </div>

        <div style={{ marginTop: 44, height: 1, width: 44, background: FRV.gold }} />
        <p style={{ margin: '14px 0 0', fontSize: 11, fontWeight: 800, letterSpacing: '0.24em', color: FRV.goldSoft }}>OFFICIAL RESULT</p>
        <h1 style={{ margin: '8px 0 0', fontFamily: FRV_SERIF, fontWeight: 700, fontSize: 'clamp(34px, 10.5vw, 46px)', lineHeight: 1.04, letterSpacing: '-0.01em', color: '#FFFFFF' }}>
          THE FINAL<br />STORY
        </h1>
        <p style={{ ...text, margin: '18px 0 0', fontSize: 19, fontWeight: 800, lineHeight: 1.35, color: FRV.onNavy }}>{s.title || 'TEYEON KDK'}</p>
        {s.date && <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 600, color: FRV.onNavySub }}>{formatReportDate(s.date)}</p>}

        <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', border: `1px solid ${FRV.navyLine}`, borderRadius: 14 }}>
          <CoverStat label="참가" value={String(s.participantCount)} unit="명" />
          <CoverStat label="경기" value={String(s.matchCount)} unit="경기" divider />
          <CoverStat label="기록" value="공식" unit="확정" divider />
        </div>

        {payload.opening && (
          <p data-fr="opening" style={{ ...text, margin: '22px 0 0', paddingLeft: 12, borderLeft: `2px solid ${FRV.gold}`, fontFamily: FRV_SERIF, fontSize: 15.5, lineHeight: 1.6, color: FRV.onNavy }}>
            {payload.opening}
          </p>
        )}

        <nav aria-label="챕터" style={{ marginTop: 26, display: 'grid', gap: 2 }}>
          {chapters.map((c) => (
            <a key={c.id} href={`#fr-${c.id}`} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', color: FRV.onNavy, textDecoration: 'none', borderTop: `1px solid ${FRV.navyLine}` }}>
              <span style={{ fontFamily: FRV_DISPLAY, fontWeight: 700, fontSize: 12, letterSpacing: '0.12em', color: FRV.goldSoft, width: 22 }}>{c.no}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '0.14em' }}>{c.title}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, color: FRV.onNavySub }}>{c.kicker}</span>
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
function CoverStat({ label, value, unit, divider }: { label: string; value: string; unit: string; divider?: boolean }) {
  return (
    <div style={{ padding: '12px 6px', textAlign: 'center', borderLeft: divider ? `1px solid ${FRV.navyLine}` : undefined, minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: FRV.onNavySub }}>{label}</div>
      <div style={{ marginTop: 3, whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: FRV_DISPLAY, fontSize: 22, fontWeight: 700, color: '#FFFFFF' }}>{value}</span>
        <span style={{ marginLeft: 2, fontSize: 11, fontWeight: 700, color: FRV.goldSoft }}>{unit}</span>
      </div>
    </div>
  );
}

// ── CHAPTER 공통 ─────────────────────────────────────────────────────────────────
function Section({ chapter, children }: { chapter: Chapter; children: React.ReactNode }) {
  return (
    <section id={`fr-${chapter.id}`} data-fr={`chapter-${chapter.id}`} aria-labelledby={`fr-${chapter.id}-h`} style={{ paddingTop: 34, scrollMarginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.22em', color: FRV.goldInk }}>CHAPTER {chapter.no}</span>
        <span style={{ flex: 1, height: 1, background: FRV.line }} />
      </div>
      <h2 id={`fr-${chapter.id}-h`} style={{ margin: '8px 0 0', fontFamily: FRV_SERIF, fontWeight: 700, fontSize: 26, lineHeight: 1.15, letterSpacing: '-0.01em', color: FRV.ink }}>
        {chapter.title}
      </h2>
      <p style={{ margin: '4px 0 14px', fontSize: 13, fontWeight: 700, color: FRV.muted }}>{chapter.kicker}</p>
      {children}
    </section>
  );
}

function GroupChip({ group, onDark }: { group: string; onDark?: boolean }) {
  if (!group) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 7px', borderRadius: 999, fontSize: 11, fontWeight: 800, flexShrink: 0,
      color: onDark ? FRV.goldSoft : FRV.sub, background: onDark ? 'rgba(227,199,126,0.12)' : FRV.lineSoft,
      border: `1px solid ${onDark ? FRV.navyLine : FRV.line}`,
    }}>{groupLabel(group)}</span>
  );
}

function Stat({ label, value, onDark, strong }: { label: string; value: string; onDark?: boolean; strong?: boolean }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 0 }}>
      <div style={{ fontFamily: FRV_DISPLAY, fontSize: strong ? 28 : 21, fontWeight: 700, lineHeight: 1.1, color: onDark ? '#FFFFFF' : FRV.ink }}>{value}</div>
      <div style={{ marginTop: 2, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: onDark ? FRV.onNavySub : FRV.muted }}>{label}</div>
    </div>
  );
}

// ── CHAPTER — THE PODIUM ─────────────────────────────────────────────────────────
function Podium({ rows }: { rows: PublicPodium[] }) {
  const [first, ...rest] = rows;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {first && <ChampionCard p={first} />}
      {rest.map((p) => <PlaceCard key={p.rank} p={p} />)}
    </div>
  );
}
function ChampionCard({ p }: { p: PublicPodium }) {
  return (
    <article data-fr="champion" style={{
      position: 'relative', borderRadius: 20, padding: '20px 18px 18px', color: FRV.onNavy, overflow: 'hidden',
      background: `radial-gradient(90% 80% at 100% 0%, rgba(227,199,126,0.22) 0%, rgba(227,199,126,0) 60%), linear-gradient(160deg, ${FRV.navy} 0%, ${FRV.navyDeep} 100%)`,
      border: `1px solid rgba(201,162,75,0.55)`, boxShadow: '0 14px 34px rgba(6,17,31,0.22)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: FRV_DISPLAY, fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: FRV.navyDeep, background: FRV.goldSoft, borderRadius: 6, padding: '2px 7px' }}>NO.1</span>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.26em', color: FRV.goldSoft }}>{PODIUM_LABEL[1]}</span>
        <span style={{ marginLeft: 'auto' }}><GroupChip group={p.group} onDark /></span>
      </div>
      <p style={{ ...text, margin: '16px 0 0', fontSize: 'clamp(26px, 8.4vw, 34px)', fontWeight: 900, lineHeight: 1.18, letterSpacing: '-0.02em', color: '#FFFFFF' }}>{p.name}</p>
      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, padding: '12px 4px', borderTop: `1px solid ${FRV.navyLine}`, borderBottom: `1px solid ${FRV.navyLine}` }}>
        <Stat label="WIN" value={String(p.wins)} onDark strong />
        <Stat label="LOSS" value={String(p.losses)} onDark strong />
        <Stat label="DIFF" value={formatDiff(p.diff)} onDark strong />
      </div>
      {p.story && <p data-fr="story" style={{ ...text, margin: '14px 0 0', fontFamily: FRV_SERIF, fontSize: 15, lineHeight: 1.62, color: FRV.onNavy }}>{p.story}</p>}
    </article>
  );
}
function PlaceCard({ p }: { p: PublicPodium }) {
  return (
    <article data-fr={`place-${p.rank}`} style={{ borderRadius: 16, padding: '14px 14px 14px 16px', background: FRV.surface, border: `1px solid ${FRV.line}`, boxShadow: '0 1px 2px rgba(18,35,58,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontFamily: FRV_DISPLAY, fontSize: 30, fontWeight: 700, lineHeight: 1, color: p.rank === 2 ? FRV.sub : FRV.goldInk, width: 22, textAlign: 'center', flexShrink: 0 }}>{p.rank}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.2em', color: FRV.goldInk }}>{PODIUM_LABEL[p.rank] || ''}</span>
            <GroupChip group={p.group} />
          </div>
          <p style={{ ...text, margin: '3px 0 0', fontSize: 19, fontWeight: 900, lineHeight: 1.25, color: FRV.ink }}>{p.name}</p>
        </div>
      </div>
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, padding: '9px 0 0', borderTop: `1px solid ${FRV.lineSoft}` }}>
        <Stat label="WIN" value={String(p.wins)} />
        <Stat label="LOSS" value={String(p.losses)} />
        <Stat label="DIFF" value={formatDiff(p.diff)} />
      </div>
      {p.story && <p data-fr="story" style={{ ...text, margin: '10px 0 0', fontFamily: FRV_SERIF, fontSize: 14.5, lineHeight: 1.6, color: FRV.sub }}>{p.story}</p>}
    </article>
  );
}

// ── CHAPTER — MATCH REVIEW ───────────────────────────────────────────────────────
const TONE: Record<TagTone, React.CSSProperties> = {
  gold: { color: FRV.navyDeep, background: FRV.goldSoft, border: `1px solid ${FRV.gold}` },
  navy: { color: '#FFFFFF', background: FRV.navy, border: `1px solid ${FRV.navy}` },
  teal: { color: FRV.teal, background: FRV.tealWash, border: '1px solid rgba(14,143,132,0.25)' },
  slate: { color: FRV.sub, background: FRV.lineSoft, border: `1px solid ${FRV.line}` },
};
function MatchCard({ m }: { m: PublicFeatured }) {
  const win = matchWinner(m);
  const tags = tagList(m.tags);
  const featuredDay = m.tags.includes('MATCH_OF_THE_DAY');
  return (
    <article data-fr="match" style={{
      borderRadius: 18, background: FRV.surface, padding: '14px 14px 14px',
      border: featuredDay ? `1px solid rgba(201,162,75,0.7)` : `1px solid ${FRV.line}`,
      boxShadow: featuredDay ? '0 10px 26px rgba(138,106,32,0.12)' : '0 1px 2px rgba(18,35,58,0.05)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: FRV.muted, marginRight: 'auto' }}>{matchMeta(m)}</span>
      </div>
      {tags.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {tags.map((t) => (
            <span key={t.key} data-fr-tag={t.key} style={{ ...TONE[t.tone], display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{t.label}</span>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
        <TeamRow names={m.teamA} score={m.score1} state={win === 'A' ? 'win' : win === 'B' ? 'loss' : 'draw'} />
        <TeamRow names={m.teamB} score={m.score2} state={win === 'B' ? 'win' : win === 'A' ? 'loss' : 'draw'} />
      </div>
      {m.review && (
        <p data-fr="review" style={{ ...text, margin: '12px 0 0', padding: '10px 12px', borderRadius: 12, background: FRV.goldWash, borderLeft: `3px solid ${FRV.gold}`, fontFamily: FRV_SERIF, fontSize: 14.5, lineHeight: 1.6, color: FRV.ink }}>
          {m.review}
        </p>
      )}
    </article>
  );
}
function TeamRow({ names, score, state }: { names: [string, string]; score: number; state: 'win' | 'loss' | 'draw' }) {
  const win = state === 'win';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, background: win ? '#F7F9FB' : 'transparent', border: `1px solid ${win ? FRV.line : FRV.lineSoft}` }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        {names.filter(Boolean).map((n, i) => (
          <div key={i} style={{ ...text, fontSize: 15, lineHeight: 1.35, fontWeight: win ? 900 : 700, color: win ? FRV.ink : FRV.sub }}>{n}</div>
        ))}
      </div>
      {win && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: FRV.goldInk, flexShrink: 0 }}>WIN</span>}
      <span style={{ fontFamily: FRV_DISPLAY, fontSize: 32, fontWeight: 700, lineHeight: 1, minWidth: 26, textAlign: 'right', color: win ? FRV.ink : FRV.muted, flexShrink: 0 }}>{score}</span>
    </div>
  );
}

// ── CHAPTER — FINAL STANDINGS ────────────────────────────────────────────────────
function Standings({ rows }: { rows: PublicStanding[] }) {
  const groups = hasGroups(rows);
  const cols = groups ? '30px minmax(0, 1fr) 34px 52px 40px' : '30px minmax(0, 1fr) 52px 40px';
  const head: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: FRV.muted };
  return (
    <div data-fr="standings" style={{ borderRadius: 16, background: FRV.surface, border: `1px solid ${FRV.line}`, overflow: 'hidden' }}>
      <div role="row" style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, alignItems: 'center', padding: '10px 12px', background: '#F7F9FB', borderBottom: `1px solid ${FRV.line}` }}>
        <span style={{ ...head, textAlign: 'center' }}>순위</span>
        <span style={head}>이름</span>
        {groups && <span style={{ ...head, textAlign: 'center' }}>조</span>}
        <span style={{ ...head, textAlign: 'center' }}>승-패</span>
        <span style={{ ...head, textAlign: 'right' }}>득실</span>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((r) => {
          const top = r.rank <= 3;
          return (
            <li key={r.rank} data-fr="standing-row" style={{
              display: 'grid', gridTemplateColumns: cols, gap: 6, alignItems: 'center', padding: '11px 12px',
              borderTop: r.rank === rows[0]?.rank ? 'none' : `1px solid ${FRV.lineSoft}`, background: top ? 'rgba(251,246,233,0.6)' : FRV.surface,
            }}>
              <span style={{ fontFamily: FRV_DISPLAY, fontSize: 18, fontWeight: 700, textAlign: 'center', color: top ? FRV.goldInk : FRV.sub }}>{r.rank}</span>
              <span style={{ ...text, fontSize: 14.5, fontWeight: top ? 900 : 700, lineHeight: 1.3, color: FRV.ink, minWidth: 0 }}>
                {r.name}
              </span>
              {groups && <span style={{ textAlign: 'center', fontSize: 12, fontWeight: 800, color: FRV.sub }}>{groupLabel(r.group) || '–'}</span>}
              <span style={{ textAlign: 'center', fontFamily: FRV_DISPLAY, fontSize: 16, fontWeight: 700, color: FRV.ink, whiteSpace: 'nowrap' }}>{r.wins}-{r.losses}</span>
              <span style={{ textAlign: 'right', fontFamily: FRV_DISPLAY, fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', color: r.diff > 0 ? FRV.teal : r.diff < 0 ? FRV.muted : FRV.sub }}>{formatDiff(r.diff)}</span>
            </li>
          );
        })}
      </ol>
      {rows.some((r) => r.guest) && (
        <p style={{ margin: 0, padding: '9px 12px', borderTop: `1px solid ${FRV.lineSoft}`, fontSize: 11.5, fontWeight: 600, color: FRV.muted }}>(G) 게스트 참가자</p>
      )}
    </div>
  );
}

// ── CLOSING ─────────────────────────────────────────────────────────────────────
function Closing({ payload, officialHref }: { payload: FinalReportPublicPayload; officialHref: string | null }) {
  return (
    <footer data-fr="closing" style={{
      marginTop: 40, width: '100%', color: FRV.onNavy, background: `linear-gradient(180deg, ${FRV.navy} 0%, ${FRV.navyDeep} 100%)`,
      paddingTop: 34, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 34px)',
    }}>
      <div style={{ ...wrap, padding: '0 20px', textAlign: 'center' }}>
        <div style={{ margin: '0 auto', height: 1, width: 44, background: FRV.gold }} />
        <p style={{ margin: '14px 0 0', fontSize: 11, fontWeight: 800, letterSpacing: '0.24em', color: FRV.goldSoft }}>CLOSING</p>
        <h2 style={{ margin: '8px 0 0', fontFamily: FRV_SERIF, fontWeight: 700, fontSize: 28, lineHeight: 1.15, color: '#FFFFFF' }}>UNTIL NEXT MATCH</h2>
        {payload.closing && (
          <p data-fr="closing-text" style={{ ...text, margin: '14px auto 0', maxWidth: 360, fontFamily: FRV_SERIF, fontSize: 15.5, lineHeight: 1.62, color: FRV.onNavy }}>{payload.closing}</p>
        )}
        {officialHref && (
          <Link data-fr="official-link" href={officialHref} style={{
            marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, padding: '0 18px', borderRadius: 14,
            background: FRV.goldSoft, color: FRV.navyDeep, fontSize: 14.5, fontWeight: 900, textDecoration: 'none', boxShadow: '0 10px 24px rgba(0,0,0,0.25)',
          }}>공식 KDK 결과 상세 보기</Link>
        )}
        <p style={{ margin: '14px 0 0', fontSize: 11.5, fontWeight: 600, lineHeight: 1.55, color: FRV.onNavySub }}>
          TEYEON KDK 공식 확정 기록 기준입니다.<br />순위 · 승패 · 점수는 공식 결과와 같습니다.
        </p>
        <div style={{ marginTop: 26, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/teyeon-logo-transparent.png" alt="" width={26} height={26} style={{ width: 26, height: 26, objectFit: 'contain' }} />
          <span style={{ fontFamily: FRV_DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: '0.32em', color: FRV.goldSoft }}>TEYEON</span>
        </div>
      </div>
    </footer>
  );
}
