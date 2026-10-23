// The league screens' two button shapes, declared once. `buttonStyles(theme)`
// is the style set for screens that already render their own touchables (spread
// it into makeStyles, then override margins locally); PrimaryButton and
// SecondaryButton are the ready-made components for new code.
//
// Primary: Clubhouse Green, ExtraBold 14, 14px radius, 14px vertical padding.
// Secondary: hairline border, Slate text (Bold 14). `secondaryTextAccent` is
// the green-text variant used inside sheets and beside a primary action.
// `icon` / `iconRight` (Feather names) sit before / after the label in its colour;
// `numberOfLines` caps the label. `busy` shrinks the button to a circle around a
// spinner; `done` turns that circle into a check (pass it for a moment after a
// save lands, then clear it). Both keep the touch target's size.
import React from 'react';
import { Text, ActivityIndicator, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withSpring, useReducedMotion,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { duration, ease, spring } from '../../theme/motion';
import PressableScale from './PressableScale';

export function buttonStyles(theme) {
  return {
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.primary, borderRadius: 14, paddingVertical: 14, minHeight: 48,
    },
    primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14, textAlign: 'center' },
    secondaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14,
      borderWidth: 1, borderColor: theme.border.default, paddingVertical: 14, paddingHorizontal: 16, minHeight: 48,
    },
    secondaryText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14, textAlign: 'center' },
    secondaryTextAccent: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14, textAlign: 'center' },
  };
}

function Base({
  variant, label, onPress, disabled, busy, done, accent, style, textStyle, icon, iconRight, numberOfLines, children, ...rest
}) {
  const { theme } = useTheme();
  const b = buttonStyles(theme);
  const reduced = useReducedMotion();
  const primary = variant === 'primary';
  const textBase = primary ? b.primaryText : (accent ? b.secondaryTextAccent : b.secondaryText);
  const iconColor = StyleSheet.flatten([textBase, textStyle]).color;
  const inkColor = primary ? theme.text.inverse : theme.text.secondary;

  // The fill and border live on an absolute "shape" layer, so busy / done can
  // shrink the shape to a circle while the touch target keeps its size and
  // nothing around the button reflows. Callers' colour overrides follow it.
  const {
    backgroundColor, borderColor, borderWidth, borderRadius = 14, ...box
  } = StyleSheet.flatten([primary ? b.primaryBtn : b.secondaryBtn, (icon || iconRight) && styles.withIcon, style]);

  const [size, setSize] = React.useState(null);
  const shrunk = !!(busy || done);
  const p = useSharedValue(shrunk ? 1 : 0);
  const check = useSharedValue(done ? 1 : 0);
  React.useEffect(() => {
    p.value = reduced ? (shrunk ? 1 : 0) : withTiming(shrunk ? 1 : 0, { duration: duration.place, easing: ease.out });
  }, [shrunk, reduced, p]);
  React.useEffect(() => {
    check.value = reduced || !done ? (done ? 1 : 0) : withDelay(duration.touch, withSpring(1, spring.snappy));
  }, [done, reduced, check]);

  const shapeStyle = useAnimatedStyle(() => {
    if (!size) return {};
    const inset = p.value * Math.max(0, (size.w - size.h) / 2);
    return {
      left: inset, right: inset,
      borderRadius: borderRadius + p.value * (size.h / 2 - borderRadius),
    };
  });
  const contentStyle = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [{ scale: 1 - p.value * 0.15 }],
  }));
  const spinnerStyle = useAnimatedStyle(() => ({ opacity: p.value * (1 - check.value) }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: check.value, transform: [{ scale: 0.5 + check.value * 0.5 }] }));

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      {...rest}
      onPress={onPress}
      disabled={disabled || busy || done}
      activeScale={0.97}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setSize((prev) => (prev?.w === w && prev?.h === h ? prev : { w, h }));
        rest.onLayout?.(e);
      }}
      style={[box, (disabled || busy) && !shrunk && styles.off]}
    >
      {({ pressed }) => (
        <>
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor, borderColor, borderWidth, borderRadius },
              primary && pressed && { backgroundColor: theme.accent.pressed },
              !primary && pressed && { backgroundColor: theme.bg.secondary },
              shapeStyle,
            ]}
          />
          <Animated.View style={[styles.content, (icon || iconRight) && styles.withIcon, contentStyle]}>
            {children}
            {icon ? <Feather name={icon} size={18} color={iconColor} /> : null}
            {label != null ? <Text style={[textBase, textStyle]} numberOfLines={numberOfLines}>{label}</Text> : null}
            {iconRight ? <Feather name={iconRight} size={18} color={iconColor} /> : null}
          </Animated.View>
          {busy ? (
            <Animated.View pointerEvents="none" style={[styles.center, spinnerStyle]}>
              <ActivityIndicator color={inkColor} />
            </Animated.View>
          ) : null}
          {done ? (
            <Animated.View pointerEvents="none" style={[styles.center, checkStyle]}>
              <Feather name="check" size={22} color={inkColor} />
            </Animated.View>
          ) : null}
        </>
      )}
    </PressableScale>
  );
}

export function PrimaryButton(props) { return <Base variant="primary" {...props} />; }
export function SecondaryButton(props) { return <Base variant="secondary" {...props} />; }

const styles = StyleSheet.create({
  off: { opacity: 0.5 },
  withIcon: { gap: 8 },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
