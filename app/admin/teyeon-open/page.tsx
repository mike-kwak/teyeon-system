'use client';

export const dynamic = 'force-dynamic';

// Admin — TEYEON OPEN 통합 운영 허브 (/admin/teyeon-open).
//
//   흩어져 있던 2026 TEYEON OPEN 운영 화면을 한곳에서 여는 '길 안내' 화면이다. 기능을 새로 만들지 않는다.
//   ⚠ 이미 구현된 라우트에만 연결한다. 없는 기능은 '준비 중'으로 표시하고 링크를 만들지 않는다.
//   ⚠ 접근: 서버(middleware) 1차 — 그 밖의 /admin/** 규칙으로 CEO/ADMIN 만 + admin layout 2차 + 이 페이지 3차.
//     각 화면의 데이터 보호는 기존 RPC · RLS 가 그대로 한다(이 화면은 데이터를 읽지 않는다).
//   ⚠ 참가자 화면 검수 링크는 공개 라우트(/tournaments/{slug}/...)만 쓴다. 공개 여부는 서버 공개 설정을 따른다.
//   ⚠ 기존 '대회 접수'(/admin/tournaments) 메뉴 · 각 관리 화면은 그대로 둔다 — 같은 화면으로 가는 지름길이다.

import React from 'react';
import Link from 'next/link';
import {
  ArrowUpRight, Award, CalendarClock, CalendarDays, ClipboardList, Clock, Eye, Gauge, LayoutGrid, ListOrdered, MapPin, MessageSquareText,
  Network, ShieldAlert, ShieldCheck, Smartphone, SquareStack, Trophy, Tv, UserCheck, Users, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import { TEYEON_OPEN_2026_SLUG, getOfficialTournament } from '@/lib/tournaments/officialInfo';
import SignatureDisplayLauncher from '@/components/tournaments/SignatureDisplayLauncher';

const INK = '#0F172A';
const INK_SOFT = '#334155';
const MUTED = '#64748B';
const FAINT = '#94A3B8';
const LINE = '#E2E8F0';
const NAVY = '#0F1B33';
const TEAL = '#0F766E';
const TEAL_SOFT = '#F0FAF8';
const LABEL = 'var(--font-rajdhani), sans-serif';

interface HubLink {
  id: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  /** 없으면 '준비 중'(링크 없음). */
  href?: string;
  /** 공개 화면 · 전광판 — 새 탭으로 연다(운영 화면은 원래 탭에 남는다). */
  newTab?: boolean;
  /** 카드 아래 작은 안내. */
  note?: string;
  /** 눈에 띄게 강조할 카드 — 짧은 꼬리표(예: 'SMS')를 함께 보인다. */
  badge?: string;
}

interface HubSection {
  id: string;
  no: string;
  title: string;
  lead: string;
  links: HubLink[];
}

function sectionsFor(slug: string): HubSection[] {
  const admin = `/admin/tournaments/${encodeURIComponent(slug)}`;
  const pub = `/tournaments/${encodeURIComponent(slug)}`;
  return [
    {
      id: 'registration', no: '01', title: '참가 접수', lead: '참가 신청 현황을 보고 상태를 처리합니다.',
      links: [
        { id: 'registrations', title: '신청 현황', desc: '신청 목록 · 입금/확정 상태 · 대기팀 승격', icon: ClipboardList, href: `${admin}/registrations` },
        {
          id: 'sms-center', title: '대회 문자 안내 센터', desc: 'SMS NOTICE CENTER · 참가자 연락처 · 문자 템플릿 · 안내 링크 관리(번호 · 문구 복사 → 휴대폰 문자 앱으로 발송)',
          icon: MessageSquareText, href: `${admin}/sms-center`, badge: 'SMS',
        },
        { id: 'hosted-list', title: '대회 접수 목록', desc: '기존 ‘대회 접수’ 메뉴와 같은 화면 · 주최 대회 전체', icon: SquareStack, href: '/admin/tournaments' },
      ],
    },
    {
      id: 'manage', no: '02', title: '대회 관리', lead: '참가팀 확정부터 예선 조 편성 · 본선 대진까지.',
      links: [
        { id: 'teams', title: '참가팀 관리 · 확정', desc: '확정 신청을 참가팀으로 옮기고 팀 정보를 관리', icon: Users, href: `${admin}/teams` },
        { id: 'courts', title: '코트 설정', desc: '사용할 코트 수 · 이름 · 운영 여부', icon: LayoutGrid, href: `${admin}/courts` },
        { id: 'groups', title: '예선 조 편성', desc: '경기이사가 직접 조를 배치하고 공개', icon: Network, href: `${admin}/groups` },
        { id: 'schedule', title: '조별 일정 · 출전 신고', desc: '조마다 첫 번째/두 번째 조 · 예정 코트 지정, 신고 장소 · 마감 시간', icon: CalendarClock, href: `${admin}/schedule` },
        { id: 'bracket', title: '본선 대진', desc: '진출팀 · 라운드 구조 입력, 대진 확정 · 공개', icon: Trophy, href: `${admin}/bracket` },
        { id: 'settings', title: '대회 설정', desc: '일정 · 요강 · 접수 상태를 바꾸는 관리 화면은 아직 없습니다.', icon: Wrench },
      ],
    },
    {
      id: 'operate', no: '03', title: '경기 운영', lead: '대회 당일 관제 — 호명 · 코트 투입 · 점수 · 완료.',
      links: [
        { id: 'checkin', title: '선수 체크인', desc: '두 선수 도착 확인 후 팀 단위 체크인 · 현황 · 취소', icon: UserCheck, href: `${admin}/checkin` },
        { id: 'control', title: 'Control Center', desc: '코트 배정 · 경기 시작 · 점수 입력 · 완료 처리(당일 관제)', icon: Gauge, href: `${admin}/control` },
        { id: 'staff', title: '현장 운영자 승인', desc: '현장 운영 권한 요청 승인 · 회수(예선 · 본선 경기 시작 · 점수 입력 · 완료)', icon: ShieldCheck, href: `${admin}/staff` },
        { id: 'matches', title: '예선 경기 운영(기존)', desc: 'Control Center 이전의 예선 경기 운영 화면', icon: Clock, href: `${admin}/matches` },
      ],
    },
    {
      id: 'public', no: '05', title: '참가자 화면 검수', lead: '참가자가 보는 실제 공개 화면입니다. 휴대폰 화면 확인용으로 새 탭에서 열립니다. 예선 · 본선은 공개 전이면 참가자에게 보이는 안내 문구가 그대로 나옵니다.',
      links: [
        { id: 'pub-hub', title: '대회 Hub', desc: '참가자 첫 화면(QR 진입점)', icon: Smartphone, href: pub, newTab: true },
        { id: 'pub-teams', title: '참가팀 현황', desc: '공개 참가팀 목록', icon: Users, href: `${pub}/teams`, newTab: true },
        { id: 'pub-preview', title: '예선 대진표 미리보기', desc: '공개 전에도 참가자 화면 그대로 확인 · 공개 상태는 바뀌지 않음', icon: Eye, href: `${admin}/draw-preview` },
        { id: 'pub-draw', title: '예선 조별 리그', desc: '공개 예선 조 · 순위', icon: LayoutGrid, href: `${pub}/draw`, newTab: true },
        { id: 'pub-knockout', title: '본선 토너먼트', desc: '공개 본선 대진', icon: Trophy, href: `${pub}/draw/knockout`, newTab: true },
        {
          id: 'pub-full', title: '전체 본선표', desc: '본선 토너먼트 화면과 같은 주소입니다.', icon: Network, href: `${pub}/draw/knockout`, newTab: true,
          note: '별도 주소는 없습니다. 화면 안 ‘전체 대진 맞춤’ 버튼으로 전체 대진을 봅니다.',
        },
      ],
    },
    {
      id: 'results', no: '06', title: '대회 결과', lead: '예선 순위는 관리자 화면에서 확인합니다.',
      links: [
        { id: 'standings', title: '예선 순위', desc: '조별 순위 · 진출 · 동률 확인(관리자)', icon: ListOrdered, href: `${admin}/standings` },
        { id: 'placement', title: '순위결정전', desc: '순위결정전 상세(관리자)', icon: Award, href: `${admin}/standings/placement` },
        { id: 'final-results', title: '최종 결과 · 시상', desc: '본선 최종 순위 · 공개 RESULTS 화면은 아직 없습니다.', icon: Award },
      ],
    },
  ];
}

function HubCard({ link }: { link: HubLink }) {
  const Icon = link.icon;
  const ready = !!link.href;
  const accent = ready && !!link.badge;
  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
        <span aria-hidden style={{
          width: 36, height: 36, flexShrink: 0, borderRadius: 10, display: 'grid', placeItems: 'center',
          background: accent ? TEAL : ready ? '#EEF2FF' : '#F1F5F9', border: `1px solid ${accent ? TEAL : ready ? '#DCE3F5' : LINE}`,
        }}>
          <Icon size={18} strokeWidth={2.2} color={accent ? '#fff' : ready ? NAVY : FAINT} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14.5, fontWeight: 900, color: ready ? INK : MUTED, wordBreak: 'keep-all' }}>{link.title}</span>
            {accent && (
              <span data-hub-badge style={{ fontFamily: LABEL, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: '#fff', background: TEAL, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                {link.badge}
              </span>
            )}
            {!ready && (
              <span data-hub-pending style={{ fontSize: 10.5, fontWeight: 800, color: '#B45309', background: '#FEF3C7', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                준비 중
              </span>
            )}
            {ready && link.newTab && (
              <span style={{ fontSize: 10.5, fontWeight: 800, color: '#1D4ED8', background: '#EFF6FF', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                새 탭
              </span>
            )}
          </div>
          <p style={{ margin: '3px 0 0', fontSize: 12.5, fontWeight: 600, color: MUTED, lineHeight: 1.55, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
            {link.desc}
          </p>
        </div>
        {ready && <ArrowUpRight size={16} color={FAINT} style={{ flexShrink: 0, marginTop: 2 }} />}
      </div>
      {link.note && (
        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: FAINT, lineHeight: 1.55, wordBreak: 'keep-all' }}>{link.note}</p>
      )}
      {ready && (
        <code style={{ marginTop: 'auto', fontSize: 11, fontWeight: 600, color: FAINT, overflowWrap: 'anywhere' }}>{link.href}</code>
      )}
    </>
  );
  const frame: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, boxSizing: 'border-box',
    background: accent ? TEAL_SOFT : ready ? '#fff' : '#F8FAFC',
    border: accent ? `1.5px solid ${TEAL}` : `1px ${ready ? 'solid' : 'dashed'} ${ready ? LINE : '#CBD5E1'}`,
    borderRadius: 12, padding: 13, textDecoration: 'none', color: 'inherit',
  };
  if (!ready) return <div data-hub-card={link.id} aria-disabled="true" style={frame}>{body}</div>;
  return (
    <Link data-hub-card={link.id} href={link.href!} className="hub-card" style={frame}
      {...(link.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {body}
    </Link>
  );
}

function SectionHead({ no, title, lead }: { no: string; title: string; lead: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={{ margin: 0, fontFamily: LABEL, fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', color: FAINT }}>STEP {no}</p>
      <h2 style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 900, color: INK }}>{title}</h2>
      <p style={{ margin: '3px 0 0', fontSize: 12.5, fontWeight: 600, color: MUTED, lineHeight: 1.55, wordBreak: 'keep-all' }}>{lead}</p>
    </div>
  );
}

export default function AdminTeyeonOpenHubPage() {
  const { role } = useAuth();
  const slug = TEYEON_OPEN_2026_SLUG;
  const event = getOfficialTournament(slug);

  if (!isFullAdminRole(role)) {
    return (
      <div style={{ display: 'flex', gap: 9, padding: 15, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12 }}>
        <ShieldAlert size={17} color="#B91C1C" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: INK }}>TEYEON OPEN 운영 화면은 CEO · ADMIN 전용입니다.</p>
      </div>
    );
  }

  const sections = sectionsFor(slug);
  const before = sections.filter((s) => s.no < '04');
  const after = sections.filter((s) => s.no > '04');
  const grid = (s: HubSection) => (
    <section key={s.id} data-hub-section={s.id} style={{ marginBottom: 22 }}>
      <SectionHead no={s.no} title={s.title} lead={s.lead} />
      <div className="hub-grid">
        {s.links.map((l) => <HubCard key={l.id} link={l} />)}
      </div>
    </section>
  );

  return (
    <div data-teyeon-open-hub style={{ maxWidth: 1180, margin: '0 auto' }}>
      {/* 대회 머리말 */}
      <header style={{
        background: `linear-gradient(135deg, ${NAVY} 0%, #1B2E55 100%)`, borderRadius: 16, padding: '18px 18px 16px',
        marginBottom: 22, color: '#fff', boxShadow: '0 8px 24px rgba(15, 27, 51, 0.18)',
      }}>
        <p style={{ margin: 0, fontFamily: LABEL, fontSize: 11, fontWeight: 800, letterSpacing: '0.28em', color: '#38BDF8' }}>
          TOURNAMENT OPERATIONS
        </p>
        <h1 style={{ margin: '4px 0 0', fontSize: 23, fontWeight: 900, letterSpacing: '-0.01em', wordBreak: 'keep-all' }}>
          {event?.titleFull ?? '2026 TEYEON OPEN'}
        </h1>
        {event && (
          <>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, fontWeight: 700, color: '#C7D2E3', wordBreak: 'keep-all' }}>{event.subtitleKo}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 12, fontSize: 12.5, fontWeight: 700, color: '#E2E8F0' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><CalendarDays size={14} />{event.eventDateLabel} · {event.startTimeLabel}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><MapPin size={14} />{event.venueName}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Clock size={14} />접수 마감 {event.registrationCloseLabel}</span>
            </div>
          </>
        )}
      </header>

      {before.map(grid)}

      {/* 04 전광판 — 기존 SignatureDisplayLauncher 그대로(실전 · 테스트 구분) + 기존 ARENA TV */}
      <section data-hub-section="display" style={{ marginBottom: 22 }}>
        <SectionHead no="04" title="전광판" lead="TV · 외부 모니터 화면. 실전(운영 데이터)과 테스트(가상 데이터)를 구분해 새 탭에서 엽니다." />
        <SignatureDisplayLauncher slug={slug} />
        <div className="hub-grid">
          <HubCard link={{
            id: 'arena-tv', title: '기존 ARENA TV', desc: '기존 운영 Arena 화면(예선/본선 전환은 화면 안에서)', icon: Tv,
            href: `/tournaments/${encodeURIComponent(slug)}/arena?mode=prelim`, newTab: true,
          }} />
        </div>
      </section>

      {after.map(grid)}

      <style>{`
        .hub-grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
        @media (min-width: 640px) { .hub-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (min-width: 1180px) { .hub-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        .hub-card { transition: border-color 120ms ease, box-shadow 120ms ease; }
        .hub-card:hover { border-color: #93A4C8 !important; box-shadow: 0 2px 10px rgba(15, 27, 51, 0.08); }
        .hub-card:focus-visible { outline: 2px solid #2563EB; outline-offset: 2px; }
      `}</style>
    </div>
  );
}
