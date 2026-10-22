'use client';

// 공개 DRAW — 모바일 예선 대진표(C안: 1차 · 2차 구역 + 2열 압축 조 카드 · read-only).
//
//   읽는 순서: 내 이름 검색 → 조 번호 · 예정 코트 · 1차/2차 · 신고 마감 → 페어 · 소속 → 경기 상태.
//   · 상단: 선수 검색 + 1차/2차 출전 신고 안내(신고 마감과 경기 시작을 다른 줄 · 다른 글자로 — 09:20 을 시작 시각으로 읽지 않게)
//   · 본문: 차수 구역 띠 → 조 카드 2열(조 · 큰 코트 번호 / 차수 · 신고) → 팀 한 줄(페어) + 얇은 구분선 · 소속은 보조 줄
//   · 경기 순서 · 결과는 카드 펼치기, 순위 · 상세는 조 상세 화면으로
//   ⚠ 데이터는 PrelimDrawViews 가 한 번 만들어 넘긴다(전체 조편성표와 같은 entries — 두 화면이 어긋나지 않게).
//   ⚠ 순위 · 진출 · 점수는 서버 값 그대로. 예정 코트 · 순서 · 신고 마감은 운영진이 저장한 값만(없으면 그리지 않는다).
//   ⚠ 노란색 = 그 조 첫 경기 출전 팀(경기 전일 때만). teal = 본선 진출. 색만으로 구분하지 않는다(글자 · 아이콘 함께).

import React from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Flag, MapPin, Search, X as XIcon } from 'lucide-react';
import { TT } from '@/components/tournaments/tournamentTheme';
import { normalizeQuery } from '@/components/tournaments/standings/presentation';
import {
  findTeams, teamMatches, type DrawEntry, type DrawTeamLine, type SessionHeader,
} from '@/lib/tournaments/officialDrawModel';
import { firstMark } from './FirstMatchMarks';

const NAVY = TT.navy;
const S1 = { fg: '#0A6F65', bg: '#E7F3F1', bd: '#9ED3CB', solid: '#0E8C80' };   // 1차 — teal
const S2 = { fg: '#7A4B00', bg: '#FFF4E0', bd: '#F0CF95', solid: '#B7791F' };   // 2차 — amber(첫 경기 노랑과 겹치지 않게 갈색 계열)
export const sTone = (n: 1 | 2 | null) => (n === 2 ? S2 : S1);
export const sName = (n: 1 | 2 | null) => (n === 1 ? '1차' : n === 2 ? '2차' : '순서 미정');

export default function OfficialDrawBoard({
  entries, sessions, checkinPlace, progress,
}: {
  /** 차수 → 코트 순으로 정렬된 조 목록(PrelimDrawViews). */
  entries: DrawEntry[];
  sessions: SessionHeader[];
  checkinPlace: string | null;
  progress: { done: number; all: number };
}) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const q = normalizeQuery(query);
  const hits = findTeams(entries, q);
  const visible = q ? entries.filter((e) => e.teams.some((t) => teamMatches(t, q))) : entries;
  const anyFirst = entries.some((e) => e.teams.some((t) => t.first));
  const teamCount = entries.reduce((a, e) => a + e.teams.length, 0);
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const sections = ([1, 2, null] as const).map((n) => ({
    key: `s${n}`, n, items: visible.filter((e) => e.sessionNo === n),
  })).filter((s) => s.items.length > 0);

  return (
    <div className="od-board">
      {/* ── 선수 검색 ── */}
      <label className="od-search">
        <Search size={18} color={TT.muted} strokeWidth={2.3} style={{ flexShrink: 0 }} />
        <input id="draw-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="내 이름으로 조 · 코트 찾기" aria-label="선수명으로 검색" />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="검색어 지우기" className="od-clear"><XIcon size={16} strokeWidth={2.4} /></button>
        )}
      </label>

      {q && <SearchResult hits={hits} />}

      {/* ── 1차 · 2차 출전 신고 ── */}
      {!q && sessions.length > 0 && (
        <section className="od-sessions" data-od-sessions aria-label="출전 신고 안내">
          {sessions.map((s) => <SessionTile key={s.sessionNo} s={s} />)}
          {checkinPlace && (
            <p className="od-place"><MapPin size={13} strokeWidth={2.4} />출전 신고 · <b>{checkinPlace}</b> · 첫 경기 출전팀은 신고 마감까지</p>
          )}
        </section>
      )}

      {/* ── 진행 · 범례 ── */}
      {!q && (
        <div className="od-meta">
          <span>{entries.length}개 조 · {teamCount}팀 · 경기 <b>{progress.done}</b> / {progress.all}</span>
          <span className="od-legend">
            {anyFirst && <span data-first-legend><i style={{ background: '#FFF1BF', boxShadow: 'inset 0 0 0 1.5px #E5B300' }} /><Flag size={11} strokeWidth={2.7} color="#5C4300" />첫 경기 출전</span>}
            <span><i style={{ background: TT.teal }} />본선 진출</span>
          </span>
        </div>
      )}

      {/* ── 대진표 ── */}
      {visible.length === 0 ? (
        <p className="od-empty">{q ? '검색 결과가 없습니다. 선수 이름을 다시 확인해 주세요.' : '표시할 조가 없습니다.'}</p>
      ) : sections.map((sec) => (
        <section key={sec.key} className="od-section" data-od-section={sec.key}>
          <SessionBand n={sec.n} h={sessions.find((s) => s.sessionNo === sec.n) ?? null} />
          <div className="od-grid2">
            {sec.items.map((e) => (
              <CompactCard key={e.key} e={e} q={q} open={!!open[e.key]} onToggle={() => toggle(e.key)} />
            ))}
          </div>
        </section>
      ))}

      <style>{CSS}</style>
    </div>
  );
}

function startLine(n: 1 | 2 | null, deadline: string | null, start: string | null): string {
  const parts = [deadline ? `신고 ${deadline} 마감` : null, start ? (/^\d{1,2}:\d{2}$/.test(start) ? `${start} 시작` : `${start} 시작`) : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : (n ? '' : '순서 · 코트 안내 준비 중');
}

function SessionTile({ s }: { s: SessionHeader }) {
  const t = sTone(s.sessionNo);
  const timeStart = s.startTime;
  return (
    <div className="od-tile" data-od-session={s.sessionNo} style={{ borderColor: t.bd, background: t.bg }}>
      <span className="od-tile-tag" style={{ background: t.solid }}>{sName(s.sessionNo)}</span>
      <div className="od-tile-row">
        <span className="od-k">신고 마감</span>
        <span className="od-big" style={{ color: t.fg }}>{s.checkinDeadline ?? '—'}</span>
      </div>
      <div className="od-tile-row">
        <span className="od-k">경기 시작</span>
        {timeStart
          ? <span className="od-big" style={{ color: NAVY }}>{timeStart}</span>
          : <span className="od-note" style={{ color: NAVY }}>{s.startNote ?? '안내 예정'}</span>}
      </div>
    </div>
  );
}

function SessionBand({ n, h }: { n: 1 | 2 | null; h: SessionHeader | null }) {
  const t = sTone(n);
  return (
    <div className="od-band" data-od-band={n ?? 'none'} style={{ background: n ? t.bg : '#F1F5F9', borderColor: n ? t.bd : TT.line }}>
      <span className="od-band-tag" style={{ background: n ? t.solid : '#64748B' }}>{sName(n)}</span>
      <span className="od-band-text" style={{ color: n ? t.fg : TT.muted }}>
        {n && h ? startLine(n, h.checkinDeadline, h.startTime ?? h.startNote) : n ? '' : '순서 · 코트 안내 준비 중'}
      </span>
    </div>
  );
}

function SearchResult({ hits }: { hits: { entry: DrawEntry; team: DrawTeamLine }[] }) {
  if (hits.length === 0) return null;
  return (
    <div className="od-found" data-od-found>
      {hits.slice(0, 4).map(({ entry: e, team: t }) => {
        const tone = sTone(e.sessionNo);
        return (
          <a key={`${e.key}-${t.teamNo}`} href={`#od-${e.key}`} className="od-found-card" data-od-found-team={t.teamNo}>
            <span className="od-found-names">{t.player1Name} · {t.player2Name}</span>
            <span className="od-found-main">
              <b>{e.label}</b>
              {e.courtNo !== null && <span className="od-court-chip">{e.courtText ?? `${e.courtNo}번 코트`}</span>}
              {e.sessionNo && <span className="od-sess-chip" style={{ background: tone.solid }}>{sName(e.sessionNo)}</span>}
            </span>
            {(e.checkinDeadline || e.startText) && (
              <span className="od-found-time">
                {e.checkinDeadline && <span>신고 <b style={{ color: tone.fg }}>{e.checkinDeadline}</b> 마감</span>}
                {e.startText && <span>경기 시작 <b>{e.startText}</b></span>}
              </span>
            )}
            {t.first && <span className="od-found-first"><Flag size={12} strokeWidth={2.6} />이 팀이 {e.label} 첫 경기에 나갑니다</span>}
          </a>
        );
      })}
    </div>
  );
}

/** C — 2열 압축 조 카드. 머리: 조 · 코트(크게) / 차수 · 신고. 팀 한 줄(페어) + 얇은 구분선, 소속은 아래 작은 줄. */
function CompactCard({ e, q, open, onToggle }: { e: DrawEntry; q: string; open: boolean; onToggle: () => void }) {
  const tone = sTone(e.sessionNo);
  const mark = firstMark(e.firstInfo);
  return (
    <article id={`od-${e.key}`} className="oc-card" data-od-entry={e.key} data-od-kind={e.kind} data-od-session-no={e.sessionNo ?? ''}
      style={{ borderTopColor: e.sessionNo ? tone.solid : TT.line }}>
      <header className="oc-head">
        <span className="oc-label">{e.label}</span>
        {e.courtNo !== null && <span className="oc-court" data-od-court={e.courtNo}>{e.courtNo}<small>코트</small></span>}
      </header>
      <p className="oc-sub" style={{ color: tone.fg }}>
        {e.sessionNo ? <b style={{ background: tone.solid }}>{sName(e.sessionNo)}</b> : null}
        {e.checkinDeadline && <span>신고 {e.checkinDeadline}</span>}
        {e.phase !== 'pre' && <span className="oc-st">{e.statusLabel}</span>}
      </p>
      {e.pendingTeams ? <p className="oc-pending">팀 표시 준비 중</p> : (
        <ul className="oc-teams">
          {e.teams.map((t) => {
            const fm = t.first && mark ? mark : null;
            return (
              <li key={t.teamNo} className={`oc-team${teamMatches(t, q) ? ' od-hit' : ''}${t.muted ? ' od-muted' : ''}`}
                {...(fm ? { 'data-first-row': '' } : {})}
                style={fm ? { background: fm.bg, boxShadow: `inset 3px 0 0 ${fm.bd}` } : undefined}>
                <span className="oc-pair"><span className="od-name">{t.player1Name}</span><span className="od-dot">·</span><span className="od-name">{t.player2Name}</span>{fm && <span className="oc-flag" style={{ color: fm.fg }} role="img" aria-label="첫 경기 출전"><Flag size={12} strokeWidth={2.8} /></span>}</span>
                {(t.club || t.record) && (
                  <span className="oc-meta">
                    {t.record && <span className="oc-rec">{t.qualified ? '진출 · ' : ''}{t.record}{t.diff !== null ? ` ${t.diff > 0 ? `+${t.diff}` : t.diff}` : ''}</span>}
                    {t.club && <span className="od-club">{t.club}</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="oc-foot">
        {e.matches.length > 0 && <button type="button" className="od-toggle" aria-expanded={open} onClick={onToggle} data-od-toggle={e.key}>경기<ChevronDown size={13} strokeWidth={2.5} style={{ transform: open ? 'rotate(180deg)' : 'none' }} /></button>}
        <Link href={e.href} className="od-detail" aria-label={`${e.label} 상세`}>상세<ChevronRight size={13} strokeWidth={2.5} /></Link>
      </div>
      {open && (
        <ol className="od-matches oc-matches" data-od-matches={e.key}>
          {e.matches.map((m) => (
            <li key={m.key} className="oc-match" style={m.first && mark ? { background: mark.bg } : undefined}>
              <span className="od-m-label">{m.label} · {m.score ?? (m.status === 'playing' ? '진행 중' : m.first ? '첫 경기' : '대기')}</span>
              <span>{m.team1}</span><span className="od-vs">vs</span><span>{m.team2}</span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

const CSS = `
.od-board { display: flex; flex-direction: column; gap: 12px; }
.od-search { display: flex; align-items: center; gap: 9px; height: 50px; box-sizing: border-box; padding: 0 6px 0 14px;
  background: #fff; border: 1.5px solid #CBD5E1; border-radius: 13px; }
.od-search:focus-within { border-color: ${TT.teal}; }
.od-search input::-webkit-search-cancel-button { -webkit-appearance: none; display: none; }
.od-search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font-family: inherit; font-size: 16px; color: ${TT.ink}; }
.od-clear { flex-shrink: 0; width: 38px; height: 38px; border: 0; border-radius: 8px; background: transparent; color: ${TT.subtle};
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.od-sessions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.od-tile { position: relative; border: 1.5px solid; border-radius: 13px; padding: 26px 10px 9px; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.od-tile-tag { position: absolute; top: 8px; left: 10px; color: #fff; font-size: 12px; font-weight: 900; padding: 1px 8px; border-radius: 6px; }
.od-tile-row { display: flex; flex-direction: column; min-width: 0; }
.od-k { font-size: 11.5px; font-weight: 700; color: ${TT.muted}; }
.od-big { font-size: 26px; font-weight: 900; line-height: 1.1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.od-note { font-size: 15px; font-weight: 900; line-height: 1.3; word-break: keep-all; padding: 3px 0 2px; }
.od-place { grid-column: 1 / -1; margin: 0; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 12.5px; font-weight: 600; color: ${TT.muted}; word-break: keep-all; }
.od-place b { color: ${TT.ink}; }
.od-meta { display: flex; align-items: center; justify-content: space-between; gap: 6px 10px; flex-wrap: wrap; font-size: 12px; font-weight: 600; color: ${TT.muted}; }
.od-meta b { color: ${TT.ink}; font-weight: 800; }
.od-legend { display: inline-flex; gap: 12px; flex-wrap: wrap; }
.od-legend > span { display: inline-flex; align-items: center; gap: 5px; }
.od-legend i { display: inline-block; width: 11px; height: 11px; border-radius: 3px; }
.od-empty { margin: 0; padding: 24px 14px; text-align: center; background: #fff; border: 1px solid ${TT.line}; border-radius: 14px; font-size: 13px; font-weight: 600; color: ${TT.muted}; }
.od-section { display: flex; flex-direction: column; gap: 8px; }
.od-band { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 9px 11px; border: 1.5px solid; border-radius: 12px; }
.od-band-tag { color: #fff; font-size: 13px; font-weight: 900; padding: 2px 9px; border-radius: 6px; }
.od-band-text { font-size: 14px; font-weight: 800; word-break: keep-all; }
.od-court-chip { display: inline-flex; align-items: center; gap: 3px; padding: 3px 9px 3px 7px; border-radius: 8px; background: ${NAVY}; color: #fff;
  font-size: 14.5px; font-weight: 900; white-space: nowrap; font-variant-numeric: tabular-nums; }
.od-sess-chip { color: #fff; font-size: 12.5px; font-weight: 900; padding: 2px 8px; border-radius: 6px; white-space: nowrap; }
.od-name { font-size: 15.5px; font-weight: 800; color: ${TT.ink}; white-space: nowrap; }
.od-dot { color: ${TT.subtle}; font-weight: 700; }
.od-club { font-size: 12px; font-weight: 600; color: ${TT.muted}; overflow-wrap: anywhere; word-break: keep-all; margin-left: 2px; }
.od-first { display: inline-flex; align-items: center; gap: 2px; font-size: 11.5px; font-weight: 900; white-space: nowrap; margin-left: 2px; }
.od-hit { outline: 2px solid ${TT.teal}; outline-offset: -2px; }
.od-muted .od-name { color: ${TT.subtle}; }
.od-toggle, .od-detail { display: inline-flex; align-items: center; gap: 3px; min-height: 40px; padding: 0 2px; border: 0; background: transparent; font-family: inherit;
  font-size: 12.5px; font-weight: 800; color: ${TT.tealDeep}; cursor: pointer; text-decoration: none; }
.od-detail { margin-left: auto; color: ${TT.muted}; }
.od-matches { list-style: none; margin: 0 0 6px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.od-m-label { font-size: 11.5px; font-weight: 800; color: ${TT.muted}; white-space: nowrap; }
.od-vs { color: ${TT.subtle}; font-size: 11.5px; font-weight: 700; }
.od-found { display: flex; flex-direction: column; gap: 8px; }
.od-found-card { display: flex; flex-direction: column; gap: 5px; padding: 12px 13px; border-radius: 14px; background: ${NAVY}; color: #fff; text-decoration: none; }
.od-found-names { font-size: 13px; font-weight: 700; color: #CBD5E1; word-break: keep-all; }
.od-found-main { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.od-found-main b { font-size: 24px; font-weight: 900; letter-spacing: -0.02em; }
.od-found-card .od-court-chip { background: #fff; color: ${NAVY}; font-size: 16px; }
.od-found-time { display: flex; gap: 4px 12px; flex-wrap: wrap; font-size: 14px; font-weight: 700; color: #E2E8F0; }
.od-found-time b { font-size: 17px; font-weight: 900; color: #fff; }
.od-found-first { display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; font-size: 12.5px; font-weight: 900; color: #5C4300; background: #FFF1BF; border-radius: 6px; padding: 2px 8px; }
/* C — 2열 압축 */
.od-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.oc-card { min-width: 0; background: #fff; border: 1px solid ${TT.line}; border-top: 3px solid; border-radius: 11px; padding: 7px 8px 2px; display: flex; flex-direction: column; scroll-margin-top: 80px; }
.oc-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 2px 4px; }
.oc-label { font-size: 18px; font-weight: 900; color: ${NAVY}; letter-spacing: -0.02em; white-space: nowrap; }
.oc-court { display: inline-flex; align-items: baseline; gap: 1px; padding: 1px 7px; border-radius: 7px; background: ${NAVY}; color: #fff; font-size: 17px; font-weight: 900; font-variant-numeric: tabular-nums; white-space: nowrap; }
.oc-court small { font-size: 10.5px; font-weight: 800; margin-left: 1px; }
.oc-sub { margin: 3px 0 4px; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 12.5px; font-weight: 800; }
.oc-sub b { color: #fff; font-size: 11.5px; font-weight: 900; padding: 0 6px; border-radius: 5px; line-height: 1.6; }
.oc-st { color: ${TT.tealDeep}; margin-left: auto; font-size: 11.5px; }
.oc-pending { margin: 4px 0 8px; font-size: 12px; font-weight: 600; color: ${TT.muted}; }
.oc-teams { list-style: none; margin: 0 -8px; padding: 0; }
.oc-team { display: flex; flex-direction: column; padding: 5px 8px; border-top: 1px solid ${TT.line}; min-width: 0; }
.oc-pair { display: flex; flex-wrap: wrap; column-gap: 3px; align-items: baseline; }
.oc-team .od-name { font-size: 14.5px; white-space: normal; overflow-wrap: anywhere; word-break: keep-all; }
.oc-flag { display: inline-flex; align-self: center; margin-left: 3px; }
.oc-meta { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 5px; }
.oc-meta .od-club { margin-left: 0; font-size: 11px; line-height: 1.35; }
.oc-meta .od-first { margin-left: 0; font-size: 10.5px; }
.oc-rec { font-size: 11.5px; font-weight: 800; color: ${TT.inkSoft}; font-variant-numeric: tabular-nums; }
.oc-foot { display: flex; justify-content: space-between; border-top: 1px solid ${TT.line}; margin: 0 -8px; padding: 0 8px; }
.oc-foot .od-toggle, .oc-foot .od-detail { min-height: 34px; font-size: 12px; }
.oc-matches { margin: 0 0 6px; }
.oc-match { display: flex; flex-wrap: wrap; column-gap: 4px; padding: 5px 6px; border-radius: 7px; background: #F8FAFC; font-size: 12px; font-weight: 600; color: ${TT.ink}; word-break: keep-all; }
.oc-match .od-m-label { flex-basis: 100%; }
@media (min-width: 720px) { .od-grid2 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 340px) { .od-big { font-size: 23px; } .od-name { font-size: 15px; } }
`;
