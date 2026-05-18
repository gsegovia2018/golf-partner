import { supabase } from '../lib/supabase';

// Client surface for the generic `notifications` table (see
// supabase/migrations/20260518000001_notifications.sql). Rows are written
// server-side by triggers; the client only reads them and marks them read.

async function currentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function rowToNotification(row) {
  return {
    id: row.id,
    type: row.type,
    actorId: row.actor_id ?? null,
    entityId: row.entity_id ?? null,
    data: row.data ?? {},
    readAt: row.read_at ?? null,
    createdAt: row.created_at,
  };
}

// Count of unread notifications for the current user — drives the in-app badge.
export async function unreadCount() {
  const me = await currentUserId();
  if (!me) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', me)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

// Recent notifications for the current user, newest first.
export async function listNotifications() {
  const me = await currentUserId();
  if (!me) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, actor_id, entity_id, data, read_at, created_at')
    .eq('user_id', me)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map(rowToNotification);
}

// Mark every unread notification as read — called when the user opens a
// screen that surfaces them (currently the Friends screen).
export async function markAllRead() {
  const me = await currentUserId();
  if (!me) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', me)
    .is('read_at', null);
  if (error) throw error;
}
