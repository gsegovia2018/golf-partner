// Playfair's default figures are old-style: 3, 4, 5, 7 and 9 drop below the
// baseline, 6 and 8 rise above x-height, the rest sit on it. So a number's ink
// centre is not its line box's centre, and a figure "centred" in a circle sits
// visibly low (a 3 at 48 px: ~11 px). figureLift(text, fontSize) is how far to
// lift a Playfair Bold number so its ink centres where its line box does.
// Ink [bottom, top] per digit from PlayfairDisplay_700Bold, per 1000 em.
const INK = {
  0: [-14, 531], 1: [0, 528], 2: [-5, 531], 3: [-151, 531], 4: [-141, 531],
  5: [-148, 555], 6: [-14, 723], 7: [-148, 521], 8: [-14, 722], 9: [-152, 531],
};
// Centre of the line box: hhea ascent 1082, descent -251.
const LINE_CENTRE = (1082 - 251) / 2;

export function figureLift(text, fontSize) {
  const digits = String(text ?? '').split('');
  if (!digits.length || !digits.every((d) => INK[d])) return 0;
  const bottom = Math.min(...digits.map((d) => INK[d][0]));
  const top = Math.max(...digits.map((d) => INK[d][1]));
  return ((LINE_CENTRE - (bottom + top) / 2) / 1000) * fontSize;
}
