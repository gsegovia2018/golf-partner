import { cueFor, HOW_TO_MARK } from './checkpoints.js';
import { runChecks, CHECKPOINTS, CP_LABEL, STATUS_WORD, videoToView, viewToVideo, clampToVideo, fitRect } from './checks.js';

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS(tag === 'svg' || SVG_TAGS.has(tag) ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};
const SVG_TAGS = new Set(['line', 'rect', 'circle', 'text', 'g', 'path', 'polyline', 'clipPath']);
const clone = (o) => JSON.parse(JSON.stringify(o));
const r1 = (v) => Math.round(v * 10) / 10;
const PHASES = ['Setup', 'Backswing', 'Transition', 'Impact', 'Finish'];
const DOT = { green: 'g', yellow: 'y', red: 'r', unknown: 'u' };
const SEV = { red: 3, yellow: 2, green: 1, unknown: 0 };
const SHORT = { address: 'Addr', takeaway: 'Take', leadArm: 'Lead', top: 'Top', transition: 'Trans', shaftDown: 'Shaft', impact: 'Impact', shaftThrough: 'Thru', trailArm: 'Trail', finish: 'Finish' };
const DEFAULT_VIDEO = { w: 478, h: 850 };

const S = {
  clip: null, clips: [], auto: null, truth: null,
  cur: null, saved: null, initial: null, base: {},
  cpKey: 'impact', target: 'hands', undo: [], lastNudge: 0,
  video: null, videoAssumed: false, pose: null, handedness: 'right', heightCm: 176,
  imgOk: false, imgFor: null, drag: null, baseChecks: {}, last: null,
  view: 0, poseExtra: {}, poseBusy: new Set(), have: new Set(), pfTimer: null, filmFor: null,
};

// ---------- loading ----------
async function getJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function mergeState(auto, truth) {
  const cps = {};
  for (const k of CHECKPOINTS) {
    const a = auto?.checkpoints?.[k], t = truth?.checkpoints?.[k];
    if (!a && !t) continue;
    const m = { ...(a ? clone(a) : {}), ...(t ? clone(t) : {}) };
    if (t && 'head' in t) m.head = t.head;
    m.hands = m.hands || { x: 0, y: 0 };
    m.head = m.head && isFinite(m.head.x) ? m.head : null;
    m.hidden = !!m.hidden;
    if (m.hidden) m._head = null;
    cps[k] = m;
  }
  const ball = truth?.ball || auto?.ball || null;
  return { ball: ball ? { x: ball.x, y: ball.y } : null, cps };
}

function serialize() {
  const checkpoints = {};
  for (const k of CHECKPOINTS) {
    const c = S.cur.cps[k];
    if (!c) continue;
    checkpoints[k] = {
      frame: c.frame,
      hands: { x: r1(c.hands.x), y: r1(c.hands.y) },
      head: c.hidden || !c.head ? null : { x: r1(c.head.x), y: r1(c.head.y) },
      hidden: !!c.hidden,
      conf: 1,
    };
  }
  const o = {
    ...(S.truth ? { note: S.truth.note } : {}),
    clip: S.clip, source: 'manual', handedness: S.handedness, heightCm: S.heightCm,
    ball: S.cur.ball ? { x: r1(S.cur.ball.x), y: r1(S.cur.ball.y), conf: 1 } : null,
    checkpoints,
  };
  if (o.note === undefined) delete o.note;
  return o;
}
const isDirty = () => JSON.stringify(serialize()) !== S.initial;
const canSave = () => isDirty() || !S.truth;

async function loadClip(clip) {
  S.clip = clip;
  const base = `/out/${encodeURIComponent(clip)}`;
  // Prefer the D15 rules (detect.py --variant d15), then the fixed variant, then the plan as written.
  const [d15, fixed, plain, truth] = await Promise.all([getJson(`${base}/auto-d15.json`), getJson(`${base}/auto-fixed.json`), getJson(`${base}/auto.json`), getJson(`${base}/truth.json`)]);
  const auto = d15 || fixed || plain;
  S.auto = auto; S.truth = truth;
  if (!auto && !truth) return showEmpty(`No marks for ${clip}`, 'Neither auto.json nor truth.json exists in out/' + clip + '/. Run detect.py first.');
  $('empty').hidden = true; $('main').hidden = false;
  const src = truth || auto;
  S.handedness = truth?.handedness || auto?.handedness || 'right';
  S.heightCm = truth?.heightCm || auto?.heightCm || 176;
  S.pose = auto?.pose || truth?.pose || null;
  S.poseExtra = {}; S.poseBusy = new Set(); S.have = new Set(); S.filmFor = null;
  S.video = auto?.video || truth?.video || null;
  S.videoAssumed = !S.video;
  if (!S.video) S.video = { ...DEFAULT_VIDEO };
  const vf = S.clips.find((c) => c.clip === clip)?.videoFrames;
  if (!S.video.frames && vf) S.video = { ...S.video, frames: vf };
  $('film').replaceChildren();
  S.cur = mergeState(auto, truth);
  S.base = {};
  for (const k of CHECKPOINTS) { const c = (auto?.checkpoints?.[k]) || S.cur.cps[k]; if (c) S.base[k] = c.frame; }
  S.initial = JSON.stringify(serialize());
  S.undo = [];
  S.cpKey = S.cur.cps[S.cpKey] ? S.cpKey : Object.keys(S.cur.cps)[0] || 'address';
  S.target = 'hands';
  syncView();
  S.baseChecks = byId(runChecks(checkInput()).checks);
  const b = $('srcBadge');
  b.hidden = false;
  b.textContent = truth && auto ? 'TRUTH + AUTO' : truth ? 'TRUTH ONLY' : 'AUTO ONLY';
  void src;
  renderAll();
  for (const k of CHECKPOINTS) if (S.cur.cps[k]) ensurePose(S.cur.cps[k].frame);
  prefetchCoarse();
}

function showEmpty(title, body) {
  $('main').hidden = true;
  const e = $('empty'); e.hidden = false;
  e.replaceChildren(el('b', {}, title), document.createTextNode(body));
}

// ---------- helpers ----------
const byId = (checks) => Object.fromEntries(checks.map((c) => [c.id, c]));
const checkInput = () => ({
  checkpoints: S.cur.cps, ball: S.cur.ball, pose: allPose(), handedness: S.handedness, heightCm: S.heightCm, video: S.video,
});
const cp = () => S.cur.cps[S.cpKey];
const allPose = () => {
  const o = { ...(S.pose || {}) };
  for (const [k, v] of Object.entries(S.poseExtra)) if (v) o[k] = v;
  return o;
};
const poseAt = (f) => S.pose?.[f] || S.poseExtra[f] || null;
const frameUrl = (f) => `/out/${encodeURIComponent(S.clip)}/frames/${f}.jpg`;
const nFrames = () => Math.max(1, S.video?.frames || 1);
const syncView = () => { S.view = cp()?.frame ?? 0; };
const autoCp = () => S.auto?.checkpoints?.[S.cpKey] || null;

function pushUndo(coalesceKey) {
  const now = Date.now();
  if (coalesceKey && S.lastNudge && now - S.lastNudge < 700) { S.lastNudge = now; return; }
  S.undo.push(JSON.stringify(S.cur, (k, v) => (k === '_head' ? undefined : v)));
  if (S.undo.length > 300) S.undo.shift();
  S.lastNudge = coalesceKey ? now : 0;
}
function undo() {
  const s = S.undo.pop();
  if (!s) return;
  const prev = JSON.parse(s);
  for (const k of Object.keys(prev.cps)) { prev.cps[k]._head = S.cur.cps[k]?._head ?? null; }
  S.cur = prev;
  S.lastNudge = 0;
  syncView();
  renderAll();
  ensurePose(cp().frame);
}

// ---------- rendering ----------
function renderAll() {
  renderTimeline(); renderCue(); renderPanel(); renderScrubber(); renderImage(); renderOverlay(); renderChecks();
}

function renderTimeline() {
  const nav = $('timeline');
  const st = S.last ? primaryStatus(S.last.checks) : {};
  nav.replaceChildren(...CHECKPOINTS.filter((k) => S.cur.cps[k]).map((k) => {
    const b = el('button', { type: 'button', 'data-cp': k, 'aria-label': `${CP_LABEL[k]} checkpoint` });
    if (k === S.cpKey) b.setAttribute('aria-current', 'step');
    if (isEdited(k)) b.classList.add('edited');
    const s = el('span', { class: 'st' }); s.append(el('i', { class: 'sdot ' + (DOT[st[k]] || 'u') }));
    b.append(s, document.createTextNode(SHORT[k]));
    b.onclick = () => selectCp(k);
    return b;
  }));
  const c = cp();
  $('curLine').replaceChildren(el('span', {}, CP_LABEL[S.cpKey]), el('small', {}, `frame ${c.frame}`));
}
function primaryStatus(checks) {
  const out = {};
  for (const c of checks) {
    const k = c.cps[c.cps.length - 1];
    if (!out[k] || SEV[c.status] > SEV[out[k]]) out[k] = c.status;
  }
  return out;
}
function isEdited(k) {
  const a = S.auto?.checkpoints?.[k], c = S.cur.cps[k];
  if (!a) return false;
  const h = (x) => (x ? `${r1(x.x)},${r1(x.y)}` : '-');
  return a.frame !== c.frame || h(a.hands) !== h(c.hands) || h(c.hidden ? null : a.head) !== h(c.hidden ? null : c.head) || !!a.hidden !== !!c.hidden;
}

function renderPanel() {
  const c = cp();
  const isAddr = S.cpKey === 'address';
  if (S.target === 'ball' && !isAddr) S.target = 'hands';
  for (const b of $('targetSeg').children) {
    const t = b.dataset.t;
    b.setAttribute('aria-checked', String(t === S.target));
    b.disabled = t === 'ball' && !isAddr;
    b.title = t === 'ball' && !isAddr ? 'Ball is editable at Address only' : '';
  }
  const tgt = targetPt();
  $('coords').textContent = tgt ? `${S.target === 'head' ? 'Clubhead' : S.target === 'ball' ? 'Ball' : 'Hands'}  x ${r1(tgt.x)}  y ${r1(tgt.y)}` : S.target === 'head' && c.hidden ? 'Clubhead hidden' : 'Not placed: tap the image';
  const t = $('hiddenTgl');
  t.setAttribute('aria-checked', String(!!c.hidden));
  $('undoBtn').disabled = !S.undo.length;
  $('undoBtn').textContent = S.undo.length ? `Undo (${S.undo.length})` : 'Undo';
  $('resetBtn').disabled = !(S.auto ? autoCp() : S.truth?.checkpoints?.[S.cpKey]);
  $('resetBtn').textContent = S.auto ? 'Reset checkpoint to auto' : 'Reset checkpoint to saved';
  const sb = $('saveBtn');
  sb.disabled = !canSave();
  sb.classList.toggle('dirty', isDirty());
  sb.title = isDirty() ? 'Unsaved changes' : S.truth ? 'Nothing to save' : 'Save the current marks as truth.json';
}

function targetPt() {
  const c = cp();
  if (S.target === 'hands') return c.hands;
  if (S.target === 'head') return c.hidden ? null : c.head;
  return S.cur.ball;
}

function renderImage() {
  const img = $('stillImg');
  const frame = S.view;
  const url = frameUrl(frame);
  if (S.shownUrl === url) return;
  S.shownUrl = url;
  S.imgFor = frame; S.imgOk = false;
  img.onload = () => {
    if (S.imgFor !== frame) return;
    S.imgOk = true;
    if (S.videoAssumed && img.naturalWidth) { S.video = { w: img.naturalWidth, h: img.naturalHeight }; S.videoAssumed = false; }
    renderOverlay();
  };
  img.onerror = () => { if (S.imgFor === frame) { S.imgOk = false; renderOverlay(); } };
  img.style.visibility = 'hidden';
  img.onload = ((orig) => function () { img.style.visibility = ''; orig.call(this); })(img.onload);
  img.src = url;
}

const SKELETON = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];
function boxSize() { const r = $('stillBox').getBoundingClientRect(); return { cw: r.width, ch: r.height }; }

function renderOverlay() {
  if ($('main').hidden || !S.cur) return;
  const svg = $('overlay');
  const { cw, ch } = boxSize();
  const { w: vw, h: vh } = S.video;
  svg.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
  svg.setAttribute('tabindex', '0');
  const V = (p) => videoToView(p, cw, ch, vw, vh);
  const c = cp();
  const g = [];
  const add = (n) => g.push(n);
  const R = fitRect(cw, ch, vw, vh);

  if (!S.imgOk) {
    add(el('rect', { x: R.x, y: R.y, width: R.w, height: R.h, fill: '#2b3330', stroke: 'rgba(255,255,255,.25)', 'stroke-dasharray': '6 5' }));
    add(el('text', { x: cw / 2, y: R.y + 60, fill: 'rgba(255,255,255,.7)', 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700 }, `loading frame ${S.view}…`));
    if (S.videoAssumed) add(el('text', { x: cw / 2, y: R.y + 78, fill: 'rgba(255,255,255,.45)', 'text-anchor': 'middle', 'font-size': 11 }, `video size assumed ${vw}×${vh}`));
  }

  // pose skeleton
  const lm = poseAt(S.view);
  if (lm) {
    for (const [a, b] of SKELETON) {
      const A = lm[a], B = lm[b];
      if (!A || !B || A[2] < 0.3 || B[2] < 0.3) continue;
      const p = V({ x: A[0], y: A[1] }), q = V({ x: B[0], y: B[1] });
      add(el('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: 'rgba(120,230,190,.65)', 'stroke-width': 2, 'stroke-linecap': 'round' }));
    }
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const A = lm[i]; if (!A || A[2] < 0.3) continue;
      const p = V({ x: A[0], y: A[1] });
      add(el('circle', { cx: p.x, cy: p.y, r: 2.5, fill: 'rgba(120,230,190,.9)' }));
    }
  }

  // plane lines (from address)
  if (S.last?.planes) {
    add(el('clipPath', { id: 'vclip' })); g[g.length - 1].append(el('rect', { x: R.x, y: R.y, width: R.w, height: R.h }));
    const grp = el('g', { 'clip-path': 'url(#vclip)' }); add(grp);
    const add2 = (n) => grp.append(n);
    const line = (L, dash, label) => {
      if (!L) return;
      const a = L.a, b = L.b;
      const dy = b.y - a.y, dx = b.x - a.x;
      if (!dy) return;
      const t = (0 - a.y) / dy; // run the line up to the top of the frame
      const end = { x: a.x + dx * t, y: 0 };
      const p = V(a), q = V(end);
      add2(el('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: '#fff', 'stroke-opacity': .85, 'stroke-width': 1.75, ...(dash ? { 'stroke-dasharray': '7 5' } : {}) }));
      const tp = V({ x: a.x + dx * (t * 0.5), y: a.y + dy * t * 0.5 });
      add2(el('text', { x: tp.x + 5, y: tp.y + 10, fill: '#fff', 'fill-opacity': .8, 'font-size': 10, 'font-weight': 700 }, label));
    };
    line(S.last.planes.raw.shaft, false, 'shaft plane');
    line(S.last.planes.raw.shoulder, true, 'shoulder plane');
  }

  // ghost (auto) marks
  const a = autoCp();
  const ghostOn = a && a.frame === c.frame;
  const far = (p, q) => !p || !q || Math.hypot(p.x - q.x, p.y - q.y) > 0.5;
  const ghost = (p, kind) => {
    const v = V(p);
    const st = { fill: 'none', stroke: 'rgba(255,255,255,.45)', 'stroke-width': 1.5, 'stroke-dasharray': '2 3' };
    add(kind === 'sq' ? el('rect', { x: v.x - 7, y: v.y - 7, width: 14, height: 14, ...st }) : el('circle', { cx: v.x, cy: v.y, r: kind === 'ring' ? 9 : 8, ...st }));
  };
  if (ghostOn) {
    if (far(a.hands, c.hands)) { ghost(a.hands, 'sq'); }
    if (!a.hidden && a.head && !c.hidden && far(a.head, c.head)) ghost(a.head, 'circ');
    if (S.cpKey === 'address' && S.auto.ball && far(S.auto.ball, S.cur.ball)) ghost(S.auto.ball, 'ring');
  }
  if (S.view !== c.frame) add(el('text', { x: R.x + 8, y: R.y + 16, fill: '#ffd36b', 'font-size': 11, 'font-weight': 800 }, `Preview: ${CP_LABEL[S.cpKey]} is at frame ${c.frame}`));
  else if (!ghostOn && a) add(el('text', { x: R.x + 8, y: R.y + R.h - 8, fill: 'rgba(255,255,255,.6)', 'font-size': 10 }, `auto ghost hidden: frame moved (auto ${a.frame})`));

  // shaft segment hands -> head
  if (c.head && !c.hidden) {
    const p = V(c.hands), q = V(c.head);
    add(el('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: 'rgba(255,255,255,.55)', 'stroke-width': 1.5 }));
  }

  // current marks
  const sel = S.target;
  const halo = (v, on) => on && add(el('circle', { cx: v.x, cy: v.y, r: 22, fill: 'rgba(79,174,138,.12)', stroke: '#4fae8a', 'stroke-width': 1.25, 'stroke-dasharray': '3 3' }));
  if (S.cur.ball) {
    const v = V(S.cur.ball);
    halo(v, sel === 'ball' && S.cpKey === 'address');
    add(el('circle', { cx: v.x, cy: v.y, r: 9, fill: 'none', stroke: '#fff', 'stroke-width': 2 }));
    add(el('circle', { cx: v.x, cy: v.y, r: 10.5, fill: 'none', stroke: '#0a0d10', 'stroke-opacity': .6, 'stroke-width': 1 }));
  }
  if (c.head && !c.hidden) {
    const v = V(c.head);
    halo(v, sel === 'head');
    const est = (c.conf ?? 1) < 0.35 && a && !far(a.head, c.head);
    add(el('circle', { cx: v.x, cy: v.y, r: 8, fill: est ? 'none' : '#fff', stroke: est ? '#fff' : '#0a0d10', 'stroke-width': est ? 2 : 1.5, ...(est ? { 'stroke-dasharray': '3 2' } : {}) }));
    if (est) add(el('text', { x: v.x + 13, y: v.y + 4, fill: '#fff', 'font-size': 10, 'font-weight': 700 }, 'estimated'));
  } else if (c.hidden) {
    add(el('text', { x: R.x + R.w - 8, y: R.y + R.h - 8, 'text-anchor': 'end', fill: 'rgba(255,255,255,.75)', 'font-size': 11, 'font-weight': 700 }, 'Clubhead hidden'));
  }
  {
    const v = V(c.hands);
    halo(v, sel === 'hands');
    add(el('rect', { x: v.x - 7, y: v.y - 7, width: 14, height: 14, fill: '#fff', stroke: '#0a0d10', 'stroke-width': 1.5 }));
  }
  svg.replaceChildren(...g);
}

function renderChecks() {
  const res = runChecks(checkInput());
  S.last = res;
  const host = $('checks');
  const rows = [];
  for (const ph of PHASES) {
    const list = res.checks.filter((c) => c.phase === ph);
    if (!list.length) continue;
    rows.push(el('div', { class: 'phase' }, ph));
    for (const c of list) {
      const d = el('div', { class: 'chk' + (c.cps.includes(S.cpKey) ? ' sel' : '') });
      const prev = S.baseChecks[c.id];
      if (prev && (prev.status !== c.status || prev.value !== c.value)) d.classList.add('chg');
      const word = c.status === 'unknown' ? (c.reason === 'hidden' ? 'Hidden' : 'No data') : STATUS_WORD[c.status];
      const lbl = el('div', { class: 'lbl' }, c.label);
      lbl.append(el('small', {}, c.text));
      d.append(el('i', { class: 'sdot ' + DOT[c.status] }), lbl, el('span', { class: 'val' }, fmt(c)), el('span', { class: 'word' }, word));
      rows.push(d);
    }
  }
  host.replaceChildren(...rows);
  const m = res.main;
  const hero = $('mainCard');
  hero.replaceChildren(el('div', { class: 'ov' }, 'Main thing to fix'),
    el('h2', {}, m ? m.label : 'Nothing to fix yet'),
    el('p', {}, m ? 'Because: ' + m.evidence.map((id) => res.checks.find((c) => c.id === id).label.toLowerCase()).join(', ') : 'All measurable checks are good, or the data needed is missing.'));
  const sc = res.scale;
  $('scaleNote').textContent = `Scale ${(1 / sc.cmPerPx).toFixed(2)} px/cm from ${sc.source === 'leg' ? 'leg segments (pose)' : sc.source === 'given' ? 'a given scale' : `height ${S.heightCm} cm (approx., no pose)`}.`;
  // live chip: most severe known check for the current checkpoint
  const here = res.checks.filter((c) => c.cps.includes(S.cpKey) && c.status !== 'unknown').sort((a, b) => SEV[b.status] - SEV[a.status])[0];
  const chip = $('liveChip');
  if (here) {
    chip.hidden = false;
    chip.replaceChildren(el('i', { class: DOT[here.status] }), document.createTextNode(`${here.label}  ${fmt(here)}  ${STATUS_WORD[here.status]}`));
  } else chip.hidden = true;
  // timeline dots follow live results
  const st = primaryStatus(res.checks);
  for (const b of $('timeline').children) {
    const i = b.querySelector('.sdot');
    if (i) i.className = 'sdot ' + (DOT[st[b.dataset.cp]] || 'u');
  }
}
function fmt(c) {
  if (c.value == null) return '–';
  const sign = (c.unit === 'cm' || c.unit === '°') && c.value > 0 && ['hands_height_impact', 'hands_out_impact', 'shaft_angle_impact', 'butt_extension', 'clubhead_vs_plane', 'downswing_path'].includes(c.id) ? '+' : '';
  return c.unit === ':1' ? `${c.value}:1` : `${sign}${c.value}${c.unit === 'H' ? ' H' : ' ' + c.unit}`.replace(' °', '°');
}

// ---------- editing ----------
function selectCp(k) {
  if (!S.cur.cps[k]) return;
  S.cpKey = k; S.lastNudge = 0;
  syncView();
  renderAll();
}
function stepCp(d) {
  const keys = CHECKPOINTS.filter((k) => S.cur.cps[k]);
  const i = keys.indexOf(S.cpKey);
  selectCp(keys[Math.min(keys.length - 1, Math.max(0, i + d))]);
}
function commitFrame() {
  const c = cp();
  if (S.view === c.frame) return;
  pushUndo();
  c.frame = S.view;
  renderAll();
  ensurePose(c.frame);
}

// ---------- on-demand frames, pose, scrubber ----------
async function ensurePose(f) {
  if (poseAt(f) || f in S.poseExtra || S.poseBusy.has(f)) return;
  const clip = S.clip;
  S.poseBusy.add(f);
  const j = await getJson(`/api/pose/${encodeURIComponent(clip)}/${f}`);
  S.poseBusy.delete(f);
  if (clip !== S.clip) return;
  S.poseExtra[f] = j?.landmarks || null;
  renderChecks();
  if (f === S.view) renderOverlay();
}
function prefetch(from, to, step) {
  const clip = S.clip;
  const a = Math.max(0, from), b = Math.min(nFrames() - 1, to);
  const need = [];
  for (let f = a; f <= b; f += step) if (!S.have.has(f)) need.push(f);
  if (!need.length) return Promise.resolve();
  return getJson(`/api/frames/${encodeURIComponent(clip)}/prefetch?from=${need[0]}&to=${need[need.length - 1]}&step=${step}`).then((j) => {
    if (clip !== S.clip) return;
    for (const f of j?.frames || []) S.have.add(f);
  });
}
function prefetchAround() {
  clearTimeout(S.pfTimer);
  S.pfTimer = setTimeout(() => prefetch(S.view - 12, S.view + 12, 1), 250);
}
async function prefetchCoarse() {
  if (S.video.frames) await prefetch(0, nFrames() - 1, 10);
  renderFilm();
}
function renderFilm() {
  const film = $('film');
  if (S.filmFor === S.clip || !S.video.frames) return;
  S.filmFor = S.clip;
  const n = 10, last = nFrames() - 1;
  film.replaceChildren(...Array.from({ length: n }, (_, i) => {
    const f = Math.min(Math.floor(((i + 0.5) / n) * last / 10) * 10, last);
    const im = el('img', { alt: '', loading: 'lazy', draggable: 'false' });
    im.src = frameUrl(f);
    return im;
  }));
}
function realTime(f) {
  const v = S.video;
  const fps = v.playbackFps && v.slowmoFactor ? v.playbackFps * v.slowmoFactor : v.captureFps;
  return fps ? f / fps : null;
}
function renderScrubber() {
  const total = nFrames(), last = total - 1;
  const r = $('scrubRange');
  r.max = String(last); r.value = String(S.view);
  const t = realTime(S.view);
  $('scrubFrame').textContent = `Frame ${S.view} / ${last}`;
  $('scrubTime').textContent = t == null ? '' : `${t.toFixed(2)} s real swing time` + (S.video.slowmoFactor ? ` (${S.video.slowmoFactor}x slow-mo)` : '');
  const pos = (f) => `${(Math.min(last, Math.max(0, f)) / Math.max(1, last)) * 100}%`;
  const marks = [];
  for (const k of CHECKPOINTS) {
    const a = S.auto?.checkpoints?.[k], c = S.cur.cps[k];
    if (a && c && a.frame !== c.frame) { const g = el('div', { class: 'smk ghost' }); g.style.left = pos(a.frame); marks.push(g); }
  }
  for (const k of CHECKPOINTS) {
    const c = S.cur.cps[k]; if (!c) continue;
    const m = el('div', { class: 'smk' + (k === S.cpKey ? ' sel' : '') });
    m.style.left = pos(c.frame);
    m.append(el('span', {}, String(CHECKPOINTS.indexOf(k) + 1)));
    marks.push(m);
  }
  $('scrubMarks').replaceChildren(...marks);
  const b = $('setFrameBtn');
  b.textContent = S.view === cp().frame ? `${CP_LABEL[S.cpKey]} is on this frame` : `Set ${CP_LABEL[S.cpKey]} to frame ${S.view}`;
  b.disabled = S.view === cp().frame;
}
function previewFrame(f) {
  S.view = Math.min(nFrames() - 1, Math.max(0, Math.round(f)));
  renderScrubber(); renderImage(); renderOverlay();
  ensurePose(S.view);
  prefetchAround();
}

// ---------- cues ----------
function renderCue() {
  const d = cueFor(S.cpKey, S.handedness);
  const box = $('cue');
  if (!d) { box.replaceChildren(); return; }
  const h = el('h3', {}, d.name); h.append(el('span', { class: 'pn' }, d.p));
  const stop = el('p', { class: 'stop' }); stop.append(el('b', {}, 'Stop on: '), document.createTextNode(d.stopWhen));
  const mk = el('p', { class: 'mk' }); mk.append(el('b', {}, 'Mark: '), document.createTextNode(d.markTips));
  box.replaceChildren(h, el('p', {}, d.what), stop, mk);
}
function initHowTo() {
  const det = $('howTo');
  $('howToList').replaceChildren(...HOW_TO_MARK.map(([k, v]) => { const li = el('li'); li.append(el('b', {}, k + ': '), document.createTextNode(v)); return li; }));
  let open = true;
  try { open = localStorage.getItem('swinglab.howto') !== 'closed'; } catch { /* storage unavailable */ }
  det.open = open;
  det.addEventListener('toggle', () => { try { localStorage.setItem('swinglab.howto', det.open ? 'open' : 'closed'); } catch { /* ignore */ } });
}
// Marks belong to the frame on screen: placing one while previewing another frame moves the
// checkpoint there (same undo step), so marks can never be saved against a frame you didn't see.
function adoptViewedFrame() {
  const c = cp();
  if (S.view === c.frame) return;
  c.frame = S.view;
  ensurePose(c.frame);
  toast(`${CP_LABEL[S.cpKey]} set to frame ${S.view}`);
}
function setTargetPos(p) {
  adoptViewedFrame();
  const c = cp();
  p = { x: r1(p.x), y: r1(p.y) };
  if (S.target === 'hands') c.hands = p;
  else if (S.target === 'head') c.head = p;
  else if (S.target === 'ball' && S.cpKey === 'address') S.cur.ball = p;
}
function nudge(dx, dy) {
  const p = targetPt();
  if (!p) return toast(S.target === 'head' ? 'Clubhead is hidden: switch the toggle off to place it' : 'Mark not placed yet', true);
  pushUndo('nudge');
  const q = clampToVideo({ x: p.x + dx, y: p.y + dy }, S.video.w, S.video.h);
  setTargetPos(q);
  renderPanel(); renderOverlay(); renderChecks();
}

function hitTest(pt) {
  const { cw, ch } = boxSize(); const { w, h } = S.video;
  const c = cp();
  const cands = [['hands', c.hands]];
  if (c.head && !c.hidden) cands.push(['head', c.head]);
  if (S.cpKey === 'address' && S.cur.ball) cands.push(['ball', S.cur.ball]);
  let best = null;
  for (const [t, p] of cands) {
    const v = videoToView(p, cw, ch, w, h);
    const d = Math.hypot(v.x - pt.x, v.y - pt.y);
    if (d <= 26 && (!best || d < best.d || (d === best.d && t === S.target))) best = { t, d, p };
  }
  return best;
}
function pointerPt(e) {
  const r = $('overlay').getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, cw: r.width, ch: r.height };
}

function setupPointer() {
  const svg = $('overlay');
  svg.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const pt = pointerPt(e);
    const hit = hitTest(pt);
    let off = { x: 0, y: 0 };
    if (hit) {
      S.target = hit.t;
      const v = viewToVideo(pt, pt.cw, pt.ch, S.video.w, S.video.h);
      off = { x: hit.p.x - v.x, y: hit.p.y - v.y };
    } else {
      if (S.target === 'head' && cp().hidden) { toast('Clubhead is hidden: switch the toggle off to place it', true); return; }
      if (S.target === 'ball' && S.cpKey !== 'address') { S.target = 'hands'; }
    }
    svg.focus({ preventScroll: true });
    svg.setPointerCapture(e.pointerId);
    S.drag = { id: e.pointerId, off, moved: false, tapPlace: !hit };
    $('stillBox').classList.add('dragging');
    e.preventDefault();
    if (!hit) { pushUndo(); S.drag.moved = true; applyDrag(e); } else renderPanel();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!S.drag || S.drag.id !== e.pointerId) return;
    if (!S.drag.moved) { pushUndo(); S.drag.moved = true; }
    applyDrag(e);
  });
  const end = (e) => {
    if (!S.drag || S.drag.id !== e.pointerId) return;
    if (!S.drag.moved && !S.drag.tapPlace) { /* tap on a mark: just select */ }
    S.drag = null;
    $('stillBox').classList.remove('dragging');
    renderAll();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}
function applyDrag(e) {
  const pt = pointerPt(e);
  const v = viewToVideo(pt, pt.cw, pt.ch, S.video.w, S.video.h);
  const p = clampToVideo({ x: v.x + S.drag.off.x, y: v.y + S.drag.off.y }, S.video.w, S.video.h);
  setTargetPos(p);
  renderPanel(); renderOverlay(); renderChecks();
}

// ---------- save ----------
async function save() {
  if (!canSave()) return;
  const body = serialize();
  body.savedAt = new Date().toISOString();
  try {
    const r = await fetch(`/api/truth/${encodeURIComponent(S.clip)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    S.truth = { ...(S.truth || {}), ...body };
    S.initial = JSON.stringify(serialize());
    S.baseChecks = byId(runChecks(checkInput()).checks);
    toast(`Saved to ${j.path}` + (j.backup ? ' (previous kept as .bak)' : ''));
    $('srcBadge').textContent = S.auto ? 'TRUTH + AUTO' : 'TRUTH ONLY';
    renderPanel(); renderChecks();
  } catch (err) { toast('Save failed: ' + err.message, true); }
}
let toastT;
function toast(msg, err) {
  const t = $('toast');
  t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), err ? 4500 : 2600);
}

// ---------- wiring ----------
function resetCheckpoint() {
  const src = S.auto?.checkpoints?.[S.cpKey] || S.truth?.checkpoints?.[S.cpKey];
  if (!src) return;
  pushUndo();
  const m = clone(src);
  m.head = m.head && isFinite(m.head.x) ? m.head : null; m.hidden = !!m.hidden;
  S.cur.cps[S.cpKey] = { ...m, _head: null };
  if (S.cpKey === 'address') { const b = S.auto?.ball || S.truth?.ball; if (b) S.cur.ball = { x: b.x, y: b.y }; }
  syncView();
  renderAll();
  ensurePose(cp().frame);
}
function toggleHidden() {
  const c = cp();
  pushUndo();
  adoptViewedFrame();
  if (!c.hidden) { c._head = c.head; c.hidden = true; }
  else { c.hidden = false; c.head = c.head || c._head || autoCp()?.head || null; if (!c.head) { S.target = 'head'; toast('Tap the image to place the clubhead'); } }
  renderAll();
}

function applyTheme(t) { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
function initTheme() {
  try { applyTheme(localStorage.getItem('swinglab.theme')); } catch { /* storage unavailable */ }
  $('themeBtn').onclick = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    const t = dark ? 'light' : 'dark';
    applyTheme(t);
    try { localStorage.setItem('swinglab.theme', t); } catch { /* ignore */ }
  };
}

async function switchClip(clip) {
  if (S.cur && isDirty() && !confirm('You have unsaved changes. Discard them?')) { $('clipSel').value = S.clip; return; }
  history.replaceState(null, '', '#' + clip);
  await loadClip(clip);
}

async function init() {
  initTheme();
  const list = await getJson('/api/clips');
  S.clips = list?.clips || [];
  const sel = $('clipSel');
  sel.replaceChildren(...S.clips.map((c) => el('option', { value: c.clip }, c.clip + (c.hasTruth ? ' ✓' : ''))));
  if (!S.clips.length) return showEmpty('No clips yet', 'Nothing in out/. Run detect.py on a clip first.');
  const want = decodeURIComponent(location.hash.slice(1));
  const first = S.clips.find((c) => c.clip === want) || S.clips.find((c) => c.hasAuto || c.hasTruth) || S.clips[0];
  sel.value = first.clip;
  sel.onchange = () => switchClip(sel.value);
  for (const b of $('targetSeg').children) b.onclick = () => { if (b.disabled) return; S.target = b.dataset.t; renderPanel(); renderOverlay(); };
  for (const b of document.querySelectorAll('.pad button')) b.onclick = () => { const [x, y] = b.dataset.d.split(',').map(Number); nudge(x, y); };
  $('undoBtn').onclick = undo;
  $('resetBtn').onclick = resetCheckpoint;
  $('hiddenTgl').onclick = toggleHidden;
  $('saveBtn').onclick = save;
  $('setFrameBtn').onclick = commitFrame;
  $('scrubRange').oninput = (e) => previewFrame(Number(e.target.value));
  for (const b of $('scrubBtns').children) b.onclick = () => previewFrame(S.view + Number(b.dataset.step));
  initHowTo();
  setupPointer();
  new ResizeObserver(() => renderOverlay()).observe($('stillBox'));
  window.addEventListener('beforeunload', (e) => { if (S.cur && isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('keydown', onKey);
  await loadClip(first.clip);
}

function onKey(e) {
  if (!S.cur || $('main').hidden) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'select' || tag === 'input' || tag === 'textarea') return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (mod) return;
  if (e.code === 'Comma' || e.code === 'Period') {
    e.preventDefault();
    previewFrame(S.view + (e.code === 'Comma' ? -1 : 1) * (e.shiftKey ? 10 : 1));
    return;
  }
  const k = e.key;
  if (!k.startsWith('Arrow')) { if (k === 'Escape') $('overlay').blur(); return; }
  const onStill = e.target === $('overlay');
  if (onStill && !e.altKey) {
    e.preventDefault();
    const n = e.shiftKey ? 5 : 1;
    nudge(k === 'ArrowLeft' ? -n : k === 'ArrowRight' ? n : 0, k === 'ArrowUp' ? -n : k === 'ArrowDown' ? n : 0);
  } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
    if (tag === 'button' && e.target.closest('.seg, .pad')) return;
    e.preventDefault();
    stepCp(k === 'ArrowLeft' ? -1 : 1);
  }
}

window.__swingLab = { S, serialize, isDirty }; // handy for debugging in the console
init();
