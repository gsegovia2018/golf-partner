let pendingPlayers = null;
let pendingCourses = null;

export function setPendingPlayers(players) { pendingPlayers = players; }
export function consumePendingPlayers() { const p = pendingPlayers; pendingPlayers = null; return p; }

export function setPendingCourses(data) { pendingCourses = data; }
export function consumePendingCourses() { const c = pendingCourses; pendingCourses = null; return c; }
