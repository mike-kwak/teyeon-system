// Guest Pass 운영 데이터 layer.
// - club_guest_pass_defaults (싱글톤) CRUD
// - club_schedule_guest_passes (정모별) CRUD + 토큰 발급
// - defaults + club_schedule + perMeet → GuestPassData 병합
//
// 토큰: nanoid(10) URL-safe — 영문 대소문자 + 숫자 (64자 알파벳).
// 외부 의존성 없이 crypto.getRandomValues 로 직접 생성.
//
// 모든 RLS 정책은 SQL 에 정의되어 있으며, 이 서비스는 정책을 우회하지 않는다.

import { supabase } from './supabase';
import type {
    GuestPassData,
    GuestPassParticipation,
    CourtMode,
} from './guestPassData';
import { fetchClubScheduleById } from './clubScheduleService';
import type { ClubSchedule } from './clubScheduleData';

// ── 토큰 생성 ────────────────────────────────────────────────────────────────

/**
 * URL-safe 10자 토큰. 영문 대/소문자 + 숫자 = 62자 알파벳. nanoid(10) 호환.
 * 추측 방지 + 짧은 URL 균형. 보안 토큰이 아닌 obscurity URL.
 */
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function generateGuestPassToken(length = 10): string {
    const bytes = new Uint8Array(length);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    } else {
        // SSR fallback — Math.random 은 약하지만 nanoid 1차 보안 요구는 아님.
        for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    let out = '';
    const alphaLen = TOKEN_ALPHABET.length;
    for (let i = 0; i < length; i++) {
        out += TOKEN_ALPHABET[bytes[i] % alphaLen];
    }
    return out;
}

// ── 타입 ────────────────────────────────────────────────────────────────────

export interface GuestPassDefaults {
    id: string;
    clubKey: string;
    defaultFeeAmount: number | null;
    bankName: string | null;
    bankAccountNumber: string | null;
    /**
     * 공개용 예금주 (마스킹된 표시명, 예: '곽민*'). Guest Pass 공개 화면 / 카카오 안내문 전용.
     * ⚠️ 실제 예금주 컬럼은 DB 에서 제거됨 (supabase/secure_public_guest_pass.sql).
     */
    bankAccountHolderDisplay: string | null;
    paymentNote: string | null;
    preparationItems: string[];
    arrivalGuideMinutes: number;
    lateOrAbsentNotice: string | null;
    kdkStartNotice: string | null;
    penaltyNotice: string | null;
    guestPrizeExclusion: string | null;
    clubIntroName: string;
    clubIntroParagraphs: string[];
    contactNotice: string | null;
    /** KDK 경기 안내 상태 한 줄 (기본: '당일 대진표 공유 예정') */
    matchStatusHeadline: string;
    /** KDK 경기 안내 상세 본문 */
    matchStatusBody: string;
    updatedAt: string;
}

export type GuestPassDefaultsInput = Omit<GuestPassDefaults, 'id' | 'clubKey' | 'updatedAt'>;

export interface ScheduleGuestPass {
    id: string;
    scheduleId: string;
    isActive: boolean;
    publicToken: string | null;
    feeAmountOverride: number | null;
    showBankAccount: boolean;
    extraNotice: string | null;
    /** null 이면 defaults.matchStatusHeadline 사용. */
    matchStatusHeadlineOverride: string | null;
    /** null 이면 defaults.matchStatusBody 사용. */
    matchStatusBodyOverride: string | null;
    participationStatus: GuestPassParticipation;
    updatedAt: string;
}

export type ScheduleGuestPassInput = Pick<
    ScheduleGuestPass,
    | 'feeAmountOverride'
    | 'showBankAccount'
    | 'extraNotice'
    | 'matchStatusHeadlineOverride'
    | 'matchStatusBodyOverride'
    | 'participationStatus'
>;

// ── Row 매퍼 ────────────────────────────────────────────────────────────────

/** 안전 기본값 — DB 컬럼이 NULL 인 경우(마이그레이션 직후) 화면이 비지 않도록. */
const DEFAULT_MATCH_HEADLINE = '당일 대진표 공유 예정';
const DEFAULT_MATCH_BODY = '대진표는 당일 경기이사가 편성한 뒤 앱에 등록되며, 준비가 완료되면 이 페이지에서 확인할 수 있습니다.';

function mapDefaultsRow(row: any): GuestPassDefaults {
    return {
        id: row.id,
        clubKey: row.club_key,
        defaultFeeAmount: row.default_fee_amount ?? null,
        bankName: row.bank_name ?? null,
        bankAccountNumber: row.bank_account_number ?? null,
        bankAccountHolderDisplay: row.bank_account_holder_display ?? null,
        paymentNote: row.payment_note ?? null,
        preparationItems: Array.isArray(row.preparation_items) ? row.preparation_items : [],
        arrivalGuideMinutes: row.arrival_guide_minutes ?? 15,
        lateOrAbsentNotice: row.late_or_absent_notice ?? null,
        kdkStartNotice: row.kdk_start_notice ?? null,
        penaltyNotice: row.penalty_notice ?? null,
        guestPrizeExclusion: row.guest_prize_exclusion ?? null,
        clubIntroName: row.club_intro_name ?? 'TEYEON',
        clubIntroParagraphs: Array.isArray(row.club_intro_paragraphs) ? row.club_intro_paragraphs : [],
        contactNotice: row.contact_notice ?? null,
        matchStatusHeadline: row.match_status_headline ?? DEFAULT_MATCH_HEADLINE,
        matchStatusBody: row.match_status_body ?? DEFAULT_MATCH_BODY,
        updatedAt: row.updated_at,
    };
}

function mapScheduleGuestPassRow(row: any): ScheduleGuestPass {
    return {
        id: row.id,
        scheduleId: row.schedule_id,
        isActive: !!row.is_active,
        publicToken: row.public_token ?? null,
        feeAmountOverride: row.fee_amount_override ?? null,
        showBankAccount: row.show_bank_account !== false,
        extraNotice: row.extra_notice ?? null,
        matchStatusHeadlineOverride: row.match_status_headline_override ?? null,
        matchStatusBodyOverride: row.match_status_body_override ?? null,
        participationStatus: (row.participation_status as GuestPassParticipation) || 'confirmed',
        updatedAt: row.updated_at,
    };
}

// ── Defaults CRUD ────────────────────────────────────────────────────────────

const CLUB_KEY = 'TEYEON';

export async function fetchGuestPassDefaults(): Promise<GuestPassDefaults | null> {
    const { data, error } = await supabase
        .from('club_guest_pass_defaults')
        .select('*')
        .eq('club_key', CLUB_KEY)
        .maybeSingle();
    if (error) {
        console.warn('[GuestPass/defaults fetch]', error?.message ?? error);
        return null;
    }
    return data ? mapDefaultsRow(data) : null;
}

export async function saveGuestPassDefaults(
    input: GuestPassDefaultsInput,
    userId?: string,
): Promise<GuestPassDefaults> {
    // 싱글톤 — 행이 없으면 SQL 시드로 생성되지만 안전을 위해 upsert 처리.
    const payload = {
        club_key: CLUB_KEY,
        default_fee_amount: input.defaultFeeAmount,
        bank_name: input.bankName,
        bank_account_number: input.bankAccountNumber,
        bank_account_holder_display: input.bankAccountHolderDisplay,
        payment_note: input.paymentNote,
        preparation_items: input.preparationItems,
        arrival_guide_minutes: input.arrivalGuideMinutes,
        late_or_absent_notice: input.lateOrAbsentNotice,
        kdk_start_notice: input.kdkStartNotice,
        penalty_notice: input.penaltyNotice,
        guest_prize_exclusion: input.guestPrizeExclusion,
        club_intro_name: input.clubIntroName,
        club_intro_paragraphs: input.clubIntroParagraphs,
        contact_notice: input.contactNotice,
        match_status_headline: input.matchStatusHeadline || DEFAULT_MATCH_HEADLINE,
        match_status_body: input.matchStatusBody || DEFAULT_MATCH_BODY,
        updated_by: userId ?? null,
        updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
        .from('club_guest_pass_defaults')
        .upsert(payload, { onConflict: 'club_key' })
        .select('*')
        .single();
    if (error) throw error;
    return mapDefaultsRow(data);
}

// ── 정모 게스트비 해소 (KDK 신규 세션 초기값용) ──────────────────────────────

/**
 * 정모(schedule)의 실제 게스트비 금액을 기존 우선순위로 해소한다.
 *   fee_amount_override(정모 override) → schedule.fee_amount(정모 기본) →
 *   default_fee_amount(클럽 공통) → fallback(기본 10,000).
 * Guest Pass 표시값과 동일한 식(mergeGuestPassData)을 재사용해 불일치를 막는다.
 * 원본 데이터는 읽기만 한다(수정/저장 없음).
 *
 * @param scheduleId        대상 정모 id
 * @param scheduleFeeAmount 호출부가 이미 보유한 schedule.fee_amount(없으면 null)
 * @param fallback          전부 없을 때 기본값(기본 10,000)
 */
export async function resolveScheduleGuestFee(
    scheduleId: string,
    scheduleFeeAmount: number | null | undefined,
    fallback = 10000,
): Promise<number> {
    const [perMeet, defaults] = await Promise.all([
        fetchScheduleGuestPass(scheduleId),
        fetchGuestPassDefaults(),
    ]);
    const fee = perMeet?.feeAmountOverride
        ?? scheduleFeeAmount
        ?? defaults?.defaultFeeAmount
        ?? fallback;
    return typeof fee === 'number' && fee >= 0 ? fee : fallback;
}

// ── Schedule guest pass CRUD ─────────────────────────────────────────────────

export async function fetchScheduleGuestPass(scheduleId: string): Promise<ScheduleGuestPass | null> {
    const { data, error } = await supabase
        .from('club_schedule_guest_passes')
        .select('*')
        .eq('schedule_id', scheduleId)
        .maybeSingle();
    if (error) {
        console.warn('[GuestPass/schedule fetch]', error?.message ?? error);
        return null;
    }
    return data ? mapScheduleGuestPassRow(data) : null;
}

/**
 * 정모별 Guest Pass row upsert (활성 토글 + override 저장).
 * 토큰은 활성화 시 없으면 발급, 있으면 그대로 유지.
 * 토큰 재발급은 regenerateGuestPassToken 별도 함수 사용.
 */
export async function saveScheduleGuestPass(opts: {
    scheduleId: string;
    isActive: boolean;
    overrides: ScheduleGuestPassInput;
    userId?: string;
}): Promise<ScheduleGuestPass> {
    // 기존 row 조회 — 토큰 보존 여부 결정용.
    const existing = await fetchScheduleGuestPass(opts.scheduleId);
    const nextToken = existing?.publicToken
        ?? (opts.isActive ? generateGuestPassToken(10) : null);

    const payload: Record<string, any> = {
        schedule_id: opts.scheduleId,
        is_active: opts.isActive,
        public_token: nextToken,
        fee_amount_override: opts.overrides.feeAmountOverride,
        show_bank_account: opts.overrides.showBankAccount,
        extra_notice: opts.overrides.extraNotice,
        match_status_headline_override: opts.overrides.matchStatusHeadlineOverride,
        match_status_body_override: opts.overrides.matchStatusBodyOverride,
        participation_status: opts.overrides.participationStatus,
        updated_by: opts.userId ?? null,
        updated_at: new Date().toISOString(),
    };
    if (!existing) payload.created_by = opts.userId ?? null;

    const { data, error } = await supabase
        .from('club_schedule_guest_passes')
        .upsert(payload, { onConflict: 'schedule_id' })
        .select('*')
        .single();
    if (error) throw error;
    return mapScheduleGuestPassRow(data);
}

/**
 * 토큰 재발급 — 기존 링크를 즉시 무효화.
 * 사용자가 명시적으로 호출해야 하며 (별도 버튼 + 확인), 일반 save 흐름과 분리.
 */
export async function regenerateGuestPassToken(scheduleId: string, userId?: string): Promise<ScheduleGuestPass> {
    const newToken = generateGuestPassToken(10);
    const { data, error } = await supabase
        .from('club_schedule_guest_passes')
        .update({
            public_token: newToken,
            updated_by: userId ?? null,
            updated_at: new Date().toISOString(),
        })
        .eq('schedule_id', scheduleId)
        .select('*')
        .single();
    if (error) throw error;
    return mapScheduleGuestPassRow(data);
}

// ── 병합: defaults + schedule + perMeet → GuestPassData ─────────────────────

function clubModeToCourtMode(mode?: string | null, count?: number | null): CourtMode {
    if (mode === 'fixed' || (!mode && count)) return 'fixed';
    if (mode === 'first_come') return 'first_come';
    if (mode === 'na') return 'na';
    return 'unknown';
}

/**
 * 운영 데이터를 공개 카드용 GuestPassData 형태로 병합.
 *
 * 우선순위:
 *   fee = perMeet.feeAmountOverride ?? schedule.fee_amount ?? defaults.defaultFeeAmount
 *   bank = perMeet.showBankAccount === false 면 데이터 자체 제거(빈 문자열),
 *          ON 이면 defaults.bankName + bankAccountNumber + **bankAccountHolderDisplay**
 *          (실제 예금주 bankAccountHolder 는 공개 응답에 절대 포함하지 않는다)
 *   extraNotice = perMeet.extraNotice (있을 때만)
 *   match.headline = perMeet.matchStatusHeadlineOverride ?? defaults.matchStatusHeadline
 *   match.body     = perMeet.matchStatusBodyOverride     ?? defaults.matchStatusBody
 *   준비사항/규칙/클럽 소개 = defaults
 *
 * 공개 페이지에 노출 금지되는 필드는 GuestPassData 자체에 포함되지 않는다
 * (created_by/updated_by/내부 메모/실 예금주 등은 매핑 단계에서 의도적으로 제외).
 */
export function mergeGuestPassData(opts: {
    schedule: ClubSchedule;
    defaults: GuestPassDefaults | null;
    perMeet: ScheduleGuestPass | null;
}): GuestPassData {
    const { schedule, defaults, perMeet } = opts;
    const fee = perMeet?.feeAmountOverride
        ?? schedule.fee_amount
        ?? defaults?.defaultFeeAmount
        ?? 0;

    const showBank = perMeet?.showBankAccount !== false;

    const guestNote = [
        defaults?.kdkStartNotice ? { icon: 'info' as const, text: defaults.kdkStartNotice } : null,
        defaults?.penaltyNotice ? { icon: 'rules' as const, text: defaults.penaltyNotice } : null,
        defaults?.guestPrizeExclusion ? { icon: 'trophy' as const, text: defaults.guestPrizeExclusion } : null,
        defaults?.lateOrAbsentNotice ? { icon: 'time' as const, text: defaults.lateOrAbsentNotice } : null,
    ].filter(Boolean) as { icon: 'info' | 'rules' | 'trophy' | 'time'; text: string }[];

    // 공개용 예금주 — 마스킹된 표시명만 사용. 실 예금주 컬럼은 DB 에 없음.
    return {
        schedule: {
            title: schedule.title,
            date: schedule.schedule_date,
            startTime: schedule.start_time,
            endTime: schedule.end_time,
            location: schedule.location || '장소 미정',
            courtMode: clubModeToCourtMode(schedule.court_mode, schedule.court_count),
            courtCount: schedule.court_count,
            participation: perMeet?.participationStatus ?? 'confirmed',
        },
        fee: {
            amount: fee,
            // 계좌 OFF 시 입금 안내 / 계좌 객체 자체를 DTO 에서 제외 — UI 가림이 아닌 데이터 미포함.
            note: showBank ? (defaults?.paymentNote ?? undefined) : undefined,
            bank: showBank
                ? {
                    bankName: defaults?.bankName ?? '',
                    accountNumber: defaults?.bankAccountNumber ?? '',
                    accountHolder: defaults?.bankAccountHolderDisplay ?? '',
                }
                // GuestPassFee.bank 는 required 타입이라 빈 객체로 두되, showBankAccount=false 신호로 카드/카카오가 분기.
                : { bankName: '', accountNumber: '', accountHolder: '' },
        },
        showBankAccount: showBank,
        extraNotice: perMeet?.extraNotice ?? null,
        preparation: {
            items: defaults?.preparationItems ?? [],
            arrivalGuideMinutes: defaults?.arrivalGuideMinutes ?? 15,
            lateOrAbsentNotice: defaults?.lateOrAbsentNotice ?? '',
        },
        guestNote,
        match: {
            state: 'preparing',
            title: 'KDK 경기 안내',
            headline: perMeet?.matchStatusHeadlineOverride
                || defaults?.matchStatusHeadline
                || DEFAULT_MATCH_HEADLINE,
            body: perMeet?.matchStatusBodyOverride
                || defaults?.matchStatusBody
                || DEFAULT_MATCH_BODY,
        },
        club: {
            name: defaults?.clubIntroName ?? 'TEYEON',
            paragraphs: defaults?.clubIntroParagraphs ?? [],
        },
        contactNotice: defaults?.contactNotice ?? '문의사항은 초대한 회원 또는 TEYEON 운영진에게 부탁드립니다.',
    };
}

/**
 * 공개 token 으로 GuestPassData 해소 — anon 도 호출 가능.
 *
 * ⚠️ 보안 — 절대 원본 테이블을 직접 SELECT 하지 않는다.
 *    `get_public_guest_pass(p_token)` RPC (security definer, anon/authenticated grant)
 *    가 RLS 우회 + 공개 가능 필드만 jsonb 로 반환. created_by/updated_by/내부 메모는
 *    반환 자체에 포함되지 않는다.
 *
 *    show_bank_account=false 시 RPC 는 fee.bank / fee.note 를 NULL 로 응답.
 *    TS DTO 와 호환을 위해 빈 문자열로 채워서 카드 컴포넌트의 showBankAccount 분기로 비표시.
 */
export async function buildGuestPassDataFromToken(token: string): Promise<GuestPassData | null> {
    if (!token) return null;
    const { data, error } = await supabase.rpc('get_public_guest_pass', { p_token: token });
    if (error) {
        console.warn('[GuestPass/rpc]', error?.message ?? error);
        return null;
    }
    if (!data) return null;
    const j = data as any;

    // RPC 결과 → GuestPassData 정규화. bank 가 null 이면 빈 객체로 채우고 showBankAccount=false.
    const showBank = j.showBankAccount !== false && j.fee?.bank != null;
    const bank = j.fee?.bank ?? null;
    return {
        schedule: {
            title: j.schedule?.title ?? '',
            date: j.schedule?.date ?? '',
            startTime: j.schedule?.startTime ?? undefined,
            endTime: j.schedule?.endTime ?? undefined,
            location: j.schedule?.location ?? '장소 미정',
            courtMode: (j.schedule?.courtMode as any) ?? 'unknown',
            courtCount: j.schedule?.courtCount ?? undefined,
            participation: (j.schedule?.participation as any) ?? 'confirmed',
        },
        fee: {
            amount: Number(j.fee?.amount ?? 0),
            note: showBank ? (j.fee?.note ?? undefined) : undefined,
            bank: showBank && bank
                ? {
                    bankName: bank.bankName ?? '',
                    accountNumber: bank.accountNumber ?? '',
                    accountHolder: bank.accountHolder ?? '',
                }
                : { bankName: '', accountNumber: '', accountHolder: '' },
        },
        showBankAccount: showBank,
        extraNotice: j.extraNotice ?? null,
        preparation: {
            items: Array.isArray(j.preparation?.items) ? j.preparation.items : [],
            arrivalGuideMinutes: Number(j.preparation?.arrivalGuideMinutes ?? 15),
            lateOrAbsentNotice: j.preparation?.lateOrAbsentNotice ?? '',
        },
        guestNote: Array.isArray(j.guestNote) ? j.guestNote : [],
        match: {
            state: 'preparing',
            title: j.match?.title ?? 'KDK 경기 안내',
            headline: j.match?.headline ?? '당일 대진표 공유 예정',
            body: j.match?.body ?? '대진표는 당일 경기이사가 편성한 뒤 앱에 등록되며, 준비가 완료되면 이 페이지에서 확인할 수 있습니다.',
        },
        club: {
            name: j.club?.name ?? 'TEYEON',
            paragraphs: Array.isArray(j.club?.paragraphs) ? j.club.paragraphs : [],
        },
        contactNotice: j.contactNotice ?? '문의사항은 초대한 회원 또는 TEYEON 운영진에게 부탁드립니다.',
    };
}

/** scheduleId 로 운영진 preview 데이터 해소 — 활성 여부 무관. */
export async function buildGuestPassDataForSchedule(scheduleId: string): Promise<GuestPassData | null> {
    const [schedule, perMeet, defaults] = await Promise.all([
        fetchClubScheduleById(scheduleId),
        fetchScheduleGuestPass(scheduleId),
        fetchGuestPassDefaults(),
    ]);
    if (!schedule) return null;
    return mergeGuestPassData({ schedule, defaults, perMeet });
}
