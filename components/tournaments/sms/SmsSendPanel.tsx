'use client';

// 문자 안내 센터 — 발송 준비(대상 선택 · 배치 · 번호 복사 · 수동 발송 기록).
//   ⚠ 복사는 발송이 아니다. '발송 완료'는 관리자가 확인 창에서 직접 누를 때만 기록한다.
//   ⚠ 기록에는 번호를 남기지 않는다(대상 수 · 배치 이름만).
//   ⚠ 특정 통신사 · 문자 앱의 수신자 수 제한을 가정하지 않는다 — 배치 크기는 운영자가 고른다.

import React from 'react';
import { CheckCircle2, ClipboardCheck, Copy, Search, Send } from 'lucide-react';
import {
  AUDIENCE_LABEL, BATCH_SIZES, DEFAULT_BATCH_SIZE, PARTICIPATION_LABEL, audienceGaps, audienceSummary, entryLabel, joinNumbers, kstDate,
  logClientKey, splitBatches,
  type AddressBook, type AudienceFilter, type AudienceMode, type Batch, type EffectiveTemplate, type NumberSeparator,
  type Participation, type RecipientResult,
} from '@/lib/tournaments/smsModel';
import { addSmsLog, setSmsLogStatus, smsErrorMessage } from '@/lib/tournaments/smsService';
import type { TemplateCheck } from './SmsTemplates';
import {
  AMBER, BODY, Chip, ConfirmDialog, FAINT, INK, LINE, LINE_SOFT, MUTED, Notice, SectionHead, TEAL, TEAL_DEEP, TEAL_SOFT,
  btn, btnDark, btnSmall, card, input,
} from './smsUi';

interface BatchMark { copied: boolean; logId: string | null; status: 'copied' | 'sent' | 'void' | null }

const STATUS_OPTIONS: Participation[] = ['confirmed', 'applied', 'waitlisted'];

export default function SmsSendPanel({
  slug, book, filter, setFilter, result, template, templateCheck, warnChanged, copyBlockedReason, onCopy, onCopyMessage, say, onLogged, canLog = true,
}: {
  slug: string;
  book: AddressBook;
  filter: AudienceFilter;
  setFilter: (f: AudienceFilter) => void;
  result: RecipientResult;
  template: EffectiveTemplate;
  templateCheck: TemplateCheck;
  /** 확정 후 원본 변경 · 미저장 제외 설정 안내(있으면 복사 전에 한 번 더 확인). */
  warnChanged: string | null;
  copyBlockedReason: string | null;
  onCopy: (text: string, label: string) => Promise<boolean>;
  onCopyMessage: () => void;
  say: (t: string, tone?: 'ok' | 'err') => void;
  onLogged: () => Promise<void>;
  /** 문자 센터 SQL 미적용이면 false — 번호 복사만 되고 기록은 남기지 않는다. */
  canLog?: boolean;
}) {
  const [size, setSize] = React.useState<number>(DEFAULT_BATCH_SIZE);
  const [customSize, setCustomSize] = React.useState('');
  const [sep, setSep] = React.useState<NumberSeparator>('comma');
  const [hyphen, setHyphen] = React.useState(true);
  const [marks, setMarks] = React.useState<Record<string, BatchMark>>({});
  const [ask, setAsk] = React.useState<null | { kind: 'copy' | 'sent' | 'resend'; batch: Batch }>(null);
  const [pickQ, setPickQ] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const effSize = customSize && Number(customSize) >= 1 ? Math.min(500, Math.floor(Number(customSize))) : size;
  const batches = React.useMemo(() => splitBatches(result.numbers, effSize), [result.numbers, effSize]);
  const allBatch: Batch = React.useMemo(() => ({ index: 0, total: 1, from: 1, to: result.numbers.length, numbers: result.numbers, label: `전체 (${result.numbers.length}명)` }), [result.numbers]);
  const audience = audienceSummary(filter);
  const markKey = (b: Batch) => `${template.key}|${audience}|${b.label}|${b.numbers.length}|${b.numbers[0] ?? ''}|${b.numbers[b.numbers.length - 1] ?? ''}`;

  // 대상 · 배치가 바뀌면 이전 '복사됨' 표시는 의미가 없다 — 지운다.
  React.useEffect(() => { setMarks({}); }, [result.numbers, effSize, template.key, audience]);

  const gaps = React.useMemo(() => audienceGaps(book, filter.statuses), [book, filter.statuses]);
  const teamNos = React.useMemo(() => [...new Set(book.entries.filter((e) => e.teamNo != null).map((e) => e.teamNo as number))].sort((a, b) => a - b), [book]);
  const setMode = (mode: AudienceMode) => setFilter({ ...filter, mode });
  const toggleStatus = (s: Participation) => {
    const has = filter.statuses.includes(s);
    const next = has ? filter.statuses.filter((x) => x !== s) : [...filter.statuses, s];
    setFilter({ ...filter, statuses: next.length ? next : ['confirmed'] });
  };
  const toggleTeam = (n: number) => setFilter({ ...filter, teamNos: filter.teamNos.includes(n) ? filter.teamNos.filter((x) => x !== n) : [...filter.teamNos, n] });
  const togglePick = (k: string) => setFilter({ ...filter, pickedKeys: filter.pickedKeys.includes(k) ? filter.pickedKeys.filter((x) => x !== k) : [...filter.pickedKeys, k] });

  // 기록 키는 번호 대신 참가자 키로 만든다(최종 번호는 중복 제거돼 번호 하나 = 포함된 참가자 하나).
  const memberByNumber = React.useMemo(() => new Map(result.rows.filter((r) => r.state === 'included').map((r) => [r.entry.phone.digits, r.entry.key])), [result.rows]);
  const keyFor = (b: Batch) => logClientKey({ templateKey: template.key, audience, batchLabel: b.label, memberKeys: b.numbers.map((n) => memberByNumber.get(n) ?? '?'), dateKst: kstDate() });

  const doCopy = async (b: Batch) => {
    setAsk(null);
    const ok = await onCopy(joinNumbers(b.numbers, sep, hyphen), `${b.label} 번호 ${b.numbers.length}개`);
    if (!ok) return;
    const mk = markKey(b);
    setMarks((m) => ({ ...m, [mk]: { copied: true, logId: m[mk]?.logId ?? null, status: m[mk]?.status ?? 'copied' } }));
    if (!canLog) return;
    try {
      const r = await addSmsLog(slug, { clientKey: await keyFor(b), templateKey: template.key, templateTitle: template.title, audience, batchLabel: b.label, recipientCount: b.numbers.length, status: 'copied' });
      setMarks((m) => ({ ...m, [mk]: { copied: true, logId: r.id, status: (r.status as BatchMark['status']) || 'copied' } }));
      await onLogged();
    } catch (e) { say(`번호는 복사했지만 기록을 남기지 못했습니다 — ${smsErrorMessage(e)}`, 'err'); }
  };

  const doSent = async (b: Batch, fresh = false) => {
    setAsk(null); setBusy(true);
    const mk = markKey(b);
    try {
      const cur = marks[mk];
      if (cur?.logId && !fresh && cur.status !== 'sent') {
        await setSmsLogStatus(slug, cur.logId, 'sent');
        setMarks((m) => ({ ...m, [mk]: { ...cur, status: 'sent' } }));
      } else {
        const base = await keyFor(b);
        const r = await addSmsLog(slug, {
          clientKey: fresh ? `${base}:re${Date.now()}`.slice(0, 120) : base, templateKey: template.key, templateTitle: template.title,
          audience, batchLabel: b.label, recipientCount: b.numbers.length, status: 'sent',
        });
        if (r.duplicate && r.status === 'sent') { setAsk({ kind: 'resend', batch: b }); setBusy(false); return; }
        if (r.duplicate) await setSmsLogStatus(slug, r.id, 'sent');
        setMarks((m) => ({ ...m, [mk]: { copied: m[mk]?.copied ?? false, logId: r.id, status: 'sent' } }));
      }
      say(`${b.label} 발송 완료로 기록했습니다.`);
      await onLogged();
    } catch (e) { say(smsErrorMessage(e), 'err'); } finally { setBusy(false); }
  };

  const askCopy = (b: Batch) => {
    if (copyBlockedReason) { say(copyBlockedReason, 'err'); return; }
    if (b.numbers.length === 0) return;
    setAsk({ kind: 'copy', batch: b });
  };

  const c = result.counts;
  const pickList = book.entries.filter((e) => {
    const s = pickQ.trim();
    if (!s) return true;
    return e.name.includes(s) || (e.teamNo != null && String(e.teamNo) === s) || e.registrationNo.toLowerCase().includes(s.toLowerCase());
  });

  return (
    <section id="sms-send" data-sms-section="send" style={{ scrollMarginTop: 80 }}>
      <SectionHead no="04" en="SEND" title="발송 준비"
        desc="대상을 고르고 번호를 배치별로 복사해 휴대폰 문자 앱에 붙여 넣어 보내세요. 이 화면은 문자를 직접 보내지 않습니다." />

      <div className="sms-send-grid">
        {/* 대상 */}
        <div style={card} data-sms-audience>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 900, color: INK }}>1. 수신 대상</p>
          <div role="radiogroup" aria-label="대상 범위" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(Object.keys(AUDIENCE_LABEL) as AudienceMode[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={filter.mode === m} data-sms-mode={m} onClick={() => setMode(m)}
                style={{ ...btnSmall, borderColor: filter.mode === m ? TEAL : LINE, background: filter.mode === m ? TEAL_SOFT : '#fff', color: filter.mode === m ? TEAL_DEEP : BODY }}>
                {AUDIENCE_LABEL[m]}
              </button>
            ))}
          </div>
          {filter.mode !== 'custom' && (
            <div style={{ marginTop: 10 }}>
              <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 800, color: MUTED }}>참가 상태</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {STATUS_OPTIONS.map((s) => {
                  const on = filter.statuses.includes(s);
                  return (
                    <label key={s} data-sms-status={s} style={{ ...btnSmall, gap: 6, borderColor: on ? INK : LINE, cursor: 'pointer' }}>
                      <input type="checkbox" checked={on} onChange={() => toggleStatus(s)} style={{ width: 16, height: 16 }} />
                      {PARTICIPATION_LABEL[s]} {book.statusCounts[s]}
                    </label>
                  );
                })}
              </div>
              {(gaps.applied + gaps.waitlisted + gaps.teamNotConfirmed + gaps.confirmedNoTeam + gaps.unknown) > 0 && (
                <div style={{ marginTop: 8 }} data-sms-gaps>
                  <Notice tone="warn">
                    <b>대상에서 빠진 신청을 확인하세요.</b>
                    {(gaps.applied + gaps.waitlisted) > 0 && <span data-sms-gap="pending"> 접수(미확정) {gaps.applied}팀 · 대기 {gaps.waitlisted}팀은 지금 수신 대상이 아닙니다.</span>}
                    {gaps.teamNotConfirmed > 0 && <span data-sms-gap="team-not-confirmed"> 참가팀 번호가 있는데 참가확정이 아닌 신청 {gaps.teamNotConfirmed}건도 빠집니다.</span>}
                    {gaps.confirmedNoTeam > 0 && <span data-sms-gap="confirmed-no-team"> 참가확정인데 참가팀 번호가 없는 신청 {gaps.confirmedNoTeam}건은 대상에 들어갑니다.</span>}
                    {gaps.unknown > 0 && <span data-sms-gap="unknown"> 상태를 알 수 없는 신청 {gaps.unknown}건은 대상에서 빠집니다.</span>}
                    {' '}참가 확정 여부는 ‘신청 현황’에서 고치고, 필요하면 위 참가 상태를 함께 고르세요.
                  </Notice>
                </div>
              )}
              {filter.statuses.some((s) => s !== 'confirmed') && (
                <div style={{ marginTop: 8 }}><Notice tone="warn">참가확정이 아닌 신청(접수 · 대기)도 포함했습니다. 아직 참가가 확정되지 않은 분에게도 문자가 갑니다.</Notice></div>
              )}
              <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 600, color: FAINT, wordBreak: 'keep-all' }}>
                취소 · 거절 신청과 기권한 팀은 대상에 넣지 않습니다(필요하면 ‘직접 선택’).
              </p>
            </div>
          )}
          {filter.mode === 'teams' && (
            <div style={{ marginTop: 10 }} data-sms-teams>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <p style={{ margin: 0, flex: 1, fontSize: 12, fontWeight: 800, color: MUTED }}>팀 선택 {filter.teamNos.length}개</p>
                {filter.teamNos.length > 0 && <button type="button" style={{ ...btnSmall, minHeight: 30 }} onClick={() => setFilter({ ...filter, teamNos: [] })}>모두 해제</button>}
              </div>
              {teamNos.length === 0
                ? <Notice tone="info">아직 참가팀 번호가 없습니다(‘참가팀 관리 · 확정’ 이후 생깁니다). ‘직접 선택’을 쓰세요.</Notice>
                : (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxHeight: 180, overflowY: 'auto' }}>
                    {teamNos.map((n) => (
                      <button key={n} type="button" data-sms-team={n} aria-pressed={filter.teamNos.includes(n)} onClick={() => toggleTeam(n)}
                        style={{ ...btnSmall, minWidth: 46, minHeight: 34, padding: '0 8px', borderColor: filter.teamNos.includes(n) ? TEAL : LINE, background: filter.teamNos.includes(n) ? TEAL_SOFT : '#fff' }}>{n}</button>
                    ))}
                  </div>
                )}
            </div>
          )}
          {filter.mode === 'custom' && (
            <div style={{ marginTop: 10 }} data-sms-pick>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <label style={{ ...input, display: 'flex', alignItems: 'center', gap: 6, flex: 1, minHeight: 40 }}>
                  <Search size={15} color={MUTED} />
                  <input value={pickQ} onChange={(e) => setPickQ(e.target.value)} placeholder="이름 · 팀 번호" aria-label="참가자 찾기"
                    style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', fontSize: 15, fontFamily: 'inherit', background: 'transparent' }} />
                </label>
                {filter.pickedKeys.length > 0 && <button type="button" style={{ ...btnSmall, minHeight: 40 }} onClick={() => setFilter({ ...filter, pickedKeys: [] })}>해제</button>}
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', border: `1px solid ${LINE}`, borderRadius: 10 }}>
                {pickList.map((e) => (
                  <label key={e.key} data-sms-pick-row={e.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderTop: `1px solid ${LINE_SOFT}`, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: BODY }}>
                    <input type="checkbox" checked={filter.pickedKeys.includes(e.key)} onChange={() => togglePick(e.key)} style={{ width: 17, height: 17, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{entryLabel(e)}</span>
                    {e.participation !== 'confirmed' && <Chip>{PARTICIPATION_LABEL[e.participation]}</Chip>}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="sms-counts" data-sms-counts style={{ marginTop: 12 }}>
            {[
              ['candidates', '후보', c.candidates],
              ['valid', '유효 번호', c.valid],
              ['dup', '중복 제외', c.duplicateRemoved],
              ['err', '오류 제외', c.errorRemoved],
              ['review', '확인 필요(보류)', c.reviewHeld],
              ['manual', '관리자 제외', c.manualExcluded],
            ].map(([k, label, v]) => (
              <div key={k as string} data-sms-count={k as string} style={{ background: '#F8FAFC', borderRadius: 9, padding: '7px 9px' }}>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: MUTED }}>{label}</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: INK, fontVariantNumeric: 'tabular-nums' }}>{v as number}</p>
              </div>
            ))}
          </div>
          <div data-sms-final style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8, padding: '10px 12px', borderRadius: 11, background: '#0F1B33', color: '#fff' }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, opacity: 0.85 }}>최종 발송 번호</span>
            <span data-sms-final-count style={{ fontSize: 24, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{c.final}</span>
            <span style={{ fontSize: 12.5, fontWeight: 800, opacity: 0.85 }}>개</span>
          </div>
        </div>

        {/* 문구 · 배치 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div style={card} data-sms-send-message>
            <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 900, color: INK }}>2. 보낼 문구</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Chip tone="navy">TEMPLATE {template.no}</Chip>
              <span style={{ fontSize: 14, fontWeight: 800, color: INK }}>{template.title}</span>
              {templateCheck.render.ready && !templateCheck.drawWarning ? <Chip tone="teal">발송 준비 완료</Chip> : <Chip tone="amber">발송 준비 미완료</Chip>}
            </div>
            <p style={{ margin: '6px 0 8px', fontSize: 12, fontWeight: 600, color: MUTED, wordBreak: 'keep-all' }}>
              위 ‘문자 템플릿’에서 고른 템플릿입니다. 바꾸려면 위에서 다른 템플릿을 고르세요.
            </p>
            <button type="button" style={btn} data-sms-action="send-copy-message" onClick={onCopyMessage}><Copy size={15} />문자 내용 복사</button>
          </div>

          <div style={card} data-sms-batches>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 900, color: INK }}>3. 번호 복사 · 발송 기록</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: MUTED }}>배치</span>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {BATCH_SIZES.map((n) => (
                  <button key={n} type="button" data-sms-batch-size={n} aria-pressed={!customSize && size === n} onClick={() => { setSize(n); setCustomSize(''); }}
                    style={{ ...btnSmall, minHeight: 34, borderColor: !customSize && size === n ? TEAL : LINE, background: !customSize && size === n ? TEAL_SOFT : '#fff' }}>{n}명</button>
                ))}
                <input value={customSize} onChange={(e) => setCustomSize(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} placeholder="직접"
                  inputMode="numeric" aria-label="배치 크기 직접 입력" data-sms-batch-custom style={{ ...input, width: 74, minHeight: 34, fontSize: 14 }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: MUTED }}>구분</span>
              {(['comma', 'newline'] as NumberSeparator[]).map((s) => (
                <label key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 700, color: BODY, cursor: 'pointer' }}>
                  <input type="radio" name="sms-sep" checked={sep === s} onChange={() => setSep(s)} data-sms-sep={s} />{s === 'comma' ? '쉼표' : '줄바꿈'}
                </label>
              ))}
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 700, color: BODY, cursor: 'pointer' }}>
                <input type="checkbox" checked={hyphen} onChange={(e) => setHyphen(e.target.checked)} data-sms-hyphen />하이픈(010-0000-0000)
              </label>
            </div>

            {warnChanged && <div style={{ marginBottom: 8 }}><Notice tone="warn">{warnChanged}</Notice></div>}
            {copyBlockedReason && <div style={{ marginBottom: 8 }}><Notice tone="info">{copyBlockedReason}</Notice></div>}

            {result.numbers.length === 0 ? (
              <Notice tone="info">보낼 번호가 없습니다. 대상 조건을 확인해 주세요.</Notice>
            ) : (
              <>
                <button type="button" style={{ ...btnDark, width: '100%' }} data-sms-action="copy-all" onClick={() => askCopy(allBatch)}>
                  <Copy size={16} />전체 번호 복사 ({result.numbers.length}개)
                </button>
                <p style={{ margin: '6px 0 10px', fontSize: 11.5, fontWeight: 600, color: FAINT, wordBreak: 'keep-all' }}>
                  문자 앱에 따라 한 번에 넣을 수 있는 수신자 수가 다릅니다. 많으면 아래 배치로 나눠 보내세요.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-sms-batch-list>
                  {[...(batches.length > 1 ? batches : [])].map((b) => {
                    const mk = marks[markKey(b)];
                    return (
                      <div key={b.label} data-sms-batch={b.index} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '9px 10px', border: `1px solid ${mk?.status === 'sent' ? TEAL : LINE}`, borderRadius: 11, background: mk?.status === 'sent' ? TEAL_SOFT : '#fff' }}>
                        <span style={{ flex: '1 1 120px', minWidth: 0, fontSize: 13.5, fontWeight: 900, color: INK }}>
                          {b.label}<span style={{ marginLeft: 6, fontSize: 12, fontWeight: 700, color: MUTED }}>{b.numbers.length}명</span>
                        </span>
                        {mk?.status === 'sent' ? <span data-sms-batch-state="sent"><Chip tone="teal"><CheckCircle2 size={12} />발송 완료 기록됨</Chip></span>
                          : mk?.copied ? <span data-sms-batch-state="copied"><Chip tone="amber"><ClipboardCheck size={12} />번호 복사됨 · 발송 전</Chip></span> : null}
                        <span style={{ display: 'flex', gap: 6 }}>
                          <button type="button" style={btnSmall} data-sms-batch-copy={b.index} onClick={() => askCopy(b)}><Copy size={14} />번호 복사</button>
                          <button type="button" style={{ ...btnSmall, borderColor: TEAL, color: TEAL_DEEP }} disabled={!canLog || busy || mk?.status === 'sent'} data-sms-batch-sent={b.index}
                            onClick={() => setAsk({ kind: 'sent', batch: b })}><Send size={14} />발송 완료 기록</button>
                        </span>
                      </div>
                    );
                  })}
                  {batches.length === 1 && (() => {
                    const b = batches[0]; const mk = marks[markKey(allBatch)] ?? marks[markKey(b)];
                    return (
                      <div data-sms-batch="single" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: MUTED }}>배치 1개 — 전체 번호 복사 후 발송했다면 기록하세요.</span>
                        {mk?.status === 'sent' && <Chip tone="teal">발송 완료 기록됨</Chip>}
                        <button type="button" style={{ ...btnSmall, borderColor: TEAL, color: TEAL_DEEP }} disabled={!canLog || busy || mk?.status === 'sent'} data-sms-batch-sent="all"
                          onClick={() => setAsk({ kind: 'sent', batch: allBatch })}><Send size={14} />발송 완료 기록</button>
                      </div>
                    );
                  })()}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {ask?.kind === 'copy' && (
        <ConfirmDialog title={`${ask.batch.label} 번호 복사`} confirmLabel={`${ask.batch.numbers.length}개 복사`}
          body={(
            <>
              <b data-sms-confirm-count>{ask.batch.numbers.length}개</b> 번호를 복사합니다. 대상: {audience}
              {warnChanged && <><br /><span style={{ color: AMBER }}>{warnChanged}</span></>}
              <br /><span style={{ color: MUTED }}>복사는 발송이 아닙니다. 문자 앱에서 보낸 뒤 ‘발송 완료 기록’을 눌러 주세요.</span>
            </>
          )}
          onConfirm={() => doCopy(ask.batch)} onCancel={() => setAsk(null)} />
      )}
      {ask?.kind === 'sent' && (
        <ConfirmDialog title="발송 완료로 기록할까요?" confirmLabel="발송 완료로 기록"
          body={(
            <>
              <b>{ask.batch.label} · {ask.batch.numbers.length}명</b>에게 ‘{template.title}’ 문자를 <b>휴대폰에서 직접 보냈습니까?</b>
              <br /><span style={{ color: MUTED }}>번호만 복사하고 아직 보내지 않았다면 기록하지 마세요. 잘못 기록하면 발송 기록에서 취소할 수 있습니다.</span>
            </>
          )}
          onConfirm={() => doSent(ask.batch)} onCancel={() => setAsk(null)} />
      )}
      {ask?.kind === 'resend' && (
        <ConfirmDialog title="이미 발송 완료로 기록된 배치입니다" confirmLabel="새 기록으로 추가"
          body={<>오늘 같은 템플릿 · 같은 대상 · 같은 배치가 이미 ‘발송 완료’로 기록되어 있습니다. 실제로 한 번 더 보냈다면 새 기록으로 추가하세요.</>}
          onConfirm={() => doSent(ask.batch, true)} onCancel={() => setAsk(null)} />
      )}
    </section>
  );
}

export const SEND_CSS = `
  .sms-send-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
  @media (min-width: 980px) { .sms-send-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; } }
  .sms-counts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
`;
