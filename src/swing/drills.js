// Drill catalogue for the swing faults (plan 5.6). Text in the catalogues, same shape as
// store/coachDrills.js: every drill has a measurable pass target. `also` lists other faults
// the drill serves (after that fault's own drills); `checks` lists the checks it targets, so
// the drill leads when one of them is the main fault's evidence (D24). Every drill shows the
// same progression line under it (PROGRESSION). The ids are stable keys
// stored in analysis.json, so they are not translated.

import { t } from '../i18n';

// English text, kept as an export for compatibility; the screens read progression() (language-aware).
export const PROGRESSION = 'Start slow with a 7-iron and film it from behind. Speed up only once the position holds on video, and build to full swings over a few sessions.';

/** The progression line under every drill, in the active language. */
export const progression = () => t('swing.drill.progression');

const L = Symbol('swing.drill.leaf');

// title / instruction / passTarget come from the catalogue ('swing.drill.<id>.<field>') as getters.
const localised = (drill) => {
  const out = {};
  Object.entries(drill).forEach(([k, v]) => {
    if (v === L) Object.defineProperty(out, k, { enumerable: true, get: () => t(`swing.drill.${drill.id}.${k}`) });
    else out[k] = v;
  });
  return out;
};

export const DRILLS = [
  {
    id: 'su-brazos', fault: 'posture', checks: ['hands_under_shoulders'], title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'su-palo-espalda', fault: 'posture', checks: ['back_line'], title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'su-rodillas', fault: 'posture', checks: ['knee_flex'], title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'pl-columna', fault: 'posture_loss', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'pl-rodilla', fault: 'posture_loss', checks: ['knee_hold'], title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'tk-plano', fault: 'steep_backswing', checks: ['clubhead_plane_takeaway'], also: ['flat_backswing'], title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'pl-vidrio', fault: 'top_position', checks: ['lead_arm_spine', 'hands_over_heels'], also: ['steep_backswing', 'across_the_line'],
    title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'pl-palo-atras', fault: 'over_the_top', checks: ['down_vs_takeaway'], also: ['flat_backswing', 'flip'],
    title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'ee-silla', fault: 'early_extension', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'ee-pared', fault: 'early_extension', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'ee-palo-talones', fault: 'early_extension', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'ott-toalla', fault: 'over_the_top', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'ott-caja', fault: 'over_the_top', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'ott-pausa', fault: 'over_the_top', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'st-salida', fault: 'stuck', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'fl-freeze', fault: 'flip', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'sb-plano', fault: 'steep_backswing', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'fb-codo', fault: 'flat_backswing', also: ['top_position'], title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'atl-objetivo', fault: 'across_the_line', also: ['top_position'], title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'lo-objetivo', fault: 'laid_off', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'hs-bola-cabeza', fault: 'head_sway', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'tf-tres-uno', fault: 'tempo_fast', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'ts-suelta', fault: 'tempo_slow', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'bal-tres-seg', fault: 'balance', title: L,
    instruction: L,
    passTarget: L,
  },
  {
    id: 'po-espejo', fault: 'posture', title: L,
    instruction: L,
    passTarget: L,
  },
].map(localised);

/** The main fault's drills: those aimed at its evidence checks first, then the fault's own (D24). */
export function drillsForMain(main) {
  if (!main) return [];
  const ev = new Set((main.evidence || []).map((c) => c.id));
  const all = drillsForFault(main.fault);
  const aimed = DRILLS.filter((d) => d.checks?.some((id) => ev.has(id)));
  return [...new Set([...aimed, ...all])];
}

export const DRILL_FAULTS = [...new Set(DRILLS.flatMap((d) => [d.fault, ...(d.also || [])]))];

/**
 * The catalogue rows for a fault: its own drills in order, then the ones it borrows from a
 * neighbouring fault (`also`). The results card shows the first two.
 */
export const drillsForFault = (fault) => [
  ...DRILLS.filter((d) => d.fault === fault),
  ...DRILLS.filter((d) => d.fault !== fault && d.also?.includes(fault)),
];
