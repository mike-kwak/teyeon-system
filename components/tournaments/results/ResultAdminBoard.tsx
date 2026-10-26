'use client';

// 공식 결과 아카이브 — 관리자(CEO · ADMIN) 화면 본문.
//
//   ① 상태 ② 검증 미리보기(지금 LIVE 기록으로 만들 공식 기록 · 검증 8항목 · 입상) ③ 확정(1회, 미리보기 지문과 같아야)
//   ④ 공개 · 비공개 ⑤ 정정(사유 필수 — LIVE 기록을 정식 절차로 고친 뒤에만) ⑥ 시상 사진 · 영상 ⑦ 이력.
//   ⚠ 경기 · 대진 · 점수를 바꾸는 버튼은 없다. 확정은 자동으로 하지 않는다.

import React from 'react';
import Link from 'next/link';
import { CheckCircle2, Eye, EyeOff, ImagePlus, Lock, RefreshCw, Trash2, TriangleAlert, Video } from 'lucide-react';
import {
  amendResult, confirmResult, deleteResultMedia, fetchResultAdmin, resultActionMessage, saveResultMedia, setResultPublic, uploadResultPhoto,
} from '@/lib/tournaments/resultArchiveService';
import { parseYouTubeVideoId } from '@/lib/tournaments/youtube';
import { RESULT_PHOTO_CATEGORIES, RESULT_VIDEO_CATEGORIES } from '@/lib/tournaments/resultArchiveTypes';
import type { ResultAdminState, ResultAwards, ResultMedia } from '@/lib/tournaments/resultArchiveTypes';
import type { ResultAdminLoad } from '@/lib/tournaments/resultArchiveService';

const INK = '#0F172A'; const MUTED = '#64748B'; const LINE = '#E2E8F0'; const TEAL = '#0E8C80'; const NAVY = '#102A3D';
const WARN_BG = '#FFF7ED'; const WARN = '#9A3412'; const OK_BG = '#ECFDF5';
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 };
const h: React.CSSProperties = { margin: 0, fontSize: 14.5, fontWeight: 900, color: INK };
const btn = (primary = false, danger = false): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 38, padding: '7px 13px', borderRadius: 9,
  border: `1px solid ${primary ? NAVY : danger ? '#FCA5A5' : LINE}`, background: primary ? NAVY : '#fff', color: primary ? '#fff' : danger ? '#B91C1C' : '#334155',
  fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
});
// ⚠ 관리자 화면 바탕 글자색을 물려받지 않게 글자색 · 배경을 직접 정한다.
const input: React.CSSProperties = { minHeight: 38, padding: '7px 10px', borderRadius: 9, border: `1px solid ${LINE}`, fontSize: 14, fontFamily: 'inherit', minWidth: 0, color: INK, background: '#fff' };

const CHECK_LABEL: Record<string, string> = {
  prelim_published: '예선 기록 공개 상태', prelim_all_completed: '예선 전체 경기 완료', groups_final: '예선 조별 순위 확정(FINAL)',
  knockout_published: '본선 대진 공개 상태', knockout_completed: '본선 대진 종료', knockout_all_completed: '본선 전체 경기 완료',
  advancement_consistent: '본선 승자 진출 정합성', awards_resolved: '우승 · 준우승 · 공동 3위 판별',
};
const ACTION_LABEL: Record<string, string> = {
  result_archive_confirmed: '공식 결과 확정', result_archive_amended: '공식 기록 정정', result_archive_published: '공개', result_archive_unpublished: '비공개',
};
const pad2 = (n: number) => String(n).padStart(2, '0');
const tn = (t: { player1Name: string; player2Name: string; teamNo: number } | null) => (t ? `${t.player1Name} · ${t.player2Name} (TEAM ${pad2(t.teamNo)})` : '-');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

function AwardsList({ a }: { a: ResultAwards | null }) {
  if (!a) return <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: WARN }}>입상팀을 판별할 수 없습니다(결승 · 4강 기록 확인 필요).</p>;
  return (
    <ul data-result-admin-awards style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.8, color: INK }}>
      <li><b>우승</b> {tn(a.champion.team)} — 결승 MATCH {pad2(a.final.matchNo)} {a.final.score1}:{a.final.score2}</li>
      <li><b>준우승</b> {tn(a.runnerUp.team)}</li>
      {a.semifinalists.map((s) => <li key={s.team.teamNo}><b>공동 3위</b> {tn(s.team)} — 4강 MATCH {s.matchNo ? pad2(s.matchNo) : '-'}</li>)}
    </ul>
  );
}

function MediaRow({ m, busy, onTogglePublic, onDelete }: { m: ResultMedia; busy: boolean; onTogglePublic: () => void; onDelete: () => void }) {
  const cat = [...RESULT_PHOTO_CATEGORIES, ...RESULT_VIDEO_CATEGORIES].find(([k]) => k === m.category)?.[1] ?? m.category;
  return (
    <li data-result-media={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${LINE}` }}>
      <div style={{ width: 64, height: 44, borderRadius: 8, overflow: 'hidden', background: '#F1F5F9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {m.kind === 'photo' && m.url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : m.kind === 'video' && m.youtubeId
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={`https://i.ytimg.com/vi/${encodeURIComponent(m.youtubeId)}/default.jpg`} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <ImagePlus size={16} color={MUTED} />}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: INK, overflowWrap: 'anywhere' }}>{cat}{m.title ? ` · ${m.title}` : ''}</p>
        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: m.isPublic ? TEAL : MUTED }}>{m.isPublic ? '공개 승인' : '비공개(관리자만)'}</p>
      </div>
      <button type="button" style={btn()} disabled={busy} onClick={onTogglePublic} aria-label={m.isPublic ? '비공개로' : '공개 승인'}>
        {m.isPublic ? <EyeOff size={14} /> : <Eye size={14} />}{m.isPublic ? '비공개' : '공개'}
      </button>
      <button type="button" style={btn(false, true)} disabled={busy} onClick={onDelete} aria-label="삭제"><Trash2 size={14} /></button>
    </li>
  );
}

export default function ResultAdminBoard({ slug }: { slug: string }) {
  const [load, setLoad] = React.useState<ResultAdminLoad | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [notice, setNotice] = React.useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [editionNo, setEditionNo] = React.useState('');
  const [editionLabel, setEditionLabel] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [photo, setPhoto] = React.useState<{ category: string; title: string; isPublic: boolean; file: File | null }>({ category: 'champion', title: '', isPublic: false, file: null });
  const [video, setVideo] = React.useState<{ category: string; title: string; url: string; isPublic: boolean }>({ category: 'highlight', title: '', url: '', isPublic: false });
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const reload = React.useCallback(async () => {
    const r = await fetchResultAdmin(slug);
    setLoad(r);
    if (r.kind === 'ok' && !r.state.archive) {
      const next = Math.max(0, ...r.state.usedEditionNos) + 1;
      setEditionNo((v) => v || String(next)); setEditionLabel((v) => v || `제${next}회`);
    }
  }, [slug]);
  React.useEffect(() => { void reload(); }, [reload]);

  const run = async (fn: () => Promise<{ ok: boolean; text: string }>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    try { const r = await fn(); setNotice({ tone: r.ok ? 'ok' : 'error', text: r.text }); await reload(); }
    finally { busyRef.current = false; setBusy(false); }
  };

  if (load === null) return <p style={{ fontSize: 13, color: MUTED }}>불러오는 중…</p>;
  if (load.kind === 'unavailable') return <div style={card}><p style={h}>공식 결과 아카이브 기능이 서버에 아직 적용되지 않았습니다.</p><p style={{ margin: 0, fontSize: 13, color: MUTED }}>SQL 적용 후 이 화면을 사용할 수 있습니다.</p></div>;
  if (load.kind === 'forbidden') return <div style={card}><p style={h}>CEO · ADMIN 만 사용할 수 있습니다.</p></div>;
  if (load.kind === 'error') return <div style={card}><p style={h}>불러오지 못했습니다.</p><button type="button" style={btn()} onClick={() => void reload()}><RefreshCw size={14} />다시 시도</button></div>;
  const s: ResultAdminState = load.state;
  const a = s.archive; const p = s.preview;
  const photos = s.media.filter((m) => m.kind === 'photo'); const videos = s.media.filter((m) => m.kind === 'video');

  const doConfirm = () => run(async () => {
    const no = Number(editionNo);
    if (!Number.isInteger(no) || no < 1 || !editionLabel.trim()) return { ok: false, text: '회차 번호 · 회차 이름을 확인해 주세요.' };
    const summary = p.awards ? `우승 ${tn(p.awards.champion.team)}\n준우승 ${tn(p.awards.runnerUp.team)}\n공동 3위 ${p.awards.semifinalists.map((x) => tn(x.team)).join(' / ')}` : '';
    if (!window.confirm(`${p.tournament?.title ?? slug} 을(를) ${editionLabel.trim()}(회차 ${no}) 공식 결과로 확정합니다.\n\n${summary}\n\n예선 ${p.counts?.preliminaryMatches}경기 · 본선 ${p.counts?.knockoutMatches}경기\n확정 뒤에는 이 기록이 고정되며, 정정은 사유를 남기는 별도 절차로만 할 수 있습니다.`)) return { ok: false, text: '확정을 취소했습니다.' };
    const r = await confirmResult(slug, no, editionLabel.trim(), p.sourceMd5);
    return r.ok ? { ok: true, text: '공식 결과를 확정했습니다. 공개하려면 [공개]를 누르세요.' } : { ok: false, text: resultActionMessage(r.reason) };
  });
  const doPublic = (on: boolean) => run(async () => {
    if (!window.confirm(on ? '공식 결과를 참가자 화면(RESULTS)에 공개합니다.' : '공식 결과를 비공개로 돌립니다. 참가자 화면에서 보이지 않게 됩니다.')) return { ok: false, text: '취소했습니다.' };
    const r = await setResultPublic(slug, on);
    return r.ok ? { ok: true, text: on ? '공개했습니다.' : '비공개로 돌렸습니다.' } : { ok: false, text: resultActionMessage(r.reason) };
  });
  const doAmend = () => run(async () => {
    if (!a) return { ok: false, text: resultActionMessage('not_confirmed') };
    if (reason.trim().length < 5) return { ok: false, text: resultActionMessage('reason_required') };
    if (!window.confirm(`지금 LIVE 기록으로 공식 기록을 정정합니다(버전 ${a.version} → ${a.version + 1}).\n이전 기록은 이력에 그대로 보관됩니다.\n\n사유: ${reason.trim()}`)) return { ok: false, text: '정정을 취소했습니다.' };
    const r = await amendResult(slug, reason.trim(), a.version, p.sourceMd5);
    if (r.ok) setReason('');
    return r.ok ? { ok: true, text: '공식 기록을 정정했습니다.' } : { ok: false, text: resultActionMessage(r.reason) };
  });
  const doUploadPhoto = () => run(async () => {
    if (!photo.file) return { ok: false, text: '사진 파일을 골라 주세요.' };
    const up = await uploadResultPhoto(s.tournamentId, photo.file);
    if (!up.ok) return { ok: false, text: up.reason === 'type' ? 'JPEG · PNG · WebP 사진만 올릴 수 있습니다.' : up.reason === 'size' ? '사진이 너무 큽니다(10MB 이하로 줄여 주세요).' : '사진을 올리지 못했습니다.' };
    const r = await saveResultMedia(slug, { id: null, kind: 'photo', category: photo.category, title: photo.title.trim() || null, storagePath: up.path, youtubeId: null, isPublic: photo.isPublic, displayOrder: photos.length + 1 });
    if (r.ok) { setPhoto({ category: photo.category, title: '', isPublic: false, file: null }); if (fileRef.current) fileRef.current.value = ''; }
    return r.ok ? { ok: true, text: '사진을 연결했습니다.' } : { ok: false, text: resultActionMessage(r.reason) };
  });
  const doAddVideo = () => run(async () => {
    const yt = parseYouTubeVideoId(video.url);
    if (!yt.ok) return { ok: false, text: 'YouTube 영상 주소(watch · youtu.be · shorts)를 붙여 넣어 주세요.' };
    const r = await saveResultMedia(slug, { id: null, kind: 'video', category: video.category, title: video.title.trim() || null, storagePath: null, youtubeId: yt.videoId, isPublic: video.isPublic, displayOrder: videos.length + 1 });
    if (r.ok) setVideo({ category: video.category, title: '', url: '', isPublic: false });
    return r.ok ? { ok: true, text: '영상을 연결했습니다.' } : { ok: false, text: resultActionMessage(r.reason) };
  });
  const toggleMedia = (m: ResultMedia) => run(async () => {
    const r = await saveResultMedia(slug, { id: m.id, kind: m.kind, category: m.category, title: m.title, storagePath: m.storagePath, youtubeId: m.youtubeId, isPublic: !m.isPublic, displayOrder: m.displayOrder });
    return r.ok ? { ok: true, text: m.isPublic ? '비공개로 돌렸습니다.' : '공개 승인했습니다.' } : { ok: false, text: resultActionMessage(r.reason) };
  });
  const removeMedia = (m: ResultMedia) => run(async () => {
    if (!window.confirm(m.kind === 'photo' ? '이 사진 연결과 파일을 지웁니다.' : '이 영상 연결을 지웁니다(YouTube 영상은 그대로).')) return { ok: false, text: '취소했습니다.' };
    const r = await deleteResultMedia(slug, m.id);
    return r.ok ? { ok: true, text: '지웠습니다.' } : { ok: false, text: resultActionMessage(r.reason) };
  });

  return (
    <div data-result-admin={a ? (a.isPublic ? 'public' : 'confirmed') : 'draft'} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {notice && <p role="status" data-result-admin-notice={notice.tone} style={{ margin: 0, padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 800, background: notice.tone === 'ok' ? OK_BG : WARN_BG, color: notice.tone === 'ok' ? '#065F46' : WARN, whiteSpace: 'pre-line' }}>{notice.text}</p>}

      {/* ① 상태 */}
      <section style={card}>
        <p style={h}>상태</p>
        {a ? (
          <div style={{ fontSize: 13.5, lineHeight: 1.8, color: INK }}>
            <p style={{ margin: 0 }}><Lock size={14} style={{ verticalAlign: '-2px' }} /> <b>{a.editionLabel}</b>(회차 {a.editionNo}) 공식 결과 확정 · 버전 {a.version} · {when(a.confirmedAt)}</p>
            <p style={{ margin: 0, color: a.isPublic ? TEAL : MUTED, fontWeight: 800 }}>{a.isPublic ? `참가자 화면에 공개 중(${when(a.publishedAt)})` : '비공개 — 참가자 화면에 보이지 않습니다.'}</p>
          </div>
        ) : <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: MUTED }}>아직 공식 결과가 확정되지 않았습니다. 아래 검증을 확인한 뒤 확정하세요.</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {a && <button type="button" data-result-action={a.isPublic ? 'unpublish' : 'publish'} style={btn(!a.isPublic)} disabled={busy} onClick={() => void doPublic(!a.isPublic)}>{a.isPublic ? <EyeOff size={14} /> : <Eye size={14} />}{a.isPublic ? '비공개로' : '공개'}</button>}
          <Link href={`/tournaments/${slug}/results`} target="_blank" style={{ ...btn(), textDecoration: 'none' }}>참가자 화면 열기</Link>
          <button type="button" style={btn()} disabled={busy} onClick={() => void reload()}><RefreshCw size={14} />새로고침</button>
        </div>
      </section>

      {/* ② 검증 미리보기 */}
      <section style={card} data-result-preview={p.ok ? 'ok' : 'fail'}>
        <p style={h}>{a ? '지금 LIVE 기록 검증(확정 기록과 비교)' : '공식 결과 미리보기 · 검증'}</p>
        {a && (p.matchesArchive
          ? <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: TEAL }}><CheckCircle2 size={14} style={{ verticalAlign: '-2px' }} /> 지금 LIVE 기록과 확정 기록이 같습니다.</p>
          : <p role="alert" style={{ margin: 0, fontSize: 13, fontWeight: 800, color: WARN }}><TriangleAlert size={14} style={{ verticalAlign: '-2px' }} /> 지금 LIVE 기록이 확정 기록과 다릅니다. 공개 화면은 확정 기록 그대로입니다. 의도한 정정이면 아래 ⑤에서 정정하세요.</p>)}
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
          {p.checks.map((c) => {
            const v = c.key === 'advancement_consistent' ? (c.value !== null ? `불일치 ${c.value}건` : null)
              : c.key === 'knockout_completed' ? null : c.value;
            return (
              <li key={c.key} data-result-check={c.key} data-ok={c.ok ? '1' : '0'} style={{ fontSize: 13, fontWeight: 700, color: c.ok ? INK : WARN }}>
                {c.ok ? '✓' : '✗'} {CHECK_LABEL[c.key] ?? c.key}{v !== null ? ` (${v})` : ''}
              </li>
            );
          })}
        </ul>
        {p.counts && <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: MUTED }}>예선 {p.counts.preliminaryMatches}경기 · 본선 {p.counts.knockoutMatches}경기 · 64강 자리 {p.counts.firstRoundSlots}(BYE {p.counts.byeSlots}) · 본선 진출 {p.counts.entrants}팀</p>}
        <AwardsList a={p.awards} />
      </section>

      {/* ③ 확정 */}
      {!a && (
        <section style={card}>
          <p style={h}>공식 결과 확정</p>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: MUTED, lineHeight: 1.7 }}>위 미리보기 그대로 공식 기록으로 고정합니다. 확정 직전 서버가 같은 기록인지 다시 확인합니다(그 사이 바뀌면 거부). 확정은 1회만 할 수 있습니다.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: 12.5, fontWeight: 800, color: MUTED }}>회차 번호 <input data-result-edition-no style={{ ...input, width: 72 }} inputMode="numeric" value={editionNo} onChange={(e) => setEditionNo(e.target.value.replace(/\D/g, ''))} /></label>
            <label style={{ fontSize: 12.5, fontWeight: 800, color: MUTED }}>회차 이름 <input data-result-edition-label style={{ ...input, width: 110 }} maxLength={40} value={editionLabel} onChange={(e) => setEditionLabel(e.target.value)} /></label>
            <button type="button" data-result-action="confirm" style={btn(true)} disabled={busy || !p.ok} onClick={() => void doConfirm()}><Lock size={14} />공식 결과 확정</button>
          </div>
          {!p.ok && <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: WARN }}>검증 항목 중 통과하지 못한 것이 있어 확정할 수 없습니다.</p>}
        </section>
      )}

      {/* ⑤ 정정 */}
      {a && !p.matchesArchive && (
        <section style={card}>
          <p style={h}>공식 기록 정정</p>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: MUTED, lineHeight: 1.7 }}>경기 기록을 정식 절차(점수 정정 등)로 고친 경우에만 사용합니다. 지금 LIVE 기록으로 공식 기록을 바꾸고, 이전 기록 전체와 사유를 이력에 남깁니다.</p>
          <input data-result-amend-reason style={input} maxLength={200} placeholder="정정 사유(5자 이상)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div><button type="button" data-result-action="amend" style={btn(true)} disabled={busy || !p.ok} onClick={() => void doAmend()}>정정 반영</button></div>
        </section>
      )}

      {/* ⑥ 사진 */}
      <section style={card}>
        <p style={h}><ImagePlus size={15} style={{ verticalAlign: '-2px' }} /> 시상 사진</p>
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: MUTED, lineHeight: 1.7 }}>JPEG · PNG · WebP. 올릴 때 긴 변 2400px 로 줄여 저장합니다. 참가자 초상권 · 공개 동의를 확인한 사진만 [공개 승인]하세요. 승인 전 사진은 관리자만 볼 수 있습니다.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select style={input} value={photo.category} onChange={(e) => setPhoto({ ...photo, category: e.target.value })} aria-label="사진 분류">
            {RESULT_PHOTO_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input style={{ ...input, flex: '1 1 160px' }} maxLength={80} placeholder="설명(선택)" value={photo.title} onChange={(e) => setPhoto({ ...photo, title: e.target.value })} />
          <input ref={fileRef} data-result-photo-file type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto({ ...photo, file: e.target.files?.[0] ?? null })} style={{ fontSize: 13, maxWidth: '100%' }} />
          <label style={{ fontSize: 13, fontWeight: 700, color: INK, display: 'inline-flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={photo.isPublic} onChange={(e) => setPhoto({ ...photo, isPublic: e.target.checked })} />바로 공개 승인</label>
          <button type="button" data-result-action="upload-photo" style={btn(true)} disabled={busy || !photo.file} onClick={() => void doUploadPhoto()}>사진 올리기</button>
        </div>
        {photos.length === 0 ? <p style={{ margin: 0, fontSize: 12.5, color: MUTED }}>연결된 사진이 없습니다. 사진이 없어도 결과 화면은 정상으로 보입니다.</p>
          : <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>{photos.map((m) => <MediaRow key={m.id} m={m} busy={busy} onTogglePublic={() => void toggleMedia(m)} onDelete={() => void removeMedia(m)} />)}</ul>}
      </section>

      {/* ⑥ 영상 */}
      <section style={card}>
        <p style={h}><Video size={15} style={{ verticalAlign: '-2px' }} /> YouTube 영상</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select style={input} value={video.category} onChange={(e) => setVideo({ ...video, category: e.target.value })} aria-label="영상 분류">
            {RESULT_VIDEO_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input data-result-video-url style={{ ...input, flex: '2 1 220px' }} placeholder="YouTube 주소(watch · youtu.be · shorts)" value={video.url} onChange={(e) => setVideo({ ...video, url: e.target.value })} />
          <input style={{ ...input, flex: '1 1 150px' }} maxLength={80} placeholder="제목(선택)" value={video.title} onChange={(e) => setVideo({ ...video, title: e.target.value })} />
          <label style={{ fontSize: 13, fontWeight: 700, color: INK, display: 'inline-flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={video.isPublic} onChange={(e) => setVideo({ ...video, isPublic: e.target.checked })} />바로 공개</label>
          <button type="button" data-result-action="add-video" style={btn(true)} disabled={busy || !video.url.trim()} onClick={() => void doAddVideo()}>영상 연결</button>
        </div>
        {videos.length === 0 ? <p style={{ margin: 0, fontSize: 12.5, color: MUTED }}>연결된 영상이 없습니다. 영상이 없으면 결과 화면에서 영상 구역은 숨겨집니다.</p>
          : <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>{videos.map((m) => <MediaRow key={m.id} m={m} busy={busy} onTogglePublic={() => void toggleMedia(m)} onDelete={() => void removeMedia(m)} />)}</ul>}
      </section>

      {/* ⑦ 이력 */}
      <section style={card}>
        <p style={h}>이력</p>
        {s.history.length === 0 ? <p style={{ margin: 0, fontSize: 12.5, color: MUTED }}>아직 이력이 없습니다.</p> : (
          <ul data-result-history style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8, color: INK }}>
            {s.history.map((x, i) => <li key={i}>{when(x.at)} · <b>{ACTION_LABEL[x.action] ?? x.action}</b>{x.toVersion ? ` · 버전 ${x.fromVersion ? `${x.fromVersion} → ` : ''}${x.toVersion}` : ''}{x.note ? ` · ${x.note}` : ''}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
