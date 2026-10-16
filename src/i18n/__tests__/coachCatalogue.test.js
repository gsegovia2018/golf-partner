// Coach v2 catalogue: every message key the three coach stores can emit exists in
// en and es, with the params the store passes. Namespaces and the closed sets
// (lead-ins, categories, session kinds) come from the store sources, not a copy.
import fs from 'fs';
import path from 'path';
import en from '../locales/en';
import es from '../locales/es';
import { STRENGTHS } from '../../store/coachCauses';
import { SG_CATEGORIES } from '../../store/coachMetrics';
import { SESSION_KINDS } from '../../store/coachWeeklyPlan';

const STORE_DIR = path.join(__dirname, '..', '..', 'store');
const storeSource = (file) => fs.readFileSync(path.join(STORE_DIR, file), 'utf8');

// Key -> params the store passes (src/store/coachCauses.js, coachSwingLink.js,
// coachWeeklyPlan.js). Keys the copy deliberately leaves out are INERT below.
const PASSED = {
  // Causes: lead-ins
  'stats.my.coach.cause.lead.likely': '',
  'stats.my.coach.cause.lead.consistent': '',
  'stats.my.coach.cause.lead.possible': '',
  // Causes: putting
  'stats.my.coach.cause.putting.lag': 'bucket avgPutts pct count total',
  'stats.my.coach.cause.putting.lag.bench': 'bucket avgPutts pct count total expected hcp',
  'stats.my.coach.cause.putting.lag.bench.scratch': 'bucket avgPutts pct count total expected',
  'stats.my.coach.cause.putting.short': 'bucket avgPutts total',
  'stats.my.coach.cause.putting.short.bench': 'bucket avgPutts total expected hcp',
  'stats.my.coach.cause.putting.short.bench.scratch': 'bucket avgPutts total expected',
  'stats.my.coach.cause.putting.general.bench': 'per18 benchPer18 threePutts benchThreePutts hcp',
  'stats.my.coach.cause.putting.general.bench.scratch': 'per18 benchPer18 threePutts benchThreePutts',
  // Causes: approach
  'stats.my.coach.cause.approach.short': 'bucket missPct pct count total',
  'stats.my.coach.cause.approach.side': 'bucket side pct count total',
  'stats.my.coach.cause.approach.side.cost': 'bucket side pct count total cost',
  'stats.my.coach.cause.approach.bunker': 'bucket pct count total sandPct sandAttempts',
  'stats.my.coach.cause.approach.distance': 'bucket cost shots',
  'stats.my.coach.cause.approach.distance.bench': 'bucket cost shots hcp',
  'stats.my.coach.cause.approach.distance.bench.scratch': 'bucket cost shots',
  // Causes: off the tee
  'stats.my.coach.cause.tee.trouble.driver': 'pct count total',
  'stats.my.coach.cause.tee.penalty.driver': 'pct count total',
  'stats.my.coach.cause.tee.penalty.driver.bench': 'pct count total benchPct hcp',
  'stats.my.coach.cause.tee.penalty.driver.bench.scratch': 'pct count total benchPct',
  'stats.my.coach.cause.tee.side': 'side count misses pct',
  'stats.my.coach.cause.tee.side.bench': 'side count misses pct benchPct hcp',
  'stats.my.coach.cause.tee.side.bench.scratch': 'side count misses pct benchPct',
  'stats.my.coach.cause.tee.distance.bench': 'distance benchDistance drives hcp',
  'stats.my.coach.cause.tee.distance.bench.scratch': 'distance benchDistance drives',
  // Causes: short game and penalties
  'stats.my.coach.cause.short.sand': 'sandPct nonSandPct sandAttempts nonSandAttempts',
  'stats.my.coach.cause.short.chip.bench': 'pct expectedPct attempts hcp',
  'stats.my.coach.cause.short.chip.bench.scratch': 'pct expectedPct attempts',
  'stats.my.coach.cause.penalty.tee': 'count total',
  'stats.my.coach.cause.penalty.tee.bench': 'count total perRound benchPerRound hcp',
  'stats.my.coach.cause.penalty.tee.bench.scratch': 'count total perRound benchPerRound',
  'stats.my.coach.cause.penalty.other': 'count total',
  'stats.my.coach.cause.penalty.other.bench': 'count total perRound benchPerRound hcp',
  'stats.my.coach.cause.penalty.other.bench.scratch': 'count total perRound benchPerRound',
  // Swing link
  'stats.my.coach.swing.linked.consistent': 'club fault date',
  'stats.my.coach.swing.linked.possible': 'club fault date',
  'stats.my.coach.swing.stale.consistent': 'club fault date',
  'stats.my.coach.swing.stale.possible': 'club fault date',
  'stats.my.coach.swing.wrongClub': 'lastClub club',
  'stats.my.coach.swing.none': 'club',
  'stats.my.coach.swing.swingOnly': 'club fault date',
  'stats.my.coach.swing.secondSignal': 'fault',
  'stats.my.coach.swing.cta.record': 'club',
  // Weekly plan: areas and sessions
  'stats.my.coach.plan.area.offTheTee': '',
  'stats.my.coach.plan.area.approach': '',
  'stats.my.coach.plan.area.aroundGreen': '',
  'stats.my.coach.plan.area.putting': '',
  'stats.my.coach.plan.area.penalties': '',
  'stats.my.coach.plan.session.range': 'minutes count',
  'stats.my.coach.plan.session.shortGame': 'minutes count',
  'stats.my.coach.plan.session.putting': 'minutes count',
  'stats.my.coach.plan.session.course': 'minutes count',
  // Weekly plan: why
  'stats.my.coach.plan.why.focus': 'area bucket',
  'stats.my.coach.plan.why.tie': 'area bucket',
  'stats.my.coach.plan.why.second': 'area bucket',
  'stats.my.coach.plan.why.keep': 'area bucket',
  'stats.my.coach.plan.why.swing': 'area bucket',
  'stats.my.coach.plan.why.collect.insufficient': '',
  'stats.my.coach.plan.why.collect.noLeak': '',
  // Weekly plan: on-course task
  'stats.my.coach.plan.course.putting.lag': 'bucket',
  'stats.my.coach.plan.course.putting.short': 'bucket',
  'stats.my.coach.plan.course.putting.general': 'bucket',
  'stats.my.coach.plan.course.approach.short': 'bucket',
  'stats.my.coach.plan.course.approach.bunker': 'bucket',
  'stats.my.coach.plan.course.approach.distance': 'bucket',
  'stats.my.coach.plan.course.approach.side': 'bucket side',
  'stats.my.coach.plan.course.tee.trouble': 'bucket',
  'stats.my.coach.plan.course.tee.distance': 'bucket',
  'stats.my.coach.plan.course.tee.side': 'bucket side',
  'stats.my.coach.plan.course.short.sand': 'bucket',
  'stats.my.coach.plan.course.short.chip': 'bucket',
  'stats.my.coach.plan.course.penalty.tee': 'bucket',
  'stats.my.coach.plan.course.penalty.other': 'bucket',
  'stats.my.coach.plan.course.area.offTheTee': 'bucket',
  'stats.my.coach.plan.course.area.approach': 'bucket',
  'stats.my.coach.plan.course.area.aroundGreen': 'bucket',
  'stats.my.coach.plan.course.area.putting': 'bucket',
  'stats.my.coach.plan.course.area.penalties': 'bucket',
  'stats.my.coach.plan.course.collect': '',
  // Weekly plan: log asks
  'stats.my.coach.plan.log.possible': 'rounds',
  'stats.my.coach.plan.log.insufficient': 'area',
  'stats.my.coach.plan.log.collect': '',
  // Weekly plan: re-plan note
  'stats.my.coach.plan.replanned': 'course date what',
  'stats.my.coach.plan.changed.topLeak': 'area',
  'stats.my.coach.plan.changed.cause': 'area',
  'stats.my.coach.plan.changed.second': 'area',
  'stats.my.coach.plan.changed.keep': 'area',
  'stats.my.coach.plan.changed.level': 'level',
  'stats.my.coach.plan.changed.tieStarted': '',
  'stats.my.coach.plan.changed.tieEnded': '',
  'stats.my.coach.plan.changed.swingAdded': '',
  'stats.my.coach.plan.changed.swingRemoved': '',
  'stats.my.coach.plan.changed.collect': '',
  'stats.my.coach.plan.changed.leakFound': '',
  'stats.my.coach.plan.changed.and': 'a b',
};

// Keys whose copy does not show the bucket, though the store sends it: the
// bucket is shown only where the leak always has one (putting lag/short, approach).
const BUCKET_SHOWN = new Set([
  'stats.my.coach.plan.course.putting.lag',
  'stats.my.coach.plan.course.putting.short',
  'stats.my.coach.plan.course.approach.short',
  'stats.my.coach.plan.course.approach.bunker',
  'stats.my.coach.plan.course.approach.distance',
  'stats.my.coach.plan.course.approach.side',
]);
const isInert = (key, param) => {
  if (key.startsWith('stats.my.coach.cause.')) return false;
  if (param === 'bucket') return key.includes('.why.') || (key.includes('.course.') && !BUCKET_SHOWN.has(key));
  if (param === 'course') return key === 'stats.my.coach.plan.replanned';
  return false;
};

const placeholders = (entry) => {
  const texts = typeof entry === 'object' ? [entry.one, entry.other] : [entry];
  const names = new Set();
  texts.forEach((text) => {
    for (const m of String(text).matchAll(/\{(\w+)\}/g)) names.add(m[1]);
  });
  return [...names].sort();
};

const KEYS = Object.keys(PASSED);
const COACH_PREFIX = /^stats\.my\.coach\.(cause|swing|plan)\./;

describe('coach catalogue', () => {
  test('every emitted key exists in en and es', () => {
    for (const key of KEYS) {
      expect([key, en[key] !== undefined]).toEqual([key, true]);
      expect([key, es[key] !== undefined]).toEqual([key, true]);
    }
  });

  test('no orphan coach keys: every coach key in either locale is emitted by a store', () => {
    const coachKeys = (cat) => Object.keys(cat).filter((k) => COACH_PREFIX.test(k));
    expect(coachKeys(en).sort()).toEqual([...KEYS].sort());
    expect(coachKeys(es).sort()).toEqual([...KEYS].sort());
  });

  test('en and es use the same placeholders', () => {
    for (const key of KEYS) {
      expect([key, placeholders(es[key])]).toEqual([key, placeholders(en[key])]);
    }
  });

  test('every placeholder is a param the store passes', () => {
    for (const key of KEYS) {
      const passed = PASSED[key].split(' ').filter(Boolean);
      for (const name of placeholders(en[key])) {
        expect([key, passed.includes(name)]).toEqual([key, true]);
      }
    }
  });

  test('every param the store passes is used in the sentence, unless inert', () => {
    for (const key of KEYS) {
      const used = placeholders(en[key]);
      for (const name of PASSED[key].split(' ').filter(Boolean)) {
        if (isInert(key, name)) continue;
        expect([key, name, used.includes(name)]).toEqual([key, name, true]);
      }
    }
  });

  test('plural entries are session counts, { one, other } in both languages', () => {
    const sessionKeys = KEYS.filter((k) => k.startsWith('stats.my.coach.plan.session.'));
    expect(sessionKeys).toHaveLength(SESSION_KINDS.length);
    for (const key of sessionKeys) {
      for (const cat of [en, es]) {
        expect([key, Object.keys(cat[key]).sort()]).toEqual([key, ['one', 'other']]);
        expect([key, cat[key].one.includes('{count}'), cat[key].other.includes('{count}')])
          .toEqual([key, true, true]);
      }
    }
    for (const kind of SESSION_KINDS) {
      expect(KEYS).toContain(`stats.my.coach.plan.session.${kind}`);
    }
  });

  test('the closed sets in the store have their copy', () => {
    for (const strength of STRENGTHS) {
      expect(KEYS).toContain(`stats.my.coach.cause.lead.${strength}`);
    }
    for (const category of SG_CATEGORIES) {
      expect(KEYS).toContain(`stats.my.coach.plan.area.${category}`);
      expect(KEYS).toContain(`stats.my.coach.plan.course.area.${category}`);
    }
  });

  test('the store sources still use these namespaces', () => {
    expect(storeSource('coachCauses.js')).toContain("'stats.my.coach.cause.'");
    expect(storeSource('coachSwingLink.js')).toContain("'stats.my.coach.swing.'");
    expect(storeSource('coachWeeklyPlan.js')).toContain("'stats.my.coach.plan.'");
  });
});
