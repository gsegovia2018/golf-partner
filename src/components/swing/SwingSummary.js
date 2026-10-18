import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import PressableScale from '../ui/PressableScale';
import { useTheme } from '../../theme/ThemeContext';
import { useSwingTone } from './swingTone';
import { SWING_STRINGS } from '../../swing/strings';
import { STEPS, EXTRAS, tagOf } from '../../swing/resultsSteps';

const R = SWING_STRINGS.results;
export const stepName = (k) => (k === EXTRAS ? R.extras : SWING_STRINGS.checkpoint[k]);

/**
 * The summary of the results screen (checks v2, design D): seven position dots and the Extras step,
 * "Work on first: <position> · <fault>", "Likely starts at: <position> ›" and, while the Downswing
 * clubhead is unplaced, "Main fault so far" with the place line. A dot is a tab: a tap jumps to its
 * step. Status is a dot AND a word in the a11y label; a position waiting for its clubhead is a dashed
 * "+"; the Extras dot is a ring because extras never colour a position.
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

  return (
    <View style={s.card} testID="results-summary">
      <View style={s.segs} accessibilityRole="tablist">
        {STEPS.map((k) => {
          const on = k === current;
          const st = statuses[k];
          const wait = !!pending[k];
          const tag = tagOf(k, main);
          const word = wait ? R.stateNoHead : (st === 'unknown' ? '—' : SWING_STRINGS.statusWord[st]);
          const label = `${R.stepA11y(stepName(k), word)}${tag === 'first' ? `, ${R.tagFirst}` : tag === 'starts' ? `, ${R.tagStarts}` : ''}`;
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
              {wait ? (
                <View style={[s.dot, s.dotWait, { borderColor: tone.unknown }]}><Text style={[s.plus, { color: tone.unknown }]}>+</Text></View>
              ) : k === EXTRAS ? (
                <View style={[s.dot, s.dotRing, { borderColor: tone[st] ?? tone.unknown }]} />
              ) : (
                <View style={[s.dot, { backgroundColor: tone[st] ?? tone.unknown }]} />
              )}
              <Text style={[s.segName, on && s.segNameOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{SWING_STRINGS.position.short[k]}</Text>
              {tag ? (
                // a strip wider than the chip, so the badge sits centred on one line and never wraps over the dot
                <View style={s.markWrap} pointerEvents="none">
                  <View style={[s.mark, tag === 'first' ? { backgroundColor: tone.red } : { borderColor: tone.red, borderWidth: 1.5, backgroundColor: theme.bg.card }]}>
                    <Text style={[s.markText, tag === 'starts' && { color: tone.red }]} numberOfLines={1}>{tag === 'first' ? R.markFirst : R.markStarts}</Text>
                  </View>
                </View>
              ) : null}
            </PressableScale>
          );
        })}
      </View>

      <View style={s.head}>
        {main ? (
          <>
            <Text style={s.line} testID="results-headline">
              {`${soFar ? R.mainSoFar : R.workFirst}: ${stepName(mainStep)}`}
              <Text style={s.fault}>{` · ${fault}`}</Text>
            </Text>
            {main.startsAt ? (
              <PressableScale style={s.startsRow} onPress={() => onSelect(main.startsAt)} accessibilityRole="button" accessibilityLabel={R.startsAt(stepName(main.startsAt))} testID="results-starts-at">
                <Text style={s.starts}>
                  {R.startsAt('')}
                  <Text style={s.startsName}>{`${stepName(main.startsAt)} ›`}</Text>
                </Text>
              </PressableScale>
            ) : null}
            {alsoCausing ? <Text style={s.also} testID="results-also-causing">{alsoCausing}</Text> : null}
          </>
        ) : (
          <>
            <Text style={s.line} testID="results-headline">{noFault.line}</Text>
            {noFault.why ? <Text style={s.hint}>{R.noFaultWhy}</Text> : null}
          </>
        )}
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
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    paddingTop: 8, paddingBottom: 8, paddingHorizontal: 6, gap: 4,
  },
  segs: { flexDirection: 'row', gap: 2 },
  seg: {
    flex: 1, minHeight: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 1,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  segOn: { backgroundColor: theme.accent.light, borderColor: theme.accent.primary },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotRing: { borderWidth: 2, backgroundColor: 'transparent' },
  dotWait: { borderWidth: 2, borderStyle: 'dashed', backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  plus: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 9, lineHeight: 10, marginTop: -1 },
  segName: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, lineHeight: 15, color: theme.text.secondary, textAlign: 'center' },
  segNameOn: { color: theme.text.primary },
  markWrap: { position: 'absolute', top: -7, left: -8, right: -8, alignItems: 'center' },
  mark: { borderRadius: 999, paddingHorizontal: 4, paddingVertical: 1 },
  markText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10, letterSpacing: 0.2, textTransform: 'uppercase', color: '#ffffff' },
  head: { paddingHorizontal: 6, paddingTop: 2, gap: 2 },
  line: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, lineHeight: 21, color: theme.text.primary },
  fault: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary },
  startsRow: { minHeight: 32, justifyContent: 'center' },
  starts: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme.text.secondary },
  startsName: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary },
  also: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, lineHeight: 17, color: theme.text.secondary },
  hint: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, lineHeight: 16, color: theme.text.secondary },
  placeLine: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 8, marginTop: 4, borderRadius: 10, backgroundColor: theme.bg.secondary,
  },
  placeText: { flex: 1, fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, lineHeight: 17, color: theme.text.primary },
  placeBtn: { minHeight: 32, borderRadius: 16, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: theme.accent.primary },
  placeBtnText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme.text.inverse },
});
