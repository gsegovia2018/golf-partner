// send-push — invoked by a Supabase database webhook on every
// `notifications` INSERT. Looks up the recipient's Expo push tokens and
// delivers a push in the recipient's language (profiles.locale; NULL ->
// English). A new notification type needs a DEEP_LINKS entry below and its
// copy in renderPushText (../_shared/notificationRender.js).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isAuthorized } from './auth.ts';
import { chunk, staleTokensForChunk } from './push.ts';
import { renderPushText } from '../_shared/notificationRender.js';

// Expo's push API caps each request at 100 messages.
const EXPO_PUSH_CHUNK_SIZE = 100;

type NotificationRow = {
  user_id: string;
  type: string;
  data: Record<string, unknown> | null;
};

type DeepLink = { screen: string; params?: Record<string, unknown> };
type Data = Record<string, unknown>;

const leagueBoard = (d: Data): DeepLink => ({
  screen: 'LeagueBoard',
  params: { leagueId: d.league_id },
});

// type -> the push's deep link (the message's `data`). Mirrors
// notificationLink() in src/lib/notificationContent.js (Deno cannot import
// React Native code). Unknown types are skipped. Title and body come from
// renderPushText (../_shared/notificationRender.js), in the recipient's
// language.
const DEEP_LINKS: Record<string, (d: Data) => DeepLink> = {
  friend_request: () => ({ screen: 'Friends' }),
  friend_accepted: () => ({ screen: 'Friends' }),
  // Nested form — 'Home' lives inside the 'Main' tab navigator.
  added_to_game: (d) => ({
    screen: 'Main',
    params: { screen: 'Home', params: { openTournamentId: d.tournament_id } },
  }),
  round_finished: (d) => ({
    screen: 'RoundSummary',
    params: { tournamentId: d.tournament_id, roundId: d.round_id },
  }),
  feed_reaction: (d) => ({
    screen: 'RoundSummary',
    params: { tournamentId: d.tournament_id, roundId: d.round_id },
  }),
  feed_comment: (d) => ({
    screen: 'RoundSummary',
    params: { tournamentId: d.tournament_id, roundId: d.round_id },
  }),
  // League types (plan 3.4).
  league_invite: (d) => ({ screen: 'JoinLeague', params: { code: d.invite_code } }),
  league_card_announced: leagueBoard,
  league_tee_off: leagueBoard,
  league_card_confirmed: leagueBoard,
  league_marker_issue: (d) => (d.league_id && d.card_id && d.tournament_id && d.round_id
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
    : leagueBoard(d)),
  league_marker_request: (d) => (d.token
    ? { screen: 'LeagueMarkerConfirm', params: { token: d.token } }
    : { screen: 'Notifications' }),
  league_marker_confirmed: leagueBoard,
  league_ranking_updated: leagueBoard,
  league_month_reminder: leagueBoard,
  league_post_reminder: leagueBoard,
  league_vote_opened: leagueBoard,
  // 20261016000000 (league integrity).
  league_card_rescheduled: leagueBoard,
  league_card_withdrawn: leagueBoard,
  league_card_played_after_withdraw: leagueBoard,
  league_role_changed: leagueBoard,
  league_card_auto_withdrawn: leagueBoard,
  league_card_voided: leagueBoard,
  league_card_reopened: leagueBoard,
  league_card_approved: leagueBoard,
  league_handicap_changed: leagueBoard,
  league_member_removed: (d) => (d.you ? { screen: 'Notifications' } : leagueBoard(d)),
  league_spot_claimed: leagueBoard,
  league_spot_released: (d) => (d.you ? { screen: 'Notifications' } : leagueBoard(d)),
};

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

    const linkOf = DEEP_LINKS[note.type];
    if (!linkOf) return new Response('ignored type', { status: 200 });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // settings (mutes) + locale (language). If the locale column is missing
    // (function deployed before 20261019000000), read settings alone: a
    // failed read must never skip the mute check.
    let prof: { settings?: unknown; locale?: string | null } | null = null;
    {
      const res = await supabase
        .from('profiles')
        .select('settings, locale')
        .eq('user_id', note.user_id)
        .maybeSingle();
      prof = res.data;
      if (res.error) {
        const fallback = await supabase
          .from('profiles')
          .select('settings')
          .eq('user_id', note.user_id)
          .maybeSingle();
        prof = fallback.data;
      }
    }

    const category = CATEGORY_BY_TYPE[note.type];
    if (category) {
      const settings = prof?.settings as Settings;
      const muted = category === 'league'
        ? isLeaguePushMuted(settings, note.type)
        : settings?.notifications?.[category] === false;
      if (muted) return new Response('muted', { status: 200 });
    }

    const data = note.data ?? {};
    const text = renderPushText(note.type, data, prof?.locale ?? undefined);
    if (!text) return new Response('ignored type', { status: 200 });
    const { title, body } = text;
    const deepLink = linkOf(data);

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
