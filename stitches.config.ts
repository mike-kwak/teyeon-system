import { createStitches } from '@stitches/react';

export const {
  styled,
  css,
  globalCss,
  keyframes,
  getCssText,
  theme,
  createTheme,
  config,
} = createStitches({
  theme: {
    colors: {
      black: '#000000',
      white: '#ffffff',
      gold: '#D4AF37',
      goldLight: '#F3E5AB', // Lighter gold
      goldGlint: '#FDBB2D', // Brighter, saturated gold
      goldMuted: 'rgba(212, 175, 55, 0.2)',
      goldGlass: 'rgba(212, 175, 55, 0.05)',
      gray950: '#050505',
      gray900: '#0A0A0A',
      gray850: '#151515',
      gray800: '#1E1E1E',
      gray700: '#2A2A2A',
      accent: '$gold',
      success: '#4CAF50',
      error: '#FF4B2B',
    },
    space: {
      1: '4px',
      2: '8px',
      3: '12px',
      4: '16px',
      5: '20px',
      6: '24px',
      8: '32px',
      10: '40px',
      12: '48px',
    },
    fontSizes: {
      xs: '10px',
      sm: '12px',
      base: '14px',
      lg: '16px',
      xl: '18px',
      '2xl': '24px',
      '3xl': '32px',
      '4xl': '48px',
    },
    fonts: {
      sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      mono: 'SBL Hebrew, Menlo, Monaco, Consolas, "Courier New", monospace',
    },
    fontWeights: {
      light: 300,
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      black: 900,
    },
    lineHeights: {
      none: 1,
      tight: 1.25,
      snug: 1.375,
      normal: 1.5,
      relaxed: 1.625,
      loose: 2,
    },
    letterSpacings: {
      tighter: '-0.05em',
      tight: '-0.025em',
      normal: '0',
      wide: '0.025em',
      wider: '0.05em',
      widest: '0.1em',
      mega: '0.25em',
    },
    radii: {
      sm: '4px',
      md: '8px',
      lg: '16px',
      xl: '24px',
      '2xl': '32px',
      full: '9999px',
    },
    shadows: {
      sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
      lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      gold: '0 0 15px rgba(212, 175, 55, 0.3)',
      goldGlow: '0 0 30px rgba(212, 175, 55, 0.4)',
      goldAura: '0 0 50px rgba(212, 175, 55, 0.2)',
      glass: 'inset 0 0 20px rgba(255, 255, 255, 0.03), 0 10px 30px rgba(0, 0, 0, 0.8)',
    },
    gradients: {
      blackGold: 'linear-gradient(135deg, $gray900, $black)',
      darker: 'linear-gradient(135deg, $gray850, $gray950)',
      goldGlint: 'linear-gradient(90deg, transparent, $goldGlint, transparent)',
    },
    zIndices: {
      hide: -1,
      auto: 'auto',
      base: 0,
      docked: 10,
      dropdown: 1000,
      sticky: 1100,
      banner: 1200,
      overlay: 1300,
      modal: 1400,
      popover: 1500,
      skipLink: 1600,
      toast: 1700,
      tooltip: 1800,
    },
  },
  media: {
    mobile: '(max-width: 640px)',
    tablet: '(max-width: 1024px)',
    desktop: '(min-width: 1025px)',
    fold: '(max-width: 280px)', // Galaxy Fold cover screen
  },
  utils: {
    p: (value: any) => ({ padding: value }),
    pt: (value: any) => ({ paddingTop: value }),
    pr: (value: any) => ({ paddingRight: value }),
    pb: (value: any) => ({ paddingBottom: value }),
    pl: (value: any) => ({ paddingLeft: value }),
    px: (value: any) => ({ paddingLeft: value, paddingRight: value }),
    py: (value: any) => ({ paddingTop: value, paddingBottom: value }),

    m: (value: any) => ({ margin: value }),
    mt: (value: any) => ({ marginTop: value }),
    mr: (value: any) => ({ marginRight: value }),
    mb: (value: any) => ({ marginBottom: value }),
    ml: (value: any) => ({ marginLeft: value }),
    mx: (value: any) => ({ marginLeft: value, marginRight: value }),
    my: (value: any) => ({ marginTop: value, marginBottom: value }),

    bg: (value: any) => ({ backgroundColor: value }),
    br: (value: any) => ({ borderRadius: value }),
    
    size: (value: any) => ({ width: value, height: value }),
    
    // New Utils for Premium Styles
    borderGlow: (value: any) => ({
      border: `1.5px solid ${value || 'rgba(212, 175, 55, 0.2)'}`,
      boxShadow: '0 0 15px rgba(212, 175, 55, 0.1)',
    }),
  },
});

export const globalStyles = globalCss({
  '*': { margin: 0, padding: 0, boxSizing: 'border-box' },
  'html, body': {
    backgroundColor: '$black',
    color: '$white',
    fontFamily: '$sans',
    overflowX: 'hidden',
    height: '100%',
  },
  'a': {
    color: 'inherit',
    textDecoration: 'none',
  },
  'button': {
    cursor: 'pointer',
    border: 'none',
    outline: 'none',
    background: 'none',
    fontFamily: 'inherit',
  },
  '::-webkit-scrollbar': {
    width: '4px',
  },
  '::-webkit-scrollbar-track': {
    background: '$black',
  },
  '::-webkit-scrollbar-thumb': {
    background: '$gray600',
    borderRadius: '$full',
  },
});
