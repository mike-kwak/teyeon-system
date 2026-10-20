'use client';

// 문자 안내 센터 — 대회별 안내 URL(입력 · 저장 · 복사 · 열기).
//   ⚠ 확정된 공개 화면(대회 홈 · 예선 · MY MATCH · 본선)은 기존 라우트로 기본값을 만든다. 직접 저장하면 그 값을 쓴다.
//   ⚠ LIVE · 결과 · 영상은 아직 정해지지 않았으므로 비워 둔다(임의 주소를 만들지 않는다).
//   ⚠ https:// 만 저장 · 열기 허용(javascript: 등 차단).

import React from 'react';
import { Copy, ExternalLink, Save } from 'lucide-react';
import { isSafeHttpsUrl, type ResolvedUrl, type SmsUrlKey } from '@/lib/tournaments/smsModel';
import { saveSmsUrl, smsErrorMessage } from '@/lib/tournaments/smsService';
import { Chip, FAINT, INK, LINE_SOFT, MUTED, RED, SectionHead, btnSmall, card, fmtTime, input } from './smsUi';

export default function SmsUrls({ slug, urls, savedAt, onSaved, say, onCopy, onDirty, readOnly = false }: {
  slug: string;
  urls: ResolvedUrl[];
  savedAt: Partial<Record<SmsUrlKey, string>>;
  onSaved: () => Promise<void>;
  say: (t: string, tone?: 'ok' | 'err') => void;
  onCopy: (text: string, label: string) => void;
  onDirty: (dirty: boolean) => void;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = React.useState<Partial<Record<SmsUrlKey, string>>>({});
  const [busy, setBusy] = React.useState<SmsUrlKey | null>(null);
  const dirtyKeys = urls.filter((u) => draft[u.key] !== undefined && draft[u.key] !== (u.source === 'saved' ? u.url : '')).map((u) => u.key);
  React.useEffect(() => { onDirty(dirtyKeys.length > 0); }, [dirtyKeys.length, onDirty]);

  const save = async (u: ResolvedUrl) => {
    const v = (draft[u.key] ?? '').trim();
    if (v && !isSafeHttpsUrl(v)) { say('https:// 로 시작하는 올바른 주소만 저장할 수 있습니다.', 'err'); return; }
    setBusy(u.key);
    try {
      await saveSmsUrl(slug, u.key, v);
      setDraft((d) => { const n = { ...d }; delete n[u.key]; return n; });
      say(v ? `${u.label} 주소를 저장했습니다.` : `${u.label} 주소를 비웠습니다.`);
      await onSaved();
    } catch (e) { say(smsErrorMessage(e), 'err'); } finally { setBusy(null); }
  };

  return (
    <section id="sms-urls" data-sms-section="urls" style={{ scrollMarginTop: 80 }}>
      <SectionHead no="03" en="LINKS" title="안내 URL 관리"
        desc="템플릿의 {대진표URL} · {LIVE_URL} 등에 들어갈 주소입니다. 공개 화면 4개는 현재 주소가 기본으로 들어가 있습니다." />
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {urls.map((u) => {
          const editing = draft[u.key] !== undefined;
          const value = editing ? (draft[u.key] as string) : (u.source === 'saved' ? u.url : '');
          const invalid = editing && value.trim() !== '' && !isSafeHttpsUrl(value);
          const status = u.source === 'saved' ? (u.safe ? { t: '저장됨', tone: 'teal' as const } : { t: '잘못된 주소', tone: 'red' as const })
            : u.source === 'default' ? { t: '기본(현재 주소)', tone: 'navy' as const } : { t: '미설정', tone: 'amber' as const };
          return (
            <div key={u.key} data-sms-url={u.key} data-sms-url-source={u.source} style={{ padding: '12px 14px', borderTop: `1px solid ${LINE_SOFT}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 900, color: INK }}>{u.label}</span>
                <code style={{ fontSize: 11.5, color: MUTED }}>{u.token}</code>
                <Chip tone={status.tone}>{status.t}</Chip>
                {savedAt[u.key] && <span style={{ fontSize: 11, fontWeight: 700, color: FAINT }}>{fmtTime(savedAt[u.key])}</span>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input value={value} onChange={(e) => setDraft((d) => ({ ...d, [u.key]: e.target.value }))}
                  placeholder={u.source === 'default' ? u.url : 'https:// 주소를 입력하면 템플릿에 쓸 수 있습니다'}
                  inputMode="url" autoComplete="off" spellCheck={false} aria-label={`${u.label} URL`} data-sms-url-input={u.key}
                  style={{ ...input, flex: '1 1 260px', borderColor: invalid ? RED : '#CBD5E1', fontSize: 14 }} />
                <span style={{ display: 'flex', gap: 6 }}>
                  <button type="button" style={btnSmall} disabled={readOnly || !editing || busy === u.key || invalid} data-sms-url-save={u.key} onClick={() => save(u)}>
                    <Save size={14} />저장
                  </button>
                  <button type="button" style={btnSmall} disabled={!u.url || !u.safe} data-sms-url-copy={u.key} onClick={() => onCopy(u.url, `${u.label} 주소`)}>
                    <Copy size={14} />복사
                  </button>
                  <a href={u.safe ? u.url : undefined} target="_blank" rel="noopener noreferrer" data-sms-url-open={u.key}
                    aria-disabled={!u.safe} onClick={(e) => { if (!u.safe) e.preventDefault(); }}
                    style={{ ...btnSmall, textDecoration: 'none', opacity: u.safe ? 1 : 0.45, pointerEvents: u.safe ? 'auto' : 'none' }}>
                    <ExternalLink size={14} />열기
                  </a>
                </span>
              </div>
              {u.source === 'default' && !editing && (
                <p style={{ margin: '5px 0 0', fontSize: 11.5, fontWeight: 600, color: FAINT, overflowWrap: 'anywhere' }}>현재 사용: {u.url}</p>
              )}
              {u.source === 'saved' && !editing && (
                <p style={{ margin: '5px 0 0', fontSize: 11.5, fontWeight: 600, color: FAINT }}>
                  비우고 저장하면 {u.key === 'live' || u.key === 'results' || u.key === 'video' ? '미설정 상태' : '기본 주소'}로 돌아갑니다.
                </p>
              )}
              {invalid && <p role="alert" style={{ margin: '5px 0 0', fontSize: 12, fontWeight: 800, color: RED }}>https:// 로 시작하는 주소만 쓸 수 있습니다(공백 · 따옴표 불가).</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
