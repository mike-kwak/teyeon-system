'use client';

// 관리자 설정 — Cool Premium Light(Admin 디자인 시스템) 통합본.
//   ⚠️ UI/레이아웃만 정리. 데이터/저장/권한 로직은 기존과 동일하게 보존:
//      - 멤버 클럽 직책 변경(members.role), 앱 계정 Role 변경(profiles.role),
//        기능 권한(app_config.permissions), 메뉴 순서(app_config.menu_order).
//   방문 통계 탭은 별도 /admin/stats 로 분리되어 여기서는 제거(기능 보존, 중복만 제거).
//   다크 헤더/뒤로가기/검정 Select/형광 텍스트/바로가기 카드 제거(Admin shell 이 chrome 제공).

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useGuideRecording } from '@/hooks/useGuideRecording';
import { canViewAdminSettings, canEditAdminSettings } from '@/lib/admin/adminAccess';
import { maskEmail } from '@/lib/guide/masking';
import { supabase } from '@/lib/supabase';
import { logAction } from '@/lib/logging';
import ProfileAvatar from '@/components/ProfileAvatar';
import { Users, UserCog, ShieldCheck, ListOrdered, ArrowUp, ArrowDown, Loader2, Link2, Link2Off, UserPlus, X, AlertTriangle, Pencil, Trophy, Plus } from 'lucide-react';
import {
  fetchUnlinkedAccounts,
  findMemberCandidates,
  linkAccountToMember,
  createMember,
  unlinkAccountFromMember,
  type UnlinkedAccount,
  type MemberLite,
} from '@/lib/admin/memberRegistrationService';
import {
  fetchMemberProfile,
  updateMemberProfile,
  listAchievementsAdmin,
  createAchievement,
  updateAchievement,
  deleteAchievement,
  ACHIEVEMENT_RESULT_OPTIONS,
  type MemberProfileForm,
  type MemberAchievement,
  type AchievementInput,
} from '@/lib/admin/memberProfileService';

interface AdminMember {
  id: string;
  nickname: string;
  role: string;
  avatar_url: string | null;
  auth_user_id?: string | null;
}

interface AdminProfile {
  id: string;
  email: string | null;
  nickname: string | null;
  role: 'GUEST' | 'MEMBER' | 'ADMIN' | 'CEO';
  avatar_url: string | null;
  updated_at?: string | null;
}

const ROLE_OPTIONS = [
  { group: '운영진 (Staff)', roles: ['회장', '부회장', '총무', '재무', '경기', '섭외'] },
  { group: '회원 (Member)', roles: ['정회원', '준회원', '게스트'] },
];
const APP_ROLE_OPTIONS: AdminProfile['role'][] = ['GUEST', 'MEMBER', 'ADMIN', 'CEO'];

const getErrorMessage = (err: any) => err?.message || err?.details || err?.hint || JSON.stringify(err) || String(err);

type ProfilesQueryResult = { data: any[] | null; error: any };
const withTimeout = async <T,>(promise: PromiseLike<T>, ms = 10000): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timeoutId = setTimeout(() => reject(new Error('Profiles request timed out.')), ms); });
  try { return await Promise.race([Promise.resolve(promise), timeout]); }
  finally { if (timeoutId) clearTimeout(timeoutId); }
};

const FEATURE_REGISTRY: Record<string, { label: string; desc: string }> = {
  notice: { label: '클럽 공지사항', desc: '공지 작성·열람' },
  profile: { label: '멤버 프로필', desc: '프로필 조회·기록' },
  tournament: { label: '스페셜 매치', desc: '특별 경기 운영' },
  kdk: { label: 'KDK 대진 운영', desc: '대진·정산 운영' },
  live_court: { label: '라이브 코트', desc: '실시간 점수' },
  archive: { label: '경기 아카이브', desc: '공식/비공식 기록' },
  finance: { label: '클럽 재무 장부', desc: '회비·정산' },
  stats: { label: '방문 통계', desc: '활동 기록 열람' },
  admin: { label: '관리자 설정', desc: 'Admin Console' },
};
const ALL_FEATURES = ['notice', 'profile', 'tournament', 'kdk', 'live_court', 'archive', 'finance', 'stats', 'admin'] as const;

type TabKey = 'members' | 'accounts' | 'permissions' | 'menu';
const TABS: { key: TabKey; label: string; icon: typeof Users }[] = [
  { key: 'members', label: '멤버 관리', icon: Users },
  { key: 'accounts', label: '앱 계정', icon: UserCog },
  { key: 'permissions', label: '기능 권한', icon: ShieldCheck },
  { key: 'menu', label: '메뉴 순서', icon: ListOrdered },
];

export default function AdminSettingsPage() {
  const { user, role, appConfig, isLoading, refreshConfig } = useAuth();
  const { guardWriteAction } = useGuideRecording();
  const router = useRouter();
  // 접근: CEO/ADMIN/OPERATOR/FINANCE_MANAGER 조회 / 변경은 CEO·ADMIN 만(실제 profiles.role 기준).
  //   ⚠ 촬영 보호(guardWriteAction)와 별개 — 이건 실제 역할 권한 기반 읽기 전용 차단.
  const canView = canViewAdminSettings(role);
  const canEdit = canEditAdminSettings(role);

  const [members, setMembers] = useState<AdminMember[]>([]);
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('members');
  const [isSyncing, setIsSyncing] = useState(false);
  const [fetchingMembers, setFetchingMembers] = useState(false);
  const [fetchingProfiles, setFetchingProfiles] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingProfileId, setUpdatingProfileId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // 신규 회원 등록/계정 연결 (CEO·ADMIN 전용)
  const [unlinkedAccounts, setUnlinkedAccounts] = useState<UnlinkedAccount[]>([]);
  const [registerTarget, setRegisterTarget] = useState<'new' | AdminMember | null>(null); // 'new'=신규 추가, AdminMember=기존 회원 연결 모드
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [profileTarget, setProfileTarget] = useState<AdminMember | null>(null); // 프로필 편집·입상 기록 관리 모달

  // Gating — 조회 권한 없는 사용자 차단(서버 middleware 1차, 여기 2차).
  useEffect(() => {
    if (!isLoading && !canView) router.replace('/');
  }, [canView, isLoading, router]);

  // 읽기 전용 사용자가 변경을 시도하면 단일 안내 후 중단(촬영 가드와 별개, 실제 역할 기준).
  const showReadonlyNotice = () => showToast('CEO·ADMIN만 변경할 수 있습니다. (운영진 조회 모드)');

  const fetchMembersData = async (force = false) => {
    if (!force && members.length > 0) return;
    setFetchingMembers(true);
    setFetchError(null);
    try {
      const { data, error } = await supabase
        .from('members')
        .select('id, nickname, role, avatar_url, auth_user_id')
        .order('nickname', { ascending: true });
      if (error) throw error;
      setMembers((data || []) as AdminMember[]);
    } catch (err: any) {
      console.warn('[Admin] Fetch Members Error:', err);
      setFetchError(getErrorMessage(err));
    } finally {
      setFetchingMembers(false);
    }
  };

  const fetchProfilesData = async (force = false) => {
    if (!force && profiles.length > 0) return;
    if (fetchingProfiles) return;
    setFetchingProfiles(true);
    setFetchError(null);
    try {
      const runQuery = (orderBy: 'updated_at' | 'email') => supabase
        .from('profiles')
        .select('id, email, nickname, role, avatar_url, updated_at')
        .order(orderBy, { ascending: orderBy === 'email' });
      let { data, error } = await withTimeout<ProfilesQueryResult>(runQuery('updated_at'));
      if (error && getErrorMessage(error).includes('updated_at')) {
        const fallback = await withTimeout<ProfilesQueryResult>(runQuery('email'));
        data = fallback.data; error = fallback.error;
      }
      if (error) throw error;
      setProfiles((data || []).map((p: any) => ({ ...p, role: APP_ROLE_OPTIONS.includes(p.role) ? p.role : 'GUEST' })));
    } catch (err: any) {
      console.warn('[Admin] Fetch Profiles Error:', err);
      setFetchError(getErrorMessage(err));
    } finally {
      setFetchingProfiles(false);
    }
  };

  // 미연결 앱 계정(profiles 중 members.auth_user_id 미연결) — 신규 등록/연결 후보.
  const refreshUnlinkedAccounts = async () => {
    try {
      setUnlinkedAccounts(await fetchUnlinkedAccounts());
    } catch (err) {
      console.warn('[Admin] Fetch unlinked accounts error:', err);
    }
  };

  useEffect(() => {
    if (canView) {
      if (activeTab === 'members') { fetchMembersData(); if (canEdit) refreshUnlinkedAccounts(); }
      if (activeTab === 'accounts') fetchProfilesData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, activeTab]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const updateConfig = async (newConfig: any) => {
    if (!canEdit) { showReadonlyNotice(); return; } // 운영진 읽기 전용(실제 역할 기준)
    if (!guardWriteAction('관리자 설정 저장')) return; // 촬영 모드 차단(별개 체계)
    setIsSyncing(true);
    try {
      const { error } = await supabase.from('app_config').update(newConfig).eq('id', 'primary');
      if (error) throw error;
      await refreshConfig();
      showToast('설정이 저장되었습니다.');
    } catch (err: any) {
      showToast('저장 실패: ' + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRoleChange = async (member: AdminMember, newRole: string) => {
    if (member.role === newRole) return;
    if (!canEdit) { showReadonlyNotice(); return; } // 운영진 읽기 전용
    if (!guardWriteAction('멤버 직책 변경')) return; // 촬영 모드 차단(별개 체계)
    setUpdatingId(member.id);
    try {
      await supabase.from('members').update({ role: newRole }).eq('id', member.id);
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role: newRole } : m)));
      logAction('/admin', 'role_changed', { target: member.nickname, newRole });
      showToast(`${member.nickname} → ${newRole}`);
    } catch (err: any) {
      showToast('변경 실패: ' + err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  // 오연결 복구 — 회원의 앱 계정 연결 해제(확인 후). RLS/unique index 가 최종 방어.
  const handleUnlink = async (member: AdminMember) => {
    if (!canEdit) { showReadonlyNotice(); return; }
    if (!guardWriteAction('회원 계정 연결 해제')) return;
    const ok = window.confirm(
      `'${member.nickname}' 회원의 앱 계정 연결을 해제할까요?\n\n해제하면 해당 계정은 미연결 상태가 되어 참석 체크·프로필 통계 연동이 끊깁니다.\n(다시 연결할 수 있습니다)`,
    );
    if (!ok) return;
    setUnlinkingId(member.id);
    try {
      await unlinkAccountFromMember(member.id);
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, auth_user_id: null } : m)));
      await refreshUnlinkedAccounts();
      logAction('/admin', 'member_account_unlinked', { target: member.nickname });
      showToast(`${member.nickname} 계정 연결 해제됨`);
    } catch (err: any) {
      showToast('해제 실패: ' + getErrorMessage(err));
    } finally {
      setUnlinkingId(null);
    }
  };

  // 등록/연결 완료 → 목록·후보 즉시 갱신.
  const handleRegistered = async (msg: string) => {
    setRegisterTarget(null);
    showToast(msg);
    await Promise.all([fetchMembersData(true), refreshUnlinkedAccounts()]);
  };

  const handleProfileRoleChange = async (profile: AdminProfile, newRole: AdminProfile['role']) => {
    if (profile.role === newRole) return;
    if (!canEdit) { showReadonlyNotice(); return; } // 운영진 읽기 전용
    if (!guardWriteAction('계정 권한 변경')) return; // 촬영 모드 차단(별개 체계)
    if (profile.id === user?.id && role === 'CEO' && newRole !== 'CEO') {
      showToast('본인 CEO 권한은 여기서 낮출 수 없습니다.');
      return;
    }
    setUpdatingProfileId(profile.id);
    try {
      const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', profile.id);
      if (error) throw error;
      setProfiles((prev) => prev.map((p) => (p.id === profile.id ? { ...p, role: newRole } : p)));
      logAction('/admin', 'profile_role_changed', { target: profile.email || profile.nickname || profile.id, newRole });
      showToast(`${profile.email || profile.nickname || '계정'} → ${newRole}`);
    } catch (err: any) {
      showToast('권한 변경 실패: ' + err.message);
    } finally {
      setUpdatingProfileId(null);
    }
  };

  if (isLoading || !canView) {
    return (
      <div style={{ minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={30} className="animate-spin" style={{ color: '#2563EB' }} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ marginBottom: 16 }}>
        <p style={{ margin: 0, fontFamily: 'var(--font-rajdhani), sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.26em', color: '#2563EB' }}>TEYEON ADMIN</p>
        <h1 style={{ margin: '3px 0 0', fontSize: 24, fontWeight: 900, color: '#0F1B33', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 9 }}>
          관리자 설정
          {!canEdit && <span style={{ fontSize: 10, fontWeight: 800, color: '#0E7C76', backgroundColor: 'rgba(15,124,118,0.10)', border: '1px solid rgba(15,124,118,0.25)', padding: '3px 9px', borderRadius: 999, letterSpacing: '0.02em' }}>읽기 전용</span>}
        </h1>
        <p style={{ margin: '5px 0 0', fontSize: 12.5, fontWeight: 600, color: '#64748B' }}>회원, 권한, 메뉴와 앱 운영 설정을 관리합니다.</p>
      </header>

      {!canEdit && (
        <div style={{ ...CARD, marginBottom: 16, borderLeft: '3px solid #0E7C76', backgroundColor: '#F6FBFA' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0F1B33' }}>운영진 조회 모드</p>
          <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 600, color: '#475569', lineHeight: 1.6 }}>
            현재 관리자 설정과 권한 구성을 확인할 수 있습니다. 직책, 계정 권한, 기능 권한 및 메뉴 순서 변경은 CEO·ADMIN만 가능합니다.
          </p>
        </div>
      )}

      {/* 탭 — 얇은 underline */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #E3E9F2', marginBottom: 16, overflowX: 'auto' }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button key={t.key} type="button" onClick={() => setActiveTab(t.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                padding: '10px 12px', border: 'none', background: 'none', cursor: 'pointer',
                borderBottom: `2px solid ${active ? '#2563EB' : 'transparent'}`,
                color: active ? '#0F1B33' : '#64748B', fontSize: 13, fontWeight: active ? 900 : 700, marginBottom: -1,
              }}>
              <Icon size={15} style={{ color: active ? '#2563EB' : '#94A3B8' }} /> {t.label}
            </button>
          );
        })}
      </div>

      {fetchError && (
        <div style={{ ...CARD, borderColor: '#F3B4B4', backgroundColor: '#FEF2F2', marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#B91C1C' }}>불러오기 오류: {fetchError}</p>
          <button type="button" onClick={() => (activeTab === 'accounts' ? fetchProfilesData(true) : fetchMembersData(true))} style={{ marginTop: 6, background: 'none', border: 'none', color: '#B91C1C', fontSize: 11.5, fontWeight: 800, textDecoration: 'underline', cursor: 'pointer' }}>재시도</button>
        </div>
      )}

      {/* 멤버 관리 */}
      {activeTab === 'members' && (
        <section style={CARD}>
          <SectionHead title="멤버 관리" desc="클럽 내 직책/회원 구분입니다. (앱 접근 권한은 ‘앱 계정’ 탭)" count={members.length} loading={fetchingMembers} />
          {!canEdit && <ReadonlyNote>현재 멤버 직책을 확인할 수 있습니다. 직책 변경은 CEO·ADMIN만 가능합니다.</ReadonlyNote>}
          {canEdit && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: unlinkedAccounts.length > 0 ? '#B45309' : '#94A3B8' }}>
                {unlinkedAccounts.length > 0
                  ? `회원 미연결 앱 계정 ${unlinkedAccounts.length}개 — 신규 회원 추가 또는 기존 회원 연결이 필요합니다.`
                  : '모든 앱 계정이 회원과 연결되어 있습니다.'}
              </p>
              <button
                type="button"
                onClick={() => setRegisterTarget('new')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', borderRadius: 8, border: 'none', backgroundColor: '#2563EB', color: '#FFFFFF', fontSize: 12, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}
              >
                <UserPlus size={14} /> 신규 회원 추가
              </button>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {members.map((m, i) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 0', borderTop: i === 0 ? 'none' : '1px solid #EEF2F6' }}>
                <ProfileAvatar src={m.avatar_url} alt={m.nickname} size={38} className="rounded-full" fallbackIcon="👤" />
                <div style={{ flex: 1, minWidth: 140 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0F1B33', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.nickname || '이름 없음'}</p>
                  <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    <Badge tone="slate">{m.role || '미지정'}</Badge>
                    {m.auth_user_id
                      ? <Badge tone="teal"><Link2 size={10} /> 연결됨</Badge>
                      : <Badge tone="muted"><Link2Off size={10} /> 미연결</Badge>}
                    {canEdit && (
                      <button type="button" onClick={() => setProfileTarget(m)}
                        style={{ background: 'none', border: 'none', padding: '2px 4px', fontSize: 10, fontWeight: 800, color: '#475569', cursor: 'pointer', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Pencil size={9} /> 프로필
                      </button>
                    )}
                    {canEdit && (m.auth_user_id ? (
                      <button type="button" onClick={() => handleUnlink(m)} disabled={unlinkingId === m.id}
                        style={{ background: 'none', border: 'none', padding: '2px 4px', fontSize: 10, fontWeight: 800, color: '#B91C1C', cursor: unlinkingId === m.id ? 'wait' : 'pointer', textDecoration: 'underline' }}>
                        해제
                      </button>
                    ) : (
                      <button type="button" onClick={() => setRegisterTarget(m)}
                        style={{ background: 'none', border: 'none', padding: '2px 4px', fontSize: 10, fontWeight: 800, color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }}>
                        계정 연결
                      </button>
                    ))}
                  </div>
                </div>
                {canEdit ? (
                  <select value={m.role} onChange={(e) => handleRoleChange(m, e.target.value)} disabled={updatingId === m.id} className="admin-select" style={selectStyle(updatingId === m.id)}>
                    {ROLE_OPTIONS.map((g) => (
                      <optgroup key={g.group} label={g.group}>
                        {g.roles.map((r) => <option key={r} value={r}>{r}</option>)}
                      </optgroup>
                    ))}
                  </select>
                ) : (
                  <Badge tone="slate">{m.role || '미지정'}</Badge>
                )}
              </div>
            ))}
            {members.length === 0 && !fetchingMembers && <Empty>회원이 없습니다.</Empty>}
          </div>
        </section>
      )}

      {/* 앱 계정 */}
      {activeTab === 'accounts' && (
        <section style={CARD}>
          <SectionHead title="앱 계정 권한" desc="화면 접근·관리 기능 노출에 사용되는 앱 역할입니다." count={profiles.length} loading={fetchingProfiles} />
          {!canEdit && <ReadonlyNote>계정 연결 상태와 앱 Role을 확인할 수 있습니다. Role 변경은 CEO·ADMIN만 가능합니다.</ReadonlyNote>}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {profiles.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 0', borderTop: i === 0 ? 'none' : '1px solid #EEF2F6' }}>
                <ProfileAvatar src={p.avatar_url} alt={p.nickname || p.email || 'Account'} size={38} className="rounded-full" fallbackIcon="👤" />
                <div style={{ flex: 1, minWidth: 140 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0F1B33', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nickname || p.email || '알 수 없음'}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{canEdit ? (p.email || p.id) : (p.email ? maskEmail(p.email) : p.id)}</p>
                </div>
                {canEdit ? (
                  <select value={p.role} onChange={(e) => handleProfileRoleChange(p, e.target.value as AdminProfile['role'])} disabled={updatingProfileId === p.id || (p.id === user?.id && role === 'CEO')} className="admin-select" style={selectStyle(updatingProfileId === p.id || (p.id === user?.id && role === 'CEO'))}>
                    {APP_ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : (
                  <Badge tone="slate">{p.role}</Badge>
                )}
              </div>
            ))}
            {profiles.length === 0 && !fetchingProfiles && <Empty>앱 계정이 없습니다.</Empty>}
          </div>
        </section>
      )}

      {/* 기능 권한 */}
      {activeTab === 'permissions' && (
        <section style={CARD}>
          <SectionHead title="기능 권한" desc="역할별 기능 읽기/쓰기/제한을 설정합니다." />
          {!canEdit && <ReadonlyNote>현재 역할별 기능 권한을 확인할 수 있습니다. 권한 변경은 CEO·ADMIN만 가능합니다.</ReadonlyNote>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ALL_FEATURES.map((feat) => {
              const reg = FEATURE_REGISTRY[feat] || { label: feat, desc: '' };
              return (
                <div key={feat} style={{ padding: 12, borderRadius: 10, backgroundColor: '#FBFCFE', border: '1px solid #E3E9F2' }}>
                  <div style={{ marginBottom: 10 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0F1B33' }}>{reg.label}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>{reg.desc}</p>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                    {(['ADMIN', 'MEMBER', 'GUEST'] as const).map((roleKey) => {
                      const level = appConfig?.permissions?.[roleKey]?.[feat] || 'HIDE';
                      const txt = level === 'WRITE' ? '쓰기' : level === 'READ' ? '읽기' : '제한';
                      const c = level === 'WRITE' ? { bg: '#E7F6EF', fg: '#047857', bd: '#A7E3C9' } : level === 'READ' ? { bg: '#E6EEFE', fg: '#2563EB', bd: '#B9CEFB' } : { bg: '#F1F5F9', fg: '#94A3B8', bd: '#E2E8F0' };
                      return (
                        <div key={roleKey} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <span style={{ fontSize: 9.5, fontWeight: 800, color: '#94A3B8', textAlign: 'center', letterSpacing: '0.06em' }}>{roleKey}</span>
                          {canEdit ? (
                            <button type="button" disabled={isSyncing}
                              onClick={() => {
                                const levels = { ...(appConfig?.permissions || {}) } as any;
                                if (!levels[roleKey]) levels[roleKey] = {};
                                const next = level === 'WRITE' ? 'READ' : level === 'READ' ? 'HIDE' : 'WRITE';
                                levels[roleKey][feat] = next;
                                updateConfig({ permissions: levels });
                              }}
                              style={{ width: '100%', padding: '9px 4px', borderRadius: 8, cursor: isSyncing ? 'not-allowed' : 'pointer', fontSize: 11.5, fontWeight: 800, backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.bd}`, opacity: isSyncing ? 0.5 : 1 }}>
                              {txt}
                            </button>
                          ) : (
                            <span style={{ width: '100%', padding: '9px 4px', borderRadius: 8, textAlign: 'center', fontSize: 11.5, fontWeight: 800, backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.bd}` }}>{txt}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 메뉴 순서 */}
      {activeTab === 'menu' && (
        <section style={CARD}>
          <SectionHead title="메뉴 순서" desc="역할별 메인 메뉴 노출 순서를 조정합니다." />
          {!canEdit && <ReadonlyNote>현재 앱 메뉴 구성을 확인할 수 있습니다. 메뉴 순서 변경은 CEO·ADMIN만 가능합니다.</ReadonlyNote>}
          {(['ADMIN', 'MEMBER', 'GUEST'] as const).map((roleKey) => (
            <div key={roleKey} style={{ marginBottom: 18 }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 800, color: '#2563EB', letterSpacing: '0.06em' }}>{roleKey}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(appConfig?.menu_order?.[roleKey] || []).map((itemId, idx, arr) => {
                  const reg = FEATURE_REGISTRY[itemId.toLowerCase()] || FEATURE_REGISTRY[itemId] || { label: itemId, desc: '' };
                  return (
                    <div key={itemId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, backgroundColor: '#FBFCFE', border: '1px solid #E3E9F2' }}>
                      <span style={{ width: 18, textAlign: 'center', fontSize: 11, fontWeight: 800, color: '#CBD5E1' }}>{idx + 1}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: '#0F1B33', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{reg.label}</span>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button type="button" disabled={idx === 0 || isSyncing} onClick={() => { const order = [...arr]; [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]]; updateConfig({ menu_order: { ...appConfig?.menu_order, [roleKey]: order } }); }} style={orderBtn(idx === 0 || isSyncing)}><ArrowUp size={14} /></button>
                          <button type="button" disabled={idx === arr.length - 1 || isSyncing} onClick={() => { const order = [...arr]; [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]]; updateConfig({ menu_order: { ...appConfig?.menu_order, [roleKey]: order } }); }} style={orderBtn(idx === arr.length - 1 || isSyncing)}><ArrowDown size={14} /></button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {(appConfig?.menu_order?.[roleKey] || []).length === 0 && <Empty>설정된 메뉴 순서가 없습니다.</Empty>}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 신규 회원 추가 / 기존 회원 계정 연결 모달 (CEO·ADMIN) */}
      {canEdit && registerTarget && (
        <MemberRegisterModal
          mode={registerTarget === 'new' ? { kind: 'new' } : { kind: 'link', member: registerTarget }}
          unlinkedAccounts={unlinkedAccounts}
          guardWriteAction={guardWriteAction}
          onClose={() => setRegisterTarget(null)}
          onDone={handleRegistered}
        />
      )}

      {canEdit && profileTarget && (
        <MemberProfileModal
          member={profileTarget}
          guardWriteAction={guardWriteAction}
          onClose={() => setProfileTarget(null)}
          onDirty={() => { fetchMembersData(true); }}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 'calc(20px + env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)', zIndex: 80, backgroundColor: '#0F1B33', color: '#FFFFFF', padding: '11px 20px', borderRadius: 999, fontSize: 12, fontWeight: 800, boxShadow: '0 12px 30px rgba(15,27,51,0.25)', whiteSpace: 'nowrap', maxWidth: '90vw', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {toast}
        </div>
      )}

      <style>{`
        .admin-select:focus { outline: none; border-color: #2563EB; box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }
        @keyframes spin { to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 0.8s linear infinite; }
      `}</style>
    </div>
  );
}

const CARD: React.CSSProperties = { backgroundColor: '#FFFFFF', borderRadius: 14, border: '1px solid #E3E9F2', boxShadow: '0 1px 3px rgba(15,27,51,0.05)', padding: 16 };

// ── 신규 회원 추가 / 기존 회원 계정 연결 모달 ────────────────────────────────
//   흐름: 앱 계정 선택(미연결 후보) → 기존 회원 exact 후보 확인 → [기존 회원 연결] 또는 [신규 생성]
//   안전장치: 이름/이메일 exact 중복 경고, auth 중복 연결 차단(service+DB unique), 저장 전 최종 확인.
type RegisterMode = { kind: 'new' } | { kind: 'link'; member: AdminMember };

function MemberRegisterModal({ mode, unlinkedAccounts, guardWriteAction, onClose, onDone }: {
  mode: RegisterMode;
  unlinkedAccounts: UnlinkedAccount[];
  guardWriteAction: (label: string) => boolean;
  onClose: () => void;
  onDone: (msg: string) => void | Promise<void>;
}) {
  const linkMember = mode.kind === 'link' ? mode.member : null;
  const [accountId, setAccountId] = useState<string>(''); // 선택한 앱 계정(profiles.id) — ''=나중에 연결
  const [name, setName] = useState<string>(linkMember?.nickname || '');
  const [email, setEmail] = useState<string>('');
  const [memberRole, setMemberRole] = useState<string>('정회원');
  const [candidates, setCandidates] = useState<{ byName: MemberLite[]; byEmail: MemberLite[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const account = unlinkedAccounts.find((a) => a.id === accountId) || null;

  // 앱 계정 선택 시 이름/이메일 자동 보충(비어 있을 때만 — 관리자가 입력한 값 우선).
  const handleAccountSelect = (id: string) => {
    setAccountId(id);
    setCandidates(null);
    setErrorMsg(null);
    const acc = unlinkedAccounts.find((a) => a.id === id);
    if (acc) {
      if (!linkMember && !name.trim() && acc.nickname) setName(acc.nickname);
      if (acc.email) setEmail(acc.email);
    }
  };

  // 저장 전 기존 회원 exact 후보 확인(신규 모드) — 부분 일치 자동 매칭 없음, 제안만.
  const runCandidateCheck = async (): Promise<{ byName: MemberLite[]; byEmail: MemberLite[] }> => {
    setChecking(true);
    try {
      const found = await findMemberCandidates({ name, email, authUserId: accountId || null });
      if (found.byAuth.length > 0) {
        throw new Error(`선택한 앱 계정은 이미 '${found.byAuth[0].nickname}' 회원에 연결되어 있습니다.`);
      }
      const result = { byName: found.byName, byEmail: found.byEmail.filter((m) => !found.byName.some((n) => n.id === m.id)) };
      setCandidates(result);
      return result;
    } finally {
      setChecking(false);
    }
  };

  const finalConfirm = (action: string, targetName: string) =>
    window.confirm(
      `${action}\n\n회원 이름: ${targetName}\n이메일: ${email.trim() || '(없음)'}\n회원 구분: ${memberRole}\n앱 계정: ${account ? `${account.email || account.id}` : '(나중에 연결)'}\n\n진행할까요?`,
    );

  // 기존 회원에 연결(연결 모드 또는 후보 카드에서 선택).
  const doLink = async (target: { id: string; nickname: string }) => {
    setErrorMsg(null);
    if (!accountId) { setErrorMsg('연결할 앱 계정을 선택해 주세요.'); return; }
    if (!guardWriteAction('회원 계정 연결')) return;
    if (!finalConfirm(`기존 회원 '${target.nickname}'에 앱 계정을 연결합니다.`, target.nickname)) return;
    setSaving(true);
    try {
      await linkAccountToMember({ memberId: target.id, authUserId: accountId, email });
      logAction('/admin', 'member_account_linked', { target: target.nickname });
      await onDone(`${target.nickname} 계정 연결 완료`);
    } catch (err: any) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // 신규 회원 생성(+선택 시 즉시 연결). 동일 이름 후보가 있으면 먼저 경고 카드를 보여주고,
  // 관리자가 '그래도 신규 생성'을 눌렀을 때만 allowDuplicateName 으로 진행한다.
  const doCreate = async (allowDuplicateName: boolean) => {
    setErrorMsg(null);
    if (!name.trim()) { setErrorMsg('회원 이름을 입력해 주세요.'); return; }
    if (!guardWriteAction('신규 회원 등록')) return;
    try {
      if (!allowDuplicateName) {
        const found = await runCandidateCheck();
        if (found.byName.length > 0 || found.byEmail.length > 0) return; // 후보 카드 표시 → 관리자가 선택
      }
      if (!finalConfirm('신규 회원을 생성합니다.', name.trim())) return;
      setSaving(true);
      const created = await createMember({
        nickname: name,
        role: memberRole,
        email,
        authUserId: accountId || null,
        avatarUrl: account?.avatar_url || null,
        allowDuplicateName,
      });
      logAction('/admin', 'member_created', { target: created.nickname, linked: !!accountId });
      await onDone(`${created.nickname} 회원 생성${accountId ? ' + 계정 연결' : ''} 완료`);
    } catch (err: any) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 5 };
  const inputStyle: React.CSSProperties = { width: '100%', height: 38, padding: '0 11px', borderRadius: 8, border: '1px solid #D9E1EC', backgroundColor: '#FFFFFF', color: '#0F1B33', fontSize: 13, fontWeight: 700, outline: 'none', boxSizing: 'border-box' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, backgroundColor: 'rgba(15,27,51,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '85dvh', overflowY: 'auto', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, boxShadow: '0 20px 50px rgba(15,27,51,0.3)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: '#0F1B33' }}>
            {linkMember ? `'${linkMember.nickname}' 계정 연결` : '신규 회원 추가'}
          </h3>
          <button type="button" onClick={onClose} aria-label="닫기" style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #E3E9F2', backgroundColor: '#FFFFFF', color: '#64748B', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><X size={15} /></button>
        </div>

        {/* 앱 계정 선택 — 미연결 계정 후보(이메일·표시명·현재 앱 역할) */}
        <div style={{ marginBottom: 12 }}>
          <label style={fieldLabel}>연결할 앱 계정 {linkMember ? '(필수)' : '(선택 — 나중에 연결 가능)'}</label>
          <select value={accountId} onChange={(e) => handleAccountSelect(e.target.value)} className="admin-select" style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="">{linkMember ? '앱 계정을 선택하세요' : '나중에 연결'}</option>
            {unlinkedAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email || a.id}{a.nickname ? ` · ${a.nickname}` : ''} · {a.role}
              </option>
            ))}
          </select>
          {unlinkedAccounts.length === 0 && (
            <p style={{ margin: '5px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>미연결 앱 계정이 없습니다.</p>
          )}
          {account && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 10, backgroundColor: '#F6FAFF', border: '1px solid #D8E6FB' }}>
              <ProfileAvatar src={account.avatar_url} alt={account.nickname || account.email || ''} size={30} className="rounded-full" fallbackIcon="👤" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#0F1B33', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.nickname || '(표시명 없음)'} <span style={{ fontWeight: 600, color: '#64748B' }}>· 앱 역할 {account.role}</span></p>
                <p style={{ margin: '1px 0 0', fontSize: 10.5, fontWeight: 600, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.email || account.id}</p>
              </div>
            </div>
          )}
        </div>

        {!linkMember && (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={fieldLabel}>회원 이름 (필수)</label>
              <input value={name} onChange={(e) => { setName(e.target.value); setCandidates(null); }} placeholder="예: 박일원" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={fieldLabel}>이메일</label>
              <input value={email} onChange={(e) => { setEmail(e.target.value); setCandidates(null); }} placeholder="선택 입력" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={fieldLabel}>회원 구분 (필수)</label>
              <select value={memberRole} onChange={(e) => setMemberRole(e.target.value)} className="admin-select" style={{ ...inputStyle, cursor: 'pointer' }}>
                {ROLE_OPTIONS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.roles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          </>
        )}

        {/* 기존 회원 exact 후보 — 신규 생성 전 우선 연결 제안 */}
        {candidates && (candidates.byName.length > 0 || candidates.byEmail.length > 0) && (
          <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
            <p style={{ margin: '0 0 7px', fontSize: 11.5, fontWeight: 800, color: '#B45309', display: 'flex', alignItems: 'center', gap: 5 }}>
              <AlertTriangle size={13} /> 동일한 {candidates.byName.length > 0 ? '이름' : '이메일'}의 기존 회원이 있습니다 — 신규 생성 전에 확인하세요.
            </p>
            {[...candidates.byName, ...candidates.byEmail].map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                <ProfileAvatar src={c.avatar_url} alt={c.nickname} size={26} className="rounded-full" fallbackIcon="👤" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#0F1B33' }}>{c.nickname} <span style={{ fontWeight: 600, color: '#64748B' }}>· {c.role}</span></p>
                  <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: '#94A3B8' }}>{c.email || '(이메일 없음)'} · {c.auth_user_id ? '계정 연결됨' : '미연결'}</p>
                </div>
                {!c.auth_user_id && accountId && (
                  <button type="button" disabled={saving} onClick={() => doLink(c)}
                    style={{ height: 28, padding: '0 10px', borderRadius: 7, border: 'none', backgroundColor: '#0E7C76', color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                    이 회원에 연결
                  </button>
                )}
              </div>
            ))}
            <button type="button" disabled={saving} onClick={() => doCreate(true)}
              style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 800, color: '#B45309', textDecoration: 'underline', cursor: 'pointer' }}>
              중복을 확인했습니다 — 그래도 신규 생성
            </button>
          </div>
        )}

        {errorMsg && (
          <p style={{ margin: '0 0 12px', padding: '8px 11px', borderRadius: 8, backgroundColor: '#FEF2F2', border: '1px solid #F3B4B4', fontSize: 11.5, fontWeight: 700, color: '#B91C1C', lineHeight: 1.5 }}>{errorMsg}</p>
        )}

        <div style={{ display: 'flex', gap: 8, paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <button type="button" onClick={onClose} disabled={saving}
            style={{ flex: 1, height: 42, borderRadius: 10, border: '1px solid #E3E9F2', backgroundColor: '#FFFFFF', color: '#64748B', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
            취소
          </button>
          {linkMember ? (
            <button type="button" disabled={saving || !accountId} onClick={() => doLink(linkMember)}
              style={{ flex: 2, height: 42, borderRadius: 10, border: 'none', backgroundColor: !accountId ? '#B9CEFB' : '#2563EB', color: '#FFFFFF', fontSize: 13, fontWeight: 900, cursor: saving || !accountId ? 'not-allowed' : 'pointer' }}>
              {saving ? '연결 중…' : '계정 연결'}
            </button>
          ) : (
            <button type="button" disabled={saving || checking || !name.trim()} onClick={() => doCreate(false)}
              style={{ flex: 2, height: 42, borderRadius: 10, border: 'none', backgroundColor: !name.trim() ? '#B9CEFB' : '#2563EB', color: '#FFFFFF', fontSize: 13, fontWeight: 900, cursor: saving || !name.trim() ? 'not-allowed' : 'pointer' }}>
              {saving ? '저장 중…' : checking ? '중복 확인 중…' : '확인 후 저장'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 회원 프로필 편집 · 대회 입상 기록 관리 모달 ──────────────────────────────
//   프로필: members 기존 컬럼(affiliation/mbti/나이/achievements/avatar_url) + bio(신규 SQL).
//   입상 기록: member_achievements 테이블 CRUD — 테이블 미생성 시 안내만 표시.
//   계정 연결 정보(nickname/email/auth_user_id)는 여기서 편집하지 않는다(등록/연결 모달 담당).
const EMPTY_ACH_FORM = {
  tournamentName: '', tournamentDate: '', resultChoice: '우승', resultCustom: '',
  division: '', partnerName: '', isFeatured: false, isPublic: true, displayOrder: '',
};
type AchFormState = typeof EMPTY_ACH_FORM;

function MemberProfileModal({ member, guardWriteAction, onClose, onDirty }: {
  member: AdminMember;
  guardWriteAction: (label: string) => boolean;
  onClose: () => void;
  onDirty: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<MemberProfileForm>({ affiliation: '', mbti: '', birthYear: '', bio: '', achievementsSummary: '', avatarUrl: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const [achList, setAchList] = useState<MemberAchievement[]>([]);
  const [achTableMissing, setAchTableMissing] = useState(false);
  const [achEditing, setAchEditing] = useState<string | 'new' | null>(null); // 'new' 또는 기록 id
  const [achForm, setAchForm] = useState<AchFormState>(EMPTY_ACH_FORM);
  const [savingAch, setSavingAch] = useState(false);
  const [deletingAchId, setDeletingAchId] = useState<string | null>(null);

  const refreshAchievements = async () => {
    try {
      setAchList(await listAchievementsAdmin(member.id));
      setAchTableMissing(false);
    } catch (err: any) {
      if (String(err?.message || '').includes('테이블이 아직 없습니다')) setAchTableMissing(true);
      else setNotice({ tone: 'err', text: getErrorMessage(err) });
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await fetchMemberProfile(member.id);
        if (cancelled) return;
        setForm({
          affiliation: profile.affiliation, mbti: profile.mbti, birthYear: profile.birthYear,
          bio: profile.bio, achievementsSummary: profile.achievementsSummary, avatarUrl: profile.avatarUrl,
        });
        await refreshAchievements();
      } catch (err: any) {
        if (!cancelled) setLoadError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id]);

  const handleProfileSave = async () => {
    setNotice(null);
    if (!guardWriteAction('회원 프로필 저장')) return;
    setSavingProfile(true);
    try {
      const { bioSkipped } = await updateMemberProfile(member.id, form);
      logAction('/admin', 'member_profile_updated', { target: member.nickname });
      setNotice({
        tone: 'ok',
        text: bioSkipped
          ? '프로필 저장 완료 — 단, 한 줄 소개는 DB에 bio 컬럼이 아직 없어 저장되지 않았습니다(SQL 적용 필요).'
          : '프로필 저장 완료',
      });
      onDirty();
    } catch (err: any) {
      setNotice({ tone: 'err', text: '저장 실패: ' + getErrorMessage(err) });
    } finally {
      setSavingProfile(false);
    }
  };

  const openAchForm = (target: MemberAchievement | 'new') => {
    setNotice(null);
    if (target === 'new') {
      setAchForm(EMPTY_ACH_FORM);
      setAchEditing('new');
      return;
    }
    const isEnum = ACHIEVEMENT_RESULT_OPTIONS.includes(target.result);
    setAchForm({
      tournamentName: target.tournament_name,
      tournamentDate: target.tournament_date || '',
      resultChoice: isEnum ? target.result : '직접 입력',
      resultCustom: isEnum ? '' : target.result,
      division: target.division || '',
      partnerName: target.partner_name || '',
      isFeatured: target.is_featured,
      isPublic: target.is_public,
      displayOrder: target.display_order === null || target.display_order === undefined ? '' : String(target.display_order),
    });
    setAchEditing(target.id);
  };

  const handleAchSave = async () => {
    setNotice(null);
    if (!guardWriteAction('입상 기록 저장')) return;
    const input: AchievementInput = {
      tournamentName: achForm.tournamentName,
      tournamentDate: achForm.tournamentDate,
      result: achForm.resultChoice === '직접 입력' ? achForm.resultCustom : achForm.resultChoice,
      division: achForm.division,
      partnerName: achForm.partnerName,
      isFeatured: achForm.isFeatured,
      isPublic: achForm.isPublic,
      displayOrder: achForm.displayOrder,
    };
    setSavingAch(true);
    try {
      if (achEditing === 'new') {
        await createAchievement(member.id, input);
        logAction('/admin', 'member_achievement_created', { target: member.nickname, tournament: input.tournamentName });
      } else if (achEditing) {
        await updateAchievement(achEditing, input);
        logAction('/admin', 'member_achievement_updated', { target: member.nickname, tournament: input.tournamentName });
      }
      await refreshAchievements();
      setAchEditing(null);
      setNotice({ tone: 'ok', text: '입상 기록 저장 완료' });
      onDirty();
    } catch (err: any) {
      setNotice({ tone: 'err', text: '기록 저장 실패: ' + getErrorMessage(err) });
    } finally {
      setSavingAch(false);
    }
  };

  const handleAchDelete = async (a: MemberAchievement) => {
    setNotice(null);
    if (!guardWriteAction('입상 기록 삭제')) return;
    if (!window.confirm(`'${a.tournament_name} ${a.result}' 기록을 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
    setDeletingAchId(a.id);
    try {
      await deleteAchievement(a.id);
      logAction('/admin', 'member_achievement_deleted', { target: member.nickname, tournament: a.tournament_name });
      await refreshAchievements();
      setNotice({ tone: 'ok', text: '기록 삭제 완료' });
      onDirty();
    } catch (err: any) {
      setNotice({ tone: 'err', text: '삭제 실패: ' + getErrorMessage(err) });
    } finally {
      setDeletingAchId(null);
    }
  };

  const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 5 };
  const inputStyle: React.CSSProperties = { width: '100%', height: 38, padding: '0 11px', borderRadius: 8, border: '1px solid #D9E1EC', backgroundColor: '#FFFFFF', color: '#0F1B33', fontSize: 13, fontWeight: 700, outline: 'none', boxSizing: 'border-box' };
  const sectionTitle: React.CSSProperties = { margin: '0 0 10px', fontSize: 12, fontWeight: 900, color: '#0F1B33', display: 'flex', alignItems: 'center', gap: 6 };

  const setField = (key: keyof MemberProfileForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const setAchField = (key: keyof AchFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setAchForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, backgroundColor: 'rgba(15,27,51,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, maxHeight: '85dvh', overflowY: 'auto', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, boxShadow: '0 20px 50px rgba(15,27,51,0.3)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: '#0F1B33', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {`'${member.nickname}' 프로필 편집`}
          </h3>
          <button type="button" onClick={onClose} aria-label="닫기" style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #E3E9F2', backgroundColor: '#FFFFFF', color: '#64748B', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><X size={15} /></button>
        </div>

        {loading && <p style={{ margin: '20px 0', fontSize: 12, fontWeight: 700, color: '#94A3B8', textAlign: 'center' }}>불러오는 중…</p>}
        {loadError && <p style={{ margin: '20px 0', fontSize: 12, fontWeight: 700, color: '#B91C1C', textAlign: 'center' }}>{loadError}</p>}

        {!loading && !loadError && (
          <>
            {/* ── 기본 프로필 ── */}
            <p style={sectionTitle}><Pencil size={12} /> 기본 프로필</p>
            <p style={{ margin: '0 0 12px', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.5 }}>
              이름·이메일·계정 연결은 회원 등록/연결 기능에서, 회원 구분은 목록의 드롭다운에서 관리합니다.
            </p>
            <div style={{ marginBottom: 11 }}>
              <label style={fieldLabel}>소속 클럽 / 지역</label>
              <input value={form.affiliation} onChange={setField('affiliation')} placeholder="예: 우체국/아산" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 11 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={fieldLabel}>MBTI</label>
                <input value={form.mbti} onChange={setField('mbti')} placeholder="예: INTP" maxLength={4} style={inputStyle} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={fieldLabel}>출생년도</label>
                <input value={form.birthYear} onChange={setField('birthYear')} placeholder="예: 1988" inputMode="numeric" style={inputStyle} />
              </div>
            </div>
            <div style={{ marginBottom: 11 }}>
              <label style={fieldLabel}>한 줄 소개</label>
              <input value={form.bio} onChange={setField('bio')} placeholder="멤버 카드에 표시되는 소개 문구" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 11 }}>
              <label style={fieldLabel}>목록 카드 요약 문구 (🏆)</label>
              <input value={form.achievementsSummary} onChange={setField('achievementsSummary')} placeholder="예: 신인부 입상 | 25년 예산윤봉길배 공동3위" style={inputStyle} />
              <p style={{ margin: '4px 0 0', fontSize: 10, fontWeight: 600, color: '#94A3B8', lineHeight: 1.45 }}>
                아래에 입상 기록을 등록하면 목록 카드에는 대표 기록이 우선 표시되고, 이 문구는 대체용으로만 쓰입니다.
              </p>
            </div>
            <div style={{ marginBottom: 13 }}>
              <label style={fieldLabel}>프로필 사진 URL</label>
              <input value={form.avatarUrl} onChange={setField('avatarUrl')} placeholder="비우면 앱 계정(카카오) 사진 사용" style={inputStyle} />
            </div>
            <button type="button" onClick={handleProfileSave} disabled={savingProfile}
              style={{ width: '100%', height: 40, borderRadius: 10, border: 'none', backgroundColor: '#2563EB', color: '#FFFFFF', fontSize: 12.5, fontWeight: 900, cursor: savingProfile ? 'wait' : 'pointer', marginBottom: 16 }}>
              {savingProfile ? '저장 중…' : '프로필 저장'}
            </button>

            <div style={{ height: 1, backgroundColor: '#EEF2F6', margin: '0 0 14px' }} />

            {/* ── 대회 입상 기록 ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <p style={{ ...sectionTitle, margin: 0 }}>
                <Trophy size={12} /> 대회 입상 기록
                <span style={{ fontSize: 10.5, fontWeight: 800, color: '#2563EB' }}>{achList.length}</span>
              </p>
              {!achTableMissing && (
                <button type="button" onClick={() => openAchForm('new')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 30, padding: '0 11px', borderRadius: 8, border: 'none', backgroundColor: '#0E7C76', color: '#FFFFFF', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                  <Plus size={12} /> 기록 추가
                </button>
              )}
            </div>
            <p style={{ margin: '0 0 10px', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.5 }}>
              운영진이 확인한 공식 외부 대회 성과입니다. TENNIS LOG(개인 기록)와 연동되지 않습니다.
            </p>

            {achTableMissing && (
              <p style={{ margin: '0 0 12px', padding: '9px 11px', borderRadius: 8, backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', fontSize: 11, fontWeight: 700, color: '#B45309', lineHeight: 1.55 }}>
                입상 기록 테이블이 아직 생성되지 않았습니다. supabase/add_member_achievements.sql 적용 후 사용할 수 있습니다.
              </p>
            )}

            {!achTableMissing && achList.length === 0 && achEditing === null && (
              <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>등록된 입상 기록이 없습니다.</p>
            )}

            {achList.map((a) => (
              <div key={a.id} style={{ padding: '9px 11px', borderRadius: 10, border: '1px solid #E3E9F2', backgroundColor: '#FAFCFF', marginBottom: 7 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                  <p style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 12, fontWeight: 800, color: '#0F1B33', lineHeight: 1.45, whiteSpace: 'normal', wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
                    {a.tournament_name}
                    {a.is_featured && <span style={{ marginLeft: 4, fontSize: 10, color: '#B8891C' }}>★ 대표</span>}
                    {!a.is_public && <span style={{ marginLeft: 4, fontSize: 10, color: '#94A3B8' }}>(비공개)</span>}
                  </p>
                  <Badge tone="teal">{a.result}</Badge>
                </div>
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: '#64748B', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                    {[
                      a.tournament_date ? a.tournament_date.slice(0, 7).replace('-', '.') : null,
                      a.division,
                      a.partner_name ? `파트너 ${a.partner_name}` : null,
                    ].filter(Boolean).join(' · ') || '상세 정보 없음'}
                  </p>
                  <span style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
                    <button type="button" onClick={() => openAchForm(a)}
                      style={{ background: 'none', border: 'none', padding: '2px 5px', fontSize: 10.5, fontWeight: 800, color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }}>
                      수정
                    </button>
                    <button type="button" onClick={() => handleAchDelete(a)} disabled={deletingAchId === a.id}
                      style={{ background: 'none', border: 'none', padding: '2px 5px', fontSize: 10.5, fontWeight: 800, color: '#B91C1C', cursor: deletingAchId === a.id ? 'wait' : 'pointer', textDecoration: 'underline' }}>
                      삭제
                    </button>
                  </span>
                </div>
              </div>
            ))}

            {achEditing !== null && (
              <div style={{ padding: '12px 12px 13px', borderRadius: 10, border: '1px solid #C7D8F5', backgroundColor: '#F6FAFF', marginTop: 4, marginBottom: 4 }}>
                <p style={{ margin: '0 0 10px', fontSize: 11.5, fontWeight: 900, color: '#0F1B33' }}>
                  {achEditing === 'new' ? '입상 기록 추가' : '입상 기록 수정'}
                </p>
                <div style={{ marginBottom: 10 }}>
                  <label style={fieldLabel}>대회명 (필수)</label>
                  <input value={achForm.tournamentName} onChange={setAchField('tournamentName')} placeholder="예: 2026 아산시장배 동호인 테니스대회" style={inputStyle} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={fieldLabel}>대회 날짜</label>
                    <input type="date" value={achForm.tournamentDate} onChange={setAchField('tournamentDate')} style={inputStyle} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={fieldLabel}>최종 성적 (필수)</label>
                    <select value={achForm.resultChoice} onChange={setAchField('resultChoice')} className="admin-select" style={{ ...inputStyle, cursor: 'pointer' }}>
                      {ACHIEVEMENT_RESULT_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      <option value="직접 입력">직접 입력</option>
                    </select>
                  </div>
                </div>
                {achForm.resultChoice === '직접 입력' && (
                  <div style={{ marginBottom: 10 }}>
                    <label style={fieldLabel}>성적 직접 입력</label>
                    <input value={achForm.resultCustom} onChange={setAchField('resultCustom')} placeholder="예: 챌린저부 준우승" style={inputStyle} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={fieldLabel}>참가 부서</label>
                    <input value={achForm.division} onChange={setAchField('division')} placeholder="예: 신인부" style={inputStyle} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={fieldLabel}>파트너</label>
                    <input value={achForm.partnerName} onChange={setAchField('partnerName')} placeholder="복식 파트너" style={inputStyle} />
                  </div>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={fieldLabel}>표시 순서</label>
                  <input value={achForm.displayOrder} onChange={setAchField('displayOrder')} placeholder="비우면 자동(대표 → 날짜 최신순), 낮을수록 위" inputMode="numeric" style={inputStyle} />
                </div>
                <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                    <input type="checkbox" checked={achForm.isFeatured} onChange={(e) => setAchForm((p) => ({ ...p, isFeatured: e.target.checked }))} />
                    대표 기록 (목록 카드 우선 표시)
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                    <input type="checkbox" checked={achForm.isPublic} onChange={(e) => setAchForm((p) => ({ ...p, isPublic: e.target.checked }))} />
                    프로필 공개
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => setAchEditing(null)} disabled={savingAch}
                    style={{ flex: 1, height: 36, borderRadius: 9, border: '1px solid #E3E9F2', backgroundColor: '#FFFFFF', color: '#64748B', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                    취소
                  </button>
                  <button type="button" onClick={handleAchSave}
                    disabled={savingAch || !achForm.tournamentName.trim() || (achForm.resultChoice === '직접 입력' && !achForm.resultCustom.trim())}
                    style={{ flex: 2, height: 36, borderRadius: 9, border: 'none', backgroundColor: '#0E7C76', color: '#FFFFFF', fontSize: 12, fontWeight: 900, cursor: savingAch ? 'wait' : 'pointer' }}>
                    {savingAch ? '저장 중…' : achEditing === 'new' ? '기록 추가' : '기록 저장'}
                  </button>
                </div>
              </div>
            )}

            {notice && (
              <p style={{
                margin: '10px 0 0', padding: '8px 11px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, lineHeight: 1.5,
                backgroundColor: notice.tone === 'ok' ? '#F0FDF4' : '#FEF2F2',
                border: `1px solid ${notice.tone === 'ok' ? '#BBE7C8' : '#F3B4B4'}`,
                color: notice.tone === 'ok' ? '#15803D' : '#B91C1C',
              }}>{notice.text}</p>
            )}

            <div style={{ marginTop: 14, paddingBottom: 'env(safe-area-inset-bottom)' }}>
              <button type="button" onClick={onClose}
                style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid #E3E9F2', backgroundColor: '#FFFFFF', color: '#64748B', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                닫기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionHead({ title, desc, count, loading }: { title: string; desc: string; count?: number; loading?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
      <div style={{ minWidth: 0 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F1B33' }}>{title}</h3>
        <p style={{ margin: '3px 0 0', fontSize: 11, fontWeight: 600, color: '#94A3B8', lineHeight: 1.5, wordBreak: 'keep-all' }}>{desc}</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {loading && <Loader2 size={14} className="animate-spin" style={{ color: '#2563EB' }} />}
        {count !== undefined && <span style={{ fontSize: 11, fontWeight: 800, color: '#2563EB', backgroundColor: 'rgba(37,99,235,0.08)', padding: '3px 10px', borderRadius: 999 }}>{count}명</span>}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '20px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: '#94A3B8' }}>{children}</p>;
}
/** 운영진 읽기 전용 탭 상단 보조 안내. */
function ReadonlyNote({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, color: '#0E7C76', backgroundColor: 'rgba(15,124,118,0.07)', border: '1px solid rgba(15,124,118,0.18)', borderRadius: 8, padding: '7px 10px', lineHeight: 1.5 }}>{children}</p>;
}

const BADGE_TONE: Record<string, { bg: string; fg: string; bd: string }> = {
  slate: { bg: '#F1F5F9', fg: '#475569', bd: '#E2E8F0' },
  teal: { bg: '#E7F6EF', fg: '#047857', bd: '#A7E3C9' },
  muted: { bg: '#F8FAFC', fg: '#94A3B8', bd: '#EEF2F6' },
};
function Badge({ children, tone }: { children: React.ReactNode; tone: keyof typeof BADGE_TONE }) {
  const t = BADGE_TONE[tone];
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 6, backgroundColor: t.bg, color: t.fg, border: `1px solid ${t.bd}`, whiteSpace: 'nowrap' }}>{children}</span>;
}

function selectStyle(disabled: boolean): React.CSSProperties {
  return {
    height: 34, paddingLeft: 10, paddingRight: 10, borderRadius: 8,
    border: '1px solid #D9E1EC', backgroundColor: '#FFFFFF', color: '#0F1B33',
    fontSize: 12, fontWeight: 700, outline: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1, maxWidth: '100%',
  };
}
function orderBtn(disabled: boolean): React.CSSProperties {
  return {
    width: 32, height: 32, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid #E3E9F2', backgroundColor: '#FFFFFF', color: '#475569',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
  };
}
