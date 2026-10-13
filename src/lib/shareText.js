// Copy or share a piece of text (the league share sheet). Native: the system
// share sheet. Web: navigator.share where the browser has it, otherwise the
// text is copied and the caller shows "Copied".
import { Platform, Share, Clipboard } from 'react-native';

export async function copyText(text) {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API refused (no focus / permission): try the fallback below.
    }
  }
  try {
    Clipboard.setString(text);
    return true;
  } catch {
    return false;
  }
}

// 'shared' | 'cancelled' | 'copied' | 'failed'.
export async function shareText(text) {
  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ text });
        return 'shared';
      } catch (e) {
        if (e?.name === 'AbortError') return 'cancelled';
        // Not allowed here (desktop, insecure origin): copy instead.
      }
    }
    return (await copyText(text)) ? 'copied' : 'failed';
  }
  try {
    const res = await Share.share({ message: text });
    return res?.action === Share.dismissedAction ? 'cancelled' : 'shared';
  } catch {
    return (await copyText(text)) ? 'copied' : 'failed';
  }
}
