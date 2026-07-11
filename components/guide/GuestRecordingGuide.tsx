'use client';

// Guide & Recording — 게스트 기능 촬영 모듈(3종): INVITED_GUEST / PUBLIC_GUEST / OPERATOR.
//   ⚠ 촬영 주의: 실제 전화번호·운영진 메모 노출 금지, 촬영용 테스트 신청자+가상 번호 사용,
//     승인/상태변경은 실제 저장 발생 단계임을 표시, 카카오는 자동발송이 아니라 안내문 복사,
//     Guest Pass 는 개인 Pass 가 아닌 정모 공통 링크임을 설명.

import React from 'react';
import { useRouter } from 'next/navigation';
import { Ticket, Play, Eye, Clock, ListOrdered, Info, ShieldCheck, Users } from 'lucide-react';
import { useGuideRecording } from '@/hooks/useGuideRecording';

interface ShootItem { id: string; title: string; desc: string; path: string; length: string; flow: string[]; narration: string[]; cautions: string[]; realSave?: boolean; }

const COMMON_CAUTIONS = [
  '실제 게스트 전화번호와 운영진 메모가 화면·개발자 도구에 노출되지 않도록 합니다.',
  '촬영에는 테스트 신청자와 가상 전화번호만 사용합니다.',
  '카카오 안내문은 자동 발송이 아니라 “복사 후 직접 전달”임을 설명합니다.',
  'Guest Pass 는 개인 초대장이 아니라 정모별 공통 링크임을 안내합니다.',
];

const ITEMS: ShootItem[] = [
  {
    id: 'invited',
    title: 'INVITED_GUEST — Guest Pass 사용',
    desc: '회원이 전달한 정모 공통 Guest Pass 링크를 게스트가 확인',
    path: '/guest/pass/preview',
    length: '25~35초',
    flow: [
      'Guest Pass 링크 열기(로그인 없이)', '날짜·시간·장소 확인', '게스트비·계좌 확인', '운영 규칙 확인',
      '대진표 준비/등록 상태 확인', '현재 경기 보기', '실시간 순위 확인',
      '공식 결과·게스트 정산 확인', 'TEYEON 둘러보기', '공식 인스타그램 이동',
    ],
    narration: [
      '회원이 전달한 정모 공통 링크로 로그인 없이 확인합니다.',
      '게스트비·계좌는 KDK 설정값을 읽기 전용으로 표시합니다.',
      '당일 KDK 진행 상태에 따라 안내와 버튼이 바뀝니다.',
    ],
    cautions: COMMON_CAUTIONS,
  },
  {
    id: 'public',
    title: 'PUBLIC_GUEST — 공개 신청',
    desc: '외부 사용자가 공개 페이지에서 게스트 신청',
    path: '/guest',
    length: '20~30초',
    realSave: true,
    flow: [
      '공개 게스트 신청(/guest) 진입', '모집 중 정모 확인', '이름·연락처·지역·소속·구력 입력',
      '무소속 처리 확인', '개인정보 수집·이용 동의', '게스트 신청하기', '신청 완료 화면 확인',
    ],
    narration: [
      '회원 앱과 분리된 공개 화면입니다(회원 헤더·하단바 없음).',
      '모집 중인 정모가 없으면 “모집 없음”, 준비 중이면 “준비 중”으로 안내됩니다.',
      '중복 신청은 다른 신청 정보를 노출하지 않고 일반 안내만 표시합니다.',
    ],
    cautions: [...COMMON_CAUTIONS, '제출 시 실제 신청이 저장됩니다 — 테스트 신청자만 사용하세요.'],
  },
  {
    id: 'operator',
    title: 'OPERATOR — 신청 검토·안내문 복사',
    desc: '운영진이 신청을 승인/보류/거절하고 Guest Pass·카카오 안내문 전달',
    path: '/admin/guest-applications',
    length: '30~40초',
    realSave: true,
    flow: [
      'Admin 메뉴/대시보드의 “게스트 신청” 검토 대기 배지 확인', '게스트 신청 목록(검토 대기 우선)',
      '상단 “검토가 필요한 신청 N건” 요약 확인', '전화번호 마스킹 확인', '신청 상세 열기',
      '승인 / 보류 / 거절 선택', '운영진 메모 저장', '처리 후 배지 숫자 감소 확인',
      'Guest Pass 링크 복사', '카카오 안내문 복사', '승인 게스트 KDK 후보 확인',
    ],
    narration: [
      '검토 대기(pending) 건수가 Admin 메뉴·대시보드·상단에 배지로 표시됩니다(숫자만, 개인정보 없음).',
      '신규 신청 시 운영진에게 이메일이 오지만, 상세 개인정보는 앱에서만 확인합니다.',
      '알림 이메일에는 전화번호·운영진 메모·내부 UUID 가 포함되지 않습니다(신청자 이름·정모·시각·상태만).',
      '승인/보류/거절로 처리하면 pending 배지가 즉시 줄어듭니다.',
      '이메일 신청 알림과 카카오 안내문(수동 복사)은 서로 다른 기능입니다.',
    ],
    cautions: [...COMMON_CAUTIONS, '승인·보류·거절·메모는 실제 저장이 발생합니다(감사 필드 기록).', '알림 이메일 주소·수신자 목록은 촬영에 노출하지 않습니다.'],
  },
];

const CARD: React.CSSProperties = { backgroundColor: '#FFFFFF', borderRadius: 14, border: '1px solid #E3E9F2', boxShadow: '0 1px 3px rgba(15,27,51,0.05)', padding: 16 };
const miniLabel: React.CSSProperties = { margin: '10px 0 0', display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 800, color: '#64748B' };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 9, border: 'none', backgroundColor: '#0E7C76', color: '#FFFFFF', fontSize: 12, fontWeight: 800, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 9, border: '1px solid #E3E9F2', backgroundColor: '#FFFFFF', color: '#334155', fontSize: 12, fontWeight: 800, cursor: 'pointer' };

export default function GuestRecordingGuide() {
  const router = useRouter();
  const g = useGuideRecording();
  const openPreview = (path: string) => { g.setPreviewRole('GUEST'); router.push(path); };
  const openRecording = (path: string) => {
    g.setPreviewRole('GUEST'); g.setRecordingMode(true); g.setMask(true); g.setHideAdmin(true); g.setWriteBlock(true); g.setCursorHighlight(true); router.push(path);
  };

  return (
    <section style={{ ...CARD, marginBottom: 14 }}>
      <h3 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 900, color: '#0F1B33' }}>
        <span style={{ color: '#0E7C76', display: 'inline-flex' }}><Ticket size={16} /></span>게스트 (INVITED / PUBLIC / OPERATOR)
      </h3>
      <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 600, color: '#475569', lineHeight: 1.6 }}>
        게스트 3흐름 촬영. <b>실제 전화번호·운영진 메모 노출 금지</b>, 테스트 신청자·가상 번호만 사용. 카카오는 자동발송이 아닌 <b>안내문 복사</b>, Guest Pass 는 <b>정모 공통 링크</b>.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {ITEMS.map((it, idx) => (
          <div key={it.id} style={{ ...CARD, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0F1B33' }}><span style={{ color: '#94A3B8', marginRight: 6 }}>{idx + 1}.</span>{it.title}</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>{it.desc}</p>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: 11, fontWeight: 800, color: '#0E7C76', backgroundColor: 'rgba(15,124,118,0.08)', padding: '4px 9px', borderRadius: 999 }}><Clock size={12} /> {it.length}</span>
            </div>
            {it.realSave && (
              <p style={{ margin: '9px 0 0', display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 800, color: '#9A3412', backgroundColor: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '5px 8px' }}>
                <Users size={12} /> 실제 저장 발생 — 촬영용 테스트 신청자만 사용
              </p>
            )}
            <p style={miniLabel}><ListOrdered size={12} /> 추천 촬영 순서</p>
            <ol style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 11, fontWeight: 600, color: '#475569', lineHeight: 1.6 }}>{it.flow.map((s, i) => <li key={i}>{s}</li>)}</ol>
            <p style={miniLabel}><Info size={12} /> 핵심 설명</p>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 11, fontWeight: 600, color: '#475569', lineHeight: 1.6 }}>{it.narration.map((n, i) => <li key={i}>{n}</li>)}</ul>
            <p style={{ ...miniLabel, color: '#9A3412' }}><ShieldCheck size={12} /> 주의사항</p>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 11, fontWeight: 600, color: '#9A3412', lineHeight: 1.6 }}>{it.cautions.map((c, i) => <li key={i}>{c}</li>)}</ul>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid #F1F5FA' }}>
              <button type="button" style={ghostBtn} onClick={() => openPreview(it.path)}><Eye size={13} /> 미리보기</button>
              <button type="button" style={primaryBtn} onClick={() => openRecording(it.path)}><Play size={13} /> 촬영 모드로 열기</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
