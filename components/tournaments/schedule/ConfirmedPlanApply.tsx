'use client';

// Admin — 확정 운영안(조별 출전 순서 · 예정 코트) 일괄 적용.
//
//   · 확정안(lib/tournaments/confirmedSchedulePlan)을 미리보기로 보여 주고, 확인창에서 바뀌는 조 · 덮어쓰기 여부를 보여 준 뒤 적용한다.
//   · 저장은 기존 set_group_schedule 을 바뀌는 조마다 순서대로 호출한다(조 단위 upsert — 여러 번 눌러도 행이 늘지 않는다).
//   · 적용 직전에 DB 를 다시 읽어 검사하고, 적용 후 다시 읽어 18개 조를 하나하나 대조한다.
//   · 일부 실패 시 성공 · 실패를 조별로 표시한다. 다시 적용하면 아직 다른 조만 저장한다.
//   ⚠ 조편성 · 팀 자리 · 잠금 · 공개 · 경기는 바꾸지 않는다.

import React from 'react';
import { AlertTriangle, CheckCircle2, ListChecks, Loader2, XCircle } from 'lucide-react';
import {
  fetchAdminGroupSchedule, saveGroupSchedule, scheduleActionMessage, SESSION_LABEL, type AdminGroupSchedule,
} from '@/lib/tournaments/groupScheduleService';
import {
  diffPlan, planGroupLabel, precheckPlan, verifyPlan, type ConfirmedSchedulePlan, type PlanDiffRow, type PlanEntry,
} from '@/lib/tournaments/confirmedSchedulePlan';

const INK = '#0F172A'; const MUTED = '#64748B'; const LINE = '#E2E8F0'; const TEAL = '#0E8C80';
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, boxSizing: 'border-box' };
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '0 16px',
  borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', color: '#334155', fontSize: 14, fontWeight: 800,
  fontFamily: 'inherit', cursor: 'pointer',
};
const th: React.CSSProperties = { padding: '6px 8px', fontSize: 12, fontWeight: 800, color: MUTED, textAlign: 'left', borderBottom: `1px solid ${LINE}` };
const td: React.CSSProperties = { padding: '7px 8px', fontSize: 13.5, fontWeight: 700, color: INK, borderBottom: `1px solid #F1F5F9`, verticalAlign: 'top' };

const slotText = (s: 1 | 2 | null, c: number | null) =>
  s === null && c === null ? '미지정' : `${s ? SESSION_LABEL[s] : '순서 미정'} · ${c ? `${c}번 코트` : '코트 미정'}`;

interface RunResult {
  saved: PlanEntry[];
  failed: { entry: PlanEntry; message: string }[];
  mismatched: PlanEntry[] | null;   // null = 재조회 실패
  at: string;
}

export default function ConfirmedPlanApply({ slug, plan, data, onApplied }: {
  slug: string; plan: ConfirmedSchedulePlan; data: AdminGroupSchedule; onApplied: () => Promise<void> | void;
}) {
  const [confirm, setConfirm] = React.useState<{ rows: PlanDiffRow[]; errors: string[] } | null>(null);
  const [running, setRunning] = React.useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = React.useState<RunResult | null>(null);
  const [checking, setChecking] = React.useState(false);
  const lock = React.useRef(false);   // 중복 클릭 차단(상태 갱신 전 두 번째 클릭까지)

  const errors = precheckPlan(plan, data.groups, data.courts);
  const diff = diffPlan(plan, data.groups);
  const pending = diff.filter((r) => r.kind !== 'same');
  const byCourt = plan.courts.map((c) => ({
    court: c,
    s1: plan.entries.find((e) => e.courtNo === c && e.sessionNo === 1) ?? null,
    s2: plan.entries.find((e) => e.courtNo === c && e.sessionNo === 2) ?? null,
  }));
  const rowOf = (e: PlanEntry | null) => (e ? diff.find((r) => r.entry.groupNo === e.groupNo) ?? null : null);

  // 확인창 열기 — 화면 값이 아니라 DB 를 다시 읽어 검사 · 비교한다.
  const openConfirm = async () => {
    if (lock.current) return;
    lock.current = true; setChecking(true);
    try {
      const r = await fetchAdminGroupSchedule(slug);
      if (!r.ready || !r.data) { setConfirm({ rows: [], errors: ['일정을 다시 불러오지 못했습니다. 권한 또는 연결을 확인해 주세요.'] }); return; }
      setConfirm({ rows: diffPlan(plan, r.data.groups), errors: precheckPlan(plan, r.data.groups, r.data.courts) });
    } catch {
      setConfirm({ rows: [], errors: ['일정을 다시 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'] });
    } finally { setChecking(false); lock.current = false; }
  };

  const apply = async () => {
    if (lock.current || !confirm || confirm.errors.length > 0) return;
    lock.current = true;
    const targets = confirm.rows.filter((r) => r.kind !== 'same').map((r) => r.entry);
    setConfirm(null); setResult(null); setRunning({ done: 0, total: targets.length });
    const saved: PlanEntry[] = []; const failed: RunResult['failed'] = [];
    try {
      for (const e of targets) {
        try { await saveGroupSchedule(slug, e.groupNo, e.sessionNo, e.courtNo); saved.push(e); }
        catch (err) { failed.push({ entry: e, message: scheduleActionMessage(err) }); }
        setRunning({ done: saved.length + failed.length, total: targets.length });
      }
      let mismatched: PlanEntry[] | null = null;
      try {
        const r = await fetchAdminGroupSchedule(slug);
        if (r.ready && r.data) mismatched = verifyPlan(plan, r.data.groups);
      } catch { mismatched = null; }
      setResult({ saved, failed, mismatched, at: new Date().toLocaleTimeString('ko-KR', { hour12: false }) });
    } finally {
      setRunning(null); lock.current = false;
      await onApplied();
    }
  };

  const allOk = result && result.failed.length === 0 && result.mismatched !== null && result.mismatched.length === 0;

  return (
    <section data-plan-apply style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <ListChecks size={17} color={TEAL} />
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: INK }}>확정 운영안 일괄 적용</h2>
        <span data-plan-state={pending.length === 0 && errors.length === 0 ? 'applied' : 'pending'} style={{
          marginLeft: 'auto', fontSize: 12.5, fontWeight: 800, padding: '3px 10px', borderRadius: 999,
          background: pending.length === 0 ? '#E7F3F1' : '#FFF7E6', color: pending.length === 0 ? '#0A6F65' : '#92400E',
        }}>{pending.length === 0 ? `${plan.entries.length}개 조 모두 적용됨` : `적용 필요 ${pending.length} / ${plan.entries.length}`}</span>
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 600, color: MUTED, lineHeight: 1.6, wordBreak: 'keep-all' }}>
        {plan.label}. 18개 조의 출전 순서와 예정 코트를 한 번에 저장합니다. 조편성 · 팀 자리 · 잠금 · 공개 · 경기는 바뀌지 않습니다.
      </p>

      <div style={{ overflowX: 'auto', marginTop: 10 }}>
        <table data-plan-table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 300 }}>
          <thead><tr><th style={th}>코트</th><th style={th}>{SESSION_LABEL[1]}</th><th style={th}>{SESSION_LABEL[2]}</th></tr></thead>
          <tbody>
            {byCourt.map(({ court, s1, s2 }) => (
              <tr key={court} data-plan-court={court}>
                <td style={{ ...td, width: 56, whiteSpace: 'nowrap' }}>{court}번</td>
                {[s1, s2].map((e, i) => {
                  const r = rowOf(e);
                  return (
                    <td key={i} style={{ ...td, color: e ? INK : '#94A3B8' }} data-plan-cell={e ? e.groupNo : 'none'}>
                      {e ? planGroupLabel(e) : '없음'}
                      {e && plan.staff.some((s) => s.groupNo === e.groupNo) && <span style={{ marginLeft: 4, fontSize: 11.5, color: '#B45309' }}>운영진</span>}
                      {r && r.kind !== 'same' && <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 800, color: r.kind === 'new' ? TEAL : '#B45309' }}>{r.kind === 'new' ? '신규' : '변경'}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {errors.length > 0 && (
        <ul data-plan-errors style={{ margin: '12px 0 0', padding: '10px 12px 10px 30px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', display: 'grid', gap: 4 }}>
          {errors.map((t, i) => <li key={i} style={{ fontSize: 12.5, fontWeight: 700, color: '#991B1B', lineHeight: 1.55 }}>{t}</li>)}
        </ul>
      )}

      {running ? (
        <p data-plan-running style={{ margin: '12px 0 0', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 800, color: INK }}>
          <Loader2 size={15} className="animate-spin" />저장 중 {running.done} / {running.total} — 창을 닫지 마세요.
        </p>
      ) : (
        <button type="button" data-plan-action="open" disabled={checking || errors.length > 0 || !!confirm}
          onClick={() => void openConfirm()}
          style={{ ...btn, width: '100%', marginTop: 12, background: TEAL, borderColor: TEAL, color: '#fff', opacity: checking || errors.length > 0 ? 0.5 : 1 }}>
          {checking ? <Loader2 size={15} className="animate-spin" /> : <ListChecks size={15} />}
          {pending.length === 0 ? '확정 운영안 다시 확인' : '확정 운영안 일괄 적용'}
        </button>
      )}

      {result && (
        <div data-plan-result={allOk ? 'ok' : 'partial'} style={{
          marginTop: 12, padding: 12, borderRadius: 12, border: `1px solid ${allOk ? '#A7D9D2' : '#FECACA'}`, background: allOk ? '#F0FAF8' : '#FEF2F2',
        }}>
          <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 900, color: allOk ? '#0A6F65' : '#991B1B' }}>
            {allOk ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            {allOk ? `적용 완료 · DB 재조회 결과 ${plan.entries.length}개 조 모두 일치` : '일부 조가 확정안과 다릅니다'}
            <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: MUTED }}>{result.at}</span>
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 700, color: '#334155', lineHeight: 1.6 }}>
            저장 성공 {result.saved.length}개{result.saved.length ? ` (${result.saved.map(planGroupLabel).join(', ')})` : ''} · 실패 {result.failed.length}개
          </p>
          {result.failed.length > 0 && (
            <ul data-plan-failed style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {result.failed.map((f) => <li key={f.entry.groupNo} style={{ fontSize: 12.5, fontWeight: 700, color: '#991B1B' }}>{planGroupLabel(f.entry)}: {f.message}</li>)}
            </ul>
          )}
          {result.mismatched === null && <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 800, color: '#991B1B' }}>저장 후 재조회에 실패했습니다. 새로고침 후 이 표의 상태를 확인해 주세요.</p>}
          {result.mismatched && result.mismatched.length > 0 && (
            <p data-plan-mismatch style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 800, color: '#991B1B' }}>
              DB 재조회 불일치: {result.mismatched.map(planGroupLabel).join(', ')} — [확정 운영안 일괄 적용] 을 다시 누르면 다른 조만 다시 저장합니다.
            </p>
          )}
        </div>
      )}

      {confirm && (
        <div role="dialog" aria-modal="true" data-plan-confirm style={{
          position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{ ...card, width: '100%', maxWidth: 520, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: INK }}>확정 운영안을 적용할까요?</h3>
            {confirm.errors.length > 0 ? (
              <ul data-plan-confirm-errors style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
                {confirm.errors.map((t, i) => <li key={i} style={{ fontSize: 12.5, fontWeight: 700, color: '#991B1B' }}>{t}</li>)}
              </ul>
            ) : (() => {
              const changes = confirm.rows.filter((r) => r.kind !== 'same');
              const over = changes.filter((r) => r.kind === 'overwrite').length;
              return (
                <>
                  <p data-plan-confirm-summary style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 700, color: '#334155', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                    {changes.length === 0
                      ? `${confirm.rows.length}개 조가 이미 확정안과 같습니다. 저장할 것이 없습니다.`
                      : `${changes.length}개 조를 저장합니다 — 신규 ${changes.length - over}개 · 기존 설정 덮어쓰기 ${over}개.${changes.length < confirm.rows.length ? ` 이미 같은 ${confirm.rows.length - changes.length}개 조는 건드리지 않습니다.` : ''}`}
                    {data.drawPublishedAt ? ' 지금 DRAW 공개 중이므로 참가자 화면에 45초 안에 반영됩니다.' : ''}
                  </p>
                  {changes.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
                      <thead><tr><th style={th}>조</th><th style={th}>현재</th><th style={th}>적용 후</th></tr></thead>
                      <tbody>
                        {changes.map((r) => (
                          <tr key={r.entry.groupNo} data-plan-change={r.entry.groupNo} data-plan-kind={r.kind}>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>{planGroupLabel(r.entry)}</td>
                            <td style={{ ...td, color: r.kind === 'overwrite' ? '#B45309' : MUTED }}>{slotText(r.before.sessionNo, r.before.courtNo)}{r.kind === 'overwrite' && ' (덮어씀)'}</td>
                            <td style={td}>{slotText(r.entry.sessionNo, r.entry.courtNo)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              );
            })()}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="button" data-plan-action="cancel" style={{ ...btn, flex: 1 }} onClick={() => setConfirm(null)}><XCircle size={15} />취소</button>
              {confirm.errors.length === 0 && confirm.rows.some((r) => r.kind !== 'same') && (
                <button type="button" data-plan-action="apply" style={{ ...btn, flex: 1, background: TEAL, borderColor: TEAL, color: '#fff' }} onClick={() => void apply()}>
                  <CheckCircle2 size={15} />적용
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
