// Pure rendering + routing for notifications. The send-push edge function
// (Deno) deliberately mirrors renderNotification — it cannot import React
// Native code, so the two are kept in sync by hand.

const FALLBACK_NAME = 'A friend';

// notification type + data -> { icon, title, body } for the in-app inbox.
// `icon` values are Feather icon names.
export function renderNotification(type, data = {}) {
  const actorName = data.actor_name || FALLBACK_NAME;
  switch (type) {
    case 'friend_request':
      return {
        icon: 'user-plus',
        title: 'New friend request',
        body: `${actorName} wants to be your golf partner`,
      };
    case 'friend_accepted':
      return {
        icon: 'user-check',
        title: 'Friend request accepted',
        body: `${actorName} accepted your friend request`,
      };
    case 'added_to_game':
      return {
        icon: 'flag',
        title: 'Added to a game',
        body: `You were added to ${data.tournament_name || 'a game'}`,
      };
    case 'round_finished':
      return {
        icon: 'check-circle',
        title: 'Round finished',
        body: `${actorName} finished a round at `
          + `${data.course_name || data.tournament_name || 'the course'}`,
      };
    case 'feed_reaction':
      return {
        icon: 'smile',
        title: 'New reaction',
        body: `${actorName} reacted ${data.emoji || ''} to `
          + `${data.course_name || data.tournament_name || 'a round'}`,
      };
    case 'feed_comment':
      return {
        icon: 'message-circle',
        title: 'New comment',
        body: `${actorName} commented on `
          + `${data.course_name || data.tournament_name || 'a round'}`,
      };
    default:
      return { icon: 'bell', title: 'Notification', body: '' };
  }
}

// notification type + data -> { screen, params? } for navigation. Used by
// both the inbox (row tap) and App.js (push tap).
export function notificationLink(type, data = {}) {
  switch (type) {
    case 'friend_request':
    case 'friend_accepted':
      return { screen: 'Friends' };
    case 'added_to_game':
      return { screen: 'Home', params: { openTournamentId: data.tournament_id } };
    case 'round_finished':
    case 'feed_reaction':
    case 'feed_comment':
      return {
        screen: 'RoundSummary',
        params: { tournamentId: data.tournament_id, roundId: data.round_id },
      };
    default:
      return { screen: 'Notifications' };
  }
}
