// send-push — invoked by a Supabase database webhook on every
// `notifications` INSERT. Looks up the recipient's Expo push tokens and
// delivers a push. Generic: a new notification type only needs a new entry
// in RENDERERS below.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isAuthorized } from './auth.ts';
import { chunk, staleTokensForChunk } from './push.ts';

// Expo's push API caps each request at 100 messages.
const EXPO_PUSH_CHUNK_SIZE = 100;

type NotificationRow = {
  user_id: string;
  type: string;
  data: Record<string, unknown> | null;
};

type DeepLink = { screen: string; params?: Record<string, unknown> };
type Rendered = { title: string; body: string; deepLink: DeepLink };

// type -> push title/body/deepLink. Mirrors src/lib/notificationContent.js
// (Deno cannot import React Native code). Unknown types are skipped.
const RENDERERS: Record<string, (d: Record<string, unknown>) => Rendered> = {
  friend_request: (d) => ({
    title: 'New friend request',
    body: `${d.actor_name ?? 'Someone'} wants to be your golf partner`,
    deepLink: { screen: 'Friends' },
  }),
  friend_accepted: (d) => ({
    title: 'Friend request accepted',
    body: `${d.actor_name ?? 'Someone'} accepted your friend request`,
    deepLink: { screen: 'Friends' },
  }),
  added_to_game: (d) => ({
    title: 'Added to a game',
    body: `You were added to ${d.tournament_name ?? 'a game'}`,
    // Nested form — 'Home' lives inside the 'Main' tab navigator; mirrors
    // notificationLink() in src/lib/notificationContent.js.
    deepLink: {
      screen: 'Main',
      params: { screen: 'Home', params: { openTournamentId: d.tournament_id } },
    },
  }),
  round_finished: (d) => ({
    title: 'Round finished',
    body: `${d.actor_name ?? 'A friend'} finished a round at `
      + `${d.course_name || d.tournament_name || 'the course'}`,
    deepLink: {
      screen: 'RoundSummary',
      params: { tournamentId: d.tournament_id, roundId: d.round_id },
    },
  }),
  feed_reaction: (d) => ({
    title: 'New reaction',
    body: `${d.actor_name ?? 'A friend'} reacted ${d.emoji || ''} to `
      + `${d.course_name || d.tournament_name || 'a round'}`,
    deepLink: {
      screen: 'RoundSummary',
      params: { tournamentId: d.tournament_id, roundId: d.round_id },
    },
  }),
  feed_comment: (d) => ({
    title: 'New comment',
    body: `${d.actor_name ?? 'A friend'} commented on `
      + `${d.course_name || d.tournament_name || 'a round'}`,
    deepLink: {
      screen: 'RoundSummary',
      params: { tournamentId: d.tournament_id, roundId: d.round_id },
    },
  }),
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// 'YYYY-MM-DD' (league month, first day) -> 'October'. '' when unparseable.
function monthName(month: unknown): string {
  const m = /^\d{4}-(\d{2})/.exec(String(month ?? ''));
  return (m && MONTHS[Number(m[1]) - 1]) || '';
}

// ' \u00b7 38 pts': the Stableford points the league ranks by; '' when the payload has none.
function pointsResult(points: unknown): string {
  const n = Number(points);
  if (points == null || points === '' || !Number.isFinite(n)) return '';
  return ` \u00b7 ${n} pts`;
}

const leagueBoard = (d: Record<string, unknown>): DeepLink => ({
  screen: 'LeagueBoard',
  params: { leagueId: d.league_id },
});

// 'October card at Golf Olivar' / 'card'. Mirrors notificationContent.js.
function cardPhrase(d: Record<string, unknown>): string {
  const month = monthName(d.month);
  return `${month ? `${month} ` : ''}card${d.course_name ? ` at ${d.course_name}` : ''}`;
}

// "Pablo's" — the card owner, as league_card_notice sends it.
function ownerPossessive(d: Record<string, unknown>): string {
  return d.owner_name ? `${d.owner_name}'s` : 'a';
}

// 'Sat 25 Oct, 09:00' (Europe/Madrid); '' when unparseable.
function teeTimeText(t: unknown): string {
  if (!t) return '';
  try {
    const date = new Date(String(t));
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    }).format(date);
  } catch (_e) {
    return '';
  }
}

// League types (plan 3.4). Copy and links mirror notificationContent.js.
Object.assign(RENDERERS, {
  league_invite: (d: Record<string, unknown>) => ({
    title: 'League invite',
    body: `${d.inviter_name ?? d.actor_name ?? 'A friend'} invited you to ${d.league_name ?? 'a league'}`,
    deepLink: { screen: 'JoinLeague', params: { code: d.invite_code } },
  }),
  league_card_announced: (d: Record<string, unknown>) => {
    const month = monthName(d.month);
    return {
      title: 'Card announced',
      body: `${d.actor_name ?? 'A friend'} will play their ${month ? `${month} ` : ''}card`
        + `${d.course_name ? ` at ${d.course_name}` : ''}`,
      deepLink: leagueBoard(d),
    };
  },
  league_tee_off: (d: Record<string, unknown>) => ({
    title: 'Teed off',
    body: `${d.actor_name ?? 'A friend'} teed off for their league card`
      + `${d.course_name ? ` \u00b7 ${d.course_name}` : ''}`,
    deepLink: leagueBoard(d),
  }),
  league_card_confirmed: (d: Record<string, unknown>) => {
    const month = monthName(d.month);
    // Mirrors notificationContent.js: the Stableford points the league ranks by.
    const result = pointsResult(d.points);
    return {
      title: 'Card confirmed',
      body: `${d.actor_name ?? 'A friend'}'s ${month ? `${month} ` : ''}card is confirmed${result}`,
      deepLink: leagueBoard(d),
    };
  },
  league_marker_issue: (d: Record<string, unknown>) => {
    const inApp = d.league_id && d.card_id && d.tournament_id && d.round_id;
    return {
      title: 'Marker sent your card back',
      body: d.note && d.tournament_id && d.round_id
        ? `${d.marker_name ?? d.actor_name ?? 'Your marker'}: ${d.note}`
        : `${d.marker_name ?? d.actor_name ?? 'Your marker'} flagged your card`
          + `${d.note ? `: ${d.note}` : ''}`,
      deepLink: inApp
        ? {
          screen: 'LeagueValidate',
          params: {
            leagueId: d.league_id,
            cardId: d.card_id,
            tournamentId: d.tournament_id,
            roundId: d.round_id,
            submitted: true,
          },
        }
        : leagueBoard(d),
    };
  },
  league_marker_request: (d: Record<string, unknown>) => {
    const month = monthName(d.month);
    return {
      title: `${d.actor_name ?? 'A friend'} asks you to confirm a card`,
      body: `${month ? `${month} ` : ''}card${d.course_name ? ` at ${d.course_name}` : ''}`
        + `${d.league_name ? ` in ${d.league_name}` : ''}`,
      deepLink: d.token
        ? { screen: 'LeagueMarkerConfirm', params: { token: d.token } }
        : { screen: 'Notifications' },
    };
  },
  league_marker_confirmed: (d: Record<string, unknown>) => {
    const month = monthName(d.month);
    return {
      title: `${d.actor_name ?? 'A friend'} confirmed your ${month ? `${month} ` : ''}card`,
      body: `It counts in ${d.league_name ?? 'your league'} now`,
      deepLink: leagueBoard(d),
    };
  },
  league_ranking_updated: (d: Record<string, unknown>) => {
    const month = monthName(d.month);
    return {
      title: 'Ranking updated',
      body: `${d.league_name ?? 'The league'} ${month ? `${month} ` : ''}ranking is in`,
      deepLink: leagueBoard(d),
    };
  },
  league_month_reminder: (d: Record<string, unknown>) => ({
    title: '3 days left',
    body: `You have no card yet in ${d.league_name ?? 'your league'} this month`,
    deepLink: leagueBoard(d),
  }),
  league_post_reminder: (d: Record<string, unknown>) => {
    let time = '';
    if (d.post_by) {
      try {
        const dateObj = new Date(String(d.post_by));
        if (!Number.isNaN(dateObj.getTime())) {
          time = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/Madrid',
            hour: '2-digit',
            minute: '2-digit',
          }).format(dateObj);
        }
      } catch (e) {
        // Unparseable — omit time
      }
    }
    const timeStr = time ? ` by ${time}` : '';
    const coursePhrase = d.course_name ? `your ${d.course_name} card` : 'your card';
    const league = d.league_name ?? 'your league';
    return {
      title: '2 hours left to post',
      body: `Post ${coursePhrase}${timeStr} or it won't count for ${league}`,
      deepLink: leagueBoard(d),
    };
  },
  league_vote_opened: (d: Record<string, unknown>) => ({
    title: 'Handicap vote',
    body: `Vote on ${d.subject_name ?? 'a member'}'s handicap`
      + `${d.old != null && d.proposed != null ? `, ${d.old} to ${d.proposed}` : ''}`,
    deepLink: leagueBoard(d),
  }),
  // 20261016000000 (league integrity).
  league_card_rescheduled: (d: Record<string, unknown>) => {
    const when = teeTimeText(d.tee_time);
    return {
      title: 'Card rescheduled',
      body: `${d.actor_name ?? 'A friend'} moved their ${cardPhrase(d)}${when ? ` to ${when}` : ''}`,
      deepLink: leagueBoard(d),
    };
  },
  league_card_withdrawn: (d: Record<string, unknown>) => ({
    title: 'Card withdrawn',
    body: `${d.actor_name ?? 'A friend'} withdrew their ${cardPhrase(d)}`,
    deepLink: leagueBoard(d),
  }),
  league_card_played_after_withdraw: (d: Record<string, unknown>) => ({
    title: 'Withdrawn card played',
    body: `${d.owner_name ?? 'A friend'} played their withdrawn ${cardPhrase(d)} after all: it uses their month`,
    deepLink: leagueBoard(d),
  }),
  league_role_changed: (d: Record<string, unknown>) => ({
    title: d.role === 'admin' ? 'New league admin' : 'League admin stepped down',
    body: d.role === 'admin'
      ? `${d.actor_name ?? 'An admin'} made ${d.subject_name ?? 'a member'} an admin of ${d.league_name ?? 'the league'}`
      : `${d.subject_name ?? 'A member'} is no longer an admin of ${d.league_name ?? 'the league'}`,
    deepLink: leagueBoard(d),
  }),
  league_card_auto_withdrawn: (d: Record<string, unknown>) => ({
    title: 'Card withdrawn',
    body: `Your ${cardPhrase(d)} was withdrawn: no shot was played within 24 hours of Start. `
      + 'You can play another one this month.',
    deepLink: leagueBoard(d),
  }),
  league_card_voided: (d: Record<string, unknown>) => ({
    title: 'Card voided',
    body: `${d.actor_name ?? 'An admin'} voided ${ownerPossessive(d)} ${cardPhrase(d)}`
      + `${d.reason ? `: ${d.reason}` : ''}`,
    deepLink: leagueBoard(d),
  }),
  league_card_reopened: (d: Record<string, unknown>) => ({
    title: 'Card reopened',
    body: `${d.actor_name ?? 'An admin'} reopened ${ownerPossessive(d)} ${cardPhrase(d)}: 8 hours to post it`,
    deepLink: leagueBoard(d),
  }),
  league_card_approved: (d: Record<string, unknown>) => ({
    title: 'Card approved',
    body: `${d.actor_name ?? 'An admin'} approved ${ownerPossessive(d)} ${cardPhrase(d)}`,
    deepLink: leagueBoard(d),
  }),
  league_handicap_changed: (d: Record<string, unknown>) => ({
    title: 'League handicap changed',
    body: `${d.actor_name ?? 'An admin'} set ${d.subject_name ?? 'a member'}'s league handicap`
      + `${d.old != null ? ` from ${d.old}` : ''}${d.new != null ? ` to ${d.new}` : ''}`,
    deepLink: leagueBoard(d),
  }),
  league_member_removed: (d: Record<string, unknown>) => (d.you
    ? {
      title: 'Removed from a league',
      body: `${d.actor_name ?? 'An admin'} removed you from ${d.league_name ?? 'the league'}`,
      deepLink: { screen: 'Notifications' },
    }
    : {
      title: 'Member removed',
      body: `${d.actor_name ?? 'An admin'} removed ${d.subject_name ?? 'a member'} from ${d.league_name ?? 'the league'}`,
      deepLink: leagueBoard(d),
    }),
  league_spot_claimed: (d: Record<string, unknown>) => ({
    title: 'Spot claimed',
    body: `${d.actor_name ?? 'Someone'} joined ${d.league_name ?? 'the league'} as ${d.spot_name ?? 'a reserved spot'}`,
    deepLink: leagueBoard(d),
  }),
  league_spot_released: (d: Record<string, unknown>) => (d.you
    ? {
      title: 'Spot released',
      body: `${d.actor_name ?? 'An admin'} released your spot in ${d.league_name ?? 'the league'}`,
      deepLink: { screen: 'Notifications' },
    }
    : {
      title: 'Spot released',
      body: `${d.actor_name ?? 'An admin'} released ${d.spot_name ? `the spot ${d.spot_name}` : 'a spot'}`
        + ` in ${d.league_name ?? 'the league'}`,
      deepLink: leagueBoard(d),
    }),
});

// Notification category per type — matches the three Settings toggles
// (profiles.settings.notifications.{scores,invites,media}). Absent key or
// absent settings = deliver (defaults are ON client-side too).
// League types all share the `league` category; their per-type push switch
// is read separately (see isLeaguePushMuted).
const CATEGORY_BY_TYPE: Record<string, 'scores' | 'invites' | 'media' | 'league'> = {
  friend_request: 'invites',
  friend_accepted: 'invites',
  added_to_game: 'invites',
  round_finished: 'scores',
  feed_reaction: 'media',
  feed_comment: 'media',
  league_invite: 'league',
  league_card_announced: 'league',
  league_tee_off: 'league',
  league_card_confirmed: 'league',
  league_marker_issue: 'league',
  league_marker_request: 'league',
  league_marker_confirmed: 'league',
  league_ranking_updated: 'league',
  league_month_reminder: 'league',
  league_post_reminder: 'league',
  league_vote_opened: 'league',
  league_card_rescheduled: 'league',
  league_card_withdrawn: 'league',
  league_card_auto_withdrawn: 'league',
  league_card_voided: 'league',
  league_card_reopened: 'league',
  league_card_approved: 'league',
  league_handicap_changed: 'league',
  league_member_removed: 'league',
  league_spot_claimed: 'league',
  league_spot_released: 'league',
  league_role_changed: 'league',
  league_card_played_after_withdraw: 'league',
};

// Types with no switch of their own follow a row's switch. Mirrors
// LEAGUE_PREF_OF in src/store/leagueNotificationPrefs.js.
const LEAGUE_PUSH_PREF_OF: Record<string, string> = {
  league_card_rescheduled: 'league_card_announced',
  league_card_withdrawn: 'league_card_announced',
  league_card_auto_withdrawn: 'league_post_reminder',
  league_card_reopened: 'league_card_voided',
  league_card_approved: 'league_card_voided',
  league_member_removed: 'league_spot_claimed',
  league_spot_released: 'league_spot_claimed',
  league_role_changed: 'league_spot_claimed',
  league_card_played_after_withdraw: 'league_card_announced',
};

type Settings = Record<string, Record<string, unknown>> | null | undefined;

// League push prefs: settings.notifications.league.push[<type>]. Same shape
// leagueNotificationPrefs.js writes. Only an explicit `false` mutes; unset is ON.
function isLeaguePushMuted(settings: Settings, type: string): boolean {
  const league = settings?.notifications?.league as
    { push?: Record<string, unknown> } | undefined;
  return league?.push?.[LEAGUE_PUSH_PREF_OF[type] ?? type] === false;
}

Deno.serve(async (req) => {
  try {
    // Require a shared secret matching PUSH_WEBHOOK_SECRET before doing
    // anything else. This endpoint uses the service-role key, so an
    // unauthenticated caller could otherwise push arbitrary
    // title/body/deepLink notifications to any user. Fails closed: if the
    // secret isn't configured, every request is rejected.
    const expectedSecret = Deno.env.get('PUSH_WEBHOOK_SECRET');
    if (!isAuthorized(req.headers, expectedSecret)) {
      return new Response('unauthorized', { status: 401 });
    }

    const payload = await req.json();
    const note: NotificationRow | undefined = payload?.record;
    if (!note) return new Response('no record', { status: 400 });

    const render = RENDERERS[note.type];
    if (!render) return new Response('ignored type', { status: 200 });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { title, body, deepLink } = render(note.data ?? {});

    const category = CATEGORY_BY_TYPE[note.type];
    if (category) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('settings')
        .eq('user_id', note.user_id)
        .maybeSingle();
      const settings = prof?.settings as Settings;
      const muted = category === 'league'
        ? isLeaguePushMuted(settings, note.type)
        : settings?.notifications?.[category] === false;
      if (muted) return new Response('muted', { status: 200 });
    }

    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', note.user_id);
    if (!tokens || tokens.length === 0) return new Response('no tokens', { status: 200 });

    const messages = tokens.map((t: { token: string }) => ({
      to: t.token,
      title,
      body,
      sound: 'default',
      data: deepLink,
    }));

    // Expo caps each push request at 100 messages, so chunk when a user has
    // registered more tokens than that. Each chunk's response is mapped back
    // to its OWN token slice locally (see staleTokensForChunk) — a malformed
    // or mis-sized response for one chunk can never corrupt another chunk's
    // token->receipt alignment.
    //
    // NOTE: pruning only inspects the synchronous send ticket, not the async
    // receipts endpoint, and only handles DeviceNotRegistered — out of scope
    // for this task, tracked as a follow-up.
    const messageChunks = chunk(messages, EXPO_PUSH_CHUNK_SIZE);
    const tokenChunks = chunk(tokens, EXPO_PUSH_CHUNK_SIZE);
    const stale: string[] = [];
    for (let c = 0; c < messageChunks.length; c++) {
      const expoResp = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageChunks[c]),
      });
      const result = await expoResp.json();
      const chunkTokens = tokenChunks[c];
      if (!Array.isArray(result?.data) || result.data.length !== chunkTokens.length) {
        // Can't trust positional mapping for this chunk — skip pruning it
        // rather than risk deleting a still-valid token.
        console.warn(
          `send-push: chunk ${c} receipt shape mismatch `
          + `(sent ${chunkTokens.length}, got ${Array.isArray(result?.data) ? result.data.length : 'non-array'}); skipping prune`,
        );
        continue;
      }
      stale.push(...staleTokensForChunk(chunkTokens, result.data));
    }
    if (stale.length > 0) {
      await supabase.from('push_tokens').delete().in('token', stale);
    }

    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error('send-push error', e);
    // Return 200 so the database webhook does not retry-storm on our errors.
    return new Response('error', { status: 200 });
  }
});
