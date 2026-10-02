// Matches the web app's brand palette (frontend/src/styles/base.css)
// so both apps look like the same product, not two unrelated ones.
export const colors = {
  brand50: '#EEEEFD',
  brand100: '#E1E1FB',
  brand200: '#C7C7F7',
  brand400: '#7D7FF0',
  brand500: '#5B5FEE',
  brand600: '#4740D4',
  brand700: '#3732A8',
  brand900: '#201D63',

  bg: '#F8FAFC',
  card: '#FFFFFF',
  border: '#E2E8F0',

  gray50: '#F8FAFC',
  gray100: '#F1F5F9',
  gray200: '#E2E8F0',
  gray300: '#CBD5E1',
  gray400: '#94A3B8',
  gray500: '#64748B',
  gray700: '#334155',
  gray800: '#1E293B',
  gray900: '#0F172A',

  success: '#10B981',
  successBg: '#D1FAE5',
  warning: '#F59E0B',
  warningBg: '#FEF3C7',
  danger: '#EF4444',
  dangerBg: '#FEE2E2',
  info: '#0EA5E9',

  white: '#FFFFFF',
  black: '#000000',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  full: 999,
};

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
};

// Consistent elevation across iOS (shadow*) and Android (elevation) —
// used by Card, Button (primary variant), and the floating action
// buttons, so depth reads the same everywhere instead of every screen
// hand-rolling its own shadow values.
export const shadow = {
  sm: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  lg: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
};

export default { colors, spacing, radius, fontSize, shadow };
