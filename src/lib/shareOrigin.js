import { Platform } from 'react-native';

// Origin used when building share links. On web we read the live origin;
// off-web (or if window is unavailable) we fall back to the production host.
export function shareOrigin() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'https://golf-partner.vercel.app';
}
