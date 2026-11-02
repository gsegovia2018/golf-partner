// Finish estimate + daylight warning as inline text, for lines that already
// exist (the scorecard's standings line, the game's progress row, the full
// table's title). Nested <Text>: it inherits the host line's style.
//   ok    → "fin ≈ 15:40"
//   tight → "fin 18:32 · ☾ luz hasta 18:40"
//   risk  → "☾ sin luz en el 17" (finishing is moot; the hole is what matters)
// `lead` is the host's own text ("Empate · faltan 8"), joined with " · ".
import React from 'react';
import { Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';
import { useT } from '../i18n';
import { clockLabel } from '../store/roundPace';

export function paceA11yLabel(pace, t) {
  if (!pace) return null;
  const time = clockLabel(pace.finishAt);
  if (pace.level === 'risk') return t('scorecard.pace.a11yDark', { hole: pace.darkHole, time: clockLabel(pace.dusk) });
  const finish = t('scorecard.pace.a11yFinish', { time });
  return pace.level === 'tight' ? `${finish}. ${t('scorecard.pace.a11yLight', { time: clockLabel(pace.dusk) })}` : finish;
}

export default function RoundPaceText({ pace, lead = null, style, testID }) {
  const { theme } = useTheme();
  const t = useT();
  if (!pace && lead == null) return null;
  if (!pace) return <Text style={style}>{lead}</Text>;
  const warn = { color: theme.isDark ? semantic.warning.dark : semantic.warning.light, fontFamily: 'PlusJakartaSans-Bold' };
  const moon = <Feather name="moon" size={11} color={warn.color} />;
  const sep = lead != null ? `${lead} · ` : '';
  const a11y = lead != null ? `${lead}. ${paceA11yLabel(pace, t)}` : paceA11yLabel(pace, t);
  let body;
  if (pace.level === 'risk') {
    body = <Text style={warn}>{moon} {t('scorecard.pace.dark', { hole: pace.darkHole })}</Text>;
  } else if (pace.level === 'tight') {
    body = (
      <>
        {t('scorecard.pace.finishTight', { time: clockLabel(pace.finishAt) })}{' · '}
        <Text style={warn}>{moon} {t('scorecard.pace.light', { time: clockLabel(pace.dusk) })}</Text>
      </>
    );
  } else {
    body = t('scorecard.pace.finish', { time: clockLabel(pace.finishAt) });
  }
  return (
    <Text style={style} accessibilityLabel={a11y} testID={testID}>
      {sep}{body}
    </Text>
  );
}
