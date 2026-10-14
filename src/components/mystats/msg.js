import { tr, t, formatNumber } from '../../i18n';

const ZERO = /^0([.,]0+)?$/;

// A n() param from store/statsMsg.js: the raw number, formatted in the
// active language at render time.
function renderNumber(v) {
  if (v.n == null || !Number.isFinite(Number(v.n))) return '';
  const opts = v.decimals != null ? { decimals: v.decimals } : { maxDecimals: v.maxDecimals ?? 2 };
  let text = formatNumber(Number(v.n), opts);
  if (v.noMinus) text = text.replace('-', '');
  if (v.signed && Number(v.n) > 0 && !ZERO.test(text) && !text.startsWith('-')) text = `+${text}`;
  return text;
}

// Renders a { key, params } descriptor built by a pure store module. Params
// that are themselves descriptors (a translated label inside a sentence) or
// n() numbers are rendered first. Components call useT() so they re-render
// on a language switch; this reads the active language at render time.
export function renderMsg(msg) {
  if (!msg) return '';
  const params = {};
  Object.entries(msg.params ?? {}).forEach(([name, value]) => {
    if (value && typeof value === 'object') {
      if (value.key) {
        const text = renderMsg(value);
        params[name] = value.lower ? text.toLowerCase() : text;
      } else if ('n' in value) {
        params[name] = renderNumber(value);
      } else {
        params[name] = value;
      }
    } else {
      params[name] = value;
    }
  });
  return tr({ ...msg, params });
}

// A descriptor when there is one, else the plain string (data saved or
// passed in without descriptors).
export const msgText = (msg, fallback = '') => (msg ? renderMsg(msg) : fallback);

// A number as it is shown plain: whole stays whole, decimals follow the language.
export const num = (value) => formatNumber(value, { maxDecimals: 4 });

// "{count} sample(s)" for the evidence chips.
export const sampleLabel = (sample) => (sample == null ? null : t('stats.my.sample', { count: sample }));

// Drill copy lives in the catalogue by drill id (store/coachDrills.js keeps
// the English); an unknown id falls back to the drill's own English text.
export function drillText(drill, field) {
  if (!drill) return '';
  const key = `stats.my.drill.${drill.id}.${field}`;
  const out = t(key);
  return out === key ? drill[field === 'pass' ? 'passTarget' : field] : out;
}

// The coach area ("Putting") in the active language: by area id, else the
// stored English label.
export function areaText(item) {
  const area = item?.area;
  if (area) {
    const key = `stats.my.area.${area}`;
    const out = t(key);
    if (out !== key) return out;
  }
  return item?.areaLabel ?? item?.area ?? t('stats.my.coach.name');
}

export const drillLocation = (location) => {
  const key = `stats.my.drill.loc.${location}`;
  const out = t(key);
  return out === key ? location : out;
};
