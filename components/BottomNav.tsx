'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { path: '/', label: 'MAIN', icon: '🏠' },
  { path: '/live', label: 'LIVE', icon: '🎾' },
  { path: '/results', label: 'ARCHIVE', icon: '📊' },
  { path: '/profile', label: 'PROFILE', icon: '👤' },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 h-[96px] bg-[#1B1B21]/90 backdrop-blur-md border-t border-white/5 px-2 pb-6 pt-3 flex justify-around items-center shadow-[0_-10px_40px_rgba(0,0,0,0.8)]">
      <div className="max-w-[430px] w-full mx-auto flex justify-around items-center">
        {navItems.map((item) => {
          const isActive = pathname === item.path || (item.path !== '/' && pathname?.startsWith(item.path));
          return (
            <Link 
              key={item.path} 
              href={item.path}
              className={`relative flex flex-col items-center justify-center w-[76px] transition-all duration-300 ${isActive ? 'scale-105' : 'hover:scale-105 active:scale-95'}`}
            >
              {isActive && (
                <div className="absolute -top-[16px] w-[36px] h-[4px] bg-[#E8E137] rounded-full shadow-[0_0_12px_#E8E137]" />
              )}
              <div 
                className={`text-[28px] mb-[6px] drop-shadow-md transition-all duration-300 ${
                  isActive ? 'filter brightness-125' : 'opacity-40 grayscale'
                }`}
              >
                {item.icon}
              </div>
              <span 
                className={`text-[10px] font-black tracking-[0.1em] transition-all duration-300 ${
                  isActive ? 'text-[#E8E137] drop-shadow-[0_0_8px_rgba(232,225,55,0.4)]' : 'text-gray-500'
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
