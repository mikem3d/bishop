import { useColorScheme } from 'react-native';

// Colours come from the avatar: slate suit, porcelain light, and the four
// state glows (cyan idle, periwinkle thinking, amber working, coral needs you).

const dark = {
  bg: '#11151C',
  surface: '#1A202A',
  surfaceRaised: '#232B37',
  border: '#2C3542',
  text: '#ECEFF4',
  textMuted: '#9AA5B5',
  textFaint: '#677284',
  idle: '#5CE1E6',
  thinking: '#96AAFF',
  working: '#FFB648',
  needsYou: '#FF6B5B',
  needsYouTint: 'rgba(255,107,91,0.12)',
  workingTint: 'rgba(255,182,72,0.10)',
  idleTint: 'rgba(92,225,230,0.12)',
  onAccent: '#0B1016',
};

const light: typeof dark = {
  bg: '#F3F4F7',
  surface: '#FFFFFF',
  surfaceRaised: '#F7F8FA',
  border: '#E1E4EA',
  text: '#151A22',
  textMuted: '#5A6474',
  textFaint: '#8C95A3',
  idle: '#0E8F96',
  thinking: '#4C5FD0',
  working: '#B26A00',
  needsYou: '#D6402F',
  needsYouTint: 'rgba(214,64,47,0.08)',
  workingTint: 'rgba(178,106,0,0.08)',
  idleTint: 'rgba(14,143,150,0.08)',
  onAccent: '#FFFFFF',
};

export type Theme = typeof dark;

export function useTheme(): Theme {
  return useColorScheme() === 'light' ? light : dark;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const type = {
  title: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.4 },
  heading: { fontSize: 17, fontWeight: '700' as const },
  body: { fontSize: 16 },
  small: { fontSize: 13 },
  tiny: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.6 },
};

/** Bucket colours offered when creating one. */
export const BUCKET_COLORS = ['#5CE1E6', '#FFB648', '#96AAFF', '#FF6B5B', '#7BD88F', '#E58BD9', '#B7C2CF'];
