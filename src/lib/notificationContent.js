// Pure rendering + routing for notifications. The send-push edge function
// (Deno) deliberately mirrors renderNotification — it cannot import React
// Native code, so the two are kept in sync by hand.

const FALLBACK_NAME = 'A friend';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// 'YYYY-MM-DD' (league month, first day) -> 'October'. '' when unparseable.
function monthName(month) {
  const m = /^\d{4}-(\d{2})/.exec(String(month ?? ''));
  return (m && MONTHS[Number(m[1]) - 1]) || '';
}

// ' \u00b7 2.4 better than handicap' / ' \u00b7 level with handicap'; null means the
// card's tee has no rating, so it is not ranked. No pronouns: the wording
// holds for any member.
function netResult(netDifferential) {
  const n = Number(netDifferential);
  if (netDifferential == null || netDifferential === '' || !Number.isFinite(n)) return ' \u00b7 unrated tee, not ranked';
  const v = Math.round(n * 10) / 10;
  if (v === 0) return ' \u00b7 level with handicap';
  return ` \u00b7 ${Math.abs(v).toFixed(1)} ${v < 0 ? 'better' : 'worse'} than handicap`;
}

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
    case 'league_invite':
      return {
        icon: 'award',
        title: 'League invite',
        body: `${data.inviter_name || actorName} invited you to ${data.league_name || 'a league'}`,
      };
    case 'league_card_announced': {
      const month = monthName(data.month);
      return {
        icon: 'calendar',
        title: 'Card announced',
        body: `${actorName} will play their ${month ? `${month} ` : ''}card`
          + `${data.course_name ? ` at ${data.course_name}` : ''}`,
      };
    }
    case 'league_tee_off':
      return {
        icon: 'play-circle',
        title: 'Teed off',
        body: `${actorName} teed off for their league card`
          + `${data.course_name ? ` \u00b7 ${data.course_name}` : ''}`,
      };
    case 'league_card_confirmed': {
      const month = monthName(data.month);
      // The league ranks by net differential; older payloads only carry points.
      const result = data.net_differential !== undefined ? netResult(data.net_differential)
        : data.points != null ? `, ${data.points} pts` : '';
      return {
        icon: 'check-circle',
        title: 'Card confirmed',
        body: `${actorName}'s ${month ? `${month} ` : ''}card is confirmed${result}`,
      };
    }
    case 'league_marker_issue':
      return {
        icon: 'alert-circle',
        title: 'Marker sent your card back',
        body: `${data.marker_name || data.actor_name || 'Your marker'} flagged your card`
          + `${data.note ? `: ${data.note}` : ''}`,
      };
    case 'league_ranking_updated': {
      const month = monthName(data.month);
      return {
        icon: 'bar-chart-2',
        title: 'Ranking updated',
        body: `${data.league_name || 'The league'} ${month ? `${month} ` : ''}ranking is in`,
      };
    }
    case 'league_month_reminder':
      return {
        icon: 'clock',
        title: '3 days left',
        body: `You have no card yet in ${data.league_name || 'your league'} this month`,
      };
    case 'league_vote_opened':
      return {
        icon: 'check-square',
        title: 'Handicap vote',
        body: `Vote on ${data.subject_name || 'a member'}'s handicap`
          + `${data.old != null && data.proposed != null ? `, ${data.old} to ${data.proposed}` : ''}`,
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
      // 'Home' lives inside the 'Main' bottom-tab navigator, so the link
      // must use React Navigation's nested form — a bare navigate('Home')
      // from the root stack is silently dropped.
      return {
        screen: 'Main',
        params: { screen: 'Home', params: { openTournamentId: data.tournament_id } },
      };
    case 'round_finished':
    case 'feed_reaction':
    case 'feed_comment':
      return {
        screen: 'RoundSummary',
        params: { tournamentId: data.tournament_id, roundId: data.round_id },
      };
    case 'league_invite':
      return { screen: 'JoinLeague', params: { code: data.invite_code } };
    case 'league_marker_issue':
      if (data.league_id && data.card_id && data.tournament_id && data.round_id) {
        return {
          screen: 'LeagueValidate',
          params: {
            leagueId: data.league_id,
            cardId: data.card_id,
            tournamentId: data.tournament_id,
            roundId: data.round_id,
          },
        };
      }
      return { screen: 'LeagueBoard', params: { leagueId: data.league_id } };
    case 'league_card_announced':
    case 'league_tee_off':
    case 'league_card_confirmed':
    case 'league_ranking_updated':
    case 'league_month_reminder':
    case 'league_vote_opened':
      return { screen: 'LeagueBoard', params: { leagueId: data.league_id } };
    default:
      return { screen: 'Notifications' };
  }
}

// Older send-push deployments (and pushes already delivered before an app
// update) carry the bare `{ screen: 'Home' }` deep link, which the root
// navigator cannot resolve. Rewrite it to the nested Main → Home form;
// every other link passes through untouched.
export function normalizeDeepLink(link = {}) {
  if (link.screen === 'Home') {
    return { screen: 'Main', params: { screen: 'Home', params: link.params } };
  }
  return link;
}
