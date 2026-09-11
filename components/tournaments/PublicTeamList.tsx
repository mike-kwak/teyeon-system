'use client';

// 공개 참가팀 현황.
//
//   표시 가능(서버가 주는 값 그대로): 접수 순번 · 선수1 · 선수2 · 클럽명 · 공개 상태
//   ⚠ 표시 금지: 연락처 · 입금자명 · 입금 여부 · 참가자/운영 메모 · 내부 식별자
//      → 애초에 get_public_tournament_teams 가 반환하지 않는다. 여기서 만들어 붙이지 말 것.
//   ⚠ 클럽명은 선택 입력이라 비어 있을 수 있다. '무소속' 같은 값을 화면에서 지어내지 않는다.

import React from 'react';
import { TT, FONT_LABEL } from './tournamentTheme';
import type { PublicTournamentTeam } from '@/lib/tournaments/publicService';

const STATUS: Record<PublicTournamentTeam['publicStatus'], { t: string; c: string; bg: string }> = {
  applied: { t: '접수', c: TT.tealDeep, bg: TT.tealSoft },
  waitlisted: { t: '대기', c: '#B45309', bg: '#FEF3C7' },
  confirmed: { t: '참가확정', c: '#047857', bg: '#DCFCE7' },
};

interface Props {
  teams: PublicTournamentTeam[];
  /** false = 저장소/조회 미준비. 숫자를 지어내지 않고 안내만 한다. */
  ready: boolean;
  loading: boolean;
}

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
          ['전체', counts.total, TT.ink],
          ['접수', counts.applied, TT.tealDeep],
          ['대기', counts.waitlisted, counts.waitlisted ? '#B45309' : TT.ink],
          ['참가확정', counts.confirmed, '#047857'],
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
        {teams.map((t, i) => {
          const s = STATUS[t.publicStatus] ?? STATUS.applied;
          return (
            <div
              key={`${t.sequenceNo}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 0',
                borderTop: i === 0 ? 'none' : `1px solid ${TT.lineSoft}`,
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  minWidth: 26,
                  fontFamily: FONT_LABEL,
                  fontSize: 13,
                  fontWeight: 800,
                  color: TT.faint,
                  textAlign: 'right',
                }}
              >
                {t.sequenceNo}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 800,
                    color: TT.ink,
                    lineHeight: 1.45,
                    wordBreak: 'keep-all',
                  }}
                >
                  {t.player1Name} · {t.player2Name}
                </span>
                {t.clubName && (
                  <span
                    style={{
                      display: 'block',
                      marginTop: 3,
                      fontSize: 12,
                      fontWeight: 600,
                      color: TT.muted,
                      lineHeight: 1.5,
                      wordBreak: 'keep-all',
                    }}
                  >
                    {t.clubName}
                  </span>
                )}
              </span>
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '4px 9px',
                  borderRadius: 999,
                  color: s.c,
                  backgroundColor: s.bg,
                  whiteSpace: 'nowrap',
                }}
              >
                {s.t}
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
