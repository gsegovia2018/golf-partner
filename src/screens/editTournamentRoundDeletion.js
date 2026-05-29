import { isRoundComplete, roundEnteredCount } from '../store/tournamentStore';

export function canRemoveRoundFromEditor(tournament, roundIndex) {
  const rounds = tournament?.rounds ?? [];
  return roundIndex >= 0 && roundIndex < rounds.length && rounds.length > 1;
}

export function roundRemovalConfirmation({
  round,
  roundIndex,
  players,
  tournament,
}) {
  const entered = round ? roundEnteredCount(round, players) : 0;
  const isHistoryRound = !!tournament?.finishedAt || isRoundComplete(round, players);
  const label = `Round ${roundIndex + 1}`;

  if (isHistoryRound) {
    return {
      title: 'Delete history round',
      message: `Delete ${label} from history? This permanently removes its scores and stats.`,
      confirmLabel: 'Delete history round',
    };
  }

  if (entered > 0) {
    return {
      title: 'Remove round',
      message: `${label} has scores entered for ${entered} hole${entered !== 1 ? 's' : ''}. Removing it will permanently delete those scores.`,
      confirmLabel: 'Delete round & scores',
    };
  }

  return {
    title: 'Remove round',
    message: `Remove ${label}?`,
    confirmLabel: 'Remove',
  };
}
