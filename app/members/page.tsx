'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from '@/components/ProfileAvatar';
import PremiumSpinner from '@/components/PremiumSpinner';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Lock, Users, X } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Member {
  id: string;
  nickname: string;
  role?: string;
  is_admin?: boolean;
  is_guest?: boolean;
  phone?: string;
  email?: string;
  mbti?: string;
  affiliation?: string;
  position?: string;
  achievements?: string;
  bio?: string;
  avatar_url?: string;
  profile_avatar_url?: string;
  // TODO: 아래 stat 필드는 teyeon_archive_v1 집계 쿼리로 채울 예정
  // total_matches?: number;
  // wins?: number;
  // attended_sessions?: number;
}

// TODO: profiles 테이블에 아래 필드 추가 후 연동 예정
// type VisibilityLevel = 'public' | 'partial' | 'private';
// interface ProfileVisibility {
//   show_rank: boolean;
//   show_win_rate: boolean;
//   show_match_record: boolean;
//   show_attendance: boolean;
//   show_badges: boolean;
//   show_recent_matches: boolean;
// }

// ─── Sorting helpers (unchanged) ──────────────────────────────────────────────

const EXE_PRIORITY: Record<string, number> = {
  '회장': 1, '부회장': 2, '총무': 3, '재무': 4, '경기': 5, '섭외': 6,
};
const MEMBER_PRIORITY: Record<string, number> = {
  '정회원': 10, '준회원': 20, '게스트': 30,
};

const getMemberPriority = (m: Member): number => {
  const role = (m.role || '').trim();
  const pos  = (m.position || '').trim();
  if (EXE_PRIORITY[role]) return EXE_PRIORITY[role];
  if (EXE_PRIORITY[pos])  return EXE_PRIORITY[pos];
  if (m.is_admin)         return 0;
  if (MEMBER_PRIORITY[role]) return MEMBER_PRIORITY[role];
  if (MEMBER_PRIORITY[pos])  return MEMBER_PRIORITY[pos];
  if (m.is_guest) return 30;
  return 99;
};

// ─── Badge helpers ────────────────────────────────────────────────────────────

const getRoleLabel = (m: Member): string => {
  const role = (m.role || '').trim();
  const pos  = (m.position || '').trim();
  return role || pos || (m.is_guest ? '게스트' : '멤버');
};

type BadgeVariant = 'gold' | 'teal' | 'muted';

const getBadgeVariant = (label: string, isAdmin?: boolean): BadgeVariant => {
  if (label === '회장' || label === '부회장' || isAdmin) return 'gold';
  if (EXE_PRIORITY[label] || label === '정회원')          return 'teal';
  return 'muted';
};

const BADGE_STYLES: Record<BadgeVariant, React.CSSProperties> = {
  gold: {
    backgroundColor: 'rgba(201,168,76,0.12)',
    color: '#B8891C',
    border: '1px solid rgba(201,168,76,0.28)',
  },
  teal: {
    backgroundColor: 'rgba(13,148,136,0.09)',
    color: '#0D9488',
    border: '1px solid rgba(13,148,136,0.22)',
  },
  muted: {
    backgroundColor: 'rgba(100,116,139,0.08)',
    color: '#64748B',
    border: '1px solid rgba(100,116,139,0.16)',
  },
};

const ACCENT: Record<BadgeVariant, string> = {
  gold: '#C9A84C',
  teal: '#0D9488',
  muted: '#94A3B8',
};

// ─── PlayerCardModal ──────────────────────────────────────────────────────────

interface PlayerCardModalProps {
  member: Member;
  finalAvatar?: string;
  isOwnCard: boolean;
  onClose: () => void;
}

function PlayerCardModal({ member, finalAvatar, isOwnCard, onClose }: PlayerCardModalProps) {
  const roleLabel   = getRoleLabel(member);
  const variant     = getBadgeVariant(roleLabel, member.is_admin);
  const accentColor = ACCENT[variant];

  // Mock visibility: MVP is always 'public'.
  // TODO: load from profiles.profile_visibility_level
  const visibilityLevel: 'public' | 'partial' | 'private' = 'public';

  const [perspective, setPerspective] = useState<'self' | 'other'>(
    isOwnCard ? 'self' : 'other'
  );

  const showStats =
    perspective === 'self' || visibilityLevel === 'public';

  const statLabelStyle: React.CSSProperties = {
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: '0.20em',
    textTransform: 'uppercase',
    color: '#94A3B8',
    marginBottom: 4,
  };

  const statValueStyle: React.CSSProperties = {
    fontSize: 20,
    fontWeight: 900,
    color: '#0F172A',
    letterSpacing: '-0.03em',
    lineHeight: 1,
  };

  const lockedCell = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 9,
        fontWeight: 600,
        color: '#94A3B8',
      }}
    >
      <Lock size={9} />
      본인만 공개
    </span>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        backgroundColor: 'rgba(15,23,42,0.58)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        overflowY: 'auto',
      } as React.CSSProperties}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 340,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {/* Close */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              width: 34, height: 34,
              borderRadius: '50%',
              backgroundColor: 'rgba(255,255,255,0.14)',
              border: '1px solid rgba(255,255,255,0.22)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#FFFFFF',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Perspective toggle — own card only */}
        {isOwnCard && (
          <div
            style={{
              display: 'flex',
              backgroundColor: 'rgba(255,255,255,0.11)',
              borderRadius: 99,
              padding: 3,
              marginBottom: 10,
              border: '1px solid rgba(255,255,255,0.16)',
            }}
          >
            {(['self', 'other'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPerspective(p)}
                style={{
                  flex: 1,
                  height: 30,
                  borderRadius: 99,
                  border: 'none',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  backgroundColor: perspective === p ? '#FFFFFF' : 'transparent',
                  color: perspective === p ? '#0F172A' : 'rgba(255,255,255,0.60)',
                  transition: 'background-color 0.18s, color 0.18s',
                }}
              >
                {p === 'self' ? '내 카드' : '다른 회원 시점'}
              </button>
            ))}
          </div>
        )}

        {/* ═══ THE CARD ═══ */}
        {/* Gradient border simulation */}
        <div
          style={{
            background: `linear-gradient(135deg, ${accentColor} 0%, #0D9488 45%, ${accentColor} 80%, #0D9488 100%)`,
            padding: 1.5,
            borderRadius: 22,
            boxShadow: `0 14px 48px rgba(0,0,0,0.24), 0 6px 20px ${accentColor}3A`,
          }}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 20.5,
              overflow: 'hidden',
              position: 'relative',
              background: 'linear-gradient(160deg, #FFFFFF 0%, #F8FAFC 55%, #F0F9FF 100%)',
            }}
          >
            {/* Glass shimmer */}
            <div
              style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, height: '42%',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0) 100%)',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            />

            {/* Top accent strip */}
            <div
              style={{
                height: 5,
                background: `linear-gradient(90deg, #0D9488, ${accentColor}, #0D9488)`,
              }}
            />

            {/* Card body */}
            <div style={{ padding: '16px 18px 18px', position: 'relative', zIndex: 2 }}>

              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <p
                  style={{
                    fontFamily: 'var(--font-rajdhani), sans-serif',
                    fontSize: 8.5,
                    fontWeight: 900,
                    letterSpacing: '0.30em',
                    textTransform: 'uppercase',
                    color: '#0D9488',
                    margin: 0,
                  }}
                >
                  TEYEON
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      ...BADGE_STYLES[variant],
                      fontSize: 8,
                      fontWeight: 800,
                      letterSpacing: '0.10em',
                      textTransform: 'uppercase',
                      padding: '2px 7px',
                      borderRadius: 4,
                    }}
                  >
                    {roleLabel}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8' }}>
                    KDK&nbsp;--
                    {/* TODO: teyeon_archive_v1 집계 후 실제 랭킹 표시 */}
                  </span>
                </div>
              </div>

              {/* Avatar + name */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    width: 80, height: 80,
                    borderRadius: '50%',
                    padding: 2.5,
                    background: `linear-gradient(135deg, ${accentColor}40, #0D948826)`,
                    boxShadow: `0 0 0 1px ${accentColor}30, 0 4px 16px ${accentColor}1A`,
                  }}
                >
                  <div
                    style={{
                      width: 75, height: 75,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      backgroundColor: `${accentColor}14`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ProfileAvatar
                      src={finalAvatar}
                      alt={member.nickname}
                      size={75}
                      fallbackIcon={
                        <span
                          style={{
                            fontSize: 30,
                            fontWeight: 900,
                            color: accentColor,
                            lineHeight: 1,
                          }}
                        >
                          {(member.nickname || '?').charAt(0)}
                        </span>
                      }
                    />
                  </div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <p
                    style={{
                      fontSize: 20,
                      fontWeight: 900,
                      color: '#0F172A',
                      margin: 0,
                      letterSpacing: '-0.02em',
                      lineHeight: 1.15,
                    }}
                  >
                    {member.nickname}
                    {member.is_guest && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#94A3B8', marginLeft: 4 }}>
                        (G)
                      </span>
                    )}
                  </p>
                  {(member.affiliation || member.mbti) && (
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: '#94A3B8',
                        margin: '4px 0 0',
                        lineHeight: 1.4,
                      }}
                    >
                      {[member.affiliation, member.mbti].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </div>

              {/* Stats row */}
              <div
                style={{
                  display: 'flex',
                  backgroundColor: '#F8FAFC',
                  borderRadius: 12,
                  border: '1px solid rgba(0,0,0,0.06)',
                  marginBottom: 14,
                  overflow: 'hidden',
                }}
              >
                {(['WIN RATE', 'ATTEND', 'RECORD'] as const).map((label, idx) => (
                  <div
                    key={label}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      padding: '9px 4px',
                      borderLeft: idx > 0 ? '1px solid rgba(0,0,0,0.06)' : undefined,
                    }}
                  >
                    <span style={statLabelStyle}>{label}</span>
                    {showStats ? (
                      <span style={statValueStyle}>--</span>
                    ) : (
                      /* TODO: 실제 통계 연동 후 값 표시, privacy 설정에 따라 잠금 처리 */
                      lockedCell
                    )}
                  </div>
                ))}
              </div>

              {/* Privacy note — shown only when stats are locked in other-perspective */}
              {!showStats && (
                <p
                  style={{
                    margin: '0 0 10px',
                    fontSize: 9,
                    fontWeight: 500,
                    color: '#94A3B8',
                    textAlign: 'center',
                    lineHeight: 1.4,
                    letterSpacing: '-0.01em',
                  }}
                >
                  일부 기록은 본인만 확인할 수 있어요
                </p>
              )}

              {/* Badges */}
              {(member.achievements || member.mbti) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                  {member.achievements && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 5,
                        backgroundColor: 'rgba(201,168,76,0.10)',
                        color: '#B8891C',
                        border: '1px solid rgba(201,168,76,0.22)',
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      🏆 {member.achievements}
                    </span>
                  )}
                  {member.mbti && !member.affiliation && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 5,
                        backgroundColor: 'rgba(13,148,136,0.08)',
                        color: '#0D9488',
                        border: '1px solid rgba(13,148,136,0.18)',
                      }}
                    >
                      {member.mbti}
                    </span>
                  )}
                </div>
              )}

              {/* Own card actions */}
              {isOwnCard && (
                <button
                  type="button"
                  style={{
                    width: '100%',
                    height: 38,
                    borderRadius: 10,
                    border: '1.5px solid rgba(13,148,136,0.22)',
                    backgroundColor: 'rgba(13,148,136,0.06)',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#0D9488',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                    letterSpacing: '-0.01em',
                  }}
                >
                  기록 공개 설정
                  {/* TODO: privacy 설정 모달/drawer 연결 */}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Card ID footer */}
        <p
          style={{
            marginTop: 8,
            textAlign: 'center',
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.28)',
          }}
        >
          TEYEON MEMBER CARD · {member.id.slice(0, 8).toUpperCase()}
        </p>
      </div>
    </div>
  );
}

// ─── MemberCard (grid list) ───────────────────────────────────────────────────

const MemberCard = React.memo(function MemberCard({
  member,
  onOpen,
}: {
  member: Member;
  onOpen: (m: Member) => void;
}) {
  const { user } = useAuth();

  const finalAvatar = useMemo(() => {
    if (member.avatar_url) return member.avatar_url;
    if (user?.email && member.email && user.email === member.email) {
      return (
        user.user_metadata?.avatar_url ||
        user.user_metadata?.picture ||
        member.profile_avatar_url
      );
    }
    return member.profile_avatar_url;
  }, [
    user?.email,
    user?.user_metadata,
    member.email,
    member.avatar_url,
    member.profile_avatar_url,
  ]);

  const roleLabel = getRoleLabel(member);
  const variant   = getBadgeVariant(roleLabel, member.is_admin);
  const accent    = ACCENT[variant];

  const introText = member.bio || member.affiliation || '';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(member)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(member); }}
      style={{
        position: 'relative',
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        border: '1px solid rgba(0,0,0,0.06)',
        borderTop: `2px solid ${accent}`,
        boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
        padding: '13px 12px 12px',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        overflow: 'hidden',
        minHeight: 152,
      }}
    >
      {/* Row: name+badge / avatar */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: '#0F172A',
              letterSpacing: '-0.01em',
              margin: '0 0 5px',
              lineHeight: 1.25,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {member.nickname}
            {member.is_guest && (
              <span style={{ fontSize: 10, fontWeight: 500, color: '#94A3B8', marginLeft: 3 }}>
                &nbsp;(G)
              </span>
            )}
          </p>
          <span
            style={{
              ...BADGE_STYLES[variant],
              fontSize: 8,
              fontWeight: 800,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              padding: '2px 6px',
              borderRadius: 4,
              display: 'inline-block',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {roleLabel}
          </span>
        </div>

        {/* Avatar */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            flexShrink: 0,
            padding: 2,
            background: `linear-gradient(135deg, ${accent}38, ${accent}18)`,
            boxShadow: `0 0 0 1px ${accent}30`,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              overflow: 'hidden',
              backgroundColor: `${accent}14`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ProfileAvatar
              src={finalAvatar}
              alt={member.nickname}
              size={40}
              fallbackIcon={
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 900,
                    color: accent,
                    lineHeight: 1,
                  }}
                >
                  {(member.nickname || '?').charAt(0)}
                </span>
              }
            />
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.05)', marginBottom: 8 }} />

      {/* Intro (2-line clamp) */}
      <p
        style={{
          fontSize: 10.5,
          fontWeight: 500,
          color: '#64748B',
          margin: '0 0 8px',
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          flexGrow: 1,
          minHeight: 0,
        } as React.CSSProperties}
      >
        {introText || ' '}
      </p>

      {/* Footer: achievement + chevron */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {member.achievements && (
            <span
              style={{
                fontSize: 8.5,
                fontWeight: 700,
                color: '#B8891C',
                backgroundColor: 'rgba(201,168,76,0.10)',
                border: '1px solid rgba(201,168,76,0.20)',
                padding: '2px 6px',
                borderRadius: 4,
                display: 'inline-block',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              🏆 {member.achievements}
            </span>
          )}
        </div>
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            border: '1px solid rgba(0,0,0,0.06)',
            backgroundColor: 'rgba(0,0,0,0.028)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginLeft: 4,
          }}
        >
          <ChevronRight size={10} strokeWidth={2} style={{ color: '#CBD5E1' }} />
        </div>
      </div>

      {/* Subtle circular watermark */}
      <div
        style={{
          position: 'absolute',
          right: -10,
          bottom: -10,
          width: 50,
          height: 50,
          borderRadius: '50%',
          border: `1.5px solid ${accent}12`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
});

// ─── MembersPage ──────────────────────────────────────────────────────────────

export default function MembersPage() {
  const { user } = useAuth();
  const [members, setMembers]             = useState<Member[]>([]);
  const [loading, setLoading]             = useState(true);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  useEffect(() => { fetchMembers(); }, []);

  async function fetchMembers() {
    try {
      setLoading(true);
      const clubId = process.env.NEXT_PUBLIC_CLUB_ID || '512d047d-a076-4080-97e5-6bb5a2c07819';
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .eq('club_id', clubId)
        .order('nickname', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        const memberEmails = Array.from(new Set(
          data
            .map((m: Member) => m.email)
            .filter((e): e is string => Boolean(e))
        ));
        let profileAvatarByEmail = new Map<string, string>();

        if (memberEmails.length > 0) {
          const { data: profilesData, error: profilesError } = await supabase
            .from('profiles')
            .select('email, avatar_url')
            .in('email', memberEmails);
          if (profilesError) {
            console.warn('[Members] Profile avatar fallback skipped:', profilesError);
          } else {
            profileAvatarByEmail = new Map(
              (profilesData || [])
                .filter((p: any) => p.email && p.avatar_url)
                .map((p: any) => [p.email, p.avatar_url])
            );
          }
        }

        const enriched = data.map((m: Member) => ({
          ...m,
          profile_avatar_url: m.email ? profileAvatarByEmail.get(m.email) : undefined,
        }));

        const sorted = [...enriched].sort((a, b) => {
          const diff = getMemberPriority(a) - getMemberPriority(b);
          if (diff !== 0) return diff;
          return (a.nickname || '').localeCompare(b.nickname || '', 'ko');
        });
        setMembers(sorted);
      } else {
        setMembers([]);
      }
    } catch (err: any) {
      console.error('[Members] Fetch Error:', err);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }

  const handleOpen  = useCallback((m: Member) => setSelectedMember(m), []);
  const handleClose = useCallback(() => setSelectedMember(null), []);

  const selectedAvatar = useMemo(() => {
    if (!selectedMember) return undefined;
    if (selectedMember.avatar_url) return selectedMember.avatar_url;
    if (user?.email && selectedMember.email && user.email === selectedMember.email) {
      return (
        user.user_metadata?.avatar_url ||
        user.user_metadata?.picture ||
        selectedMember.profile_avatar_url
      );
    }
    return selectedMember.profile_avatar_url;
  }, [selectedMember, user]);

  const isOwnCard = useMemo(
    () => Boolean(selectedMember && user?.email && user.email === selectedMember.email),
    [selectedMember, user?.email]
  );

  return (
    <>
      {/* Grid animation */}
      <style>{`
        @keyframes member-grid-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        .member-grid { animation: member-grid-in 0.35s ease-out; }
        @media (prefers-reduced-motion: reduce) { .member-grid { animation: none; } }
      `}</style>

      <main
        style={{
          width: '100%',
          minHeight: '100dvh',
          backgroundColor: '#F2F4F7',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingBottom: 'calc(88px + env(safe-area-inset-bottom))',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 430,
            padding: '0 16px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* ── Page header ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              paddingTop: 16,
              marginBottom: 16,
            }}
          >
            <Link
              href="/"
              aria-label="메인으로"
              style={{
                width: 34, height: 34,
                borderRadius: '50%',
                border: '1px solid rgba(0,0,0,0.09)',
                backgroundColor: '#FFFFFF',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#475569',
                textDecoration: 'none',
                flexShrink: 0,
              }}
            >
              <ChevronLeft size={17} strokeWidth={2.2} />
            </Link>
            <div>
              <p
                style={{
                  fontFamily: 'var(--font-rajdhani), sans-serif',
                  fontSize: 8,
                  fontWeight: 800,
                  letterSpacing: '0.28em',
                  textTransform: 'uppercase',
                  color: '#0D9488',
                  margin: 0,
                  lineHeight: 1.3,
                }}
              >
                TEYEON TENNIS CLUB
              </p>
              <p
                style={{
                  fontFamily: 'var(--font-rajdhani), sans-serif',
                  fontSize: 16,
                  fontWeight: 900,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: '#0F172A',
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                MEMBERS
              </p>
            </div>
          </div>

          {/* ── Info strip ── */}
          <div
            style={{
              marginBottom: 14,
              borderRadius: 12,
              backgroundColor: '#FFFFFF',
              border: '1px solid rgba(0,0,0,0.06)',
              borderLeft: '3px solid #0D9488',
              padding: '11px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <p style={{ fontSize: 12, fontWeight: 600, color: '#475569', margin: 0 }}>
              Club Member Directory 2026
            </p>
            {!loading && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: '0.14em',
                  color: '#0D9488',
                  backgroundColor: 'rgba(13,148,136,0.08)',
                  border: '1px solid rgba(13,148,136,0.18)',
                  borderRadius: 5,
                  padding: '2px 7px',
                  whiteSpace: 'nowrap',
                }}
              >
                {members.length}명
              </span>
            )}
          </div>

          {/* ── Loading ── */}
          {loading && <PremiumSpinner message="Loading members..." />}

          {/* ── Grid ── */}
          {!loading && members.length > 0 && (
            <div
              className="member-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 10,
              }}
            >
              {members.map((m) => (
                <MemberCard key={m.id} member={m} onOpen={handleOpen} />
              ))}
            </div>
          )}

          {/* ── Empty state ── */}
          {!loading && members.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', opacity: 0.4 }}>
              <Users size={44} strokeWidth={1.3} color="#0D9488" style={{ marginBottom: 12 }} />
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.24em',
                  color: '#64748B',
                  margin: 0,
                }}
              >
                No Members Found
              </p>
            </div>
          )}
        </div>
      </main>

      {/* ── Player Card Modal ── */}
      {selectedMember && (
        <PlayerCardModal
          member={selectedMember}
          finalAvatar={selectedAvatar}
          isOwnCard={isOwnCard}
          onClose={handleClose}
        />
      )}
    </>
  );
}
