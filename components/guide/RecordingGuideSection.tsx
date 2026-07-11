'use client';

// Guide & Recording — 촬영 모듈 공용 렌더러.
//   기존 GuestRecordingGuide 카드 패턴을 일반화: 촬영 카드 + 항목 체크리스트(localStorage) +
//   §공통 메타데이터(대상/카테고리/실제 저장/개인정보/촬영용 데이터/정리/재사용/촬영 상태/핸드북).
//   실제 기능 코드는 변경하지 않는다 — 촬영 카드·체크리스트·촬영 모드 진입만 제공.

import React from 'react';
import { useRouter } from 'next/navigation';
import { Play, Eye, Clock, ListOrdered, Info, ShieldCheck, Users, Database, Sparkles } from 'lucide-react';
import { useGuideRecording } from '@/hooks/useGuideRecording';

export type ShootAudience = 'MEMBER' | 'OPERATOR' | 'GUEST' | 'PUBLIC';
export type ShootStatus = '촬영 항목 정리 필요' | '촬영 대기' | '촬영 완료' | '핸드북 반영' | '최종 검수 완료';

export interface GuideShootModule {
  id: string;
  /** 기능명 */
  title: string;
  desc: string;
  /** 카테고리(예: 회원 기본, KDK 운영) */
  category: string;
  /** 대상 사용자 */
  audience: ShootAudience;
  /** 촬영 시작 라우트 */
  path: string;
  /** 권장 촬영 길이 */
  length: string;
  /** 실제 저장 발생 여부 */
  realSave: boolean;
  /** 개인정보 포함 여부(화면에 노출될 수 있는 실데이터) */
  privacy: boolean;
  /** 촬영용 데이터 필요(없으면 불필요) */
  needsTestData?: string;
  /** 촬영 후 정리 필요(없으면 불필요) */
  cleanupAfter?: string;
  /** 기존 영상 재사용(있으면 해당 모듈과 연결) */
  reuseVideo?: string;
  /** 촬영 상태 */
  status: ShootStatus;
  /** 핸드북 반영 상태 메모(선택) */
  handbook?: string;
  /** 촬영 항목(체크리스트) */
  flow: string[];
  narration?: string[];
  cautions: string[];
}

const CARD: React.CSSProperties = { backgroundColor: '#FFFFFF', borderRadius: 14, border: '1px solid #E3E9F2', boxShadow: '0 1px 3px rgba(15,27,51,0.05)', padding: 16 };
const miniLabel: React.CSSProperties = { margin: '10px 0 0', display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 800, color: '#64748B' };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 9, border: 'none', backgroundColor: '#0E7C76', color: '#FFFFFF', fontSize: 12, fontWeight: 800, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 9, border: '1px solid #E3E9F2', backgroundColor: '#FFFFFF', color: '#334155', fontSize: 12, fontWeight: 800, cursor: 'pointer' };

const badge = (bg: string, color: string, border: string): React.CSSProperties => ({
  fontSize: 9.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, backgroundColor: bg, color, border: `1px solid ${border}`, whiteSpace: 'nowrap',
});
const AUDIENCE_LABEL: Record<ShootAudience, string> = { MEMBER: '회원', OPERATOR: '운영진', GUEST: '초대 게스트', PUBLIC: '공개 방문자' };
const AUDIENCE_ROLE: Record<ShootAudience, 'MEMBER' | 'ADMIN_ORIGINAL' | 'GUEST' | 'PUBLIC'> = {
  MEMBER: 'MEMBER', OPERATOR: 'ADMIN_ORIGINAL', GUEST: 'GUEST', PUBLIC: 'PUBLIC',
};
const STATUS_STYLE: Record<ShootStatus, React.CSSProperties> = {
  '촬영 항목 정리 필요': badge('#FEF3C7', '#B45309', '#FDE68A'),
  '촬영 대기': badge('#EFF6FF', '#1D4ED8', '#BFDBFE'),
  '촬영 완료': badge('#DCFCE7', '#047857', '#A7F3D0'),
  '핸드북 반영': badge('#F0FDFA', '#0F766E', '#99F6E4'),
  '최종 검수 완료': badge('#F1F5F9', '#334155', '#CBD5E1'),
};

function useChecklist(storageKey: string, size: number): [Set<number>, (i: number) => void] {
  const [checked, setChecked] = React.useState<Set<number>>(new Set());
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setChecked(new Set((JSON.parse(raw) as number[]).filter((n) => n >= 0 && n < size)));
    } catch { /* 무시 — 체크 상태는 보조 기능 */ }
  }, [storageKey, size]);
  const toggle = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* 무시 */ }
      return next;
    });
  };
  return [checked, toggle];
}

function ShootModuleCard({ sectionId, mod, index }: { sectionId: string; mod: GuideShootModule; index: number }) {
  const router = useRouter();
  const g = useGuideRecording();
  const [checked, toggle] = useChecklist(`teyeon:guide:shoot:${sectionId}:${mod.id}`, mod.flow.length);
  const role = AUDIENCE_ROLE[mod.audience];

  const openPreview = () => { g.setPreviewRole(role); router.push(mod.path); };
  const openRecording = () => {
    g.setPreviewRole(role);
    g.setRecordingMode(true);
    g.setMask(true);
    g.setHideAdmin(mod.audience !== 'OPERATOR'); // 운영진 촬영은 관리 버튼이 곧 촬영 대상
    g.setWriteBlock(!mod.realSave);              // 실제 저장이 필요한 모듈만 쓰기 허용
    g.setCursorHighlight(true);
    router.push(mod.path);
  };

  return (
    <div style={{ ...CARD, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0F1B33', wordBreak: 'keep-all' }}>
            <span style={{ color: '#94A3B8', marginRight: 6 }}>{index + 1}.</span>{mod.title}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 600, color: '#94A3B8', wordBreak: 'keep-all' }}>{mod.desc}</p>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: 11, fontWeight: 800, color: '#0E7C76', backgroundColor: 'rgba(15,124,118,0.08)', padding: '4px 9px', borderRadius: 999 }}>
          <Clock size={12} /> {mod.length}
        </span>
      </div>

      {/* 공통 메타데이터 배지 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
        <span style={badge('#EFF6FF', '#1D4ED8', '#BFDBFE')}>{AUDIENCE_LABEL[mod.audience]}</span>
        <span style={badge('#F1F5F9', '#475569', '#E2E8F0')}>{mod.category}</span>
        {mod.realSave
          ? <span style={badge('#FFF7ED', '#9A3412', '#FED7AA')}>실제 저장 발생</span>
          : <span style={badge('#F0FDF4', '#15803D', '#BBF7D0')}>조회 전용</span>}
        {mod.privacy && <span style={badge('#FEF2F2', '#B91C1C', '#FECACA')}>개인정보 주의</span>}
        {mod.needsTestData && <span style={badge('#FDF4FF', '#86198F', '#F5D0FE')}>촬영용 데이터 필요</span>}
        {mod.cleanupAfter && <span style={badge('#FFFBEB', '#92400E', '#FDE68A')}>촬영 후 정리</span>}
        <span style={STATUS_STYLE[mod.status]}>{mod.status}</span>
      </div>

      {mod.realSave && (
        <p style={{ margin: '9px 0 0', display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 800, color: '#9A3412', backgroundColor: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '5px 8px', wordBreak: 'keep-all' }}>
        <Users size={12} /> 실제 저장이 발생합니다 — 촬영용 계정·테스트 데이터만 사용하세요.
        </p>
      )}

      {/* 촬영 항목 체크리스트(localStorage 유지) */}
      <p style={miniLabel}><ListOrdered size={12} /> 촬영 항목 <span style={{ color: '#0E7C76' }}>{checked.size}/{mod.flow.length}</span></p>
      <div style={{ margin: '4px 0 0' }}>
        {mod.flow.map((s, i) => (
          <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '3px 0', fontSize: 11, fontWeight: 600, color: checked.has(i) ? '#94A3B8' : '#475569', lineHeight: 1.55, cursor: 'pointer', textDecoration: checked.has(i) ? 'line-through' : 'none', wordBreak: 'keep-all' }}>
            <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>{s}</span>
          </label>
        ))}
      </div>

      {mod.narration && mod.narration.length > 0 && (
        <>
          <p style={miniLabel}><Info size={12} /> 핵심 설명</p>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 11, fontWeight: 600, color: '#475569', lineHeight: 1.6, wordBreak: 'keep-all' }}>
            {mod.narration.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </>
      )}

      <p style={{ ...miniLabel, color: '#9A3412' }}><ShieldCheck size={12} /> 주의사항</p>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 11, fontWeight: 600, color: '#9A3412', lineHeight: 1.6, wordBreak: 'keep-all' }}>
        {mod.cautions.map((t, i) => <li key={i}>{t}</li>)}
      </ul>

      {(mod.needsTestData || mod.cleanupAfter || mod.reuseVideo || mod.handbook) && (
        <div style={{ marginTop: 9, padding: '7px 9px', borderRadius: 8, backgroundColor: '#F8FAFC', border: '1px solid #EEF2F6', fontSize: 10.5, fontWeight: 600, color: '#64748B', lineHeight: 1.6, wordBreak: 'keep-all' }}>
          {mod.needsTestData && <div><Database size={10} style={{ display: 'inline', marginRight: 4 }} />준비: {mod.needsTestData}</div>}
          {mod.cleanupAfter && <div>정리: {mod.cleanupAfter}</div>}
          {mod.reuseVideo && <div>재사용: {mod.reuseVideo}</div>}
          {mod.handbook && <div>핸드북: {mod.handbook}</div>}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid #F1F5FA' }}>
        <button type="button" style={ghostBtn} onClick={openPreview}><Eye size={13} /> 미리보기</button>
        <button type="button" style={primaryBtn} onClick={openRecording}><Play size={13} /> 촬영 모드로 열기</button>
      </div>
    </div>
  );
}

export default function RecordingGuideSection({ sectionId, title, intro, accent = '#0E7C76', modules }: {
  sectionId: string;
  title: string;
  intro: string;
  accent?: string;
  modules: GuideShootModule[];
}) {
  return (
    <section style={{ ...CARD, marginBottom: 14 }}>
      <h3 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 900, color: '#0F1B33' }}>
        <span style={{ color: accent, display: 'inline-flex' }}><Sparkles size={16} /></span>{title}
        <span style={{ fontSize: 10.5, fontWeight: 800, color: accent }}>{modules.length}개 모듈</span>
      </h3>
      <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 600, color: '#475569', lineHeight: 1.6, wordBreak: 'keep-all' }}>{intro}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
        {modules.map((m, i) => <ShootModuleCard key={m.id} sectionId={sectionId} mod={m} index={i} />)}
      </div>
    </section>
  );
}
