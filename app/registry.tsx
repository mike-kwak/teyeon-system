'use client';

import React from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { getCssText, globalStyles } from '@/stitches.config';

export default function StitchesRegistry({ children }: { children: React.ReactNode }) {
  useServerInsertedHTML(() => {
    // Force global styles to be registered before extracting CSS text
    globalStyles();
    return (
      <style id="stitches" dangerouslySetInnerHTML={{ __html: getCssText() }} />
    );
  });

  return <>{children}</>;
}
