import React from 'react';
import Svg, { Path } from 'react-native-svg';

// A golf iron: a grip + shaft angling down into an angled blade club-head with
// a flat sole. No bundled icon set (Feather/MCI/Ionicons) ships a golf-club
// glyph, so it's hand-drawn. `size` is the square box; `color` paints the club.
export function ClubIcon({ size = 24, color = '#0a0d10' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* grip cap */}
      <Path d="M18.4 3.3 20 4.9" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      {/* shaft */}
      <Path d="M18.8 4.5 11.3 13" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      {/* iron head: hosel at the shaft, a blade sweeping to a flat sole */}
      <Path
        d="M12.5 11.7 6.4 17.3a2 2 0 0 0-0.15 2.75l0.35 0.4a2 2 0 0 0 2.85 0.2l6.2-5.55Z"
        fill={color}
      />
    </Svg>
  );
}
