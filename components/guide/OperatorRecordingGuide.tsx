'use client';

// Guide & Recording — 운영진(OPERATOR/CEO/ADMIN) 매뉴얼 촬영 모듈 9종.
//   Closing Audit 누락분. KDK 운영은 준비/LIVE/공식 종료 3모듈로 분할(대형 단일 영상 금지).
//   게스트 신청 검토는 기존 GuestRecordingGuide OPERATOR 모듈과 연결(중복 촬영 금지).
//   기능 코드는 변경하지 않는다 — 촬영 카드·체크리스트만 제공.

import React from 'react';
import RecordingGuideSection, { type GuideShootModule } from './RecordingGuideSection';

const MODULES: GuideShootModule[] = [
  {
    id: 'op-schedule',
    title: '일정 관리',
    desc: '정모 등록·수정·삭제와 참석 현황, 게스트 모집·Guest Pass 연결',
    category: '운영 기본', audience: 'OPERATOR', path: '/club/schedule', length: '60~90초',
    realSave: true, privacy: true, status: '촬영 대기',
    needsTestData: '촬영용 정모 1건', cleanupAfter: '촬영용 정모 삭제 또는 테스트 표기',
    flow: [
      '일정 등록', '일정 수정', '일정 삭제', '참석 현황 확인', '공개 게스트 모집 설정(열기/마감)', 'Guest Pass 활성화·링크 연결',
    ],
    cautions: ['실제 운영 정모를 수정·삭제하지 않습니다.', '참석 명단의 실명 노출에 유의합니다.'],
  },
  {
    id: 'op-kdk-setup',
    title: 'KDK 준비(대진 생성)',
    desc: '참가자 구성부터 세션 생성까지',
    category: 'KDK 운영', audience: 'OPERATOR', path: '/kdk', length: '90~120초',
    realSave: true, privacy: false, status: '촬영 대기',
    needsTestData: '촬영용 is_test 세션', cleanupAfter: '촬영 후 테스트 세션 삭제',
    flow: [
      '참가자 불러오기(참석 연동)', '수동 대진 붙여넣기', '이름 매칭 확인', '게스트 표시 확인',
      '코트 수 설정', '조별 코트 설정', '승리 점수 설정', '게스트비 설정', '세션 생성',
    ],
    narration: ['게스트비는 KDK 세션이 단일 출처입니다.'],
    cautions: ['반드시 테스트 세션(is_test)으로 생성하고 촬영 후 삭제합니다.'],
  },
  {
    id: 'op-kdk-live',
    title: 'LIVE COURT 운영',
    desc: '경기 시작·점수 입력·완료와 코트 충돌 방지',
    category: 'KDK 운영', audience: 'OPERATOR', path: '/kdk?entry=live', length: '90~120초',
    realSave: true, privacy: false, status: '촬영 대기',
    needsTestData: '준비 모듈에서 만든 테스트 세션', cleanupAfter: '공식 종료 모듈까지 촬영 후 세션 삭제',
    flow: [
      '경기 시작(코트 투입)', '점수 입력', '경기 완료', '현재 경기·대기 경기 화면',
      '중복 코트 투입 방지 확인', '충돌 시 재조회(동기화) 동작',
    ],
    cautions: ['운영 중인 실제 세션에 점수를 입력하지 않습니다.'],
  },
  {
    id: 'op-kdk-finalize',
    title: 'KDK 공식 종료',
    desc: '최종 순위·정산·공식 Archive 확정·결과 공유',
    category: 'KDK 운영', audience: 'OPERATOR', path: '/kdk', length: '60~90초',
    realSave: true, privacy: false, status: '촬영 대기',
    needsTestData: 'LIVE 모듈에서 진행한 테스트 세션', cleanupAfter: '테스트 세션·아카이브 기록 삭제',
    flow: [
      '최종 순위 확인', '정산 화면', '공식 Archive 확정', '결과 공유(안내문)', '전광판 결과 확인',
    ],
    narration: ['공식 확정된 기록만 Archive·Ranking·개인 기록에 반영됩니다.'],
    cautions: ['테스트 세션 확정 기록은 촬영 후 반드시 삭제합니다(공식 통계 오염 방지).'],
  },
  {
    id: 'op-ranking-manager',
    title: 'Ranking Manager',
    desc: '산식 버전·가중치·Publish·시즌 finalize/reopen',
    category: '기록 운영', audience: 'OPERATOR', path: '/admin/ranking', length: '60~90초',
    realSave: true, privacy: false, status: '촬영 대기',
    needsTestData: '테스트 시즌 또는 fixture(실시즌 조작 금지)',
    flow: [
      '현재 산식 확인', '산식 버전 확인', '가중치 미리보기', 'Publish(변경 사유 입력)',
      '시즌 finalize', 'FINAL snapshot 확인', 'reopen', '변경 이력 확인',
    ],
    cautions: ['2026 운영 시즌을 실제로 finalize 하지 않습니다.', 'Production 에서 실제 Publish 를 실행하지 않습니다 — 화면 시연은 입력 단계까지만 촬영하거나 테스트 환경을 사용합니다.'],
  },
  {
    id: 'op-members',
    title: '회원 관리',
    desc: '신규 등록·계정 연결·역할·프로필·입상 기록·레거시 이관',
    category: '회원 운영', audience: 'OPERATOR', path: '/admin/settings', length: '90~120초',
    realSave: true, privacy: true, status: '촬영 대기',
    needsTestData: '촬영용 테스트 회원 1명', cleanupAfter: '테스트 회원·테스트 입상 기록 삭제',
    flow: [
      '신규 회원 등록', '계정 연결', '연결 해제', '회원 역할 변경', '프로필 편집(소속·MBTI·소개)',
      '입상 기록 추가', '입상 기록 수정·삭제', '기존(레거시) 입상 기록 가져오기 도구',
    ],
    cautions: ['회원 관리 화면에는 이메일 등 개인정보가 표시됩니다 — 마스킹 모드로 촬영하거나 테스트 회원 행만 화면에 담습니다.', '실제 회원의 역할·연결을 변경하지 않습니다.'],
  },
  {
    id: 'op-finance',
    title: 'Finance 운영진',
    desc: '거래 업로드·납부/미납·벌금·게스트비·월 결산·공개 공지',
    category: '재무 운영', audience: 'OPERATOR', path: '/finance', length: '120~180초',
    realSave: true, privacy: true, status: '촬영 대기',
    needsTestData: '촬영용/마스킹된 재무 데이터(실계좌·실전화 금지)',
    cleanupAfter: '촬영용 테스트 기록·공지 정리',
    flow: [
      '촬영 전 개인정보 체크(실명 표시 모드·계좌·금액 확인)', '거래 업로드', '납부 현황', '미납 관리', '휴회 처리',
      '벌금 처리', '게스트비 확인', '월 결산', '공개 공지 생성', '연도·월 전환 유지 확인',
    ],
    narration: ['공개 공지는 현재 운영값이 실명(full) 모드입니다 — 촬영 시 반드시 확인하세요.'],
    cautions: [
      '개인정보·실금액이 가장 많이 노출되는 모듈입니다 — 촬영 전 체크리스트 필수.',
      '실제 계좌번호·전화번호·관리자 메모는 화면에 담지 않습니다(마스킹 모드 사용).',
      '공개 공지의 이름 표시가 실명(full)인지 확인하고, 실명 공지 화면은 모자이크 없이 배포하지 않습니다.',
    ],
  },
  {
    id: 'op-lucky-vicky',
    title: 'Lucky Vicky 관리',
    desc: '회차 생성·팀 등록·상태·대회 목표·결과·지원 여부',
    category: '클럽 문화', audience: 'OPERATOR', path: '/admin/lucky-vicky', length: '40~60초',
    realSave: true, privacy: false, status: '촬영 대기',
    needsTestData: '촬영용 테스트 회차', cleanupAfter: '테스트 회차 삭제',
    flow: [
      '회차 생성', '팀 등록(2인 선택)', '상태 변경(대기/진행/종료)', '대회·목표 입력', '결과 입력', '지원 여부 표시',
    ],
    narration: ['회원용 Lucky Vicky 소개는 영상이 아닌 정적 이미지·텍스트로 처리합니다.'],
    cautions: ['실제 진행 중 회차를 수정하지 않습니다.'],
  },
  {
    id: 'op-guide-recording',
    title: 'Guide & Recording 사용법',
    desc: '촬영 도구 자체의 사용 방법',
    category: '운영 도구', audience: 'OPERATOR', path: '/admin/guide-recording', length: '60~90초',
    realSave: false, privacy: false, status: '촬영 대기',
    flow: [
      '미리보기 역할 전환(회원/게스트/공개)', '촬영 모드 켜기', '개인정보 마스킹 확인', '커스텀 커서 확인',
      'write guard(쓰기 차단) 동작 확인', '촬영 항목 체크리스트 완료', '촬영 모드 종료',
    ],
    cautions: ['미리보기 역할은 UI 전용이며 실제 권한(RLS)은 변하지 않습니다.'],
  },
];

export default function OperatorRecordingGuide() {
  return (
    <RecordingGuideSection
      sectionId="operator"
      title="운영진 (OPERATOR)"
      accent="#0E7C76"
      intro="운영진 매뉴얼 촬영 9모듈 — 전부 실제 저장이 발생할 수 있으므로 테스트 세션·테스트 회원·마스킹 데이터를 준비하고 촬영 후 정리합니다. 게스트 신청 검토·카카오 안내문 복사는 아래 게스트 모듈(OPERATOR)과 연결됩니다."
      modules={MODULES}
    />
  );
}
