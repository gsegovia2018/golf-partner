// App-level admins (course-geometry editor access). No admin role exists in
// the schema, so this is a hardcoded allowlist of auth user ids. Add the other
// friends' ids here to grant them the editor. Find an id in Supabase →
// Authentication → Users, or auth.users.id.
export const ADMIN_USER_IDS = [
  '9a2d6444-2777-4ec7-af26-6c5605a31495', // guisegma@gmail.com (Guillermo)
  '785bafbe-c2fe-4733-affb-e3c199d3fafe', // noepecker@gmail.com (Noé)
  '7a9ec70d-4a4c-4509-bfbb-f1ba09120729', // mocander95@gmail.com (Marcos)
  '56d60230-64a6-4c9b-826e-6d91ee6e0843', // laertespecker@gmail.com (Marcos, 2nd account)
];

export function isAdminUser(userId) {
  return !!userId && ADMIN_USER_IDS.includes(userId);
}
