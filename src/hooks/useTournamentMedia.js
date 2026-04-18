import { useEffect, useState, useCallback } from 'react';
import { loadTournamentMedia, subscribeMediaChanges } from '../store/mediaStore';
import { listQueueForTournament, subscribeQueueChanges } from '../store/mediaQueue';

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

export function useTournamentMedia(tournamentId) {
  const [items, setItems] = useState([]);

  const refresh = useCallback(async () => {
    if (!tournamentId) { setItems([]); return; }
    const [remote, pending] = await Promise.all([
      loadTournamentMedia(tournamentId),
      listQueueForTournament(tournamentId),
    ]);
    const pendingItems = pending.map(pendingToItem);
    setItems([...pendingItems, ...remote]);
  }, [tournamentId]);

  useEffect(() => {
    refresh();
    const off1 = subscribeMediaChanges(refresh);
    const off2 = subscribeQueueChanges(refresh);
    return () => { off1(); off2(); };
  }, [refresh]);

  return { items, refresh };
}
