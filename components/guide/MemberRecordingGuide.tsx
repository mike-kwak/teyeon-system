'use client';

// Guide & Recording — 회원(MEMBER) 매뉴얼 촬영 모듈 7종.
//   Closing Audit 에서 누락으로 판정된 회원용 촬영 카드. 기능 코드는 변경하지 않는다.
//   상대·파트너 전적은 기존 HeadToHeadRecordingGuide, TENNIS LOG 는 기존 모듈과 연결(중복 촬영 금지).

import React from 'react';
import RecordingGuideSection, { type GuideShootModule } from './RecordingGuideSection';

const MODULES: GuideShootModule[] = [
  {
    id: 'member-start',
    title: '앱 시작·로그인·메인',
    desc: '설치된 앱 실행부터 카카오 로그인, 메인 화면 구성까지',
    category: '회원 기본', audience: 'MEMBER', path: '/', length: '40~60초',
    realSave: false, privacy: true, status: '촬영 대기',
    needsTestData: '촬영용 카카오 계정(실계정 정보 가림)',
    flow: [
      '앱 실행과 Splash 화면', '카카오 로그인', '메인 화면 전체 구성', 'TEYEON BOARD(공지) 확인',
      '다음 일정 카드', '주요 메뉴 카드 이동(대진 생성·일정·랭킹 등)', 'BottomNav 4개 항목',
    ],
    narration: [
      '로그인 유지 상태와 최초 로그인을 구분해 보여줍니다.',
      '메인 3분할(활동 회원·누적 KDK·다음 일정)은 실데이터입니다.',
    ],
    cautions: ['카카오 로그인 화면의 실제 계정 정보(이메일·프로필)를 가립니다.', '개인 알림·연락처가 화면에 스치지 않게 합니다.'],
  },
  {
    id: 'member-calendar',
    title: 'Calendar·정모 참석',
    desc: 'TEYEON 일정에서 정모를 선택하고 참석을 응답',
    category: '회원 기본', audience: 'MEMBER', path: '/tournament-calendar', length: '60~90초',
    realSave: true, privacy: true, status: '촬영 대기',
    needsTestData: '촬영용 정모 1건(참석·댓글용)',
    cleanupAfter: '촬영 후 테스트 응답·댓글 삭제',
    flow: [
      'TEYEON 일정 진입', '정모 일정 선택', '참석 응답', '시작 시간 선택', '조퇴 시간 선택',
      '불참 응답', '응답 취소', '참석·불참·미응답 명단 확인', '댓글·답글 작성',
    ],
    narration: ['참석 응답은 실제 저장이며 명단에 즉시 반영됩니다.'],
    cautions: ['촬영용 정모만 사용합니다(실제 운영 정모 응답 변경 금지).', '명단의 회원 전화번호·이메일은 화면에 없지만 실명이 보이므로 필요 시 마스킹합니다.', '저장 장면은 촬영용 회원 계정에서 촬영합니다(미리보기 역할에서는 저장이 차단됨).'],
  },
  {
    id: 'member-kdk-view',
    title: 'KDK 조회·LIVE COURT·전광판',
    desc: '회원 시점의 대진·현재 경기·순위·전광판 확인',
    category: 'KDK', audience: 'MEMBER', path: '/kdk?entry=live', length: '50~80초',
    realSave: false, privacy: false, status: '촬영 대기',
    needsTestData: '촬영용 KDK 테스트 세션(is_test)',
    flow: [
      '대진 확인', '현재 경기 확인', '다음 경기 확인', '실시간 순위 확인',
      '전광판(/kdk/display) 열기', '모바일 화면과 전광판 정보 대조',
    ],
    narration: ['회원 조회 화면에서는 저장이 발생하지 않습니다.', '운영 점수 입력 장면은 운영진 모듈에서 별도 촬영합니다.'],
    cautions: ['테스트 세션을 사용하고 실제 운영 세션 화면과 섞지 않습니다.'],
  },
  {
    id: 'member-archive',
    title: 'Archive 공식 기록',
    desc: '공식 KDK 기록 보관소 탐색',
    category: '기록', audience: 'MEMBER', path: '/archive', length: '40~60초',
    realSave: false, privacy: false, status: '촬영 대기',
    flow: [
      '공식 기록 목록', '세션 선택', '최종 순위 확인', '경기 결과 확인', '정산 참고 화면', '공식 기록 표시(뱃지) 확인',
    ],
    cautions: ['미확정·테스트 기록은 관리자에게만 보입니다 — 회원 시점으로 촬영합니다.'],
  },
  {
    id: 'member-ranking',
    title: 'Ranking 기본',
    desc: '시즌·월간·누적 랭킹과 이전 시즌 FINAL, Awards',
    category: '기록', audience: 'MEMBER', path: '/ranking', length: '60~90초',
    realSave: false, privacy: false, status: '촬영 대기',
    reuseVideo: '상대·파트너 전적은 기존 "회원 상대전적 확인" 모듈과 연결(중복 촬영 금지)',
    flow: [
      '메인 RANKING 카드 진입', '시즌 탭', '월간 탭', '누적 탭', '이전 시즌 선택',
      'LIVE / FINAL 구분 표시', 'Awards(최다 우승·참가·승률·TOP3)', '공동 수상자 목록', '랭킹 행에서 PlayerCardModal 열기',
    ],
    narration: ['FINAL 은 확정 스냅샷, LIVE 는 진행 중 시즌입니다.'],
    cautions: ['상대전적·파트너 전적 화면은 기존 모듈에서 촬영하므로 여기서는 진입 지점만 보여줍니다.'],
  },
  {
    id: 'member-profile',
    title: '멤버·개인 프로필',
    desc: '멤버 목록, Player Card, 전체 입상 기록, 공개 범위 설정',
    category: '회원 기본', audience: 'MEMBER', path: '/members', length: '50~80초',
    realSave: true, privacy: true, status: '촬영 대기',
    cleanupAfter: '공개 범위를 촬영 전 상태로 되돌리기',
    flow: [
      '멤버 목록', '회원 카드(대표 입상·MBTI)', 'PlayerCardModal 열기', '최신 입상 배지 확인',
      '개인 프로필(/profile) 이동', '최근 입상 3건·전체 입상 보기', '공개 범위 설정 변경',
    ],
    narration: ['입상 기록은 운영진이 등록한 공식 기록만 표시됩니다.'],
    cautions: ['공개 범위 설정은 실제 저장이 발생합니다 — 촬영 후 원래 값으로 복구합니다.', '회원 실명·사진이 보이므로 사전 동의된 계정 위주로 촬영합니다.'],
  },
  {
    id: 'member-finance',
    title: 'Finance 회원용',
    desc: '본인 납부 예정·완료·남은 금액·연회비 상태',
    category: '재무', audience: 'MEMBER', path: '/finance', length: '40~60초',
    realSave: false, privacy: true, status: '촬영 대기',
    needsTestData: '촬영용 회원의 본인 납부 데이터(마스킹 확인)',
    flow: [
      '본인 납부 예정 확인', '납부 완료 내역', '남은 금액', '최근 납부 상태', '연회비 상태',
    ],
    narration: ['회원 화면은 본인 데이터만 표시합니다 — 다른 회원 정보는 보이지 않습니다.'],
    cautions: ['실제 계좌번호는 화면에서 가리거나 마스킹 모드로 촬영합니다.', '관리자 벌금·상금·정산 화면은 운영진 모듈에서 별도 촬영합니다.'],
  },
];

export default function MemberRecordingGuide() {
  return (
    <RecordingGuideSection
      sectionId="member"
      title="회원 (MEMBER)"
      accent="#2563EB"
      intro="일반 회원 매뉴얼 촬영 7모듈. 조회 중심이지만 참석 응답·공개 범위 설정은 실제 저장이 발생하므로 촬영용 계정과 정모를 사용하세요."
      modules={MODULES}
    />
  );
}
