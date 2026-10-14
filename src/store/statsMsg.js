// Message-descriptor builders for the My Stats stores (docs/i18n.md, "Pure
// store modules"). A descriptor is { key, params }; the screen renders it
// with renderMsg (components/mystats/msg.js). Stores stay pure: no language
// is read here, so a descriptor built before a language switch still renders
// correctly after it. Numbers go in raw, via n(), and are formatted at render.

export const msg = (key, params) => ({ key, params });

// A number param, formatted when rendered: n(1.2, { signed: true }).
// Options: decimals | maxDecimals (default 2), signed (+ for positives),
// noMinus (drop the leading minus: "costing 0.4").
export const n = (value, opts = {}) => ({ n: value, ...opts });

// The same descriptor, lower-cased when rendered (a title inside a sentence).
export const lower = (m) => ({ ...m, lower: true });

// Text with no translation (user data, an unknown label).
export const raw = (text) => msg('stats.my.raw', { text });
