'use client';

// MY MATCH — 로그인 없이 '내 팀' 을 고르면 그 팀의 예선 · 본선 경기를 한곳에서 보여 주고,
//   본부가 경기를 실제 코트에 투입하면 화면 안에 큰 알림으로 코트 번호를 띄운다.
//
//   ⚠ 화면이 켜져 있고 이 페이지가 앞에 떠 있을 때만 동작한다. 화면 잠금 · 다른 앱 · 브라우저 종료 중에는
//     알림이 오지 않는다(푸시 알림 아님). 본부 현장 호명이 우선이다 — 화면에 늘 적어 둔다.
//   ⚠ 코트는 '실제 투입 후' 공개되는 번호만 쓴다. 사전 배정 코트 · 조별 신고 시간은 이번 단계에 없다.
//   ⚠ 이 페이지를 처음 열었을 때 이미 진행 중인 경기는 '현재 N번 코트에서 진행 중' 으로만 보여 주고 알림을 띄우지 않는다.
//   ⚠ 데이터는 공개 대진표 RPC 그대로 — 새 서버 기능 · 개인정보 없음. 내 팀 선택은 이 브라우저에만 저장한다.

import React from 'react';
import Link from 'next/link';
import { BellRing, ChevronRight, MapPin, RefreshCw, Search, Users, Volume2, VolumeX, X } from 'lucide-react';
import { TT, FONT_LABEL } from '@/components/tournaments/tournamentTheme';
import {
  BackToHub, DrawHeading, PublicDrawShell,
} from '@/components/tournaments/draw/PublicDrawShell';
import { MY_FAST_MS, MY_STALE_MS, useMyMatchFeed } from '@/components/tournaments/draw/useMyMatchFeed';
import {
  buildView, checkSaved, courtText, diffEvents, freshEvents, hasPending, isCourtEvent, listTeams, searchTeams,
  snapshotOf, teamGroupLabel, type MyEvent, type MyMatch, type MyMatchSchedule, type MySnapshot, type MyTeam, type SavedTeam,
} from '@/lib/tournaments/myMatchModel';
import { firstDetail, firstHeadline, isFirstUpcoming, type FirstMatchInfo } from '@/lib/tournaments/firstMatchModel';
import { HighlightBadge } from '@/components/tournaments/standings/primitives';
import { firstMark } from '@/components/tournaments/draw/FirstMatchMarks';
import { loadSeen, loadSoundWanted, loadTeam, saveSeen, saveSoundWanted, saveTeam } from '@/lib/tournaments/myMatchStorage';
import type { getOfficialTournament } from '@/lib/tournaments/officialInfo';

type OfficialEvent = NonNullable<ReturnType<typeof getOfficialTournament>>;

const AMBER = '#B45309';
const AMBER_SOFT = '#FFF7E6';
const GREEN = '#15803D';
const RED = '#B91C1C';

const card: React.CSSProperties = {
  background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 14, padding: '16px 16px',
  boxSizing: 'border-box',
};
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '0 14px',
  borderRadius: 10, border: `1px solid ${TT.line}`, background: TT.surface, color: TT.inkSoft,
  fontSize: 14, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  boxSizing: 'border-box',
};
const label: React.CSSProperties = {
  margin: 0, fontFamily: FONT_LABEL, fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: TT.teal,
};

const names = (t: { player1Name: string; player2Name: string }) => `${t.player1Name} · ${t.player2Name}`;
const clock = (ms: number) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** 기존 DRAW 화면에서 MY MATCH 로 들어가는 링크. */
export function MyMatchEntryLink({ slug }: { slug: string }) {
  return (
    <Link href={`/tournaments/${slug}/draw/my`} data-mm-entry style={{
      display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '10px 14px', marginBottom: 12,
      borderRadius: 12, background: TT.navy, color: '#fff', textDecoration: 'none', boxSizing: 'border-box',
      WebkitTapHighlightColor: 'transparent',
    }}>
      <BellRing size={20} color={TT.tealOnNavy} strokeWidth={2.4} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: FONT_LABEL, fontSize: 14, fontWeight: 800, letterSpacing: '0.08em' }}>MY MATCH</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#C9D6DF', wordBreak: 'keep-all' }}>내 팀 경기 · 코트 배정 안내 보기</span>
      </span>
      <ChevronRight size={18} strokeWidth={2.4} style={{ flexShrink: 0 }} />
    </Link>
  );
}

// ── 알림음 — 사용자가 버튼을 눌러 켠 뒤에만, 브라우저가 허용하는 범위에서 ──────────────
//   iOS 는 사용자 동작(탭) 안에서 소리를 한 번 내야 이후 소리를 허용한다. 무음 모드에서는 들리지 않을 수 있다.
type AudioCtor = typeof AudioContext;
function useChime() {
  const ctx = React.useRef<AudioContext | null>(null);
  const [wanted, setWanted] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => { setWanted(loadSoundWanted()); }, []);

  const tone = React.useCallback((c: AudioContext, at: number, freq: number, dur: number) => {
    const o = c.createOscillator(); const g = c.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + dur + 0.02);
  }, []);

  const play = React.useCallback(() => {
    const c = ctx.current;
    if (c && c.state === 'running') {
      const t = c.currentTime + 0.02;
      tone(c, t, 880, 0.28); tone(c, t + 0.32, 1175, 0.4);
    }
    try { navigator.vibrate?.([220, 120, 220]); } catch { /* iOS 미지원 */ }
  }, [tone]);

  /** 버튼 탭 안에서 호출해야 한다. */
  const enable = React.useCallback(() => {
    try {
      const W = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
      const Ctor = W.AudioContext ?? W.webkitAudioContext;
      if (!Ctor) { setWanted(true); saveSoundWanted(true); return; }
      if (!ctx.current) ctx.current = new Ctor();
      void ctx.current.resume().then(() => { setReady(ctx.current?.state === 'running'); play(); });
    } catch { /* 소리를 못 내도 화면 알림은 그대로 */ }
    setWanted(true); saveSoundWanted(true);
  }, [play]);

  const disable = React.useCallback(() => { setWanted(false); saveSoundWanted(false); }, []);

  return { wanted, ready, enable, disable, play: () => { if (wanted) play(); } };
}

// ── 화면 ────────────────────────────────────────────────────────────────────

export default function MyMatchApp({ event }: { event: OfficialEvent }) {
  const slug = event.slug;
  const [saved, setSaved] = React.useState<SavedTeam | null>(null);
  const [hydrated, setHydrated] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [alerts, setAlerts] = React.useState<MyEvent[]>([]);
  const [now, setNow] = React.useState(() => Date.now());
  const chime = useChime();

  React.useEffect(() => {
    const t = loadTeam(slug);
    setSaved(t); setPicking(!t); setHydrated(true);
  }, [slug]);
  React.useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(id); }, []);

  const [fast, setFast] = React.useState(true);
  const feed = useMyMatchFeed(slug, fast);
  const teamNo = saved?.teamNo ?? null;
  const view = React.useMemo(() => buildView(feed.draw, feed.bracket, teamNo, feed.schedule), [feed.draw, feed.bracket, teamNo, feed.schedule]);
  const teams = React.useMemo(() => listTeams(feed.draw, feed.bracket), [feed.draw, feed.bracket]);
  const check = saved ? checkSaved(saved, teams, feed.draw !== null) : 'unknown';

  React.useEffect(() => { setFast(saved ? hasPending(view) : false); }, [saved, view]);

  // 상태 변화 → 알림. 직전 스냅샷은 메모리에만(새로고침 · 재접속 = 첫 조회 = 알림 없음).
  const prev = React.useRef<{ teamNo: number; snap: MySnapshot } | null>(null);
  const seen = React.useRef<Set<string>>(new Set());
  const lastRev = React.useRef(-1);
  React.useEffect(() => {
    if (!saved || !feed.loaded || feed.rev === lastRev.current) return;
    lastRev.current = feed.rev;
    if (!prev.current || prev.current.teamNo !== saved.teamNo) {
      seen.current = loadSeen(slug, saved.teamNo);
      prev.current = { teamNo: saved.teamNo, snap: snapshotOf(view) };
      return;
    }
    // 코트에서 내려온 경기 · 호출이 풀린 경기는 지문을 지운다 — 다시 배정되면 다시 알린다.
    let dirty = false;
    for (const m of view.matches) {
      for (const s of [...seen.current]) {
        const stale = (m.status !== 'playing' && (s.startsWith(`${m.key}:assign`) || s.startsWith(`${m.key}:court_change`)))
          || (m.status === 'waiting' && s === `${m.key}:calling`);
        if (stale) { seen.current.delete(s); dirty = true; }
      }
    }
    const fresh = freshEvents(diffEvents(prev.current.snap, view), seen.current);
    prev.current = { teamNo: saved.teamNo, snap: snapshotOf(view) };
    if (fresh.length) {
      fresh.forEach((e) => seen.current.add(e.sig));
      dirty = true;
      setAlerts((a) => [...fresh, ...a.filter((x) => !fresh.some((f) => f.key === x.key))]);
      if (fresh.some((e) => isCourtEvent(e) || e.kind === 'calling' || e.kind === 'ko_next')) chime.play();
    }
    if (dirty) saveSeen(slug, saved.teamNo, seen.current);
  }, [feed.rev, feed.loaded, saved, slug, view, chime]);

  // 탭 제목 — 코트 알림이 떠 있는 동안 표시(다른 탭에서 돌아왔을 때 눈에 띄게).
  const top = alerts[0] ?? null;
  React.useEffect(() => {
    if (!top || !isCourtEvent(top)) return;
    const before = document.title;
    document.title = `● ${courtText(top.match)} — MY MATCH`;
    return () => { document.title = before; };
  }, [top]);

  const choose = (t: MyTeam) => {
    const s: SavedTeam = { teamNo: t.teamNo, player1Name: t.player1Name, player2Name: t.player2Name };
    saveTeam(slug, s);
    prev.current = null; lastRev.current = -1; setAlerts([]);
    setSaved(s); setPicking(false);
    feed.refresh();
  };

  const published = feed.draw !== null || feed.bracket !== null;
  const stale = feed.lastOkAt !== null && now - feed.lastOkAt > MY_STALE_MS;

  return (
    <PublicDrawShell event={event} published={feed.draw !== null}>
      <DrawHeading title="MY MATCH" sub="내 팀의 경기 상태와 코트 배정을 한눈에 확인합니다." />
      {top && <AlertOverlay event={top} more={alerts.length - 1} onOk={() => setAlerts((a) => a.slice(1))} />}

      <LimitNotice />

      {!hydrated || (!feed.loaded && !feed.failing) ? (
        <StateCard title="불러오는 중…" />
      ) : !feed.loaded && feed.failing ? (
        <StateCard name="load-failed" tone="warn" title="대진표를 불러오지 못했습니다."
          desc="네트워크 상태를 확인해 주세요. 자동으로 다시 시도합니다."
          action={<button type="button" style={btn} onClick={feed.refresh}><RefreshCw size={15} />다시 시도</button>} />
      ) : !published ? (
        <>
          {saved && <TeamBar saved={saved} team={null} onChange={() => setPicking(true)} />}
          <StateCard name="unpublished" title="대진표가 아직 공개되지 않았습니다."
            desc="조편성이 공개되면 이곳에서 내 팀을 고르고 경기 상태를 확인할 수 있습니다. 이 화면을 열어 두면 공개 후 자동으로 표시됩니다." />
        </>
      ) : picking || !saved ? (
        <TeamPicker teams={teams} current={saved} onPick={choose} onCancel={saved ? () => setPicking(false) : undefined} />
      ) : (
        <>
          <TeamBar saved={saved} team={view.team} onChange={() => setPicking(true)} />
          {check === 'changed' && (
            <StateCard name="team-changed" tone="warn" title="선택한 팀의 정보가 바뀌었습니다."
              desc="선택한 팀의 선수 이름이 저장할 때와 다릅니다. 내 팀을 다시 선택해 주세요."
              action={<button type="button" style={btn} onClick={() => setPicking(true)}>다시 선택</button>} />
          )}
          {check === 'missing' && (
            <StateCard name="team-missing" tone="warn" title="선택한 팀을 대진표에서 찾을 수 없습니다."
              desc="팀 구성이 바뀌었거나 대진이 다시 공개됐을 수 있습니다. 내 팀을 다시 선택해 주세요."
              action={<button type="button" style={btn} onClick={() => setPicking(true)}>다시 선택</button>} />
          )}
          {check !== 'changed' && check !== 'missing' && <MatchBody view={view} slug={slug} />}
        </>
      )}

      {hydrated && feed.loaded && (
        <StatusLine lastOkAt={feed.lastOkAt} failing={feed.failing} stale={stale} fast={fast} onRefresh={feed.refresh} />
      )}
      {hydrated && saved && published && !picking && <SoundToggle chime={chime} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 16 }}>
        <Link href={`/tournaments/${slug}/draw`} style={{ ...btn, textDecoration: 'none' }}>예선 대진표</Link>
        <Link href={`/tournaments/${slug}/draw/knockout`} style={{ ...btn, textDecoration: 'none' }}>본선 대진표</Link>
      </div>
      <BackToHub hubHref={`/tournaments/${slug}`} />
    </PublicDrawShell>
  );
}

function LimitNotice() {
  return (
    <div data-mm-limit role="note" style={{
      ...card, padding: '12px 14px', marginBottom: 12, background: TT.tint, borderColor: '#D5E4E8',
      display: 'flex', flexDirection: 'column', gap: 5,
    }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: TT.ink, wordBreak: 'keep-all', lineHeight: 1.55 }}>
        본부 현장 호명을 꼭 함께 들어 주세요.
      </p>
      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: TT.inkSoft, wordBreak: 'keep-all', lineHeight: 1.6 }}>
        이 화면은 휴대폰 화면이 켜져 있고 이 페이지가 열려 있을 때만 새 소식을 확인합니다. 화면 잠금 · 다른 앱 사용 · 브라우저 종료 중에는 알림이 오지 않습니다.
        출전 신고는 대회 운영본부에서 합니다.
      </p>
    </div>
  );
}

function StateCard({ title, desc, action, tone, name }: { title: string; desc?: string; action?: React.ReactNode; tone?: 'warn'; name?: string }) {
  return (
    <div data-mm-state={name ?? 'info'} style={{
      ...card, marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center',
      padding: '22px 16px', background: tone === 'warn' ? AMBER_SOFT : TT.surface, borderColor: tone === 'warn' ? '#F5D9A8' : TT.line,
    }}>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: tone === 'warn' ? AMBER : TT.ink, lineHeight: 1.5, wordBreak: 'keep-all' }}>{title}</p>
      {desc && <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: TT.muted, lineHeight: 1.65, wordBreak: 'keep-all' }}>{desc}</p>}
      {action}
    </div>
  );
}

function TeamBar({ saved, team, onChange }: { saved: SavedTeam; team: MyTeam | null; onChange: () => void }) {
  const t = team ?? saved;
  return (
    <div data-mm-team={saved.teamNo} style={{ ...card, padding: '12px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{
        flexShrink: 0, minWidth: 44, height: 44, padding: '0 6px', borderRadius: 10, background: TT.navy, color: '#fff',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT_LABEL, fontSize: 18, fontWeight: 800, boxSizing: 'border-box',
      }}><Users size={20} strokeWidth={2.4} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: TT.muted }}>
          내 팀{team && teamGroupLabel(team) ? ` · ${teamGroupLabel(team)}` : ''}{team?.withdrawn ? ' · 기권' : ''}
        </span>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: TT.ink, lineHeight: 1.4, wordBreak: 'keep-all' }}>{names(t)}</span>
      </span>
      <button type="button" data-mm-action="change-team" onClick={onChange} style={{ ...btn, flexShrink: 0, padding: '0 12px', fontSize: 13 }}>팀 변경</button>
    </div>
  );
}

function TeamPicker({ teams, current, onPick, onCancel }: {
  teams: MyTeam[]; current: SavedTeam | null; onPick: (t: MyTeam) => void; onCancel?: () => void;
}) {
  const [q, setQ] = React.useState('');
  const [sel, setSel] = React.useState<number | null>(null);
  const list = searchTeams(teams, q);
  return (
    <section data-mm-picker style={{ ...card, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Users size={20} color={TT.teal} style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: TT.ink }}>내 팀 선택</p>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 600, color: TT.muted, lineHeight: 1.6, wordBreak: 'keep-all' }}>
            선수 이름으로 찾아 주세요. 같은 이름이 있으면 파트너 이름과 조로 구분합니다. 선택은 이 휴대폰 브라우저에만 저장됩니다.
          </p>
        </div>
        {onCancel && (
          <button type="button" aria-label="닫기" data-mm-action="picker-cancel" onClick={onCancel} style={{ ...btn, width: 44, padding: 0, flexShrink: 0 }}>
            <X size={18} />
          </button>
        )}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 48, padding: '0 12px', border: `1px solid ${TT.line}`, borderRadius: 10, background: '#fff' }}>
        <Search size={17} color={TT.muted} style={{ flexShrink: 0 }} />
        <input id="mm-search" value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} inputMode="search" enterKeyHint="search"
          placeholder="선수 이름" autoComplete="off"
          style={{ flex: 1, minWidth: 0, height: 46, border: 0, outline: 'none', fontSize: 16, fontFamily: 'inherit', color: TT.ink, background: 'transparent' }} />
      </label>
      <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {list.length === 0 && <p style={{ margin: 0, padding: '14px 4px', fontSize: 13, fontWeight: 600, color: TT.muted, textAlign: 'center' }}>찾는 팀이 없습니다.</p>}
        {list.map((t) => {
          const open = sel === t.teamNo;
          const mine = current?.teamNo === t.teamNo;
          return (
            <div key={t.teamNo} role="listitem" style={{ border: `1px solid ${open ? TT.teal : TT.line}`, borderRadius: 10, overflow: 'hidden', background: open ? TT.tealSoft : '#fff' }}>
              <button type="button" data-mm-team-option={t.teamNo} onClick={() => setSel(open ? null : t.teamNo)} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 52, padding: '8px 12px', border: 0,
                background: 'transparent', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 800, color: TT.ink, lineHeight: 1.45, wordBreak: 'keep-all' }}>{names(t)}</span>
                <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: t.withdrawn ? RED : TT.muted }}>
                  {t.withdrawn ? '기권' : teamGroupLabel(t)}{mine ? ' · 현재' : ''}
                </span>
              </button>
              {open && (
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: TT.inkSoft, wordBreak: 'keep-all' }}>
                    {teamGroupLabel(t) ? `${teamGroupLabel(t)} · ` : ''}{names(t)} 팀이 맞습니까?
                  </p>
                  <button type="button" data-mm-action="pick-confirm" onClick={() => onPick(t)}
                    style={{ ...btn, width: '100%', background: TT.teal, borderColor: TT.teal, color: '#fff' }}>내 팀으로 선택</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MatchBody({ view, slug }: { view: MyMatchView; slug: string }) {
  const { current, next, results, pendingSlot, team, schedule } = view;
  const nothing = !current && !next && !pendingSlot;
  // 조별 일정(예정 코트 · 신고)은 예선 · 순위결정전 경기에만 붙인다(본선은 본부 수동 배정).
  const schedOf = (m: MyMatch) => (m.stage === 'P' || m.stage === 'L' ? schedule : null);
  // 첫 경기 노란 안내 — 이 경기가 내 조의 실제 첫 경기이고 아직 시작 전일 때만.
  const firstOfMatch = (m: MyMatch) => (view.first && view.first.matchNo === m.matchNo && m.stage !== 'K' && isFirstUpcoming(view.first) ? view.first : null);
  return (
    <>
      {current && <CurrentCard m={current} schedule={schedOf(current)} firstInfo={firstOfMatch(current)} />}
      {!current && next && <NextCard m={next} first schedule={schedOf(next)} firstInfo={firstOfMatch(next)} />}
      {current && next && <NextCard m={next} />}
      {pendingSlot && (
        <div data-mm-pending style={{ ...card, marginBottom: 12, borderColor: '#C8DDE6' }}>
          <p style={label}>NEXT ROUND</p>
          <p style={{ margin: '8px 0 0', fontSize: 17, fontWeight: 900, color: TT.ink }}>{pendingSlot.roundName} 진출</p>
          <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 600, color: TT.muted, lineHeight: 1.6, wordBreak: 'keep-all' }}>
            상대: {pendingSlot.opponentLabel}. 상대가 정해지면 경기가 표시됩니다.
          </p>
        </div>
      )}
      {nothing && (
        <StateCard name="no-upcoming"
          title={results.length ? '예정된 다음 경기가 없습니다.' : '표시할 경기가 아직 없습니다.'}
          desc={results.length
            ? (view.knockoutLoaded ? '모든 경기가 끝났습니다. 수고하셨습니다.' : '본선 대진이 공개되면 진출 여부와 다음 경기가 이곳에 표시됩니다.')
            : '경기가 만들어지면 이곳에 표시됩니다.'} />
      )}
      {results.length > 0 && (
        <section data-mm-results style={{ marginTop: 4 }}>
          <p style={{ margin: '4px 2px 8px', fontSize: 14, fontWeight: 900, color: TT.ink }}>지난 경기</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.map((m) => <ResultRow key={m.key} m={m} />)}
          </div>
        </section>
      )}
      {team?.groupNo && (
        <Link href={team.placement ? `/tournaments/${slug}/draw/placement` : `/tournaments/${slug}/draw/groups/${team.groupNo}`} data-mm-group-link style={{
          ...btn, width: '100%', marginTop: 12, textDecoration: 'none', justifyContent: 'space-between',
        }}>
          {team.placement ? '순위결정전 경기 보기' : `${team.groupNo}조 순위 · 전체 경기 보기`}<ChevronRight size={16} />
        </Link>
      )}
    </>
  );
}

function Opp({ m }: { m: MyMatch }) {
  return (
    <p style={{ margin: '8px 0 0', fontSize: 14.5, fontWeight: 700, color: TT.inkSoft, lineHeight: 1.5, wordBreak: 'keep-all' }}>
      상대 {m.opponent ? <b style={{ color: TT.ink }}>{names(m.opponent)}</b> : '결정 대기'}
    </p>
  );
}

/** 운영진이 지정한 조별 안내(예정 코트 · 순서 · 신고) — 안내 전용. 실제 코트 알림과 섞지 않는다. */
function ScheduleBlock({ s }: { s: MyMatchSchedule | null }) {
  if (!s) return null;
  const line = [s.sessionLabel, s.checkinDeadline ? `신고 ${s.checkinDeadline}까지` : null, s.checkinPlace].filter(Boolean).join(' · ');
  const start = [s.startTime ? `${s.startTime} 경기 시작` : null, s.startNote].filter(Boolean).join(' · ');
  return (
    <div data-mm-schedule style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: '#F1F5F9', display: 'flex', flexDirection: 'column', gap: 5 }}>
      {s.plannedCourtText && (
        <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 13, fontWeight: 800, color: TT.inkSoft }}>
          <span data-mm-planned style={{ padding: '1px 8px', borderRadius: 999, border: '1px dashed #94A3B8', background: '#fff', fontSize: 12, color: '#5B6B82' }}>
            예정 {s.plannedCourtText}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: TT.muted }}>변경될 수 있습니다</span>
        </p>
      )}
      {line && <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: TT.inkSoft, lineHeight: 1.55, wordBreak: 'keep-all' }}>{line}</p>}
      {start && <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: TT.muted, lineHeight: 1.55, wordBreak: 'keep-all' }}>{start}</p>}
    </div>
  );
}

/** 첫 경기 노란 안내 — '⚑ 첫 경기 출전' + '첫 경기 · 09:00 · 예정 2번 코트 · 신고 08:40까지'. */
function FirstNotice({ f }: { f: FirstMatchInfo | null }) {
  const mark = firstMark(f);
  if (!mark || !f) return null;
  const detail = [firstHeadline(f), firstDetail(f)].filter(Boolean).join(' · ');
  return (
    <div data-mm-first={f.sessionNo ?? 'none'} style={{
      marginTop: 10, padding: '8px 10px', borderRadius: 10, background: mark.bg, border: `1px solid ${mark.bd}`, color: mark.fg,
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 13, fontWeight: 800, lineHeight: 1.5, wordBreak: 'keep-all',
    }}>
      <HighlightBadge mark={mark} size={11.5} />
      <span style={{ minWidth: 0 }}>{detail}</span>
    </div>
  );
}

function CurrentCard({ m, schedule, firstInfo = null }: { m: MyMatch; schedule?: MyMatchSchedule | null; firstInfo?: FirstMatchInfo | null }) {
  const playing = m.status === 'playing';
  const court = courtText(m);
  return (
    <section data-mm-current={m.key} data-mm-status={m.status} style={{
      ...card, marginBottom: 12, padding: 0, overflow: 'hidden', borderColor: playing ? TT.teal : '#F5D9A8',
    }}>
      <div style={{ padding: '14px 16px', background: playing ? TT.navy : AMBER_SOFT, color: playing ? '#fff' : AMBER }}>
        <p style={{ ...label, color: playing ? TT.tealOnNavy : AMBER }}>{playing ? 'NOW PLAYING' : 'GET READY'}</p>
        {playing ? (
          <p data-mm-court-now style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 900, lineHeight: 1.35, wordBreak: 'keep-all' }}>
            {court ? <>현재 <span style={{ color: TT.tealOnNavy }}>{court}</span>에서 진행 중</> : '진행 중'}
          </p>
        ) : (
          <p style={{ margin: '6px 0 0', fontSize: 18, fontWeight: 900, lineHeight: 1.4, wordBreak: 'keep-all' }}>
            경기 준비 중 · 본부 안내를 들어 주세요
          </p>
        )}
      </div>
      <div style={{ padding: '12px 16px 14px' }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: TT.muted }}>{m.title}</p>
        <Opp m={m} />
        {!playing && (
          <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 600, color: TT.muted, lineHeight: 1.6, wordBreak: 'keep-all' }}>
            코트 번호는 본부가 경기를 코트에 투입하면 표시됩니다.
          </p>
        )}
        {!playing && <FirstNotice f={firstInfo} />}
        {/* 순위결정전은 공개 응답에 실제 코트가 없다 — 진행 중이어도 코트가 없으면 예정 코트 안내를 남긴다. */}
        {(!playing || !court) && <ScheduleBlock s={schedule ?? null} />}
      </div>
    </section>
  );
}

function NextCard({ m, first, schedule, firstInfo = null }: { m: MyMatch; first?: boolean; schedule?: MyMatchSchedule | null; firstInfo?: FirstMatchInfo | null }) {
  return (
    <section data-mm-next={m.key} style={{ ...card, marginBottom: 12 }}>
      <p style={label}>{first ? 'NEXT MATCH' : 'AFTER THIS'}</p>
      <p style={{ margin: '8px 0 0', fontSize: first ? 18 : 15, fontWeight: 900, color: TT.ink }}>{m.title}</p>
      <Opp m={m} />
      {first && (
        <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 600, color: TT.muted, lineHeight: 1.6, wordBreak: 'keep-all' }}>
          대기 중입니다. 실제 코트 번호는 본부가 경기를 코트에 투입하면 이 화면에 크게 표시됩니다.
        </p>
      )}
      {first && <FirstNotice f={firstInfo} />}
      {first && <ScheduleBlock s={schedule ?? null} />}
    </section>
  );
}

function ResultRow({ m }: { m: MyMatch }) {
  const win = m.result === 'win';
  return (
    <div data-mm-result={m.key} style={{ ...card, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{
        flexShrink: 0, width: 44, height: 28, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12.5, fontWeight: 900, background: win ? '#E7F6EC' : '#F1F5F9', color: win ? GREEN : TT.muted,
      }}>{m.result === null ? '완료' : win ? '승' : '패'}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: TT.muted }}>{m.title}</span>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: TT.inkSoft, lineHeight: 1.45, wordBreak: 'keep-all' }}>
          vs {m.opponent ? names(m.opponent) : '—'}
        </span>
        {m.stage === 'K' && win && m.nextRoundName && (
          <span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: TT.teal }}>→ {m.nextRoundName} 진출</span>
        )}
      </span>
      <span style={{ flexShrink: 0, fontFamily: FONT_LABEL, fontSize: 22, fontWeight: 800, color: win ? TT.ink : TT.muted }}>
        {m.myScore ?? '–'}:{m.oppScore ?? '–'}
      </span>
    </div>
  );
}

function AlertOverlay({ event, more, onOk }: { event: MyEvent; more: number; onOk: () => void }) {
  const m = event.match;
  const court = courtText(m);
  const big = isCourtEvent(event);
  const tone = big ? { bg: TT.navy, fg: '#fff', accent: TT.tealOnNavy }
    : event.kind === 'calling' ? { bg: AMBER_SOFT, fg: AMBER, accent: AMBER }
    : { bg: '#fff', fg: TT.ink, accent: TT.teal };
  const head = event.kind === 'assign' ? '코트로 이동하세요'
    : event.kind === 'court_change' ? '코트가 변경되었습니다'
    : event.kind === 'calling' ? '경기 준비 중'
    : event.kind === 'ko_next' ? '다음 경기가 확정되었습니다'
    : '경기가 끝났습니다';
  return (
    <div role="alertdialog" aria-modal="true" aria-live="assertive" aria-label={head} data-mm-alert={event.kind} data-mm-alert-key={event.key}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.55)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '12px 12px 0', boxSizing: 'border-box' }}>
      <div style={{
        width: '100%', maxWidth: 426, background: tone.bg, color: tone.fg, borderRadius: 18, padding: '18px 18px 16px',
        boxShadow: '0 18px 40px rgba(15,23,42,0.35)', boxSizing: 'border-box', maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto',
      }}>
        <p style={{ ...label, color: tone.accent, display: 'flex', alignItems: 'center', gap: 6 }}>
          {big ? <MapPin size={14} /> : <BellRing size={14} />} MY MATCH 알림
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 19, fontWeight: 900, lineHeight: 1.35, wordBreak: 'keep-all' }}>{head}</p>
        {big && (
          <div style={{ margin: '12px 0 4px', textAlign: 'center' }}>
            {event.kind === 'court_change' && event.fromCourt !== null && (
              <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700, color: '#C9D6DF' }}>{event.fromCourt}번 코트 → </p>
            )}
            <p data-mm-alert-court style={{ margin: 0, fontFamily: FONT_LABEL, fontSize: 64, fontWeight: 800, lineHeight: 1, color: tone.accent }}>
              {m.courtNo ?? '–'}
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 18, fontWeight: 900 }}>{court}</p>
          </div>
        )}
        <p style={{ margin: '10px 0 0', fontSize: 13.5, fontWeight: 700, lineHeight: 1.55, opacity: 0.92, wordBreak: 'keep-all' }}>
          {m.title}{m.opponent ? ` · 상대 ${names(m.opponent)}` : ''}
        </p>
        {event.kind === 'calling' && (
          <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 600, lineHeight: 1.6, wordBreak: 'keep-all' }}>
            본부 안내를 들어 주세요. 코트에 투입되면 코트 번호를 알려 드립니다.
          </p>
        )}
        {event.kind === 'completed' && (
          <p style={{ margin: '8px 0 0', fontSize: 15, fontWeight: 900 }}>
            {m.result === 'win' ? '승리' : m.result === 'loss' ? '패배' : '결과'} {m.myScore ?? '–'} : {m.oppScore ?? '–'}
            {m.stage === 'K' && m.result === 'win' && m.nextRoundName ? ` · ${m.nextRoundName} 진출` : ''}
          </p>
        )}
        <button type="button" data-mm-action="alert-ok" onClick={onOk} autoFocus style={{
          ...btn, width: '100%', minHeight: 52, marginTop: 14, fontSize: 16,
          background: big ? TT.tealOnNavy : TT.teal, borderColor: 'transparent', color: big ? TT.navy : '#fff',
        }}>
          확인{more > 0 ? ` (알림 ${more}건 더)` : ''}
        </button>
      </div>
    </div>
  );
}

function StatusLine({ lastOkAt, failing, stale, fast, onRefresh }: {
  lastOkAt: number | null; failing: boolean; stale: boolean; fast: boolean; onRefresh: () => void;
}) {
  const warn = failing || stale;
  return (
    <div data-mm-status-line data-mm-stale={stale ? '1' : '0'} data-mm-failing={failing ? '1' : '0'} style={{
      marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
      background: warn ? AMBER_SOFT : '#EEF2F6', boxSizing: 'border-box',
    }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: warn ? AMBER : TT.muted, lineHeight: 1.55, wordBreak: 'keep-all' }}>
        {warn
          ? `연결 확인 중 · 최신 정보가 아닐 수 있습니다${lastOkAt ? ` (마지막 확인 ${clock(lastOkAt)})` : ''}`
          : `마지막 확인 ${lastOkAt ? clock(lastOkAt) : '—'} · ${fast ? `${MY_FAST_MS / 1000}초` : '45초'}마다 자동 확인`}
      </span>
      <button type="button" data-mm-action="refresh" onClick={onRefresh} aria-label="지금 다시 확인" style={{ ...btn, width: 44, padding: 0, flexShrink: 0 }}>
        <RefreshCw size={16} />
      </button>
    </div>
  );
}

function SoundToggle({ chime }: { chime: ReturnType<typeof useChime> }) {
  const on = chime.wanted && chime.ready;
  return (
    <div data-mm-sound={on ? 'on' : chime.wanted ? 'pending' : 'off'} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button type="button" data-mm-action={on ? 'sound-off' : 'sound-on'} onClick={on ? chime.disable : chime.enable}
        style={{ ...btn, width: '100%', ...(on ? { borderColor: TT.teal, color: TT.tealDeep } : {}) }}>
        {on ? <><Volume2 size={16} />알림음 켜짐 · 끄기</> : <><VolumeX size={16} />{chime.wanted ? '알림음 다시 켜기' : '알림음 켜기'}</>}
      </button>
      <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: TT.muted, lineHeight: 1.55, wordBreak: 'keep-all' }}>
        {chime.wanted && !chime.ready
          ? '브라우저 정책상 페이지를 새로 열면 버튼을 한 번 더 눌러야 소리가 납니다.'
          : '휴대폰이 무음 모드이거나 브라우저가 막으면 소리가 나지 않을 수 있습니다. 화면 알림은 그대로 표시됩니다.'}
      </p>
    </div>
  );
}

type MyMatchView = ReturnType<typeof buildView>;
