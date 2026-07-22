import React from 'react';
import Svg, { Path } from 'react-native-svg';

// A minimalist golf iron: a diagonal shaft with an angled club head. No
// bundled icon set (Feather/MCI/Ionicons) ships a golf-club glyph, so this is
// hand-drawn. `size` is the square box; `color` paints both shaft and head.
export function ClubIcon({ size = 24, color = '#0a0d10' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M17.5 3.2 8.2 15.6" stroke={color} strokeWidth={2.1} strokeLinecap="round" />
      <Path
        d="M8.6 15.1 6.2 20.4c-.3.7.4 1.4 1.1 1.1l5.1-2.3c.5-.2.6-.9.2-1.3l-2.7-2.9c-.4-.4-1-.3-1.3 0Z"
        fill={color}
      />
    </Svg>
  );
}
