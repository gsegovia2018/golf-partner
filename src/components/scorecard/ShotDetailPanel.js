import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { makeScorecardStyles } from './styles';
import { ShotDetailExplainer } from '../ShotDetailExplainer';
import { isGIR, recoveryOutcomeFromState, shotDetailStrokeCount } from '../../store/scoring';
import {
  DEFAULT_SHOT, DRIVE_ORDER, DRIVE_META,
  FIRST_PUTT_BUCKETS, FIRST_PUTT_LABELS,
  APPROACH_BUCKETS, APPROACH_LABELS,
} from './constants';

// One "label … − value +" counter row used for putts, penalties, sand shots.
// `canInc` is false once the hole's stroke budget is fully assigned.
function ShotCounterRow({ label, value, onStep, canInc = true, theme, s, explainer }) {
  const canDec = value != null && value > 0;
  return (
    <View style={s.shotRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={s.shotRowLabel}>{label}</Text>
        {explainer}
      </View>
      <View style={s.shotCounter}>
        <TouchableOpacity
          style={[s.shotCounterBtn, !canDec && s.shotCounterBtnDim]}
          onPress={() => onStep(-1)}
          disabled={!canDec}
          activeOpacity={0.7}
          accessibilityLabel={`Decrease ${label}`}
          accessibilityState={{ disabled: !canDec }}
        >
          <Feather name="minus" size={18} color={canDec ? theme.text.primary : theme.text.muted} />
        </TouchableOpacity>
        <Text style={s.shotCounterValue}>{value == null ? '–' : value}</Text>
        <TouchableOpacity
          style={[s.shotCounterBtn, !canInc && s.shotCounterBtnDim]}
          onPress={() => onStep(1)}
          disabled={!canInc}
          activeOpacity={0.7}
          accessibilityLabel={`Increase ${label}`}
          accessibilityState={{ disabled: !canInc }}
        >
          <Feather name="plus" size={18} color={canInc ? theme.text.primary : theme.text.muted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// A distance-bucket picker: label on its own line, then a full-width row of
// equal-width segmented cells. Tapping the active cell clears the value.
function BucketSegment({ label, value, buckets, labels, onSelect, theme, s, explainer, hint, isLast = false }) {
  return (
    <View style={[s.bucketSegBlock, isLast && { borderBottomWidth: 0 }]}>
      <View style={s.bucketSegLabelRow}>
        <Text style={s.shotRowLabel}>{label}</Text>
        {explainer}
        {hint ? <Text style={s.bucketSegHint}>{hint}</Text> : null}
      </View>
      <View style={s.bucketSegTrack}>
        {buckets.map((key) => {
          const active = value === key;
          return (
            <TouchableOpacity
              key={key}
              style={[s.bucketSegCell, active && s.bucketSegCellActive]}
              onPress={() => onSelect(active ? null : key)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${labels[key]}`}
              accessibilityState={{ selected: active }}
            >
              <Text style={[s.bucketSegCellText, active && s.bucketSegCellTextActive]}>
                {labels[key]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function ApproachResultRow({ value, onChange, theme, s, isLast = false }) {
  const options = [
    { key: 'green', label: 'On green' },
    { key: 'miss', label: 'Missed green' },
  ];
  return (
    <View style={[s.shotRow, isLast && s.shotRowLast]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={s.shotRowLabel}>Where did it finish?</Text>
        <ShotDetailExplainer
          rowKey="approachResult"
          title="Approach result"
          body="Whether the regulation approach finished on the green or missed it. This keeps approach shots separate from short-game recovery shots."
        />
      </View>
      <View style={s.driveBtns}>
        {options.map(({ key, label }) => {
          const active = value === key;
          return (
            <TouchableOpacity
              key={key}
              style={[s.outcomeChip, active && s.outcomeChipActive]}
              onPress={() => onChange({ approachResult: active ? null : key })}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Approach result ${label}`}
              accessibilityState={{ selected: active }}
            >
              <Text style={[
                s.outcomeChipLabel,
                active && { color: theme.text.inverse },
              ]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// Per-hole shot detail for the "me" player, laid out after the Hole19
// scorecard: stat rows with a stepper, plus a row of round direction
// buttons for the drive. The drive row is hidden on par 3s.
export function ShotDetailPanel({ hole, detail, onChange, strokes, theme: themeProp, s: sProp }) {
  const { theme: themeCtx } = useTheme();
  const theme = themeProp ?? themeCtx;
  const sOwn = useMemo(() => makeScorecardStyles(theme), [theme]);
  const s = sProp ?? sOwn;
  const d = { ...DEFAULT_SHOT, ...(detail ?? {}) };
  const isPar3 = hole.par === 3;
  const approachShotHint = hole.par === 5 ? '3rd shot · metres' : '2nd shot · metres';
  const gir = isGIR({ strokes, putts: d.putts, par: hole.par });
  const missedGIR = gir === false;
  const autoOutcome = recoveryOutcomeFromState({
    strokes,
    putts: d.putts,
    sandShots: d.sandShots ?? 0,
    par: hole.par,
  });
  const effectiveOutcome = d.recoveryOutcome ?? autoOutcome;

  // Stroke budget: every counter is one of the hole's strokes, so the four
  // counters together can never exceed `strokes`. No cap until strokes is set.
  const assigned = shotDetailStrokeCount(d);
  const budgetLeft = strokes == null ? Infinity : strokes - assigned;
  const atBudget = budgetLeft <= 0;
  const budgetCaption = strokes == null
    ? null
    : budgetLeft > 0
      ? `${budgetLeft} stroke${budgetLeft === 1 ? '' : 's'} left to assign`
      : `All ${strokes} stroke${strokes === 1 ? '' : 's'} assigned`;

  const step = (field, delta) => {
    if (delta > 0 && atBudget) return;
    const cur = d[field] ?? 0;
    onChange({ [field]: Math.max(0, Math.min(15, cur + delta)) });
  };

  return (
    <View style={s.shotPanel}>
      <Text style={s.shotPanelLabel}>How many were:</Text>
      {budgetCaption && <Text style={s.shotBudgetCaption}>{budgetCaption}</Text>}

      <ShotCounterRow
        label="Putts"
        value={d.putts}
        onStep={(delta) => step('putts', delta)}
        canInc={!atBudget}
        theme={theme}
        s={s}
      />
      <ShotCounterRow
        label="Tee penalties"
        value={d.teePenalties}
        onStep={(delta) => step('teePenalties', delta)}
        canInc={!atBudget}
        theme={theme}
        s={s}
      />
      <ShotCounterRow
        label="Other penalties"
        value={d.otherPenalties}
        onStep={(delta) => step('otherPenalties', delta)}
        canInc={!atBudget}
        theme={theme}
        s={s}
      />
      <ShotCounterRow
        label="Sand shots"
        value={d.sandShots}
        onStep={(delta) => step('sandShots', delta)}
        canInc={!atBudget}
        theme={theme}
        s={s}
        explainer={
          <ShotDetailExplainer
            rowKey="sandShots"
            title="Sand shots"
            body="Total bunker shots you played on this hole — even from a fairway bunker. Used for sand saves and bunker visits per round."
          />
        }
      />

      {!isPar3 && (
        <View style={s.shotRow}>
          <Text style={s.shotRowLabel}>Driver</Text>
          <View style={s.driveBtns}>
            {DRIVE_ORDER.map((key) => {
              const meta = DRIVE_META[key];
              const active = d.drive === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[s.driveCircle, active && s.driveCircleActive]}
                  onPress={() => onChange({ drive: active ? null : key })}
                  activeOpacity={0.7}
                  accessibilityLabel={`Driver ${meta.label}`}
                >
                  <Feather
                    name={meta.icon}
                    size={18}
                    color={active ? theme.text.inverse : theme.text.secondary}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
      {!isPar3 && (
        <BucketSegment
          label="Approach shot distance"
          value={d.approachBucket}
          buckets={APPROACH_BUCKETS}
          labels={APPROACH_LABELS}
          onSelect={(key) => onChange({
            approachBucket: key,
            ...(key == null ? { approachResult: null } : {}),
          })}
          theme={theme}
          s={s}
          hint={approachShotHint}
          isLast={false}
          explainer={
            <ShotDetailExplainer
              rowKey="approachBucket"
              title="Approach shot distance"
              body="Use the regulation approach shot: your 2nd shot on a par 4, or your 3rd shot on a par 5. Enter the distance you actually played into the green, not distance left after the tee shot."
            />
          }
        />
      )}
      {!isPar3 && d.approachBucket && (
        <ApproachResultRow
          value={d.approachResult}
          onChange={onChange}
          theme={theme}
          s={s}
          isLast={(d.putts ?? 0) < 1 && !missedGIR}
        />
      )}
      {(d.putts ?? 0) >= 1 && (
        <BucketSegment
          label="First putt"
          value={d.firstPuttBucket}
          buckets={FIRST_PUTT_BUCKETS}
          labels={FIRST_PUTT_LABELS}
          onSelect={(key) => onChange({ firstPuttBucket: key })}
          theme={theme}
          s={s}
          hint="metres"
          isLast={!missedGIR}
          explainer={
            <ShotDetailExplainer
              rowKey="firstPuttBucket"
              title="First putt distance"
              body="How far away your first putt was (in meters). Lets us measure how well you lag long putts and how well you convert short ones."
            />
          }
        />
      )}
      {missedGIR && (
        <View style={[s.shotRow, s.shotRowLast]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={s.shotRowLabel}>Outcome</Text>
            <ShotDetailExplainer
              rowKey="outcome"
              title="Up & Down / Sand Save"
              body={'A successful "up and down" means you missed the green in regulation but still saved par or better. A "sand save" is the same but from a bunker.'}
            />
          </View>
          <View style={s.driveBtns}>
            <TouchableOpacity
              style={[s.outcomeChip, effectiveOutcome === 'up-and-down' && s.outcomeChipActive]}
              onPress={() => onChange({
                recoveryOutcome:
                  effectiveOutcome === 'up-and-down' ? 'none' : 'up-and-down',
              })}
              activeOpacity={0.7}
            >
              <Text
                accessibilityState={{ selected: effectiveOutcome === 'up-and-down' }}
                style={[
                  s.outcomeChipLabel,
                  effectiveOutcome === 'up-and-down' && { color: theme.text.inverse },
                ]}
              >Up & Down</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.outcomeChip, effectiveOutcome === 'sand-save' && s.outcomeChipActive]}
              onPress={() => onChange({
                recoveryOutcome:
                  effectiveOutcome === 'sand-save' ? 'none' : 'sand-save',
              })}
              activeOpacity={0.7}
            >
              <Text
                accessibilityState={{ selected: effectiveOutcome === 'sand-save' }}
                style={[
                  s.outcomeChipLabel,
                  effectiveOutcome === 'sand-save' && { color: theme.text.inverse },
                ]}
              >Sand Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}
