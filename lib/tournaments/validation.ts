// 공개 참가신청 폼 검증 · 값 정규화.
//
//   설계 원칙
//     · UI 표시값(하이픈 포함 전화번호)과 저장값(숫자만)을 분리한다.
//       화면은 formatPhoneInput 결과를 보여주고, 서버로는 normalizePhone 결과만 보낸다.
//     · 여기 검증은 UX 용 1차 방어선일 뿐이다. 최종 판정(마감·정원·중복)은 항상 서버 RPC 가 한다.
//     · 요강에 없는 참가 조건을 검증으로 새로 만들지 않는다(나이·성별·구력 등 입력·판정 없음).

export interface RegistrationFormValues {
  player1Name: string;
  /** 표시값(하이픈 포함). 저장 시 normalizePhone 으로 변환. */
  player1Phone: string;
  player2Name: string;
  player2Phone: string;
  clubName: string;
  depositorName: string;
  note: string;
  eligibilityConfirmed: boolean;
  regulationsConfirmed: boolean;
  privacyAgreed: boolean;
  mediaNoticeConfirmed: boolean;
}

export type RegistrationFieldKey = keyof RegistrationFormValues;

export type RegistrationErrors = Partial<Record<RegistrationFieldKey, string>>;

export const EMPTY_REGISTRATION_FORM: RegistrationFormValues = {
  player1Name: '',
  player1Phone: '',
  player2Name: '',
  player2Phone: '',
  clubName: '',
  depositorName: '',
  note: '',
  eligibilityConfirmed: false,
  regulationsConfirmed: false,
  privacyAgreed: false,
  mediaNoticeConfirmed: false,
};

/** 입력 순서 = 오류 발생 시 이동할 순서. */
export const REGISTRATION_FIELD_ORDER: RegistrationFieldKey[] = [
  'player1Name',
  'player1Phone',
  'player2Name',
  'player2Phone',
  'clubName',
  'depositorName',
  'note',
  'eligibilityConfirmed',
  'regulationsConfirmed',
  'privacyAgreed',
  'mediaNoticeConfirmed',
];

export const MAX_NAME_LENGTH = 20;
export const MAX_CLUB_LENGTH = 40;
export const MAX_NOTE_LENGTH = 300;
/** '010-1234-5678' = 13자. */
export const MAX_PHONE_INPUT_LENGTH = 13;

/** 저장·비교용: 숫자만 남긴다. */
export function normalizePhone(raw: string): string {
  return (raw || '').replace(/[^0-9]/g, '');
}

/**
 * 표시용: 입력 중에도 자연스럽게 하이픈을 넣는다.
 *   010-1234-5678 / 011-123-4567 모두 지원. 숫자 11자리를 넘기면 잘라낸다.
 */
export function formatPhoneInput(raw: string): string {
  const d = normalizePhone(raw).slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

/** 국내 휴대폰(01x + 8~9자리). 서버 RPC 와 동일 기준. */
export function isValidPhone(raw: string): boolean {
  return /^01[0-9]{8,9}$/.test(normalizePhone(raw));
}

const isBlank = (v: string): boolean => !v || !v.trim();

export function validateRegistration(v: RegistrationFormValues): RegistrationErrors {
  const e: RegistrationErrors = {};

  if (isBlank(v.player1Name)) e.player1Name = '선수 1 이름을 입력해 주세요.';
  else if (v.player1Name.trim().length > MAX_NAME_LENGTH) e.player1Name = `이름은 ${MAX_NAME_LENGTH}자 이내로 입력해 주세요.`;

  if (isBlank(v.player1Phone)) e.player1Phone = '선수 1 휴대폰 번호를 입력해 주세요.';
  else if (!isValidPhone(v.player1Phone)) e.player1Phone = '휴대폰 번호 형식을 확인해 주세요. (예: 010-1234-5678)';

  if (isBlank(v.player2Name)) e.player2Name = '선수 2 이름을 입력해 주세요.';
  else if (v.player2Name.trim().length > MAX_NAME_LENGTH) e.player2Name = `이름은 ${MAX_NAME_LENGTH}자 이내로 입력해 주세요.`;

  if (isBlank(v.player2Phone)) e.player2Phone = '선수 2 휴대폰 번호를 입력해 주세요.';
  else if (!isValidPhone(v.player2Phone)) e.player2Phone = '휴대폰 번호 형식을 확인해 주세요. (예: 010-1234-5678)';
  else if (normalizePhone(v.player1Phone) === normalizePhone(v.player2Phone)) {
    e.player2Phone = '두 선수의 휴대폰 번호가 같습니다. 각각 다른 번호를 입력해 주세요.';
  }

  // 클럽명은 선택 입력이다. 공식 요강에 클럽 소속이 참가 조건으로 없으므로 필수로 만들지 않는다.
  //   빈 값은 그대로 비워 저장한다("무소속" 같은 대체 문자열을 만들어 넣지 않는다).
  if (!isBlank(v.clubName) && v.clubName.trim().length > MAX_CLUB_LENGTH) {
    e.clubName = `클럽명은 ${MAX_CLUB_LENGTH}자 이내로 입력해 주세요.`;
  }

  if (isBlank(v.depositorName)) e.depositorName = '입금자명을 입력해 주세요.';
  else if (v.depositorName.trim().length > MAX_NAME_LENGTH) e.depositorName = `입금자명은 ${MAX_NAME_LENGTH}자 이내로 입력해 주세요.`;

  if (v.note.trim().length > MAX_NOTE_LENGTH) e.note = `${MAX_NOTE_LENGTH}자 이내로 입력해 주세요.`;

  if (!v.eligibilityConfirmed) e.eligibilityConfirmed = '참가 자격을 확인해 주세요.';
  if (!v.regulationsConfirmed) e.regulationsConfirmed = '공식 대회요강을 확인해 주세요.';
  if (!v.privacyAgreed) e.privacyAgreed = '개인정보 수집·이용에 동의해 주세요.';
  if (!v.mediaNoticeConfirmed) e.mediaNoticeConfirmed = '촬영·중계 안내를 확인해 주세요.';

  return e;
}

/** 오류가 있는 첫 필드(입력 순서 기준). 없으면 null. */
export function firstErrorField(errors: RegistrationErrors): RegistrationFieldKey | null {
  return REGISTRATION_FIELD_ORDER.find((k) => !!errors[k]) ?? null;
}
