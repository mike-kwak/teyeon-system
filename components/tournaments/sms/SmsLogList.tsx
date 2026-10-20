'use client';

// 문자 안내 센터 — 수동 발송 기록(번호 없음). 잘못 체크한 '발송 완료'는 취소(void)로 고친다 — 기록은 지우지 않는다.

import React from 'react';
import { History } from 'lucide-react';
import { setSmsLogStatus, smsErrorMessage, type SmsLog } from '@/lib/tournaments/smsService';
import { Chip, ConfirmDialog, FAINT, INK, LINE_SOFT, MUTED, SectionHead, btnSmall, card, fmtTime, input } from './smsUi';

const STATUS: Record<SmsLog['status'], { label: string; tone: 'teal' | 'amber' | 'neutral' }> = {
  sent: { label: '발송 완료', tone: 'teal' },
  copied: { label: '번호 복사함 · 발송 전', tone: 'amber' },
  void: { label: '기록 취소', tone: 'neutral' },
};

export default function SmsLogList({ slug, logs, onChanged, say }: {
  slug: string; logs: SmsLog[]; onChanged: () => Promise<void>; say: (t: string, tone?: 'ok' | 'err') => void;
}) {
  const [ask, setAsk] = React.useState<null | { log: SmsLog; to: SmsLog['status'] }>(null);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const sent = logs.filter((l) => l.status === 'sent');

  const apply = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      await setSmsLogStatus(slug, ask.log.id, ask.to, note.trim() || null);
      say(ask.to === 'void' ? '기록을 취소 상태로 바꿨습니다.' : '발송 완료로 기록했습니다.');
      setAsk(null); setNote('');
      await onChanged();
    } catch (e) { say(smsErrorMessage(e), 'err'); } finally { setBusy(false); }
  };

  return (
    <section id="sms-logs" data-sms-section="logs" style={{ scrollMarginTop: 80 }}>
      <SectionHead no="05" en="HISTORY" title="수동 발송 기록"
        desc={`관리자가 직접 남긴 기록입니다(최근 200건). 발송 완료 ${sent.length}건 · 총 ${sent.reduce((s, l) => s + l.recipientCount, 0)}명. 실제 문자 발송 여부는 자동으로 확인하지 않습니다.`} />
      <div style={{ ...card, padding: 0, overflow: 'hidden' }} data-sms-log-list>
        {logs.length === 0 && (
          <div style={{ padding: '22px 16px', textAlign: 'center' }}>
            <History size={20} color={FAINT} />
            <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 700, color: MUTED }}>아직 기록이 없습니다.</p>
          </div>
        )}
        {logs.map((l) => (
          <div key={l.id} data-sms-log={l.id} data-sms-log-status={l.status} style={{ padding: '11px 14px', borderTop: `1px solid ${LINE_SOFT}`, opacity: l.status === 'void' ? 0.6 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Chip tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Chip>
              <span style={{ fontSize: 14, fontWeight: 800, color: INK, wordBreak: 'keep-all' }}>{l.templateTitle || l.templateKey}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: MUTED }}>{l.batchLabel || ''} · {l.recipientCount}명</span>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: 12, fontWeight: 600, color: MUTED, lineHeight: 1.6, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
              {fmtTime(l.createdAt)} · {l.createdByName || '관리자'}{l.mine ? '(나)' : ''}{l.audience ? ` · ${l.audience}` : ''}
              {l.statusChangedAt ? ` · 상태 변경 ${fmtTime(l.statusChangedAt)}` : ''}
              {l.note ? <><br />메모: {l.note}</> : null}
            </p>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {l.status === 'copied' && <button type="button" style={btnSmall} data-sms-log-sent={l.id} onClick={() => setAsk({ log: l, to: 'sent' })}>발송 완료로 기록</button>}
              {l.status !== 'void' && <button type="button" style={btnSmall} data-sms-log-void={l.id} onClick={() => setAsk({ log: l, to: 'void' })}>잘못된 기록 취소</button>}
              {l.status === 'void' && <button type="button" style={btnSmall} data-sms-log-restore={l.id} onClick={() => setAsk({ log: l, to: 'copied' })}>취소 되돌리기</button>}
            </div>
          </div>
        ))}
      </div>
      {ask && (
        <ConfirmDialog
          title={ask.to === 'void' ? '이 기록을 취소할까요?' : ask.to === 'sent' ? '발송 완료로 기록할까요?' : '취소를 되돌릴까요?'}
          confirmLabel={busy ? '처리 중…' : ask.to === 'void' ? '기록 취소' : '확인'} danger={ask.to === 'void'}
          body={(
            <>
              ‘{ask.log.templateTitle || ask.log.templateKey}’ {ask.log.batchLabel || ''} · {ask.log.recipientCount}명
              {ask.to === 'void' && <><br />기록은 지워지지 않고 ‘기록 취소’로 남습니다.</>}
              {ask.to === 'sent' && <><br />휴대폰에서 실제로 보낸 경우에만 기록하세요.</>}
              {ask.to === 'copied' && <><br />‘번호 복사함 · 발송 전’ 상태로 되돌립니다.</>}
              <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} placeholder="메모(선택)" aria-label="메모"
                data-sms-log-note style={{ ...input, marginTop: 10 }} />
            </>
          )}
          onConfirm={apply} onCancel={() => { setAsk(null); setNote(''); }} />
      )}
    </section>
  );
}
