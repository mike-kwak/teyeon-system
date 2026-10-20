'use client';

// 문자 안내 센터 — 문자 템플릿(수정 · 저장 · 기본값 초기화 · 미리보기 · 복사).
//   ⚠ 미해결 변수 · 미설정 URL 이 있으면 '발송 준비 완료'로 표시하지 않는다.
//   ⚠ 동시 수정: 서버 version 이 다르면 저장하지 않고 알려 준다(덮어쓰기는 관리자가 직접 고른다).

import React from 'react';
import { AlertTriangle, CheckCircle2, Copy, RotateCcw, Save } from 'lucide-react';
import {
  TEMPLATE_DEFAULT_BY_KEY, TEMPLATE_VARS, messageLength, renderTemplate,
  type EffectiveTemplate, type RenderResult, type SmsTemplateKey,
} from '@/lib/tournaments/smsModel';
import { saveSmsTemplate, smsErrorMessage, SmsError } from '@/lib/tournaments/smsService';
import {
  AMBER, BODY, Chip, ConfirmDialog, FAINT, INK, LINE, MUTED, Notice, SectionHead, TEAL, TEAL_DEEP, TEAL_SOFT,
  btn, btnPrimary, btnSmall, card, fmtTime, input,
} from './smsUi';

export interface TemplateCheck {
  render: RenderResult;
  /** 대진표 공개 전인데 대진표 링크가 들어간 안내. */
  drawWarning: boolean;
}

export function checkTemplate(t: { body: string; needsPublishedDraw: boolean }, values: Record<string, string>, urlTokens: Set<string>, drawPublished: boolean | null): TemplateCheck {
  const render = renderTemplate(t.body, values, urlTokens);
  return { render, drawWarning: t.needsPublishedDraw && drawPublished !== true };
}

export default function SmsTemplates({
  slug, templates, selected, onSelect, values, urlTokens, drawPublished, onSaved, say, onCopyMessage, onDirty, readOnly = false,
}: {
  slug: string;
  templates: EffectiveTemplate[];
  selected: SmsTemplateKey;
  onSelect: (k: SmsTemplateKey) => void;
  values: Record<string, string>;
  urlTokens: Set<string>;
  drawPublished: boolean | null;
  onSaved: () => Promise<void>;
  say: (t: string, tone?: 'ok' | 'err') => void;
  onCopyMessage: (text: string, check: TemplateCheck, title: string) => void;
  onDirty: (dirty: boolean) => void;
  /** 문자 센터 SQL 미적용 — 저장 · 초기화를 막는다. */
  readOnly?: boolean;
}) {
  const tpl = templates.find((t) => t.key === selected) ?? templates[0];
  const [title, setTitle] = React.useState(tpl.title);
  const [body, setBody] = React.useState(tpl.body);
  const [baseVersion, setBaseVersion] = React.useState(tpl.version);
  const [busy, setBusy] = React.useState(false);
  const [conflict, setConflict] = React.useState<{ version: number; title: string | null; body: string | null } | null>(null);
  const [askReset, setAskReset] = React.useState(false);
  const [askSwitch, setAskSwitch] = React.useState<SmsTemplateKey | null>(null);
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const dirty = title !== tpl.title || body !== tpl.body;

  // 선택한 템플릿이 바뀌거나 서버 값이 새로 오면(저장 · 다시 불러오기) 편집칸을 맞춘다.
  React.useEffect(() => {
    setTitle(tpl.title); setBody(tpl.body); setBaseVersion(tpl.version); setConflict(null);
  }, [tpl.key, tpl.version, tpl.title, tpl.body]);
  React.useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  const check = checkTemplate({ body, needsPublishedDraw: tpl.needsPublishedDraw }, values, urlTokens, drawPublished);
  const len = messageLength(check.render.text);

  const save = async (expected: number) => {
    setBusy(true);
    try {
      await saveSmsTemplate(slug, tpl.key, title, body, expected);
      setConflict(null);
      say(`‘${title}’ 템플릿을 저장했습니다.`);
      await onSaved();
    } catch (e) {
      if (e instanceof SmsError && e.reason === 'version_conflict') {
        const cur = (e.payload.current ?? {}) as { title?: string | null; body?: string | null };
        setConflict({ version: Number(e.payload.currentVersion) || 0, title: cur.title ?? null, body: cur.body ?? null });
      }
      say(smsErrorMessage(e), 'err');
    } finally { setBusy(false); }
  };

  const reset = async () => {
    setAskReset(false); setBusy(true);
    try {
      await saveSmsTemplate(slug, tpl.key, '', '', baseVersion, true);
      say('기본 문구로 되돌렸습니다.');
      await onSaved();
    } catch (e) {
      if (e instanceof SmsError && e.reason === 'version_conflict') {
        const cur = (e.payload.current ?? {}) as { title?: string | null; body?: string | null };
        setConflict({ version: Number(e.payload.currentVersion) || 0, title: cur.title ?? null, body: cur.body ?? null });
      }
      say(smsErrorMessage(e), 'err');
    } finally { setBusy(false); }
  };

  const insertVar = (token: string) => {
    const ta = taRef.current;
    if (!ta) { setBody((b) => b + token); return; }
    const s = ta.selectionStart ?? body.length; const en = ta.selectionEnd ?? body.length;
    const next = body.slice(0, s) + token + body.slice(en);
    setBody(next);
    window.requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + token.length, s + token.length); });
  };

  const pick = (k: SmsTemplateKey) => {
    if (k === selected) return;
    if (dirty) { setAskSwitch(k); return; }
    onSelect(k);
  };

  const def = TEMPLATE_DEFAULT_BY_KEY.get(tpl.key)!;

  return (
    <section id="sms-templates" data-sms-section="templates" style={{ scrollMarginTop: 80 }}>
      <SectionHead no="02" en="TEMPLATES" title="문자 템플릿"
        desc="대회별로 저장됩니다. {대진표URL} 같은 변수는 복사할 때 실제 주소 · 시간으로 바뀝니다." />

      <div role="tablist" aria-label="템플릿" className="sms-tpl-tabs" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
        {templates.map((t) => {
          const c = checkTemplate(t, values, urlTokens, drawPublished);
          const on = t.key === selected;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} data-sms-tpl-tab={t.key} onClick={() => pick(t.key)}
              style={{ ...btn, flexShrink: 0, minHeight: 50, padding: '6px 12px', flexDirection: 'column', alignItems: 'flex-start', gap: 1,
                borderColor: on ? TEAL : LINE, background: on ? TEAL_SOFT : '#fff' }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', color: on ? TEAL_DEEP : FAINT }}>TEMPLATE {t.no}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: INK, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {t.title.length > 14 ? `${t.title.slice(0, 14)}…` : t.title}
                {c.render.ready && !c.drawWarning
                  ? <CheckCircle2 size={13} color={TEAL} aria-label="발송 준비 완료" />
                  : <AlertTriangle size={13} color={AMBER} aria-label="확인 필요" />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="sms-tpl-grid">
        {/* 편집 */}
        <div style={{ ...card }} data-sms-tpl-editor={tpl.key}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <Chip tone="navy">TEMPLATE {tpl.no}</Chip>
            {tpl.isDefault ? <Chip>기본 문구</Chip> : <Chip tone="teal">수정본</Chip>}
            {tpl.updatedAt && <span style={{ fontSize: 11.5, fontWeight: 700, color: FAINT }}>마지막 수정 {fmtTime(tpl.updatedAt)}</span>}
            {dirty && <span data-sms-tpl-dirty><Chip tone="amber">저장 안 됨</Chip></span>}
          </div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: MUTED, marginBottom: 4 }} htmlFor="sms-tpl-title">제목(관리용)</label>
          <input id="sms-tpl-title" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} style={input} data-sms-tpl-title />
          <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: MUTED, margin: '10px 0 4px' }} htmlFor="sms-tpl-body">본문</label>
          <textarea id="sms-tpl-body" ref={taRef} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} rows={12}
            data-sms-tpl-body style={{ ...input, minHeight: 240, padding: 10, lineHeight: 1.6, resize: 'vertical' }} />
          <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 700, color: FAINT, textAlign: 'right' }}>{Array.from(body).length} / 2000자</p>
          <p style={{ margin: '6px 0 4px', fontSize: 12, fontWeight: 800, color: MUTED }}>변수 넣기</p>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {TEMPLATE_VARS.map((v) => (
              <button key={v.token} type="button" onClick={() => insertVar(v.token)} data-sms-var={v.token} title={v.label}
                style={{ ...btnSmall, minHeight: 32, padding: '0 8px', fontSize: 12, color: values[v.token] ? BODY : AMBER }}>{v.token}</button>
            ))}
          </div>
          {conflict && (
            <div style={{ marginTop: 10 }} data-sms-tpl-conflict>
              <Notice tone="warn">
                다른 관리자가 먼저 이 템플릿을 저장했습니다(현재 v{conflict.version}).
                {conflict.title ? <> 서버의 제목: ‘{conflict.title}’.</> : <> 서버는 기본 문구 상태입니다.</>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  <button type="button" style={btnSmall} data-sms-action="tpl-reload" onClick={async () => { await onSaved(); setConflict(null); }}>최신 내용 불러오기(내 수정 버림)</button>
                  <button type="button" style={btnSmall} data-sms-action="tpl-overwrite" disabled={busy} onClick={() => save(conflict.version)}>내 내용으로 덮어쓰기</button>
                </div>
              </Notice>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" style={btnPrimary} disabled={readOnly || busy || !dirty || !title.trim() || !body.trim()} data-sms-action="tpl-save" onClick={() => save(baseVersion)}>
              <Save size={16} />저장
            </button>
            <button type="button" style={btn} disabled={readOnly || busy || (tpl.isDefault && !dirty)} data-sms-action="tpl-reset" onClick={() => setAskReset(true)}>
              <RotateCcw size={15} />기본값으로
            </button>
            {dirty && (
              <button type="button" style={btn} data-sms-action="tpl-discard" onClick={() => { setTitle(tpl.title); setBody(tpl.body); }}>수정 취소</button>
            )}
          </div>
        </div>

        {/* 미리보기 */}
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }} data-sms-tpl-preview>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, flex: 1, fontSize: 13, fontWeight: 900, color: INK }}>미리보기 · 실제 보낼 문구</p>
            {check.render.ready && !check.drawWarning
              ? <span data-sms-ready="1"><Chip tone="teal"><CheckCircle2 size={12} />발송 준비 완료</Chip></span>
              : <span data-sms-ready="0"><Chip tone="amber"><AlertTriangle size={12} />발송 준비 미완료</Chip></span>}
          </div>
          <div data-sms-preview-text style={{
            background: '#F3F6FA', border: `1px solid ${LINE}`, borderRadius: 14, padding: '12px 13px', fontSize: 14, lineHeight: 1.65,
            color: INK, whiteSpace: 'pre-wrap', wordBreak: 'keep-all', overflowWrap: 'anywhere', minHeight: 120,
          }}>{check.render.text || ' '}</div>
          <p data-sms-length style={{ margin: 0, fontSize: 12, fontWeight: 700, color: MUTED, lineHeight: 1.6 }}>
            {len.chars}자 · 약 {len.bytes}바이트 · {len.lines}줄 — {len.hint}
            <br /><span style={{ color: FAINT }}>단문 · 장문 구분과 요금은 통신사 · 문자 앱마다 다를 수 있습니다.</span>
          </p>
          {(check.render.missing.length > 0 || check.render.unknown.length > 0 || check.render.unsafeUrls.length > 0 || check.drawWarning) && (
            <div data-sms-tpl-warnings style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {check.drawWarning && (
                <Notice tone="warn">
                  예선 대진표가 아직 공개되지 않았습니다. 지금 보내면 참가자는 ‘공개 전’ 화면을 보게 됩니다. DRAW 공개 후 보내세요.
                </Notice>
              )}
              {check.render.missing.length > 0 && (
                <Notice tone="warn">값이 비어 있는 항목: {check.render.missing.join(', ')} — URL 관리 · 조별 일정(출전 신고 안내)에서 먼저 설정해 주세요.</Notice>
              )}
              {check.render.unsafeUrls.length > 0 && <Notice tone="error">안전하지 않은 주소: {check.render.unsafeUrls.join(', ')} — https:// 주소만 쓸 수 있습니다.</Notice>}
              {check.render.unknown.length > 0 && <Notice tone="error">알 수 없는 변수: {check.render.unknown.join(', ')} — 오타를 확인해 주세요.</Notice>}
            </div>
          )}
          <button type="button" style={btn} data-sms-action="copy-message" onClick={() => onCopyMessage(check.render.text, check, title)}>
            <Copy size={15} />문자 내용 복사
          </button>
          {!tpl.isDefault && (
            <details style={{ fontSize: 12, color: MUTED }}>
              <summary style={{ cursor: 'pointer', fontWeight: 800 }}>기본 문구 보기</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12.5, color: BODY, margin: '6px 0 0' }}>{def.body}</pre>
            </details>
          )}
        </div>
      </div>

      {askReset && (
        <ConfirmDialog title="기본 문구로 되돌릴까요?" confirmLabel="기본값으로" danger
          body={<>‘{tpl.title}’의 저장된 수정 내용을 지우고 처음 제공된 기본 문구로 되돌립니다.</>}
          onConfirm={reset} onCancel={() => setAskReset(false)} />
      )}
      {askSwitch && (
        <ConfirmDialog title="저장하지 않은 수정이 있습니다" confirmLabel="저장하지 않고 이동"
          body="지금 템플릿의 수정 내용이 사라집니다. 이동할까요?"
          onConfirm={() => { const k = askSwitch; setAskSwitch(null); onSelect(k); }} onCancel={() => setAskSwitch(null)} />
      )}
    </section>
  );
}

export const TEMPLATES_CSS = `
  .sms-tpl-tabs::-webkit-scrollbar { display: none; }
  .sms-tpl-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
  @media (min-width: 980px) { .sms-tpl-grid { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); align-items: start; } }
`;
