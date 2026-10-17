// "Not this round" on the miss reasons sheet: a device-local, newest-first list
// of round ids whose sheet should stop auto-opening. Chips stay available. Not
// synced, since it only tells this device to stop nudging.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'missReasons.mutedRounds';
const CAP = 20;

async function readMuted() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function isRoundMuted(roundId) {
  if (roundId == null) return false;
  return (await readMuted()).includes(roundId);
}

export async function muteRound(roundId) {
  if (roundId == null) return;
  try {
    const next = [roundId, ...(await readMuted()).filter((id) => id !== roundId)].slice(0, CAP);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

export async function __resetForTests() {
  try { await AsyncStorage.removeItem(KEY); } catch { /* ignore */ }
}
