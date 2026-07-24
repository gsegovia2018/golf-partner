// Builds a self-contained Leaflet map page for the hole flyover / editor,
// hosted in an <iframe> (web) or WebView (native). Interactive pan/zoom over
// Esri World Imagery, with overlays computed and drawn in-page. Communicates
// with the host via postMessage:
//   host -> page:  { type:'player', pos:[lat,lng]|null }
//                  { type:'activeField', field:'front'|'center'|'back'|'tee' }
//   page -> host:  { type:'point', field, pos:[lat,lng] }   (edit taps)
//                  { type:'ready' }
//                  { type:'tile', z, x, y, id }               (tile request)
//   host -> page:  { type:'tile-data', id, dataUrl|null }     (tile answer)
//   page -> host:  { type:'aim', pos:[lat,lng], rings:[[lat,lng],...] }
//   host -> page:  { type:'set-targets', targets:[[lat,lng],...] } (replaces rings)
//
// data: { mode:'view'|'edit', holeLabel, green, greenFront, greenCenter,
//         greenBack, tee, hazards:[{kind,poly}], player, activeField }

import { LEAFLET_CSS, LEAFLET_JS, LEAFLET_ROTATE_JS } from './vendor/leafletBundle';

export function buildHoleMapHtml(data) {
  // Escape '<' so a course name containing "</script>" can't terminate the inline
  // script block (same-origin iframe on web); '<' inside a JSON string round-trips fine.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<style>${LEAFLET_CSS}</style>
<script>${LEAFLET_JS}</script>
<script>${LEAFLET_ROTATE_JS}</script>
<style>
  html,body{margin:0;height:100%;background:#0a0d10;font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif}
  #map{position:absolute;inset:0}
  .hud{position:absolute;inset:0;pointer-events:none;z-index:500}
  .tri{position:absolute;top:56px;right:12px;text-align:right;color:#fff;background:rgba(14,22,28,.72);border-radius:14px;padding:8px 13px 7px}
  .tri .row{display:flex;align-items:baseline;justify-content:flex-end;gap:6px}
  .tri .sm{font-size:16px;font-weight:800;font-variant-numeric:tabular-nums;color:#e8eef2}
  .tri .bign{font-size:40px;font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums}
  .tri .u{font-size:13px;font-weight:600;color:#9fb0a4}
  .tri .lbl{font-size:9px;font-weight:700;letter-spacing:.08em;color:#9fb0a4;text-transform:uppercase;width:34px;text-align:left}
  .tri .hole{border-bottom:1px solid rgba(255,255,255,.18);padding-bottom:5px;margin-bottom:5px}
  .tri .hole .lbl{color:#7f8f95}
  .lastbox{position:absolute;top:56px;left:12px;color:#fff;background:rgba(14,22,28,.72);border-radius:14px;padding:7px 12px 8px;min-width:78px}
  .lastbox.hide{display:none}
  .lastbox .ll{font-size:9px;font-weight:700;letter-spacing:.08em;color:#9fb0a4;text-transform:uppercase}
  .lastbox .ld{display:flex;align-items:baseline;gap:4px;margin-top:1px}
  .lastbox .bn{font-size:26px;font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums}
  .lastbox .u{font-size:12px;font-weight:600;color:#9fb0a4}
  .lastbox .lc{margin-top:5px;display:inline-flex;align-items:center;gap:5px;background:#57ae5b;color:#0a0d10;font-size:12px;font-weight:800;padding:2px 9px;border-radius:999px}
  .lastbox .lc svg{width:11px;height:11px}
  .hint{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);background:rgba(14,22,28,.85);color:#fff;font-weight:600;font-size:13px;padding:7px 14px;border-radius:999px}
  .dchip{background:rgba(14,22,28,.88);color:#fff;font-weight:800;font-size:13px;padding:4px 11px;border-radius:999px;font-variant-numeric:tabular-nums;white-space:nowrap;border:1px solid rgba(255,255,255,.25);transform:translate(-50%,-50%);display:inline-block}
  .shotpin{width:22px;height:22px;border-radius:50%;background:#f4c04a;border:2px solid #0a0d10;color:#0a0d10;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.5);font-variant-numeric:tabular-nums}
  #recenter{position:absolute;left:12px;bottom:14px;width:40px;height:40px;border-radius:999px;background:rgba(14,22,28,.85);border:1px solid rgba(255,255,255,.25);color:#fff;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;z-index:600;opacity:0;pointer-events:none;transform:scale(.9);transition:opacity .15s,transform .15s}
  #recenter.show{opacity:1;pointer-events:auto;transform:scale(1)}
  #recenter:active{background:rgba(14,22,28,.95)}
  @media (prefers-reduced-motion: reduce){#recenter{transition:none}}
  .leaflet-container{background:#0a0d10}
</style></head>
<body>
<div id="map"></div>
<div class="hud" id="hud"></div>
<div class="lastbox hide" id="lastbox"></div>
<button id="recenter" aria-label="Recenter hole"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></button>
<script>
const DATA = ${json};
const post = (m) => {
  const s = JSON.stringify(m);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else if (window.parent) window.parent.postMessage(s, '*');
};
const LL = (p) => L.latLng(p[0], p[1]);
const dist = (a, b) => LL(a).distanceTo(LL(b)); // metres
const round = (x) => (x == null || isNaN(x) ? '—' : Math.round(x));
const M2YD = 1.09361;
const U = DATA.units === 'yards' ? 'yd' : 'm';
const disp = (x) => round(x == null ? x : (DATA.units === 'yards' ? x * M2YD : x));

const valid = (p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]);
// compass bearing a->b in degrees (0=N, 90=E), for map rotation.
function bearing(a, b){
  const r = Math.PI/180, y = Math.sin((b[1]-a[1])*r)*Math.cos(b[0]*r);
  const x = Math.cos(a[0]*r)*Math.sin(b[0]*r) - Math.sin(a[0]*r)*Math.cos(b[0]*r)*Math.cos((b[1]-a[1])*r);
  return (Math.atan2(y, x)/r + 360) % 360;
}
// Seed a center/zoom at creation. leaflet-rotate's fitBounds path reads the
// map's pixel origin, which throws "Set map center and zoom first" if the map
// has no view yet — so initView's fitBounds crashed before any tiles/markers
// drew. A default view makes the map "loaded" so fitBounds works.
const map = L.map('map', { zoomControl: false, rotateControl: false, zoomSnap: 0.25, attributionControl: false, rotate: true, touchRotate: false, bearing: 0, center: [40.45, -3.75], zoom: 15 });
// Tiles come from the host (cache-first, offline-aware) over postMessage.
// A tile with no answer stays transparent — the vector layer shows through.
let tileSeq = 0;
const pendingTiles = {};
const BridgedTiles = L.GridLayer.extend({
  createTile: function (coords, done) {
    const img = document.createElement('img');
    img.alt = '';
    img.style.width = '100%';
    img.style.height = '100%';
    // Namespaced by holeKey so a stale tile-data answer from a prior page
    // instance (if one ever outlived a holeKey change) can't collide with an
    // id reused by this page — the pendingTiles lookup miss is a safe no-op.
    const id = DATA.holeKey + '#t' + (tileSeq++);
    pendingTiles[id] = (dataUrl) => {
      if (dataUrl) { img.onload = () => done(null, img); img.onerror = () => done(null, img); img.src = dataUrl; }
      else done(null, img);
    };
    post({ type:'tile', z: coords.z, x: coords.x, y: coords.y, id });
    return img;
  },
});
new BridgedTiles({ maxZoom: 20, maxNativeZoom: 19 }).addTo(map);

let hole = DATA;
let player = DATA.player || null;
let anchor = DATA.anchor || { pos: null, source: null, playerDistance: null };
let activeField = DATA.activeField || 'center';
let shots = DATA.shots || []; // logged shots for this hole: [{lat,lng,club}]
let lastShot = DATA.lastShot || null; // { meters, club } for the top-left card, or null to hide
const layers = [];
const clear = () => { layers.forEach(l => map.removeLayer(l)); layers.length = 0; };
const add = (l) => { layers.push(l.addTo(map)); return l; };

// green front/center/back points, from explicit fields or the polygon.
function fcb() {
  const c = hole.greenCenter || (hole.green ? centroid(hole.green) : null);
  let f = hole.greenFront || null, b = hole.greenBack || null;
  const src = (anchor && valid(anchor.pos)) ? anchor.pos : (valid(targets[0]) ? targets[0] : null);
  if ((!f || !b) && hole.green && src) {
    let nf = null, nb = null, best = 1e18, worst = -1;
    for (const v of hole.green) { const d = dist(src, v); if (d < best){best=d; nf=v;} if (d > worst){worst=d; nb=v;} }
    f = f || nf; b = b || nb;
  }
  return { f, c, b };
}
function centroid(poly){let a=0,b=0;for(const p of poly){a+=p[0];b+=p[1];}return [a/poly.length,b/poly.length];}

const onCourse = () => anchor && anchor.source === 'gps';

let targets = []; // draggable aim circles (1-2), each [lat,lng]
let targetLayers = [];

function draw() {
  clear();
  const g = fcb();
  // green shape / hazards drawn as context in both modes
  if (hole.green && !(hole.greenFront || hole.greenBack)) add(L.polygon(hole.green, { color:'#eafff0', weight:2, fillColor:'#57ae5b', fillOpacity:.25 }));
  (hole.hazards||[]).forEach(h => add(L.polygon(h.poly, { color: h.kind==='water'?'#4a9fe0':'#c7b581', weight:1, fillColor: h.kind==='water'?'#4a9fe0':'#e6d7a8', fillOpacity:.35 })));

  if (hole.mode === 'edit') { drawEdit(); return; }

  if (g.f) add(L.circleMarker(g.f, { radius:3.5, color:'#fff', weight:1.5, fillColor:'#ffd166', fillOpacity:1 }));
  if (g.b) add(L.circleMarker(g.b, { radius:3.5, color:'#fff', weight:1.5, fillColor:'#ef8a5b', fillOpacity:1 }));
  if (g.c) add(L.circleMarker(g.c, { radius:5, color:'#3f8f43', weight:2, fillColor:'#fff', fillOpacity:1 }));
  if (hole.tee) add(L.circleMarker(hole.tee, { radius:6, color:'#fff', weight:2, fillColor:'#2f6bff', fillOpacity:1 }));
  drawShots();

  const from = valid(anchor.pos) ? anchor.pos : null;
  const cc = valid(g.c) ? g.c : [map.getCenter().lat, map.getCenter().lng];
  if (!targets.length) targets = [from ? [(from[0]+cc[0])/2,(from[1]+cc[1])/2] : cc.slice()];
  if (onCourse()) add(L.circleMarker(from, { radius:8, color:'#fff', weight:3, fillColor:'#2f6bff', fillOpacity:1 }));
  map.off('click contextmenu mousedown mouseup movestart dragstart zoomstart');
  const addRing = (ll) => {
    if (targets.length >= 2) return; // two aim rings max
    targets.push([ll.lat, ll.lng]);
    drawTargets(from, g, cc);
  };
  // Long-press timing state. A held press that doesn't pan drops a second ring;
  // the click that ends it is swallowed so it doesn't also move a ring.
  let lpTimer = null, lpLatLng = null, lpFired = false;
  const clearLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
  map.on('click', (e) => {
    if (lpFired) { lpFired = false; return; } // this click ended a long-press
    const p = [e.latlng.lat, e.latlng.lng];
    const i = (targets.length > 1 && dist(p, targets[1]) < dist(p, targets[0])) ? 1 : 0;
    targets[i] = p;
    drawTargets(from, g, cc);
  });
  // Manual long-press (~450ms hold, no pan) adds the second ring. Leaflet fires
  // mousedown/up for touch too, and this works with a held mouse button — the
  // native long-press 'contextmenu' is unreliable inside the iframe/WebView.
  map.on('mousedown', (e) => {
    lpFired = false; lpLatLng = e.latlng; clearLp();
    lpTimer = setTimeout(() => { lpFired = true; addRing(lpLatLng); }, 450);
  });
  map.on('mouseup', clearLp);
  map.on('movestart dragstart zoomstart', clearLp);
  map.on('contextmenu', (e) => { if (e.originalEvent) L.DomEvent.preventDefault(e.originalEvent); addRing(e.latlng); }); // desktop right-click
  drawTargets(from, g, cc);
}

// Logged shots: numbered gold pins linked by a dashed trail, with the carry
// (straight-line distance) chipped at each segment's midpoint. Drawn inside
// draw() so they survive player/hole redraws. Landing pins are tappable and
// post a shot-tap to the host; the tee/origin pin is not.
function shotIcon(n){ return L.divIcon({ className:'', iconSize:[22,22], iconAnchor:[11,11], html:'<div class="shotpin">'+n+'</div>' }); }
function drawShots(){
  const list = shots || [];
  const pts = list.map(sh => [sh.lat, sh.lng]);
  const validPts = pts.filter(valid);
  if (!validPts.length) return;
  if (validPts.length > 1) add(L.polyline(validPts, { color:'#f4c04a', weight:2, opacity:.9, dashArray:'2 7' }));
  for (let i=0;i<list.length;i++){
    if (!valid(pts[i])) continue;
    const origin = i === 0 && !list[i].club; // the seeded tee carries no club
    const mk = L.marker(pts[i], { icon: shotIcon(i+1), interactive: !origin, draggable: !origin, zIndexOffset:500 });
    if (!origin) {
      mk.on('click', (e) => {
        L.DomEvent.stopPropagation(e);      // don't let the tap move the aim ring
        post({ type:'shot-tap', index:i });
      });
      mk.on('dragend', (e) => {
        const ll = e.target.getLatLng();
        post({ type:'shot-move', index:i, pos:[ll.lat, ll.lng] });
      });
    }
    add(mk);
  }
  for (let i=1;i<list.length;i++){
    if (!valid(pts[i-1]) || !valid(pts[i])) continue;
    const d = dist(pts[i-1], pts[i]);
    const mid = [(pts[i-1][0]+pts[i][0])/2, (pts[i-1][1]+pts[i][1])/2];
    add(L.marker(mid, { interactive:false, icon: L.divIcon({ className:'', html:'<div class="dchip">'+disp(d)+' '+U+'</div>', iconSize:[0,0] }) }));
  }
}

// Aim circles: recreated wholesale on any structural change (add/remove/tap);
// drag only updates the line layers underneath.
function drawTargets(from, g, cc){
  targetLayers.forEach(l=>map.removeLayer(l)); targetLayers=[];
  targets.forEach((p, i) => {
    const mk = L.marker(p, { draggable:true, icon: ringIcon(), zIndexOffset:1000 }).addTo(map);
    targetLayers.push(mk);
    mk.on('drag', e => { targets[i] = [e.latlng.lat, e.latlng.lng]; redrawLines(from, g, cc); });
    mk.on('contextmenu', () => {
      if (targets.length < 2) return; // keep at least one circle
      targets.splice(i, 1);
      drawTargets(from, g, cc);
    });
  });
  redrawLines(from, g, cc);
}

let lineLayers = [];
function chipMk(a, b, d){
  const mid = [(a[0]+b[0])/2, (a[1]+b[1])/2];
  return L.marker(mid, { interactive:false, icon: L.divIcon({ className:'', html:'<div class="dchip">'+disp(d)+' '+U+'</div>', iconSize:[0,0] }) });
}
function redrawLines(from, g, cc){
  lineLayers.forEach(l=>map.removeLayer(l)); lineLayers=[];
  const mk=(l)=>{lineLayers.push(l.addTo(map));};
  // Chain anchor -> circles -> green, circles ordered by distance from the
  // anchor (or, with no anchor, farthest-from-green first) so drop/drag
  // order never crosses the path.
  const pts = targets.filter(valid);
  if (from) pts.sort((a,b)=>dist(from,a)-dist(from,b));
  else if (valid(cc)) pts.sort((a,b)=>dist(cc,b)-dist(cc,a));
  const chain = from ? [from].concat(pts) : pts;
  for (let i=1;i<chain.length;i++){
    mk(L.polyline([chain[i-1],chain[i]],{color:'#fff',weight:4}));
    mk(chipMk(chain[i-1], chain[i], dist(chain[i-1],chain[i])));
  }
  if (valid(cc) && chain.length){
    const last = chain[chain.length-1];
    mk(L.polyline([last,cc],{color:'#fff',weight:3,dashArray:'3 8'}));
    mk(chipMk(last, cc, dist(last, cc)));
  }
  // HUD always measures from the aim ring nearest the green — refresh live.
  const aim = pts.length ? pts[pts.length-1] : null;
  hud(aim || from, g);
  // Report the ring(s) to the host so "Add shot" can drop the ball right here,
  // and a two-ring chain can be logged as a start->end segment.
  if (aim) post({ type:'aim', pos: aim, rings: pts.map(p => p.slice()) });
}
function ringIcon(){ return L.divIcon({ className:'', html:'<div style="width:34px;height:34px;border:4px solid #fff;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.4)"></div>', iconSize:[34,34], iconAnchor:[17,17] }); }

// Top-right F/C/B box. Measures from the aim ring nearest the green (src),
// so dragging the white ring live-updates the numbers. Falls back to the
// anchor/GPS only when no ring exists.
function hud(src, g){
  const h = document.getElementById('hud');
  const from = valid(src) ? src : (targets[targets.length-1] || anchor.pos);
  const d = (p) => valid(p) && valid(from) ? dist(from, p) : null;
  // Static hole yardage: tee to center of green, independent of the aim ring.
  const td = valid(hole.tee) && valid(g.c) ? dist(hole.tee, g.c) : null;
  h.innerHTML =
    '<div class="tri">'+
      '<div class="row hole"><span class="lbl">Tee</span><span class="sm">'+disp(td)+'</span><span class="u">'+U+'</span></div>'+
      '<div class="row"><span class="lbl">Back</span><span class="sm">'+disp(d(g.b))+'</span></div>'+
      '<div class="row"><span class="lbl"></span><span class="bign">'+disp(d(g.c))+'</span><span class="u">'+U+'</span></div>'+
      '<div class="row"><span class="lbl">Front</span><span class="sm">'+disp(d(g.f))+'</span></div>'+
    '</div>';
}

// Top-left card: distance from the last logged shot to the green, plus a club
// tip (dropped once the ball is on the green). Fed by the host via 'last-shot';
// null hides it. Kept out of hud()'s innerHTML rewrite so it's independent.
function renderLast(){
  const el = document.getElementById('lastbox');
  if (!el) return;
  if (hole.mode === 'edit' || !lastShot || !isFinite(lastShot.meters)) { el.className = 'lastbox hide'; return; }
  const club = lastShot.club
    ? '<div class="lc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V3l12 4-12 4"/></svg>'+lastShot.club+'</div>'
    : '';
  el.className = 'lastbox';
  el.innerHTML =
    '<div class="ll">Last shot &rarr; green</div>'+
    '<div class="ld"><span class="bn">'+disp(lastShot.meters)+'</span><span class="u">'+U+'</span></div>'+
    club;
}

function editIcon(color, label){
  return L.divIcon({ className:'', iconSize:[28,28], iconAnchor:[14,14],
    html:'<div style="width:28px;height:28px;border-radius:50%;border:3px solid #fff;background:'+color+';box-shadow:0 0 0 1px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:#0a0d10;font-weight:800;font-size:12px">'+label+'</div>' });
}
// Edit mode: draggable markers for each placed field (tap the map to place the
// active field, or drag an existing marker to nudge it). dragend posts the new
// position with drag:true so the host doesn't auto-advance the active field.
function drawEdit(){
  const fields = [
    { k:'front',  pt: hole.greenFront,  c:'#ffd166', t:'F' },
    { k:'center', pt: hole.greenCenter, c:'#57ae5b', t:'C' },
    { k:'back',   pt: hole.greenBack,   c:'#ef8a5b', t:'B' },
    { k:'tee',    pt: hole.tee,         c:'#2f6bff', t:'T' },
  ];
  fields.forEach((f) => {
    if (!valid(f.pt)) return;
    const mk = add(L.marker(f.pt, { draggable:true, icon: editIcon(f.c, f.t) }));
    mk.on('dragend', (e) => { const ll = e.target.getLatLng(); post({ type:'point', field:f.k, pos:[ll.lat, ll.lng], drag:true }); });
  });
  document.getElementById('hud').innerHTML = '<div class="hint">Tap to set '+activeField.toUpperCase()+' · drag any marker to nudge</div>';
  map.off('click contextmenu');
  map.on('click', (e) => { post({ type:'point', field: activeField, pos:[e.latlng.lat, e.latlng.lng] }); });
}

// Initial view: tee at the bottom, green at the top, hole filling the
// viewport. fitBounds misframes under leaflet-rotate, so compute the view
// directly: rotate to the tee->green bearing, center the midpoint, zoom from
// hole length vs viewport height (~20% padding).
function initView(){
  const g = fcb();
  const c = valid(g.c) ? g.c : null;
  const top = valid(g.b) ? g.b : c; // frame to the back of the green so the whole green fits
  if (map.setBearing) map.setBearing(0);
  if (valid(hole.tee) && top) {
    const mid = [(hole.tee[0]+top[0])/2, (hole.tee[1]+top[1])/2];
    const len = Math.max(dist(hole.tee, top), 60);
    const hPx = Math.max(document.getElementById('map').clientHeight, 320);
    const mpp = (len * 1.2) / hPx;
    const zoom = Math.min(Math.log2(156543.03392 * Math.cos(mid[0]*Math.PI/180) / mpp), 19.5);
    // leaflet-rotate rotates content clockwise by the given degrees, so screen-up = -bearing; negate to point tee→green up.
    if (map.setBearing) map.setBearing(-bearing(hole.tee, top));
    map.setView(mid, zoom, { animate:false });
  } else if (onCourse() && c && valid(player)) {
    map.fitBounds(L.latLngBounds([player, c]).pad(0.3), { animate:false });
  } else if (c) {
    map.setView(c, 16, { animate:false });
  } else {
    map.setView([40.45, -3.75], 15, { animate:false });
  }
  // animate:false above makes the view synchronous, so this captures the real framing.
  homeView = { center: map.getCenter(), zoom: map.getZoom() };
  updateRecenter();
}

// Recenter control: hidden until the view diverges from initView's framing
// (bearing can't change — no touch rotate, no rotate control), tap flies home.
let homeView = null;
function viewDiverged(){
  if (!homeView) return false;
  return Math.abs(map.getZoom() - homeView.zoom) > 0.2
    || map.getCenter().distanceTo(homeView.center) > 15;
}
function updateRecenter(){
  document.getElementById('recenter').classList.toggle('show', hole.mode !== 'edit' && viewDiverged());
}
map.on('moveend zoomend', updateRecenter);
document.getElementById('recenter').addEventListener('click', () => {
  if (homeView) map.flyTo(homeView.center, homeView.zoom, { duration: 0.5 });
});

window.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  if (m.type === 'player') { player = m.pos; if (m.anchor) anchor = m.anchor; draw(); }
  if (m.type === 'activeField') { activeField = m.field; if (hole.mode==='edit') drawEdit(fcb()); }
  if (m.type === 'hole') { hole = m.hole; draw(); } // redraw markers, keep current pan/zoom
  if (m.type === 'shots') { shots = m.shots || []; draw(); }
  if (m.type === 'last-shot') { lastShot = m.lastShot || null; renderLast(); }
  // host -> page: { type:'set-targets', targets:[[lat,lng],...] } replaces the
  // aim rings wholesale (e.g. collapsing to the landing after a shot is logged).
  if (m.type === 'set-targets') {
    targets = (m.targets || []).filter(valid);
    draw();
  }
  if (m.type === 'tile-data') {
    const cb = pendingTiles[m.id];
    delete pendingTiles[m.id];
    if (cb) cb(m.dataUrl || null);
  }
});

initView();
draw();
renderLast();
post({ type:'ready' });
</script>
</body></html>`;
}
