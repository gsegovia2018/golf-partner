// send-push — invoked by a Supabase database webhook on every
// `notifications` INSERT. Looks up the recipient's Expo push tokens and
// delivers a push. Generic: a new notification type only needs a new entry
// in RENDERERS below.
import { createClient } from 'jsr:@supabase/supabase-js@2';

type NotificationRow = {
  user_id: string;
  type: string;
  data: Record<string, unknown> | null;
};

// type -> push title/body. Unknown types are skipped (the in-app row still
// exists, it just gets no push).
const RENDERERS: Record<string, (d: Record<string, unknown>) => { title: string; body: string }> = {
  friend_request: (d) => ({
    title: 'New friend request',
    body: `${d.actor_name ?? 'Someone'} wants to be your golf partner`,
  }),
  friend_accepted: (d) => ({
    title: 'Friend request accepted',
    body: `${d.actor_name ?? 'Someone'} accepted your friend request`,
  }),
};

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const note: NotificationRow | undefined = payload?.record;
    if (!note) return new Response('no record', { status: 400 });

    const render = RENDERERS[note.type];
    if (!render) return new Response('ignored type', { status: 200 });
    const { title, body } = render(note.data ?? {});

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

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
      data: { screen: 'Friends' },
    }));

    const expoResp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    const result = await expoResp.json();

    // Prune tokens Expo reports as no longer registered.
    const receipts = Array.isArray(result?.data) ? result.data : [];
    const stale: string[] = [];
    receipts.forEach((r: { status?: string; details?: { error?: string } }, i: number) => {
      if (r?.status === 'error' && r?.details?.error === 'DeviceNotRegistered') {
        stale.push(tokens[i].token);
      }
    });
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
