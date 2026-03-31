'use client';

import React from 'react';

interface PremiumSpinnerProps {
  message?: string;
  isWhiteTheme?: boolean;
}

const PremiumSpinner: React.FC<PremiumSpinnerProps> = ({ message = "Syncing Data...", isWhiteTheme = false }) => {
  return (
    <div className={`fixed inset-0 flex items-center justify-center z-[5000] backdrop-blur-sm ${isWhiteTheme ? 'bg-white/80' : 'bg-[#0F0F1A]/80'}`}>
      <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in-95 duration-500">
        <div className="relative w-20 h-20">
          {/* Main Gold Ring */}
          <div className={`absolute inset-0 border-4 border-t-transparent rounded-full animate-spin ${isWhiteTheme ? 'border-slate-200 border-t-[#B45309]' : 'border-white/5 border-t-[#D4AF37]'}`}></div>
          
          {/* Inner Pulsing Core */}
          <div className={`absolute inset-4 rounded-full animate-pulse transition-colors ${isWhiteTheme ? 'bg-[#B45309]/20' : 'bg-[#D4AF37]/20'}`}></div>
          
          {/* Rotating Sparkle */}
          <div className="absolute inset-0 animate-[spin_3s_linear_infinite]">
            <div className={`absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full blur-[2px] ${isWhiteTheme ? 'bg-[#B45309]' : 'bg-[#D4AF37]'}`}></div>
          </div>
        </div>
        
        <div className="flex flex-col items-center gap-2">
          <span className={`text-[10px] font-black uppercase tracking-[0.4em] animate-pulse ${isWhiteTheme ? 'text-[#B45309]' : 'text-[#D4AF37]'}`}>
            {message}
          </span>
          <div className={`h-[1px] w-12 bg-gradient-to-r from-transparent via-${isWhiteTheme ? '[#B45309]' : '[#D4AF37]'}/40 to-transparent animate-shimmer`}></div>
        </div>
      </div>
    </div>
  );
};

export default PremiumSpinner;
