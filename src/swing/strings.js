// All copy of the swing analyzer in one module (plan 5.7, D1). The text lives in the
// catalogues (src/i18n/locales/{en,es}/swing*.js, keys 'swing.<path>'); this file is the
// shape of the object that call sites read. `L` marks a string that comes from the
// catalogue under the key of its own path ('swing.home.title'), and `build` turns every
// such leaf into a getter, so the value follows the active language at the moment it is
// read (never cache it in a module constant). Parameterised entries stay functions and
// call t() themselves; their keys sit under the same path convention.
import { t, getLanguage } from '../i18n';
import { formatNumber } from '../i18n/format';

const r0 = (v) => Math.round(v);
const n0 = (v) => formatNumber(r0(v));

const L = Symbol('swing.leaf');

const hasLeaf = (node) => node === L
  || (Array.isArray(node) && node.some(hasLeaf))
  || (node && typeof node === 'object' && !Array.isArray(node) && Object.values(node).some(hasLeaf));

function resolve(node, path) {
  if (node === L) return t(`swing.${path.join('.')}`);
  if (Array.isArray(node)) return node.map((x, i) => resolve(x, [...path, i]));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, resolve(v, [...path, k])]));
  }
  return node;
}

function build(node, path = []) {
  const out = {};
  Object.entries(node).forEach(([key, value]) => {
    const p = [...path, key];
    if (value === L) {
      Object.defineProperty(out, key, { enumerable: true, get: () => t(`swing.${p.join('.')}`) });
    } else if (Array.isArray(value) && hasLeaf(value)) {
      let cached = null;
      Object.defineProperty(out, key, {
        enumerable: true,
        get: () => {
          const lang = getLanguage();
          if (!cached || cached.lang !== lang) cached = { lang, value: resolve(value, p) };
          return cached.value;
        },
      });
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = build(value, p);
    } else {
      out[key] = value;
    }
  });
  return out;
}

export const SWING_STRINGS = build({
  privacy: L,
  approximate: L,

  // Club picker (D19): exactly two clubs.
  club: {
    label: L,
    iron: L,
    driver: L,
  },

  // Swing home (S5, design B).
  home: {
    title: L,
    record: L,
    import: L,
    back: L,
    emptyTitle: L,
    emptyBody: L,
    emptyHint: L,
    updateTitle: L,
    updateBody: L,
    analysing: L,
    failed: L,
    noFault: L,
    continueMarking: (n, of) => t('swing.home.continueMarking', { n, of }),
    footer: (n, size) => t('swing.home.footer', { count: n, size }),
    rowActions: L,
    deleteSwing: L,
    compareWith: L,
    attribution: L,
    attributionClub: L,
    pickTwo: L,
    picked: (n) => t('swing.home.picked', { n }),
    compare: (a, b) => t('swing.home.compare', { a, b }),
    compareShort: L,
    comparePick: L,
    cancel: L,
    deleteTitle: L,
    deleteBody: L,
    delete: L,
    importFailed: L,
    countLabel: (g, y, r) => t('swing.home.countLabel', { g, y, r }),
    deleteA11y: (name) => t('swing.home.deleteA11y', { name }),
    fpsTag: (fps, approximate) => t(approximate ? 'swing.home.fpsTagApprox' : 'swing.home.fpsTag', { fps }),
  },

  // First-run sheet (D5, D6).
  profileSheet: {
    title: L,
    body: L,
    height: L,
    cm: L,
    handedness: L,
    right: L,
    left: L,
    save: L,
    skip: (cm) => t('swing.profileSheet.skip', { cm }),
    invalid: L,
  },

  // Capture (S2, N3; design B with C's review step, D8).
  capture: {
    close: L,
    guideToggle: L,
    guideTitle: L,
    guideTips: [L, L, L, L],
    guideBox: L,
    gotIt: L,
    fps: (fps) => t(fps >= 240 ? 'swing.capture.fps.high' : fps >= 120 ? 'swing.capture.fps.ok' : 'swing.capture.fps.low', { fps }),
    record: L,
    stop: L,
    autoStop: (max) => t('swing.capture.autoStop', { max }),
    loading: L,
    fallbackTitle: (fps) => t('swing.capture.fallbackTitle', { fps }),
    fallbackNoCamera: L,
    fallbackBody: L,
    importSlowMo: L,
    recordAnyway: (fps) => t('swing.capture.recordAnyway', { fps }),
    updateTitle: L,
    permissionTitle: L,
    permissionBody: L,
    openSettings: L,
    allow: L,
    back: L,
    review: (secs, fps, rate) => (rate < 1
      ? t('swing.capture.reviewSlow', { secs, fps, speed: rate === 0.125 ? '⅛' : '¼' })
      : t('swing.capture.review', { secs, fps })),
    reviewHint: L,
    retake: L,
    analyse: L,
    saving: L,
    errors: {
      camera: L,
      interrupted: L,
      failed: L,
      short: L,
      save: L,
    },
    retry: L,
  },

  // Compare (S8, design B).
  compare: {
    title: L,
    overline: L,
    differentClubs: L,
    swap: L,
    back: L,
    verdict: { better: L, betterNotFixed: L, worse: L, same: L },
    stillFault: (f) => t('swing.compare.stillFault', { fault: f.toLowerCase() }),
    faultMoved: (from, to) => t('swing.compare.faultMoved', { from: from.toLowerCase(), to: to.toLowerCase() }),
    newFault: (f) => t('swing.compare.newFault', { fault: f.toLowerCase() }),
    faultGone: (f) => t('swing.compare.faultGone', { fault: f }),
    noFault: L,
    move: (label, a, b, change) => t(change === 'better' ? 'swing.compare.move.better' : 'swing.compare.move.worse', { label, a, b }),
    better: (n) => t('swing.compare.betterCount', { n }),
    same: (n) => t('swing.compare.sameCount', { n }),
    worse: (n) => t('swing.compare.worseCount', { n }),
    unclear: (n) => t('swing.compare.unclearCount', { n }),
    check: L,
    change: L,
    changeWord: { better: L, same: L, worse: L, unclear: L },
    impactStills: L,
    noStill: L,
    unclearHint: L,
    loadFailed: L,
    rowLabel: (label, a, b, change) => t('swing.compare.rowLabel', { label, a, b, change }),
    stillA11y: (name, stills) => t('swing.compare.stillA11y', { name, stills }),
  },

  // Export (S8, D18).
  exportSwing: {
    menu: L,
    hint: L,
    failed: L,
    unavailable: L,
    dialogTitle: L,
  },
  statusWord: { green: L, yellow: L, red: L, unknown: L },

  // D12: what the processing screen says when analyze() returns { error }.
  errors: {
    no_pose: L,
    partial_pose: L,
    too_long: L,
    failed: L,
    cancelled: L,
    update: L,
  },

  // The marking canvas (D26, laid out per D28 "Frame Then Marks"). HUD chrome like capture.
  mark: {
    close: L,
    cancel: L,
    edit: L,
    auto: L,
    names: { hands: L, head: L, ball: L },
    short: {
      address: L, takeaway: L, leadArm: L, top: L, shaftDown: L, impact: L, trailArm: L,
    },
    status: {
      proposed: L, confirmed: L, hidden: L, missing: L, moved: L, unsure: L,
    },
    addressOnly: L,
    dock: L,
    dockLabel: (name, status) => t('swing.mark.dockLabel', { name, status }),
    line: {
      proposed: L,
      unsure: L,
      confirmed: L,
      moved: L,
      hidden: L,
      missing: (name) => t('swing.mark.line.missing', { name: name.toLowerCase() }),
    },
    confirm: L,
    hide: L,
    unhide: L,
    placing: (name) => t('swing.mark.placing', { name }),
    confirmed: (name, frame) => t('swing.mark.confirmed', { name, frame }),
    ballOnlyAddress: L,
    placeHead: L,
    hiddenToast: L,
    nudge: { left: L, right: L, up: L, down: L },
    stopKind: { first: L, last: L },
    watch: (what) => t('swing.mark.watch', { what }),
    more: L,
    less: L,
    stopA11y: (kind, short, watch) => t(kind === 'first' ? 'swing.mark.stopA11yFirst' : 'swing.mark.stopA11yLast', { short, watch }),
    cueStop: L,
    cueMark: L,
    thumbLabel: (f, off) => (off === 0
      ? t('swing.mark.thumbLabel.proposed', { f })
      : t(off < 0 ? 'swing.mark.thumbLabel.before' : 'swing.mark.thumbLabel.after', { f, n: Math.abs(off) })),
    prevFrame: L,
    nextFrame: L,
    counts: (c, s, todo) => t('swing.mark.counts', { c, s, todo }),
    countA11y: (c, s, todo) => t('swing.mark.countA11y', { c, s, todo }),
    chapterA11y: (name, status) => t('swing.mark.chapterA11y', {
      name,
      status: ['confirmed', 'skipped', 'todo'].includes(status) ? t(`swing.mark.chapterStatus.${status}`) : status,
    }),
    // D28: two steps per position, the top row's count
    stepOf: (n) => t('swing.mark.stepOf', { n }),
    findFrame: L,
    placeMarks: L,
    position: (n, of) => t('swing.mark.position', { n, of }),
    tally: (c, s) => t(s ? 'swing.mark.tallySkip' : 'swing.mark.tally', { c, s }),
    track: L,
    frameLine: (f, secs) => t('swing.mark.frameLine', { f, secs }),
    offProposal: (off) => t('swing.mark.offProposal', { sign: off > 0 ? '+' : '−', n: Math.abs(off) }),
    onProposal: L,
    frameTag: (f) => t('swing.mark.frameTag', { f }),
    scrubbing: L,
    loadingTag: L,
    posPill: (p, name, f, chosen) => `${p ? `${p} · ` : ''}${t(chosen ? 'swing.mark.posPillChosen' : 'swing.mark.posPill', { name, f })}`,
    changeFrame: L,
    changeFrameA11y: L,
    framesReset: L,
    nudgeHint: L,
    stillA11y: (name, frame) => t('swing.mark.stillA11y', { name, frame }),
    posTail: (f, chosen) => t(chosen ? 'swing.mark.posTailChosen' : 'swing.mark.posTail', { f }),
    primary: {
      proposedOk: L,
      useFrame: (f) => t('swing.mark.primary.useFrame', { f }),
      useReset: (f) => t('swing.mark.primary.useReset', { f }),
      looks: L,
      save: L,
      noHead: L,
      editSave: L,
      editDone: L,
    },
    skip: L,
    clubTitle: L,
    clubSub: L,
    clubNext: L,
    start: L,
    finishTitle: (n, of) => t('swing.mark.finishTitle', { n, of }),
    noClubhead: (names) => t('swing.mark.noClubhead', { names: names.join(', ') }),
    noClubheadBody: L,
    skippedLine: (names) => t('swing.mark.skippedLine', { names: names.join(', ') }),
    skippedBody: L,
    rowSub: { missing: L, hidden: L },
    chip: { confirmed: L, skipped: L, todo: L },
    autoLine: L,
    fixFinish: L,
    seeResults: L,
    discardTitle: L,
    discardBody: L,
    confirmLeave: L,
    discardMove: L,
    keepEditing: L,
    leaveTitle: L,
    leaveBody: L,
    discard: L,
    saving: L,
    saveFailed: L,
    saveFailedBody: L,
    leaveUnsaved: L,
    loadingFrame: (f) => t('swing.mark.loadingFrame', { f }),
    touchHint: L,
    loadFailed: L,
  },

  // The short names of the seven positions and the extras step (Results' summary dots, the canvas chips).
  position: {
    short: {
      address: L, takeaway: L, leadArm: L, top: L, shaftDown: L, impact: L, trailArm: L, extras: L,
    },
  },

  // Swing results (S6, design B; checks v2 design D: summary + stepper).
  results: {
    workFirst: L,
    startsAt: (name) => t('swing.results.startsAt', { name }),
    mainSoFar: L,
    placeToFinish: (name) => t('swing.results.placeToFinish', { name: getLanguage() === 'es' ? name.toLowerCase() : name }),
    place: L,
    frameShort: (frame) => t('swing.results.frameShort', { frame }),
    tagFirst: L,
    tagStarts: L,
    markFirst: L,
    markStarts: L,
    extras: L,
    extrasHint: L,
    readWithout: (name) => t('swing.results.readWithout', { name }),
    stateNoHead: L,
    stepA11y: (name, state) => t('swing.results.stepA11y', { name, state }),
    posOf: (name, n, total) => t('swing.results.posOf', { name, n, total }),
    prevPos: L,
    nextPos: L,
    tapWhere: L,
    tapWhereA11y: (name, frame) => t('swing.results.tapWhereA11y', { name, frame }),
    confirmDot: L,
    swipeHint: L,
    openEdit: L,
    placed: (name) => t('swing.results.placed', { name }),
    mainChanged: (fault) => t('swing.results.mainChanged', { fault }),
    undo: L,
    placeFailed: L,
    noFaultAll: L,
    noFaultSoFar: L,
    noFaultPlace: L,
    nothingMeasured: L,
    mainTitle: L,
    noFaultTitle: L,
    noFaultWhy: L,
    // The shaft line at the ball, back (P3) and through (P9).
    // D21: the main fault is the earliest one; later significant faults are likely its knock-on effects.
    alsoCausing: (labels) => {
      const l = labels.map((x) => x.toLowerCase());
      if (l.length > 2) return t('swing.results.alsoCausing.many', { a: l[0], b: l[1], n: l.length - 2 });
      return l.length === 2
        ? t('swing.results.alsoCausing.two', { a: l[0], b: l[1] })
        : t('swing.results.alsoCausing.one', { a: l.join('') });
    },
    good: (n) => t('swing.results.goodCount', { n }),
    watch: (n) => t('swing.results.watchCount', { n }),
    fix: (n) => t('swing.results.fixCount', { n }),
    fpsChip: (fps) => `${formatNumber(Math.round(fps))} fps`,
    approxChip: L,
    cpSuffix: { takeaway: L, leadArm: L, top: L, shaftDown: L }, // spine_hold / knee_hold run at several positions
    approxBanner: L,
    approxHeightBanner: L,
    noStill: L,
    estimated: L,
    clubHidden: L,
    frameLine: (frame, secs, off) => (off
      ? t('swing.results.frameLineOff', { frame, secs, off: `${off > 0 ? '+' : ''}${off}` })
      : t('swing.results.frameLine', { frame, secs })),
    prevFrame: L,
    nextFrame: L,
    drillsTitle: (fault) => t('swing.results.drillsTitle', { fault: fault.toLowerCase() }),
    moreDrills: (n) => t('swing.results.moreDrills', { count: n }),
    lessDrills: L,
    passTarget: (target) => t('swing.results.passTarget', { target }),
    // D24: a 60-minute range session around the main fault's drill.
    practice: {
      title: L,
      show: L,
      hide: L,
      blocks: [
        { key: 'program', time: L, name: L, body: L },
        { key: 'block', time: L, name: L, body: L },
        { key: 'random', time: L, name: L, body: L },
        { key: 'compete', time: L, name: L, body: L },
      ],
      drillIn: (title) => t('swing.results.practice.drillIn', { title }),
      noDrill: L,
    },
    allChecks: L,
    // Design B: one thing to work on, then the rest by priority.
    practiseTitle: L,
    // Plain-language coaching: the fixes card, the open row under a selected check and the fix sheet.
    fixes: {
      legendYou: L,
      legendTarget: L,
      titleFix: L,
      titleWatch: L,
      emptyTitle: L,
      emptyBody: L,
      rowLabel: (n, headline, cp, word) => t('swing.results.fixes.rowLabel', { n, headline, cp, word }),
      subline: (cp, word) => t('swing.results.fixes.subline', { cp, word }),
      sheetOverline: (n, total, cp) => t('swing.results.fixes.sheetOverline', { n, total, cp }),
      saw: (text) => t('swing.results.fixes.saw', { text }),
      whyTitle: L,
      howTitle: L,
      drill: (title) => t('swing.results.fixes.drill', { title }),
      goal: (target) => t('swing.results.fixes.goal', { target }),
      seeOnSwing: L,
      next: L,
      done: L,
      close: L,
      tryThis: L,
      howLink: L,
      stepLabel: (n, text) => t('swing.results.fixes.stepLabel', { n, text }),
    },
    // D26: the marks behind these results.
    unconfirmedChip: (n) => t('swing.results.unconfirmedChip', { count: n }),
    nextMarking: L,
    placeClubhead: L,
    placeClubheadHint: (where) => t('swing.results.placeClubheadHint', { where: where.toLowerCase() }),
    editMarks: L,
    editMarksMenu: (label) => t('swing.results.editMarksMenu', { label }),
    play: L,
    menu: L,
    rename: L,
    renameTitle: L,
    renamePlaceholder: L,
    save: L,
    cancel: L,
    close: L,
    back: L,
    reading: L,
    stillA11y: (name, frame) => t('swing.results.stillA11y', { name, frame }),
    // Processing (its own clean view: nothing from the results shell until marking is done).
    deleteSwing: L,
    loading: L,
    processingTitle: L,
    stages: { reading: L, pose: L, planes: L },
    frames: (n) => t('swing.results.frames', { n }),
    stepOf: (n, total) => t('swing.results.stepOf', { n, total }),
    secs: (s) => t('swing.results.secs', { s }),
    statFrames: L,
    statFps: L,
    statClip: L,
    timelineA11y: (at, secs, done, total) => t('swing.results.timelineA11y', { at, secs, done, total }),
    upNext: L,
    upNextTitle: (n) => t('swing.results.upNextTitle', { n }),
    upNextBody: L,
    notUploaded: L,
    cancelAnalysis: L,
    retry: L,
    recordAgain: L,
    backToSwings: L,
    errorBody: {
      no_pose: L,
      partial_pose: L,
      too_long: L,
      failed: L,
      cancelled: L,
      update: L,
    },
    errorTitle: {
      no_pose: L, partial_pose: L, too_long: L,
      failed: L, cancelled: L, update: L,
    },
  },

  // Labels drawn on the still (SwingOverlay).
  overlay: {
    shaftPlane: (deg) => t('swing.overlay.shaftPlane', { deg: formatNumber(Math.round(deg)) }),
    shoulderPlane: (deg) => t('swing.overlay.shoulderPlane', { deg: formatNumber(Math.round(deg)) }),
  },

  checkpoint: {
    address: L, takeaway: L, leadArm: L, top: L, transition: L,
    shaftDown: L, impact: L, shaftThrough: L, trailArm: L, finish: L,
    lateBackswing: L, preImpact: L, postImpact: L,
  },

  phase: { setup: L, backswing: L, transition: L, impact: L, finish: L },

  checkLabel: {
    posture_address: L,
    hands_under_shoulders: L,
    back_line: L,
    knee_flex: L,
    shaft_plane: L,
    clubhead_plane_takeaway: L,
    spine_hold: L,
    knee_hold: L,
    butt_extension: L,
    lead_arm_spine: L,
    hands_over_heels: L,
    clubhead_plane_down: L,
    down_vs_takeaway: L,
    hip_drift: L,
    spine_loss: L,
    shaft_through_ball: L,
    through_vs_halfway: L,
    tempo: L,
    finish_balance: L,
    head_drift: L,
    hands_height_impact: L,
    hands_out_impact: L,
    shaft_angle_impact: L,
  },

  fault: {
    early_extension: L,
    over_the_top: L,
    stuck: L,
    steep_backswing: L,
    flat_backswing: L,
    across_the_line: L,
    laid_off: L,
    head_sway: L,
    tempo_fast: L,
    tempo_slow: L,
    balance: L,
    posture: L,
    posture_loss: L,
    top_position: L,
    flip: L,
  },

  // Reasons a check has no verdict ('unknown'), shown instead of a value.
  reason: {
    nopose: (what) => t('swing.reason.nopose', { what }),
    nodata: (what) => what,
    hidden: (where) => t('swing.reason.hidden', { where }),
    unplaced: L, // spec §5: also a detection below the checks' gate
  },

  checkText: {
    posture_address: (deg, lo = 25, hi = 40) => t('swing.checkText.posture_address', { deg: n0(deg), lo, hi }),
    hands_under_shoulders_ok: L,
    hands_under_shoulders_out: (cm) => t('swing.checkText.hands_under_shoulders_out', { cm: n0(cm) }),
    hands_under_shoulders_in: (cm) => t('swing.checkText.hands_under_shoulders_in', { cm: n0(cm) }),
    back_line_ok: L,
    back_line: (deg, dir) => t(dir === 'dropped' ? 'swing.checkText.back_line_dropped' : 'swing.checkText.back_line_up', { deg: n0(deg) }),
    knee_flex: (deg, dir) => t(dir === 'stiff' ? 'swing.checkText.knee_flex_stiff' : dir === 'squat' ? 'swing.checkText.knee_flex_squat' : 'swing.checkText.knee_flex', { deg: n0(deg) }),
    shaft_plane_ok: (deg) => t('swing.checkText.shaft_plane_ok', { deg: n0(deg) }),
    shaft_plane: (cm, dir, deg) => t(dir === 'upright' ? 'swing.checkText.shaft_plane_upright' : 'swing.checkText.shaft_plane_flat', { cm: n0(Math.abs(cm)), deg: n0(deg) }),
    clubhead_plane_takeaway_ok: L,
    clubhead_plane_takeaway: (cm, dir) => t(dir === 'steep' ? 'swing.checkText.clubhead_plane_takeaway_steep' : 'swing.checkText.clubhead_plane_takeaway_flat', { cm: n0(Math.abs(cm)) }),
    spine_hold: (from, to, v) => t(v >= 0 ? 'swing.checkText.spine_hold_up' : 'swing.checkText.spine_hold_down', { from: n0(from), to: n0(to), n: n0(Math.abs(v)) }),
    knee_hold: (from, to, v) => t(v < 0 ? 'swing.checkText.knee_hold_straighten' : 'swing.checkText.knee_hold_flex', { from: n0(from), to: n0(to), n: n0(Math.abs(v)) }),
    butt_extension_ok: L,
    butt_extension_flat: (cm) => t('swing.checkText.butt_extension_flat', { cm: n0(cm) }),
    butt_extension_steep: (cm) => t('swing.checkText.butt_extension_steep', { cm: n0(cm) }),
    lead_arm_spine_ok: L,
    lead_arm_spine: (deg, dir) => t(dir === 'upright' ? 'swing.checkText.lead_arm_spine_upright' : 'swing.checkText.lead_arm_spine_flat', { deg: n0(Math.abs(deg)) }),
    hands_over_heels_ok: L,
    hands_over_heels_deep: (cm) => t('swing.checkText.hands_over_heels_deep', { cm: n0(cm) }),
    hands_over_heels_shallow: (cm) => t('swing.checkText.hands_over_heels_shallow', { cm: n0(cm) }),
    clubhead_plane_down_ok: L,
    clubhead_plane_down: (cm, dir) => t(dir === 'steep' ? 'swing.checkText.clubhead_plane_down_steep' : 'swing.checkText.clubhead_plane_down_under', { cm: n0(Math.abs(cm)) }),
    down_vs_takeaway: (cm) => t(cm > 0 ? 'swing.checkText.down_vs_takeaway_steeper' : 'swing.checkText.down_vs_takeaway_shallower', { cm: n0(Math.abs(cm)) }),
    shaft_through_ball_ok: L,
    shaft_through_ball_beyond: (cm) => t('swing.checkText.shaft_through_ball_beyond', { cm: n0(cm) }),
    shaft_through_ball_inside: (cm) => t('swing.checkText.shaft_through_ball_inside', { cm: n0(cm) }),
    through_vs_halfway_ok: L,
    through_vs_halfway: (cm) => t(cm > 0 ? 'swing.checkText.through_vs_halfway_beyond' : 'swing.checkText.through_vs_halfway_inside', { cm: n0(Math.abs(cm)) }),
    hands_height_impact_up: (cm) => t('swing.checkText.hands_height_impact_up', { cm: n0(cm) }),
    hands_height_impact_down: (cm) => t('swing.checkText.hands_height_impact_down', { cm: n0(cm) }),
    hands_out_impact_in: (cm) => t('swing.checkText.hands_out_impact_in', { cm: n0(cm) }),
    hands_out_impact_out: (cm) => t('swing.checkText.hands_out_impact_out', { cm: n0(cm) }),
    shaft_angle_impact_up: (deg) => t('swing.checkText.shaft_angle_impact_up', { deg: n0(deg) }),
    shaft_angle_impact_down: (deg) => t('swing.checkText.shaft_angle_impact_down', { deg: n0(deg) }),
    spine_loss: (from, to, loss) => t('swing.checkText.spine_loss', { from: n0(from), to: n0(to), loss: n0(loss) }),
    hip_drift: (cm) => t('swing.checkText.hip_drift', { cm: n0(cm) }),
    head_drift: (cm) => t('swing.checkText.head_drift', { cm: n0(cm) }),
    tempo: (back, down, ratio) => t('swing.checkText.tempo', { back, down, ratio: formatNumber(ratio, { maxDecimals: 1 }) }),
    finish_balance: (quiet, balanced) => {
      if (quiet && balanced) return t('swing.checkText.finish_balance.both');
      if (quiet) return t('swing.checkText.finish_balance.quiet');
      if (balanced) return t('swing.checkText.finish_balance.balanced');
      return t('swing.checkText.finish_balance.neither');
    },
  },

  // Plain-language coaching per check and direction (see fixes.js for how the key is chosen).
  // headline: what the golfer does; cost: what it does to the ball; cue: one feel; steps: how to fix it.
  fixCopy: {
    posture_address: {
      tall: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      over: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    hands_under_shoulders: {
      out: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      in: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    back_line: {
      dropped: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      up: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    knee_flex: {
      stiff: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      squat: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    shaft_plane: {
      upright: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      flat: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    clubhead_plane_takeaway: {
      steep: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      flat: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    spine_hold: {
      up: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      down: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    knee_hold: {
      straighten: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      flex: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    butt_extension: {
      flat: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      steep: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    lead_arm_spine: {
      upright: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      flat: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    hands_over_heels: {
      deep: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      shallow: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    clubhead_plane_down: {
      steep: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      under: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    down_vs_takeaway: {
      steeper: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    hip_drift: {
      toward: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    spine_loss: {
      lost: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    shaft_through_ball: {
      beyond: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      inside: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    through_vs_halfway: {
      beyond: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      inside: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    tempo: {
      fast: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      slow: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    finish_balance: {
      off: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    head_drift: {
      moved: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    hands_height_impact: {
      up: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      down: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    hands_out_impact: {
      in: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      out: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
    shaft_angle_impact: {
      up: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
      down: {
        headline: L,
        cost: L,
        cue: L,
        steps: [L, L, L],
      },
    },
  },
});
