import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from '../i18n';
import { announceLeagueCard } from '../store/leagueStore';
import { mutate } from '../store/mutate';
import { roundScoringMode } from '../store/scoring';
import { applyLeagueHandicap, leagueCourse, leagueCardsPatch } from '../store/leagueSetup';

// Several league cards per game (R16) and tournament rounds (R17), D5 B.
//
// Announcing needs a connection (the server stamps announced_at), so it is
// never queued: a failure is shown and the round stays a normal one.

const DISMISS_KEY = '@golf_league_optin_dismissed:';

// "Not this round" on the one-time sheet, remembered per round on this phone
// (and set by Setup / Start Round N when I left my own switch off there).
export async function isLeagueOptInDismissed(tournamentId, roundId) {
  if (!tournamentId || !roundId) return false;
  try {
    return (await AsyncStorage.getItem(`${DISMISS_KEY}${tournamentId}:${roundId}`)) === '1';
  } catch {
    return false;
  }
}

export async function dismissLeagueOptIn(tournamentId, roundId) {
  if (!tournamentId || !roundId) return;
  try {
    await AsyncStorage.setItem(`${DISMISS_KEY}${tournamentId}:${roundId}`, '1');
  } catch {
    // Best effort: at worst the sheet asks again.
  }
}

// Announces MY card for a round of a game that already exists (Start Round N,
// the scorecard sheet). Each phone announces only its own player (the server
// refuses another one, 'not_your_player'). Throws the LeagueError of the
// announce. Returns the card ({ id, leagueHandicap, postBy, existing, ... }).
export async function announceMyRoundCard({ tournament, roundId, meId, league }) {
  const round = tournament.rounds.find((r) => r.id === roundId);
  return announceLeagueCard({
    leagueId: league.id,
    source: 'app',
    course: leagueCourse(round, meId),
    teeTime: new Date().toISOString(),
    tournamentId: tournament.id,
    roundId,
    playerId: meId,
    scoringMode: roundScoringMode(tournament, round),
  });
}

// Records an announced card on the tournament under my own leagueCards key.
// Returns the updated tournament.
//
// `applyHandicap` (pre-round only: Start Round N) also puts my league handicap
// on that round as an auto entry (handicap.setLeague, never manual, so a tee
// change still recomputes it). The scorecard sheet leaves it false: the server
// scores the league card from the frozen league handicap, and changing a
// casual round mid-play would shift team results for everyone.
export async function recordRoundCard({
  tournament, roundId, meId, league, card, applyHandicap = false,
}) {
  let next = await mutate(tournament, {
    type: 'tournament.updateProfile',
    patch: leagueCardsPatch({ leagueId: league.id, cardId: card.id, playerId: meId, roundId }),
  });
  const hcp = card.leagueHandicap ?? league.leagueHandicap;
  const r = next.rounds.find((x) => x.id === roundId);
  if (applyHandicap && hcp != null && r) {
    const withHcp = applyLeagueHandicap(r, meId, hcp);
    next = await mutate(next, {
      type: 'handicap.setLeague',
      roundId,
      playerId: meId,
      index: withHcp.playerIndexes[meId],
      handicap: withHcp.playerHandicaps[meId],
    });
  }
  return next;
}

// Both, for Start Round N (before the round starts, so my league handicap is
// applied). Nothing is written when the announce fails. Returns { tournament, card }.
export async function announceRoundCard({ tournament, roundId, meId, league }) {
  const card = await announceMyRoundCard({ tournament, roundId, meId, league });
  const next = await recordRoundCard({
    tournament, roundId, meId, league, card, applyHandicap: true,
  });
  return { tournament: next, card };
}

// The announce failed at Start Round N: start it as a normal round, or stay.
export async function confirmStartWithoutLeague(leagueName, reason) {
  const title = t('league.cards.failTitle');
  const message = t('league.cards.failMessage', { reason, league: leagueName });
  if (Platform.OS === 'web') return window.confirm(`${title}\n\n${message}`);
  return new Promise((resolve) => Alert.alert(
    title, message,
    [{ text: t('league.cards.failCancel'), style: 'cancel', onPress: () => resolve(false) },
     { text: t('league.cards.failStart'), onPress: () => resolve(true) }],
  ));
}
