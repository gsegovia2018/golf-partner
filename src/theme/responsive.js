import { useWindowDimensions } from 'react-native';

// Layout breakpoints (in dp / CSS px).
//   width < md           -> compact   (phone)
//   md <= width < lg     -> regular   (large phone / tablet / small window)
//   width >= lg          -> wide      (desktop)
export const BREAKPOINTS = { md: 600, lg: 960 };

// Screen content never grows wider than this; beyond it the app background
// shows as side gutters.
export const CONTENT_MAX_WIDTH = 960;

// Pure: turn a window width into the responsive flags every screen reads.
// Kept separate from the hook so it can be unit-tested without rendering.
export function deriveResponsive(width) {
  const isCompact = width < BREAKPOINTS.md;
  const isWide = width >= BREAKPOINTS.lg;
  const gridColumns = isWide ? 3 : isCompact ? 1 : 2;
  return { width, isCompact, isWide, gridColumns };
}

// Hook: re-renders on window resize via useWindowDimensions().
export function useResponsive() {
  const { width } = useWindowDimensions();
  return deriveResponsive(width);
}
