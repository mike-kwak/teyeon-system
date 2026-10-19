'use client';

// 공개 DRAW — 출전 신고 · 예정 코트 안내(조별 일정).
//
//   · 공통 안내: 신고 장소 · 첫 번째 조 / 두 번째 조 신고 마감 · 시작
//   · 조 카드 한 줄 · 조 상세 카드: 운영진이 그 조에 지정한 순서 · 예정 코트
//   ⚠ 예정 코트는 '예정' 글자 · 테두리 배지로만 표시한다. 실제 코트(경기 투입 후)는 경기 줄의 '진행 중 · N번 코트' 가 우선이다.
//   ⚠ 지정되지 않은 값은 표시하지 않는다(화면이 추정하지 않는다).

import React from 'react';
import { ClipboardCheck, MapPin } from 'lucide-react';
import { TT } from '@/components/tournaments/tournamentTheme';
import {
  fetchPublicGroupSchedule, hasCommonNotice, SESSION_LABEL,
  type GroupScheduleInfo, type PublicGroupSchedule,
} from '@/lib/tournaments/groupScheduleService';

const GRAY = '#5B6B82';

/** 45초 갱신 + 화면 복귀 시 즉시. 실패하면 보던 값을 유지한다. */
export const SCHEDULE_POLL_MS = 45_000;
export function usePublicGroupSchedule(slug: string, enabled = true): PublicGroupSchedule | null {
  const [schedule, setSchedule] = React.useState<PublicGroupSchedule | null>(null);
  const inFlight = React.useRef(false);
  const load = React.useCallback(async () => {
    if (!slug || !enabled || inFlight.current) return;
    inFlight.current = true;
    try { setSchedule(await fetchPublicGroupSchedule(slug)); } catch { /* 보던 값 유지 */ } finally { inFlight.current = false; }
  }, [slug, enabled]);
  React.useEffect(() => {
    void load();
    let timer: number | null = null;
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null; } };
    const start = () => { stop(); timer = window.setInterval(() => { void load(); }, SCHEDULE_POLL_MS); };
    const onVisible = () => { if (document.visibilityState === 'visible') { void load(); start(); } else stop(); };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);
  return schedule;
}

const sessionText = (s: { checkinDeadline: string | null; startTime: string | null; startNote: string | null }): string[] => {
  const out: string[] = [];
  if (s.checkinDeadline) out.push(`신고 ${s.checkinDeadline}까지`);
  if (s.startTime) out.push(`${s.startTime} 경기 시작`);
  if (s.startNote) out.push(s.startNote);
  return out;
};

/** /draw 상단 — 출전 신고 공통 안내. */
export function ScheduleNotice({ schedule }: { schedule: PublicGroupSchedule | null }) {
  if (!schedule || !hasCommonNotice(schedule)) return null;
  const sessions = schedule.sessions.filter((s) => s.checkinDeadline || s.startTime || s.startNote);
  return (
    <section data-sched-notice style={{
      background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 14, padding: '14px 14px 12px',
      display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 12, boxSizing: 'border-box',
    }}>
      <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 7, fontSize: 14.5, fontWeight: 900, color: TT.ink }}>
        <ClipboardCheck size={17} color={TT.teal} strokeWidth={2.4} style={{ flexShrink: 0 }} />
        출전 신고 안내
      </p>
      {schedule.checkinPlace && (
        <p data-sched-place style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: TT.inkSoft, lineHeight: 1.55, wordBreak: 'keep-all' }}>
          신고 장소 <b style={{ color: TT.ink }}>{schedule.checkinPlace}</b> · 모든 조 공통
        </p>
      )}
      {sessions.map((s) => (
        <div key={s.sessionNo} data-sched-session={s.sessionNo} style={{
          display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 10px', borderRadius: 10, background: TT.tint,
        }}>
          <span style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 900, color: TT.tealDeep, lineHeight: 1.6 }}>{SESSION_LABEL[s.sessionNo]}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: TT.inkSoft, lineHeight: 1.6, wordBreak: 'keep-all' }}>
            {sessionText(s).join(' · ')}
          </span>
        </div>
      ))}
      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: TT.muted, lineHeight: 1.6, wordBreak: 'keep-all' }}>
        조별 순서와 예정 코트는 각 조 카드에서 확인하세요. 실제 코트는 경기 시작 때 본부 안내와 경기별 표시를 따릅니다.
      </p>
    </section>
  );
}

/** '예정 3번 코트' 배지 — 테두리만(실제 코트의 채운 표시와 구분). */
export function PlannedCourtBadge({ text, dim }: { text: string; dim?: boolean }) {
  return (
    <span data-sched-planned style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
      border: `1px dashed ${dim ? '#CBD5E1' : '#94A3B8'}`, color: dim ? '#94A3B8' : GRAY,
      fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', background: '#fff',
    }}>
      <MapPin size={12} strokeWidth={2.4} />예정 {text}
    </span>
  );
}

/** 조 카드 한 줄 — '예정 3번 코트 · 첫 번째 조 · 신고 08:40까지'. */
export function GroupScheduleLine({ info, done }: { info: GroupScheduleInfo | null; done?: boolean }) {
  if (!info) return null;
  return (
    <span data-sched-line={info.groupNo} style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12, fontWeight: 700, color: GRAY, lineHeight: 1.5,
    }}>
      {info.plannedCourtText && <PlannedCourtBadge text={info.plannedCourtText} dim={done} />}
      {info.sessionLabel && <span style={{ whiteSpace: 'nowrap' }}>{info.sessionLabel}</span>}
      {info.checkinDeadline && <span style={{ whiteSpace: 'nowrap' }}>· 신고 {info.checkinDeadline}까지</span>}
    </span>
  );
}

/** 조 상세 — 경기 안내 카드. */
export function GroupScheduleCard({ info, done }: { info: GroupScheduleInfo | null; done?: boolean }) {
  if (!info) return null;
  const rows: Array<[string, React.ReactNode]> = [];
  if (info.plannedCourtText) rows.push(['코트', <PlannedCourtBadge key="c" text={info.plannedCourtText} dim={done} />]);
  if (info.sessionLabel) rows.push(['출전 순서', info.sessionLabel]);
  if (info.checkinDeadline) rows.push(['신고 마감', `${info.checkinDeadline}까지`]);
  if (info.checkinPlace) rows.push(['신고 장소', info.checkinPlace]);
  if (info.startTime || info.startNote) rows.push(['경기 시작', [info.startTime ? `${info.startTime} 기본` : null, info.startNote].filter(Boolean).join(' · ')]);
  return (
    <section data-sched-card={info.groupNo} style={{
      background: '#fff', border: `1px solid ${TT.line}`, borderRadius: 14, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: TT.ink }}>경기 안내</p>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ flexShrink: 0, width: 62, fontSize: 12, fontWeight: 700, color: TT.muted }}>{k}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 800, color: TT.ink, lineHeight: 1.55, wordBreak: 'keep-all' }}>{v}</span>
        </div>
      ))}
      <p style={{ margin: 0, paddingTop: 8, borderTop: `1px solid ${TT.lineSoft}`, fontSize: 12, fontWeight: 600, color: TT.muted, lineHeight: 1.6, wordBreak: 'keep-all' }}>
        예정 코트는 사정에 따라 바뀔 수 있습니다. 경기가 시작되면 아래 경기 줄의 &lsquo;진행 중 · N번 코트&rsquo; 가 실제 코트입니다.
      </p>
    </section>
  );
}
