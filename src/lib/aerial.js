// Satellite basemap helpers for the hole flyover / geometry editor.
// A "frame" is a fixed green-centred bbox (so the image caches per hole) plus
// the Esri World Imagery export URL and a linear px<->latlng projection.
// Coordinates are [lat,lng]; pixel space is [x,y] with y down (north at top).

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export';

// center [lat,lng], halfMeters = half the frame height in metres. W/H = image
// pixel size; dLng is widened so pixels-per-metre match on both axes (no
// geographic distortion at this latitude).
export function holeFrame(center, halfMeters, W, H) {
  const [lat, lng] = center;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLat = halfMeters / 111320;
  const dLng = ((W / H) * dLat) / cos;
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
  const url = `${ESRI}?bbox=${bbox.join(',')}&bboxSR=4326&imageSR=4326&size=${W},${H}&format=jpg&f=image`;
  return { bbox, url, W, H };
}

export function projectToPx(frame, [lat, lng]) {
  const [x0, y0, x1, y1] = frame.bbox;
  return [((lng - x0) / (x1 - x0)) * frame.W, ((y1 - lat) / (y1 - y0)) * frame.H];
}

export function pxToLatLng(frame, [px, py]) {
  const [x0, y0, x1, y1] = frame.bbox;
  return [y1 - (py / frame.H) * (y1 - y0), x0 + (px / frame.W) * (x1 - x0)];
}
