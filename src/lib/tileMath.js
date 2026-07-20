// Web-Mercator (OSM/Esri slippy-map) tile arithmetic — pure functions.

export function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

export function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z));
}

// Every {z,x,y} covering the bbox at each requested zoom, deduped.
export function tilesForBbox({ minLat, maxLat, minLng, maxLng }, zooms) {
  const seen = new Set();
  const out = [];
  for (const z of zooms) {
    const x0 = lonToTileX(minLng, z), x1 = lonToTileX(maxLng, z);
    const y0 = latToTileY(maxLat, z), y1 = latToTileY(minLat, z); // y grows southward
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        const k = `${z}/${x}/${y}`;
        if (!seen.has(k)) { seen.add(k); out.push({ z, x, y }); }
      }
    }
  }
  return out;
}

// Padded bbox around one hole's mapped features. padMeters converts via
// ~111320 m/deg latitude (longitude scaled by cos(lat)).
export function holeBbox({ tee, greenCenter, green, hazards }, padMeters = 80) {
  const pts = [];
  const push = (p) => { if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push(p); };
  push(tee); push(greenCenter);
  (green || []).forEach(push);
  (hazards || []).forEach((h) => (h.poly || []).forEach(push));
  if (!pts.length) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [la, ln] of pts) {
    minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la);
    minLng = Math.min(minLng, ln); maxLng = Math.max(maxLng, ln);
  }
  const dLat = padMeters / 111320;
  const dLng = padMeters / (111320 * Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180)));
  return { minLat: minLat - dLat, maxLat: maxLat + dLat, minLng: minLng - dLng, maxLng: maxLng + dLng };
}
