'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Medal, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import LiveMatchGatekeeper from './tournament/LiveMatchGatekeeper';

const TennisRacket = ({ size = 24, color = 'currentColor', strokeWidth = 1.5 }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke={color} 
    strokeWidth={strokeWidth} 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <circle cx="15" cy="9" r="6" />
    <path d="M10.5 13.5L3 21" />
    <path d="M12 6l6 6M9 9l6 6" />
  </svg>
);

const navItems = [
  { path: '/', label: 'MAIN', icon: (props: any) => <Home {...props} /> },
  { path: '/kdk', label: 'LIVE COURT', icon: (props: any) => <TennisRacket {...props} /> },
  { path: '/archive', label: 'ARCHIVE', icon: (props: any) => <Medal {...props} /> },
  { path: '/profile', label: 'PROFILE', icon: (props: any) => <User {...props} /> },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setSystemMessage } = useAuth();
  const [showGatekeeper, setShowGatekeeper] = React.useState(false);

  const handleLiveCourtClick = (e: React.MouseEvent) => {
    if (!user) {
      e.preventDefault();
      setSystemMessage('로그인이 필요한 메뉴입니다. 카카오 계정으로 로그인해 주세요.');
      setTimeout(() => setSystemMessage(null), 3000);
      return;
    }

    const kdkActive = localStorage.getItem('kdk_live_session');
    const specialActive = localStorage.getItem('special_live_session');

    if (kdkActive && specialActive) {
      e.preventDefault();
      setShowGatekeeper(true);
    } else if (specialActive) {
      e.preventDefault();
      router.push('/special');
    }
  };

  const handleGuestClick = (e: React.MouseEvent, itemLabel: string) => {
    if (itemLabel === 'LIVE COURT') {
        handleLiveCourtClick(e);
        return;
    }
    
    if (!user && itemLabel !== 'MAIN') {
      e.preventDefault();
      setSystemMessage('로그인이 필요한 메뉴입니다. 카카오 계정으로 로그인해 주세요.');
      setTimeout(() => setSystemMessage(null), 3000);
    }
  };

  return (
    <>
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 z-[500] h-[95px] w-full max-w-[430px] bg-black/80 backdrop-blur-3xl border-t border-white/10 px-1 flex justify-around items-center shadow-[0_-10px_40px_rgba(0,0,0,0.8)] transition-all duration-300">
      <div className="w-full mx-auto flex justify-between items-center h-full px-4">
        {navItems.map((item) => {
          const isActive = pathname === item.path || (item.path !== '/' && pathname?.startsWith(item.path));
          return (
            <Link 
              key={item.path} 
              href={item.path}
              onClick={(e) => handleGuestClick(e, item.label)}
              className={`relative flex flex-col items-center justify-center flex-1 h-full transition-all duration-300 ${isActive ? 'scale-105' : 'hover:scale-105 opacity-40'} ${!user && item.label !== 'MAIN' ? 'opacity-20' : ''}`}
            >
              <div 
                className={`mb-1 transition-all duration-300 ${
                  isActive ? 'text-[#EFDFB4] drop-shadow-[0_0_12px_rgba(239,223,180,0.8)]' : 'text-white'
                }`}
              >
                <item.icon size={32} strokeWidth={isActive ? 2.5 : 1.5} />
              </div>
              <span 
                className={`text-[8px] font-black tracking-[0.2em] transition-all duration-300 uppercase ${
                  isActive ? 'text-[#EFDFB4]' : 'text-white/40'
                }`}
              >
                {item.label}
              </span>
              {isActive && (
                <div className="absolute -bottom-1 w-1.5 h-1.5 bg-[#EFDFB4] rounded-full shadow-[0_0_10px_#EFDFB4] animate-in fade-in zoom-in duration-500" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
      <LiveMatchGatekeeper 
        isOpen={showGatekeeper} 
        onClose={() => setShowGatekeeper(false)} 
      />
    </>
  );
}
