import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withDelay, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';
import HolePlan, { PLAN_WIDTH, PLAN_HEIGHT } from './HolePlan';
import { useT } from '../../i18n';
import { useTheme } from '../../theme/ThemeContext';
import { BREAKPOINTS } from '../../theme/responsive';

const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
const CREAM = '#f6f3ee';
const CREAM_SOFT = 'rgba(246,243,238,0.82)';
// First-frame guess at the sheet's height; onLayout replaces it, and the plan
// panel takes the rest of the screen. Phones shift the plan right so the pond
// clears the wordmark.
const SHEET_HEIGHT = 480;
const SHEET_OVERLAP = 24;
const PHONE_PLAN = 'translate(46 -4) scale(.92)';

// Fade + rise once on mount (reduced motion ⇒ in place).
function useEntrance(delay, distance) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    progress.value = withDelay(delay, withTiming(1, { duration: 700, easing: EASE }));
  }, [reduced, delay, progress]);
  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * distance }],
  }));
}

function Wordmark({ wide, s }) {
  const t = useT();
  const title = useEntrance(150, 10);
  const caption = useEntrance(300, 10);
  return (
    <>
      <Animated.Text style={[s.wordmark, wide && s.wordmarkLarge, title]} accessibilityRole="header">
        Golf Partner
      </Animated.Text>
      <Animated.Text style={[s.caption, caption]}>{t('auth.plan.caption')}</Animated.Text>
      {wide && <Animated.Text style={[s.tagline, caption]}>{t('auth.plan.tagline')}</Animated.Text>}
    </>
  );
}

// The signed-out frame (login, set new password): an architect's plan of a
// hole drawn in on the brand's deep green, the wordmark over it, and
// `children` on an opaque bg.primary sheet below. Wide windows split it: plan
// on the left, children on the right.
export default function AuthShell({ children }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const { width, height } = useWindowDimensions();
  const [sheetH, setSheetH] = useState(SHEET_HEIGHT);
  const sheet = useEntrance(200, 24);

  if (width >= BREAKPOINTS.lg) {
    const planH = Math.min(height * 0.82, (width * 0.55) * (PLAN_HEIGHT / PLAN_WIDTH));
    const planW = planH * (PLAN_WIDTH / PLAN_HEIGHT);
    return (
      <View style={[s.screen, s.split]}>
        <View style={s.planSide}>
          <HolePlan width={planW} height={planH} />
          <View style={s.wordmarkWide}><Wordmark wide s={s} /></View>
        </View>
        <ScrollView
          style={s.formSide}
          contentContainerStyle={s.formSideContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[s.formColumn, sheet]}>{children}</Animated.View>
        </ScrollView>
      </View>
    );
  }

  const panelH = Math.max(240, height - sheetH + SHEET_OVERLAP);
  const planW = Math.min(width, (panelH - SHEET_OVERLAP / 2) * (PLAN_WIDTH / PLAN_HEIGHT));
  const planH = planW * (PLAN_HEIGHT / PLAN_WIDTH);
  // A short sheet leaves a tall panel: the plan sits on the sheet, not floating.
  const planTop = Math.max(0, panelH - SHEET_OVERLAP / 2 - planH);
  return (
    <View style={s.screen}>
      <ScrollView
        contentContainerStyle={{ minHeight: height }}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ height: panelH }}>
          <View style={[s.planPhone, { top: planTop }]}><HolePlan width={planW} height={planH} transform={PHONE_PLAN} /></View>
          <View style={s.wordmarkPhone}><Wordmark s={s} /></View>
        </View>
        <Animated.View style={[s.sheet, sheet]}>
          <View style={s.sheetInner} onLayout={(e) => setSheetH(Math.ceil(e.nativeEvent.layout.height))}>
            {children}
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.bg.deep,
  },
  planPhone: { position: 'absolute', top: 0, right: 0 },
  wordmarkPhone: { position: 'absolute', left: 24, top: 44, right: 24 },
  wordmark: {
    fontFamily: 'PlayfairDisplay-Bold', fontSize: 38, lineHeight: 44,
    letterSpacing: -0.5, color: CREAM,
  },
  wordmarkLarge: { fontSize: 52, lineHeight: 58 },
  caption: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, letterSpacing: 1.8,
    color: CREAM_SOFT, marginTop: 8,
  },
  tagline: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 16, lineHeight: 24,
    color: CREAM_SOFT, marginTop: 16, maxWidth: 360,
  },
  sheet: {
    flexGrow: 1, marginTop: -SHEET_OVERLAP,
    backgroundColor: theme.bg.primary,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: theme.isDark ? StyleSheet.hairlineWidth : 0,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  sheetInner: {
    width: '100%', maxWidth: 480, alignSelf: 'center',
    paddingHorizontal: 24, paddingTop: 24, paddingBottom: 28,
  },
  split: { flexDirection: 'row' },
  planSide: { flex: 1.2, justifyContent: 'center', alignItems: 'center' },
  wordmarkWide: { position: 'absolute', left: 56, top: 56, right: 56 },
  formSide: { flex: 1, backgroundColor: theme.bg.primary },
  formSideContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 48 },
  formColumn: { width: '100%', maxWidth: 400, alignSelf: 'center', paddingHorizontal: 24 },
});
