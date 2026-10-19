import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import PressableScale from '../ui/PressableScale';
import { useTheme } from '../../theme/ThemeContext';
import { useSwingTone } from './swingTone';
import { Overline, swingType } from './swingStyles';
import { SWING_STRINGS } from '../../swing/strings';
import { STEPS, EXTRAS, tagOf } from '../../swing/resultsSteps';

const R = SWING_STRINGS.results;
export const stepName = (k) => (k === EXTRAS ? R.extras : SWING_STRINGS.checkpoint[k]);

/**
 * The top of the results screen (checks v2, polish): the verdict and the position strip.
 * Verdict: "Work on first" over the fault's name (the one thing to read), then where it shows and
 * where it starts ("Downswing · starts at Top ›"), what it likely causes, and, while the Downswing
 * clubhead is unplaced, the place line. Strip: seven position dots and the Extras step; a dot is a
 * tab (a tap jumps to its step). The main fault's position wears a red ring instead of a text badge;
 * a position waiting for its clubhead is a dashed "+"; the Extras dot is a ring because extras never
 * colour a position. Status is a dot AND a word in each tab's a11y label.
 */
export default function SwingSummary({
  statuses, pending = {}, main, soFar = false, ask = null, current, onSelect, onAsk, unconfirmed = 0,
}) {
  const { theme } = useTheme();
  const tone = useSwingTone();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const fault = main ? SWING_STRINGS.fault[main.fault] ?? main.label : null;
  // "Every position is green" only when all seven are measured; a missing clubhead or nothing measured says so
  const positions = STEPS.filter((k) => k !== EXTRAS);
  const waiting = positions.some((k) => pending[k]);
  const measured = positions.filter((k) => statuses[k] !== 'unknown');
  const noFault = measured.length === positions.length && !waiting ? { line: R.noFaultAll, why: true }
    : waiting ? { line: R.noFaultPlace, why: false }
      : measured.length ? { line: R.noFaultSoFar, why: false } : { line: R.nothingMeasured, why: false };
  // what the summary asks for: a clubhead that unlocks a row, or the ball when the address plane is missing
  const askText = ask ? (ask.kind === 'ball' ? R.askBall : R.placeToFinish(stepName(ask.cp))) : null;
  const mainStep = main ? main.position ?? EXTRAS : null;
  const alsoCausing = main?.consequences?.length
    ? R.alsoCausing(main.consequences.map((f) => SWING_STRINGS.fault[f] ?? f)) : null;
  const verdictTone = main ? tone[main.status === 'yellow' ? 'yellow' : 'red'] : measured.length === positions.length && !waiting ? tone.green : tone.unknown;

  return (
    <View style={s.wrap} testID="results-summary">
      <View style={s.verdict}>
        <View style={s.labelRow}>
          <View style={[s.labelDot, { backgroundColor: verdictTone }]} />
          <Overline testID="results-verdict-label">{main ? (soFar ? R.mainSoFar : R.workFirst) : R.noFaultTitle}</Overline>
        </View>
        <Text style={s.title} accessibilityRole="header" testID="results-headline">{main ? fault : noFault.line}</Text>
        {main ? (
          <View style={s.metaRow}>
            <Text style={s.meta}>{stepName(mainStep)}</Text>
            {main.startsAt ? (
              <PressableScale
                style={s.startsBtn}
                onPress={() => onSelect(main.startsAt)}
                accessibilityRole="button"
                accessibilityLabel={R.startsAt(stepName(main.startsAt))}
                testID="results-starts-at"
              >
                <Text style={s.meta}>
                  {' · '}
                  <Text style={s.startsLink}>{`${R.startsAtShort(stepName(main.startsAt))} ›`}</Text>
                </Text>
              </PressableScale>
            ) : null}
          </View>
        ) : null}
        {alsoCausing ? <Text style={s.also} testID="results-also-causing">{alsoCausing}</Text> : null}
        {!main && noFault.why ? <Text style={s.also}>{R.noFaultWhy}</Text> : null}
        {soFar && ask ? (
          <PressableScale
            style={s.placeLine}
            onPress={() => onAsk(ask)}
            accessibilityRole="button"
            accessibilityLabel={askText}
            testID="results-place-line"
          >
            <View style={[s.dot, s.dotWait, { borderColor: tone.unknown }]} />
            <Text style={s.placeText}>{askText}</Text>
            <View style={s.placeBtn}><Text style={s.placeBtnText}>{ask.kind === 'ball' ? R.markBall : R.place}</Text></View>
          </PressableScale>
        ) : null}
        {unconfirmed ? <Text style={s.hint} testID="results-unconfirmed">{R.unconfirmedChip(unconfirmed)}</Text> : null}
      </View>

      <View style={s.strip} accessibilityRole="tablist">
        {STEPS.map((k) => {
          const on = k === current;
          const st = statuses[k];
          const wait = !!pending[k];
          const tag = tagOf(k, main);
          const word = wait ? R.stateNoHead : (st === 'unknown' ? '—' : SWING_STRINGS.statusWord[st]);
          const label = `${R.stepA11y(stepName(k), word)}${tag === 'first' ? `, ${R.tagFirst}` : tag === 'starts' ? `, ${R.tagStarts}` : ''}`;
          const ring = tag === 'first' ? { borderColor: tone.red } : null;
          return (
            <PressableScale
              key={k}
              style={[s.seg, on && s.segOn]}
              onPress={() => onSelect(k)}
              activeScale={0.94}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
              testID={`summary-step-${k}`}
            >
              <View style={[s.ringSlot, ring && [s.ring, ring]]}>
                {wait ? (
                  <View style={[s.dot, s.dotWait, { borderColor: tone.unknown }]}><Text style={[s.plus, { color: tone.unknown }]}>+</Text></View>
                ) : k === EXTRAS ? (
                  <View style={[s.dot, s.dotRing, { borderColor: tone[st] ?? tone.unknown }]} />
                ) : (
                  <View style={[s.dot, { backgroundColor: tone[st] ?? tone.unknown }]} />
                )}
              </View>
              <Text style={[s.segName, on && s.segNameOn]} numberOfLines={1}>{SWING_STRINGS.position.short[k]}</Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (theme) => {
  const t = swingType(theme);
  return StyleSheet.create({
    wrap: { gap: 12 },
    verdict: { gap: 3, paddingHorizontal: 2 },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    labelDot: { width: 8, height: 8, borderRadius: 4 },
    title: { ...t.display, marginTop: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
    meta: { ...t.body, fontFamily: 'PlusJakartaSans-Medium' },
    startsBtn: { minHeight: 32, justifyContent: 'center' },
    startsLink: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary },
    also: { ...t.body },
    hint: { ...t.label, fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary },
    placeLine: {
      flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 10, marginTop: 6, borderRadius: 10, backgroundColor: theme.bg.secondary,
    },
    placeText: { ...t.bodyInk, flex: 1, fontFamily: 'PlusJakartaSans-Bold' },
    placeBtn: { minHeight: 32, borderRadius: 16, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: theme.accent.primary },
    placeBtnText: { ...t.label, fontSize: 13, color: theme.text.inverse },

    strip: {
      flexDirection: 'row', padding: 3, backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    },
    seg: { flex: 1, minHeight: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 0 },
    segOn: { backgroundColor: theme.accent.light },
    ringSlot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
    ring: {},
    dot: { width: 12, height: 12, borderRadius: 6 },
    dotRing: { borderWidth: 2, backgroundColor: 'transparent' },
    dotWait: { borderWidth: 2, borderStyle: 'dashed', backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
    plus: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 9, lineHeight: 10, marginTop: -1 },
    segName: { ...t.label, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, letterSpacing: -0.3, color: theme.text.secondary, textAlign: 'center' }, // one size for all eight: no shrink-to-fit
    segNameOn: { color: theme.text.primary },
  });
};
