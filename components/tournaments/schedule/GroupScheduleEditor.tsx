'use client';

// Admin — 예선 조별 일정(출전 신고 · 예정 코트) 설정.
//
//   · 공통: 출전 신고 장소, 첫 번째 조 / 두 번째 조의 신고 마감 · 시작 시각 · 시작 안내
//   · 조별: 경기이사가 조마다 '첫 번째 조 / 두 번째 조' 와 '예정 코트' 를 직접 고른다(자동 추정 없음)
//   ⚠ 저장은 조편성 잠금 · 버전 · DRAW 공개 상태를 바꾸지 않는다. 공개 중이면 참가자 화면에 45초 안에 반영된다.
//   ⚠ 예정 코트는 안내용이다. 실제 코트는 Control Center 에서 경기를 투입할 때 정해진다(투입 동작은 그대로).

import React from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Save } from 'lucide-react';
import {
  fetchAdminGroupSchedule, saveGroupSchedule, saveScheduleSettings, scheduleActionMessage, SESSION_LABEL, WARNING_TEXT,
  type AdminGroupSchedule, type SessionNo, type SettingsInput,
} from '@/lib/tournaments/groupScheduleService';

const INK = '#0F172A'; const MUTED = '#64748B'; const LINE = '#E2E8F0'; const TEAL = '#0E8C80';
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, boxSizing: 'border-box' };
const input: React.CSSProperties = {
  width: '100%', minHeight: 44, padding: '0 10px', border: `1px solid #CBD5E1`, borderRadius: 9, fontSize: 15,
  fontFamily: 'inherit', color: INK, background: '#fff', boxSizing: 'border-box',
};
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '0 16px',
  borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', color: '#334155', fontSize: 14, fontWeight: 800,
  fontFamily: 'inherit', cursor: 'pointer',
};

/** 운영 확정값(2026 TEYEON OPEN) — 아직 저장한 적이 없을 때 입력칸에 미리 채워 두는 값. 저장해야 공개된다. */
const FORM_DEFAULTS: SettingsInput = {
  checkinPlace: '대회 운영본부',
  session1Deadline: '08:40', session1Start: '09:00', session1Note: '',
  session2Deadline: '09:20', session2Start: '', session2Note: '앞 조 경기 종료 후 시작',
};

export default function GroupScheduleEditor({ slug }: { slug: string }) {
  const [data, setData] = React.useState<AdminGroupSchedule | null>(null);
  const [state, setState] = React.useState<'loading' | 'ready' | 'denied' | 'missing' | 'error'>('loading');
  const [form, setForm] = React.useState<SettingsInput>(FORM_DEFAULTS);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState<string>('');
  const [toast, setToast] = React.useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  const say = (text: string, tone: 'ok' | 'err' = 'ok') => { setToast({ text, tone }); window.setTimeout(() => setToast(null), 3200); };

  const load = React.useCallback(async (keepForm = false) => {
    try {
      const r = await fetchAdminGroupSchedule(slug);
      if (r.missing) { setState('missing'); return; }
      if (!r.ready || !r.data) { setState('denied'); return; }
      setData(r.data); setState('ready');
      if (!keepForm) {
        const s = r.data.settings;
        setForm(s ? {
          checkinPlace: s.checkinPlace,
          session1Deadline: s.session1CheckinDeadline ?? '', session1Start: s.session1StartTime ?? '', session1Note: s.session1StartNote ?? '',
          session2Deadline: s.session2CheckinDeadline ?? '', session2Start: s.session2StartTime ?? '', session2Note: s.session2StartNote ?? '',
        } : FORM_DEFAULTS);
        setDirty(false);
      }
    } catch { setState('error'); }
  }, [slug]);
  React.useEffect(() => { void load(); }, [load]);
  // 저장하지 않은 공통 안내가 있으면 페이지를 떠날 때 브라우저가 한 번 묻는다.
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setF = (k: keyof SettingsInput, v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };

  const saveSettings = async () => {
    setBusy('settings');
    try { await saveScheduleSettings(slug, form); say('출전 신고 안내를 저장했습니다.'); await load(); }
    catch (e) { say(scheduleActionMessage(e), 'err'); }
    finally { setBusy(''); }
  };

  const saveGroup = async (groupNo: number, sessionNo: SessionNo | null, courtNo: number | null) => {
    setBusy(`g${groupNo}`);
    try { await saveGroupSchedule(slug, groupNo, sessionNo, courtNo); say(`${groupNo}조 일정을 저장했습니다.`); }
    catch (e) { say(scheduleActionMessage(e), 'err'); }
    finally { setBusy(''); await load(true); }
  };

  if (state === 'loading') return <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, color: MUTED }}><Loader2 size={16} className="animate-spin" />불러오는 중…</div>;
  if (state === 'missing') return <Notice tone="warn" text="조별 일정 기능이 아직 적용되지 않았습니다. (SQL 적용 대기 — add_hosted_tournament_group_schedule.sql)" />;
  if (state === 'denied') return <Notice tone="warn" text="이 대회를 찾을 수 없거나 권한이 없습니다. (CEO·ADMIN 전용)" />;
  if (state === 'error' || !data) return <Notice tone="warn" text="일정을 불러오지 못했습니다." action={<button type="button" style={btn} onClick={() => void load()}><RefreshCw size={15} />다시 시도</button>} />;

  const courtLabel = (no: number) => {
    const c = data.courts.find((x) => x.courtNo === no);
    return `${c?.displayName || `${no}번 코트`}${c && c.status !== 'active' ? ' (사용 중지)' : ''}`;
  };
  const byCourt = data.courts.map((c) => ({
    court: c,
    groups: data.groups.filter((g) => g.plannedCourtNo === c.courtNo).sort((a, b) => (a.sessionNo ?? 9) - (b.sessionNo ?? 9) || a.groupNo - b.groupNo),
  })).filter((x) => x.groups.length > 0);
  const assigned = data.groups.filter((g) => g.sessionNo !== null && g.plannedCourtNo !== null).length;
  const published = !!data.drawPublishedAt;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {toast && (
        <div role="status" data-sched-toast={toast.tone} style={{
          position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 50, padding: '11px 16px', borderRadius: 12,
          background: toast.tone === 'ok' ? '#0F172A' : '#B91C1C', color: '#fff', fontSize: 13.5, fontWeight: 700, maxWidth: 'calc(100% - 32px)',
        }}>{toast.text}</div>
      )}

      <div data-sched-status style={{ ...card, padding: '12px 14px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Pill on={data.drawStatus === 'locked'} text={data.drawStatus === 'locked' ? '조편성 잠금' : '조편성 작성 중'} />
        <Pill on={published} text={published ? 'DRAW 공개 중' : 'DRAW 비공개'} />
        <Pill on={assigned === data.groups.length && data.groups.length > 0} text={`조 일정 ${assigned} / ${data.groups.length}`} />
        <Pill on={!!data.settings} text={data.settings ? '신고 안내 저장됨' : '신고 안내 미저장'} />
        <p style={{ margin: 0, flexBasis: '100%', fontSize: 12.5, fontWeight: 600, color: MUTED, lineHeight: 1.6, wordBreak: 'keep-all' }}>
          여기서 저장해도 조편성 잠금과 DRAW 공개 상태는 바뀌지 않습니다. {published ? '지금 공개 중이므로 저장하면 참가자 화면에 45초 안에 반영됩니다.' : 'DRAW 를 공개하면 참가자 화면에 표시됩니다.'}
        </p>
      </div>

      {/* ── 공통 출전 신고 안내 ── */}
      <section data-sched-settings style={card}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: INK }}>출전 신고 안내(모든 조 공통)</h2>
        {!data.settings && (
          <p data-sched-unsaved style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 700, color: '#B45309', lineHeight: 1.6, wordBreak: 'keep-all' }}>
            아직 저장되지 않았습니다. 운영 확정값을 미리 채워 두었습니다 — 확인 후 [저장] 을 눌러야 참가자 화면에 나옵니다.
          </p>
        )}
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          <Field label="출전 신고 장소">
            <input data-sched-input="place" style={input} value={form.checkinPlace} maxLength={40} onChange={(e) => setF('checkinPlace', e.target.value)} />
          </Field>
          {([1, 2] as SessionNo[]).map((n) => {
            const d = n === 1 ? 'session1Deadline' : 'session2Deadline';
            const s = n === 1 ? 'session1Start' : 'session2Start';
            const t = n === 1 ? 'session1Note' : 'session2Note';
            return (
              <fieldset key={n} data-sched-session-form={n} style={{ margin: 0, padding: 12, border: `1px solid ${LINE}`, borderRadius: 12, display: 'grid', gap: 10, minWidth: 0 }}>
                <legend style={{ padding: '0 6px', fontSize: 13.5, fontWeight: 900, color: TEAL }}>{SESSION_LABEL[n]}</legend>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  <Field label="신고 마감">
                    <input data-sched-input={d} type="time" step={60} style={input} value={form[d]} onChange={(e) => setF(d, e.target.value)} />
                  </Field>
                  <Field label="경기 시작(비우면 표시 안 함)">
                    <input data-sched-input={s} type="time" step={60} style={input} value={form[s]} onChange={(e) => setF(s, e.target.value)} />
                  </Field>
                </div>
                <Field label="시작 안내(선택 · 60자)">
                  <input data-sched-input={t} style={input} value={form[t]} maxLength={60} placeholder={n === 2 ? '예: 앞 조 경기 종료 후 시작' : ''} onChange={(e) => setF(t, e.target.value)} />
                </Field>
              </fieldset>
            );
          })}
          {dirty && data.settings && (
            <p data-sched-dirty style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#B45309' }}>저장하지 않은 변경이 있습니다. [저장] 을 눌러야 참가자 화면에 반영됩니다.</p>
          )}
          <button type="button" data-sched-action="save-settings" disabled={busy === 'settings'} onClick={() => void saveSettings()}
            style={{ ...btn, background: TEAL, borderColor: TEAL, color: '#fff', opacity: busy === 'settings' ? 0.6 : 1 }}>
            {busy === 'settings' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {dirty || !data.settings ? '출전 신고 안내 저장' : '저장됨 · 다시 저장'}
          </button>
        </div>
      </section>

      {/* ── 조별 순서 · 예정 코트 ── */}
      <section data-sched-groups style={card}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: INK }}>조별 출전 순서 · 예정 코트</h2>
        <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 600, color: MUTED, lineHeight: 1.6, wordBreak: 'keep-all' }}>
          조마다 직접 고르면 바로 저장됩니다. 보통 한 코트에 첫 번째 조 1개와 두 번째 조 1개를 배정합니다. 시스템은 조 번호로 순서를 추정하지 않습니다.
        </p>

        {data.warnings.length > 0 && (
          <ul data-sched-warnings style={{ margin: '12px 0 0', padding: '10px 12px 10px 30px', borderRadius: 10, background: '#FFF7E6', border: '1px solid #F5D9A8', display: 'grid', gap: 4 }}>
            {data.warnings.map((w, i) => (
              <li key={i} data-sched-warning={w.kind} style={{ fontSize: 12.5, fontWeight: 700, color: '#92400E', lineHeight: 1.55 }}>{WARNING_TEXT(w)}</li>
            ))}
          </ul>
        )}

        {data.groups.length === 0 ? (
          <p style={{ margin: '12px 0 0', fontSize: 13, fontWeight: 700, color: MUTED }}>조가 아직 없습니다. 예선 조 편성에서 먼저 조를 만들어 주세요.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {data.groups.map((g) => {
              const rowBusy = busy === `g${g.groupNo}`;
              return (
                <div key={g.groupNo} data-sched-group={g.groupNo} style={{
                  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, padding: 12, borderRadius: 12,
                  border: `1px solid ${g.sessionNo && g.plannedCourtNo ? LINE : '#F5D9A8'}`, background: g.sessionNo && g.plannedCourtNo ? '#fff' : '#FFFBF2',
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 16, fontWeight: 900, color: INK }}>{g.groupNo}조</span>
                    {g.groupType === 'placement' && <span style={{ fontSize: 11.5, fontWeight: 800, color: '#7C3AED' }}>순위결정전</span>}
                    {rowBusy ? <Loader2 size={14} className="animate-spin" color={MUTED} />
                      : g.sessionNo && g.plannedCourtNo ? <CheckCircle2 size={14} color={TEAL} /> : null}
                    <span style={{ flexBasis: '100%', fontSize: 12.5, fontWeight: 600, color: MUTED, lineHeight: 1.55, wordBreak: 'keep-all' }}>
                      {g.teams.map((t) => `${t.teamNo}. ${t.player1Name} · ${t.player2Name}`).join('  /  ') || '팀 없음'}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                    <select aria-label={`${g.groupNo}조 출전 순서`} data-sched-select={`session-${g.groupNo}`} disabled={rowBusy} style={input}
                      value={g.sessionNo ?? ''} onChange={(e) => void saveGroup(g.groupNo, e.target.value ? (Number(e.target.value) as SessionNo) : null, g.plannedCourtNo)}>
                      <option value="">순서 미정</option>
                      <option value="1">{SESSION_LABEL[1]}</option>
                      <option value="2">{SESSION_LABEL[2]}</option>
                    </select>
                    <select aria-label={`${g.groupNo}조 예정 코트`} data-sched-select={`court-${g.groupNo}`} disabled={rowBusy || data.courts.length === 0} style={input}
                      value={g.plannedCourtNo ?? ''} onChange={(e) => void saveGroup(g.groupNo, g.sessionNo, e.target.value ? Number(e.target.value) : null)}>
                      <option value="">코트 미정</option>
                      {data.courts.map((c) => <option key={c.courtNo} value={c.courtNo}>{courtLabel(c.courtNo)}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {byCourt.length > 0 && (
        <section data-sched-courts style={card}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: INK }}>코트별 확인</h2>
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            {byCourt.map(({ court, groups }) => (
              <div key={court.courtNo} data-sched-court={court.courtNo} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13.5, lineHeight: 1.55 }}>
                <span style={{ flexShrink: 0, width: 92, fontWeight: 900, color: INK }}>{courtLabel(court.courtNo)}</span>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 700, color: '#334155', wordBreak: 'keep-all' }}>
                  {groups.map((g) => `${g.groupNo}조(${g.sessionNo ? SESSION_LABEL[g.sessionNo] : '순서 미정'})`).join(' → ')}
                  {groups.length > 2 && <AlertTriangle size={13} color="#B45309" style={{ marginLeft: 6, verticalAlign: '-2px' }} />}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: '#475569' }}>{label}</span>
      {children}
    </label>
  );
}

function Pill({ on, text }: { on: boolean; text: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', minHeight: 28, padding: '3px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 800,
      background: on ? '#E7F3F1' : '#F1F5F9', color: on ? '#0A6F65' : MUTED,
    }}>{text}</span>
  );
}

function Notice({ text, tone, action }: { text: string; tone: 'warn'; action?: React.ReactNode }) {
  return (
    <div data-sched-notice-admin={tone} style={{ ...card, background: '#FFF7E6', borderColor: '#F5D9A8', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: '#92400E', lineHeight: 1.6, wordBreak: 'keep-all' }}>{text}</p>
      {action}
    </div>
  );
}
