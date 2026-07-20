// Builds a self-contained Leaflet map page for the hole flyover / editor,
// hosted in an <iframe> (web) or WebView (native). Interactive pan/zoom over
// Esri World Imagery, with overlays computed and drawn in-page. Communicates
// with the host via postMessage:
//   host -> page:  { type:'player', pos:[lat,lng]|null }
//                  { type:'activeField', field:'front'|'center'|'back'|'tee' }
//   page -> host:  { type:'point', field, pos:[lat,lng] }   (edit taps)
//                  { type:'ready' }
//
// data: { mode:'view'|'edit', holeLabel, green, greenFront, greenCenter,
//         greenBack, tee, hazards:[{kind,poly}], player, activeField }

export function buildHoleMapHtml(data) {
  const json = JSON.stringify(data);
  return `<!doctype html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate-src.js"></script>
<style>
  html,body{margin:0;height:100%;background:#0a0d10;font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif}
  #map{position:absolute;inset:0}
  .hud{position:absolute;inset:0;pointer-events:none;z-index:500}
  .big{position:absolute;top:12px;right:14px;text-align:right;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.8)}
  .big .n{font-size:40px;font-weight:800;line-height:.9;font-variant-numeric:tabular-nums}
  .big .u{font-size:13px;font-weight:600}
  .big .l{font-size:10px;font-weight:700;letter-spacing:.1em;color:#cfe;text-transform:uppercase}
  .card{position:absolute;left:0;display:flex;align-items:baseline;gap:4px;background:rgba(14,22,28,.85);color:#fff;padding:6px 13px;border-top-right-radius:11px;border-bottom-right-radius:11px}
  .card .n{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums}
  .card .u{font-size:11px;color:#9fb0a4;font-weight:600}
  .front{top:42%}.back{top:55%}
  .hint{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);background:rgba(14,22,28,.85);color:#fff;font-weight:600;font-size:13px;padding:7px 14px;border-radius:999px}
  .dchip{background:rgba(14,22,28,.88);color:#fff;font-weight:800;font-size:13px;padding:4px 11px;border-radius:999px;font-variant-numeric:tabular-nums;white-space:nowrap;border:1px solid rgba(255,255,255,.25);transform:translate(-50%,-50%);display:inline-block}
  .leaflet-container{background:#0a0d10}
</style></head>
<body>
<div id="map"></div>
<div class="hud" id="hud"></div>
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
const map = L.map('map', { zoomControl: true, zoomSnap: 0.25, attributionControl: false, rotate: true, touchRotate: false, bearing: 0, center: [40.45, -3.75], zoom: 15 });
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19 }).addTo(map);

let hole = DATA;
let player = DATA.player || null;
let anchor = DATA.anchor || { pos: null, source: null, playerDistance: null };
let activeField = DATA.activeField || 'center';
const layers = [];
const clear = () => { layers.forEach(l => map.removeLayer(l)); layers.length = 0; };
const add = (l) => { layers.push(l.addTo(map)); return l; };

// green front/center/back points, from explicit fields or the polygon.
function fcb() {
  const c = hole.greenCenter || (hole.green ? centroid(hole.green) : null);
  let f = hole.greenFront || null, b = hole.greenBack || null;
  const src = (anchor && valid(anchor.pos)) ? anchor.pos : (valid(target) ? target : null);
  if ((!f || !b) && hole.green && src) {
    let nf = null, nb = null, best = 1e18, worst = -1;
    for (const v of hole.green) { const d = dist(src, v); if (d < best){best=d; nf=v;} if (d > worst){worst=d; nb=v;} }
    f = f || nf; b = b || nb;
  }
  return { f, c, b };
}
function centroid(poly){let a=0,b=0;for(const p of poly){a+=p[0];b+=p[1];}return [a/poly.length,b/poly.length];}

const onCourse = () => anchor && anchor.source === 'gps';

let target = null; // draggable aim / measure marker latlng

function draw() {
  clear();
  const g = fcb();
  // green shape / hazards drawn as context in both modes
  if (hole.green && !(hole.greenFront || hole.greenBack)) add(L.polygon(hole.green, { color:'#eafff0', weight:2, fillColor:'#57ae5b', fillOpacity:.25 }));
  (hole.hazards||[]).forEach(h => add(L.polygon(h.poly, { color: h.kind==='water'?'#4a9fe0':'#c7b581', weight:1, fillColor: h.kind==='water'?'#4a9fe0':'#e6d7a8', fillOpacity:.35 })));

  if (hole.mode === 'edit') { drawEdit(); return; }

  if (g.f) add(L.circleMarker(g.f, { radius:6, color:'#fff', weight:2, fillColor:'#ffd166', fillOpacity:1 }));
  if (g.b) add(L.circleMarker(g.b, { radius:6, color:'#fff', weight:2, fillColor:'#ef8a5b', fillOpacity:1 }));
  if (g.c) add(L.circleMarker(g.c, { radius:5, color:'#3f8f43', weight:2, fillColor:'#fff', fillOpacity:1 }));
  if (hole.tee) add(L.circleMarker(hole.tee, { radius:6, color:'#fff', weight:2, fillColor:'#2f6bff', fillOpacity:1 }));

  const from = valid(anchor.pos) ? anchor.pos : null;
  const cc = valid(g.c) ? g.c : [map.getCenter().lat, map.getCenter().lng];
  if (!valid(target)) target = from ? [(from[0]+cc[0])/2,(from[1]+cc[1])/2] : cc;
  if (onCourse()) add(L.circleMarker(from, { radius:8, color:'#fff', weight:3, fillColor:'#2f6bff', fillOpacity:1 }));
  const aim = add(L.marker(target, { draggable:true, icon: ringIcon(), zIndexOffset:1000 }));
  aim.on('drag', e => { target = [e.latlng.lat, e.latlng.lng]; redrawLines(from, g, cc); });
  map.off('click');
  map.on('click', (e) => { target = [e.latlng.lat, e.latlng.lng]; aim.setLatLng(e.latlng); redrawLines(from, g, cc); });
  redrawLines(from, g, cc);
  hud(from, g);
}

let lineLayers = [];
function chipMk(a, b, d){
  const mid = [(a[0]+b[0])/2, (a[1]+b[1])/2];
  return L.marker(mid, { interactive:false, icon: L.divIcon({ className:'', html:'<div class="dchip">'+round(d)+' m</div>', iconSize:[0,0] }) });
}
function redrawLines(from, g, cc){
  lineLayers.forEach(l=>map.removeLayer(l)); lineLayers=[];
  const mk=(l)=>{lineLayers.push(l.addTo(map));};
  if (from){
    mk(L.polyline([from,target],{color:'#fff',weight:4}));
    mk(chipMk(from, target, dist(from, target)));
    if(valid(cc)){ mk(L.polyline([target,cc],{color:'#fff',weight:3,dashArray:'3 8'})); mk(chipMk(target, cc, dist(target, cc))); }
  } else if (valid(cc)) {
    mk(L.polyline([target,cc],{color:'#fff',weight:3,dashArray:'3 8'}));
    mk(chipMk(target, cc, dist(target, cc)));
  }
}
function ringIcon(){ return L.divIcon({ className:'', html:'<div style="width:34px;height:34px;border:4px solid #fff;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.4)"></div>', iconSize:[34,34], iconAnchor:[17,17] }); }

function hud(from, g){
  const h = document.getElementById('hud');
  const src = from || target;
  const d = (p) => valid(p) && valid(src) ? dist(src, p) : null;
  const carry = valid(g.c) && valid(target) ? dist(target, g.c) : null;
  const layup = from && valid(target) ? dist(from, target) : null;
  h.innerHTML =
    '<div class="big"><span class="n">'+round(d(g.c))+'</span><span class="u"> m</span><div class="l">to green</div></div>'+
    '<div class="card front"><span class="n">'+round(d(g.f))+'</span><span class="u">front</span></div>'+
    '<div class="card back"><span class="n">'+round(d(g.b))+'</span><span class="u">back</span></div>'+
    (from
      ? '<div class="hint">Drag the ring or tap anywhere</div>'
      : '<div class="hint">Drag the ring to measure</div>');
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
  map.off('click');
  map.on('click', (e) => { post({ type:'point', field: activeField, pos:[e.latlng.lat, e.latlng.lng] }); });
}

// Initial view: tee at the bottom, green at the top, hole filling the
// viewport. fitBounds misframes under leaflet-rotate, so compute the view
// directly: rotate to the tee->green bearing, center the midpoint, zoom from
// hole length vs viewport height (~45% padding).
function initView(){
  const g = fcb();
  const c = valid(g.c) ? g.c : null;
  if (map.setBearing) map.setBearing(0);
  if (valid(hole.tee) && c) {
    const mid = [(hole.tee[0]+c[0])/2, (hole.tee[1]+c[1])/2];
    const len = Math.max(dist(hole.tee, c), 60);
    const hPx = Math.max(document.getElementById('map').clientHeight, 320);
    const mpp = (len * 1.45) / hPx;
    const zoom = Math.min(Math.log2(156543.03392 * Math.cos(mid[0]*Math.PI/180) / mpp), 19.5);
    if (map.setBearing) map.setBearing(bearing(hole.tee, c));
    map.setView(mid, zoom);
  } else if (onCourse() && c && valid(player)) {
    map.fitBounds(L.latLngBounds([player, c]).pad(0.3));
  } else if (c) {
    map.setView(c, 16);
  } else {
    map.setView([40.45, -3.75], 15);
  }
}

window.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  if (m.type === 'player') { player = m.pos; if (m.anchor) anchor = m.anchor; draw(); }
  if (m.type === 'activeField') { activeField = m.field; if (hole.mode==='edit') drawEdit(fcb()); }
  if (m.type === 'hole') { hole = m.hole; draw(); } // redraw markers, keep current pan/zoom
});

initView();
draw();
post({ type:'ready' });
</script>
</body></html>`;
}
