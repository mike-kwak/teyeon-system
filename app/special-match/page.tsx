import Link from 'next/link';
import {
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  LayoutGrid,
  Sparkles,
  Trophy,
} from 'lucide-react';

const previewFeatures = [
  {
    title: '대회 모드',
    description: '토너먼트와 이벤트성 경기를 운영하는 특별 매치 모드입니다.',
    icon: Trophy,
  },
  {
    title: '월례회 모드',
    description: '클럽 정기 모임에서 쓰기 좋은 특별 경기 흐름을 준비합니다.',
    icon: CalendarDays,
  },
  {
    title: '직접 대진 구성',
    description: '운영자가 팀과 경기 순서를 직접 구성할 수 있습니다.',
    icon: LayoutGrid,
  },
  {
    title: '결과 기록/공유',
    description: '특별 경기 결과를 저장하고 공유하는 기능을 제공합니다.',
    icon: ClipboardCheck,
  },
];

export default function SpecialMatchComingSoonPage() {
  return (
    <main
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '100vh',
        backgroundColor: '#F4F8FC',
        color: '#0F2747',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxSizing: 'border-box',
      }}
    >
      {/* CONTENT WRAPPER */}
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          margin: '0 auto',
          padding: '20px 16px 32px',
          boxSizing: 'border-box',
        }}
      >
        {/* HEADER ROW */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '20px',
          }}
        >
          <Link
            href="/"
            aria-label="메인으로 돌아가기"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              border: '1px solid #DCE8F5',
              backgroundColor: '#FFFFFF',
              color: '#3B5A85',
              boxShadow: '0 4px 12px rgba(15,45,85,0.06)',
              textDecoration: 'none',
            }}
          >
            <ArrowLeft size={20} />
          </Link>
          <span
            style={{
              display: 'inline-block',
              borderRadius: '999px',
              border: '1px solid #F4C979',
              backgroundColor: '#FFF4DE',
              padding: '6px 14px',
              fontSize: '10px',
              fontWeight: 900,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: '#B7791F',
            }}
          >
            Coming Soon
          </span>
        </header>

        {/* HERO CARD */}
        <section
          style={{
            width: '100%',
            boxSizing: 'border-box',
            borderRadius: '28px',
            background: '#FFFFFF',
            border: '1px solid #DCE8F5',
            padding: '22px',
            marginBottom: '24px',
            boxShadow: '0 18px 40px rgba(15,45,85,0.08)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '18px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '60px',
                height: '60px',
                flexShrink: 0,
                borderRadius: '20px',
                background: 'linear-gradient(135deg, #3B82F6 0%, #22B8CF 100%)',
                color: '#FFFFFF',
                boxShadow: '0 10px 22px rgba(37,99,235,0.28)',
              }}
            >
              <Sparkles size={26} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: '10px',
                  fontWeight: 900,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  color: '#3B82F6',
                }}
              >
                TEYEON SPECIAL MATCH
              </p>
              <h1
                style={{
                  margin: '8px 0 0',
                  fontSize: '26px',
                  fontWeight: 900,
                  lineHeight: 1.1,
                  letterSpacing: '-0.02em',
                  color: '#0F2747',
                }}
              >
                스페셜 매치
              </h1>
            </div>
          </div>

          <p
            style={{
              margin: '20px 0 0',
              fontSize: '13.5px',
              fontWeight: 700,
              lineHeight: 1.65,
              color: '#3F5B82',
            }}
          >
            이벤트성 경기, 월례회, 특별 대진을 운영하기 위한 기능입니다.
          </p>

          <div
            style={{
              marginTop: '16px',
              borderRadius: '16px',
              backgroundColor: '#F4F8FC',
              padding: '14px 16px',
              boxSizing: 'border-box',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: '12px',
                fontWeight: 700,
                lineHeight: 1.65,
                color: '#4A6B92',
              }}
            >
              현재는 KDK 수동 운영을 우선 안정화 중이며, 스페셜 매치는 다음 단계에서 제공됩니다.
            </p>
          </div>
        </section>

        {/* FEATURE CARDS */}
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          {previewFeatures.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  borderRadius: '20px',
                  background: '#FFFFFF',
                  border: '1px solid #DCE8F5',
                  padding: '16px 18px',
                  boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '14px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '44px',
                      height: '44px',
                      flexShrink: 0,
                      borderRadius: '14px',
                      backgroundColor: '#EEF6FF',
                      color: '#2563EB',
                    }}
                  >
                    <Icon size={20} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1, paddingTop: '2px' }}>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: '15.5px',
                        fontWeight: 800,
                        lineHeight: 1.2,
                        color: '#0F2747',
                      }}
                    >
                      {feature.title}
                    </h3>
                    <p
                      style={{
                        margin: '6px 0 0',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        lineHeight: 1.6,
                        color: '#526A86',
                      }}
                    >
                      {feature.description}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        {/* CTA SECTION */}
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            marginTop: '28px',
          }}
        >
          <Link
            href="/kdk"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              width: '100%',
              height: '60px',
              boxSizing: 'border-box',
              borderRadius: '18px',
              background:
                'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
              color: '#FFFFFF',
              fontSize: '15px',
              fontWeight: 800,
              letterSpacing: '0.02em',
              textDecoration: 'none',
              boxShadow: '0 14px 28px rgba(37,99,235,0.22)',
            }}
          >
            <Trophy size={19} />
            KDK 운영으로 이동
          </Link>
          <Link
            href="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: '52px',
              boxSizing: 'border-box',
              borderRadius: '16px',
              border: '1px solid #DCE8F5',
              backgroundColor: '#FFFFFF',
              color: '#163456',
              fontSize: '13.5px',
              fontWeight: 700,
              letterSpacing: '0.02em',
              textDecoration: 'none',
              boxShadow: '0 4px 12px rgba(15,45,85,0.05)',
            }}
          >
            메인으로 돌아가기
          </Link>
        </section>
      </div>
    </main>
  );
}
