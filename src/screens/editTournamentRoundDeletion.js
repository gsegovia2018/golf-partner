import { isRoundComplete, roundEnteredCount } from '../store/tournamentStore';

export function canRemoveRoundFromEditor(tournament, roundIndex) {
  const rounds = tournament?.rounds ?? [];
  return roundIndex >= 0 && roundIndex < rounds.length && rounds.length > 1;
}

// Returns i18n message descriptors (keys + params); the screen renders them.
export function roundRemovalConfirmation({
  round,
  roundIndex,
  players,
  tournament,
}) {
  const entered = round ? roundEnteredCount(round, players) : 0;
  const isHistoryRound = !!tournament?.finishedAt || isRoundComplete(round, players);
  const params = { n: roundIndex + 1, count: entered };

  if (isHistoryRound) {
    return {
      titleKey: 'setup.edit.delHistory.title',
      messageKey: 'setup.edit.delHistory.message',
      confirmKey: 'setup.edit.delHistory.confirm',
      params,
    };
  }

  if (entered > 0) {
    return {
      titleKey: 'setup.edit.delScores.title',
      messageKey: 'setup.edit.delScores.message',
      confirmKey: 'setup.edit.delScores.confirm',
      params,
    };
  }

  return {
    titleKey: 'setup.edit.delRound.title',
    messageKey: 'setup.edit.delRound.message',
    confirmKey: 'setup.edit.delRound.confirm',
    params,
  };
}
