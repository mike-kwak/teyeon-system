'use client';

// 공개 참가팀 현황.
//
//   표시 가능(서버가 주는 값 그대로): 접수 순번 · 선수1 · 선수2 · 클럽명 · 공개 상태
//   ⚠ 표시 금지: 연락처 · 입금자명 · 입금 여부 · 참가자/운영 메모 · 내부 식별자
//      → 애초에 get_public_tournament_teams 가 반환하지 않는다. 여기서 만들어 붙이지 말 것.
//   ⚠ 클럽명은 선택 입력이라 비어 있을 수 있다. '무소속' 같은 값을 화면에서 지어내지 않는다.

import React from 'react';
import { Check } from 'lucide-react';
import { TT, FONT_LABEL } from './tournamentTheme';
import type { PublicTournamentTeam } from '@/lib/tournaments/publicService';

// 상태 색 — '진행 중(접수)'과 '최종 확정(참가확정)'이 멀리서도 갈리게 계열을 완전히 분리한다.
//   ⚠ 둘 다 mint/teal pastel 로 두지 않는다(현장에서 구분이 안 됐다).
//   ⚠ DB 의 registration_status 값·의미는 건드리지 않는다. 표현만이다.
const STATUS: Record<
  PublicTournamentTeam['publicStatus'],
  { t: string; c: string; bg: string; b: string; solid?: boolean }
> = {
  applied:    { t: '접수',     c: '#1D4ED8', bg: '#EFF6FF', b: '#BFDBFE' },              // blue  — 진행 중
  waitlisted: { t: '대기',     c: '#B45309', bg: '#FEF3C7', b: '#FCD34D' },              // amber — 대기
  confirmed:  { t: '참가확정', c: '#FFFFFF', bg: '#047857', b: '#047857', solid: true }, // green solid — 확정
};

/** 요약 숫자에 쓰는 색. 아래 배지와 같은 계열로 묶어 한눈에 연결되게 한다. */
const COUNT_TONE = {
  total: TT.ink,
  applied: '#1D4ED8',
  waitlisted: '#B45309',
  confirmed: '#047857',
} as const;

interface Props {
  teams: PublicTournamentTeam[];
  /** false = 저장소/조회 미준비. 숫자를 지어내지 않고 안내만 한다. */
  ready: boolean;
  loading: boolean;
}

/** 선수 이름 — 카드에서 가장 강한 정보. */
const playerName: React.CSSProperties = {
  display: 'block',
  fontSize: 14,
  fontWeight: 800,
  color: TT.ink,
  lineHeight: 1.45,
  wordBreak: 'keep-all',
};

/** 클럽 — 이름 바로 아래 한 단계 약한 보조 정보.
 *   이름과 붙여(marginTop 2) 한 묶음으로 읽히게 하고, 묶음 사이 간격은 선수2 블록에서 벌린다. */
const playerClub: React.CSSProperties = {
  display: 'block',
  marginTop: 2,
  fontSize: 12.5,
  fontWeight: 600,
  color: TT.inkSoft,
  lineHeight: 1.55,
  wordBreak: 'keep-all',
  overflowWrap: 'anywhere',
};

/** legacy 표시용 작은 라벨. pill·박스를 쓰지 않고 muted eyebrow 로만 처리한다. */
const eyebrow: React.CSSProperties = {
  display: 'block',
  fontFamily: FONT_LABEL,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.1em',
  color: TT.subtle,
  lineHeight: 1.2,
};

export default function PublicTeamList({ teams, ready, loading }: Props) {
  const counts = React.useMemo(
    () => ({
      total: teams.length,
      applied: teams.filter((t) => t.publicStatus === 'applied').length,
      waitlisted: teams.filter((t) => t.publicStatus === 'waitlisted').length,
      confirmed: teams.filter((t) => t.publicStatus === 'confirmed').length,
    }),
    [teams],
  );

  // 최신 신청이 맨 위. 공개 RPC 는 sequence_no ASC 로 주므로 화면에서만 뒤집는다.
  //   ⚠ 원본 배열을 mutate 하지 않는다(복사 후 정렬). 위 counts 는 teams 로 계산하므로 영향 없다.
  //   ⚠ DB·RPC 는 건드리지 않는다.
  const ordered = React.useMemo(
    () => [...teams].sort((a, b) => b.sequenceNo - a.sequenceNo),
    [teams],
  );

  const notice = (title: string, body: string) => (
    <section
      style={{
        backgroundColor: TT.surface,
        border: `1px solid ${TT.line}`,
        borderRadius: 12,
        padding: '24px 18px',
        textAlign: 'center',
      }}
    >
      <p style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: TT.inkSoft, lineHeight: 1.5, wordBreak: 'keep-all' }}>
        {title}
      </p>
      <p
        style={{
          margin: '9px 0 0',
          fontSize: 12.5,
          fontWeight: 600,
          color: TT.muted,
          lineHeight: 1.75,
          wordBreak: 'keep-all',
        }}
      >
        {body}
      </p>
    </section>
  );

  if (loading) return notice('참가팀 현황 불러오는 중', '잠시만 기다려 주세요.');
  if (!ready) return notice('참가팀 현황 준비 중', '접수가 시작되면 참가팀이 순서대로 공개됩니다.');
  if (teams.length === 0) return notice('아직 접수된 팀이 없습니다', '첫 번째 참가팀이 접수되면 이곳에 표시됩니다.');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 요약 */}
      <section
        style={{
          backgroundColor: TT.surface,
          border: `1px solid ${TT.line}`,
          borderRadius: 12,
          padding: '15px 16px',
          display: 'flex',
          gap: 12,
        }}
      >
        {[
          ['전체', counts.total, COUNT_TONE.total],
          ['접수', counts.applied, COUNT_TONE.applied],
          ['대기', counts.waitlisted, counts.waitlisted ? COUNT_TONE.waitlisted : TT.subtle],
          ['참가확정', counts.confirmed, COUNT_TONE.confirmed],
        ].map(([label, value, tone]) => (
          <div key={label as string} style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                fontFamily: FONT_LABEL,
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: '0.1em',
                color: TT.subtle,
              }}
            >
              {label as string}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 19, fontWeight: 900, color: tone as string, lineHeight: 1.2 }}>
              {value as number}
            </p>
          </div>
        ))}
      </section>

      {/* 목록 */}
      <section
        style={{
          backgroundColor: TT.surface,
          border: `1px solid ${TT.line}`,
          borderRadius: 12,
          padding: '4px 16px',
        }}
      >
        {ordered.map((t, i) => {
          const s = STATUS[t.publicStatus] ?? STATUS.applied;
          // 둘 다 채워졌을 때만 선수별 매칭으로 전환한다(한쪽만 있으면 오해 소지).
          const perPlayer =
            !!(t.player1ClubName && t.player1ClubName.trim()) &&
            !!(t.player2ClubName && t.player2ClubName.trim());
          return (
            <div
              key={`${t.sequenceNo}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '14px 0',
                borderTop: i === 0 ? 'none' : `1px solid ${TT.lineSoft}`,
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  minWidth: 26,
                  marginTop: 13,
                  fontFamily: FONT_LABEL,
                  fontSize: 13,
                  fontWeight: 800,
                  color: TT.faint,
                  textAlign: 'right',
                }}
              >
                {t.sequenceNo}
              </span>
              {/* 선수 ↔ 클럽 표시.
                  · 선수별 클럽이 '둘 다' 있으면 각 선수 이름 바로 아래에 붙여 1:1 로 보여준다.
                  · 하나라도 비어 있으면 legacy 표시(참가자 / 클럽 분리)로 되돌린다.
                    한쪽만 있는 상태를 매칭처럼 보여주면 잘못된 소속으로 오해되기 때문이다.
                  ⚠ club_name(legacy) 은 DB 원본 문자열을 그대로 출력한다. 공백으로 쪼개
                     선수별로 배정하지 않는다 — 'Team 테연'처럼 이름에 공백이 있으면 깨진다. */}
              <span style={{ minWidth: 0, flex: 1 }}>
                {perPlayer ? (
                  <>
                    <span style={playerName}>{t.player1Name}</span>
                    <span style={playerClub}>{t.player1ClubName}</span>
                    <span style={{ ...playerName, marginTop: 12 }}>{t.player2Name}</span>
                    <span style={playerClub}>{t.player2ClubName}</span>
                  </>
                ) : (
                  <>
                    <span style={eyebrow}>참가자</span>
                    <span style={{ ...playerName, marginTop: 2 }}>
                      {t.player1Name} · {t.player2Name}
                    </span>
                    {t.clubName && (
                      <>
                        <span style={{ ...eyebrow, marginTop: 8 }}>클럽</span>
                        <span style={{ ...playerClub, marginTop: 2 }}>{t.clubName}</span>
                      </>
                    )}
                  </>
                )}
              </span>

              <span
                style={{
                  flexShrink: 0,
                  marginTop: 11,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '4px 9px',
                  borderRadius: 999,
                  color: s.c,
                  backgroundColor: s.bg,
                  border: `1px solid ${s.b}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {s.solid && <Check size={11} strokeWidth={3} />}
                {t.publicStatus === 'waitlisted' && t.waitlistPosition ? `대기 ${t.waitlistPosition}` : s.t}
              </span>
            </div>
          );
        })}
      </section>

      <p
        style={{
          margin: 0,
          fontSize: 12,
          fontWeight: 600,
          color: TT.subtle,
          lineHeight: 1.75,
          wordBreak: 'keep-all',
        }}
      >
        접수 순서대로 표시됩니다. 참가신청 완료가 최종 참가확정을 의미하지 않으며, 입금 확인 후 참가확정
        처리합니다.
      </p>
    </div>
  );
}
