'use client';

// 대회 문자 안내 센터(SMS NOTICE CENTER) — 관리자 전용 운영 도구.
//
//   ⚠ 문자를 보내지 않는다(유료 SMS · 외부 연동 없음). 번호 · 문구 복사 → 운영진 휴대폰 문자 앱으로 수동 발송.
//   ⚠ 참가 신청 원본을 바꾸지 않는다. 연락처는 기존 관리자 RPC(CEO/ADMIN 전용)로 읽기만 한다.
//   ⚠ 연락처를 브라우저 저장소(localStorage 등)에 남기지 않는다. 콘솔에 번호를 찍지 않는다.
//   ⚠ 문자 센터 SQL 이 아직 없으면 주소록 · 복사 · CSV 만 쓰고, 템플릿 저장 · 기록은 막는다(기본 문구로 미리보기만).

import React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useGuideRecording } from '@/hooks/useGuideRecording';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { fetchAdminGroupSchedule } from '@/lib/tournaments/groupScheduleService';
import {
  DEFAULT_AUDIENCE, URL_DEFS, buildAddressBook, buildContactsCsv, buildSnapshotEntries, buildVarValues, diffSnapshot,
  effectiveTemplates, hashBook, resolveUrls, selectRecipients,
  type AudienceFilter, type ScheduleValues, type SmsTemplateKey,
} from '@/lib/tournaments/smsModel';
import {
  fetchSmsCenter, fetchSmsRegistrations, fetchSmsTeams, saveSmsSnapshot, smsErrorMessage, SmsError,
  type SmsCenterData,
} from '@/lib/tournaments/smsService';
import type { SmsRegistration, SmsTeam } from '@/lib/tournaments/smsModel';
import SmsAddressBook, { ADDRESS_BOOK_CSS } from './SmsAddressBook';
import SmsTemplates, { TEMPLATES_CSS, checkTemplate, type TemplateCheck } from './SmsTemplates';
import SmsUrls from './SmsUrls';
import SmsSendPanel, { SEND_CSS } from './SmsSendPanel';
import SmsLogList from './SmsLogList';
import { Chip, ConfirmDialog, ManualCopy, MUTED, Notice, Toast, btn, btnSmall, card, copyText } from './smsUi';

type Phase = 'loading' | 'ready' | 'forbidden' | 'error';

const EMPTY_CENTER: SmsCenterData = { templates: {}, urls: {}, urlUpdatedAt: {}, snapshot: null, snapshotVersion: 0, logs: [] };

export default function SmsCenter({ slug }: { slug: string }) {
  const event = getOfficialTournament(slug);
  const { shouldMaskPrivateData } = useGuideRecording();
  const [phase, setPhase] = React.useState<Phase>('loading');
  const [regs, setRegs] = React.useState<SmsRegistration[]>([]);
  const [teams, setTeams] = React.useState<SmsTeam[]>([]);
  const [center, setCenter] = React.useState<SmsCenterData>(EMPTY_CENTER);
  const [sqlMissing, setSqlMissing] = React.useState(false);
  const [schedule, setSchedule] = React.useState<ScheduleValues | null>(null);
  const [drawPublished, setDrawPublished] = React.useState<boolean | null>(null);
  const [hashes, setHashes] = React.useState<Map<string, string> | null>(null);
  const [hashFailed, setHashFailed] = React.useState(false);
  const [filter, setFilter] = React.useState<AudienceFilter>(DEFAULT_AUDIENCE);
  const [seededSnapshot, setSeededSnapshot] = React.useState<number>(-1);
  const [selected, setSelected] = React.useState<SmsTemplateKey>('draw_checkin');
  const [revealed, setRevealed] = React.useState(false);
  const [toast, setToast] = React.useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [manual, setManual] = React.useState<{ title: string; text: string } | null>(null);
  const [askMsg, setAskMsg] = React.useState<null | { text: string; check: TemplateCheck; title: string }>(null);
  const [askClear, setAskClear] = React.useState(false);
  const [snapBusy, setSnapBusy] = React.useState(false);
  const [tplDirty, setTplDirty] = React.useState(false);
  const [urlDirty, setUrlDirty] = React.useState(false);
  const [loadedAt, setLoadedAt] = React.useState<number>(0);
  const toastTimer = React.useRef<number | null>(null);

  const say = React.useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    setToast({ text, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const loadCenter = React.useCallback(async () => {
    const c = await fetchSmsCenter(slug);
    if (c.state === 'missing') { setSqlMissing(true); setCenter(EMPTY_CENTER); return true; }
    if (c.state === 'forbidden') return false;
    setSqlMissing(false); setCenter(c.data); return true;
  }, [slug]);

  const load = React.useCallback(async () => {
    try {
      const [r, t] = await Promise.all([fetchSmsRegistrations(slug), fetchSmsTeams(slug)]);
      const okCenter = await loadCenter();
      if (!okCenter) { setPhase('forbidden'); return; }
      setRegs(r); setTeams(t);
      try {
        const g = await fetchAdminGroupSchedule(slug);
        if (g.ready && g.data) {
          const s = g.data.settings;
          setSchedule(s ? {
            checkinPlace: s.checkinPlace, session1Deadline: s.session1CheckinDeadline, session1Start: s.session1StartTime, session1Note: s.session1StartNote,
            session2Deadline: s.session2CheckinDeadline, session2Start: s.session2StartTime, session2Note: s.session2StartNote,
          } : null);
          setDrawPublished(!!g.data.drawPublishedAt);
        } else { setSchedule(null); setDrawPublished(null); }
      } catch { setSchedule(null); setDrawPublished(null); }
      setLoadedAt(Date.now());
      setPhase('ready');
    } catch (e) {
      const err = e as SmsError;
      if (err && (err.code === '42501' || err.reason === 'forbidden')) setPhase('forbidden');
      else setPhase('error');
    }
  }, [slug, loadCenter]);
  React.useEffect(() => { void load(); }, [load]);

  const book = React.useMemo(() => buildAddressBook(regs, teams), [regs, teams]);
  React.useEffect(() => {
    let alive = true;
    setHashes(null);
    // ⚠ 해시를 못 만들면 빈 해시로 저장하지 않는다(변경 감지가 조용히 꺼진다) — hashes 를 null 로 두고 확정을 막는다.
    void hashBook(slug, book).then((h) => { if (alive) setHashes(h); }).catch(() => { if (alive) { setHashes(null); setHashFailed(true); } });
    return () => { alive = false; };
  }, [slug, book]);
  const diff = React.useMemo(() => (hashes ? diffSnapshot(book, hashes, center.snapshot) : null), [book, hashes, center.snapshot]);

  // 확정본의 제외 목록을 처음 한 번(확정본 버전마다) 화면 선택에 반영한다.
  React.useEffect(() => {
    if (!diff || seededSnapshot === center.snapshotVersion) return;
    setFilter((f) => ({ ...f, excludedKeys: diff.excludedKeys }));
    setSeededSnapshot(center.snapshotVersion);
  }, [diff, center.snapshotVersion, seededSnapshot]);

  const exclusionsDirty = !!center.snapshot && !!diff
    && (filter.excludedKeys.length !== diff.excludedKeys.length || filter.excludedKeys.some((k) => !diff.excludedKeys.includes(k)));

  const result = React.useMemo(() => selectRecipients(book, filter), [book, filter]);
  const urls = React.useMemo(() => resolveUrls(slug, center.urls), [slug, center.urls]);
  const urlTokens = React.useMemo(() => new Set(URL_DEFS.map((d) => d.token)), []);
  const values = React.useMemo(() => buildVarValues({
    title: event ? event.titleFull : slug, eventDateISO: event ? event.eventDateISO : '', urls, schedule,
  }), [event, slug, urls, schedule]);
  const templates = React.useMemo(() => effectiveTemplates(center.templates), [center.templates]);
  const tpl = templates.find((t) => t.key === selected) ?? templates[0];
  const tplCheck = checkTemplate(tpl, values, urlTokens, drawPublished);

  React.useEffect(() => {
    if (!tplDirty && !urlDirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [tplDirty, urlDirty]);

  const copyBlockedReason = shouldMaskPrivateData ? '촬영(가이드) 모드에서는 연락처 복사 · 다운로드를 막습니다.' : null;

  const onCopy = React.useCallback(async (text: string, label: string): Promise<boolean> => {
    if (copyBlockedReason) { say(copyBlockedReason, 'err'); return false; }
    const ok = await copyText(text);
    if (ok) say(`${label}를 복사했습니다.`);
    else setManual({ title: label, text });
    return ok;
  }, [copyBlockedReason, say]);

  const copyMessage = (text: string, check: TemplateCheck, title: string) => {
    if (!check.render.ready || check.drawWarning) { setAskMsg({ text, check, title }); return; }
    void copyText(text).then((ok) => { if (ok) say('문자 내용을 복사했습니다.'); else setManual({ title: '문자 내용', text }); });
  };

  const downloadCsv = () => {
    if (copyBlockedReason) { say(copyBlockedReason, 'err'); return; }
    try {
      const csv = buildContactsCsv(book, result);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace(/[-:T]/g, '');
      a.href = URL.createObjectURL(blob);
      a.download = `${slug}-contacts-${stamp}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      say(`주소록 CSV(${book.entries.length}명)를 내려받았습니다. 파일 보관에 주의해 주세요.`);
    } catch { say('CSV 를 만들지 못했습니다.', 'err'); }
  };

  const saveSnapshot = async () => {
    if (sqlMissing) { say('문자 센터 SQL 적용 후 사용할 수 있습니다.', 'err'); return; }
    if (!hashes) { say(hashFailed ? '이 브라우저에서 주소록 확정 정보를 만들지 못했습니다. 다른 브라우저에서 시도해 주세요.' : '주소록을 준비하는 중입니다. 잠시 후 다시 눌러 주세요.', 'err'); return; }
    if (book.entries.some((e) => e.phone.digits && !hashes.get(e.key))) { say('주소록 확정 정보가 완전하지 않아 저장하지 않았습니다. 새로고침 후 다시 시도해 주세요.', 'err'); return; }
    setSnapBusy(true);
    try {
      const entries = buildSnapshotEntries(book, hashes, filter.excludedKeys);
      await saveSmsSnapshot(slug, entries, result.counts.final, center.snapshotVersion);
      say(`주소록을 확정했습니다(${book.entries.length}명 · 발송 대상 ${result.counts.final}명).`);
      await loadCenter();
      setSeededSnapshot(-1);
    } catch (e) {
      say(smsErrorMessage(e), 'err');
      if (e instanceof SmsError && e.reason === 'version_conflict') { await loadCenter(); setSeededSnapshot(-1); }
    } finally { setSnapBusy(false); }
  };

  const clearSnapshot = async () => {
    setAskClear(false); setSnapBusy(true);
    try {
      await saveSmsSnapshot(slug, null, null, center.snapshotVersion);
      say('주소록 확정을 해제했습니다.');
      await loadCenter();
    } catch (e) { say(smsErrorMessage(e), 'err'); await loadCenter(); } finally { setSnapBusy(false); }
  };

  const reloadCenter = React.useCallback(async () => {
    try { await loadCenter(); } catch (e) { say(smsErrorMessage(e), 'err'); }
  }, [loadCenter, say]);

  const toggleExclude = (key: string) => setFilter((f) => ({ ...f, excludedKeys: f.excludedKeys.includes(key) ? f.excludedKeys.filter((k) => k !== key) : [...f.excludedKeys, key] }));
  const toggleReview = (key: string) => setFilter((f) => ({ ...f, reviewIncludedKeys: f.reviewIncludedKeys.includes(key) ? f.reviewIncludedKeys.filter((k) => k !== key) : [...f.reviewIncludedKeys, key] }));

  if (phase === 'loading') {
    return <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, color: MUTED, fontWeight: 700 }} data-sms-state="loading"><Loader2 size={16} className="sms-spin" />불러오는 중…<style>{'.sms-spin{animation:sms-spin 1s linear infinite}@keyframes sms-spin{to{transform:rotate(360deg)}}'}</style></div>;
  }
  if (phase === 'forbidden') {
    return <div data-sms-state="forbidden"><Notice tone="error">권한이 없거나 로그인이 만료되었습니다. CEO · ADMIN 계정으로 다시 로그인해 주세요.</Notice></div>;
  }
  if (phase === 'error') {
    return (
      <div data-sms-state="error" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Notice tone="error">참가자 연락처를 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요. (원본 데이터는 바뀌지 않았습니다)</Notice>
        <button type="button" style={btn} onClick={() => { setPhase('loading'); void load(); }} data-sms-action="retry"><RefreshCw size={15} />다시 불러오기</button>
      </div>
    );
  }

  const warnChanged = diff?.hasChanges
    ? `주소록 확정 이후 원본이 바뀌었습니다(번호 변경 ${diff.changed.length} · 새 참가자 ${diff.added.length} · 빠진 참가자 ${diff.removed}). 지금 목록(현재 원본)으로 복사합니다 — 변경을 확인한 뒤 주소록을 다시 확정하세요.`
    : exclusionsDirty ? '제외 설정이 확정된 주소록과 다릅니다(아직 저장 안 됨). 지금 화면의 설정으로 복사합니다.' : null;

  return (
    <div data-sms-center data-sms-state="ready" style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
      {/* 상단 — 대회 · 운영 상태 */}
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }} data-sms-header>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Chip tone="navy">{event ? event.titleFull : slug}</Chip>
          {event && <Chip>{event.eventDateLabel}</Chip>}
          {drawPublished === true ? <Chip tone="teal">예선 DRAW 공개됨</Chip> : drawPublished === false ? <Chip tone="amber">예선 DRAW 비공개</Chip> : <Chip>DRAW 상태 확인 불가</Chip>}
          <Chip>참가 신청 {book.registrations}팀</Chip>
          <Chip tone={result.counts.final > 0 ? 'teal' : 'neutral'}>현재 발송 대상 {result.counts.final}명</Chip>
          {sqlMissing && <Chip tone="red">문자 센터 SQL 미적용</Chip>}
        </div>
        <nav aria-label="문자 센터 바로가기" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['sms-book', '주소록'], ['sms-templates', '템플릿'], ['sms-urls', 'URL'], ['sms-send', '발송 준비'], ['sms-logs', '발송 기록']].map(([id, label]) => (
            <a key={id} href={`#${id}`} style={{ ...btnSmall, minHeight: 34, textDecoration: 'none' }}>{label}</a>
          ))}
          <button type="button" style={{ ...btnSmall, minHeight: 34 }} data-sms-action="reload" onClick={() => { setPhase('loading'); void load(); }}>
            <RefreshCw size={14} />새로고침
          </button>
        </nav>
        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: MUTED }}>
          불러온 시각 {loadedAt ? new Date(loadedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''} · 이 화면은 문자를 직접 보내지 않습니다.
        </p>
        {sqlMissing && (
          <Notice tone="warn">
            문자 센터 SQL(add_hosted_tournament_sms_center.sql)이 아직 적용되지 않았습니다. 주소록 확인 · 번호 복사 · CSV 는 쓸 수 있지만,
            템플릿 저장 · URL 저장 · 주소록 확정 · 발송 기록은 SQL 적용 후 사용할 수 있습니다(지금은 기본 문구로 미리보기만 됩니다).
          </Notice>
        )}
        {shouldMaskPrivateData && <Notice tone="info">촬영(가이드) 모드 — 전화번호를 가리고 복사 · 다운로드를 막았습니다.</Notice>}
      </div>

      <SmsAddressBook slug={slug} book={book} result={result} diff={diff} snapshot={center.snapshot}
        revealed={revealed} maskForced={shouldMaskPrivateData} excludedKeys={filter.excludedKeys} reviewIncludedKeys={filter.reviewIncludedKeys}
        onReveal={setRevealed} onToggleExclude={toggleExclude} onToggleReview={toggleReview}
        onSaveSnapshot={saveSnapshot} onClearSnapshot={() => setAskClear(true)} snapshotBusy={snapBusy || sqlMissing} exclusionsDirty={exclusionsDirty}
        onCsv={downloadCsv} csvDisabledReason={copyBlockedReason} />

      <SmsTemplates slug={slug} templates={templates} selected={selected} onSelect={setSelected} values={values} urlTokens={urlTokens}
        drawPublished={drawPublished} onSaved={reloadCenter} say={say} onCopyMessage={copyMessage} onDirty={setTplDirty} readOnly={sqlMissing} />

      <SmsUrls slug={slug} urls={urls} savedAt={center.urlUpdatedAt} onSaved={reloadCenter} say={say}
        onCopy={(t, l) => { void onCopy(t, l); }} onDirty={setUrlDirty} readOnly={sqlMissing} />

      <SmsSendPanel slug={slug} book={book} filter={filter} setFilter={setFilter} result={result} template={tpl} templateCheck={tplCheck}
        warnChanged={warnChanged} copyBlockedReason={copyBlockedReason} onCopy={onCopy}
        onCopyMessage={() => copyMessage(tplCheck.render.text, tplCheck, tpl.title)} say={say} onLogged={reloadCenter} canLog={!sqlMissing} />

      {!sqlMissing && <SmsLogList slug={slug} logs={center.logs} onChanged={reloadCenter} say={say} />}

      {manual && <ManualCopy title={manual.title} text={manual.text} onClose={() => setManual(null)} />}
      {askMsg && (
        <ConfirmDialog title="발송 준비가 끝나지 않은 문구입니다" confirmLabel="그래도 복사"
          body={(
            <>
              {askMsg.check.drawWarning && <>· 예선 대진표가 아직 공개되지 않았습니다.<br /></>}
              {askMsg.check.render.missing.length > 0 && <>· 비어 있는 값: {askMsg.check.render.missing.join(', ')}<br /></>}
              {askMsg.check.render.unsafeUrls.length > 0 && <>· 안전하지 않은 주소: {askMsg.check.render.unsafeUrls.join(', ')}<br /></>}
              {askMsg.check.render.unknown.length > 0 && <>· 알 수 없는 변수: {askMsg.check.render.unknown.join(', ')}<br /></>}
              <span style={{ color: MUTED }}>변수가 그대로 남은 문구는 참가자에게 보내지 마세요.</span>
            </>
          )}
          onConfirm={() => { const m = askMsg; setAskMsg(null); void copyText(m.text).then((ok) => { if (ok) say('문자 내용을 복사했습니다(준비 미완료).', 'err'); else setManual({ title: '문자 내용', text: m.text }); }); }}
          onCancel={() => setAskMsg(null)} />
      )}
      {askClear && (
        <ConfirmDialog title="주소록 확정을 해제할까요?" confirmLabel="확정 해제" danger
          body="확정 기록(제외 설정 포함)이 지워지고, 원본 기준 목록으로 돌아갑니다. 참가 신청 원본은 바뀌지 않습니다."
          onConfirm={clearSnapshot} onCancel={() => setAskClear(false)} />
      )}
      <Toast toast={toast} />
      <style>{ADDRESS_BOOK_CSS + TEMPLATES_CSS + SEND_CSS + '[data-sms-center] button:disabled, [data-sms-modal] button:disabled { opacity: 0.45; cursor: not-allowed; }'}</style>
    </div>
  );
}
