// TEYEON Finance 공용 입금 계좌 설정 — 단일 출처.
//   여러 컴포넌트/공지에 계좌를 하드코딩하지 말고 여기만 참조한다.
//   공지 생성 시점에는 이 값을 snapshot_data.paymentAccount 로 복사해 불변 저장한다
//   (이후 계좌가 바뀌어도 기존 공지에는 소급 반영되지 않게).

export interface FinancePaymentAccountSnapshot {
    bankName: string;
    accountHolder: string;
    /** 화면/안내문 표시용 (하이픈 포함). */
    accountNumberDisplay: string;
    /** 복사용 (하이픈 없는 숫자만 — 은행 앱 붙여넣기 편의). */
    accountNumberCopy: string;
}

export const FINANCE_PAYMENT_ACCOUNT: FinancePaymentAccountSnapshot = {
    bankName: '카카오뱅크',
    accountHolder: '곽민섭',
    accountNumberDisplay: '3333-01-5235337',
    accountNumberCopy: '3333015235337',
} as const;
