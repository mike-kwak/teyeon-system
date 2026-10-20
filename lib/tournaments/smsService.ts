// 대회 문자 안내 센터 — 관리자 RPC 호출.
//
//   ⚠ 연락처는 기존 관리자 RPC(get_admin_tournament_registrations · CEO/ADMIN 전용)를 그대로 읽는다. 새 공개 경로 없음.
//   ⚠ 실패를 빈 목록으로 바꾸지 않는다(0명으로 보이면 사고) — 호출한 쪽이 오류를 화면에 띄운다.
//   ⚠ 오류 로그에 전화번호 · 응답 원문을 남기지 않는다(코드 · 사유만).

import { supabase } from '@/lib/supabase';
import type {
  SmsRegistration, SmsTeam, SmsTemplateKey, SmsUrlKey, Snapshot, SnapshotEntry, StoredTemplate,
} from './smsModel';

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

export class SmsError extends Error {
  reason: string;
  code: string;
  payload: Record<string, unknown>;
  constructor(reason: string, code = '', payload: Record<string, unknown> = {}) {
    super(reason || code || 'failed');
    this.reason = reason; this.code = code; this.payload = payload;
  }
}

const isMissingFunction = (e: { code?: string; message?: string } | null): boolean =>
  !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|does not exist/i.test(e.message || ''));

const fail = (e: { code?: string; message?: string }): never => {
  throw new SmsError(isMissingFunction(e) ? 'missing_function' : '', e.code || '', {});
};

// ── 연락처 원본(읽기만) ─────────────────────────────────────────────────────────
export async function fetchSmsRegistrations(slug: string): Promise<SmsRegistration[]> {
  const { data, error } = await supabase.rpc('get_admin_tournament_registrations', { p_slug: slug });
  if (error) fail(error);
  return arr(data).map((x) => {
    const r = rec(x);
    return {
      id: str(r.id), sequenceNo: num(r.sequenceNo), registrationNo: str(r.registrationNo),
      player1Name: str(r.player1Name), player1Phone: str(r.player1Phone),
      player2Name: str(r.player2Name), player2Phone: str(r.player2Phone),
      registrationStatus: str(r.registrationStatus), paymentStatus: str(r.paymentStatus),
    };
  });
}

/** 팀 번호 · 기권 여부. 권한이 없으면 RPC 가 null — 조회 불가로 본다. */
export async function fetchSmsTeams(slug: string): Promise<SmsTeam[]> {
  const { data, error } = await supabase.rpc('get_admin_tournament_teams', { p_slug: slug });
  if (error) fail(error);
  if (data === null || data === undefined) throw new SmsError('forbidden');
  return arr(data).map((x) => {
    const r = rec(x);
    return { registrationId: strOrNull(r.registrationId), teamNo: num(r.teamNo), status: str(r.status) || 'active' };
  });
}

// ── 문자 센터 설정 ─────────────────────────────────────────────────────────────
export interface SmsLog {
  id: string;
  templateKey: string;
  templateTitle: string | null;
  audience: string | null;
  batchLabel: string | null;
  recipientCount: number;
  status: 'copied' | 'sent' | 'void';
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  mine: boolean;
  statusChangedAt: string | null;
}

export interface SmsCenterData {
  templates: Partial<Record<SmsTemplateKey, StoredTemplate>>;
  urls: Partial<Record<SmsUrlKey, string>>;
  urlUpdatedAt: Partial<Record<SmsUrlKey, string>>;
  snapshot: Snapshot | null;
  snapshotVersion: number;
  logs: SmsLog[];
}

export type SmsCenterLoad =
  | { state: 'ok'; data: SmsCenterData }
  | { state: 'missing' }      // SQL 미적용
  | { state: 'forbidden' };   // 권한 없음 · 세션 만료(null 응답)

export async function fetchSmsCenter(slug: string): Promise<SmsCenterLoad> {
  const { data, error } = await supabase.rpc('get_admin_sms_center', { p_slug: slug });
  if (error) {
    if (isMissingFunction(error)) return { state: 'missing' };
    fail(error);
  }
  if (data === null || data === undefined) return { state: 'forbidden' };
  const o = rec(data);
  const templates: SmsCenterData['templates'] = {};
  Object.entries(rec(o.templates)).forEach(([k, v]) => {
    const t = rec(v);
    templates[k as SmsTemplateKey] = { title: strOrNull(t.title), body: strOrNull(t.body), version: num(t.version), updatedAt: strOrNull(t.updatedAt) };
  });
  const urls: SmsCenterData['urls'] = {}; const urlUpdatedAt: SmsCenterData['urlUpdatedAt'] = {};
  Object.entries(rec(o.urls)).forEach(([k, v]) => {
    const u = rec(v);
    if (str(u.url)) { urls[k as SmsUrlKey] = str(u.url); urlUpdatedAt[k as SmsUrlKey] = str(u.updatedAt); }
  });
  const sn = o.snapshot ? rec(o.snapshot) : null;
  const snapshot: Snapshot | null = sn ? {
    entries: arr(sn.entries).map((x) => {
      const e = rec(x);
      return { r: str(e.r), s: (num(e.s) === 2 ? 2 : 1) as 1 | 2, h: str(e.h), x: e.x === true };
    }),
    recipientCount: num(sn.recipientCount),
    createdAt: strOrNull(sn.createdAt),
    createdByName: strOrNull(sn.createdByName),
  } : null;
  const logs: SmsLog[] = arr(o.logs).map((x) => {
    const l = rec(x);
    const st = str(l.status);
    return {
      id: str(l.id), templateKey: str(l.templateKey), templateTitle: strOrNull(l.templateTitle), audience: strOrNull(l.audience),
      batchLabel: strOrNull(l.batchLabel), recipientCount: num(l.recipientCount),
      status: (st === 'sent' || st === 'void' ? st : 'copied'), note: strOrNull(l.note), createdAt: str(l.createdAt),
      createdByName: strOrNull(l.createdByName), mine: l.mine === true, statusChangedAt: strOrNull(l.statusChangedAt),
    };
  });
  return { state: 'ok', data: { templates, urls, urlUpdatedAt, snapshot, snapshotVersion: num(o.snapshotVersion), logs } };
}

const okOrThrow = (data: unknown): Record<string, unknown> => {
  const o = rec(data);
  if (o.ok !== true) throw new SmsError(str(o.reason) || 'failed', '', o);
  return o;
};

export async function saveSmsTemplate(slug: string, key: SmsTemplateKey, title: string, body: string, expectedVersion: number, reset = false): Promise<{ version: number; updatedAt: string }> {
  const { data, error } = await supabase.rpc('save_sms_template', {
    p_slug: slug, p_key: key, p_title: reset ? null : title, p_body: reset ? null : body, p_expected_version: expectedVersion, p_reset: reset,
  });
  if (error) fail(error);
  const o = okOrThrow(data);
  return { version: num(o.version), updatedAt: str(o.updatedAt) };
}

export async function saveSmsUrl(slug: string, key: SmsUrlKey, url: string): Promise<void> {
  const { data, error } = await supabase.rpc('save_sms_url', { p_slug: slug, p_key: key, p_url: url });
  if (error) fail(error);
  okOrThrow(data);
}

export async function saveSmsSnapshot(slug: string, entries: SnapshotEntry[] | null, recipientCount: number | null, expectedVersion: number): Promise<{ version: number }> {
  const { data, error } = await supabase.rpc('save_sms_snapshot', {
    p_slug: slug, p_entries: entries, p_recipient_count: recipientCount, p_expected_version: expectedVersion,
  });
  if (error) fail(error);
  const o = okOrThrow(data);
  return { version: num(o.version) };
}

export interface AddLogInput {
  clientKey: string; templateKey: string; templateTitle: string; audience: string; batchLabel: string;
  recipientCount: number; status: 'copied' | 'sent'; note?: string | null;
}

/** 기록 추가. 같은 키가 이미 있으면 { duplicate: true, id, status } 를 돌려준다(오류 아님). */
export async function addSmsLog(slug: string, v: AddLogInput): Promise<{ id: string; duplicate: boolean; status: string }> {
  const { data, error } = await supabase.rpc('add_sms_log', {
    p_slug: slug, p_client_key: v.clientKey, p_template_key: v.templateKey, p_template_title: v.templateTitle.slice(0, 60),
    p_audience: v.audience.slice(0, 120), p_batch_label: v.batchLabel.slice(0, 60), p_recipient_count: v.recipientCount,
    p_status: v.status, p_note: v.note ?? null,
  });
  if (error) fail(error);
  const o = rec(data);
  if (o.ok === true) return { id: str(o.id), duplicate: false, status: v.status };
  if (o.reason === 'duplicate') return { id: str(o.id), duplicate: true, status: str(o.status) };
  throw new SmsError(str(o.reason) || 'failed', '', o);
}

export async function setSmsLogStatus(slug: string, logId: string, status: 'copied' | 'sent' | 'void', note?: string | null): Promise<void> {
  const { data, error } = await supabase.rpc('set_sms_log_status', { p_slug: slug, p_log_id: logId, p_status: status, p_note: note ?? null });
  if (error) fail(error);
  okOrThrow(data);
}

/** 오류 → 운영자 문장. 원문(서버 메시지)은 보여주지 않는다. */
export function smsErrorMessage(err: unknown): string {
  const e = err as { reason?: string; code?: string } | null;
  const reason = e?.reason || '';
  const code = e?.code || '';
  if (code === '42501' || reason === 'forbidden') return '권한이 없거나 로그인이 만료되었습니다. 다시 로그인해 주세요.';
  if (code === 'PGRST301' || code === '401') return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
  switch (reason) {
    case 'missing_function': return '문자 센터 SQL 이 아직 적용되지 않았습니다.';
    case 'version_conflict': return '다른 관리자가 먼저 저장했습니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.';
    case 'invalid_title': return '제목은 1~60자로 입력해 주세요.';
    case 'invalid_body': return '본문은 1~2,000자로 입력해 주세요.';
    case 'invalid_url': return 'https:// 로 시작하는 올바른 주소만 저장할 수 있습니다.';
    case 'invalid_key': return '알 수 없는 항목입니다.';
    case 'invalid_entries': return '주소록 확정 데이터가 올바르지 않습니다.';
    case 'invalid_status': case 'invalid_input': return '입력값이 올바르지 않습니다.';
    case 'log_not_found': return '해당 발송 기록을 찾을 수 없습니다.';
    case 'tournament_not_found': return '대회를 찾을 수 없습니다.';
    default: return '처리하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.';
  }
}
