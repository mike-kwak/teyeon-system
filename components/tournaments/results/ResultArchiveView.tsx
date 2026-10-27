'use client';

// TEYEON OPEN 공식 결과 아카이브 — 공개 화면 본문(읽기 전용).
//
//   SECTION 01 아카이브 머리말 · 02 회차 선택 · 03 입상(우승 · 준우승 · 공동 3위) · 사진/영상(있을 때만)
//   · 예선 조별 최종 순위와 경기 결과 · 본선 대진표(기존 공개 대진표 컴포넌트 재사용) · 기록 요약.
//   ⚠ 모든 값은 확정 스냅샷 그대로다. 순위 · 승자 · 입상을 화면에서 계산하지 않는다.
//   ⚠ 사진이 없으면 사진 칸을 만들지 않는다(빈 틀 · 깨진 아이콘 금지). 영상이 없으면 영상 구역을 숨긴다.
//   ⚠ 운영 버튼(투입 · 점수 · 대진 조작)은 없다.

import React from 'react';
import Link from 'next/link';
import { ChevronDown, ExternalLink, Medal, Play, Trophy } from 'lucide-react';
import PublicKnockoutBracket from '@/components/tournaments/draw/PublicKnockoutBracket';
import { TT, FONT_LABEL } from '@/components/tournaments/tournamentTheme';
import { placementNoMapFromDraw } from '@/lib/tournaments/publicKnockoutService';
import { youtubeEmbedUrl } from '@/lib/tournaments/youtube';
import type { PublicKnockoutTeam } from '@/lib/tournaments/publicKnockoutTypes';
import type { PublicDrawGroup, PublicDrawTeam, PublicPlacement } from '@/lib/tournaments/publicDrawTypes';
import { RESULT_VIDEO_CATEGORIES } from '@/lib/tournaments/resultArchiveTypes';
import type { ResultArchive, ResultEditionSummary, ResultMedia, ResultTeamClubs } from '@/lib/tournaments/resultArchiveTypes';

const GOLD = '#A97C1F';
const GOLD_SOFT = '#FBF5E6';
const SILVER = '#5B6B7F';
const BRONZE = '#93623A';
const NAVY = TT.navy;

const pad2 = (n: number) => String(n).padStart(2, '0');
const names = (t: { player1Name: string; player2Name: string } | null) => (t ? [t.player1Name, t.player2Name].filter((x) => x.trim() !== '') : []);
const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? `${n}TH` : `${n}${['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH'}`);
const dateText = (iso: string | null) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  const day = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}. ${pad2(m)}. ${pad2(d)} (${day})`;
};

const sectionLabel: React.CSSProperties = { margin: 0, fontFamily: FONT_LABEL, fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', color: TT.teal };
const sectionTitle: React.CSSProperties = { margin: '6px 0 0', fontSize: 20, fontWeight: 900, color: TT.ink, letterSpacing: '-0.02em', wordBreak: 'keep-all' };

function SectionHead({ id, label, title, note }: { id?: string; label: string; title: string; note?: string }) {
  return (
    <div id={id} style={{ scrollMarginTop: 72 }}>
      <p style={sectionLabel}>{label}</p>
      <h2 style={sectionTitle}>{title}</h2>
      {note && <p style={{ margin: '5px 0 0', fontSize: 12.5, fontWeight: 600, color: TT.muted, lineHeight: 1.6, wordBreak: 'keep-all' }}>{note}</p>}
    </div>
  );
}

/** 사진 — 실패하면 칸 자체를 감춘다(깨진 아이콘 금지). */
function Photo({ m, ratio = '4 / 3' }: { m: ResultMedia; ratio?: string }) {
  const [broken, setBroken] = React.useState(false);
  if (!m.url || broken) return null;
  return (
    <figure style={{ margin: 0, borderRadius: 12, overflow: 'hidden', background: TT.lineSoft, aspectRatio: ratio }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={m.url} alt={m.title ?? '시상 사진'} loading="lazy" decoding="async" onError={() => setBroken(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </figure>
  );
}

// ── 머리말 · 회차 ─────────────────────────────────────────────────────────

function ArchiveHero({ a }: { a: ResultArchive }) {
  const year = (a.tournament.eventDate ?? '').slice(0, 4);
  return (
    <section data-result-hero style={{ background: NAVY, color: '#fff', borderRadius: 18, padding: '22px 20px 20px', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 90% at 100% 0%, rgba(169,124,31,0.22), transparent 55%)' }} />
      <div style={{ position: 'relative', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logos/teyeon-logo-current.png" alt="TEYEON" width={56} height={56} style={{ width: 56, height: 56, objectFit: 'contain', flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: '1 1 220px' }}>
          <p style={{ margin: 0, fontFamily: FONT_LABEL, fontSize: 12, fontWeight: 800, letterSpacing: '0.2em', color: '#E7C877' }}>OFFICIAL RESULTS</p>
          <h1 style={{ margin: '4px 0 0', fontFamily: FONT_LABEL, fontSize: 30, fontWeight: 800, letterSpacing: '0.02em', lineHeight: 1.05 }}>
            TEYEON OPEN {year}
          </h1>
          <p style={{ margin: '4px 0 0', fontFamily: FONT_LABEL, fontSize: 14, fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.78)' }}>
            THE {ordinal(a.editionNo)} EDITION · {a.editionLabel}
          </p>
        </div>
      </div>
      <div style={{ position: 'relative', marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.86)' }}>
        <span>{dateText(a.tournament.eventDate)}</span>
        {a.tournament.venueName && <span>{a.tournament.venueName}</span>}
      </div>
      <p data-result-status style={{ position: 'relative', margin: '12px 0 0', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 800, color: '#E7C877', border: '1px solid rgba(231,200,119,0.45)', borderRadius: 6, padding: '3px 8px' }}>
        공식 기록 확정{a.confirmedAt ? ` · ${dateText(a.confirmedAt)}` : ''}{a.version > 1 ? ` · 정정 ${a.version - 1}회` : ''}
      </p>
    </section>
  );
}

function EditionSelector({ editions, current }: { editions: ResultEditionSummary[]; current: string }) {
  if (editions.length === 0) return null;
  return (
    <nav aria-label="대회 회차" data-result-editions style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
      {editions.map((e) => {
        const on = e.slug === current;
        return (
          <Link key={e.slug} href={`/tournaments/${e.slug}/results`} aria-current={on ? 'page' : undefined} data-result-edition={e.editionNo}
            style={{ flexShrink: 0, display: 'inline-flex', flexDirection: 'column', gap: 1, padding: '8px 14px', borderRadius: 10, textDecoration: 'none',
              border: `1px solid ${on ? NAVY : TT.line}`, background: on ? NAVY : TT.surface, color: on ? '#fff' : TT.inkSoft }}>
            <span style={{ fontFamily: FONT_LABEL, fontSize: 13, fontWeight: 800, letterSpacing: '0.04em' }}>{(e.eventDate ?? '').slice(0, 4)} · {e.editionLabel}</span>
            <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.75 }}>{e.title}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// ── 입상 ──────────────────────────────────────────────────────────────────

//   공식 시상 갤러리 — 우승(전체 폭 · 가장 큰 카드) → 준우승(전체 폭 · 한 단계 낮게) → 공동 3위(PC 2열 · 모바일 1열).
//   네 카드 모두 같은 구조 · 중앙 정렬: 메달(트로피) → 영문 등급 → 한글 등급 → 사진 → 선수 이름 → 선수별 소속.
//   카드에는 입상 등급 · 선수 이름 · 소속 · 시상 사진만 둔다. 팀 번호 · 경기 번호 · 점수 · 상대는 예선 결과와 본선 대진표에서 본다
//   (스냅샷 값은 그대로 두고 화면에서만 숨긴다). 사진이 없거나 못 읽으면 사진 칸 없이 문장 카드로 바뀐다(깨진 이미지 금지).

type AwardSize = 'champion' | 'runner' | 'semi';
type AwardTone = { accent: string; deep: string; line: string; from: string; to: string; ring: string };

const TONES: Record<AwardSize, AwardTone> = {
  champion: { accent: GOLD, deep: '#7E5B12', line: '#E3CF9E', from: '#FFFDF7', to: GOLD_SOFT, ring: '#F3E6C4' },
  runner: { accent: SILVER, deep: '#3E4C5E', line: '#D5DCE5', from: '#FCFDFE', to: '#EEF2F6', ring: '#E1E7EE' },
  semi: { accent: BRONZE, deep: '#6F4626', line: '#E8D6C6', from: '#FFFDFB', to: '#F8EFE7', ring: '#F0E0D2' },
};

/** 월계수 가지(장식) — 우승 카드 머리말 양옆. */
function Laurel({ color, flip = false }: { color: string; flip?: boolean }) {
  const leaves: Array<[number, number, number]> = [[21, 49, -58], [15, 41, -42], [11, 32, -26], [10, 23, -10], [11, 14, 6], [14, 6, 20]];
  return (
    <svg width="30" height="54" viewBox="0 0 34 58" aria-hidden style={{ flexShrink: 0, transform: flip ? 'scaleX(-1)' : undefined }}>
      <path d="M28 56 C 12 46, 6 28, 15 3" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      {leaves.map(([x, y, r]) => <ellipse key={y} cx={x - 3} cy={y} rx="2.6" ry="6.2" transform={`rotate(${r} ${x - 3} ${y})`} fill={color} opacity="0.8" />)}
      {leaves.slice(0, 5).map(([x, y, r]) => <ellipse key={`i${y}`} cx={x + 4} cy={y - 3} rx="2.3" ry="5.4" transform={`rotate(${r + 62} ${x + 4} ${y - 3})`} fill={color} opacity="0.55" />)}
    </svg>
  );
}

/** 입상팀의 대회 당시 선수별 소속. 고정 기록의 팀 번호와 두 선수 이름이 공식 스냅샷과 모두 같을 때만 쓴다(아니면 소속 줄 없음). */
function teamClubs(list: ResultTeamClubs[] | undefined, team: PublicKnockoutTeam): ResultTeamClubs | null {
  const c = (list ?? []).find((x) => x.teamNo === team.teamNo && x.player1Name === team.player1Name && x.player2Name === team.player2Name);
  return c && (c.player1Club || c.player2Club) ? c : null;
}

/** 두 선수 이름 + 이름 바로 아래 각자의 소속. 두 사람 소속이 같으면 소속을 한 줄로 합친다. 소속이 없는 선수는 비워 둔다(지어내지 않음). */
function Players({ team, clubs, accent }: { team: PublicKnockoutTeam; clubs: ResultTeamClubs | null; accent: string }) {
  const ns = names(team);
  const cl = ns.length === 2 ? clubs : null;
  const same = !!cl && !!cl.player1Club && cl.player1Club === cl.player2Club;
  return (
    <div className={`rs-award__players${cl ? (same ? ' is-same' : ' is-split') : ''}`} style={{ color: NAVY }}>
      {ns.map((n, i) => (
        <React.Fragment key={`${n}-${i}`}>
          {i > 0 && <span aria-hidden className="rs-award__dot" style={{ color: accent }}>·</span>}
          <span className={`rs-award__player rs-p-n${i + 1}`}>{n}</span>
        </React.Fragment>
      ))}
      {cl && same && <span className="rs-award__club rs-p-cc" data-result-award-club="both">{cl.player1Club}</span>}
      {cl && !same && (
        <>
          <span className="rs-award__club rs-p-c1" data-result-award-club="1">{cl.player1Club ?? ''}</span>
          <span className="rs-award__club rs-p-c2" data-result-award-club="2">{cl.player2Club ?? ''}</span>
        </>
      )}
    </div>
  );
}

function AwardCard({ tier, size, title, sub, team, photo, clubs }: {
  tier: string; size: AwardSize; title: string; sub: string; team: PublicKnockoutTeam; photo: ResultMedia | null; clubs: ResultTeamClubs | null;
}) {
  const [broken, setBroken] = React.useState(false);
  const tone = TONES[size];
  const ns = names(team);
  const shown = photo && photo.url && !broken ? photo : null;
  const Icon = size === 'champion' ? Trophy : Medal;
  const icon = size === 'champion' ? 26 : size === 'runner' ? 22 : 18;
  const badge = size === 'champion' ? 56 : size === 'runner' ? 46 : 38;
  return (
    <article data-result-award={tier} data-result-award-team={team.teamNo} aria-label={`${sub} ${ns.join(', ')}`}
      className={`rs-award rs-award--${size}${shown ? '' : ' rs-award--nophoto'}`}
      style={{ ['--fade' as string]: tone.to, background: `linear-gradient(120deg, ${tone.from} 0%, ${tone.to} 100%)`, border: `1px solid ${tone.line}` }}>
      <div className="rs-award__in" style={size === 'champion' ? { border: `1px solid ${tone.line}` } : undefined}>
        <div className="rs-award__head">
          <div className="rs-award__badge-row">
            {size === 'champion' && <Laurel color={tone.accent} />}
            <span className="rs-award__badge" style={{ width: badge, height: badge, color: tone.accent, background: '#fff', boxShadow: `0 0 0 4px ${tone.ring}, 0 6px 14px -8px ${tone.deep}` }}>
              <Icon size={icon} strokeWidth={2.1} />
            </span>
            {size === 'champion' && <Laurel color={tone.accent} flip />}
          </div>
          <div className="rs-award__tier">
            <p style={{ margin: 0, fontFamily: FONT_LABEL, fontWeight: 800, letterSpacing: '0.22em', color: tone.accent }} className="rs-award__en">{title}</p>
            <p style={{ margin: 0, fontWeight: 900, color: tone.deep, letterSpacing: '-0.01em' }} className="rs-award__ko">{sub}</p>
          </div>
        </div>
        {shown && (
          <figure className="rs-award__photo" style={{ background: tone.ring }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown.url as string} alt={`${sub} ${ns.join(' · ')} 시상 사진`} loading={size === 'champion' ? 'eager' : 'lazy'} decoding="async" onError={() => setBroken(true)} />
          </figure>
        )}
        <div className="rs-award__names">
          {size === 'champion' && <span aria-hidden className="rs-award__rule" style={{ background: tone.line }} />}
          <Players team={team} clubs={clubs} accent={tone.accent} />
        </div>
        {!shown && <Icon aria-hidden className="rs-award__mark" size={size === 'champion' ? 150 : 110} strokeWidth={1.1} color={tone.accent} />}
      </div>
    </article>
  );
}

/** 입상 사진 고르기 — 사진에 적힌 입상팀 번호(teamNo)가 공식 스냅샷의 그 팀 번호와 같을 때만 붙인다.
 *   우승 · 준우승은 분류만으로 팀이 하나로 정해지므로 번호가 비어 있어도 그 분류 사진을 쓴다(번호가 다르면 쓰지 않음).
 *   공동 3위는 두 팀이라 번호가 정확히 같아야만 쓴다 — 올린 순서 · 제목으로 짐작하지 않는다(미지정 사진은 표시하지 않음). */
function awardPhoto(media: ResultMedia[], category: 'champion' | 'runner_up' | 'semifinal', teamNo: number): ResultMedia | null {
  return media.find((m) => m.kind === 'photo' && m.category === category && m.url
    && (m.teamNo === teamNo || (category !== 'semifinal' && (m.teamNo === null || m.teamNo === undefined)))) ?? null;
}

function Awards({ a }: { a: ResultArchive }) {
  if (!a.awards) {
    return <p role="alert" style={{ margin: 0, padding: 14, borderRadius: 12, background: '#FFF7ED', color: '#9A3412', fontSize: 13, fontWeight: 700 }}>입상 결과를 확인할 수 없습니다(확정 기록에 결승 · 4강 결과 없음).</p>;
  }
  const { champion, runnerUp, semifinalists } = a.awards;
  const clubs = (t: PublicKnockoutTeam) => teamClubs(a.teamClubs, t);
  return (
    <div data-result-awards style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <AwardCard tier="champion" size="champion" title="CHAMPION" sub="우승" team={champion.team} photo={awardPhoto(a.media, 'champion', champion.team.teamNo)} clubs={clubs(champion.team)} />
      <AwardCard tier="runner_up" size="runner" title="RUNNER-UP" sub="준우승" team={runnerUp.team} photo={awardPhoto(a.media, 'runner_up', runnerUp.team.teamNo)} clubs={clubs(runnerUp.team)} />
      <div className="rs-awards-semi">
        {semifinalists.map((s) => (
          <AwardCard key={s.team.teamNo} tier="semifinal" size="semi" title="SEMIFINALIST" sub="공동 3위" team={s.team} photo={awardPhoto(a.media, 'semifinal', s.team.teamNo)} clubs={clubs(s.team)} />
        ))}
      </div>
    </div>
  );
}

// ── 사진 · 영상 ───────────────────────────────────────────────────────────

function Gallery({ media }: { media: ResultMedia[] }) {
  const photos = media.filter((m) => m.kind === 'photo' && m.url && (m.category === 'group' || m.category === 'hero'));
  if (!photos.length) return null;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SectionHead label="AWARD CEREMONY" title="시상 사진" />
      <div className="rs-gallery">{photos.map((m) => <Photo key={m.id} m={m} ratio="3 / 2" />)}</div>
    </section>
  );
}

function VideoCard({ m }: { m: ResultMedia }) {
  const [play, setPlay] = React.useState(false);
  const id = m.youtubeId as string;
  const label = RESULT_VIDEO_CATEGORIES.find(([k]) => k === m.category)?.[1] ?? '영상';
  return (
    <article data-result-video={m.category} style={{ background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 12, overflow: 'hidden', minWidth: 0 }}>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#0B1622' }}>
        {play ? (
          <iframe src={youtubeEmbedUrl(id, { autoplay: true })} title={m.title ?? label} allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
        ) : (
          <button type="button" onClick={() => setPlay(true)} aria-label={`${m.title ?? label} 재생`}
            style={{ position: 'absolute', inset: 0, border: 0, padding: 0, cursor: 'pointer', background: `#0B1622 url(https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg) center / cover no-repeat` }}>
            <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 54, height: 54, borderRadius: '50%', background: 'rgba(16,42,61,0.88)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <Play size={22} color="#fff" fill="#fff" />
            </span>
          </button>
        )}
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontFamily: FONT_LABEL, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: TT.teal }}>{label}</p>
          <p style={{ margin: '2px 0 0', fontSize: 13.5, fontWeight: 800, color: TT.ink, overflowWrap: 'anywhere' }}>{m.title ?? label}</p>
        </div>
        <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer"
          style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 800, color: TT.inkSoft, textDecoration: 'none' }}>
          YouTube <ExternalLink size={12} />
        </a>
      </div>
    </article>
  );
}

function Videos({ media }: { media: ResultMedia[] }) {
  const videos = media.filter((m) => m.kind === 'video' && m.youtubeId);
  if (!videos.length) return null;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SectionHead label="VIDEOS" title="대회 영상" />
      <div className="rs-videos">{videos.map((m) => <VideoCard key={m.id} m={m} />)}</div>
    </section>
  );
}

// ── 예선 ──────────────────────────────────────────────────────────────────

const teamLine = (t: PublicDrawTeam) => names(t).join(' · ');

function MatchLine({ no, t1, t2, s1, s2, w }: { no: number; t1: PublicDrawTeam; t2: PublicDrawTeam; s1: number | null; s2: number | null; w: 1 | 2 | null }) {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '44px minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${TT.lineSoft}` }}>
      <span style={{ fontFamily: FONT_LABEL, fontSize: 11.5, fontWeight: 800, color: TT.subtle }}>M{pad2(no)}</span>
      <span style={{ fontSize: 13, fontWeight: w === 1 ? 900 : 600, color: w === 1 ? TT.ink : TT.muted, textAlign: 'right', overflowWrap: 'anywhere' }}>{teamLine(t1)}</span>
      <span style={{ fontFamily: FONT_LABEL, fontSize: 15, fontWeight: 800, color: NAVY, fontVariantNumeric: 'tabular-nums', minWidth: 42, textAlign: 'center' }}>{s1 ?? '-'} : {s2 ?? '-'}</span>
      <span style={{ fontSize: 13, fontWeight: w === 2 ? 900 : 600, color: w === 2 ? TT.ink : TT.muted, overflowWrap: 'anywhere' }}>{teamLine(t2)}</span>
    </li>
  );
}

type GroupCard = { key: string; label: string; sub: string; group?: PublicDrawGroup; placement?: PublicPlacement };

function GroupResult({ g, open, onToggle }: { g: GroupCard; open: boolean; onToggle: () => void }) {
  const qualified = g.group ? g.group.standings.filter((r) => r.qualificationStatus === 'QUALIFIED').map((r) => teamLine(r)) : [];
  return (
    <article id={`group-${g.key}`} data-result-group={g.label} style={{ background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 12, overflow: 'hidden', scrollMarginTop: 72 }}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
        <span style={{ fontFamily: FONT_LABEL, fontSize: 18, fontWeight: 800, color: NAVY, minWidth: 40 }}>{g.label}</span>
        <span style={{ minWidth: 0, flex: 1, fontSize: 12, fontWeight: 700, color: TT.muted, overflowWrap: 'anywhere' }}>
          {g.sub}{qualified.length ? ` · 진출 ${qualified.join(' / ')}` : ''}
        </span>
        <ChevronDown size={18} color={TT.subtle} style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && (
        <div style={{ padding: '0 14px 12px' }}>
          {g.group && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 300 }}>
                <thead>
                  <tr style={{ color: TT.subtle, fontSize: 11, fontWeight: 800, textAlign: 'center' }}>
                    <th style={{ padding: '6px 4px', width: 36 }}>순위</th>
                    <th style={{ padding: '6px 4px', textAlign: 'left' }}>팀</th>
                    <th style={{ padding: '6px 4px', width: 44 }}>승-패</th>
                    <th style={{ padding: '6px 4px', width: 48 }}>득실</th>
                    <th style={{ padding: '6px 4px', width: 56 }}>결과</th>
                  </tr>
                </thead>
                <tbody>
                  {g.group.standings.map((r) => (
                    <tr key={r.teamNo} style={{ borderTop: `1px solid ${TT.lineSoft}` }}>
                      <td style={{ padding: '8px 4px', textAlign: 'center', fontFamily: FONT_LABEL, fontWeight: 800, fontSize: 15, color: NAVY }}>{r.rank ?? '-'}</td>
                      <td style={{ padding: '8px 4px', fontWeight: 800, color: TT.ink, overflowWrap: 'anywhere' }}>{teamLine(r)}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{r.wins}-{r.losses}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{r.gameDiff > 0 ? `+${r.gameDiff}` : r.gameDiff}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: r.qualificationStatus === 'QUALIFIED' ? TT.teal : TT.subtle }}>
                          {r.qualificationStatus === 'QUALIFIED' ? '본선 진출' : r.qualificationStatus === 'NOT_QUALIFIED' ? '-' : '확인'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
            {g.group?.matches.slice().sort((x, y) => x.matchNo - y.matchNo).map((m) => (
              <MatchLine key={m.matchNo} no={m.matchNo} t1={m.team1} t2={m.team2} s1={m.score1} s2={m.score2} w={m.winnerSide} />
            ))}
            {g.placement && g.placement.teams.length === 2 && (
              <MatchLine no={g.placement.matchNo} t1={g.placement.teams[0]} t2={g.placement.teams[1]} s1={g.placement.score1} s2={g.placement.score2} w={g.placement.winnerSide} />
            )}
          </ul>
          {g.placement && (
            <p style={{ margin: '8px 0 0', fontSize: 12, fontWeight: 700, color: TT.muted, wordBreak: 'keep-all' }}>
              2팀 순위결정전 — 승리 팀 1위 · 패배 팀 2위로 본선에 진출했습니다.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function Preliminary({ a }: { a: ResultArchive }) {
  const d = a.preliminary;
  const cards = React.useMemo<GroupCard[]>(() => {
    if (!d) return [];
    const map = placementNoMapFromDraw(d);
    const pl: GroupCard[] = d.placement.map((p) => ({ key: `p${p.groupNo}`, label: `${map.get(p.groupNo) ?? ''}조`.replace(/^조$/, '순위결정전'), sub: '순위결정전 · 2팀', placement: p }));
    const gs: GroupCard[] = d.groups.map((g) => ({ key: String(g.groupNo), label: `${g.groupNo}조`, sub: `${g.matches.length}경기`, group: g }));
    return [...pl, ...gs];
  }, [d]);
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  if (!d) return <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: TT.muted }}>예선 기록이 없습니다.</p>;
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allOpen = open.size === cards.length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div data-result-group-jump style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {cards.map((c) => (
          <a key={c.key} href={`#group-${c.key}`} onClick={() => setOpen((s) => new Set(s).add(c.key))}
            style={{ minWidth: 42, padding: '6px 9px', borderRadius: 8, border: `1px solid ${TT.line}`, background: TT.surface, fontSize: 12.5, fontWeight: 800, color: TT.inkSoft, textDecoration: 'none', textAlign: 'center' }}>
            {c.label}
          </a>
        ))}
        <button type="button" data-result-groups-all onClick={() => setOpen(allOpen ? new Set() : new Set(cards.map((c) => c.key)))}
          style={{ marginLeft: 'auto', padding: '6px 10px', borderRadius: 8, border: `1px solid ${TT.line}`, background: TT.tint, fontSize: 12, fontWeight: 800, color: TT.inkSoft, cursor: 'pointer', fontFamily: 'inherit' }}>
          {allOpen ? '모두 접기' : '모두 펼치기'}
        </button>
      </div>
      <div className="rs-groups">
        {cards.map((c) => <GroupResult key={c.key} g={c} open={open.has(c.key)} onToggle={() => toggle(c.key)} />)}
      </div>
    </div>
  );
}

// ── 본문 ──────────────────────────────────────────────────────────────────

export default function ResultArchiveView({ archive, editions }: { archive: ResultArchive; editions: ResultEditionSummary[] }) {
  const c = archive.counts;
  return (
    <div data-result-archive={archive.slug} style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <style>{`
        .rs-videos, .rs-gallery { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .rs-groups { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); align-items: start; }
        @media (max-width: 459px) { .rs-videos, .rs-gallery { grid-template-columns: minmax(0, 1fr); } }

        .rs-awards-semi { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); }
        .rs-award { position: relative; min-width: 0; display: flex; border-radius: 16px; box-shadow: 0 1px 2px rgba(16,42,61,0.04), 0 12px 28px -18px rgba(16,42,61,0.28); }
        .rs-award--champion { padding: 5px; border-radius: 18px; box-shadow: 0 1px 2px rgba(16,42,61,0.05), 0 18px 36px -20px rgba(126,91,18,0.42); }
        .rs-award__in { position: relative; flex: 1; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto 1fr; grid-template-areas: "head" "photo" "names"; border-radius: 15px; overflow: hidden; text-align: center; }
        .rs-award--champion .rs-award__in { border-radius: 13px; }
        .rs-award__head { grid-area: head; position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 9px; padding: 18px 16px 14px; }
        .rs-award__badge-row { display: flex; align-items: center; justify-content: center; gap: 6px; }
        .rs-award__badge { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; flex-shrink: 0; }
        .rs-award__tier { min-width: 0; display: flex; flex-direction: column; align-items: center; }
        .rs-award__en { font-size: 12px; }
        .rs-award__ko { font-size: 16px; margin-top: 2px; }
        .rs-award__photo { grid-area: photo; position: relative; margin: 0; overflow: hidden; aspect-ratio: 5 / 4; }
        .rs-award__photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 45%; display: block; transform: scale(var(--zoom, 1)); transform-origin: 50% 50%; }
        .rs-award--champion .rs-award__photo, .rs-award--runner .rs-award__photo { --zoom: 1.5; }
        .rs-award--semi .rs-award__photo { --zoom: 1.15; }
        .rs-award__names { grid-area: names; position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; padding: 16px 16px 20px; min-width: 0; }

        /* 이름 줄(선수1 · 선수2) 아래에 각자의 소속 — 열마다 가운데 정렬. 소속이 같으면 한 줄(cc)로 합친다.
           좌우 열은 같은 폭(1fr · 내용 폭)이라 소속 길이가 달라도 이름 쌍이 카드 중심에 온다. */
        .rs-award__players { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); grid-template-areas: "n1 dot n2"; align-items: baseline; column-gap: 10px; row-gap: 5px; width: max-content; max-width: 100%; font-weight: 900; letter-spacing: -0.02em; line-height: 1.22; font-size: 21px; }
        .rs-award__players.is-split { grid-template-areas: "n1 dot n2" "c1 . c2"; }
        .rs-award__players.is-same { grid-template-areas: "n1 dot n2" "cc cc cc"; }
        .rs-p-n1 { grid-area: n1; } .rs-p-n2 { grid-area: n2; } .rs-award__dot { grid-area: dot; font-weight: 700; }
        .rs-p-c1 { grid-area: c1; } .rs-p-c2 { grid-area: c2; } .rs-p-cc { grid-area: cc; }
        .rs-award__player { min-width: 0; text-align: center; word-break: keep-all; }
        .rs-award__club { min-width: 0; text-align: center; font-size: 12.5px; font-weight: 700; letter-spacing: 0; line-height: 1.35; color: ${TT.muted}; word-break: keep-all; overflow-wrap: anywhere; }
        .rs-award__rule { display: block; width: 44px; height: 1px; margin: 0 auto 14px; }
        .rs-award__mark { position: absolute; right: -14px; bottom: -22px; opacity: 0.08; pointer-events: none; }
        .rs-award--nophoto .rs-award__in { grid-template-rows: auto 1fr; grid-template-areas: "head" "names"; }

        .rs-award--champion .rs-award__head { gap: 10px; padding: 22px 16px 16px; }
        .rs-award--champion .rs-award__en { font-size: 13px; }
        .rs-award--champion .rs-award__ko { font-size: 19px; }
        .rs-award--champion .rs-award__photo { aspect-ratio: 1 / 1; }
        .rs-award--champion .rs-award__names { padding: 18px 16px 22px; }
        .rs-award--champion .rs-award__players { font-size: 27px; column-gap: 12px; row-gap: 6px; }
        .rs-award--champion .rs-award__club { font-size: 13.5px; }
        .rs-award--runner .rs-award__players { font-size: 23px; }
        .rs-award--runner .rs-award__club { font-size: 13px; }
        .rs-award--semi .rs-award__head { padding: 16px 14px 12px; gap: 8px; }
        .rs-award--semi .rs-award__en { font-size: 11px; }
        .rs-award--semi .rs-award__ko { font-size: 15px; }
        .rs-award--semi .rs-award__names { padding: 14px 14px 18px; }

        @media (min-width: 768px) {
          .rs-awards-semi { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .rs-award--champion .rs-award__in, .rs-award--runner .rs-award__in {
            grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "head photo" "names photo";
          }
          .rs-award--champion .rs-award__head, .rs-award--runner .rs-award__head { align-self: end; }
          .rs-award--champion .rs-award__names, .rs-award--runner .rs-award__names { align-self: start; }
          .rs-award--champion .rs-award__photo, .rs-award--runner .rs-award__photo { aspect-ratio: auto; height: 100%; }
          .rs-award--champion .rs-award__photo { min-height: 340px; }
          .rs-award--runner .rs-award__photo { min-height: 260px; }
          .rs-award--champion .rs-award__photo::before, .rs-award--runner .rs-award__photo::before {
            content: ''; position: absolute; inset: 0 auto 0 0; width: 22%; z-index: 1; background: linear-gradient(90deg, var(--fade), transparent);
          }
          .rs-award--champion .rs-award__players { font-size: 32px; }
          .rs-award--champion .rs-award__club { font-size: 14px; }
          .rs-award--champion .rs-award__ko { font-size: 21px; }
          .rs-award--runner .rs-award__head { padding: 22px 22px 10px; }
          .rs-award--runner .rs-award__names { padding: 8px 22px 24px; }
          .rs-award--runner .rs-award__players { font-size: 25px; }
          .rs-award--nophoto .rs-award__in { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: auto 1fr !important; grid-template-areas: "head" "names" !important; }
        }
        @media (min-width: 1100px) {
          .rs-award--champion .rs-award__photo { min-height: 380px; }
          .rs-award--champion .rs-award__players { font-size: 34px; }
          .rs-award--runner .rs-award__photo { min-height: 270px; }
          .rs-award--semi .rs-award__in { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "head photo" "names photo"; }
          .rs-award--semi .rs-award__head { align-self: end; padding: 18px 14px 8px; }
          .rs-award--semi .rs-award__names { align-self: start; padding: 6px 14px 18px; }
          /* 좁은 왼쪽 칸 — 선수마다 이름 → 소속을 세로로 쌓는다(가운데 정렬 유지). */
          .rs-award--semi .rs-award__players { grid-template-columns: auto; grid-template-areas: "n1" "n2"; font-size: 21px; row-gap: 3px; }
          .rs-award--semi .rs-award__players.is-split { grid-template-areas: "n1" "c1" "n2" "c2"; }
          .rs-award--semi .rs-award__players.is-same { grid-template-areas: "n1" "n2" "cc"; }
          .rs-award--semi .rs-p-c1 { margin-bottom: 8px; }
          .rs-award--semi .rs-p-cc { margin-top: 4px; }
          .rs-award--semi .rs-award__dot { display: none; }
          .rs-award--semi .rs-award__photo { aspect-ratio: auto; height: 100%; min-height: 230px; --zoom: 1.35; }
        }

        @media (min-width: 760px) {
          .rs-groups { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .rs-videos { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (min-width: 1180px) { .rs-groups { grid-template-columns: repeat(3, minmax(0, 1fr)); } .rs-gallery { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
      `}</style>
      <ArchiveHero a={archive} />
      <EditionSelector editions={editions} current={archive.slug} />

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionHead label="CHAMPIONS & AWARDS" title="입상팀" note="실제 결승 · 4강 경기 결과 기준입니다. 3 · 4위전 없이 4강 패배 두 팀이 공동 3위입니다." />
        <Awards a={archive} />
      </section>

      <Gallery media={archive.media} />
      <Videos media={archive.media} />

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionHead id="preliminary" label="PRELIMINARY" title="예선 조별 최종 순위 · 경기 결과" note="공식 확정 순위 그대로입니다. 조를 눌러 경기별 점수를 볼 수 있습니다." />
        <Preliminary a={archive} />
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionHead id="knockout" label="KNOCKOUT" title="본선 대진표" note="64강부터 결승까지 공식 기록입니다. BYE 는 경기 없이 다음 라운드로 진출한 자리입니다." />
        {archive.knockout
          ? <div data-result-bracket><PublicKnockoutBracket bracket={archive.knockout} /></div>
          : <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: TT.muted }}>본선 기록이 없습니다.</p>}
      </section>

      {c && (
        <section data-result-counts style={{ background: TT.tint, borderRadius: 12, padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 12.5, fontWeight: 700, color: TT.inkSoft }}>
          <span>예선 {c.preliminaryMatches}경기</span>
          <span>본선 {c.knockoutMatches}경기</span>
          <span>본선 진출 {c.entrants}팀</span>
          <span>64강 자리 {c.firstRoundSlots} (BYE {c.byeSlots})</span>
        </section>
      )}
    </div>
  );
}
