import React from 'react';
import Svg, { Path } from 'react-native-svg';

// Solid golf-club silhouette. Glyph from the MIT-licensed @icons set
// (github.com/Voxybuns/at-icons, "golf-club"). No bundled icon font ships a
// golf club, so it's embedded here. `size` is the square box; `color` fills
// the club. Rendered white on the green measure FAB.
export function ClubIcon({ size = 24, color = '#0a0d10' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        fill={color}
        d="M14.293 3a.707.707 0 0 1 .5 1.207l-8.23 8.23c-.366.366-.84.605-1.351.684l-.068.01C2.67 13.513.734 11.04 1.696 8.73a.8.8 0 0 1 1.037-.435l3.655 1.46a1 1 0 0 0 1.078-.22l6.327-6.327a.7.7 0 0 1 .5-.207"
      />
    </Svg>
  );
}
