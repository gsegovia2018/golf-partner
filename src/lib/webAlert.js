// Polyfill for React Native's `Alert` on web.
//
// react-native-web intentionally ships `Alert` as a no-op stub
// (`class Alert { static alert() {} }`), so every `Alert.alert(...)` call in
// the app — error messages, confirmations — silently does nothing in the web
// build. That turned real failures (a failed sign-in, a failed join) into
// "nothing happened" with no feedback to the user.
//
// This installs a real implementation backed by the browser's native
// `window.alert` / `window.confirm`. Native platforms keep RN's own `Alert`
// untouched. Imported for its side effect from index.js, before <App/>.
import { Alert, Platform } from 'react-native';

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  // Mirrors React Native's Alert.alert(title, message?, buttons?, options?).
  // The browser only offers a one-button alert and a two-button confirm, so:
  //   - 0-1 buttons -> window.alert,   then run the button's onPress (if any)
  //   - 2+  buttons -> window.confirm, then run the chosen button's onPress
  Alert.alert = (title, message, buttons) => {
    const body = [title, message].filter(Boolean).join('\n\n');
    const list = Array.isArray(buttons) ? buttons.filter(Boolean) : [];

    if (list.length <= 1) {
      window.alert(body);
      const only = list[0];
      if (only && typeof only.onPress === 'function') only.onPress();
      return;
    }

    // The cancel-styled button (or, failing that, the first) is the "Cancel"
    // choice; the last remaining button is the "OK" choice.
    const cancelBtn = list.find((b) => b.style === 'cancel') ?? list[0];
    const okBtn = [...list].reverse().find((b) => b !== cancelBtn)
      ?? list[list.length - 1];
    const chosen = window.confirm(body) ? okBtn : cancelBtn;
    if (chosen && typeof chosen.onPress === 'function') chosen.onPress();
  };
}
