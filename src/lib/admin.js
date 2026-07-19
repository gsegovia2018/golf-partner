// App-level admins (course-geometry editor access). No admin role exists in
// the schema, so this is a hardcoded allowlist of auth user ids. Add the other
// friends' ids here to grant them the editor. Find an id in Supabase →
// Authentication → Users, or auth.users.id.
export const ADMIN_USER_IDS = [
  '9a2d6444-2777-4ec7-af26-6c5605a31495', // guisegma@gmail.com (Guillermo)
];

export function isAdminUser(userId) {
  return !!userId && ADMIN_USER_IDS.includes(userId);
}
