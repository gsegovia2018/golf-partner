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

  test('card confirmed speaks the Stableford points, whatever the net differential, with no pronouns', () => {
    const at = (extra) => renderNotification('league_card_confirmed', { ...base, month: '2026-10-01', ...extra }).body;
    expect(at({ points: 36 })).toBe("Pablo's October card is confirmed \u00b7 36 pts");
    expect(at({ points: 38, net_differential: -2.4 })).toBe("Pablo's October card is confirmed \u00b7 38 pts");
    expect(at({ points: '40', net_differential: null })).toBe("Pablo's October card is confirmed \u00b7 40 pts");
    expect(at({ points: null })).toBe("Pablo's October card is confirmed");
    expect(at({})).toBe("Pablo's October card is confirmed");
  });

  test('marker issue includes the note', () => {
    const r = renderNotification('league_marker_issue', { ...base, marker_name: 'Ana', note: 'hole 4' });
    expect(r.body).toBe('Ana flagged your card: hole 4');
  });

  test('marker issue sent in the app shows the actor and the note as the body', () => {
    const r = renderNotification('league_marker_issue', {
      ...base, actor_name: 'Javi', note: 'Hole 12: should be 5 (card says 4)', tournament_id: 'T1', round_id: 'R1',
    });
    expect(r.body).toBe('Javi: Hole 12: should be 5 (card says 4)');
  });

  test('marker request and confirmation copy', () => {
    const req = renderNotification('league_marker_request', {
      actor_name: 'Marcos', month: '2026-10-01', course_name: 'El Saler', league_name: 'Tour', token: 'tok',
    });
    expect(req).toMatchObject({ title: 'Marcos asks you to confirm a card', body: 'October card at El Saler in Tour' });
    const done = renderNotification('league_marker_confirmed', {
      actor_name: 'Javi', month: '2026-10-01', league_name: 'Tour',
    });
    expect(done).toMatchObject({ title: 'Javi confirmed your October card', body: 'It counts in Tour now' });
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

  test('post reminder formats the deadline time in local time', () => {
    const r = renderNotification('league_post_reminder', {
      ...base,
      course_name: 'Sotogrande',
      post_by: '2026-10-07T15:30:00Z',
    });
    expect(r.title).toBe('2 hours left to post');
    // Time should be formatted as HH:MM, parsed from ISO. The exact time depends on the
    // device's local timezone, so check that it is present and looks like a time.
    expect(r.body).toMatch(/Post your Sotogrande card by \d{2}:\d{2} or it won't count for Tour/);
  });

  test('post reminder survives missing time, course, and league', () => {
    const r = renderNotification('league_post_reminder', base);
    expect(r.title).toBe('2 hours left to post');
    expect(r.body).toBe("Post your card or it won't count for Tour");
  });

  test('post reminder uses course name and league name when provided', () => {
    const r = renderNotification('league_post_reminder', {
      ...base,
      course_name: 'La Moraleja',
      league_name: 'Mulligan League',
    });
    expect(r.body).toBe('Post your La Moraleja card or it won\'t count for Mulligan League');
  });

  test('invite names the league', () => {
    expect(renderNotification('league_invite', { ...base, inviter_name: 'Pablo' }).body)
      .toBe('Pablo invited you to Tour');
  });

  test('every league type has its own icon, not the fallback', () => {
    ['league_invite', 'league_card_announced', 'league_tee_off', 'league_card_confirmed',
      'league_marker_issue', 'league_ranking_updated', 'league_month_reminder', 'league_post_reminder', 'league_vote_opened']
      .forEach((type) => expect(renderNotification(type, base).icon).not.toBe('bell'));
  });

  test('event types link to the board', () => {
    ['league_card_announced', 'league_tee_off', 'league_card_confirmed',
      'league_ranking_updated', 'league_month_reminder', 'league_post_reminder', 'league_vote_opened']
      .forEach((type) => expect(notificationLink(type, base))
        .toEqual({ screen: 'LeagueBoard', params: { leagueId: 'L1' } }));
  });

  test('"Ranking updated" opens the board on that month\'s "is final" banner', () => {
    expect(notificationLink('league_ranking_updated', { league_id: 'L1', month: '2026-09-01' }))
      .toEqual({ screen: 'LeagueBoard', params: { leagueId: 'L1', finalMonth: '2026-09' } });
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
      params: { leagueId: 'L1', cardId: 'C1', tournamentId: 'T1', roundId: 'R1', submitted: true },
    });
  });

  test('marker request opens the confirm screen with its token; confirmed goes to the board', () => {
    expect(notificationLink('league_marker_request', { token: 'tok', league_id: 'L1' }))
      .toEqual({ screen: 'LeagueMarkerConfirm', params: { token: 'tok' } });
    expect(notificationLink('league_marker_request', { league_id: 'L1' })).toEqual({ screen: 'Notifications' });
    expect(notificationLink('league_marker_confirmed', { league_id: 'L1', card_id: 'C1' }))
      .toEqual({ screen: 'LeagueBoard', params: { leagueId: 'L1' } });
  });
});

describe('league integrity notifications (20261016000000)', () => {
  const card = {
    league_id: 'L1', league_name: 'Mulligan', actor_name: 'Ana', owner_name: 'Pablo',
    month: '2026-10-01', course_name: 'Golf Olivar',
  };

  test('card actions name the actor, the owner and the card', () => {
    expect(renderNotification('league_card_withdrawn', { ...card, actor_name: 'Pablo' }).body)
      .toBe('Pablo withdrew their October card at Golf Olivar');
    expect(renderNotification('league_card_voided', { ...card, reason: 'Wrong tee' }).body)
      .toBe("Ana voided Pablo's October card at Golf Olivar: Wrong tee");
    expect(renderNotification('league_card_reopened', card).body)
      .toBe("Ana reopened Pablo's October card at Golf Olivar: 8 hours to post it");
    expect(renderNotification('league_card_approved', card).body)
      .toBe("Ana approved Pablo's October card at Golf Olivar");
    expect(renderNotification('league_card_auto_withdrawn', card).body)
      .toMatch(/^Your October card at Golf Olivar was withdrawn: no shot was played within 24 hours of Start/);
  });

  test('a reschedule says when, in Madrid time', () => {
    const r = renderNotification('league_card_rescheduled', { ...card, actor_name: 'Pablo', tee_time: '2026-10-24T07:00:00Z' });
    expect(r.title).toBe('Card rescheduled');
    expect(r.body).toMatch(/^Pablo moved their October card at Golf Olivar to Sat 24 Oct.*09:00$/);
    expect(renderNotification('league_card_rescheduled', { ...card, actor_name: 'Pablo' }).body)
      .toBe('Pablo moved their October card at Golf Olivar');
  });

  test('handicap and membership changes', () => {
    expect(renderNotification('league_handicap_changed', { ...card, subject_name: 'Pablo', old: 18, new: 16 }).body)
      .toBe("Ana set Pablo's league handicap from 18 to 16");
    expect(renderNotification('league_member_removed', { ...card, subject_name: 'Pablo' }).body)
      .toBe('Ana removed Pablo from Mulligan');
    expect(renderNotification('league_member_removed', { ...card, you: true }).body)
      .toBe('Ana removed you from Mulligan');
    expect(renderNotification('league_spot_claimed', { ...card, actor_name: 'Kiko', spot_name: 'Kiko G.' }).body)
      .toBe('Kiko joined Mulligan as Kiko G.');
    expect(renderNotification('league_spot_released', { ...card, spot_name: 'Kiko G.' }).body)
      .toBe('Ana released the spot Kiko G. in Mulligan');
    expect(renderNotification('league_spot_released', { ...card, you: true }).body)
      .toBe('Ana released your spot in Mulligan');
  });

  test('a withdrawn card played anyway, and role changes', () => {
    expect(renderNotification('league_card_played_after_withdraw', card).body)
      .toBe('Pablo played their withdrawn October card at Golf Olivar after all: it uses their month');
    expect(renderNotification('league_role_changed', { ...card, subject_name: 'Gil', role: 'admin' }).body)
      .toBe('Ana made Gil an admin of Mulligan');
    expect(renderNotification('league_role_changed', { ...card, subject_name: 'Gil', role: 'member' }).body)
      .toBe('Gil is no longer an admin of Mulligan');
  });

  const types = ['league_card_rescheduled', 'league_card_withdrawn', 'league_card_auto_withdrawn',
    'league_card_voided', 'league_card_reopened', 'league_card_approved', 'league_handicap_changed',
    'league_member_removed', 'league_spot_claimed', 'league_spot_released',
    'league_role_changed', 'league_card_played_after_withdraw'];

  test('each has its own icon and opens the board; the removed member goes to the inbox', () => {
    types.forEach((type) => {
      expect(renderNotification(type, card).icon).not.toBe('bell');
      expect(notificationLink(type, card)).toEqual({ screen: 'LeagueBoard', params: { leagueId: 'L1' } });
    });
    expect(notificationLink('league_member_removed', { ...card, you: true })).toEqual({ screen: 'Notifications' });
    expect(notificationLink('league_spot_released', { ...card, you: true })).toEqual({ screen: 'Notifications' });
  });

  test('send-push renders the same types', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../../supabase/functions/send-push/index.ts'), 'utf8');
    types.forEach((type) => {
      expect(src).toContain(`  ${type}: (d: Record<string, unknown>) =>`);
      expect(src).toContain(`  ${type}: 'league',`);
    });
  });
});
