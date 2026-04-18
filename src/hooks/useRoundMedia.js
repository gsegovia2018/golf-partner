import { useEffect, useState, useCallback } from 'react';
import { loadRoundMedia, subscribeMediaChanges } from '../store/mediaStore';
import { listQueueForRound, subscribeQueueChanges } from '../store/mediaQueue';

function pendingToItem(e) {
  return {
    id: e.id,
    tournamentId: e.tournamentId,
    roundId: e.roundId,
    holeIndex: e.holeIndex ?? null,
    kind: e.kind,
    caption: e.caption ?? null,
    uploaderLabel: e.uploaderLabel ?? null,
    createdAt: e.enqueuedAt,
    url: e.localUri,
    thumbUrl: e.localUri,
    status: e.status === 'failed' ? 'failed' : 'uploading',
  };
}

export function useRoundMedia(roundId) {
  const [items, setItems] = useState([]);

  const refresh = useCallback(async () => {
    if (!roundId) { setItems([]); return; }
    const [remote, pending] = await Promise.all([
      loadRoundMedia(roundId),
      listQueueForRound(roundId),
    ]);
    const pendingItems = pending.map(pendingToItem);
    setItems([...pendingItems, ...remote]);
  }, [roundId]);

  useEffect(() => {
    refresh();
    const off1 = subscribeMediaChanges(refresh);
    const off2 = subscribeQueueChanges(refresh);
    return () => { off1(); off2(); };
  }, [refresh]);

  return { items, refresh };
}
