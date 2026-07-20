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

// Notification category per type — matches the three Settings toggles
// (profiles.settings.notifications.{scores,invites,media}). Absent key or
// absent settings = deliver (defaults are ON client-side too).
const CATEGORY_BY_TYPE: Record<string, 'scores' | 'invites' | 'media'> = {
  friend_request: 'invites',
  friend_accepted: 'invites',
  added_to_game: 'invites',
  round_finished: 'scores',
  feed_reaction: 'media',
  feed_comment: 'media',
};

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
      const muted = (prof?.settings as Record<string, Record<string, boolean>> | null)
        ?.notifications?.[category] === false;
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
