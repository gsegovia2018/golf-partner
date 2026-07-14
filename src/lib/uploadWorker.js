import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { listQueue, updateQueueEntry, removeQueueEntry } from '../store/mediaQueue';
import { processUpload } from './mediaUpload';

const BACKOFF_MS = [1_000, 4_000, 15_000, 60_000, 300_000];
let _running = false;
let _dirty = false;
let _started = false;
let _scheduled = null;

// Re-entrant: if drain() is invoked while a drain is already in flight (e.g.
// a new photo is attached mid-drain, or a NetInfo/AppState event fires
// during an upload), it doesn't start a second overlapping pass over the
// queue — it flags the running pass to loop again once the current queue
// snapshot finishes, so a newly attached entry isn't stranded `pending`
// until the next external event kicks the worker.
async function drain() {
  if (_running) {
    _dirty = true;
    return;
  }
  _running = true;
  try {
    do {
      _dirty = false;
      const queue = await listQueue();
      const now = Date.now();
      for (const entry of queue) {
        if (entry.status === 'failed') continue;
        // Per-entry backoff gate: skip entries whose retry isn't due yet so
        // a NetInfo/AppState event doesn't retry every failed entry at once
        // (retry storm). The `schedule()` timer below is what actually
        // drives the retry once nextAttemptAt elapses.
        if (entry.nextAttemptAt && entry.nextAttemptAt > now) continue;
        try {
          await updateQueueEntry(entry.id, { status: 'uploading' });
          await processUpload(entry);
          await removeQueueEntry(entry.id);
        } catch (err) {
          const attempts = (entry.attempts ?? 0) + 1;
          const max = BACKOFF_MS.length;
          const status = attempts >= max ? 'failed' : 'pending';
          const delay = BACKOFF_MS[Math.min(attempts, max - 1)];
          await updateQueueEntry(entry.id, {
            status,
            attempts,
            lastError: String(err?.message ?? err),
            nextAttemptAt: status === 'pending' ? now + delay : null,
          });
          if (status === 'pending') {
            schedule(delay);
          }
        }
      }
    } while (_dirty);
  } finally {
    _running = false;
  }
}

function schedule(ms) {
  if (_scheduled) clearTimeout(_scheduled);
  _scheduled = setTimeout(() => { _scheduled = null; drain(); }, ms);
}

export function kickUploadWorker() {
  return drain();
}

export function startUploadWorker() {
  if (_started) return;
  _started = true;

  drain();

  NetInfo.addEventListener((state) => {
    if (state.isConnected) drain();
  });

  AppState.addEventListener('change', (next) => {
    if (next === 'active') drain();
  });
}
