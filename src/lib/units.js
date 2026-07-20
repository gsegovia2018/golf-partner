// Display-side unit conversion. Distances are STORED in meters everywhere;
// only rendering converts (Settings → Display → Units).
export const M_TO_YD = 1.09361;

export function formatDistance(meters, units) {
  if (meters == null || Number.isNaN(meters)) return '—';
  return String(Math.round(units === 'yards' ? meters * M_TO_YD : meters));
}

export function unitSuffix(units) { return units === 'yards' ? 'yd' : 'm'; }
export function unitWord(units) { return units === 'yards' ? 'yards' : 'metres'; }
