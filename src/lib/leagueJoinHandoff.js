import { useSyncExternalStore } from 'react';

// In-memory handoff between the signed-out league invite screen
// (JoinLeagueLinkScreen), App.js's auth gate and the signed-in JoinLeagueScreen.
//
// * hold: the "I'm new" path signs in anonymously, attaches the email and
//   joins, in that order. The moment the anonymous session exists App.js would
//   swap the invite screen for the navigator and unmount it mid-flow, so the
//   screen holds the gate for the duration and App.js keeps rendering it.
// * justJoined: after a successful join the navigator opens on /league/CODE;
//   JoinLeagueScreen consumes this to go straight to the board instead of
//   showing "You're in" for a league the user joined a second ago.
// * loginTab: a guest who is told their email already has an account and taps
//   "Log in instead" is signed out; the invite screen then opens on the
//   "I have an account" tab.

let held = false;
const listeners = new Set();
let justJoinedCode = null;
let loginTab = false;

function emit() { listeners.forEach((l) => l()); }

export function holdLeagueJoin() {
  if (held) return;
  held = true;
  emit();
}

export function releaseLeagueJoin() {
  if (!held) return;
  held = false;
  emit();
}

export function isLeagueJoinHeld() { return held; }

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLeagueJoinHeld() {
  return useSyncExternalStore(subscribe, isLeagueJoinHeld, isLeagueJoinHeld);
}

const norm = (code) => String(code ?? '').trim().toUpperCase();

export function markJustJoined(code) { justJoinedCode = norm(code); }

// True once for the code just joined.
export function consumeJustJoined(code) {
  if (!justJoinedCode || justJoinedCode !== norm(code)) return false;
  justJoinedCode = null;
  return true;
}

export function requestLoginTab() { loginTab = true; }

// True once after requestLoginTab().
export function consumeLoginTab() {
  const v = loginTab;
  loginTab = false;
  return v;
}
