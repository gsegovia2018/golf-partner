import AsyncStorage from '@react-native-async-storage/async-storage';
import { notifyLeagueTeeOff } from '../store/leagueStore';

// The scorecard's first score tap on a league round tells the league "teed
// off" (notify_league_tee_off, which also stamps first_shot_at server-side).
// Fire-and-forget: scoring never waits on it. A persisted flag per card makes
// it once-only across restarts, and lets an offline tap be retried on the
// next tap or focus. The RPC is idempotent, so a retry that races a success
// is harmless.

const KEY = '@golf_league_teeoff:';
const done = new Set();
const inflight = new Set();

async function readFlag(cardId) {
  try { return await AsyncStorage.getItem(KEY + cardId); } catch { return null; }
}

async function writeFlag(cardId, value) {
  try { await AsyncStorage.setItem(KEY + cardId, value); } catch { /* best-effort */ }
}

export async function requestLeagueTeeOff(cardId) {
  if (!cardId || done.has(cardId) || inflight.has(cardId)) return;
  inflight.add(cardId);
  try {
    const flag = await readFlag(cardId);
    if (flag === 'done') { done.add(cardId); return; }
    if (flag !== 'pending') await writeFlag(cardId, 'pending');
    await notifyLeagueTeeOff(cardId);
    done.add(cardId);
    await writeFlag(cardId, 'done');
  } catch (e) {
    console.warn('League tee-off notify failed', e?.message ?? e);
    // Offline: keep 'pending' for a retry. A refusal from the server (card
    // void, league archived) will not change on retry, so stop asking.
    if (!e?.offline) {
      done.add(cardId);
      await writeFlag(cardId, 'done');
    }
  } finally {
    inflight.delete(cardId);
  }
}

// On focus: resend only a tap that never got through.
export async function retryLeagueTeeOff(cardId) {
  if (!cardId || done.has(cardId) || inflight.has(cardId)) return;
  if ((await readFlag(cardId)) === 'pending') await requestLeagueTeeOff(cardId);
}

export function resetLeagueTeeOffForTests() {
  done.clear();
  inflight.clear();
}
