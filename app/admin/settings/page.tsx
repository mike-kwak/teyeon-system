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
import { Users, UserCog, ShieldCheck, ListOrdered, ArrowUp, ArrowDown, Loader2, Link2, Link2Off } from 'lucide-react';

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

  useEffect(() => {
    if (canView) {
      if (activeTab === 'members') fetchMembersData();
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
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {members.map((m, i) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 0', borderTop: i === 0 ? 'none' : '1px solid #EEF2F6' }}>
                <ProfileAvatar src={m.avatar_url} alt={m.nickname} size={38} className="rounded-full" fallbackIcon="👤" />
                <div style={{ flex: 1, minWidth: 140 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0F1B33', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.nickname || '이름 없음'}</p>
                  <div style={{ marginTop: 3, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    <Badge tone="slate">{m.role || '미지정'}</Badge>
                    {m.auth_user_id
                      ? <Badge tone="teal"><Link2 size={10} /> 연결됨</Badge>
                      : <Badge tone="muted"><Link2Off size={10} /> 미연결</Badge>}
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
