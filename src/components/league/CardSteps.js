import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';

const STEPS = ['announce', 'play', 'send', 'confirm'];
const DOT = 24;

// "Tu tarjeta"'s path through the month: Anunciar · Jugar · Enviar · Confirmar.
// `step` (0-4) is the current one, 4 = all done; `wait` marks the current step
// as waiting on someone else (amber). leagueView.yourCardStep decides both.
export default function CardSteps({ step, wait = false }) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const warn = theme.isDark ? theme.semantic.warning.dark : theme.semantic.warning.light;
  const label = step >= STEPS.length
    ? t('league.home.steps.done')
    : t('league.home.steps.a11y', { n: step + 1, step: t(`league.home.steps.${STEPS[step]}`) });
  const slot = 100 / STEPS.length;
  return (
    <View style={s.track} accessible accessibilityLabel={label}>
      {/* The line sits in its own layer under the dots: from one dot's centre
          to the next, green up to the current step. */}
      {STEPS.slice(1).map((key, i) => (
        <View
          key={key}
          style={[s.line, { left: `${slot * (i + 0.5)}%`, width: `${slot}%` }, i + 1 <= step && s.lineOn]}
        />
      ))}
      {STEPS.map((key, i) => {
        const done = i < step;
        const cur = i === step;
        const ring = cur ? (wait ? warn : theme.accent.primary) : null;
        return (
          <View key={key} style={s.step}>
            <View style={[s.dot, done && s.dotDone, ring && { borderColor: ring }]}>
              {done && <Feather name="check" size={12} color={theme.text.inverse} />}
              {cur && <View style={[s.inner, { backgroundColor: ring }]} />}
            </View>
            <Text style={[s.label, (done || cur) && s.labelOn, cur && s.labelCur]} numberOfLines={1}>
              {t(`league.home.steps.${key}`)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(theme) {
  // Steps not reached yet: the hairline border reads on a light card, but on
  // the dark canvas (7% white) the rings vanish, so dark uses the muted text.
  const idle = theme.isDark ? theme.text.muted : theme.border.default;
  return StyleSheet.create({
    track: { flexDirection: 'row', marginTop: 4, marginBottom: 14 },
    step: { flex: 1, alignItems: 'center', gap: 6 },
    line: { position: 'absolute', top: DOT / 2 - 1, height: 2, backgroundColor: idle },
    lineOn: { backgroundColor: theme.accent.primary },
    dot: {
      width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2, borderColor: idle,
      // Opaque, so the line stops at the ring (dark bg.card is a tint).
      backgroundColor: theme.isDark ? theme.bg.primary : theme.bg.card, alignItems: 'center', justifyContent: 'center',
    },
    dotDone: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    inner: { width: 8, height: 8, borderRadius: 4 },
    label: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: theme.text.secondary },
    labelOn: { color: theme.text.primary },
    labelCur: { fontFamily: 'PlusJakartaSans-ExtraBold' },
  });
}
