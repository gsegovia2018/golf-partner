import React from 'react';
import { View } from 'react-native';
import { useResponsive } from '../theme/responsive';

// Pure: flexBasis for one cell given the column count. The values sit a few
// points under the exact fraction (100/2, 100/3) so the row `gap` between
// cells fits without forcing an extra wrap. They are calibrated for the
// default gap (12) used by CardGrid; a substantially larger gap would need
// these adjusted.
export function cardCellBasis(columns) {
  if (columns === 2) return '48%';
  if (columns === 3) return '31%';
  return '100%';
}

// Lays its children out in a wrapping row. On compact widths gridColumns is 1,
// so this is a plain vertical stack — identical to the previous list layout.
// `columns` may be passed to override the responsive default (e.g. to cap a
// list at 2 columns even on very wide windows).
export default function CardGrid({ children, columns, gap = 12, style }) {
  const responsive = useResponsive();
  const cols = columns ?? responsive.gridColumns;
  const basis = cardCellBasis(cols);
  const items = React.Children.toArray(children);

  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap }, style]}>
      {items.map((child) => (
        <View key={child.key} style={{ flexBasis: basis, flexGrow: 0, minWidth: 0 }}>
          {child}
        </View>
      ))}
    </View>
  );
}
