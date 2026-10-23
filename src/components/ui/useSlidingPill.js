import { useEffect, useRef, useState } from 'react';
import {
  useSharedValue, useAnimatedStyle, withSpring, useReducedMotion,
} from 'react-native-reanimated';
import { spring } from '../../theme/motion';

// The selected-side fill of a segmented control: one pill that slides to
// the active item instead of each item painting its own background. Until the
// items have been measured the active item paints itself (`measured` false),
// so the first frame is never empty. Render the pill as an absolute
// Animated.View (left 0, top/bottom = the container padding) before the items:
//   const { pillStyle, onItemLayout, measured } = useSlidingPill(activeIndex);
//   {measured && <Animated.View style={[pillBase, pillStyle]} />}
//   item: onLayout={onItemLayout(i)}, own fill only when `on && !measured`
export default function useSlidingPill(activeIndex) {
  const reduced = useReducedMotion();
  const [layouts, setLayouts] = useState({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const placed = useRef(false);
  const target = layouts[activeIndex];

  useEffect(() => {
    if (!target) return;
    if (!placed.current || reduced) {
      x.value = target.x;
      w.value = target.width;
      placed.current = true;
      return;
    }
    x.value = withSpring(target.x, spring.soft);
    w.value = withSpring(target.width, spring.soft);
  }, [target, reduced, x, w]);

  const pillStyle = useAnimatedStyle(() => ({ width: w.value, transform: [{ translateX: x.value }] }));
  const onItemLayout = (i) => (e) => {
    const { x: lx, width } = e.nativeEvent.layout;
    setLayouts((prev) => (prev[i]?.x === lx && prev[i]?.width === width ? prev : { ...prev, [i]: { x: lx, width } }));
  };
  return { pillStyle, onItemLayout, measured: !!target };
}
