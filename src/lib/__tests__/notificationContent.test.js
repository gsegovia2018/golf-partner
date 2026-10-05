import { renderNotification, notificationLink, normalizeDeepLink } from '../notificationContent';

describe('renderNotification', () => {
  test('friend_request uses the actor name', () => {
    const r = renderNotification('friend_request', { actor_name: 'Sam' });
    expect(r.title).toBe('New friend request');
    expect(r.body).toBe('Sam wants to be your golf partner');
  });

  test('friend_accepted uses the actor name', () => {
    const r = renderNotification('friend_accepted', { actor_name: 'Sam' });
    expect(r.title).toBe('Friend request accepted');
    expect(r.body).toBe('Sam accepted your friend request');
  });

  test('added_to_game names the tournament', () => {
    const r = renderNotification('added_to_game', { tournament_name: 'Weekend Cup' });
    expect(r.title).toBe('Added to a game');
    expect(r.body).toBe('You were added to Weekend Cup');
  });

  test('round_finished uses actor name and course name', () => {
    const r = renderNotification('round_finished', { actor_name: 'Jo', course_name: 'Pebble' });
    expect(r.title).toBe('Round finished');
    expect(r.body).toBe('Jo finished a round at Pebble');
  });

  test('round_finished falls back to tournament name when course is empty', () => {
    const r = renderNotification('round_finished', { actor_name: 'Jo', course_name: '', tournament_name: 'Spring Open' });
    expect(r.body).toBe('Jo finished a round at Spring Open');
  });

  test('missing actor name falls back to "A friend"', () => {
    const r = renderNotification('round_finished', { course_name: 'Pebble' });
    expect(r.body).toBe('A friend finished a round at Pebble');
  });

  test('feed_reaction names the actor, emoji, and course', () => {
    const r = renderNotification('feed_reaction', {
      actor_name: 'Sam',
      emoji: '😎',
      course_name: 'La Moraleja',
    });
    expect(r.title).toBe('New reaction');
    expect(r.body).toBe('Sam reacted 😎 to La Moraleja');
  });

  test('feed_comment names the actor and round context', () => {
    const r = renderNotification('feed_comment', {
      actor_name: 'Sam',
      tournament_name: 'Weekend Cup',
    });
    expect(r.title).toBe('New comment');
    expect(r.body).toBe('Sam commented on Weekend Cup');
  });

  test('unknown type returns a generic notification', () => {
    const r = renderNotification('something_else', {});
    expect(r.title).toBe('Notification');
  });
});

describe('notificationLink', () => {
  test('friend types route to Friends', () => {
    expect(notificationLink('friend_request', {})).toEqual({ screen: 'Friends' });
    expect(notificationLink('friend_accepted', {})).toEqual({ screen: 'Friends' });
  });

  test('added_to_game routes to the Home tab (nested under Main) with the tournament id', () => {
    expect(notificationLink('added_to_game', { tournament_id: 't1' }))
      .toEqual({
        screen: 'Main',
        params: { screen: 'Home', params: { openTournamentId: 't1' } },
      });
  });

  test('round_finished routes to RoundSummary with tournament and round ids', () => {
    expect(notificationLink('round_finished', { tournament_id: 't1', round_id: 'r1' }))
      .toEqual({ screen: 'RoundSummary', params: { tournamentId: 't1', roundId: 'r1' } });
  });

  test('feed activity routes to RoundSummary with tournament and round ids', () => {
    expect(notificationLink('feed_reaction', { tournament_id: 't1', round_id: 'r1' }))
      .toEqual({ screen: 'RoundSummary', params: { tournamentId: 't1', roundId: 'r1' } });
    expect(notificationLink('feed_comment', { tournament_id: 't1', round_id: 'r1' }))
      .toEqual({ screen: 'RoundSummary', params: { tournamentId: 't1', roundId: 'r1' } });
  });

  test('unknown type routes to the Notifications inbox', () => {
    expect(notificationLink('something_else', {})).toEqual({ screen: 'Notifications' });
  });
});

describe('normalizeDeepLink', () => {
  test('rewrites a legacy bare Home link to the nested Main → Home form', () => {
    expect(normalizeDeepLink({ screen: 'Home', params: { openTournamentId: 't1' } }))
      .toEqual({
        screen: 'Main',
        params: { screen: 'Home', params: { openTournamentId: 't1' } },
      });
  });

  test('passes an already-nested link through untouched', () => {
    const nested = {
      screen: 'Main',
      params: { screen: 'Home', params: { openTournamentId: 't1' } },
    };
    expect(normalizeDeepLink(nested)).toEqual(nested);
  });

  test('passes non-Home links through untouched', () => {
    expect(normalizeDeepLink({ screen: 'Friends' })).toEqual({ screen: 'Friends' });
    expect(normalizeDeepLink({
      screen: 'RoundSummary',
      params: { tournamentId: 't1', roundId: 'r1' },
    })).toEqual({
      screen: 'RoundSummary',
      params: { tournamentId: 't1', roundId: 'r1' },
    });
  });

  test('tolerates missing input', () => {
    expect(normalizeDeepLink(undefined)).toEqual({});
  });
});

describe('league notifications', () => {
  const base = { league_id: 'L1', league_name: 'Tour', actor_name: 'Pablo' };

  test('tee off names the actor and course', () => {
    const r = renderNotification('league_tee_off', { ...base, course_name: 'Golf La Herrer\u00eda' });
    expect(r.title).toBe('Teed off');
    expect(r.body).toBe('Pablo teed off for their league card \u00b7 Golf La Herrer\u00eda');
  });

  test('card announced names the month and course', () => {
    const r = renderNotification('league_card_announced', { ...base, month: '2026-10-01', course_name: 'Sotogrande' });
    expect(r.body).toBe('Pablo will play their October card at Sotogrande');
  });

  test('card announced survives missing month and course', () => {
    expect(renderNotification('league_card_announced', base).body).toBe('Pablo will play their card');
  });

  test('card confirmed falls back to points when the payload has no net differential', () => {
    const r = renderNotification('league_card_confirmed', { ...base, month: '2026-10-01', points: 36 });
    expect(r.body).toBe("Pablo's October card is confirmed, 36 pts");
  });

  test('card confirmed speaks the net differential, with no pronouns', () => {
    const at = (net) => renderNotification('league_card_confirmed', { ...base, month: '2026-10-01', points: 36, net_differential: net }).body;
    expect(at(-2.4)).toBe("Pablo's October card is confirmed \u00b7 2.4 better than handicap");
    expect(at('3.14')).toBe("Pablo's October card is confirmed \u00b7 3.1 worse than handicap");
    expect(at(0)).toBe("Pablo's October card is confirmed \u00b7 level with handicap");
    expect(at(null)).toBe("Pablo's October card is confirmed \u00b7 unrated tee, not ranked");
    [at(-2.4), at(3.1), at(null)].forEach((b) => expect(b).not.toMatch(/\b(his|her|their)\b/));
  });

  test('marker issue includes the note', () => {
    const r = renderNotification('league_marker_issue', { ...base, marker_name: 'Ana', note: 'hole 4' });
    expect(r.body).toBe('Ana flagged your card: hole 4');
  });

  test('vote opened shows the change', () => {
    const r = renderNotification('league_vote_opened', { ...base, subject_name: 'Ana', old: 12.4, proposed: 10.8 });
    expect(r.body).toBe("Vote on Ana's handicap, 12.4 to 10.8");
  });

  test('ranking updated and reminder', () => {
    expect(renderNotification('league_ranking_updated', { ...base, month: '2026-09-01' }).body)
      .toBe('Tour September ranking is in');
    expect(renderNotification('league_month_reminder', base).body)
      .toBe('You have no card yet in Tour this month');
  });

  test('invite names the league', () => {
    expect(renderNotification('league_invite', { ...base, inviter_name: 'Pablo' }).body)
      .toBe('Pablo invited you to Tour');
  });

  test('every league type has its own icon, not the fallback', () => {
    ['league_invite', 'league_card_announced', 'league_tee_off', 'league_card_confirmed',
      'league_marker_issue', 'league_ranking_updated', 'league_month_reminder', 'league_vote_opened']
      .forEach((type) => expect(renderNotification(type, base).icon).not.toBe('bell'));
  });

  test('event types link to the board', () => {
    ['league_card_announced', 'league_tee_off', 'league_card_confirmed',
      'league_ranking_updated', 'league_month_reminder', 'league_vote_opened']
      .forEach((type) => expect(notificationLink(type, base))
        .toEqual({ screen: 'LeagueBoard', params: { leagueId: 'L1' } }));
  });

  test('invite links to JoinLeague with the code', () => {
    expect(notificationLink('league_invite', { invite_code: 'ABC' }))
      .toEqual({ screen: 'JoinLeague', params: { code: 'ABC' } });
  });

  test('marker issue links to validate only with all ids, else the board', () => {
    expect(notificationLink('league_marker_issue', { league_id: 'L1', card_id: 'C1' }))
      .toEqual({ screen: 'LeagueBoard', params: { leagueId: 'L1' } });
    expect(notificationLink('league_marker_issue', {
      league_id: 'L1', card_id: 'C1', tournament_id: 'T1', round_id: 'R1',
    })).toEqual({
      screen: 'LeagueValidate',
      params: { leagueId: 'L1', cardId: 'C1', tournamentId: 'T1', roundId: 'R1' },
    });
  });
});
