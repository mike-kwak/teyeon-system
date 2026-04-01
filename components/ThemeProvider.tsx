'use client';

import React, { useEffect } from 'react';
import { globalStyles } from '@/stitches.config';

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    globalStyles();
  }, []);

  return <>{children}</>;
}
