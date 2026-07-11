'use client';

// Club Schedule 상세 — PUBLIC_GUEST 공개 모집 설정(Guest Pass 와 별개 기능).
//   · Guest Pass: 초대/승인 게스트에게 전달하는 정모 안내 링크(기존 카드).
//   · 공개 모집: 외부인이 /guest 에서 신청할 수 있도록 신청 창구를 여는 기능(이 카드).
//   · 게스트비 입력란 없음 — KDK 설정값이 신청 화면에 읽기 전용 적용됨을 안내만 한다.
//   · 저장/상태변경은 upsert_guest_recruitment RPC(운영진). public_token 은 서버가 발급·불변.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Megaphone, ExternalLink } from 'lucide-react';
import {
  fetchScheduleRecruitment, upsertGuestRecruitment, guestOperatorMessage,
  type RecruitmentStatus,
} from '@/lib/guestApplicationService';

const STATUS: { v: RecruitmentStatus; t: string }[] = [
  { v: 'draft', t: '초안' }, { v: 'open', t: '모집 중' }, { v: 'closed', t: '마감' },
  { v: 'completed', t: '완료' }, { v: 'cancelled', t: '취소' },
];

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: 16 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: '#475569' };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '9px 10px', border: '1px solid #CBD5E1', borderRadius: 9, fontSize: 14, fontWeight: 600, color: '#0F172A' };
const chip = (on: boolean): React.CSSProperties => ({ padding: '7px 12px', borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: 'pointer', border: '1px solid', borderColor: on ? '#2563EB' : '#CBD5E1', background: on ? '#EFF6FF' : '#fff', color: on ? '#1D4ED8' : '#475569' });

// datetime-local ↔ ISO 변환(로컬 시간 기준).
const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

export default function GuestRecruitmentCard({ scheduleId }: { scheduleId: string }) {
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [exists, setExists] = useState(false);
  const [status, setStatus] = useState<RecruitmentStatus>('draft');
  const [maxGuests, setMaxGuests] = useState('');
  const [deadline, setDeadline] = useState('');
  const [publicMessage, setPublicMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const { ready, recruitment } = await fetchScheduleRecruitment(scheduleId);
    setReady(ready);
    if (recruitment) {
      setExists(true); setStatus(recruitment.status);
      setMaxGuests(recruitment.maxGuests != null ? String(recruitment.maxGuests) : '');
      setDeadline(toLocalInput(recruitment.applicationDeadline));
      setPublicMessage(recruitment.publicMessage || '');
    } else { setExists(false); }
    setLoading(false);
  }, [scheduleId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 2800); return () => clearTimeout(t); }, [msg]);

  const save = async (nextStatus?: RecruitmentStatus) => {
    if (busy) return; setBusy(true); setMsg(null);
    const s = nextStatus ?? status;
    const mg = maxGuests.trim() === '' ? null : parseInt(maxGuests, 10);
    if (mg != null && (!Number.isFinite(mg) || mg < 1)) { setMsg({ kind: 'err', text: '모집 인원은 1 이상이거나 비워 두세요(무제한).' }); setBusy(false); return; }
    try {
      await upsertGuestRecruitment({ scheduleId, status: s, maxGuests: mg, applicationDeadline: fromLocalInput(deadline), publicMessage: publicMessage.trim() || null });
      setMsg({ kind: 'ok', text: '공개 모집 설정을 저장했습니다.' });
      await load();
    } catch (e: any) { setMsg({ kind: 'err', text: guestOperatorMessage(e) }); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ ...card, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Megaphone size={16} style={{ color: '#0D9488' }} />
        <span style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A' }}>PUBLIC GUEST 공개 모집</span>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 600, color: '#94A3B8', lineHeight: 1.55 }}>
        외부인이 /guest 에서 신청할 수 있는 공개 모집 창구입니다. (초대/승인 게스트 안내 링크는 위의 Guest Pass 카드에서 관리)
      </p>

      {loading ? (
        <div style={{ fontSize: 12.5, color: '#94A3B8', fontWeight: 700 }}>불러오는 중…</div>
      ) : !ready ? (
        <div style={{ fontSize: 12.5, color: '#B45309', fontWeight: 700 }}>공개 모집 기능 준비 중입니다(운영 SQL 적용 대기).</div>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <div style={label}>공개 모집 상태</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              {STATUS.map((s) => <button key={s.v} type="button" onClick={() => setStatus(s.v)} style={chip(status === s.v)}>{s.t}</button>)}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><div style={label}>모집 인원(비우면 무제한)</div><input value={maxGuests} onChange={(e) => setMaxGuests(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} inputMode="numeric" style={input} /></div>
            <div><div style={label}>신청 마감</div><input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={input} /></div>
          </div>
          <div style={{ marginTop: 10 }}><div style={label}>공개 안내 문구(선택)</div>
            <textarea value={publicMessage} onChange={(e) => setPublicMessage(e.target.value)} rows={2} placeholder="신청자에게 보이는 공개 안내" style={{ ...input, resize: 'vertical', fontWeight: 500 } as React.CSSProperties} /></div>

          <p style={{ margin: '10px 0 0', fontSize: 10.5, fontWeight: 600, color: '#0F766E', background: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: 8, padding: '7px 9px', lineHeight: 1.5 }}>
            게스트비는 KDK 설정값이 신청 화면에 <b>읽기 전용</b>으로 적용됩니다(0원/미설정 구분). 이 카드에는 게스트비 입력란이 없습니다.
          </p>

          {msg && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: msg.kind === 'ok' ? '#047857' : '#DC2626' }}>{msg.text}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => save()} disabled={busy} style={{ padding: '10px 14px', borderRadius: 10, border: 'none', background: '#2563EB', color: '#fff', fontSize: 13, fontWeight: 800, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? '저장 중…' : exists ? '설정 저장' : '모집 생성'}</button>
            {exists && status !== 'open' && <button type="button" onClick={() => save('open')} disabled={busy} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #A7F3D0', background: '#fff', color: '#047857', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>모집 열기</button>}
            {exists && status === 'open' && <button type="button" onClick={() => save('closed')} disabled={busy} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #CBD5E1', background: '#fff', color: '#475569', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>모집 마감</button>}
            <Link href="/guest" target="_blank" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #CBD5E1', background: '#fff', color: '#334155', fontSize: 12.5, fontWeight: 800, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ExternalLink size={13} /> 공개 신청 페이지</Link>
          </div>
        </>
      )}
    </div>
  );
}
