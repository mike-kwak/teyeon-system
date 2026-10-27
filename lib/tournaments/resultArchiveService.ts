// TEYEON OPEN 공식 결과 아카이브 — 조회 · 관리 service.
//
//   공개: get_public_tournament_result_editions · get_public_tournament_result (공개 승인된 회차 · 사진/영상만)
//   관리(CEO/ADMIN): get_admin_tournament_result · confirm_tournament_result · amend_tournament_result ·
//                    set_tournament_result_public · save_tournament_result_media · delete_tournament_result_media
//   ⚠ 권한 · 검증 · 불변 보호는 전부 SQL 이 한다. 여기서 흉내 내지 않는다.
//   ⚠ 기록(예선 · 본선 · 입상)은 확정 스냅샷을 그대로 읽는다 — 기존 공개 화면과 같은 해석 함수를 쓴다.
//   ⚠ 사진은 비공개 버킷(tournament-results) — 서명 URL 로만 보인다. 원래 파일 이름은 저장하지 않는다.

import { supabase } from '@/lib/supabase';
import { parsePublicPreliminaryDraw } from './publicDrawService';
import { parsePublicKnockoutBracket, placementNoMapFromDraw, withPublicGroupLabels } from './publicKnockoutService';
import type { PublicKnockoutTeam } from './publicKnockoutTypes';
import type {
  ResultAdminState, ResultArchive, ResultAwards, ResultCheck, ResultCounts, ResultEditionSummary, ResultMedia,
} from './resultArchiveTypes';

export const RESULT_MEDIA_BUCKET = 'tournament-results';
const SIGNED_URL_TTL = 60 * 60; // 1시간

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
const side = (v: unknown): 1 | 2 | null => (v === 1 || v === '1' ? 1 : v === 2 || v === '2' ? 2 : null);

const teamOf = (v: unknown): PublicKnockoutTeam | null => {
  const o = rec(v);
  if (o.teamNo === null || o.teamNo === undefined) return null;
  return { publicKey: str(o.publicKey), teamNo: Number(o.teamNo), player1Name: str(o.player1Name), player2Name: str(o.player2Name), withdrawn: o.withdrawn === true };
};

export function parseAwards(v: unknown): ResultAwards | null {
  const o = rec(v);
  const champ = teamOf(rec(o.champion).team); const runner = teamOf(rec(o.runnerUp).team);
  if (!champ || !runner) return null;
  const f = rec(o.final);
  return {
    champion: { team: champ, matchNo: numOrNull(rec(o.champion).matchNo) },
    runnerUp: { team: runner, matchNo: numOrNull(rec(o.runnerUp).matchNo) },
    final: { matchNo: numOrNull(f.matchNo) ?? 0, score1: numOrNull(f.score1), score2: numOrNull(f.score2), team1: teamOf(f.team1), team2: teamOf(f.team2), winnerSide: side(f.winnerSide) },
    semifinalists: arr(o.semifinalists).flatMap((x) => {
      const s = rec(x); const t = teamOf(s.team);
      return t ? [{ team: t, matchNo: numOrNull(s.matchNo), lostTo: teamOf(s.lostTo), score1: numOrNull(s.score1), score2: numOrNull(s.score2), loserSide: side(s.loserSide) }] : [];
    }),
  };
}

const parseCounts = (v: unknown): ResultCounts | null => {
  const o = rec(v);
  if (!('knockoutMatches' in o)) return null;
  const n = (k: string) => numOrNull(o[k]) ?? 0;
  return { preliminaryMatches: n('preliminaryMatches'), preliminaryCompleted: n('preliminaryCompleted'), knockoutMatches: n('knockoutMatches'),
    knockoutCompleted: n('knockoutCompleted'), firstRoundSlots: n('firstRoundSlots'), byeSlots: n('byeSlots'), entrants: n('entrants') };
};

const parseMedia = (v: unknown): ResultMedia[] => arr(v).flatMap((x) => {
  const m = rec(x);
  const kind = m.kind === 'photo' || m.kind === 'video' ? m.kind : null;
  if (!kind || !str(m.id)) return [];
  return [{
    id: str(m.id), kind, category: str(m.category) as ResultMedia['category'], title: strOrNull(m.title),
    storagePath: strOrNull(m.storagePath), youtubeId: strOrNull(m.youtubeId), displayOrder: numOrNull(m.displayOrder) ?? 0, teamNo: numOrNull(m.teamNo),
    ...(typeof m.isPublic === 'boolean' ? { isPublic: m.isPublic } : {}),
  }];
});

/** 사진에 서명 URL 을 붙인다(한 번에). 실패하면 url=null — 화면은 사진 없이 그린다. */
export async function withSignedUrls(media: ResultMedia[]): Promise<ResultMedia[]> {
  const paths = media.filter((m) => m.kind === 'photo' && m.storagePath).map((m) => m.storagePath as string);
  if (!paths.length) return media;
  try {
    const { data, error } = await supabase.storage.from(RESULT_MEDIA_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
    if (error || !data) return media.map((m) => ({ ...m, url: null }));
    const byPath = new Map(data.map((d) => [d.path ?? '', d.error ? null : d.signedUrl]));
    return media.map((m) => (m.kind === 'photo' ? { ...m, url: byPath.get(m.storagePath ?? '') ?? null } : m));
  } catch {
    return media.map((m) => ({ ...m, url: null }));
  }
}

/** 스냅샷(공개 응답 · 관리자 확정본 공통 모양) → 화면 기록. 순위결정전 공개 번호(19조 → 1조)는 기존 공개 화면과 같은 helper 로. */
export function parseArchiveSnapshot(slug: string, meta: { editionNo: number; editionLabel: string; version: number; confirmedAt: string | null }, snapshot: unknown, media: ResultMedia[]): ResultArchive {
  const s = rec(snapshot); const t = rec(s.tournament);
  const preliminary = parsePublicPreliminaryDraw(s.preliminary);
  const knockout = withPublicGroupLabels(parsePublicKnockoutBracket(s.knockout, slug), placementNoMapFromDraw(preliminary));
  return {
    slug, ...meta,
    tournament: { title: str(t.title), subtitle: strOrNull(t.subtitle), eventDate: strOrNull(t.eventDate), venueName: strOrNull(t.venueName), organizerName: strOrNull(t.organizerName) },
    awards: parseAwards(s.awards), counts: parseCounts(s.counts), preliminary, knockout, media,
  };
}

// ── 공개 ───────────────────────────────────────────────────────────────────

export async function fetchResultEditions(): Promise<ResultEditionSummary[]> {
  const { data, error } = await supabase.rpc('get_public_tournament_result_editions');
  if (error) throw new Error('result editions unavailable');
  return arr(rec(data).editions).map((x) => {
    const e = rec(x);
    return { slug: str(e.slug), editionNo: numOrNull(e.editionNo) ?? 0, editionLabel: str(e.editionLabel), title: str(e.title),
      eventDate: strOrNull(e.eventDate), venueName: strOrNull(e.venueName), champion: teamOf(e.champion) };
  }).filter((e) => e.slug !== '');
}

/** 공개된 회차의 공식 기록. 공개되지 않았으면 null. 조회 실패는 던진다(화면이 '불러오지 못함'으로 구분). */
export async function fetchResultArchive(slug: string): Promise<ResultArchive | null> {
  const { data, error } = await supabase.rpc('get_public_tournament_result', { p_slug: slug });
  if (error) throw new Error('result archive unavailable');
  if (data === null || data === undefined) return null;
  const o = rec(data);
  const media = await withSignedUrls(parseMedia(o.media));
  return parseArchiveSnapshot(slug, { editionNo: numOrNull(o.editionNo) ?? 0, editionLabel: str(o.editionLabel), version: numOrNull(o.version) ?? 1, confirmedAt: strOrNull(o.confirmedAt) }, o.snapshot, media);
}

// ── 관리 ───────────────────────────────────────────────────────────────────

const errCode = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? '');
const isMissing = (e: unknown): boolean => ['PGRST202', '42883'].includes(errCode(e));

export type ResultAdminLoad = { kind: 'ok'; state: ResultAdminState } | { kind: 'forbidden' } | { kind: 'unavailable' } | { kind: 'error' };

export async function fetchResultAdmin(slug: string): Promise<ResultAdminLoad> {
  try {
    const { data, error } = await supabase.rpc('get_admin_tournament_result', { p_slug: slug });
    if (error) return isMissing(error) ? { kind: 'unavailable' } : errCode(error) === '42501' ? { kind: 'forbidden' } : { kind: 'error' };
    if (data === null) return { kind: 'forbidden' };
    const o = rec(data); const a = o.archive ? rec(o.archive) : null; const p = rec(o.preview);
    const media = await withSignedUrls(parseMedia(o.media));
    return {
      kind: 'ok',
      state: {
        tournamentId: str(o.tournamentId),
        archive: a ? { editionNo: numOrNull(a.editionNo) ?? 0, editionLabel: str(a.editionLabel), version: numOrNull(a.version) ?? 1, isPublic: a.isPublic === true,
          confirmedAt: strOrNull(a.confirmedAt), publishedAt: strOrNull(a.publishedAt), snapshotMd5: str(a.snapshotMd5),
          awards: parseAwards(a.awards), counts: parseCounts(a.counts) } : null,
        preview: {
          sourceMd5: str(p.sourceMd5), ok: p.ok === true, matchesArchive: p.matchesArchive === true,
          checks: arr(p.checks).map((c): ResultCheck => { const r = rec(c); return { key: str(r.key), ok: r.ok === true, value: (typeof r.value === 'string' || typeof r.value === 'number') ? r.value : null }; }),
          counts: parseCounts(p.counts), awards: parseAwards(p.awards),
          tournament: p.tournament ? { title: str(rec(p.tournament).title), eventDate: strOrNull(rec(p.tournament).eventDate), venueName: strOrNull(rec(p.tournament).venueName) } : null,
        },
        usedEditionNos: arr(o.usedEditionNos).map((n) => Number(n)).filter(Number.isFinite),
        media,
        history: arr(o.history).map((h) => { const r = rec(h); return { action: str(r.action), at: str(r.at), note: strOrNull(r.note), fromVersion: strOrNull(r.fromVersion), toVersion: strOrNull(r.toVersion) }; }),
      },
    };
  } catch {
    return { kind: 'error' };
  }
}

export type ResultActionResult = { ok: true; data: Record<string, unknown> } | { ok: false; reason: string };

const callAction = async (fn: string, args: Record<string, unknown>): Promise<ResultActionResult> => {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, reason: errCode(error) === '42501' ? 'forbidden' : 'network' };
    const o = rec(data);
    return o.ok === true ? { ok: true, data: o } : { ok: false, reason: str(o.reason) || 'unknown' };
  } catch {
    return { ok: false, reason: 'network' };
  }
};

export const confirmResult = (slug: string, editionNo: number, editionLabel: string, expectedMd5: string) =>
  callAction('confirm_tournament_result', { p_slug: slug, p_edition_no: editionNo, p_edition_label: editionLabel, p_expected_md5: expectedMd5 });
export const amendResult = (slug: string, reason: string, expectedVersion: number, expectedMd5: string) =>
  callAction('amend_tournament_result', { p_slug: slug, p_reason: reason, p_expected_version: expectedVersion, p_expected_md5: expectedMd5 });
export const setResultPublic = (slug: string, isPublic: boolean) =>
  callAction('set_tournament_result_public', { p_slug: slug, p_public: isPublic });
export const saveResultMedia = (slug: string, m: { id: string | null; kind: 'photo' | 'video'; category: string; title: string | null; storagePath: string | null; youtubeId: string | null; isPublic: boolean; displayOrder: number; teamNo: number | null }) =>
  callAction('save_tournament_result_media', { p_slug: slug, p_id: m.id, p_kind: m.kind, p_category: m.category, p_title: m.title,
    p_storage_path: m.storagePath, p_youtube_id: m.youtubeId, p_is_public: m.isPublic, p_display_order: m.displayOrder, p_team_no: m.teamNo });

/** 연결 삭제 → 사진이면 파일도 지운다(파일 삭제 실패는 연결 삭제를 되돌리지 않는다 — 공개되지 않으므로). */
export async function deleteResultMedia(slug: string, id: string): Promise<ResultActionResult> {
  const r = await callAction('delete_tournament_result_media', { p_slug: slug, p_id: id });
  if (r.ok && typeof r.data.storagePath === 'string' && r.data.storagePath) {
    try { await supabase.storage.from(RESULT_MEDIA_BUCKET).remove([r.data.storagePath]); } catch { /* 파일은 남아도 공개되지 않는다 */ }
  }
  return r;
}

export const RESULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 2400;

/**
 * 사진 업로드 — 긴 변 2400px 이하 · WebP(지원 안 하면 JPEG)로 줄여 올린다. 경로 = <tournamentId>/<uuid>.<ext>.
 *   ⚠ 원래 파일 이름은 쓰지 않는다. 올린 뒤 save_tournament_result_media 로 연결해야 화면에 쓰인다.
 */
export async function uploadResultPhoto(tournamentId: string, file: File): Promise<{ ok: true; path: string } | { ok: false; reason: string; detail?: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { ok: false, reason: 'type' };
  if (file.size > 30 * 1024 * 1024) return { ok: false, reason: 'size' };
  let blob: Blob = file; let ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.86));
    if (out && out.type === 'image/webp') { blob = out; ext = 'webp'; }
    else { const jpg = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.88)); if (jpg) { blob = jpg; ext = 'jpg'; } }
  } catch { /* 줄이기 실패 — 원본 그대로(크기 제한은 서버가 다시 본다) */ }
  if (blob.size > RESULT_MAX_UPLOAD_BYTES) return { ok: false, reason: 'size' };
  const path = `${tournamentId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(RESULT_MEDIA_BUCKET).upload(path, blob, {
    contentType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', upsert: false, cacheControl: '3600',
  });
  return error ? { ok: false, reason: 'upload', detail: error.message } : { ok: true, path };
}

/** 사진 올리기 실패 → 운영자 안내(서버가 준 원인을 쉬운 말로). */
export function photoUploadMessage(reason: string, detail?: string): string {
  if (reason === 'type') return 'JPEG · PNG · WebP 사진만 올릴 수 있습니다.';
  if (reason === 'size') return '사진이 너무 큽니다. 10MB 이하로 줄여 다시 올려 주세요.';
  const d = detail ?? '';
  if (/row-level security|unauthori[sz]ed|permission|403/i.test(d)) return '사진을 올릴 권한이 없습니다. CEO · ADMIN 계정으로 다시 로그인해 주세요.';
  if (/bucket not found/i.test(d)) return '사진 저장소(tournament-results)를 찾지 못했습니다. 저장소 SQL 적용 상태를 확인해 주세요.';
  if (/payload too large|exceed|maximum allowed size/i.test(d)) return '사진이 저장소 크기 제한(10MB)을 넘었습니다.';
  if (/mime|content type|invalid.*type/i.test(d)) return '이 형식의 파일은 저장소가 받지 않습니다(JPEG · PNG · WebP).';
  if (/fetch|network|timeout/i.test(d)) return '네트워크 문제로 사진을 올리지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.';
  return `사진을 올리지 못했습니다${d ? `(${d.slice(0, 120)})` : ''}.`;
}

export const RESULT_ACTION_MESSAGE: Record<string, string> = {
  forbidden: 'CEO · ADMIN 만 할 수 있습니다.',
  network: '서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  stale_preview: '그 사이 기록이 바뀌었습니다. 미리보기를 다시 확인한 뒤 진행해 주세요.',
  already_confirmed: '이미 공식 결과가 확정된 대회입니다.',
  edition_taken: '이미 다른 대회가 쓰는 회차 번호입니다.',
  invalid_edition: '회차 번호와 회차 이름을 확인해 주세요.',
  validation_failed: '검증 항목 중 통과하지 못한 것이 있어 확정할 수 없습니다.',
  reason_required: '정정 사유를 5자 이상 적어 주세요.',
  stale_version: '다른 관리자가 먼저 바꿨습니다. 새로고침 뒤 다시 시도해 주세요.',
  no_change: '확정된 기록과 지금 기록이 같아 정정할 것이 없습니다.',
  not_confirmed: '먼저 공식 결과를 확정해야 합니다.',
  invalid_path: '사진 경로가 올바르지 않습니다.',
  invalid_media: '사진 · 영상 정보가 올바르지 않습니다(분류 · YouTube 주소 확인).',
  not_found: '대상을 찾지 못했습니다. 새로고침해 주세요.',
  tournament_not_found: '대회를 찾지 못했습니다.',
  team_required: '공동 3위 사진은 어느 팀 사진인지 먼저 골라 주세요.',
  team_mismatch: '고른 팀이 공식 결과의 그 입상팀이 아닙니다. 새로고침 뒤 다시 골라 주세요.',
};
export const resultActionMessage = (reason: string) => RESULT_ACTION_MESSAGE[reason] ?? `처리하지 못했습니다(${reason}).`;
