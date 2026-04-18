import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { listQueue, updateQueueEntry, removeQueueEntry } from '../store/mediaQueue';
import { processUpload } from './mediaUpload';

const BACKOFF_MS = [1_000, 4_000, 15_000, 60_000, 300_000];
let _running = false;
let _started = false;
let _scheduled = null;

async function drain() {
  if (_running) return;
  _running = true;
  try {
    const queue = await listQueue();
    for (const entry of queue) {
      if (entry.status === 'failed') continue;
      try {
        await updateQueueEntry(entry.id, { status: 'uploading' });
        await processUpload(entry);
        await removeQueueEntry(entry.id);
      } catch (err) {
        const attempts = (entry.attempts ?? 0) + 1;
        const max = BACKOFF_MS.length;
        const status = attempts >= max ? 'failed' : 'pending';
        await updateQueueEntry(entry.id, {
          status,
          attempts,
          lastError: String(err?.message ?? err),
        });
        if (status === 'pending') {
          schedule(BACKOFF_MS[Math.min(attempts, max - 1)]);
        }
      }
    }
  } finally {
    _running = false;
  }
}

function schedule(ms) {
  if (_scheduled) clearTimeout(_scheduled);
  _scheduled = setTimeout(() => { _scheduled = null; drain(); }, ms);
}

export function kickUploadWorker() {
  drain();
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

export async function retryFailedEntry(id) {
  await updateQueueEntry(id, { status: 'pending', attempts: 0, lastError: null });
  drain();
}
