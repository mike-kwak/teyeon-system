'use client';

// 방문 통계(방문 히스토리) — Admin 디자인 시스템(Cool Premium Light)으로 통합.
//   데이터/게이트 로직은 기존 그대로 유지(app_logs 조회, hasPermission('stats'), CEO 한정 fetch).
//   다크 테마/자체 헤더/뒤로가기는 제거(Admin shell 이 chrome 제공). 향후 /admin/analytics 확장 대비 골격만.

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { BarChart3, Users, History, MousePointerClick, Rocket } from 'lucide-react';

interface LogEntry {
  id: string;
  user_email: string;
  path: string;
  action: string;
  metadata: any;
  created_at: string;
}

export default function AdminStatsPage() {
  const { role, hasPermission, isLoading } = useAuth();
  const router = useRouter();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState({ total: 0, uniqueUsers: 0 });
  const [isFetching, setIsFetching] = useState(true);

  useEffect(() => {
    if (!isLoading && !hasPermission('stats')) {
      router.replace('/');
    }
  }, [isLoading, role, router, hasPermission]);

  useEffect(() => {
    const fetchLogs = async () => {
      setIsFetching(true);
      const { data, error } = await supabase
        .from('app_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        setLogs(data);
        setStats({
          total: data.length, // Simplified for now
          uniqueUsers: new Set(data.map((l) => l.user_email)).size,
        });
      }
      setIsFetching(false);
    };

    if (role === 'CEO') {
      fetchLogs();
    } else {
      setIsFetching(false);
    }
  }, [role]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ marginBottom: 20 }}>
        <p style={{ margin: 0, fontFamily: 'var(--font-rajdhani), sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.26em', color: '#2563EB' }}>
          TEYEON ADMIN
        </p>
        <h1 style={{ margin: '3px 0 0', fontSize: 24, fontWeight: 900, color: '#0F1B33', letterSpacing: '-0.02em' }}>방문 통계</h1>
        <p style={{ margin: '5px 0 0', fontSize: 12.5, fontWeight: 600, color: '#64748B' }}>
          최근 활동 기록을 확인합니다. (상세 분석은 추후 방문 분석으로 확장 예정)
        </p>
      </header>

      {/* 요약 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <SummaryCard icon={<BarChart3 size={18} />} tone="blue" label="총 활동 수" value={isFetching ? '…' : `${stats.total}`} sub="최근 50건 기준" />
        <SummaryCard icon={<Users size={18} />} tone="teal" label="활동 사용자" value={isFetching ? '…' : `${stats.uniqueUsers}명`} sub="최근 기록 기준" />
      </div>

      {/* 활동 피드 */}
      <section style={CARD}>
        <h3 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 900, color: '#0F1B33' }}>
          <History size={16} style={{ color: '#2563EB' }} /> 최근 방문 기록
        </h3>
        {isFetching ? (
          <Empty>불러오는 중...</Empty>
        ) : role !== 'CEO' ? (
          <Empty>방문 통계는 회장(CEO) 계정만 열람할 수 있습니다.</Empty>
        ) : logs.length === 0 ? (
          <Empty>기록된 활동이 없습니다.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {logs.map((log, i) => (
              <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid #EEF2F6' }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, backgroundColor: '#F6F8FC', border: '1px solid #E3E9F2', color: '#2563EB', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {log.action === 'menu_click' ? <MousePointerClick size={15} /> : <Rocket size={15} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#0F1B33', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {log.metadata?.label || log.path || '/'}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {(log.user_email ? log.user_email.split('@')[0] : '게스트')} · {log.path || '/'}
                  </p>
                </div>
                <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 600, color: '#94A3B8', whiteSpace: 'nowrap' }}>
                  {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const CARD: React.CSSProperties = { backgroundColor: '#FFFFFF', borderRadius: 14, border: '1px solid #E3E9F2', boxShadow: '0 1px 3px rgba(15,27,51,0.05)', padding: 16 };
function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '20px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: '#94A3B8' }}>{children}</p>;
}
const TONE: Record<string, { bg: string; color: string }> = {
  blue: { bg: 'rgba(37,99,235,0.08)', color: '#2563EB' },
  teal: { bg: 'rgba(15,124,118,0.08)', color: '#0E7C76' },
};
function SummaryCard({ icon, tone, label, value, sub }: { icon: React.ReactNode; tone: keyof typeof TONE; label: string; value: string; sub: string }) {
  const t = TONE[tone];
  return (
    <div style={{ ...CARD, padding: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: t.bg, color: t.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: '#64748B' }}>{label}</span>
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 22, fontWeight: 900, color: '#0F1B33', whiteSpace: 'nowrap' }}>{value}</p>
      <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>{sub}</p>
    </div>
  );
}
