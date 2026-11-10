'use client';

// MATCH SPOTLIGHT 운영진 관전 포인트 · 운영진 PICK 편집(B1 · 규칙 기반) — 세션 관리 모달 안 화면.
//   1) 메모(원문) 입력 → 선수 이름으로 경기 연결 제안(linkOperatorNotes) — 원문은 이 기기에만 저장, 서버로 보내지 않는다.
//      ⚠ 메모는 작성 지시일 수 있으므로(예: "2번은 오픈부라 강조해 줘") 공개 문구로 복사하지 않는다(공개 문구는 빈 칸에서 시작).
//      연결은 기존 행을 덮어쓰지 않는다 — 문구가 있는 행(공개본 복원 · 직접 작성)은 그대로 두고 메모만 붙이거나 새 행을 추가.
//   2) 운영진이 경기 · 공개 문구(최대 120자)를 직접 작성 · 수정. 지시문처럼 보이면 경고(detectOperatorInstruction)하고,
//      경고가 남은 채 적용하려면 운영진 확인을 받는다(서버 검증은 그대로 — 기존 공개 문구 차단 없음).
//      TOP 밖 경기는 운영진 PICK 으로 교체 가능(자격은 서버가 최종 판정).
//   3) "미리보기 확인" = 서버가 공개와 같은 계산 · 검증(preview) → 통과한 입력만 "적용".
//   향후 AI 초안: Row.note(지시 · 비공개) → Row.text(공개 문구 초안)를 채우는 자리. 경고 · 확인 · 미리보기 흐름은 그대로 쓴다.

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Link2, Plus, Trash2 } from 'lucide-react';
import { parsePublicSpotlightPayload, type PublicMatchAnalysis, type PublicSpotlightPayload } from '@/lib/kdk/analytics/publicSpotlight';
import {
  detectOperatorInstruction, INSTRUCTION_WARNING_TEXT, linkOperatorNotes, mergeLinkedRows, OPERATOR_NOTES_MAX, OPERATOR_POINT_MAX, SPOTLIGHT_ITEMS_MAX,
  type NoteLinkStatus, type OperatorInput,
} from '@/lib/kdk/analytics/spotlightOperator';
import SpotlightView from './SpotlightView';
import { postSpotlightAction, readLocal, writeLocal } from './spotlightClientApi';
import { spotlightFailText } from './spotlightMessages';

type Row = { id: string; note: string; status: NoteLinkStatus | 'manual'; candidates: number[]; matchNo: number | null; text: string };
type Saved = { rows: Row[]; pick: OperatorInput['pick'] };

const STATUS_TEXT: Record<Row['status'], { label: string; color: string; bg: string }> = {
  linked: { label: '자동 연결', color: '#0F766E', bg: '#E6F6F4' },
  guess: { label: '이름 추정 · 확인 필요', color: '#B45309', bg: '#FFF4E0' },
  choose: { label: '후보 여러 경기 · 선택 필요', color: '#B45309', bg: '#FFF4E0' },
  none: { label: '선수 이름 없음 · 경기 선택', color: '#64748B', bg: '#F1F5F9' },
  manual: { label: '직접 입력', color: '#1D4ED8', bg: '#EAF0FD' },
};

const matchLabel = (m: PublicMatchAnalysis): string =>
  `R${m.round}${m.group ? ` · ${m.group}조` : ''} · ${m.matchNo}경기 — ${m.teamA.filter(Boolean).join('·')} vs ${m.teamB.filter(Boolean).join('·')}`;

let seq = 0;
const newId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

export function toOperatorInput(rows: Row[], pick: OperatorInput['pick']): OperatorInput {
  return {
    points: rows.filter((r) => r.matchNo && r.text.trim()).map((r) => ({ matchNo: r.matchNo as number, text: r.text.trim() })),
    pick,
  };
}

export default function SpotlightOperatorEditor({
  sessionId, runId, initial, publishedPayload, onApply,
}: {
  sessionId: string;
  runId: string;
  initial: OperatorInput;
  publishedPayload: PublicSpotlightPayload | null;
  onApply: (input: OperatorInput, preview: PublicSpotlightPayload) => void;
}) {
  // 기기 저장: 원문 메모는 세션 단위(같은 정모 재생성 시 다시 쓰기 편하게), 경기 연결(행 · PICK)은 회차 단위
  //   → 새 회차에 이전 회차의 연결 · 문구가 따라오지 않는다(새 회차는 서버 공개본/빈 입력에서 시작).
  const storeKey = `teyeon_spotlight_op:${runId}`;
  const notesKey = `teyeon_spotlight_notes:${sessionId}`;
  const saved = useMemo(() => readLocal<Saved>(storeKey), [storeKey]);
  const [notes, setNotes] = useState<string>(() => readLocal<string>(notesKey) || '');
  const [rows, setRows] = useState<Row[]>(() => saved?.rows?.length
    ? saved.rows
    : initial.points.map((p) => ({ id: newId(), note: '', status: 'manual' as const, candidates: [], matchNo: p.matchNo, text: p.text })));
  const [pick, setPick] = useState<OperatorInput['pick']>(saved?.pick ?? initial.pick);
  const [base, setBase] = useState<PublicSpotlightPayload | null>(null);
  const [baseErr, setBaseErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<{ key: string; payload: PublicSpotlightPayload } | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // 자동 결과(운영진 입력 없음) = 서버 미리보기. 연결 후보 · TOP · PICK 자격 표시의 기준.
  useEffect(() => {
    let alive = true;
    postSpotlightAction({ action: 'preview', runId }).then((r) => {
      if (!alive) return;
      const p = r.ok ? parsePublicSpotlightPayload(r.j.payload) : null;
      if (!p) { setBaseErr(spotlightFailText(r.j, r.status)); return; }
      setBase(p);
    }).catch(() => { if (alive) setBaseErr(spotlightFailText({ reason: 'db_unavailable' }, 0)); });
    return () => { alive = false; };
  }, [runId]);

  // 공개 중인 PICK 의 교체 대상 복원(자동 TOP 에 있었는데 공개본에 없는 경기)
  useEffect(() => {
    if (!base || !publishedPayload || !pick || pick.replace != null) return;
    const replaced = base.items.find((i) => !publishedPayload.items.some((p) => p.matchNo === i.matchNo));
    if (replaced) setPick({ matchNo: pick.matchNo, replace: replaced.matchNo });
  }, [base, publishedPayload, pick]);

  useEffect(() => { writeLocal(storeKey, { rows, pick }); }, [storeKey, rows, pick]);
  useEffect(() => { writeLocal(notesKey, notes || null); }, [notesKey, notes]);

  const input = useMemo(() => toOperatorInput(rows, pick), [rows, pick]);
  const inputKey = JSON.stringify(input);
  const topNos = useMemo(() => new Set((base?.items || []).map((i) => i.matchNo)), [base]);
  const byNo = useMemo(() => new Map((base?.matches || []).map((m) => [m.matchNo, m])), [base]);
  const dupNos = useMemo(() => {
    const c = new Map<number, number>();
    for (const r of rows) if (r.matchNo) c.set(r.matchNo, (c.get(r.matchNo) || 0) + 1);
    return new Set([...c].filter(([, n]) => n > 1).map(([k]) => k));
  }, [rows]);

  const link = () => {
    if (!base) return;
    const lines = notes.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, OPERATOR_NOTES_MAX);
    const links = linkOperatorNotes(lines, base);
    setRows((rs) => mergeLinkedRows<Row>(rs, links, (l) => ({ id: newId(), note: l.note, status: l.status, candidates: l.candidates, matchNo: l.matchNo })));
    setChecked(null);
    setMsg(links.length
      ? { text: '경기를 연결했습니다. 메모는 공개되지 않습니다 — 각 경기의 "공개 문구"를 관람객이 읽을 문장으로 직접 작성해 주세요.', ok: true }
      : { text: '연결할 메모가 없습니다. 한 줄에 하나씩 적어 주세요.', ok: false });
  };
  const update = (id: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setChecked(null);
  };
  const remove = (id: string) => {
    const r = rows.find((x) => x.id === id);
    setRows((rs) => rs.filter((x) => x.id !== id));
    if (r && pick && r.matchNo === pick.matchNo && !rows.some((x) => x.id !== id && x.matchNo === pick.matchNo)) setPick(null);
    setChecked(null);
  };

  const check = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await postSpotlightAction({ action: 'preview', runId, operator: input });
      const p = r.ok ? parsePublicSpotlightPayload(r.j.payload) : null;
      if (!p) { setChecked(null); setMsg({ text: spotlightFailText(r.j, r.status), ok: false }); return; }
      setChecked({ key: inputKey, payload: p });
      setMsg({ text: '검증을 통과했습니다. 아래 미리보기를 확인한 뒤 "적용"을 누르세요.', ok: true });
    } catch {
      setMsg({ text: spotlightFailText({ reason: 'db_unavailable' }, 0), ok: false });
    } finally { setBusy(false); }
  };
  const ready = !!checked && checked.key === inputKey;

  // 지시문 경고(차단 아님): 행별 사유 · 공개 대상(경기 + 문구 있음) 중 경고가 남은 행 수.
  const warnings = useMemo(() => new Map(rows.map((r) => [r.id, detectOperatorInstruction(r.text, r.note)])), [rows]);
  const warnCount = rows.filter((r) => r.matchNo && r.text.trim() && (warnings.get(r.id)?.length || 0) > 0).length;
  const emptyCount = rows.filter((r) => r.matchNo && !r.text.trim()).length;
  // 경고가 남은 채 적용하려면 운영진 확인 — 입력이 바뀌면 다시 확인.
  const [ackKey, setAckKey] = useState<string | null>(null);
  const acked = warnCount === 0 || ackKey === inputKey;

  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1px solid #C9D9EC', background: '#FFFFFF',
    padding: '8px 10px', fontSize: 13, fontWeight: 600, color: '#0F2747', outline: 'none', minWidth: 0 };
  const small: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: '#5B6B80', lineHeight: 1.5, wordBreak: 'keep-all', overflowWrap: 'anywhere' };
  const btn = (label: React.ReactNode, onClick: () => void, o: { primary?: boolean; disabled?: boolean } = {}) => (
    <button type="button" onClick={onClick} disabled={o.disabled || busy}
      style={{ flex: '1 1 0', minWidth: 0, minHeight: 44, padding: '0 8px', borderRadius: 12, fontSize: 13, fontWeight: 900,
        cursor: o.disabled || busy ? 'not-allowed' : 'pointer', border: o.primary ? 'none' : '1px solid #C9D9EC',
        background: o.disabled ? '#EEF2F7' : o.primary ? '#0F2747' : '#FFFFFF', color: o.disabled ? '#94A3B8' : o.primary ? '#FFFFFF' : '#0F2747',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, wordBreak: 'keep-all', textAlign: 'center' }}>
      {label}
    </button>
  );

  if (baseErr) return <div role="status" style={{ ...small, color: '#B91C1C' }}>{baseErr}</div>;
  if (!base) return <div style={small}>공개 기준(자동 분석 결과)을 불러오는 중…</div>;

  return (
    <section aria-label="운영진 관전 포인트 편집" data-spotlight-operator="" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ ...small, padding: '10px 12px', borderRadius: 12, background: '#FFF9EA', border: '1px solid rgba(184,137,28,0.28)' }}>
        운영진이 알려 준 현장 정보를 관련 경기의 <b style={{ color: '#0F2747' }}>운영진 관전 포인트</b>로 붙입니다. 공식 기록 분석은 바뀌지 않으며,
        입력하지 않으면 자동 분석 그대로 공개됩니다.
        <br /><b style={{ color: '#0F2747' }}>메모</b>는 경기 연결용(비공개 · 이 기기에만 저장)이고, 실제로 공개되는 것은 각 경기의
        <b style={{ color: '#B8891C' }}> 공개 문구</b>뿐입니다. 공개 문구는 관람객이 읽을 문장으로 직접 작성해 주세요.
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 900, color: '#0F2747' }}>운영진 메모 (비공개 · 한 줄에 하나 · 최대 {OPERATOR_NOTES_MAX}줄)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} aria-label="운영진 메모"
          placeholder={'예) 오늘 구봉준·김영호 경기 기대돼. 두 사람 호흡이 좋아.\n예) 게스트 OOO님은 오픈부 우승 경험이 있어.'}
          style={{ ...field, resize: 'vertical', lineHeight: 1.5 }} />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        {btn(<><Link2 size={14} aria-hidden />메모로 경기 연결</>, link, { disabled: !notes.trim() })}
        {btn(<><Plus size={14} aria-hidden />직접 추가</>, () => { setRows((rs) => [...rs, { id: newId(), note: '', status: 'manual', candidates: [], matchNo: null, text: '' }]); setChecked(null); })}
      </div>

      {rows.map((r) => {
        const st = STATUS_TEXT[r.status];
        const m = r.matchNo ? byNo.get(r.matchNo) : undefined;
        const outside = !!r.matchNo && !topNos.has(r.matchNo);
        const pickable = outside && !!m?.badge;
        const isPick = !!pick && pick.matchNo === r.matchNo;
        const options = r.candidates.length > 1 ? base.matches.filter((x) => r.candidates.includes(x.matchNo)) : base.matches;
        return (
          <div key={r.id} data-op-row="" style={{ borderRadius: 14, border: '1px solid rgba(15,39,71,0.12)', background: '#FFFFFF', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 900, padding: '2px 8px', borderRadius: 999, color: st.color, background: st.bg }}>{st.label}</span>
              <button type="button" onClick={() => remove(r.id)} aria-label="이 관전 포인트 삭제"
                style={{ marginLeft: 'auto', minWidth: 44, minHeight: 36, borderRadius: 10, border: '1px solid #E2E8F0', background: '#FFFFFF', color: '#64748B', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
            {r.note && (
              <div data-op-note="" style={{ ...small, padding: '6px 9px', borderRadius: 8, background: '#F1F5F9', border: '1px dashed #CBD5E1', color: '#64748B' }}>
                메모(비공개 · 공개되지 않음): {r.note}
              </div>
            )}
            <select value={r.matchNo ?? ''} aria-label="연결할 경기"
              onChange={(e) => { const v = Number(e.target.value) || null; update(r.id, { matchNo: v }); if (pick && pick.matchNo === r.matchNo) setPick(null); }}
              style={{ ...field, fontWeight: 700 }}>
              <option value="">경기 선택</option>
              {options.map((x) => <option key={x.matchNo} value={x.matchNo}>{matchLabel(x)}{topNos.has(x.matchNo) ? ' (TOP)' : ''}</option>)}
            </select>
            {r.matchNo && dupNos.has(r.matchNo) && <div style={{ ...small, color: '#B91C1C' }}>같은 경기에 관전 포인트가 두 개입니다. 하나로 합쳐 주세요.</div>}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11.5, fontWeight: 900, color: '#B8891C' }}>공개 문구 (운영진 관전 포인트로 공개)</span>
              <textarea value={r.text} maxLength={OPERATOR_POINT_MAX} rows={2} aria-label="공개될 운영진 관전 포인트"
                placeholder="관람객이 읽을 문장으로 작성 (예: 두 팀 모두 오픈부 출전 경험이 있는 경기입니다.)"
                onChange={(e) => update(r.id, { text: e.target.value })} style={{ ...field, resize: 'vertical', lineHeight: 1.5 }} />
              <span style={{ ...small, display: 'flex', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }}>{r.matchNo && !r.text.trim() ? '비어 있으면 이 경기에는 관전 포인트가 붙지 않습니다.' : ''}</span>
                <span>{[...r.text].length}/{OPERATOR_POINT_MAX}</span>
              </span>
            </label>
            {(warnings.get(r.id)?.length || 0) > 0 && (
              <div role="alert" data-op-warn="" style={{ ...small, color: '#92400E', padding: '8px 10px', borderRadius: 10, background: '#FFF4E0', border: '1px solid rgba(180,83,9,0.35)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 900 }}>
                  <AlertTriangle size={13} aria-hidden />작성 지시가 그대로 공개될 수 있습니다
                </span>
                {(warnings.get(r.id) || []).map((w) => <span key={w}>· {INSTRUCTION_WARNING_TEXT[w]}</span>)}
                <span>관람객이 읽을 문장으로 고쳐 주세요. 예) &quot;강조해 줘&quot; → &quot;오픈부 출전 선수들이 만나는 경기입니다.&quot;</span>
              </div>
            )}
            {outside && (
              <div style={{ borderRadius: 10, background: '#F6FAFD', border: '1px dashed #C9D9EC', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={small}>자동 TOP {base.items.length} 밖 경기입니다. 그대로 두면 공개 페이지 "전체 경기 분석"에만 표시됩니다.</div>
                {pickable ? (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 900, color: '#0F2747', minHeight: 36, cursor: 'pointer' }}>
                      <input type="checkbox" checked={isPick} style={{ width: 18, height: 18 }}
                        onChange={(e) => { setPick(e.target.checked && r.matchNo ? { matchNo: r.matchNo, replace: base.items.length >= SPOTLIGHT_ITEMS_MAX ? base.items[base.items.length - 1]?.matchNo ?? null : null } : null); setChecked(null); }} />
                      운영진 PICK 으로 TOP · 포스터에 넣기
                    </label>
                    {isPick && (
                      <select value={pick?.replace ?? ''} aria-label="교체할 TOP 경기"
                        onChange={(e) => { setPick({ matchNo: r.matchNo as number, replace: Number(e.target.value) || null }); setChecked(null); }}
                        style={{ ...field, fontWeight: 700 }}>
                        {base.items.length < SPOTLIGHT_ITEMS_MAX && <option value="">교체 없이 추가</option>}
                        {base.items.map((it, i) => <option key={it.matchNo} value={it.matchNo}>{`#${i + 1} 교체 — ${matchLabel(it)}`}</option>)}
                      </select>
                    )}
                  </>
                ) : (
                  <div style={{ ...small, color: '#94A3B8' }}>공식 분석 유형이 없는 경기라 운영진 PICK 으로 넣을 수 없습니다.</div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {(warnCount > 0 || emptyCount > 0) && (
        <div data-op-summary="" style={{ ...small, color: warnCount ? '#92400E' : '#5B6B80' }}>
          {warnCount > 0 && <div>작성 지시처럼 보이는 공개 문구 {warnCount}건 — 고치지 않으면 그대로 공개됩니다.</div>}
          {emptyCount > 0 && <div>공개 문구가 빈 경기 {emptyCount}건 — 이 경기들은 관전 포인트 없이 공개됩니다.</div>}
        </div>
      )}
      {ready && warnCount > 0 && (
        <label data-op-ack="" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, fontWeight: 800, color: '#92400E', minHeight: 36, cursor: 'pointer', lineHeight: 1.45 }}>
          <input type="checkbox" checked={ackKey === inputKey} onChange={(e) => setAckKey(e.target.checked ? inputKey : null)}
            style={{ width: 18, height: 18, flex: '0 0 auto', marginTop: 1 }} />
          경고가 있는 문구를 확인했으며, 작성 지시가 아니라 공개할 문장이 맞습니다.
        </label>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {btn(busy ? '확인 중…' : '미리보기 확인', () => void check(), { primary: !ready })}
        {btn('적용', () => checked && acked && onApply(input, checked.payload), { primary: ready && acked, disabled: !ready || !acked })}
      </div>
      {msg && <div role="status" style={{ ...small, fontSize: 12.5, color: msg.ok ? '#0F766E' : '#B91C1C' }}>{msg.text}</div>}
      {ready && checked && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.12em', color: '#94A3B8', margin: '4px 0 8px' }}>미리보기 — 운영진 관전 포인트 반영(아직 공개 전)</div>
          <SpotlightView payload={checked.payload} />
        </div>
      )}
    </section>
  );
}
