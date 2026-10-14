// Catalogue keys for the Report Card's English display strings (cell and
// group labels, verdicts). store/roundReportCard.js keeps emitting the
// English text; the card views look the key up by it and render in the
// active language. Unknown text falls back to itself.
const CELL_KEYS = {
  'Par 3s': 'stats.my.report.cell.par3',
  'Par 4s': 'stats.my.report.cell.par4',
  'Par 5s': 'stats.my.report.cell.par5',
  'Hard holes': 'stats.my.report.cell.hard',
  'Mid holes': 'stats.my.report.cell.mid',
  'Easy holes': 'stats.my.report.cell.easy',
  'Opening 3': 'stats.my.report.cell.opening',
  'Closing 3': 'stats.my.report.cell.closing',
  'Front 9': 'stats.my.report.cell.front',
  'Back 9': 'stats.my.report.cell.back',
  'Birdies+': 'stats.my.report.cell.birdies',
  Pars: 'stats.my.report.cell.pars',
  Bogeys: 'stats.my.report.cell.bogeys',
  'Blow-ups': 'stats.my.report.cell.blowups',
  Putts: 'stats.my.report.cell.putts',
  'Fairways hit %': 'stats.my.report.cell.fairways',
  'Greens in reg %': 'stats.my.report.cell.greens',
  Penalties: 'stats.my.report.cell.penalties',
};

const GROUP_KEYS = {
  course: 'stats.my.report.group.course',
  timing: 'stats.my.report.group.timing',
  distribution: 'stats.my.report.group.distribution',
  shots: 'stats.my.report.group.shots',
};

const VERDICT_KEYS = {
  'Standout round': 'stats.my.report.verdict.standout',
  'Strong round': 'stats.my.report.verdict.strong',
  'Solid round': 'stats.my.report.verdict.solid',
  'Off day': 'stats.my.report.verdict.offDay',
  'Tough day': 'stats.my.report.verdict.tough',
};

export const cellKey = (label) => CELL_KEYS[label];
export const groupKey = (key) => GROUP_KEYS[key];
export const verdictKey = (verdict) => VERDICT_KEYS[verdict];
