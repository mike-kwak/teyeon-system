'use client';

// MATCH SPOTLIGHT 공유 이미지(포스터) — 세션 관리 모달 안 화면(오버레이 없음).
//   데이터 = 공개 페이지와 같은 공개 조회(get_public_kdk_spotlight · anon)를 지금 다시 받은 결과.
//     → 공개 후 선수 구성이 바뀐 경기는 공개 페이지처럼 포스터에서도 빠진다(DB 가 숨김).
//     → 공개 해제 · 조회 실패면 포스터를 만들지 않는다(오래된 데이터로 생성 · 공유 금지).
//   미리보기 · 이미지 공유(Web Share) · PNG 저장 · 링크 복사.
//   공유 미지원(PC · 일부 인앱 브라우저) → PNG 저장 + 링크 복사로 안내, 저장도 막히면 미리보기 길게 눌러 저장.

import React, { useEffect, useState } from 'react';
import { Copy, Check, Download, Share2 } from 'lucide-react';
import type { PublicSpotlightPayload } from '@/lib/kdk/analytics/publicSpotlight';
import { posterFileName, renderSpotlightPosterBlob, savePosterImage, sharePosterImage } from '@/lib/kdk/spotlightPoster';
import { fetchPublicSpotlight, spotlightPublicUrl } from '@/lib/kdk/spotlightPublicService';
import { copyText } from './spotlightClientApi';

export default function SpotlightPosterPanel({ slug }: { slug: string }) {
  const [payload, setPayload] = useState<PublicSpotlightPayload | null>(null);
  const [img, setImg] = useState<{ url: string; blob: Blob; w: number; h: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = spotlightPublicUrl(slug);
  const fileName = posterFileName(payload?.date || '');

  // 공개 조회(공개 페이지와 같은 함수 · 같은 결과)
  useEffect(() => {
    let alive = true;
    setPayload(null); setImg(null); setErr(null);
    fetchPublicSpotlight(slug).then((r) => {
      if (!alive) return;
      if (r.state === 'ok') setPayload(r.payload);
      else setErr(r.state === 'not_found'
        ? '지금 공개 중인 SPOTLIGHT 가 없어 공유 이미지를 만들 수 없습니다(비공개 전환됨).'
        : '공개 데이터를 불러오지 못해 공유 이미지를 만들지 않았습니다. 잠시 후 다시 시도해 주세요.');
    }).catch(() => { if (alive) setErr('공개 데이터를 불러오지 못해 공유 이미지를 만들지 않았습니다. 잠시 후 다시 시도해 주세요.'); });
    return () => { alive = false; };
  }, [slug]);

  useEffect(() => {
    if (!payload) return undefined;
    let alive = true;
    let objectUrl: string | null = null;
    renderSpotlightPosterBlob(payload, { linkLabel: url.replace(/^https?:\/\//, '') })
      .then(({ blob, layout }) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setImg({ url: objectUrl, blob, w: layout.width, h: layout.height });
      })
      .catch(() => { if (alive) setErr('이미지를 만들지 못했습니다. 다른 브라우저에서 다시 시도해 주세요.'); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [payload, url]);

  const share = async () => {
    if (!img || !payload) return;
    setMsg(null);
    const r = await sharePosterImage(img.blob, fileName, { title: "TEYEON TODAY'S SPOTLIGHT", text: `${payload.title || '오늘의 주목 경기'} · 전체 분석 ${url}` });
    if (r === 'shared') setMsg('공유 창을 열었습니다. 카카오톡을 선택해 보내 주세요. (이미지와 함께 링크가 빠지면 아래 "링크 복사"로 따로 보내 주세요)');
    else if (r === 'unsupported') setMsg('이 브라우저는 이미지 바로 공유를 지원하지 않습니다. "PNG 저장" 후 카카오톡에서 사진으로 보내고, 링크는 "링크 복사"로 보내 주세요.');
  };
  const save = () => {
    if (!img) return;
    savePosterImage(img.blob, fileName);
    setMsg('PNG 를 저장했습니다. 저장이 안 되는 화면(카카오톡 안 브라우저 등)에서는 위 이미지를 길게 눌러 저장해 주세요.');
  };
  const copyLink = async () => {
    const ok = await copyText(url);
    setCopied(ok);
    setMsg(ok ? '공개 페이지 링크를 복사했습니다.' : '복사하지 못했습니다. 브라우저 권한을 확인해 주세요.');
  };

  const btn = (label: React.ReactNode, onClick: () => void, primary = false, disabled = false) => (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ flex: '1 1 0', minWidth: 0, minHeight: 44, padding: '0 8px', borderRadius: 12, fontSize: 13, fontWeight: 900,
        cursor: disabled ? 'not-allowed' : 'pointer', border: primary ? 'none' : '1px solid #C9D9EC',
        background: disabled ? '#EEF2F7' : primary ? '#0F2747' : '#FFFFFF', color: disabled ? '#94A3B8' : primary ? '#FFFFFF' : '#0F2747',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, textAlign: 'center', wordBreak: 'keep-all' }}>
      {label}
    </button>
  );

  return (
    <section aria-label="SPOTLIGHT 공유 이미지" data-spotlight-poster="" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#5B6B80', lineHeight: 1.6, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
        공개 중인 SPOTLIGHT 로 만든 공유 이미지입니다. 공개되지 않은 내용은 들어가지 않습니다.
      </div>
      <div style={{ borderRadius: 14, overflow: 'hidden', background: '#0A1A33', border: '1px solid rgba(15,39,71,0.12)', minHeight: 160,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {img
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={img.url} alt="오늘의 주목 경기 공유 이미지" data-poster-size={`${img.w}x${img.h}`} data-poster-matches={(payload?.items || []).map((i) => i.matchNo).join(',')} style={{ display: 'block', width: '100%', height: 'auto' }} />
          : <span style={{ color: '#E9D8A6', fontSize: 13, fontWeight: 800, padding: 24 }}>{err || '이미지 만드는 중…'}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {btn(<><Share2 size={14} aria-hidden />이미지 공유</>, () => void share(), true, !img)}
        {btn(<><Download size={14} aria-hidden />PNG 저장</>, save, false, !img)}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {btn(copied ? <><Check size={14} aria-hidden />링크 복사됨</> : <><Copy size={14} aria-hidden />링크 복사</>, () => void copyLink(), false, !payload)}
      </div>
      {msg && <div role="status" style={{ fontSize: 12.5, fontWeight: 700, color: '#0F2747', lineHeight: 1.5, overflowWrap: 'anywhere', wordBreak: 'keep-all' }}>{msg}</div>}
    </section>
  );
}
