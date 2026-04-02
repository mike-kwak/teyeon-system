'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Medal, User, LoaderPinwheel } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

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
  { path: '/live', label: 'LIVE COURT', icon: (props: any) => <TennisRacket {...props} /> },
  { path: '/results', label: 'ARCHIVE', icon: (props: any) => <Medal {...props} /> },
  { path: '/profile', label: 'PROFILE', icon: (props: any) => <User {...props} /> },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { user, setSystemMessage } = useAuth();

  const handleGuestClick = (e: React.MouseEvent, itemLabel: string) => {
    if (!user && itemLabel !== 'MAIN') {
      e.preventDefault();
      setSystemMessage('로그인이 필요한 메뉴입니다. 카카오 계정으로 로그인해 주세요.');
      
      // Auto-clear after 3 seconds
      setTimeout(() => setSystemMessage(null), 3000);
    }
  };

  return (
    <nav className="fixed bottom-[16px] left-1/2 -translate-x-1/2 z-50 h-[80px] w-[92%] max-w-[400px] bg-[#1B1B21]/90 backdrop-blur-xl border border-white/10 px-2 flex justify-around items-center shadow-[0_20px_50px_rgba(0,0,0,0.8)] rounded-[32px] transition-all duration-300">
      <div className="max-w-[430px] w-full mx-auto flex justify-around items-center">
        {navItems.map((item) => {
          const isActive = pathname === item.path || (item.path !== '/' && pathname?.startsWith(item.path));
          return (
            <Link 
              key={item.path} 
              href={item.path}
              onClick={(e) => handleGuestClick(e, item.label)}
              className={`relative flex flex-col items-center justify-center w-[76px] transition-all duration-300 ${isActive ? 'scale-105' : 'hover:scale-105 active:scale-95'} ${!user && item.label !== 'MAIN' ? 'opacity-40' : ''}`}
            >
              {isActive && (
                <div className="absolute -top-[16px] w-[36px] h-[3px] bg-[#EFDFB4] rounded-full shadow-[0_0_12px_#EFDFB4]" />
              )}
              <div 
                className={`mb-[6px] transition-all duration-300 ${
                  isActive ? 'text-[#EFDFB4] drop-shadow-[0_0_8px_rgba(239,223,180,0.8)]' : 'text-[#C9B075]/40'
                }`}
              >
                <item.icon size={24} strokeWidth={1.5} />
              </div>
              <span 
                className={`text-[9px] font-black tracking-[0.15em] transition-all duration-300 ${
                  isActive ? 'text-[#EFDFB4] drop-shadow-[0_0_8px_rgba(239,223,180,0.4)]' : 'text-[#C9B075]/60'
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
