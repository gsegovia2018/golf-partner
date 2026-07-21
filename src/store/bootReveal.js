// One-shot boot signal: the splash overlay in App.js stays on top of the
// mounting app shell until the first meaningful screen has content, then
// fades out exactly once per cold start. HomeScreen fires markBootReady()
// when its initial load lands; a failsafe timeout in the overlay guarantees
// the app is never stuck behind the splash.

let revealed = false;
const subs = new Set();

export function markBootReady() {
  if (revealed) return;
  revealed = true;
  subs.forEach((fn) => { try { fn(); } catch (_) {} });
}

export function isBootRevealed() {
  return revealed;
}

export function subscribeBootReveal(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// Test hook — module state would otherwise leak between jest cases.
export function _resetBootReveal() {
  revealed = false;
  subs.clear();
}
