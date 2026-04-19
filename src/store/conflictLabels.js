// Maps the dotted `_meta` paths emitted by mutate.js into Spanish human labels
// for display in the SyncStatusSheet's "Cambios sobrescritos" list.
//
// The `blob` argument is the post-merge tournament; we use it to resolve
// round indices and player names. If it's null/incomplete, we fall back
// to em-dashes rather than failing.

function roundIndex(blob, roundId) {
  const rounds = blob?.rounds;
  if (!Array.isArray(rounds)) return null;
  const idx = rounds.findIndex((r) => r?.id === roundId);
  return idx >= 0 ? idx : null;
}

function playerName(blob, playerId) {
  const players = blob?.players;
  if (!Array.isArray(players)) return null;
  const p = players.find((x) => x?.id === playerId);
  return p?.name ?? null;
}

function roundLabel(blob, roundId) {
  const i = roundIndex(blob, roundId);
  return i == null ? 'Ronda —' : `Ronda ${i + 1}`;
}

export function pathToLabel(entry, blob) {
  const path = entry?.path ?? '';
  const parts = path.split('.');

  // rounds.<roundId>.scores.<playerId>.h<hole>
  if (parts[0] === 'rounds' && parts[2] === 'scores' && parts[4]?.startsWith('h')) {
    const hole = parts[4].slice(1);
    const name = playerName(blob, parts[3]) ?? '—';
    return `${roundLabel(blob, parts[1])} · Hoyo ${hole} · ${name}`;
  }

  // rounds.<roundId>.notes.round
  if (parts[0] === 'rounds' && parts[2] === 'notes' && parts[3] === 'round' && parts.length === 4) {
    return `${roundLabel(blob, parts[1])} · Notas`;
  }

  // rounds.<roundId>.notes.hole.<hole>
  if (parts[0] === 'rounds' && parts[2] === 'notes' && parts[3] === 'hole' && parts[4] != null) {
    return `${roundLabel(blob, parts[1])} · Nota hoyo ${parts[4]}`;
  }

  // rounds.<roundId>.pairs
  if (parts[0] === 'rounds' && parts[2] === 'pairs' && parts.length === 3) {
    return `${roundLabel(blob, parts[1])} · Parejas`;
  }

  // rounds.<roundId>.playerHandicaps.<playerId>
  if (parts[0] === 'rounds' && parts[2] === 'playerHandicaps' && parts[3] != null) {
    const name = playerName(blob, parts[3]) ?? '—';
    return `${roundLabel(blob, parts[1])} · Handicap · ${name}`;
  }

  // players (whole array replaced)
  if (path === 'players') return 'Jugadores';

  return path;
}
