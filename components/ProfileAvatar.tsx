'use client';

import React, { useState } from 'react';
import Image from 'next/image';

interface ProfileAvatarProps {
  src?: string | null;
  alt: string;
  size?: number;
  className?: string;
  fallbackIcon: React.ReactNode;
}

/**
 * ProfileAvatar: High-performance profile picture component with Skeleton UI.
 * Optimizes images using Next.js Image and provides a smooth pulse effect.
 */
const ProfileAvatar = ({ src, alt, size = 50, className = "", fallbackIcon }: ProfileAvatarProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // If no source is provided, immediately show the fallback
  if (!src || hasError) {
    return (
      <div 
        className={`bg-white/5 flex items-center justify-center border border-white/10 ${className}`}
        style={{ width: size, height: size }}
      >
        {fallbackIcon}
      </div>
    );
  }

  return (
    <div 
      className={`relative overflow-hidden bg-white/5 border border-white/10 ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Pulse Skeleton UI */}
      {isLoading && (
        <div className="absolute inset-0 bg-white/10 animate-pulse flex items-center justify-center z-10">
            <div className="w-1/3 h-1/3 bg-white/5 rounded-full blur-sm" />
        </div>
      )}

      {/* Optimized Next.js Image */}
      <Image
        src={src}
        alt={alt}
        width={size}
        height={size}
        quality={75}
        onLoad={() => setIsLoading(false)}
        onError={() => setHasError(true)}
        className={`w-full h-full object-cover transition-opacity duration-500 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
        draggable={false}
      />
    </div>
  );
};

export default React.memo(ProfileAvatar);
