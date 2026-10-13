/** A 6-digit hex token at the given opacity: `withAlpha(hud.accent, 0.4)` → 'rgba(79,174,138,0.4)'. */
export function withAlpha(hex, alpha) {
  const m = /^#([a-f\d]{6})$/i.exec(hex ?? '');
  if (!m) return 'transparent';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
