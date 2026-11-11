// TEYEON KDK FINAL REPORT — 공유(P4 · 순수 로직 · 공개 페이지와 운영진 편집기가 함께 쓴다).
//   순서: Web Share API(공유 시트) → 지원하지 않거나 실패하면 링크 복사 → 복사도 실패하면 주소를 직접 보여 준다.
//   ⚠ 공유 시트가 열리고 끝났다는 것은 "공유를 요청했다"는 뜻일 뿐, 카카오톡 단체방 전달을 확인한 것이 아니다.
//     그래서 결과 문구에 "전송 완료"를 쓰지 않는다. 사용자가 공유 시트를 직접 닫으면(AbortError) 아무 안내도 하지 않는다.

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'failed';
export interface ShareData { url: string; title: string; text: string }
interface NavLike {
  share?: (d: ShareData) => Promise<void>;
  canShare?: (d: ShareData) => boolean;
}

/** 공유 문구 — 공개본(allow-list)의 제목만. 우승자 이름 · 수치는 넣지 않는다(미리보기 카드가 보여 준다). */
export function shareDataOf(sessionTitle: string | null | undefined, url: string): ShareData {
  const title = `THE FINAL STORY · ${(sessionTitle || '').trim() || 'TEYEON KDK'}`;
  return { url, title, text: 'TEYEON KDK 공식 결과 리포트' };
}

/**
 * 공유 실행. nav = navigator(테스트에서는 가짜), copy = 기존 프로젝트 복사 함수(clipboard → textarea fallback).
 *   · share 가 없거나 canShare 가 거절 → 복사.
 *   · share 실패: AbortError(사용자가 취소) → 'cancelled'(복사로 넘어가지 않음 · 안내 없음),
 *     그 밖의 오류(NotAllowedError · 인앱 브라우저 미지원 등) → 복사로 대체.
 */
export async function shareOrCopy(data: ShareData, nav: NavLike | null | undefined, copy: (text: string) => Promise<boolean>, opts: { preferCopy?: boolean } = {}): Promise<ShareOutcome> {
  if (!opts.preferCopy && nav && typeof nav.share === 'function') {
    let allowed = true;
    try { allowed = typeof nav.canShare === 'function' ? nav.canShare(data) !== false : true; } catch { allowed = false; }
    if (allowed) {
      try { await nav.share(data); return 'shared'; } catch (e) {
        if (e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError') return 'cancelled';
      }
    }
  }
  try { return (await copy(data.url)) ? 'copied' : 'failed'; } catch { return 'failed'; }
}

/** 결과 안내(없으면 표시하지 않음). */
export const SHARE_OUTCOME_TEXT: Record<ShareOutcome, string | null> = {
  shared: null,
  cancelled: null,
  copied: '링크가 복사되었습니다. 카카오톡 대화방에 붙여 넣어 공유하세요.',
  failed: '자동 복사가 되지 않았습니다. 아래 주소를 길게 눌러 복사해 주세요.',
};
