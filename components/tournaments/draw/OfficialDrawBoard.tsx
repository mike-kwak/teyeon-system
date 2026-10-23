'use client';

// 공개 DRAW — 모바일 예선 대진표(read-only). 참가자가 '내 조 · 코트 · 신고 시각'을 바로 찾는 화면.
//
//   화면 목적을 둘로 나눈다(조 번호와 코트 번호를 한 목록에서 동시에 순서대로 만들 수 없으므로):
//   · 조별 보기(기본) · 코트별 보기(전환) — 조별은 1조 → 18조. 카드 = 큰 조 번호 + 바로 옆 예정 코트 / 차수 · 신고 마감 · 경기 시작 / 팀별 선수 · 소속
//   · 코트별 보기 — 1번 → 10번 코트. 코트 카드 = 1차 배정 조 / 2차 배정 조(없으면 '배정 없음') · 신고 마감 · 명단 펼치기 · 상세
//   · 검색은 두 보기 위에서 같다 — 조 · 파트너 · 소속 · 코트 · 차수 · 신고 · 시작 · 첫 경기 출전을 한 카드로.
//   ⚠ 데이터는 PrelimDrawViews 가 한 번 만들어 넘긴다(전체 조편성표와 같은 entries — 두 화면이 어긋나지 않게).
//   ⚠ 보기 전환은 화면 배열만 바꾼다 — 저장 · 재계산 없음. 조 번호는 공개 표시 번호(순위결정전 = 1조), 내부 group_no 는 쓰지 않는다.
//   ⚠ 신고 마감(08:40 · 09:20)과 경기 시작(09:00 · 앞 조 종료 후)은 다른 말로 — 09:20 을 시작 시각으로 쓰지 않는다.
//   ⚠ 노란색 = 그 조 첫 경기 출전 팀(경기 전일 때만). teal = 본선 진출. 색만으로 구분하지 않는다(글자 · 아이콘 함께).

import React from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Flag, MapPin, Search, X as XIcon } from 'lucide-react';
import { TT } from '@/components/tournaments/tournamentTheme';
import { normalizeQuery } from '@/components/tournaments/standings/presentation';
import {
  buildCourtSlots, findTeams, teamMatches, type CourtSlot, type DrawEntry, type DrawTeamLine, type SessionHeader,
} from '@/lib/tournaments/officialDrawModel';
import { firstMark } from './FirstMatchMarks';

const NAVY = TT.navy;
const S1 = { fg: '#0A6F65', bg: '#E7F3F1', bd: '#9ED3CB', solid: '#0E8C80' };   // 1차 — teal
const S2 = { fg: '#7A4B00', bg: '#FFF4E0', bd: '#F0CF95', solid: '#B7791F' };   // 2차 — amber(첫 경기 노랑과 겹치지 않게 갈색 계열)
export const sTone = (n: 1 | 2 | null) => (n === 2 ? S2 : S1);
export const sName = (n: 1 | 2 | null) => (n === 1 ? '1차' : n === 2 ? '2차' : '순서 미정');

type View = 'group' | 'court';

/** '09:00' → '09:00 시작' · '앞 조 종료 후' → '앞 조 종료 후 시작'. 저장된 안내가 이미 '…시작' 으로 끝나면 그대로(중복 방지). */
const startPhrase = (t: string | null) => {
  const s = t?.trim();
  return s ? (/시작$/.test(s) ? s : `${s} 시작`) : null;
};
/** 선수별 소속 — 선수별 값이 없으면 팀 값(한 번만, 첫 선수 아래). */
const clubsOf = (t: DrawTeamLine): [string | null, string | null] =>
  (t.club1 || t.club2 ? [t.club1, t.club2] : [t.club, null]);

export default function OfficialDrawBoard({
  entries, sessions, checkinPlace, progress,
}: {
  /** 공개 조 번호 순(1조 → 18조)으로 정렬된 조 목록(PrelimDrawViews · 전체 조편성표와 같은 배열). */
  entries: DrawEntry[];
  sessions: SessionHeader[];
  checkinPlace: string | null;
  progress: { done: number; all: number };
}) {
  const [query, setQuery] = React.useState('');
  const [view, setView] = React.useState<View>('group');   // 기본 = 조별 보기(1조 → 18조). 코트별 보기는 탭으로 전환.
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const q = normalizeQuery(query);
  const hits = findTeams(entries, q);
  const hitKeys = new Set(hits.map((h) => h.entry.key));
  const visible = q ? entries.filter((e) => hitKeys.has(e.key)) : entries;
  const courts = React.useMemo(() => buildCourtSlots(entries), [entries]);
  const anyFirst = entries.some((e) => e.teams.some((t) => t.first));
  const teamCount = entries.reduce((a, e) => a + e.teams.length, 0);
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const lastCourt = courts.courts.length ? courts.courts[courts.courts.length - 1].courtNo : null;

  // 조 바로가기 → 조별 보기의 그 카드로. 검색 결과 → 지금 보기에서(코트별이면 그 코트 카드 · 명단 펼침).
  const goEntry = (key: string) => {
    setView('group');
    requestAnimationFrame(() => document.getElementById(`od-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const goFound = (key: string) => {
    const e = entries.find((x) => x.key === key);
    if (view !== 'court' || !e || e.courtNo === null) { goEntry(key); return; }
    setOpen((o) => ({ ...o, [`c-${key}`]: true }));
    requestAnimationFrame(() => document.getElementById(`odc-${e.courtNo}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const shownCourts = q
    ? courts.courts.filter((c) => [...c.s1, ...c.s2, ...c.other].some((e) => hitKeys.has(e.key)))
    : courts.courts;

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

      {q && <SearchResult hits={hits} onGo={goFound} />}

      {/* ── 1차 · 2차 출전 신고 ── */}
      {!q && sessions.length > 0 && (
        <section className="od-sessions" data-od-sessions aria-label="출전 신고 안내">
          {sessions.map((s) => <SessionTile key={s.sessionNo} s={s} />)}
          {checkinPlace && (
            <p className="od-place"><MapPin size={13} strokeWidth={2.4} />출전 신고 · <b>{checkinPlace}</b> · 첫 경기 출전팀은 신고 마감까지</p>
          )}
        </section>
      )}

      {/* ── 조별 보기 / 코트별 보기 ── */}
      <div className="od-views" role="tablist" aria-label="대진표 보기">
        <button type="button" role="tab" aria-selected={view === 'group'} data-od-view="group" onClick={() => setView('group')}>
          <b>조별 보기</b><small>{entries.length ? `1조 → ${entries.length}조` : '조 번호 순'}</small>
        </button>
        <button type="button" role="tab" aria-selected={view === 'court'} data-od-view="court" onClick={() => setView('court')}>
          <b>코트별 보기</b><small>{lastCourt ? `1번 → ${lastCourt}번 코트` : '코트 번호 순'}</small>
        </button>
      </div>

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

      {view === 'group' ? (
        <>
          {!q && entries.length > 6 && (
            <nav className="od-jump" aria-label="조 바로가기" data-od-jump>
              {entries.map((e) => (
                <button key={e.key} type="button" onClick={() => goEntry(e.key)} data-od-jump-to={e.key}
                  aria-label={`${e.label}로 이동`} style={{ borderColor: e.sessionNo ? sTone(e.sessionNo).bd : TT.line }}>
                  {e.displayNo ?? e.label}
                </button>
              ))}
            </nav>
          )}
          {visible.length === 0 ? (
            <p className="od-empty">{q ? '검색 결과가 없습니다. 선수 이름을 다시 확인해 주세요.' : '표시할 조가 없습니다.'}</p>
          ) : (
            <div className="od-groups" data-od-groups>
              {visible.map((e) => <GroupCard key={e.key} e={e} q={q} open={!!open[e.key]} onToggle={() => toggle(e.key)} />)}
            </div>
          )}
        </>
      ) : shownCourts.length === 0 && (q || courts.unassigned.length === 0) ? (
        <p className="od-empty">{q ? '검색 결과가 없습니다. 선수 이름을 다시 확인해 주세요.' : '예정 코트가 아직 정해지지 않았습니다.'}</p>
      ) : (
        <div className="od-courts" data-od-courts>
          {shownCourts.map((c) => (
            <CourtCard key={c.courtNo} c={c} q={q} hitKeys={hitKeys} open={open} onToggle={toggle} />
          ))}
          {!q && courts.unassigned.length > 0 && (
            <p className="od-empty" data-od-unassigned>코트 미정 · {courts.unassigned.map((e) => e.label).join(' · ')}</p>
          )}
        </div>
      )}

      <style>{CSS}</style>
    </div>
  );
}

function SessionTile({ s }: { s: SessionHeader }) {
  const t = sTone(s.sessionNo);
  return (
    <div className="od-tile" data-od-session={s.sessionNo} style={{ borderColor: t.bd, background: t.bg }}>
      <span className="od-tile-tag" style={{ background: t.solid }}>{sName(s.sessionNo)}</span>
      <div className="od-tile-row">
        <span className="od-k">출전 신고 마감</span>
        <span className="od-big" style={{ color: t.fg }}>{s.checkinDeadline ?? '—'}</span>
      </div>
      <div className="od-tile-row">
        <span className="od-k">경기 시작</span>
        {s.startTime
          ? <span className="od-big" style={{ color: NAVY }}>{s.startTime}</span>
          : <span className="od-note" style={{ color: NAVY }}>{s.startNote ?? '안내 예정'}</span>}
      </div>
    </div>
  );
}

/** 차수 칩 + '신고 08:40 마감' + '09:00 시작' — 두 시각을 다른 말로. */
function SessionLine({ e }: { e: DrawEntry }) {
  const tone = sTone(e.sessionNo);
  return (
    <p className="og-sess" style={{ color: tone.fg }} data-od-sess-line>
      <b className="og-chip" style={{ background: e.sessionNo ? tone.solid : '#64748B' }}>{sName(e.sessionNo)}</b>
      {e.checkinDeadline && <span className="og-ck">신고 <strong>{e.checkinDeadline}</strong> 마감</span>}
      {e.startText && <span className="og-start" data-od-start>{startPhrase(e.startText)}</span>}
    </p>
  );
}

function SearchResult({ hits, onGo }: { hits: { entry: DrawEntry; team: DrawTeamLine }[]; onGo: (key: string) => void }) {
  if (hits.length === 0) return null;
  const MAX = 6;
  return (
    <div className="od-found" data-od-found>
      {hits.length > 1 && <p className="od-found-count">검색 결과 {hits.length}팀{hits.length > MAX ? ` · 위 ${MAX}팀만 표시(이름을 더 입력해 주세요)` : ''}</p>}
      {hits.slice(0, MAX).map(({ entry: e, team: t }) => {
        const tone = sTone(e.sessionNo);
        const [c1, c2] = clubsOf(t);
        return (
          <a key={`${e.key}-${t.teamNo}`} href={`#od-${e.key}`} onClick={(ev) => { ev.preventDefault(); onGo(e.key); }}
            className="od-found-card" data-od-found-team={t.teamNo} data-od-found-entry={e.key}>
            <span className="od-found-main">
              <b className="od-found-label">{e.label}</b>
              {e.courtNo !== null && <span className="od-court-chip">{e.courtText ?? `${e.courtNo}번 코트`}</span>}
              {e.sessionNo && <span className="od-sess-chip" style={{ background: tone.solid }}>{sName(e.sessionNo)}</span>}
            </span>
            {e.subLabel && <span className="od-found-sub">{e.subLabel}</span>}
            <span className="od-found-players">
              <PlayerCell name={t.player1Name} club={c1} dark />
              <PlayerCell name={t.player2Name} club={c2} dark />
            </span>
            {(e.checkinDeadline || e.startText) && (
              <span className="od-found-time">
                {e.checkinDeadline && <span>신고 <b style={{ color: '#FFE3A3' }}>{e.checkinDeadline}</b> 마감</span>}
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

function PlayerCell({ name, club, dark = false }: { name: string; club: string | null; dark?: boolean }) {
  return (
    <span className={`og-player${dark ? ' og-player-dark' : ''}`}>
      <span className="og-name od-name">{name}</span>
      {club && <span className="og-club od-club">{club}</span>}
    </span>
  );
}

/** 조 카드 — 머리: 큰 조 번호 + 바로 옆 예정 코트 / 차수 · 신고 마감 · 경기 시작. 몸: 팀별 선수 두 명(이름 진하게 · 소속 작게). */
function GroupCard({ e, q, open, onToggle }: { e: DrawEntry; q: string; open: boolean; onToggle: () => void }) {
  const tone = sTone(e.sessionNo);
  const mark = firstMark(e.firstInfo);
  return (
    <article id={`od-${e.key}`} className="og-card" data-od-entry={e.key} data-od-kind={e.kind} data-od-session-no={e.sessionNo ?? ''}
      data-od-display-no={e.displayNo ?? ''} style={{ borderTopColor: e.sessionNo ? tone.solid : TT.line }}>
      <header className="og-head">
        <span className="og-label oc-label">{e.label}</span>
        {e.courtNo !== null && (
          <span className="og-court" data-od-court={e.courtNo} aria-label={`예정 ${e.courtNo}번 코트`}>
            <b>{e.courtNo}</b>번 코트
          </span>
        )}
        {e.phase !== 'pre' && <span className="og-st">{e.statusLabel}</span>}
      </header>
      {e.subLabel && <p className="og-subl" data-od-sublabel>{e.subLabel}</p>}
      <SessionLine e={e} />
      {e.pendingTeams ? <p className="og-pending">팀 표시 준비 중</p> : (
        <ul className="og-teams">
          {e.teams.map((t) => {
            const fm = t.first && mark ? mark : null;
            const [c1, c2] = clubsOf(t);
            return (
              <li key={t.teamNo} className={`og-team oc-team${teamMatches(t, q) ? ' od-hit' : ''}${t.muted ? ' od-muted' : ''}`}
                data-od-team={t.teamNo}
                {...(fm ? { 'data-first-row': '' } : {})}
                style={fm ? { background: fm.bg, boxShadow: `inset 4px 0 0 ${fm.bd}` } : undefined}>
                <span className="og-pair oc-pair">
                  <PlayerCell name={t.player1Name} club={c1} />
                  <PlayerCell name={t.player2Name} club={c2} />
                </span>
                {(fm || t.record) && (
                  <span className="og-tmeta">
                    {fm && <span className="og-first" style={{ color: fm.fg }}><Flag size={12} strokeWidth={2.8} />첫 경기 출전</span>}
                    {t.record && <span className="og-rec">{t.qualified ? '본선 진출 · ' : ''}{t.record}{t.diff !== null ? ` ${t.diff > 0 ? `+${t.diff}` : t.diff}` : ''}</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="og-foot">
        {e.matches.length > 0 && <button type="button" className="od-toggle" aria-expanded={open} onClick={onToggle} data-od-toggle={e.key}>경기 순서<ChevronDown size={14} strokeWidth={2.5} style={{ transform: open ? 'rotate(180deg)' : 'none' }} /></button>}
        <Link href={e.href} className="od-detail" aria-label={`${e.label} 상세`} data-od-detail={e.key}>조 상세<ChevronRight size={14} strokeWidth={2.5} /></Link>
      </div>
      {open && (
        <ol className="od-matches" data-od-matches={e.key}>
          {e.matches.map((m) => (
            <li key={m.key} className="od-match" style={m.first && mark ? { background: mark.bg } : undefined}>
              <span className="od-m-label">{m.label} · {m.score ?? (m.status === 'playing' ? '진행 중' : m.first ? '첫 경기' : '대기')}</span>
              <span>{m.team1}</span><span className="od-vs">vs</span><span>{m.team2}</span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

/** 코트 카드 — 큰 코트 번호 / 1차 배정 조 / 2차 배정 조(없으면 '배정 없음'). 줄을 누르면 그 조 명단을 펼친다. */
function CourtCard({ c, q, hitKeys, open, onToggle }: {
  c: CourtSlot; q: string; hitKeys: Set<string>; open: Record<string, boolean>; onToggle: (k: string) => void;
}) {
  const rows: { n: 1 | 2 | null; items: DrawEntry[] }[] = [
    { n: 1, items: c.s1 }, { n: 2, items: c.s2 }, ...(c.other.length ? [{ n: null, items: c.other }] : []),
  ];
  return (
    <article className="ct-card" data-od-court-card={c.courtNo} id={`odc-${c.courtNo}`}>
      <header className="ct-head">
        <span className="ct-no"><b>{c.courtNo}</b>번 코트</span>
      </header>
      {rows.map(({ n, items }) => {
        const tone = sTone(n);
        if (items.length === 0) {
          return (
            <div key={`n${n}`} className="ct-row ct-none" data-od-court-slot={`${c.courtNo}-${n}`} data-od-court-empty>
              <b className="og-chip" style={{ background: '#CBD5E1' }}>{sName(n)}</b>
              <span>배정 없음</span>
            </div>
          );
        }
        return items.map((e) => {
          const expanded = !!open[`c-${e.key}`] || (!!q && hitKeys.has(e.key));
          const mark = firstMark(e.firstInfo);
          return (
            <div key={e.key} className="ct-slot" data-od-court-slot={`${c.courtNo}-${n}`} data-od-court-entry={e.key}
              style={{ borderLeftColor: n ? tone.solid : TT.line }}>
              <button type="button" className="ct-row" aria-expanded={expanded} onClick={() => onToggle(`c-${e.key}`)} data-od-court-toggle={e.key}>
                <span className="ct-line1">
                  <b className="og-chip" style={{ background: n ? tone.solid : '#64748B' }}>{sName(n)}</b>
                  <span className="ct-group">{e.label}</span>
                  {e.subLabel && <span className="ct-sub">{e.subLabel}</span>}
                  <span className="ct-more">{expanded ? '접기' : '명단'}<ChevronDown size={15} strokeWidth={2.5} style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} /></span>
                </span>
                {(e.checkinDeadline || e.startText) && (
                  <span className="ct-times" data-od-court-times>
                    {e.checkinDeadline && <span className="ct-ck" style={{ color: tone.fg }}>신고 <strong>{e.checkinDeadline}</strong> 마감</span>}
                    {e.startText && <span className="ct-st">{startPhrase(e.startText)}</span>}
                  </span>
                )}
              </button>
              {expanded && (
                <div className="ct-list" data-od-court-list={e.key}>
                  {e.pendingTeams ? <p className="og-pending">팀 표시 준비 중</p> : (
                    <ul>
                      {e.teams.map((t) => {
                        const fm = t.first && mark ? mark : null;
                        const [c1, c2] = clubsOf(t);
                        return (
                          <li key={t.teamNo} className={teamMatches(t, q) ? 'od-hit' : undefined}
                            style={fm ? { background: fm.bg, boxShadow: `inset 3px 0 0 ${fm.bd}` } : undefined}>
                            <PlayerCell name={t.player1Name} club={c1} />
                            <PlayerCell name={t.player2Name} club={c2} />
                            {fm && <span className="og-first" style={{ color: fm.fg }}><Flag size={11} strokeWidth={2.8} />첫 경기 출전</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <Link href={e.href} className="od-detail" aria-label={`${e.label} 상세`}>{e.label} 상세<ChevronRight size={14} strokeWidth={2.5} /></Link>
                </div>
              )}
            </div>
          );
        });
      })}
    </article>
  );
}

const CSS = `
.od-board { display: flex; flex-direction: column; gap: 12px; }
.od-search { display: flex; align-items: center; gap: 9px; height: 52px; box-sizing: border-box; padding: 0 6px 0 14px;
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
.od-views { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.od-views button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; min-height: 52px; padding: 4px 6px;
  border: 1.5px solid ${TT.line}; border-radius: 12px; background: #fff; font-family: inherit; color: #5B6B82; cursor: pointer; }
.od-views b { font-size: 15px; font-weight: 900; }
.od-views small { font-size: 11.5px; font-weight: 700; opacity: 0.85; }
.od-views button[aria-selected="true"] { background: ${NAVY}; border-color: ${NAVY}; color: #fff; }
.od-meta { display: flex; align-items: center; justify-content: space-between; gap: 6px 10px; flex-wrap: wrap; font-size: 12px; font-weight: 600; color: ${TT.muted}; }
.od-meta b { color: ${TT.ink}; font-weight: 800; }
.od-legend { display: inline-flex; gap: 12px; flex-wrap: wrap; }
.od-legend > span { display: inline-flex; align-items: center; gap: 5px; }
.od-legend i { display: inline-block; width: 11px; height: 11px; border-radius: 3px; }
.od-empty { margin: 0; padding: 24px 14px; text-align: center; background: #fff; border: 1px solid ${TT.line}; border-radius: 14px; font-size: 13px; font-weight: 600; color: ${TT.muted}; }
.od-jump { display: grid; grid-template-columns: repeat(9, minmax(0, 1fr)); gap: 4px; }
.od-jump button { min-height: 36px; padding: 0; border: 1.5px solid; border-radius: 9px; background: #fff; font-family: inherit;
  font-size: 14px; font-weight: 900; color: ${NAVY}; font-variant-numeric: tabular-nums; cursor: pointer; }
.od-court-chip { display: inline-flex; align-items: center; gap: 3px; padding: 3px 9px; border-radius: 8px; background: ${NAVY}; color: #fff;
  font-size: 14.5px; font-weight: 900; white-space: nowrap; font-variant-numeric: tabular-nums; }
.od-sess-chip { color: #fff; font-size: 12.5px; font-weight: 900; padding: 2px 8px; border-radius: 6px; white-space: nowrap; }
.od-hit { outline: 2px solid ${TT.teal}; outline-offset: -2px; }
.od-muted .og-name { color: ${TT.subtle}; }
.od-toggle, .od-detail { display: inline-flex; align-items: center; gap: 3px; min-height: 40px; padding: 0 2px; border: 0; background: transparent; font-family: inherit;
  font-size: 13px; font-weight: 800; color: ${TT.tealDeep}; cursor: pointer; text-decoration: none; }
.od-detail { margin-left: auto; color: ${TT.muted}; }
.od-matches { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.od-match { display: flex; flex-wrap: wrap; column-gap: 4px; padding: 6px 8px; border-radius: 8px; background: #F8FAFC; font-size: 13px; font-weight: 600; color: ${TT.ink}; word-break: keep-all; }
.od-m-label { flex-basis: 100%; font-size: 12px; font-weight: 800; color: ${TT.muted}; }
.od-vs { color: ${TT.subtle}; font-size: 12px; font-weight: 700; }
/* 검색 결과 */
.od-found { display: flex; flex-direction: column; gap: 8px; }
.od-found-count { margin: 0 2px; font-size: 12.5px; font-weight: 800; color: ${TT.muted}; }
.od-found-card { display: flex; flex-direction: column; gap: 7px; padding: 13px 14px; border-radius: 14px; background: ${NAVY}; color: #fff; text-decoration: none; }
.od-found-main { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.od-found-label { font-size: 28px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.05; }
.od-found-card .od-court-chip { background: #fff; color: ${NAVY}; font-size: 16px; }
.od-found-sub { margin-top: -4px; font-size: 12px; font-weight: 700; color: #CBD5E1; }
.od-found-players { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.16); border-bottom: 1px solid rgba(255,255,255,0.16); }
.od-found-time { display: flex; gap: 4px 14px; flex-wrap: wrap; font-size: 14px; font-weight: 700; color: #E2E8F0; }
.od-found-time b { font-size: 17px; font-weight: 900; color: #fff; }
.od-found-first { display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; font-size: 12.5px; font-weight: 900; color: #5C4300; background: #FFF1BF; border-radius: 6px; padding: 2px 8px; }
/* 선수 칸 — 이름 진하게 · 소속 작게(긴 소속은 줄바꿈, 다른 칸 침범 없음) */
.og-player { display: flex; flex-direction: column; min-width: 0; }
.og-name { font-size: 16.5px; font-weight: 800; color: ${TT.ink}; line-height: 1.3; overflow-wrap: anywhere; word-break: keep-all; }
.og-club { font-size: 12px; font-weight: 600; color: ${TT.muted}; line-height: 1.35; overflow-wrap: anywhere; word-break: keep-all; }
.og-player-dark .og-name { color: #fff; font-size: 17px; }
.og-player-dark .og-club { color: #CBD5E1; }
/* 조별 · 코트별 카드 열 수 — 화면(viewport)이 아니라 이 목록의 실제 폭으로 정한다.
   카드 하나가 340px 이상 될 때만 2열 · 3열(앱 화면이 좁은 태블릿 · PC 에서 2열로 찌그러지지 않게). */
.od-groups, .od-courts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 10px; }
.og-card { min-width: 0; background: #fff; border: 1px solid ${TT.line}; border-top: 4px solid; border-radius: 13px; padding: 10px 12px 0; display: flex; flex-direction: column; scroll-margin-top: 80px; }
.og-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.og-label { font-size: 28px; font-weight: 900; color: ${NAVY}; letter-spacing: -0.03em; line-height: 1.05; white-space: nowrap; }
.og-court { display: inline-flex; align-items: baseline; gap: 2px; padding: 3px 10px; border-radius: 9px; background: ${NAVY}; color: #fff;
  font-size: 13.5px; font-weight: 800; white-space: nowrap; }
.og-court b { font-size: 20px; font-weight: 900; font-variant-numeric: tabular-nums; line-height: 1.1; }
.og-st { margin-left: auto; font-size: 12.5px; font-weight: 900; color: ${TT.tealDeep}; }
.og-subl { margin: 2px 0 0; font-size: 12px; font-weight: 700; color: ${TT.muted}; }
.og-sess { margin: 6px 0 8px; display: flex; align-items: center; gap: 4px 8px; flex-wrap: wrap; font-size: 13.5px; font-weight: 700; }
.og-sess strong { font-size: 15px; font-weight: 900; font-variant-numeric: tabular-nums; }
.og-chip { color: #fff; font-size: 12px; font-weight: 900; padding: 1px 7px; border-radius: 6px; line-height: 1.6; white-space: nowrap; }
.og-start { color: ${TT.inkSoft}; font-weight: 700; }
.og-start::before { content: '·'; margin-right: 6px; color: ${TT.subtle}; }
.og-pending { margin: 4px 0 10px; font-size: 13px; font-weight: 600; color: ${TT.muted}; }
.og-teams { list-style: none; margin: 0 -12px; padding: 0; }
.og-team { display: flex; flex-direction: column; gap: 3px; padding: 8px 12px; border-top: 1px solid ${TT.line}; min-width: 0; }
.og-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.og-tmeta { display: flex; flex-wrap: wrap; gap: 2px 10px; }
.og-first { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; font-weight: 900; white-space: nowrap; }
.og-rec { font-size: 12.5px; font-weight: 800; color: ${TT.inkSoft}; font-variant-numeric: tabular-nums; }
.og-foot { display: flex; justify-content: space-between; border-top: 1px solid ${TT.line}; margin: 0 -12px; padding: 0 12px; }
/* 코트별 보기 — 코트 하나 = 카드 하나(1번 → 10번) */
.ct-card { min-width: 0; background: #fff; border: 1px solid ${TT.line}; border-radius: 13px; overflow: hidden; scroll-margin-top: 80px; }
.ct-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: ${NAVY}; color: #fff; }
.ct-no { font-size: 14px; font-weight: 800; }
.ct-no b { font-size: 26px; font-weight: 900; font-variant-numeric: tabular-nums; margin-right: 1px; }
.ct-slot { border-top: 1px solid ${TT.line}; border-left: 4px solid; }
.ct-head + .ct-slot { border-top: 0; }
/* 줄 = 1행 차수 칩 · 조 · 명단 / 2행 신고 마감 · 경기 시작(줄 전체 폭 — 좁은 칸에 넣지 않는다) */
.ct-row { width: 100%; display: flex; flex-direction: column; align-items: stretch; gap: 4px; min-height: 56px; padding: 9px 12px 10px; box-sizing: border-box;
  border: 0; background: transparent; font-family: inherit; text-align: left; cursor: pointer; color: ${TT.ink}; }
.ct-line1 { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; min-width: 0; }
.ct-group { font-size: 23px; font-weight: 900; color: ${NAVY}; letter-spacing: -0.02em; white-space: nowrap; line-height: 1.15; }
.ct-sub { font-size: 12px; font-weight: 700; color: ${TT.muted}; }
.ct-row .og-chip { min-width: 2.7em; box-sizing: border-box; text-align: center; }
.ct-times { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; font-size: 13.5px; font-weight: 700; color: ${TT.inkSoft}; line-height: 1.4; word-break: keep-all; }
.ct-times strong { font-size: 15.5px; font-weight: 900; font-variant-numeric: tabular-nums; }
.ct-ck, .ct-st { white-space: normal; overflow-wrap: anywhere; }
.ct-more { margin-left: auto; display: inline-flex; align-items: center; gap: 1px; flex-shrink: 0; font-size: 12.5px; font-weight: 800; color: ${TT.tealDeep}; }
.ct-none { flex-direction: row; align-items: center; gap: 10px; border-top: 1px solid ${TT.line}; border-left: 4px solid #E2E8F0; color: ${TT.subtle}; font-size: 13.5px; font-weight: 700; min-height: 44px; }
.ct-head + .ct-none { border-top: 0; }
.ct-list { padding: 0 12px 2px; }
.ct-list ul { list-style: none; margin: 0; padding: 0; }
.ct-list li { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 10px; padding: 7px 8px; border-top: 1px solid ${TT.line}; }
.ct-list li .og-first { grid-column: 1 / -1; }
.ct-list .og-name { font-size: 15.5px; }
.ct-list .od-detail { margin-left: 0; color: ${TT.tealDeep}; }
@media (max-width: 340px) {
  .od-big { font-size: 23px; } .og-label { font-size: 26px; } .og-name { font-size: 16px; }
  .od-jump { grid-template-columns: repeat(6, minmax(0, 1fr)); }
}
`;
