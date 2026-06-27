// Analytics 경로 정규화(머신 슬러그) + 제외 규칙.
//   normalized_path 컬럼에 저장할 슬러그를 만든다. 동적 ID 는 슬러그에서 제거된다.
//   UI 표시용 한글 라벨은 lib/analytics/analyticsService.ts 의 normalizeMenu() 가 담당(역할 분리).
//   ※ 두 모듈의 매핑 기준은 동일하게 유지할 것(향후 단일 모듈로 통합 검토 — next step).

export const ANALYTICS_EXCLUDED_PREFIXES = ['/admin', '/api', '/auth'];
// 전광판: 자동 새로고침/장시간 유지로 page_view 를 왜곡 → 기본 제외(별도 display 정책은 후속 검토).
export const DISPLAY_BOARD_PREFIX = '/kdk/display';

export interface NormalizedPath {
    slug: string;
    excluded: boolean;
    isDisplayBoard: boolean;
}

const ok = (slug: string): NormalizedPath => ({ slug, excluded: false, isDisplayBoard: false });

export function normalizePath(path: string | null | undefined): NormalizedPath {
    if (!path) return { slug: 'unknown', excluded: true, isDisplayBoard: false };
    const p = path.split('?')[0].split('#')[0];

    for (const pre of ANALYTICS_EXCLUDED_PREFIXES) {
        if (p === pre || p.startsWith(pre + '/')) return { slug: 'excluded', excluded: true, isDisplayBoard: false };
    }
    if (p === DISPLAY_BOARD_PREFIX || p.startsWith(DISPLAY_BOARD_PREFIX + '/')) {
        return { slug: 'display_board', excluded: true, isDisplayBoard: true };
    }

    if (p === '/') return ok('home');
    if (p.startsWith('/calendar')) return ok('calendar');
    if (p.startsWith('/club-schedule')) return ok('club_schedule'); // 동적 [id] 제거
    if (p.startsWith('/kdk/live')) return ok('live_court');
    if (p.startsWith('/kdk')) return ok('kdk');
    if (p.startsWith('/archive')) return ok('archive');
    if (p.startsWith('/members')) return ok('member_profile');     // 동적 [id] 제거
    if (p.startsWith('/guest')) return ok('guest_pass');           // token 은 metadata 에 저장하지 않음
    if (p.startsWith('/notice')) return ok('notice');
    if (p.startsWith('/finance')) return ok('finance');
    if (p.startsWith('/club')) return ok('public_club');

    const seg = p.split('/').filter(Boolean)[0];
    return ok(seg ? seg.replace(/[^a-z0-9_]/gi, '_').toLowerCase() : 'home');
}

// 원시 path 컬럼에 저장하기 전 민감 식별자 제거.
//   Guest Pass / Finance 공개 토큰, UUID, 긴 불투명 세그먼트를 [token]/[id] 로 치환한다.
//   (토큰은 접근 자격증명이므로 조회 가능한 테이블에 원문 저장하지 않는다.)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function sanitizeRawPath(path: string | null | undefined): string {
    if (!path) return '';
    const clean = path.split('?')[0].split('#')[0];
    return clean
        .split('/')
        .map((seg) => {
            if (!seg) return seg;
            if (UUID_RE.test(seg)) return '[id]';
            if (seg.length >= 20) return '[token]'; // 긴 불투명 토큰(guest/finance public 등)
            return seg;
        })
        .join('/');
}
