// Guest Pass 공개 페이지에서 사용하는 데이터 구조 + Preview용 mock.
// 향후 실제 운영에서는 Supabase guest_passes (또는 club_schedules + bank_accounts)
// 데이터를 동일 GuestPassData 형태로 매핑해 GuestPassCard / GuestPassIntro에 그대로 전달.
//
// 이 파일은 외부 의존성 없는 순수 타입 + mock — 라우트별 fetch 함수는 별도 파일.

export type CourtMode = 'fixed' | 'unknown' | 'na' | 'first_come';

export type GuestPassParticipation =
    | 'pending'    // 운영진 확정 대기
    | 'confirmed'  // 참여 확정
    | 'cancelled'; // 정모 취소

export interface GuestPassSchedule {
    title: string;          // 예: 6월 4주차 TEYEON 정모
    date: string;           // 'YYYY-MM-DD'
    startTime?: string;     // 'HH:MM'
    endTime?: string;       // 'HH:MM'
    location: string;       // 풀 텍스트 — 360px에서 2줄 표시 (truncate X)
    courtMode: CourtMode;
    courtCount?: number;    // courtMode === 'fixed' 일 때만 의미 있음
    participation: GuestPassParticipation;
}

export interface GuestPassFee {
    amount: number;         // 원 단위 (10000)
    note?: string;          // 예: '경기 시작 전 입금'
    bank: {
        bankName: string;
        accountNumber: string;
        /**
         * 공개용 예금주 (마스킹된 표시명, 예: '곽민*').
         * 실제 예금주 컬럼은 DB 에 저장하지 않음 — 공개 응답 노출 위험 차단.
         */
        accountHolder: string;
    };
}

export interface GuestPassPreparation {
    items: string[];        // ['테니스 라켓', '테니스화', '물 또는 음료']
    arrivalGuideMinutes: number;  // 권장 도착 시간 (분 단위 전, 예: 15)
    lateOrAbsentNotice: string;   // 지각/불참 시 안내 한 줄
}

/** "TEYEON GUEST NOTE" 안내 카드 — 부드럽고 신뢰감 있는 톤. */
export interface GuestNoteEntry {
    icon?: 'info' | 'trophy' | 'rules' | 'time';
    text: string;
}

/**
 * KDK 경기 안내 영역.
 *
 * 1차 MVP: 항상 `state: 'preparing'` — 정적 안내 카피만 표시.
 *
 * 향후 확장 시 운영진이 수동으로 상태를 전환하면 같은 영역이 액션 버튼으로 전환:
 *   bracket_ready → '대진표 보기'
 *   in_progress   → '현재 경기 보기'
 *   finished      → '경기 결과 보기'
 * 이번 구현에는 KDK 자동 연동/공개 토글을 만들지 않음.
 */
export type GuestPassMatchState = 'preparing' | 'bracket_ready' | 'in_progress' | 'finished';

export interface GuestPassMatchAction {
    label: string;
    href: string;
}

export interface GuestPassMatchStatus {
    state: GuestPassMatchState;
    /** 카드 섹션 제목. 기본 'KDK 경기 안내'. */
    title: string;
    /** 메인 상태 한 줄. 1차: '당일 대진표 공유 예정' */
    headline: string;
    /** 안내 본문. 1차: '대진표는 당일 경기이사가 편성한 뒤 ...' */
    body: string;
    /** 향후 확장용 — 1차에는 비어있음. 채워지면 카드가 버튼 모드로 렌더. */
    actions?: GuestPassMatchAction[];
}

export interface GuestPassClubIntro {
    name: string;           // 'TEYEON'
    paragraphs: string[];   // 2~3 줄 짧은 소개
}

/**
 * Guest Pass 화면 전체 데이터.
 * 실제 운영 단계에서는 token → DB row → 이 구조로 매핑.
 */
export interface GuestPassData {
    schedule: GuestPassSchedule;
    fee: GuestPassFee;
    /** 운영진이 끄면 게스트비 카드의 계좌 영역을 숨김 (금액만 표시). */
    showBankAccount?: boolean;
    /** 이번 정모에만 적용되는 추가 공지. 게스트비 카드 상단에 노란 박스로 노출. */
    extraNotice?: string | null;
    preparation: GuestPassPreparation;
    guestNote: GuestNoteEntry[];
    match: GuestPassMatchStatus;
    club: GuestPassClubIntro;
    /** 1차에는 외부 링크 사용 안 함. 정적 문구만. */
    contactNotice: string;
}

// ── Preview / QA mock ─────────────────────────────────────────────────────
// 실제 계좌/장소가 아닌 명확한 mock 값. 향후 DB row로 교체.
export const mockGuestPassData: GuestPassData = {
    schedule: {
        title: '6월 4주차 TEYEON 정모',
        date: '2026-06-27',
        startTime: '19:00',
        endTime: '22:00',
        location: '서울 송파구 잠실종합운동장 보조경기장 테니스코트',
        courtMode: 'fixed',
        courtCount: 3,
        participation: 'confirmed',
    },
    fee: {
        amount: 10000,
        note: '경기 시작 전 입금 부탁드립니다.',
        bank: {
            bankName: '카카오뱅크',
            accountNumber: '3333-00-0000000',
            // ⚠️ 실제 예금주를 mock 에 직접 넣지 않는다. 공개용 마스킹 표시명만 사용.
            accountHolder: '곽민*',
        },
    },
    preparation: {
        items: ['테니스 라켓', '테니스화', '물 또는 음료'],
        arrivalGuideMinutes: 15,
        lateOrAbsentNotice: '지각 또는 불참 시 초대한 회원 또는 운영진에게 사전 연락 부탁드립니다.',
    },
    guestNote: [
        { icon: 'info',   text: 'KDK 경기는 기본 1:1 스코어에서 시작합니다.' },
        { icon: 'rules',  text: '운영 기준에 따라 벌금이 발생할 수 있습니다.' },
        { icon: 'trophy', text: '게스트도 당일 순위 집계에는 포함되지만, 1등 시에도 상금 지급 대상은 아닙니다.' },
        { icon: 'time',   text: '지각 또는 불참 시 사전 연락 부탁드립니다.' },
        { icon: 'info',   text: '경기 진행은 운영진의 안내에 따라 주세요.' },
    ],
    match: {
        state: 'preparing',
        title: 'KDK 경기 안내',
        headline: '당일 대진표 공유 예정',
        body: '대진표는 당일 경기이사가 편성한 뒤 앱에 등록되며, 준비가 완료되면 이 페이지에서 확인할 수 있습니다.',
    },
    club: {
        name: 'TEYEON',
        paragraphs: [
            'TEYEON은 자체 앱으로 일정, 참석, 경기, 기록을 함께 관리하는 테니스 클럽입니다.',
            '정기 KDK 경기와 시즌 대회 참가를 함께하며, 게스트도 부담 없이 즐길 수 있도록 운영합니다.',
        ],
    },
    contactNotice: '문의사항은 초대한 회원 또는 TEYEON 운영진에게 부탁드립니다.',
};
