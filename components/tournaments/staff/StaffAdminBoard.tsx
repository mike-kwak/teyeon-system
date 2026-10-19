'use client';

// 본부(CEO/ADMIN) — 현장 운영자 요청 승인 · 거절 · 회수 (현장 운영 3단계).
//
//   ⚠ 승인은 '요청한 사용자' 에게만 할 수 있다(서버 규칙). 임의 사용자 id 로 권한을 만들지 않는다.
//   ⚠ 만료는 서버 기본값(대회일 다음날 자정 이후 · 최소 24시간)을 쓴다 — 대회 당일 운영 중 끊기지 않게.
//   ⚠ 회수는 즉시 효력이다. 현장 운영 화면은 다음 갱신(5초 안)에 접근이 막힌다.
//   ⚠ 결과는 서버 응답 뒤 목록을 다시 읽어 반영한다(화면이 먼저 바꾸지 않는다).

import React from 'react';
import { Copy, RefreshCw, AlertTriangle, Check, UserPlus } from 'lucide-react';
import { useVisibilityResync } from '@/hooks/useRealtimeSync';
import {
  approveStaff, fetchStaffAdmin, isStaffMissing, revokeStaff, staffActionMessage,
  type StaffAdminList, type StaffAdminRow,
} from '@/lib/tournaments/staffService';

const INK = '#0F172A';
const INK_SOFT = '#334155';
const MUTED = '#64748B';
const FAINT = '#94A3B8';
const LINE = '#E2E8F0';
const TEAL = '#0E8C80';
const NAVY = '#102A3D';
const AMBER_INK = '#9A3412';
const POLL_MS = 10_000;

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14 };
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 42, padding: '8px 13px',
  borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', color: INK_SOFT, fontFamily: 'inherit',
  fontSize: 13.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', WebkitTapHighlightColor: 'transparent',
};
const when = (iso: string | null): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const STATUS_TEXT: Record<StaffAdminRow['status'], string> = {
  pending: '승인 대기', approved: '승인됨', expired: '만료', revoked: '회수 · 거절', closed: '대회 종료',
};

function Row({ r, busy, confirming, error, onAskApprove, onApprove, onAskRevoke, onRevoke, onKeep }: {
  r: StaffAdminRow; busy: boolean; confirming: 'approve' | 'revoke' | null; error: string;
  onAskApprove: () => void; onApprove: () => void; onAskRevoke: () => void; onRevoke: () => void; onKeep: () => void;
}) {
  const tone = r.status === 'approved' ? TEAL : r.status === 'pending' ? AMBER_INK : FAINT;
  return (
    <div data-staff-row={r.displayName} data-staff-status={r.status} style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 800, color: FAINT }}>요청 이름</p>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: INK, overflowWrap: 'anywhere' }}>{r.displayName}</p>
          <p data-staff-nickname style={{ margin: '2px 0 0', fontSize: 12.5, fontWeight: 700, color: INK_SOFT, overflowWrap: 'anywhere' }}>
            카카오 닉네임 <b>{r.nickname || '(없음)'}</b>
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: tone, padding: '3px 8px', borderRadius: 999, border: `1px solid ${tone}` }}>
            {STATUS_TEXT[r.status]}
          </span>
          {r.revokeCount > 0 && (
            <span data-staff-revoke-count={r.revokeCount} style={{ fontSize: 11.5, fontWeight: 800, color: '#B91C1C' }}>
              이전 회수 · 거절 {r.revokeCount}회
            </span>
          )}
        </div>
      </div>
      {r.status === 'pending' && r.verifyCode && (
        <div data-staff-code={r.verifyCode} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F8FAFC', borderRadius: 10, padding: '8px 10px' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: MUTED, flexShrink: 0 }}>확인 코드</span>
          <span style={{ fontSize: 24, fontWeight: 900, color: INK, letterSpacing: '0.16em', fontVariantNumeric: 'tabular-nums' }}>{r.verifyCode}</span>
        </div>
      )}
      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: MUTED }}>
        요청 {when(r.requestedAt)}
        {r.status === 'approved' && <> · <b style={{ color: TEAL }}>{when(r.expiresAt)}까지 유효</b></>}
        {r.status === 'expired' && <> · {when(r.expiresAt)}에 만료</>}
        {r.status === 'revoked' && r.revokedAt && <> · {when(r.revokedAt)} 회수</>}
      </p>
      {r.status === 'revoked' && (
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: MUTED, wordBreak: 'keep-all' }}>
          다시 쓰려면 현장 운영자가 현장 운영 화면에서 다시 요청해야 합니다(새 확인 코드로 승인).
        </p>
      )}
      {confirming === 'approve' && (
        <p data-staff-approve-check role="alert" style={{ margin: 0, fontSize: 13, fontWeight: 800, color: NAVY, background: '#EAF1F8', borderRadius: 10, padding: '9px 11px', wordBreak: 'keep-all' }}>
          현장 운영자 휴대폰 화면의 확인 코드가 <b style={{ fontSize: 15, letterSpacing: '0.1em' }}>{r.verifyCode}</b> 인지, 이름이 맞는지 직접 확인한 뒤 승인하세요.
        </p>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {r.status === 'pending' && confirming === null && (
          <button type="button" data-staff-action={`approve-${r.displayName}`} disabled={busy} onClick={onAskApprove}
            style={{ ...btn, background: NAVY, borderColor: NAVY, color: '#fff', minWidth: 112, opacity: busy ? 0.6 : 1 }}>
            <Check size={15} strokeWidth={2.6} /> 승인
          </button>
        )}
        {r.status === 'expired' && confirming === null && (
          <button type="button" data-staff-action={`approve-${r.displayName}`} disabled={busy} onClick={onApprove}
            style={{ ...btn, background: NAVY, borderColor: NAVY, color: '#fff', minWidth: 112, opacity: busy ? 0.6 : 1 }}>
            <Check size={15} strokeWidth={2.6} /> {busy ? '처리 중…' : '다시 승인(연장)'}
          </button>
        )}
        {confirming === 'approve' && (
          <>
            <button type="button" data-staff-action={`approve-cancel-${r.displayName}`} disabled={busy} onClick={onKeep} style={btn}>취소</button>
            <button type="button" data-staff-action={`approve-confirm-${r.displayName}`} disabled={busy} onClick={onApprove}
              style={{ ...btn, background: NAVY, borderColor: NAVY, color: '#fff', opacity: busy ? 0.6 : 1 }}>
              <Check size={15} strokeWidth={2.6} /> {busy ? '처리 중…' : '코드 일치 — 승인'}
            </button>
          </>
        )}
        {(r.status === 'pending' || r.status === 'approved') && confirming === null && (
          <button type="button" data-staff-action={`revoke-${r.displayName}`} disabled={busy} onClick={onAskRevoke}
            style={{ ...btn, color: '#B91C1C', borderColor: '#FCA5A5', opacity: busy ? 0.6 : 1 }}>
            {r.status === 'pending' ? '거절' : '권한 회수'}
          </button>
        )}
        {confirming === 'revoke' && (
          <>
            <button type="button" data-staff-action={`revoke-keep-${r.displayName}`} disabled={busy} onClick={onKeep} style={btn}>유지</button>
            <button type="button" data-staff-action={`revoke-confirm-${r.displayName}`} disabled={busy} onClick={onRevoke}
              style={{ ...btn, color: '#fff', background: '#B91C1C', borderColor: '#B91C1C', opacity: busy ? 0.6 : 1 }}>
              {busy ? '처리 중…' : r.status === 'pending' ? '거절 확정' : '회수 확정'}
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" data-staff-error={r.displayName} style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: AMBER_INK, display: 'flex', gap: 5 }}>
          <AlertTriangle size={14} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 2 }} />{error}
        </p>
      )}
    </div>
  );
}

export default function StaffAdminBoard({ slug }: { slug: string }) {
  const [list, setList] = React.useState<StaffAdminList | null>(null);
  const [state, setState] = React.useState<'loading' | 'ready' | 'denied' | 'missing' | 'failed'>('loading');
  const [stale, setStale] = React.useState('');
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [confirming, setConfirming] = React.useState<{ id: string; kind: 'approve' | 'revoke' } | null>(null);
  const [toast, setToast] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [origin, setOrigin] = React.useState('');
  const inflight = React.useRef<Set<string>>(new Set());
  const has = React.useRef(false);
  const seq = React.useRef(0);

  React.useEffect(() => { setOrigin(window.location.origin); }, []);

  const load = React.useCallback(async () => {
    const my = ++seq.current;
    try {
      const r = await fetchStaffAdmin(slug);
      if (my !== seq.current) return;
      if (!r.ready || !r.list) { if (!has.current) setState('denied'); else setStale('권한을 확인할 수 없습니다. 다시 로그인해 주세요.'); return; }
      has.current = true; setList(r.list); setState('ready'); setStale('');
    } catch (e) {
      if (my !== seq.current) return;
      if (!has.current) setState(isStaffMissing(e) ? 'missing' : 'failed');
      else setStale('최신 목록을 불러오지 못했습니다. 화면은 마지막으로 확인된 상태입니다.');
    }
  }, [slug]);

  React.useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);
  useVisibilityResync(() => { void load(); }, { enabled: !!slug });

  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 2600); };

  const act = async (r: StaffAdminRow, kind: 'approve' | 'revoke') => {
    if (inflight.current.has(r.userId)) return;
    inflight.current.add(r.userId);
    setBusy((b) => ({ ...b, [r.userId]: true }));
    setErrors((x) => ({ ...x, [r.userId]: '' }));
    try {
      if (kind === 'approve') {
        // 대기 행 = 본부가 본 확인 코드로 승인(서버가 지금 코드와 대조). 만료 연장 = 코드 없음.
        const exp = await approveStaff(slug, r.userId, r.status === 'pending' ? r.verifyCode : null);
        say(`${r.displayName} 승인 — ${when(exp)}까지`);
      } else {
        await revokeStaff(slug, r.userId);
        say(r.status === 'pending' ? `${r.displayName} 요청을 거절했습니다` : `${r.displayName} 권한을 회수했습니다`);
      }
      setConfirming(null);
    } catch (e) {
      setErrors((x) => ({ ...x, [r.userId]: staffActionMessage(e) }));
      setConfirming(null);   // 코드가 바뀐 경우 등 — 새로 불러온 목록에서 다시 확인하게 한다
    } finally {
      inflight.current.delete(r.userId);
      setBusy((b) => ({ ...b, [r.userId]: false }));
      void load();
    }
  };

  const helperUrl = `${origin}/tournaments/${slug}/staff`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(helperUrl); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
    catch { setCopied(false); say('복사하지 못했습니다. 주소를 길게 눌러 복사해 주세요.'); }
  };

  const Quiet = ({ title, desc }: { title: string; desc?: string }) => (
    <section style={{ ...card, textAlign: 'center', padding: '24px 16px' }}>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: INK_SOFT }}>{title}</p>
      {desc && <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 600, color: MUTED, wordBreak: 'keep-all' }}>{desc}</p>}
    </section>
  );

  const groups: Array<[string, StaffAdminRow[]]> = list ? [
    ['승인 대기', list.staff.filter((r) => r.status === 'pending')],
    ['승인됨', list.staff.filter((r) => r.status === 'approved')],
    ['만료 · 회수 · 종료', list.staff.filter((r) => r.status === 'expired' || r.status === 'revoked' || r.status === 'closed')],
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: INK, display: 'flex', alignItems: 'center', gap: 6 }}>
          <UserPlus size={15} strokeWidth={2.4} /> 현장 운영자에게 보낼 주소
        </p>
        <code data-staff-url style={{ fontSize: 12.5, fontWeight: 700, color: INK_SOFT, overflowWrap: 'anywhere', background: '#F8FAFC', padding: '8px 10px', borderRadius: 8 }}>
          {helperUrl}
        </code>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" data-staff-action="copy-url" onClick={() => { void copy(); }} style={btn}>
            <Copy size={14} strokeWidth={2.4} /> {copied ? '복사됨' : '주소 복사'}
          </button>
          <span style={{ fontSize: 12, fontWeight: 600, color: MUTED, wordBreak: 'keep-all', flex: '1 1 200px' }}>
            현장 운영자가 카카오로 로그인해 이름을 적고 권한을 요청하면 아래 목록에 나타납니다.
          </span>
        </div>
        <ol data-staff-guide style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, fontWeight: 700, color: INK_SOFT, lineHeight: 1.7, wordBreak: 'keep-all' }}>
          <li>현장 운영자가 본부에 직접 와서 휴대폰의 <b>현장 운영 화면</b>을 보여 줍니다.</li>
          <li>그 화면의 <b>요청 이름 · 확인 코드 4자리</b>가 아래 목록과 같은지 대조합니다. 카카오 닉네임도 참고합니다.</li>
          <li>같을 때만 승인합니다. 모르는 요청 · 코드가 다른 요청은 거절합니다. 주소는 단체방에 올리지 말고 현장 운영자에게만 보내 주세요.</li>
        </ol>
        {list?.defaultExpiresAt && (
          <p data-staff-default-expiry style={{ margin: 0, fontSize: 12, fontWeight: 700, color: TEAL }}>
            지금 승인하면 {when(list.defaultExpiresAt)}까지 유효합니다(대회 다음날까지 끊기지 않게 자동 설정).
          </p>
        )}
      </section>

      {stale && (
        <p data-staff-stale style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: AMBER_INK, display: 'flex', gap: 6 }}>
          <AlertTriangle size={14} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 2 }} />{stale}
        </p>
      )}

      {state === 'loading' && <Quiet title="불러오는 중…" />}
      {state === 'denied' && <Quiet title="현장 운영자 목록을 볼 수 없습니다." desc="CEO · ADMIN 계정인지, 대회 주소가 맞는지 확인해 주세요." />}
      {state === 'missing' && <Quiet title="현장 운영자 기능이 아직 서버에 적용되지 않았습니다." desc="현장 운영자 SQL 적용 후 다시 열어 주세요. 경기 운영은 그대로 사용할 수 있습니다." />}
      {state === 'failed' && (
        <section style={{ ...card, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: INK_SOFT }}>목록을 불러오지 못했습니다.</p>
          <button type="button" data-staff-action="retry" onClick={() => { void load(); }} style={{ ...btn, margin: '10px auto 0' }}>
            <RefreshCw size={13} strokeWidth={2.4} /> 다시 시도
          </button>
        </section>
      )}

      {state === 'ready' && list && list.staff.length === 0 && (
        <Quiet title="아직 요청한 현장 운영자가 없습니다." desc="위 주소를 현장 운영자에게 보내 주세요." />
      )}

      {state === 'ready' && groups.map(([title, rows]) => rows.length > 0 && (
        <section key={title} data-staff-group={title} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 900, color: INK }}>{title} <span style={{ color: FAINT }}>{rows.length}</span></p>
          {rows.map((r) => (
            <Row key={r.userId} r={r} busy={!!busy[r.userId]} confirming={confirming?.id === r.userId ? confirming.kind : null} error={errors[r.userId] || ''}
              onAskApprove={() => setConfirming({ id: r.userId, kind: 'approve' })}
              onApprove={() => { void act(r, 'approve'); }}
              onAskRevoke={() => setConfirming({ id: r.userId, kind: 'revoke' })}
              onRevoke={() => { void act(r, 'revoke'); }}
              onKeep={() => setConfirming(null)} />
          ))}
        </section>
      ))}

      <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 600, color: MUTED, lineHeight: 1.7, wordBreak: 'keep-all' }}>
        현장 운영자가 할 수 있는 것: 예선 · 본선 경기 시작(타이머) · 점수 입력과 완료(본선 승자 진출 포함) · 경기 현황 조회.
        팀 체크인 · 코트 배정/투입 · 호명 · 취소 · 점수 정정 · 대진/팀/코트 수정 · 권한 승인/회수는 서버에서 막혀 있으며 본부(CEO · ADMIN)만 할 수 있습니다.
        임원진도 자동 승인되지 않습니다 — 같은 방법으로 신청 · 승인합니다.
      </p>

      {toast && (
        <div role="status" data-staff-toast style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(104px + env(safe-area-inset-bottom, 0px))',
          maxWidth: 'calc(100vw - 32px)', padding: '11px 16px', borderRadius: 10, background: INK, color: '#fff',
          fontSize: 13, fontWeight: 700, zIndex: 130, pointerEvents: 'none', textAlign: 'center', wordBreak: 'keep-all',
        }}>{toast}</div>
      )}
    </div>
  );
}
