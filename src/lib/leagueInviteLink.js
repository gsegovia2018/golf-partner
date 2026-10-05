// The league invite code in a /league/CODE link — as an App Link URL
// (https://golf-partner.vercel.app/league/CODE) or a custom-scheme deep link
// (golf://league/CODE). Returns null for anything else, so App.js can tell a
// league invite apart from the tournament / official invite shapes it shares
// the signed-out gate with.

export function leagueCodeFromPath(pathname) {
  const m = /^\/league\/([^/?#]+)/.exec(pathname || '');
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

export function leagueCodeFromUrl(url) {
  if (!url) return null;
  const scheme = /^golf:\/\/league\/([^/?#]+)/i.exec(url);
  if (scheme) return leagueCodeFromPath(`/league/${scheme[1]}`);
  try {
    return leagueCodeFromPath(new URL(url).pathname);
  } catch {
    return null;
  }
}
