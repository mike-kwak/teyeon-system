// Guide & Recording — write guard 공용 상수/타입.
//   실제 차단 판정과 알림은 GuideRecordingProvider 가 상태(isWriteBlocked)와 함께 수행한다.
//   여기서는 공유 메시지/타입만 둔다(중앙화).
//
//   주의: 이 guard 는 "촬영 중 실수 방지"용 UI 가드다. 실제 데이터 보안은 Supabase RLS 가 담당한다.

export const WRITE_BLOCK_MESSAGE = '촬영 모드에서는 실제 데이터 변경이 차단됩니다.';

/** guardWriteAction 시그니처. true=진행 가능, false=차단됨. */
export type GuardWriteAction = (actionLabel?: string) => boolean;
