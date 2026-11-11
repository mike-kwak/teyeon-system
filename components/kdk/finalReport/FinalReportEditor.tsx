'use client';

// TEYEON KDK FINAL REPORT — 운영진 편집 · 발행 모달(P3).
//   STEP 1 공식 기록 확인 → STEP 2 TOP3 스토리 → STEP 3 주요 경기 · 리뷰 → STEP 4 미리보기 · 발행.
//   · 순위 · 승패 · 점수는 서버가 공식 Archive 에서 읽은 값만 보여 준다(편집 불가 · 재계산 없음).
//   · 미리보기는 서버가 만든 공개본을 실제 공개 화면 컴포넌트(FinalReportMagazine)로 그린다.
//   · 저장 · 발행은 서버 route 가 권한 · 기록 지문 · revision · 문구를 다시 확인한다. 충돌은 덮어쓰지 않고 안내.
//   · 모달: 배경 스크롤 잠금(useBodyScrollLock — 단일 스크롤러 구조) · 본문만 스크롤 · 하단 버튼 고정(safe-area).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Check, Copy, ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import FinalReportMagazine from './FinalReportMagazine';
import { CONFLICT_REASONS, frFailText, postFinalReportAction } from './finalReportClientApi';
import { copyText } from '../spotlight/spotlightClientApi';
import {
  EMPTY_CONTENT, contentIssueText, type ContentIssue, type FinalReportContent, type FinalReportPublicPayload, type OperatorTag,
} from '@/lib/kdk/finalReport/finalReportModel';
import {
  FEATURED_STATE_TEXT, FR_LIMITS, STORY_STATE_TEXT, contentKey, reanchorEditor, reconcileEditor, removeFeatured, removeStory,
  setOperatorTag, setReview, setStory, storyText, toggleFeatured, type EditorData, type EditorMatch,
} from '@/lib/kdk/finalReport/finalReportEditor';
import { FRV, formatDiff, groupLabel, matchMeta, tagList } from '@/lib/kdk/finalReport/finalReportView';
import { finalReportPublicPath, finalReportPublicUrl, officialResultPath } from '@/lib/kdk/finalReportPublicService';

const LINE = '#E1E7EE';
const STEPS = ['공식 기록', 'TOP3 스토리', '주요 경기', '미리보기 · 발행'] as const;
type Busy = null | 'load' | 'save' | 'preview' | 'publish' | 'unpublish';
type Notice = { tone: 'ok' | 'warn' | 'error'; text: string } | null;

export default function FinalReportEditor({ sessionId, onClose, onChanged }: { sessionId: string; onClose: () => void; onChanged?: () => void }) {
  useBodyScrollLock(true);
  const [data, setData] = useState<EditorData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [content, setContent] = useState<FinalReportContent>(EMPTY_CONTENT);
  const [savedKey, setSavedKey] = useState<string>(contentKey(EMPTY_CONTENT));
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<Busy>('load');
  const [notice, setNotice] = useState<Notice>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [backup, setBackup] = useState<FinalReportContent | null>(null);
  const [preview, setPreview] = useState<{ key: string; payload: FinalReportPublicPayload } | null>(null);
  const [issues, setIssues] = useState<ContentIssue[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [limitNote, setLimitNote] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const key = contentKey(content);
  const dirty = !!data && key !== savedKey;
  const rec = useMemo(() => (data ? reconcileEditor(content, data) : null), [content, data]);

  const load = useCallback(async (opts: { keepNotice?: boolean } = {}) => {
    setBusy('load');
    const r = await postFinalReportAction({ action: 'load', sessionId });
    setBusy(null);
    if (!r.ok) { setLoadError(frFailText(r.j)); return null; }
    const d = r.j.data as EditorData;
    setData(d); setLoadError(null); setContent(d.content); setSavedKey(contentKey(d.content));
    setPreview(null); setIssues([]); setConfirmed(false); setConflict(null);
    if (!opts.keepNotice) setNotice(d.contentReset ? { tone: 'warn', text: '저장된 문구 형식이 맞지 않아 빈 문구로 시작합니다.' } : null);
    return d;
  }, [sessionId]);
  useEffect(() => { void load(); }, [load]);

  const scrollTop = () => { try { bodyRef.current?.scrollTo({ top: 0 }); } catch { /* 무시 */ } };
  const goStep = (n: number) => { setStep(n); setNotice((x) => (x?.tone === 'ok' ? null : x)); scrollTop(); };

  const handleFail = (j: any) => {
    const reason = String(j?.reason || '');
    if (CONFLICT_REASONS.has(reason)) setConflict(reason);
    if (reason === 'invalid_text' && Array.isArray(j?.issues)) setIssues(j.issues);
    setNotice({ tone: 'error', text: frFailText(j) });
  };

  const save = async () => {
    if (!data) return;
    setBusy('save'); setNotice(null);
    const r = await postFinalReportAction({ action: 'save', sessionId, content, expectedUpdatedAt: data.report?.updatedAt ?? null });
    setBusy(null);
    if (!r.ok) { handleFail(r.j); return; }
    setData({ ...data, report: { status: r.j.status, publicSlug: r.j.publicSlug, revision: r.j.revision, updatedAt: r.j.updatedAt, publishedAt: data.report?.publishedAt ?? null, stale: data.report?.stale ?? false } });
    setSavedKey(key);
    setNotice({ tone: 'ok', text: data.report?.status === 'published' ? '초안을 저장했습니다. 공개 화면은 재발행 전까지 그대로입니다.' : '초안을 저장했습니다.' });
  };

  const runPreview = useCallback(async () => {
    setBusy('preview'); setIssues([]); setConfirmed(false);
    const r = await postFinalReportAction({ action: 'preview', sessionId, content });
    setBusy(null);
    if (!r.ok) { setPreview(null); handleFail(r.j); return; }
    setPreview({ key: contentKey(content), payload: r.j.payload as FinalReportPublicPayload });
    setNotice((x) => (x?.tone === 'ok' ? x : null)); // 발행 · 저장 완료 안내는 유지
  }, [content, sessionId]);
  // STEP 4 진입 · 다시 불러온 뒤(발행 · 충돌 해소) 미리보기가 없거나 문구가 바뀌었으면 서버 미리보기를 다시 만든다.
  useEffect(() => { if (step === 3 && data && (!preview || preview.key !== key) && busy === null) void runPreview(); }, [step, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const publish = async () => {
    if (!data || !preview || preview.key !== key || !confirmed) return;
    setBusy('publish'); setNotice(null);
    const r = await postFinalReportAction({
      action: 'publish', sessionId, content, confirm: true,
      expectedUpdatedAt: data.report?.updatedAt ?? null, expectedRevision: data.report?.revision ?? 0, baseSignature: data.signature,
    });
    setBusy(null);
    if (!r.ok) { handleFail(r.j); return; }
    await load({ keepNotice: true });
    setStep(3);
    setNotice({ tone: 'ok', text: `발행했습니다(${r.j.revision}판). 아래 링크로 공유할 수 있습니다.` });
    onChanged?.();
  };

  const unpublish = async () => {
    if (!data?.report || data.report.status !== 'published') return;
    if (!window.confirm('공개를 중단할까요? 링크로 들어온 사람에게는 "공개된 리포트가 없습니다"가 표시됩니다.')) return;
    setBusy('unpublish');
    const r = await postFinalReportAction({ action: 'unpublish', sessionId });
    setBusy(null);
    if (!r.ok) { handleFail(r.j); return; }
    await load({ keepNotice: true });
    setNotice({ tone: 'ok', text: '비공개로 전환했습니다. 같은 링크로 다시 발행할 수 있습니다.' });
    onChanged?.();
  };

  const reloadForConflict = async () => {
    setBackup(content);
    const d = await load();
    if (d) setNotice({ tone: 'warn', text: '최신 상태를 불러왔습니다. 내가 쓴 문구는 보관해 두었습니다.' });
  };
  const applyBackup = () => {
    if (!backup || !data) return;
    setContent(backup); setBackup(null); goStep(0);
    setNotice({ tone: 'warn', text: '보관한 문구를 다시 적용했습니다. 연결 상태를 확인한 뒤 저장해 주세요.' });
  };

  const close = () => {
    if (busy === 'save' || busy === 'publish' || busy === 'unpublish') return;
    if (dirty && !window.confirm('저장하지 않은 문구가 있습니다. 닫을까요?')) return;
    onClose();
  };

  const report = data?.report ?? null;
  const published = report?.status === 'published';
  const canPublish = !!data && !!preview && preview.key === key && confirmed && busy === null && !rec?.needsReview && !conflict;

  // ── 껍데기 ────────────────────────────────────────────────────────────────────
  return (
    <div role="dialog" aria-modal="true" aria-label="FINAL REPORT 작성" data-fr-editor
      onClick={close}
      style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(6,17,31,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, height: 'min(94dvh, 900px)', maxHeight: '94vh', display: 'flex', flexDirection: 'column', background: '#F7F9FB', borderRadius: '20px 20px 0 0', overflow: 'hidden', boxShadow: '0 -10px 40px rgba(6,17,31,0.25)' }}>
        {/* 머리 */}
        <div style={{ flexShrink: 0, background: FRV.navy, color: FRV.onNavy, padding: '12px 14px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 10.5, fontWeight: 900, letterSpacing: '0.2em', color: FRV.goldSoft }}>KDK FINAL REPORT</p>
              <p data-fr-ed="title" style={{ margin: '2px 0 0', fontSize: 14.5, fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {data ? `${data.session.title || '공식 KDK'}${data.session.date ? ` · ${data.session.date}` : ''}` : '불러오는 중'}
              </p>
            </div>
            <StatusChip report={report} />
            <button type="button" aria-label="닫기" onClick={close}
              style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 999, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: FRV.onNavy, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>
          <ol aria-label="단계" style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4 }}>
            {STEPS.map((s, i) => (
              <li key={s}>
                <button type="button" data-fr-step={i} disabled={!data || busy !== null} onClick={() => goStep(i)} aria-current={step === i ? 'step' : undefined}
                  style={{ width: '100%', padding: '6px 2px 4px', border: 'none', background: 'transparent', color: step === i ? '#FFFFFF' : FRV.onNavySub, cursor: data ? 'pointer' : 'default', textAlign: 'center' }}>
                  <span style={{ display: 'block', height: 3, borderRadius: 2, background: i <= step ? FRV.goldSoft : 'rgba(255,255,255,0.18)' }} />
                  <span style={{ display: 'block', marginTop: 5, fontSize: 10.5, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i + 1}. {s}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        {/* 본문 — 여기만 스크롤 */}
        <div ref={bodyRef} data-fr-ed="body" style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', padding: '14px 14px 20px' }}>
          {notice && <NoticeBar notice={notice} />}
          {conflict && (
            <div data-fr-ed="conflict" style={{ ...card, borderColor: '#F0DCC0', background: '#FFF8F0', marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#7A521E', wordBreak: 'keep-all' }}>저장 · 발행이 겹쳤거나 공식 기록이 바뀌었습니다. 덮어쓰지 않았습니다.</p>
              <button type="button" data-fr-ed="reload" onClick={reloadForConflict} disabled={busy !== null} style={{ ...btn('primary'), marginTop: 10, width: '100%' }}>
                <RefreshCw size={14} /> 최신 상태 다시 불러오기(내 문구 보관)
              </button>
            </div>
          )}
          {backup && !conflict && (
            <div style={{ ...card, marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: FRV.sub }}>보관한 내 문구가 있습니다.</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" data-fr-ed="apply-backup" onClick={applyBackup} style={{ ...btn('secondary'), flex: 1 }}>내 문구 다시 적용</button>
                <button type="button" onClick={() => setBackup(null)} style={{ ...btn('ghost'), flex: 1 }}>버리기</button>
              </div>
            </div>
          )}

          {!data && (
            <div data-fr-ed="loading" style={{ ...card, textAlign: 'center', padding: '28px 16px' }}>
              {loadError ? (
                <>
                  <p data-fr-ed="load-error" style={{ margin: 0, fontSize: 14, fontWeight: 800, color: FRV.ink, wordBreak: 'keep-all' }}>{loadError}</p>
                  <button type="button" data-fr-ed="retry" onClick={() => { setLoadError(null); void load(); }} style={{ ...btn('secondary'), marginTop: 14 }}><RefreshCw size={14} /> 다시 시도</button>
                </>
              ) : <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: FRV.muted }}>공식 기록을 불러오는 중…</p>}
            </div>
          )}

          {data && step === 0 && <StepRecord data={data} content={content} setContent={setContent} rec={rec} published={published} onUnpublish={unpublish} busy={busy} copied={copied} onCopy={async () => { if (report && await copyText(finalReportPublicUrl(report.publicSlug))) { setCopied(true); setTimeout(() => setCopied(false), 1800); } }} />}
          {data && step === 1 && <StepStories data={data} content={content} setContent={setContent} issues={issues} />}
          {data && step === 2 && <StepMatches data={data} content={content} setContent={(c) => { setContent(c); }} limitNote={limitNote} setLimitNote={setLimitNote} issues={issues} />}
          {data && step === 3 && (
            <StepPreview data={data} preview={preview && preview.key === key ? preview.payload : null} busy={busy} issues={issues} needsReview={!!rec?.needsReview}
              onRetry={runPreview} confirmed={confirmed} setConfirmed={setConfirmed} goStep={goStep}
              published={published} report={report} copied={copied}
              onCopy={async () => { if (report && await copyText(finalReportPublicUrl(report.publicSlug))) { setCopied(true); setTimeout(() => setCopied(false), 1800); } }}
              onUnpublish={unpublish} />
          )}
        </div>

        {/* 바닥 버튼 — 키보드가 올라와도 본문 아래에 고정 */}
        {data && (
          <div style={{ flexShrink: 0, display: 'flex', gap: 6, padding: '10px 12px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))', borderTop: `1px solid ${LINE}`, background: '#FFFFFF' }}>
            <button type="button" data-fr-ed="prev" onClick={() => goStep(step - 1)} disabled={step === 0 || busy !== null} style={{ ...btn('ghost', step === 0 || busy !== null), flex: '0 0 auto', minWidth: 64 }}>이전</button>
            <button type="button" data-fr-ed="save" onClick={save} disabled={!dirty || busy !== null || !!conflict} style={{ ...btn('secondary', !dirty || busy !== null || !!conflict), flex: 1 }}>
              {busy === 'save' ? '저장 중…' : dirty ? '초안 저장' : '저장됨'}
            </button>
            {step < 3 ? (
              <button type="button" data-fr-ed="next" onClick={() => goStep(step + 1)} disabled={busy !== null} style={{ ...btn('primary', busy !== null), flex: 1 }}>다음</button>
            ) : (
              <button type="button" data-fr-ed="publish" onClick={publish} disabled={!canPublish} style={{ ...btn('gold', !canPublish), flex: 1.3 }}>
                {busy === 'publish' ? '발행 중…' : report && report.revision > 0 ? '재발행' : '발행하기'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── STEP 1 — 공식 기록 확인 ────────────────────────────────────────────────────────
function StepRecord({ data, content, setContent, rec, published, onUnpublish, busy, copied, onCopy }: {
  data: EditorData; content: FinalReportContent; setContent: (c: FinalReportContent) => void; rec: ReturnType<typeof reconcileEditor> | null;
  published: boolean; onUnpublish: () => void; busy: Busy; copied: boolean; onCopy: () => void;
}) {
  const report = data.report;
  const flagged = rec ? [...rec.stories.filter((s) => s.state !== 'ok'), ...rec.featured.filter((f) => f.state !== 'ok')] : [];
  const [reNote, setReNote] = useState<string | null>(null);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {report?.stale && (
        <div data-fr-ed="stale" style={{ ...card, borderColor: '#F0DCC0', background: '#FFF8F0' }}>
          <p style={{ margin: 0, display: 'flex', gap: 6, fontSize: 13, fontWeight: 900, color: '#7A521E' }}><AlertTriangle size={16} style={{ flexShrink: 0 }} />공식 기록이 정정되었습니다</p>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 600, color: '#7A521E', lineHeight: 1.55, wordBreak: 'keep-all' }}>공개 화면에는 예전 수치 대신 정정 안내가 표시되고 있습니다. 문구를 확인한 뒤 재발행해 주세요.</p>
        </div>
      )}
      {rec?.needsReview && (
        <div data-fr-ed="review-needed" style={{ ...card, borderColor: '#EDD9A8', background: '#FBF3DF' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#6B5215' }}>다시 확인할 문구 {flagged.length}개</p>
          <p style={{ margin: '4px 0 8px', fontSize: 12, fontWeight: 600, color: '#6B5215', lineHeight: 1.5, wordBreak: 'keep-all' }}>공식 기록이 바뀌어 문구 연결을 확인해야 합니다. 확인 전에는 발행할 수 없습니다. 문구는 자동으로 지우지 않습니다.</p>
          <div style={{ display: 'grid', gap: 8 }}>
            {rec.stories.filter((s) => s.state !== 'ok').map((s) => (
              <FlagItem key={`s-${s.playerKey}`} title={`${s.savedRank}위 스토리 → ${s.name ?? '알 수 없는 선수'}${s.currentRank ? ` (현재 ${s.currentRank}위)` : ''}`}
                state={STORY_STATE_TEXT[s.state]} text={storyText(content, s.playerKey)} onRemove={() => setContent(removeStory(content, s.playerKey))} />
            ))}
            {rec.featured.filter((f) => f.state !== 'ok').map((f) => {
              const m = data.matches.find((x) => x.matchId === f.matchId);
              return (
                <FlagItem key={`f-${f.matchId}`} title={m ? `주요 경기 · ${matchMeta(m)}` : '주요 경기'} state={FEATURED_STATE_TEXT[f.state]}
                  text={content.featured?.find((x) => x.matchId === f.matchId)?.review ?? ''} onRemove={() => setContent(removeFeatured(content, f.matchId))} />
              );
            })}
          </div>
          <button type="button" data-fr-ed="reanchor" onClick={() => {
            const r = reanchorEditor(content, data);
            setContent(r.content);
            setReNote(r.blocked ? `다시 연결할 수 없는 항목 ${r.blocked}개는 "빼기"로 정리해 주세요.` : '현재 공식 기록에 다시 연결했습니다. STEP 2 · 3에서 문구 내용이 기록과 맞는지 확인해 주세요.');
          }} style={{ ...btn('primary'), marginTop: 10, width: '100%' }}>확인했습니다 — 현재 기록에 다시 연결</button>
          {reNote && <p style={{ margin: '8px 0 0', fontSize: 12, fontWeight: 700, color: '#6B5215', wordBreak: 'keep-all' }}>{reNote}</p>}
        </div>
      )}
      {!rec?.needsReview && reNote && <NoticeBar notice={{ tone: 'ok', text: reNote }} />}

      {report && report.publicSlug && (report.status === 'published' || report.status === 'unpublished') && (
        <PublishCard report={report} published={published} copied={copied} onCopy={onCopy} onUnpublish={onUnpublish} busy={busy} />
      )}

      <section style={card}>
        <p style={sectionLabel}>공식 기록</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <Pill>참가 {data.session.participantCount}명</Pill>
          <Pill>완료 경기 {data.session.matchCount}</Pill>
          <Pill tone="ok">공식 확정</Pill>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 12, fontWeight: 600, color: FRV.muted, lineHeight: 1.55, wordBreak: 'keep-all' }}>
          순위 · 승패 · 점수는 공식 Archive에 저장된 그대로 사용합니다(동률은 승수 → 득실 → 연장자 순으로 확정된 순서). 리포트에서 바꾸거나 다시 계산하지 않습니다.
        </p>
      </section>

      <section style={card}>
        <p style={sectionLabel}>공식 순위</p>
        <ol data-fr-ed="standings" style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
          {data.standings.map((s) => (
            <li key={s.key} style={{ display: 'grid', gridTemplateColumns: '26px minmax(0,1fr) auto', gap: 8, alignItems: 'center', padding: '7px 0', borderTop: s.rank === 1 ? 'none' : `1px solid ${FRV.lineSoft}` }}>
              <span style={{ fontWeight: 900, fontSize: 14, textAlign: 'center', color: s.rank <= 3 ? FRV.goldInk : FRV.sub }}>{s.rank}</span>
              <span style={{ fontSize: 13.5, fontWeight: s.rank <= 3 ? 900 : 700, color: FRV.ink, overflowWrap: 'anywhere', wordBreak: 'keep-all' }}>{s.name}{s.group ? <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: FRV.muted }}>{groupLabel(s.group)}</span> : null}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: FRV.sub, whiteSpace: 'nowrap' }}>{s.wins}-{s.losses} · {formatDiff(s.diff)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function FlagItem({ title, state, text, onRemove }: { title: string; state: string; text: string; onRemove: () => void }) {
  return (
    <div data-fr-ed="flag" style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #EDD9A8', padding: '9px 10px' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: FRV.ink, overflowWrap: 'anywhere', wordBreak: 'keep-all' }}>{title}</p>
          <p style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 800, color: '#9A6B12' }}>{state}</p>
        </div>
        <button type="button" data-fr-ed="flag-remove" onClick={onRemove} style={{ ...btn('ghost'), minHeight: 34, padding: '0 10px', fontSize: 12 }}>빼기</button>
      </div>
      {text && <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 600, color: FRV.sub, lineHeight: 1.5, overflowWrap: 'anywhere' }}>“{text}”</p>}
    </div>
  );
}

// ── STEP 2 — TOP3 스토리 · 오프닝 · 마무리 ────────────────────────────────────────────
function StepStories({ data, content, setContent, issues }: { data: EditorData; content: FinalReportContent; setContent: (c: FinalReportContent) => void; issues: ContentIssue[] }) {
  const top3 = data.standings.slice(0, 3);
  const LABEL = ['CHAMPION', 'RUNNER-UP', 'THIRD PLACE'];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Hint>비워 두면 해당 자리는 표시되지 않고 공식 기록만 공개됩니다. 기록으로 확인되지 않는 내용은 쓰지 말아 주세요.</Hint>
      <TextField id="opening" label="오프닝" max={FR_LIMITS.opening} value={content.opening} placeholder="예) 열두 명이 세 라운드를 치른 11월 정모입니다."
        onChange={(v) => setContent({ ...content, opening: v })} issues={issues.filter((x) => x.field === 'opening')} />
      {top3.map((s, i) => (
        <section key={s.key} style={card} data-fr-ed={`story-${s.rank}`}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '0.16em', color: FRV.goldInk }}>{LABEL[i]}</span>
            <span style={{ fontSize: 15, fontWeight: 900, color: FRV.ink, overflowWrap: 'anywhere', wordBreak: 'keep-all' }}>{s.rank}위 {s.name}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: FRV.muted, whiteSpace: 'nowrap' }}>{s.wins}승 {s.losses}패 · {formatDiff(s.diff)}</span>
          </div>
          <TextField id={`story-${s.rank}`} label={`${s.rank}위 스토리`} hideLabel max={FR_LIMITS.story} value={storyText(content, s.key)} placeholder="공식 기록에 근거한 한두 문장"
            onChange={(v) => setContent(setStory(content, s, v))} issues={issues.filter((x) => x.field === `stories.${s.rank}`)} plain />
        </section>
      ))}
      <TextField id="closing" label="마무리" max={FR_LIMITS.closing} value={content.closing} placeholder="예) 다음 정모에서 만나요."
        onChange={(v) => setContent({ ...content, closing: v })} issues={issues.filter((x) => x.field === 'closing')} />
    </div>
  );
}

// ── STEP 3 — 주요 경기 선택 · 리뷰 ─────────────────────────────────────────────────
function StepMatches({ data, content, setContent, limitNote, setLimitNote, issues }: {
  data: EditorData; content: FinalReportContent; setContent: (c: FinalReportContent) => void; limitNote: boolean; setLimitNote: (b: boolean) => void; issues: ContentIssue[];
}) {
  const auto = content.featured == null;
  const selected = auto ? data.recommended : content.featured!.map((f) => f.matchId);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div role="radiogroup" aria-label="주요 경기 선택 방식" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button type="button" role="radio" aria-checked={auto} data-fr-ed="mode-auto" onClick={() => { setContent({ ...content, featured: null }); setLimitNote(false); }} style={{ ...btn(auto ? 'primary' : 'ghost'), minHeight: 40, fontSize: 12.5 }}>기록 기준 자동 추천</button>
        <button type="button" role="radio" aria-checked={!auto} data-fr-ed="mode-manual" onClick={() => { if (auto) setContent({ ...content, featured: data.recommended.map((id) => ({ matchId: id, fingerprint: data.matches.find((m) => m.matchId === id)?.fingerprint ?? '', review: '', tag: null })) }); }} style={{ ...btn(!auto ? 'primary' : 'ghost'), minHeight: 40, fontSize: 12.5 }}>직접 선택 · 리뷰</button>
      </div>
      <Hint>
        {auto
          ? `점수 기록으로 고른 ${data.recommended.length}경기(접전 · 완봉)가 리뷰 없이 표시됩니다. 경기를 누르면 직접 선택으로 바뀝니다.`
          : `선택 ${selected.length}/${FR_LIMITS.featured} · 선택하지 않으면 주요 경기 챕터 없이 발행됩니다.`}
      </Hint>
      {limitNote && <NoticeBar notice={{ tone: 'warn', text: `주요 경기는 최대 ${FR_LIMITS.featured}개입니다. 다른 경기를 먼저 빼 주세요.` }} />}
      {data.matches.map((m) => {
        const on = selected.includes(m.matchId);
        const f = content.featured?.find((x) => x.matchId === m.matchId);
        return (
          <section key={m.matchId} data-fr-ed="match" data-selected={on ? '1' : '0'} style={{ ...card, padding: 0, borderColor: on ? FRV.gold : LINE, overflow: 'hidden' }}>
            <button type="button" aria-pressed={on} data-fr-ed="match-toggle" onClick={() => { const r = toggleFeatured(content, data, m.matchId); setContent(r.content); setLimitNote(r.limited); }}
              style={{ display: 'flex', width: '100%', gap: 10, alignItems: 'flex-start', padding: '11px 12px', border: 'none', background: on ? FRV.goldWash : '#FFFFFF', textAlign: 'left', cursor: 'pointer' }}>
              <span aria-hidden style={{ flexShrink: 0, marginTop: 2, width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${on ? FRV.gold : '#B8C4D0'}`, background: on ? FRV.gold : '#FFFFFF', display: 'grid', placeItems: 'center' }}>{on && <Check size={13} color="#FFFFFF" />}</span>
              <MatchSummary m={m} recommended={auto && data.recommended.includes(m.matchId)} />
            </button>
            {on && f && (
              <div style={{ padding: '0 12px 12px', background: FRV.goldWash }}>
                <div role="radiogroup" aria-label="운영진 태그" style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                  {([null, 'MATCH_OF_THE_DAY', 'OPERATORS_PICK'] as Array<OperatorTag | null>).map((t) => (
                    <button key={t ?? 'none'} type="button" role="radio" aria-checked={f.tag === t} data-fr-ed={`tag-${t ?? 'none'}`} onClick={() => setContent(setOperatorTag(content, m.matchId, t))}
                      style={{ minHeight: 32, padding: '0 10px', borderRadius: 999, fontSize: 11, fontWeight: 900, cursor: 'pointer', border: `1px solid ${f.tag === t ? FRV.navy : LINE}`, background: f.tag === t ? FRV.navy : '#FFFFFF', color: f.tag === t ? '#FFFFFF' : FRV.sub }}>
                      {t === null ? '태그 없음' : t === 'MATCH_OF_THE_DAY' ? 'MATCH OF THE DAY' : "OPERATOR'S PICK"}
                    </button>
                  ))}
                </div>
                <TextField id={`review-${m.matchId}`} label="경기 리뷰" max={FR_LIMITS.review} value={f.review} placeholder="점수 · 선수 기록에 근거한 리뷰(선택)"
                  onChange={(v) => setContent(setReview(content, m.matchId, v))} issues={issues.filter((x) => x.field === `featured.${m.matchId}`)} plain />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MatchSummary({ m, recommended }: { m: EditorMatch; recommended: boolean }) {
  const tags = tagList(m.tags);
  const winA = m.score1 > m.score2; const winB = m.score2 > m.score1;
  return (
    <span style={{ minWidth: 0, flex: 1, display: 'block' }}>
      <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: FRV.muted, letterSpacing: '0.06em' }}>{matchMeta(m)}</span>
        {recommended && <span style={{ fontSize: 10, fontWeight: 900, color: FRV.goldInk }}>추천</span>}
        {tags.map((t) => <span key={t.key} style={{ fontSize: 10, fontWeight: 900, color: FRV.teal }}>{t.label}</span>)}
      </span>
      <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '2px 8px', marginTop: 5, alignItems: 'center' }}>
        <span style={{ fontSize: 13.5, fontWeight: winA ? 900 : 700, color: winA ? FRV.ink : FRV.sub, overflowWrap: 'anywhere', wordBreak: 'keep-all' }}>{m.teamA.join(' · ')}</span>
        <span style={{ fontSize: 18, fontWeight: 900, color: winA ? FRV.ink : FRV.muted, textAlign: 'right' }}>{m.score1}</span>
        <span style={{ fontSize: 13.5, fontWeight: winB ? 900 : 700, color: winB ? FRV.ink : FRV.sub, overflowWrap: 'anywhere', wordBreak: 'keep-all' }}>{m.teamB.join(' · ')}</span>
        <span style={{ fontSize: 18, fontWeight: 900, color: winB ? FRV.ink : FRV.muted, textAlign: 'right' }}>{m.score2}</span>
      </span>
    </span>
  );
}

// ── STEP 4 — 미리보기 · 발행 ──────────────────────────────────────────────────────
function StepPreview({ data, preview, busy, issues, needsReview, onRetry, confirmed, setConfirmed, goStep, published, report, copied, onCopy, onUnpublish }: {
  data: EditorData; preview: FinalReportPublicPayload | null; busy: Busy; issues: ContentIssue[]; needsReview: boolean; onRetry: () => void;
  confirmed: boolean; setConfirmed: (b: boolean) => void; goStep: (n: number) => void;
  published: boolean; report: EditorData['report']; copied: boolean; onCopy: () => void; onUnpublish: () => void;
}) {
  const stepOf = (field: string) => (field.startsWith('featured') ? 2 : 1);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {report && report.publicSlug && (report.status === 'published' || report.status === 'unpublished') && (
        <PublishCard report={report} published={published} copied={copied} onCopy={onCopy} onUnpublish={onUnpublish} busy={busy} />
      )}
      {needsReview && (
        <div style={{ ...card, borderColor: '#EDD9A8', background: '#FBF3DF' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#6B5215', wordBreak: 'keep-all' }}>다시 확인할 문구가 있어 발행할 수 없습니다.</p>
          <button type="button" onClick={() => goStep(0)} style={{ ...btn('secondary'), marginTop: 8 }}>STEP 1에서 확인</button>
        </div>
      )}
      {issues.length > 0 && (
        <div data-fr-ed="issues" style={{ ...card, borderColor: '#F0DCC0', background: '#FFF8F0' }}>
          {issues.map((x, i) => (
            <p key={i} style={{ margin: i ? '6px 0 0' : 0, fontSize: 12.5, fontWeight: 700, color: '#7A521E', wordBreak: 'keep-all' }}>
              {fieldLabel(x.field, data)} — {contentIssueText(x)}{' '}
              <button type="button" onClick={() => goStep(stepOf(x.field))} style={{ border: 'none', background: 'none', padding: 0, color: FRV.navy, fontWeight: 900, textDecoration: 'underline', cursor: 'pointer' }}>고치기</button>
            </p>
          ))}
        </div>
      )}
      {busy === 'preview' && <div style={{ ...card, textAlign: 'center', fontSize: 13, fontWeight: 700, color: FRV.muted }}>서버에서 공개 화면을 만드는 중…</div>}
      {!preview && busy !== 'preview' && (
        <button type="button" data-fr-ed="preview-retry" onClick={onRetry} style={{ ...btn('secondary') }}><RefreshCw size={14} /> 미리보기 다시 만들기</button>
      )}
      {preview && (
        <>
          <p style={{ ...sectionLabel, margin: 0 }}>모바일 미리보기 — 실제 공개 화면과 같은 데이터 · 같은 화면</p>
          <div data-fr-ed="preview" style={{ borderRadius: 18, overflow: 'hidden', border: `1px solid ${LINE}`, boxShadow: '0 8px 24px rgba(18,35,58,0.10)', background: FRV.bg }}>
            <FinalReportMagazine payload={preview} officialHref={officialResultPath(data.session.id)} />
          </div>
          <label data-fr-ed="confirm" style={{ ...card, display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0, accentColor: FRV.navy }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: FRV.ink, lineHeight: 1.5, wordBreak: 'keep-all' }}>
              공식 기록과 문구를 확인했습니다. 이 내용으로 {report && report.revision > 0 ? '재발행' : '공개'}합니다.
              <span style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: FRV.muted }}>링크를 받은 누구나 볼 수 있습니다(검색 노출 없음).</span>
            </span>
          </label>
        </>
      )}
    </div>
  );
}

function PublishCard({ report, published, copied, onCopy, onUnpublish, busy }: { report: NonNullable<EditorData['report']>; published: boolean; copied: boolean; onCopy: () => void; onUnpublish: () => void; busy: Busy }) {
  const url = finalReportPublicUrl(report.publicSlug);
  return (
    <section data-fr-ed="publish-card" style={{ ...card, borderColor: published ? 'rgba(14,143,132,0.35)' : LINE, background: published ? '#F2FAF8' : '#FFFFFF' }}>
      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: published ? FRV.teal : FRV.sub }}>
        {published ? `공개 중 · ${report.revision}판${report.stale ? ' · 정정 안내 표시 중' : ''}` : `비공개 · 마지막 ${report.revision}판`}
      </p>
      <p data-fr-ed="url" style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 700, color: FRV.ink, overflowWrap: 'anywhere', fontFamily: 'ui-monospace, monospace' }}>{url}</p>
      {published && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
          <button type="button" data-fr-ed="copy" onClick={onCopy} style={{ ...btn('primary') }}>{copied ? <><Check size={14} /> 복사됨</> : <><Copy size={14} /> 링크 복사</>}</button>
          <a href={finalReportPublicPath(report.publicSlug)} target="_blank" rel="noopener noreferrer" style={{ ...btn('secondary'), textDecoration: 'none' }}><ExternalLink size={14} /> 공개 화면</a>
          <button type="button" data-fr-ed="unpublish" onClick={onUnpublish} disabled={busy !== null} style={{ ...btn('ghost'), gridColumn: '1 / -1' }}>{busy === 'unpublish' ? '처리 중…' : '비공개로 전환'}</button>
        </div>
      )}
    </section>
  );
}

// ── 공통 조각 ─────────────────────────────────────────────────────────────────
function TextField({ id, label, max, value, onChange, placeholder, issues, hideLabel, plain }: {
  id: string; label: string; max: number; value: string; onChange: (v: string) => void; placeholder?: string; issues: ContentIssue[]; hideLabel?: boolean; plain?: boolean;
}) {
  const len = [...value].length;
  const html = /[<>]/.test(value);
  const inner = (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, marginTop: hideLabel ? 8 : 0 }}>
        {hideLabel ? <span /> : <label htmlFor={`fr-${id}`} style={{ fontSize: 13, fontWeight: 900, color: FRV.ink }}>{label}</label>}
        <span data-fr-ed={`count-${id}`} style={{ fontSize: 11.5, fontWeight: 800, color: len >= max ? '#B45309' : FRV.muted }}>{len}/{max}</span>
      </div>
      <textarea id={`fr-${id}`} data-fr-ed={`input-${id}`} aria-label={hideLabel ? label : undefined} value={value} maxLength={max} rows={2} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.slice(0, max))}
        onFocus={(e) => { const el = e.currentTarget; setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* 무시 */ } }, 280); }}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 64, padding: '10px 12px', borderRadius: 12, border: `1px solid ${html || issues.length ? '#E3A857' : LINE}`, background: '#FFFFFF', color: FRV.ink, fontSize: 16, lineHeight: 1.5, fontFamily: 'inherit' }} />
      {html && <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 700, color: '#B45309' }}>꺾쇠(&lt; &gt;)는 쓸 수 없습니다.</p>}
      {issues.map((x, i) => <p key={i} style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 700, color: '#B45309', wordBreak: 'keep-all' }}>{contentIssueText(x)}</p>)}
    </>
  );
  return plain ? <div>{inner}</div> : <section style={card}>{inner}</section>;
}

function fieldLabel(field: string, data: EditorData): string {
  if (field === 'opening') return '오프닝';
  if (field === 'closing') return '마무리';
  if (field.startsWith('stories.')) return `${field.slice(8)}위 스토리`;
  if (field.startsWith('featured.')) { const m = data.matches.find((x) => x.matchId === field.slice(9)); return m ? `리뷰(${matchMeta(m)})` : '경기 리뷰'; }
  return field;
}

function StatusChip({ report }: { report: EditorData['report'] }) {
  const t = !report ? '미작성' : report.status === 'published' ? (report.stale ? '정정 필요' : '공개 중') : report.status === 'unpublished' ? '비공개' : '초안';
  return <span data-fr-ed="status" style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 900, padding: '4px 8px', borderRadius: 999, color: FRV.navyDeep, background: report?.status === 'published' && !report.stale ? FRV.goldSoft : 'rgba(255,255,255,0.75)' }}>{t}</span>;
}
function NoticeBar({ notice }: { notice: NonNullable<Notice> }) {
  const c = notice.tone === 'ok' ? { bg: '#E6F4F2', bd: 'rgba(14,143,132,0.3)', fg: '#0B6B63' } : notice.tone === 'warn' ? { bg: '#FBF3DF', bd: '#EDD9A8', fg: '#6B5215' } : { bg: '#FFF8F0', bd: '#F0DCC0', fg: '#7A521E' };
  return <div role="status" data-fr-ed={`notice-${notice.tone}`} style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 12, background: c.bg, border: `1px solid ${c.bd}`, color: c.fg, fontSize: 12.5, fontWeight: 800, lineHeight: 1.5, wordBreak: 'keep-all' }}>{notice.text}</div>;
}
function Hint({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: FRV.muted, lineHeight: 1.55, wordBreak: 'keep-all' }}>{children}</p>;
}
function Pill({ children, tone }: { children: React.ReactNode; tone?: 'ok' }) {
  return <span style={{ fontSize: 11.5, fontWeight: 800, padding: '4px 9px', borderRadius: 999, background: tone === 'ok' ? '#E0F5EB' : '#EEF3F8', color: tone === 'ok' ? '#16A085' : FRV.sub }}>{children}</span>;
}
const card: React.CSSProperties = { background: '#FFFFFF', border: `1px solid ${LINE}`, borderRadius: 14, padding: '12px 12px' };
const sectionLabel: React.CSSProperties = { margin: 0, fontSize: 11, fontWeight: 900, letterSpacing: '0.12em', color: FRV.muted };
function btn(kind: 'primary' | 'secondary' | 'ghost' | 'gold', disabled = false): React.CSSProperties {
  const k = {
    primary: { background: FRV.navy, color: '#FFFFFF', border: `1px solid ${FRV.navy}` },
    secondary: { background: '#FFFFFF', color: FRV.navy, border: `1px solid ${FRV.navy}` },
    ghost: { background: '#FFFFFF', color: FRV.sub, border: `1px solid ${LINE}` },
    gold: { background: FRV.goldSoft, color: FRV.navyDeep, border: `1px solid ${FRV.gold}` },
  }[kind];
  return { ...k, minHeight: 44, padding: '0 12px', borderRadius: 12, fontSize: 13.5, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: disabled ? 0.45 : 1 };
}
