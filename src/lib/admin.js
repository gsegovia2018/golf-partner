// App-level admins (course-geometry editor access). No admin role exists in
// the schema, so this is a hardcoded allowlist of auth user ids. Add the other
// friends' ids here to grant them the editor. Find an id in Supabase →
// Authentication → Users, or auth.users.id.
//
// MIRRORED IN SQL: public.is_geo_admin() (migration 20260728000007) enforces
// the same list in the golf_hole RLS write policy. This list only decides
// whether the editor UI renders; that one decides whether the write lands.
// Adding an admin here without adding them there gives them a button that
// fails to save.
export const ADMIN_USER_IDS = [
  '9a2d6444-2777-4ec7-af26-6c5605a31495', // guisegma@gmail.com (Guillermo)
  '785bafbe-c2fe-4733-affb-e3c199d3fafe', // noepecker@gmail.com (Noé)
  '7a9ec70d-4a4c-4509-bfbb-f1ba09120729', // mocander95@gmail.com (Marcos)
  '56d60230-64a6-4c9b-826e-6d91ee6e0843', // laertespecker@gmail.com (Marcos, 2nd account)
];

export function isAdminUser(userId) {
  return !!userId && ADMIN_USER_IDS.includes(userId);
}
