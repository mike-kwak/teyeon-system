'use client';

// MATCH SPOTLIGHT 운영진 관전 포인트 · 운영진 PICK 편집 — 세션 관리 모달 안 화면. (외부 AI 없음 · 규칙 기반)
//   STEP 1 관전 메모 작성: 여러 경기 메모를 자연어로 입력. 원문은 이 기기에만 저장(공개 · 서버 저장 없음).
//   STEP 2 경기 자동 연결 확인: linkInstructions — "2번" · "3경기" · "R2 1코트" · 선수 이름. 경기 목록은 서버
//          matches(라운드 · 코트 · 선수). 번호만 · 추정 · 후보 여러 개 · 불일치 · 없는 번호는 자동 확정하지 않는다
//          → 운영진이 "이 경기가 맞음" 또는 경기 선택으로 확정해야 적용할 수 있다.
//   STEP 3 경기별 관전 포인트 작성: 공개 문구는 운영진이 직접 쓴다(메모 원문을 복사하지 않음 — P0).
//          검증: 120자 · 꺾쇠 · 다른 경기 선수 · 개인정보(차단) / 작성 지시처럼 보이는 표현(경고).
//          경기를 바꾸면 이전 경기용 문구가 새 경기에 그대로 붙지 않도록 "문구 확인" 전까지 적용을 막는다.
//   STEP 4 미리보기 및 적용: 서버가 공개와 같은 계산 · 검증(preview). 기존 공개 문구 → 변경 예정 비교 · 텍스트 공유 미리보기.
//          경고가 남아 있으면 확인 체크 후에만 "적용". 공개 · 재공개는 기존 관리 화면 버튼.
//   공개 데이터는 기존 operatorPoint 그대로 — 공개 페이지 · PNG 포스터 · 텍스트 공유가 같은 승인 문구를 쓴다.

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Link2, Plus, Trash2 } from 'lucide-react';
import {
  buildSpotlightShareText, parsePublicSpotlightPayload, type PublicSpotlightPayload,
} from '@/lib/kdk/analytics/publicSpotlight';
import {
  detectOperatorInstruction, INSTRUCTION_WARNING_TEXT, linkOperatorNotes, mergeLinkedRows, OPERATOR_NOTES_MAX, OPERATOR_POINT_MAX, SPOTLIGHT_ITEMS_MAX,
  type NoteLinkStatus, type OperatorInput,
} from '@/lib/kdk/analytics/spotlightOperator';
import {
  allNamesOf, blockingIssues, checkPublicText, issueText, linkInstructions, matchInfoLabel, MEMO_MAX,
  type InstructionStatus, type SpotlightMatchInfo, type TextIssue,
} from '@/lib/kdk/analytics/spotlightMemoLink';
import SpotlightView from './SpotlightView';
import { postSpotlightAction, readLocal, writeLocal } from './spotlightClientApi';
import { spotlightFailText } from './spotlightMessages';

type RowStatus = NoteLinkStatus | InstructionStatus | 'manual';
type Row = {
  id: string; note: string; status: RowStatus; candidates: number[]; matchNo: number | null; text: string;
  /** false 면 연결 확인 전(적용 불가). 예전 저장 행(필드 없음)은 확정으로 본다. */
  confirmed?: boolean;
  excluded?: boolean;
  /** 문구가 있는 채로 경기를 바꿈 — 새 경기에 맞는 문구인지 확인 전까지 적용 불가. */
  moved?: boolean;
};
type Saved = { rows: Row[]; pick: OperatorInput['pick'] };

const AMBER = { color: '#B45309', bg: '#FFF4E0' };
const STATUS_TEXT: Record<RowStatus, { label: string; color: string; bg: string }> = {
  linked: { label: '자동 연결', color: '#0F766E', bg: '#E6F6F4' },
  guess: { label: '이름 추정 · 확인 필요', ...AMBER },
  confirm: { label: '번호 · 추정 연결 · 확인 필요', ...AMBER },
  choose: { label: '후보 여러 경기 · 선택 필요', ...AMBER },
  conflict: { label: '번호와 선수 불일치 · 선택 필요', color: '#B91C1C', bg: '#FDECEC' },
  missing: { label: '해당 번호 경기 없음 · 경기 선택', color: '#B91C1C', bg: '#FDECEC' },
  none: { label: '선수 이름 없음 · 경기 선택', color: '#64748B', bg: '#F1F5F9' },
  manual: { label: '직접 입력', color: '#1D4ED8', bg: '#EAF0FD' },
};

let seq = 0;
const newId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;
const isConfirmed = (r: Row): boolean => r.confirmed !== false;
const isIncluded = (r: Row): boolean => !r.excluded && !!r.matchNo && !!r.text.trim();
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 10000 ? v : null);

export function toOperatorInput(rows: Row[], pick: OperatorInput['pick']): OperatorInput {
  return {
    points: rows.filter(isIncluded).map((r) => ({ matchNo: r.matchNo as number, text: r.text.trim() })),
    pick,
  };
}

/**
 * 기기 저장본 복원 — 형식이 틀리면 버린다. 예전 버전(AI 초안 시험판)의 추가 필드
 * (대기 초안 · AI 표시 · 재생성 횟수 · 안정 id)는 무시한다(대기 초안은 승인 전이므로 복원하지 않음).
 */
export function parseSaved(v: unknown): Saved | null {
  if (!v || typeof v !== 'object' || !Array.isArray((v as any).rows)) return null;
  const rows: Row[] = [];
  for (const x of (v as any).rows.slice(0, 40)) {
    if (!x || typeof x !== 'object') continue;
    const status = typeof x.status === 'string' && x.status in STATUS_TEXT ? (x.status as RowStatus) : 'manual';
    rows.push({
      id: typeof x.id === 'string' && x.id ? x.id.slice(0, 40) : newId(),
      note: typeof x.note === 'string' ? x.note.slice(0, 400) : '',
      status,
      candidates: Array.isArray(x.candidates) ? x.candidates.map(posInt).filter((n: number | null): n is number => n != null).slice(0, 80) : [],
      matchNo: posInt(x.matchNo),
      text: typeof x.text === 'string' ? x.text.slice(0, OPERATOR_POINT_MAX + 40) : '',
      ...(x.confirmed === false ? { confirmed: false } : {}),
      ...(x.excluded === true ? { excluded: true } : {}),
      ...(x.moved === true ? { moved: true } : {}),
    });
  }
  const p = (v as any).pick;
  const pick = p && typeof p === 'object' && posInt(p.matchNo) ? { matchNo: posInt(p.matchNo) as number, replace: posInt(p.replace) } : null;
  return { rows, pick };
}

/** 공개 payload 만 있을 때의 경기 목록(코트 없음 — 이름 · 번호 연결만). */
function infosFromPayload(p: PublicSpotlightPayload): SpotlightMatchInfo[] {
  const top = new Set(p.items.map((i) => i.matchNo));
  return p.matches.map((m) => ({ matchNo: m.matchNo, round: m.round, court: null, group: m.group, teamA: m.teamA, teamB: m.teamB,
    badge: m.badge, inTop: top.has(m.matchNo), status: '' }));
}
function parseInfos(v: unknown): SpotlightMatchInfo[] | null {
  if (!Array.isArray(v)) return null;
  const s = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '');
  const out: SpotlightMatchInfo[] = [];
  for (const m of v.slice(0, 80)) {
    if (!m || typeof m !== 'object' || !Number.isInteger(m.matchNo)) continue;
    out.push({ matchNo: m.matchNo, round: Number(m.round) || 0, court: Number(m.court) > 0 ? Number(m.court) : null,
      group: s(m.group, 12), teamA: [s(m.teamA?.[0], 40), s(m.teamA?.[1], 40)], teamB: [s(m.teamB?.[0], 40), s(m.teamB?.[1], 40)],
      badge: m.badge ?? null, inTop: m.inTop === true, status: s(m.status, 20) });
  }
  return out;
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
  const saved = useMemo(() => parseSaved(readLocal<unknown>(storeKey)), [storeKey]);
  const [notes, setNotes] = useState<string>(() => { const v = readLocal<unknown>(notesKey); return typeof v === 'string' ? v.slice(0, MEMO_MAX) : ''; });
  const [rows, setRows] = useState<Row[]>(() => saved?.rows?.length
    ? saved.rows
    : initial.points.map((p) => ({ id: newId(), note: '', status: 'manual' as const, candidates: [], matchNo: p.matchNo, text: p.text })));
  const [pick, setPick] = useState<OperatorInput['pick']>(saved ? saved.pick : initial.pick);
  const [base, setBase] = useState<PublicSpotlightPayload | null>(null);
  const [baseErr, setBaseErr] = useState<string | null>(null);
  const [infos, setInfos] = useState<SpotlightMatchInfo[] | null>(null);
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
    // 경기 목록(라운드 · 코트) — 실패해도 공개 payload 기준으로 이름 · 번호 연결은 된다.
    postSpotlightAction({ action: 'matches', runId }).then((r) => {
      if (!alive) return;
      const list = r.ok ? parseInfos(r.j.matches) : null;
      if (list) setInfos(list);
    }).catch(() => { /* 공개 payload 기준으로 계속 */ });
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

  const matchList = useMemo<SpotlightMatchInfo[]>(() => infos || (base ? infosFromPayload(base) : []), [infos, base]);
  const infoByNo = useMemo(() => new Map(matchList.map((m) => [m.matchNo, m])), [matchList]);
  const allNames = useMemo(() => allNamesOf(matchList), [matchList]);
  const input = useMemo(() => toOperatorInput(rows, pick), [rows, pick]);
  const inputKey = JSON.stringify(input);
  const topNos = useMemo(() => new Set((base?.items || []).map((i) => i.matchNo)), [base]);
  const byNo = useMemo(() => new Map((base?.matches || []).map((m) => [m.matchNo, m])), [base]);
  const publishedText = useMemo(() => new Map((publishedPayload?.matches || []).filter((m) => m.operatorPoint).map((m) => [m.matchNo, m.operatorPoint as string])), [publishedPayload]);
  const dupNos = useMemo(() => {
    const c = new Map<number, number>();
    for (const r of rows) if (r.matchNo && !r.excluded) c.set(r.matchNo, (c.get(r.matchNo) || 0) + 1);
    return new Set([...c].filter(([, n]) => n > 1).map(([k]) => k));
  }, [rows]);

  // 공개 문구 검증 — 이미 공개 중인 같은 문구는 차단하지 않고 경고만(기존 승인 문구 보호).
  const textIssues = useMemo(() => new Map(rows.map((r): [string, TextIssue[]] => {
    const m = r.matchNo ? infoByNo.get(r.matchNo) : undefined;
    if (!m || !r.text.trim()) return [r.id, []];
    const approved = publishedText.get(r.matchNo as number) === r.text.trim();
    return [r.id, checkPublicText(r.text, [...m.teamA, ...m.teamB].filter(Boolean), allNames, approved)];
  })), [rows, infoByNo, allNames, publishedText]);

  const link = () => {
    if (!base) return;
    let count = 0;
    let next: Row[];
    if (matchList.length) {
      const links = linkInstructions(notes, matchList);
      count = links.length;
      // 확정(linked)만 기존 행에 메모로 붙일 수 있다 — 제안(번호 · 추정)은 새 행으로(잘못된 경기 행에 붙지 않게).
      next = mergeLinkedRows<Row, { matchNo: number | null; note: string; link: (typeof links)[number] }>(
        rows,
        links.map((l) => ({ matchNo: l.status === 'linked' ? l.matchNo : null, note: l.instruction, link: l })),
        ({ link: l }) => ({ id: newId(), note: l.instruction, status: l.status, candidates: l.candidates, matchNo: l.matchNo,
          confirmed: l.status === 'linked' }),
      );
    } else {
      const lines = notes.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, OPERATOR_NOTES_MAX);
      const links = linkOperatorNotes(lines, base);
      count = links.length;
      next = mergeLinkedRows<Row>(rows, links, (l) => ({ id: newId(), note: l.note, status: l.status,
        candidates: l.candidates, matchNo: l.matchNo, confirmed: l.status === 'linked' }));
    }
    setRows(next);
    setChecked(null);
    setMsg(count > 0
      ? { text: '경기를 연결했습니다. 메모는 공개되지 않습니다 — 연결을 확인한 뒤 각 경기의 "공개 관전 포인트"를 작성해 주세요.', ok: true }
      : { text: '연결할 메모가 없습니다. 경기마다 줄이나 문장을 나눠 적어 주세요.', ok: false });
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
  const included = rows.filter(isIncluded);
  const warnCount = included.filter((r) => (warnings.get(r.id)?.length || 0) > 0
    || (textIssues.get(r.id) || []).some((x) => x.severity === 'warn')).length;
  const blockCount = included.filter((r) => blockingIssues(textIssues.get(r.id) || []).length > 0).length;
  const unconfirmedCount = rows.filter((r) => !r.excluded && r.text.trim() && (!isConfirmed(r) || !r.matchNo || r.moved)).length;
  const emptyCount = rows.filter((r) => !r.excluded && r.matchNo && !r.text.trim()).length;
  // 공개 대상(문구 있음) 중 같은 경기 두 개 — 서버도 operator_duplicate_match 로 거부한다.
  const dupCount = new Set(included.map((r) => r.matchNo)).size < included.length ? 1 : 0;
  // 최종 확인: 경고가 남았으면 운영진 확인 — 승인 후 입력(문구 · 연결 · 제외 · PICK)이 바뀌면 다시 확인.
  const [ackKey, setAckKey] = useState<string | null>(null);
  useEffect(() => { if (!checked) setAckKey(null); }, [checked]);
  const needAck = warnCount > 0;
  const acked = !needAck || ackKey === inputKey;
  const canApply = ready && acked && blockCount === 0 && unconfirmedCount === 0 && dupCount === 0;

  // 기존 공개 문구 → 변경 예정(미리보기 통과본 기준)
  const changes = useMemo(() => {
    if (!checked) return [];
    const after = new Map(checked.payload.matches.filter((m) => m.operatorPoint).map((m) => [m.matchNo, m.operatorPoint as string]));
    return [...new Set([...publishedText.keys(), ...after.keys()])].sort((a, b) => a - b)
      .filter((no) => publishedText.get(no) !== after.get(no))
      .map((no) => ({ no, before: publishedText.get(no) || '', after: after.get(no) || '' }));
  }, [checked, publishedText]);

  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1px solid #C9D9EC', background: '#FFFFFF',
    padding: '8px 10px', fontSize: 13, fontWeight: 600, color: '#0F2747', outline: 'none', minWidth: 0 };
  const small: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: '#5B6B80', lineHeight: 1.5, wordBreak: 'keep-all', overflowWrap: 'anywhere' };
  const stepStyle: React.CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: '0.08em', color: '#0F2747', margin: '8px 0 -4px', display: 'flex', alignItems: 'center', gap: 6 };
  const stepNo = (n: number) => (
    <span aria-hidden style={{ width: 20, height: 20, borderRadius: 999, background: '#0F2747', color: '#FFFFFF', fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{n}</span>
  );
  const step = (n: number, label: string) => <div data-op-step={n} style={stepStyle}>{stepNo(n)}STEP {n} · {label}</div>;
  const btn = (label: React.ReactNode, onClick: () => void, o: { primary?: boolean; disabled?: boolean } = {}) => (
    <button type="button" onClick={onClick} disabled={o.disabled || busy}
      style={{ flex: '1 1 0', minWidth: 0, minHeight: 44, padding: '0 8px', borderRadius: 12, fontSize: 13, fontWeight: 900,
        cursor: o.disabled || busy ? 'not-allowed' : 'pointer', border: o.primary ? 'none' : '1px solid #C9D9EC',
        background: o.disabled ? '#EEF2F7' : o.primary ? '#0F2747' : '#FFFFFF', color: o.disabled ? '#94A3B8' : o.primary ? '#FFFFFF' : '#0F2747',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, wordBreak: 'keep-all', textAlign: 'center' }}>
      {label}
    </button>
  );
  const chip = (label: React.ReactNode, onClick: () => void, o: { tone?: 'gold' | 'plain'; aria?: string } = {}) => (
    <button type="button" onClick={onClick} disabled={busy} aria-label={o.aria}
      style={{ minHeight: 36, padding: '0 10px', borderRadius: 10, fontSize: 12, fontWeight: 900, cursor: 'pointer',
        border: o.tone === 'gold' ? '1px solid rgba(184,137,28,0.45)' : '1px solid #C9D9EC', background: o.tone === 'gold' ? '#FFF9EA' : '#FFFFFF',
        color: '#0F2747', display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
      {label}
    </button>
  );
  // iOS 키보드: 입력 칸을 화면 가운데로(모달 본문 스크롤 안에서)
  const focusIntoView = (e: React.FocusEvent<HTMLElement>) => {
    const el = e.currentTarget;
    setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* 무시 */ } }, 250);
  };

  if (baseErr) return <div role="status" style={{ ...small, color: '#B91C1C' }}>{baseErr}</div>;
  if (!base) return <div style={small}>공개 기준(자동 분석 결과)을 불러오는 중…</div>;

  const needLinkCheck = rows.filter((r) => !r.excluded && r.matchNo && !isConfirmed(r)).length + rows.filter((r) => !r.excluded && !r.matchNo).length;

  return (
    <section aria-label="운영진 관전 포인트 편집" data-spotlight-operator="" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ ...small, padding: '10px 12px', borderRadius: 12, background: '#FFF9EA', border: '1px solid rgba(184,137,28,0.28)' }}>
        운영진이 알려 준 현장 정보를 관련 경기의 <b style={{ color: '#0F2747' }}>운영진 관전 포인트</b>로 붙입니다. 공식 기록 분석은 바뀌지 않으며,
        입력하지 않으면 자동 분석 그대로 공개됩니다.
        <br /><b style={{ color: '#0F2747' }}>관전 메모</b>는 경기 연결용(비공개 · 이 기기에만 저장)이고, 실제로 공개되는 것은 각 경기의
        <b style={{ color: '#B8891C' }}> 공개 관전 포인트</b>뿐입니다.
      </div>

      {step(1, '관전 메모 작성')}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 900, color: '#0F2747' }}>운영진 관전 메모 (비공개 · 여러 경기를 한 번에 적어도 됩니다)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, MEMO_MAX))} rows={4} aria-label="운영진 메모" onFocus={focusIntoView}
          placeholder={'예) 2번 경기는 오픈부 선수들이 나와. 3번은 접전 예상.\n예) R2 1코트 구봉준·김영호 호흡 좋아.'}
          style={{ ...field, resize: 'vertical', lineHeight: 1.5 }} />
        <span style={{ ...small, textAlign: 'right' }}>{[...notes].length}/{MEMO_MAX}</span>
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        {btn(<><Link2 size={14} aria-hidden />메모로 경기 연결</>, link, { disabled: !notes.trim() })}
        {btn(<><Plus size={14} aria-hidden />직접 추가</>, () => { setRows((rs) => [...rs, { id: newId(), note: '', status: 'manual', candidates: [], matchNo: null, text: '', confirmed: true }]); setChecked(null); })}
      </div>

      {rows.length > 0 && (
        <>
          {step(2, '경기 자동 연결 확인')}
          <div data-op-numnote="" style={{ ...small, padding: '8px 10px', borderRadius: 10, background: '#F6FAFD', border: '1px solid #DCE7F3' }}>
            경기 번호는 SPOTLIGHT 목록 번호(라운드 → 코트 순)입니다. 대진표 화면에는 전체 경기 번호가 없으니
            &quot;R2 1코트&quot;나 선수 이름으로 적으면 정확합니다. 번호로 연결된 경기는 선수 조합을 보고 <b>이 경기가 맞음</b>을 눌러 주세요.
            {needLinkCheck > 0 && <><br /><b style={{ color: '#B45309' }}>확인 · 선택이 필요한 연결 {needLinkCheck}건</b></>}
          </div>
          {step(3, '경기별 관전 포인트 작성')}
        </>
      )}

      {rows.map((r) => {
        const st = STATUS_TEXT[r.status] || STATUS_TEXT.manual;
        const m = r.matchNo ? byNo.get(r.matchNo) : undefined;
        const info = r.matchNo ? infoByNo.get(r.matchNo) : undefined;
        const outside = !!r.matchNo && !topNos.has(r.matchNo);
        const pickable = outside && !!m?.badge;
        const isPick = !!pick && pick.matchNo === r.matchNo;
        const options = r.candidates.length > 1 ? matchList.filter((x) => r.candidates.includes(x.matchNo)) : matchList;
        const issues = textIssues.get(r.id) || [];
        const blocks = blockingIssues(issues);
        const confirmed = isConfirmed(r);
        return (
          <div key={r.id} data-op-row="" data-excluded={r.excluded ? '' : undefined}
            style={{ borderRadius: 14, border: '1px solid rgba(15,39,71,0.12)', background: r.excluded ? '#F8FAFC' : '#FFFFFF', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, opacity: r.excluded ? 0.72 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 900, padding: '2px 8px', borderRadius: 999, color: st.color, background: st.bg }}>{st.label}</span>
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                {chip(r.excluded ? '다시 포함' : '제외', () => update(r.id, { excluded: !r.excluded }), { aria: r.excluded ? '이 경기 다시 포함' : '이 경기 제외' })}
                <button type="button" onClick={() => remove(r.id)} aria-label="이 관전 포인트 삭제"
                  style={{ minWidth: 44, minHeight: 36, borderRadius: 10, border: '1px solid #E2E8F0', background: '#FFFFFF', color: '#64748B', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <Trash2 size={14} aria-hidden />
                </button>
              </span>
            </div>
            {r.excluded && <div style={small}>제외됨 — 이 경기 문구는 공개되지 않습니다(내용은 보관).</div>}
            {r.note && (
              <div data-op-note="" style={{ ...small, padding: '6px 9px', borderRadius: 8, background: '#F1F5F9', border: '1px dashed #CBD5E1', color: '#64748B' }}>
                메모(비공개 · 공개되지 않음): {r.note}
              </div>
            )}
            <span style={{ fontSize: 11.5, fontWeight: 900, color: '#0F2747' }}>연결된 경기</span>
            <select value={r.matchNo ?? ''} aria-label="연결할 경기"
              onChange={(e) => {
                const v = Number(e.target.value) || null;
                // 문구가 있는 채로 경기를 바꾸면 이전 경기용 문구일 수 있다 → "문구 확인" 전까지 적용 불가.
                const moved = v !== r.matchNo && !!r.text.trim() ? true : r.moved;
                update(r.id, { matchNo: v, confirmed: true, status: r.status === 'linked' ? 'linked' : 'manual', moved });
                if (pick && pick.matchNo === r.matchNo) setPick(null);
              }}
              style={{ ...field, fontWeight: 700 }}>
              <option value="">경기 선택</option>
              {options.map((x) => <option key={x.matchNo} value={x.matchNo}>{matchInfoLabel(x)}{topNos.has(x.matchNo) ? ' (TOP)' : ''}</option>)}
            </select>
            {r.matchNo && !confirmed && (
              <div data-op-confirm="" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 10, background: '#FFF4E0', border: '1px solid rgba(180,83,9,0.3)' }}>
                <span style={{ ...small, color: '#92400E', flex: '1 1 160px' }}>
                  {info ? `R${info.round}${info.court ? ` · ${info.court}코트` : ''} · ${info.teamA.filter(Boolean).join('·')} vs ${info.teamB.filter(Boolean).join('·')}` : ''} — 메모가 가리킨 경기가 맞나요?
                </span>
                {chip(<><Check size={13} aria-hidden />이 경기가 맞음</>, () => update(r.id, { confirmed: true }), { tone: 'gold', aria: '이 경기가 맞음' })}
              </div>
            )}
            {r.matchNo && dupNos.has(r.matchNo) && <div data-op-dup="" style={{ ...small, color: '#B91C1C' }}>같은 경기에 관전 포인트가 두 개입니다. 하나로 합치거나 하나를 제외해 주세요.</div>}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11.5, fontWeight: 900, color: '#B8891C' }}>공개 관전 포인트 (관람객에게 공개)</span>
              <textarea value={r.text} maxLength={OPERATOR_POINT_MAX + 40} rows={2} aria-label="공개될 운영진 관전 포인트" onFocus={focusIntoView}
                placeholder="관람객이 읽을 문장으로 작성 (예: 두 팀 모두 오픈부 출전 경험이 있는 경기입니다.)"
                onChange={(e) => update(r.id, { text: e.target.value, moved: undefined })} style={{ ...field, resize: 'vertical', lineHeight: 1.5 }} />
              <span style={{ ...small, display: 'flex', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }}>{r.matchNo && !r.text.trim() ? '비어 있으면 이 경기에는 관전 포인트가 붙지 않습니다.' : ''}</span>
                <span style={{ color: [...r.text].length > OPERATOR_POINT_MAX ? '#B91C1C' : undefined }}>{[...r.text].length}/{OPERATOR_POINT_MAX}</span>
              </span>
            </label>
            {r.moved && !r.excluded && r.text.trim() && (
              <div data-op-moved="" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 10, background: '#FDECEC', border: '1px solid rgba(185,28,28,0.3)' }}>
                <span style={{ ...small, color: '#991B1B', flex: '1 1 160px' }}>경기를 바꿨습니다. 이 문구가 새 경기 내용이 맞는지 확인해 주세요(확인 전에는 적용할 수 없습니다).</span>
                {chip(<><Check size={13} aria-hidden />문구 확인</>, () => update(r.id, { moved: undefined }), { tone: 'gold', aria: '새 경기 문구 확인' })}
              </div>
            )}
            {issues.length > 0 && (
              <div data-op-issues="" style={{ ...small, display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 10px', borderRadius: 10,
                background: blocks.length ? '#FDECEC' : '#FFF8EC', border: `1px solid ${blocks.length ? 'rgba(185,28,28,0.3)' : 'rgba(180,83,9,0.25)'}`,
                color: blocks.length ? '#991B1B' : '#92400E' }}>
                {blocks.length > 0 ? <b>수정 필요 — 고치기 전에는 적용할 수 없습니다</b> : <b>공개 중인 문구 — 확인 필요</b>}
                {issues.map((x, i) => <span key={`${x.code}-${i}`} data-issue={x.code}>· {issueText(x)}</span>)}
              </div>
            )}
            {(warnings.get(r.id)?.length || 0) > 0 && (
              <div role="alert" data-op-warn="" style={{ ...small, color: '#92400E', padding: '8px 10px', borderRadius: 10, background: '#FFF4E0', border: '1px solid rgba(180,83,9,0.35)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 900 }}>
                  <AlertTriangle size={13} aria-hidden />작성 지시가 그대로 공개될 수 있습니다
                </span>
                {(warnings.get(r.id) || []).map((w) => <span key={w}>· {INSTRUCTION_WARNING_TEXT[w]}</span>)}
                <span>관람객이 읽을 문장으로 고쳐 주세요. 예) &quot;강조해 줘&quot; → &quot;오픈부 출전 선수들이 만나는 경기입니다.&quot;</span>
              </div>
            )}
            {outside && !r.excluded && (
              <div style={{ borderRadius: 10, background: '#F6FAFD', border: '1px dashed #C9D9EC', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={small}>자동 TOP {base.items.length} 밖 경기입니다. 그대로 두면 공개 페이지 &quot;전체 경기 분석&quot;에만 표시됩니다.</div>
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
                        {base.items.map((it, i) => <option key={it.matchNo} value={it.matchNo}>{`#${i + 1} 교체 — ${matchInfoLabel(infoByNo.get(it.matchNo) || { ...it, court: null })}`}</option>)}
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

      {(warnCount > 0 || emptyCount > 0 || blockCount > 0 || unconfirmedCount > 0 || dupCount > 0) && (
        <div data-op-summary="" style={{ ...small, color: warnCount || blockCount || unconfirmedCount || dupCount ? '#92400E' : '#5B6B80' }}>
          {blockCount > 0 && <div style={{ color: '#B91C1C' }}>수정이 필요한 공개 문구 {blockCount}건 — 고치거나 제외해야 적용할 수 있습니다.</div>}
          {unconfirmedCount > 0 && <div style={{ color: '#B91C1C' }}>경기 연결 확인이 필요한 문구 {unconfirmedCount}건 — &quot;이 경기가 맞음&quot; · 경기 선택 · &quot;문구 확인&quot; 후 적용할 수 있습니다.</div>}
          {dupCount > 0 && <div style={{ color: '#B91C1C' }}>같은 경기에 공개 문구가 두 개 있습니다 — 하나로 합치거나 하나를 제외해 주세요.</div>}
          {warnCount > 0 && <div>작성 지시처럼 보이거나 확인이 필요한 공개 문구 {warnCount}건 — 고치지 않으면 그대로 공개됩니다.</div>}
          {emptyCount > 0 && <div>공개 문구가 빈 경기 {emptyCount}건 — 이 경기들은 관전 포인트 없이 공개됩니다.</div>}
        </div>
      )}

      {step(4, '미리보기 및 적용')}
      {ready && needAck && (
        <label data-op-ack="" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, fontWeight: 800, color: '#92400E', minHeight: 36, cursor: 'pointer', lineHeight: 1.45 }}>
          <input type="checkbox" checked={ackKey === inputKey} onChange={(e) => setAckKey(e.target.checked ? inputKey : null)}
            style={{ width: 18, height: 18, flex: '0 0 auto', marginTop: 1 }} />
          경고가 있는 문구를 확인했으며, 작성 지시가 아니라 공개할 문장이 맞습니다.
        </label>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {btn(busy ? '확인 중…' : '미리보기 확인', () => void check(), { primary: !ready })}
        {btn('적용', () => checked && canApply && onApply(input, checked.payload), { primary: canApply, disabled: !canApply })}
      </div>
      {msg && <div role="status" style={{ ...small, fontSize: 12.5, color: msg.ok ? '#0F766E' : '#B91C1C' }}>{msg.text}</div>}
      {ready && checked && (
        <div>
          {changes.length > 0 && publishedPayload && (
            <div data-op-changes="" style={{ ...small, marginBottom: 10, padding: '8px 10px', borderRadius: 10, background: '#F6FAFD', border: '1px solid #DCE7F3', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <b style={{ color: '#0F2747' }}>공개 중인 문구와 달라지는 경기 {changes.length}건</b>
              {changes.map((c) => (
                <span key={c.no}>{c.no}경기: {c.before ? `"${c.before}"` : '(없음)'} → {c.after ? `"${c.after}"` : '(삭제)'}</span>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.12em', color: '#94A3B8', margin: '4px 0 8px' }}>미리보기 — 운영진 관전 포인트 반영(아직 공개 전)</div>
          <SpotlightView payload={checked.payload} />
          <details data-op-share="" style={{ marginTop: 10 }}>
            <summary style={{ ...small, cursor: 'pointer', color: '#0F2747' }}>텍스트 공유 문구 미리보기 (PNG 포스터도 같은 문구 사용)</summary>
            <pre style={{ ...small, whiteSpace: 'pre-wrap', margin: '6px 0 0', padding: 10, borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', fontFamily: 'inherit' }}>
              {buildSpotlightShareText(checked.payload, '(공개 링크)')}
            </pre>
          </details>
        </div>
      )}
    </section>
  );
}
