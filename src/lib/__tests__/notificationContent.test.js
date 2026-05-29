import { renderNotification, notificationLink } from '../notificationContent';

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

  test('added_to_game routes to Home with the tournament id', () => {
    expect(notificationLink('added_to_game', { tournament_id: 't1' }))
      .toEqual({ screen: 'Home', params: { openTournamentId: 't1' } });
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
