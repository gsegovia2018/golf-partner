import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { makeScorecardStyles } from './styles';
import { ShotDetailExplainer } from '../ShotDetailExplainer';
import MissWhySheet from './MissWhySheet';
import { renderMsg } from '../mystats/msg';
import { summaryOf, situations } from '../../store/missReasons';
import { isRoundMuted, muteRound } from '../../store/missReasonsMute';
import {
  hydrateSwingProfile, getSwingProfile, subscribeSwings, getSwingsVersion,
} from '../../store/swingStore';
import {
  isGIR, recoveryOutcomeFromState, shotDetailStrokeCount,
  driveDirectionPatch, teeClubPatch, approachBucketPatch, approachFinishPatch, recoveryOutcomePatch,
} from '../../store/scoring';
import { defaultApproachLie } from '../../store/statsEngine';
import { useAppSettings } from '../../hooks/useAppSettings';
import { unitWord } from '../../lib/units';
import {
  DEFAULT_SHOT, DRIVE_ORDER, DRIVE_META,
  FIRST_PUTT_BUCKETS, FIRST_PUTT_LABELS, FIRST_PUTT_LABELS_YD,
  APPROACH_BUCKETS, APPROACH_LABELS, APPROACH_LABELS_YD,
  DRIVE_DIST_BUCKETS, DRIVE_DIST_LABELS, DRIVE_DIST_LABELS_YD,
  DRIVE_MISS_LIES, DRIVE_MISS_LIE_LABELS,
  APPROACH_LIES, APPROACH_LIE_LABELS,
  APPROACH_FINISH_ORDER, APPROACH_FINISH_META,
  TEE_CLUBS, TEE_CLUB_LABELS,
} from './constants';
import { useT } from '../../i18n';

// Display labels for a constant map, keyed by the same ids. The English values
// stay in constants.js (storage keys never change); only the words are looked up.
function localizeMap(map, group, tl) {
  return Object.fromEntries(Object.keys(map).map((k) => [k, tl(`shots.${group}.${k}`)]));
}

// One "label … − value +" counter row used for putts, penalties, sand shots.
// `canInc` is false once the hole's stroke budget is fully assigned.
function ShotCounterRow({ label, value, onStep, canInc = true, theme, s, explainer, isLast = false }) {
  const tl = useT();
  const canDec = value != null && value > 0;
  return (
    <View style={[s.shotRow, isLast && s.shotRowLast]}>
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
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={tl('shots.detail.decrease', { label })}
          accessibilityState={{ disabled: !canDec }}
        >
          <Feather name="minus" size={14} color={canDec ? theme.text.primary : theme.text.muted} />
        </TouchableOpacity>
        <Text style={s.shotCounterValue}>{value == null ? '–' : value}</Text>
        <TouchableOpacity
          style={[s.shotCounterBtn, !canInc && s.shotCounterBtnDim]}
          onPress={() => onStep(1)}
          disabled={!canInc}
          activeOpacity={0.7}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={tl('shots.detail.increase', { label })}
          accessibilityState={{ disabled: !canInc }}
        >
          <Feather name="plus" size={14} color={canInc ? theme.text.primary : theme.text.muted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// A distance-bucket picker: label on its own line, then a full-width row of
// equal-width segmented cells. Tapping the active cell clears the value.
function BucketSegment({ label, value, buckets, labels, onSelect, theme, s, explainer, hint, isLast = false }) {
  const tl = useT();
  return (
    <View style={[s.bucketSegBlock, isLast && { borderBottomWidth: 0 }]}>
      <View style={s.bucketSegLabelRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={s.shotRowLabel}>{label}</Text>
          {explainer}
        </View>
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
              accessibilityLabel={tl('shots.detail.pairA11y', { label, value: labels[key] })}
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

// A labelled row of mutually-exclusive chips. `effectiveValue` drives the
// selected state so a derived default (e.g. approach lie = fairway) can show
// as selected without being stored.
function LieChipRow({ label, a11yPrefix, options, labels, effectiveValue, onSelect, theme, s, explainer, isLast = false, stacked = false }) {
  const tl = useT();
  return (
    <View style={[s.shotRow, stacked && s.shotRowStacked, isLast && s.shotRowLast]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={s.shotRowLabel}>{label}</Text>
        {explainer}
      </View>
      <View style={[s.driveBtns, stacked && s.driveBtnsStacked]}>
        {options.map((key) => {
          const active = effectiveValue === key;
          return (
            <TouchableOpacity
              key={key}
              style={[s.outcomeChip, active && s.outcomeChipActive]}
              onPress={() => onSelect(key, active)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={tl('shots.detail.pairA11y', { label: a11yPrefix, value: labels[key] })}
              accessibilityState={{ selected: active }}
            >
              <Text style={[s.outcomeChipLabel, active && { color: theme.text.inverse }]}>
                {labels[key]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// Icon row (mirrors the drive row) for where a regulation approach finished:
// the green center, one of four miss directions, or a greenside bunker.
// Selection rules: `green` is exclusive (clears direction + bunker); the four
// directions are single-select among themselves; `bunker` toggles on top of a
// direction or stands alone. `approachResult` is kept in sync ('green' vs
// 'miss' vs null) so the stats engine and downstream rows read it unchanged.
function ApproachFinishRow({ detail, onSelect, theme, s, isLast = false, noRule = false }) {
  const tl = useT();
  const dir = detail.approachMiss ?? null;
  const bunker = !!detail.approachBunker;
  const onGreen = detail.approachResult === 'green';

  const activeFor = (key) => (key === 'green'
    ? onGreen
    : key === 'bunker'
      ? bunker
      : dir === key && !onGreen);

  const select = (key) => onSelect(key);

  return (
    <View style={[s.shotRow, s.shotRowStacked, (isLast || noRule) && s.shotRowNoRule, isLast && s.shotRowLast]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={s.shotRowLabel}>{tl('shots.detail.finished')}</Text>
        <ShotDetailExplainer
          rowKey="approachResult"
          title={tl('shots.explain.approachResultTitle')}
          body={tl('shots.explain.approachResultBody')}
        />
      </View>
      <View style={[s.driveBtns, s.driveBtnsStacked, s.approachFinishBtns]}>
        {APPROACH_FINISH_ORDER.map((key) => {
          const meta = { ...APPROACH_FINISH_META[key], label: tl(`shots.finish.${key}`) };
          const active = activeFor(key);
          const color = active ? theme.text.inverse : theme.text.secondary;
          return (
            <TouchableOpacity
              key={key}
              style={[s.driveCircle, active && s.driveCircleActive]}
              onPress={() => select(key)}
              activeOpacity={0.7}
              hitSlop={5}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tl('shots.detail.finishOn', { label: meta.label })}
            >
              {meta.set === 'material-community' ? (
                <MaterialCommunityIcons name={meta.icon} size={18} color={color} />
              ) : (
                <Feather name={meta.icon} size={18} color={color} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const DRIVE_MISSES = ['left', 'right', 'short'];
const noop = () => {};

// "Why?" chip under the row that recorded a miss. Answered: the summary
// ("Push · Heavy") in the accent; unanswered: a dashed "Why?". Read-only shows
// the answered summary without a tap and hides the unanswered chip.
function ReasonChip({ summary, onPress, readOnly, align, ruled = false, theme, s }) {
  const tl = useT();
  const answered = summary.length > 0;
  if (readOnly && !answered) return null;
  const text = answered ? summary.map(renderMsg).join(' · ') : tl('shots.why.chip');
  const color = answered ? theme.accent.primary : theme.text.secondary;
  return (
    <View style={[s.whyRow, align === 'left' ? s.whyRowLeft : s.whyRowRight, ruled && s.whyRowRuled]}>
      <TouchableOpacity
        style={[s.whyChip, answered ? s.whyChipAnswered : s.whyChipEmpty]}
        onPress={readOnly ? undefined : onPress}
        disabled={readOnly}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel={text}
      >
        <Text numberOfLines={1} style={[s.whyChipText, { color }, answered && s.whyChipTextAnswered]}>{text}</Text>
        {!readOnly && <Feather name="chevron-right" size={14} color={color} />}
      </TouchableOpacity>
    </View>
  );
}

// Per-hole shot detail for the "me" player, laid out after the Hole19
// scorecard: stat rows with a stepper, plus a row of round direction
// buttons for the drive. The drive row is hidden on par 3s.
export function ShotDetailPanel({
  hole, detail, onChange, strokes, statGroups, roundId, readOnly = false, focusTarget = null,
  theme: themeProp, s: sProp,
}) {
  const tl = useT();
  const teeClubLabels = localizeMap(TEE_CLUB_LABELS, 'teeClub', tl);
  const lieLabels = localizeMap(DRIVE_MISS_LIE_LABELS, 'lie', tl);
  const approachLieLabels = localizeMap(APPROACH_LIE_LABELS, 'lie', tl);
  const driveMeta = Object.fromEntries(Object.entries(DRIVE_META).map(([k, v]) => [k, { ...v, label: tl(`shots.drive.${k}`) }]));
  const { theme: themeCtx } = useTheme();
  const theme = themeProp ?? themeCtx;
  const { units, missReasons: missSetting } = useAppSettings();
  const [sheet, setSheet] = useState(null);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    let live = true;
    setMuted(false);
    isRoundMuted(roundId).then((m) => { if (live) setMuted(!!m); }).catch(noop);
    return () => { live = false; };
  }, [roundId]);
  useEffect(() => { hydrateSwingProfile()?.catch?.(noop); }, []);
  useSyncExternalStore(subscribeSwings, getSwingsVersion, getSwingsVersion);
  const handedness = getSwingProfile()?.handedness ?? 'right';
  const sOwn = useMemo(() => makeScorecardStyles(theme), [theme]);
  const s = sProp ?? sOwn;
  const d = { ...DEFAULT_SHOT, ...(detail ?? {}) };
  const g = {
    putting: true, teeShot: true, approach: true, shortGame: true, penalties: true,
    ...(statGroups ?? {}),
  };
  const isPar3 = hole.par === 3;
  const showApproachExtrasFlag = g.approach && !isPar3 && d.approachBucket;
  const driveMissed = d.drive === 'left' || d.drive === 'right' || d.drive === 'short';
  const teeClub = d.teeClub ?? 'driver';
  const approachDistanceLabel = isPar3 ? tl('shots.detail.holeDistance') : tl('shots.detail.approach');
  const approachShotHint = unitWord(units);
  const driveDistLabels = units === 'yards' ? DRIVE_DIST_LABELS_YD : DRIVE_DIST_LABELS;
  const approachLabels = units === 'yards' ? APPROACH_LABELS_YD : APPROACH_LABELS;
  const firstPuttLabels = units === 'yards' ? FIRST_PUTT_LABELS_YD : FIRST_PUTT_LABELS;
  const gir = isGIR({ strokes, putts: d.putts, par: hole.par });
  const missedGIR = gir === false;
  const autoOutcome = recoveryOutcomeFromState({
    strokes,
    putts: d.putts,
    sandShots: d.sandShots ?? 0,
    par: hole.par,
  });
  const effectiveOutcome = d.recoveryOutcome ?? autoOutcome;

  // Miss reasons. The sheet opens only from the taps below, never from a
  // `detail` change (watch writes, peers and rehydrates arrive that way).
  // Coach focus (round focus loop spec 2.2): the strip and asks apply on the
  // holes and shots the focus is about. A swing / decision focus also opens the
  // sheet on a missed focus shot when the setting is "On tap"; never for "Off",
  // a muted round or read-only. Short-game never auto-opens (plan decision 12).
  const focusGroup = { approach: g.approach, drive: g.teeShot, short: g.shortGame, putt: g.putting };
  const focusApplies = !!focusTarget && !readOnly && !!focusGroup[focusTarget.shot]
    && (focusTarget.shot === 'approach'
      ? !isPar3 || !focusTarget.bucket || d.approachBucket == null || d.approachBucket === focusTarget.bucket
      : focusTarget.shot === 'drive' ? !isPar3 : true);
  const focusAsk = (mode) => focusApplies
    && (focusTarget.kind === 'swing' || focusTarget.kind === 'decision')
    && focusTarget.shot === (mode === 'drive' ? 'drive' : 'approach');
  const canOpen = (mode) => (missSetting === 'ask' || (missSetting === 'manual' && focusAsk(mode)))
    && !muted && !readOnly;
  const situationList = situations(d, 'approachSituation');
  const focusLie = focusApplies && focusTarget.kind === 'lie' ? focusTarget.lie : null;
  const lieChipOn = !!focusLie && showApproachExtrasFlag;
  const toggleFocusLie = () => {
    const next = situationList.includes(focusLie)
      ? situationList.filter((x) => x !== focusLie)
      : [...situationList, focusLie];
    onChange({ approachSituation: next.length ? next : null });
  };
  const chipsOn = missSetting !== 'off';
  const driveChip = chipsOn && g.teeShot && !isPar3 && driveMissed;
  const approachChip = chipsOn && showApproachExtrasFlag && d.approachResult === 'miss';
  const shortChip = chipsOn && g.shortGame && missedGIR && strokes != null && strokes > hole.par
    && effectiveOutcome !== 'up-and-down' && effectiveOutcome !== 'sand-save';
  const onDriveTap = (key) => {
    const patch = driveDirectionPatch(d.drive, key);
    onChange(patch);
    if (canOpen('drive') && DRIVE_MISSES.includes(patch.drive)) setSheet('drive');
  };
  const onFinishTap = (key) => {
    const patch = approachFinishPatch(d, key);
    onChange(patch);
    const turnedOn = key === 'bunker' ? patch.approachBunker === true
      : key !== 'green' && patch.approachMiss === key;
    if (canOpen('approach') && turnedOn) setSheet('approach');
  };

  // Stroke budget: every counter is one of the hole's strokes, so the four
  // counters together can never exceed `strokes`. No cap until strokes is set.
  const assigned = shotDetailStrokeCount(d);
  const budgetLeft = strokes == null ? Infinity : strokes - assigned;
  const atBudget = budgetLeft <= 0;
  const budgetCaption = strokes == null
    ? null
    : budgetLeft > 0
      ? tl('shots.detail.budgetLeft', { count: budgetLeft })
      : tl('shots.detail.budgetAll', { count: strokes });

  const step = (field, delta) => {
    if (delta > 0 && atBudget) return;
    const cur = d[field] ?? 0;
    onChange({ [field]: Math.max(0, Math.min(15, cur + delta)) });
  };

  // Row visibility, in on-screen order. Stat-group toggles and the existing
  // par-3 / data-driven guards can hide any row, so the "last visible row"
  // (whose bottom border must be dropped) shifts around — compute it here
  // instead of hardcoding which row is normally last.
  const showApproachExtras = showApproachExtrasFlag;
  const rowVisibility = [
    ['putts', g.putting],
    ['teePenalties', g.penalties],
    ['otherPenalties', g.penalties],
    ['sandShots', g.shortGame],
    ['teeClub', g.teeShot && !isPar3],
    ['driveCircles', g.teeShot && !isPar3],
    ['driveLie', g.teeShot && !isPar3 && driveMissed],
    ['driveDistBucket', g.teeShot && !isPar3],
    ['approachBucket', g.approach],
    ['approachResult', showApproachExtras],
    ['approachLie', showApproachExtras],
    ['firstPutt', g.putting && (d.putts ?? 0) >= 1],
    ['outcome', g.shortGame && missedGIR],
  ];
  let lastVisibleRow = null;
  for (const [key, visible] of rowVisibility) if (visible) lastVisibleRow = key;

  return (
    <View style={s.shotPanel}>
      {focusApplies && (
        <View
          style={s.focusStrip}
          testID="focus-strip"
          accessible
          accessibilityLabel={`${tl('shots.focus.label')}: ${renderMsg(focusTarget.title)} · ${renderMsg(focusTarget.cue)}`}
        >
          <Feather name="target" size={18} color={theme.accent.primary} />
          <Text style={s.focusStripText}>
            <Text style={s.focusStripTitle}>{renderMsg(focusTarget.title)}</Text>
            {` · ${renderMsg(focusTarget.cue)}`}
          </Text>
        </View>
      )}
      {budgetCaption && <Text style={s.shotBudgetCaption}>{budgetCaption}</Text>}

      {g.putting && (
        <ShotCounterRow
          label={tl('shots.detail.putts')}
          value={d.putts}
          onStep={(delta) => step('putts', delta)}
          canInc={!atBudget}
          theme={theme}
          s={s}
          isLast={lastVisibleRow === 'putts'}
        />
      )}
      {g.penalties && (
        <ShotCounterRow
          label={tl('shots.detail.teePenalties')}
          value={d.teePenalties}
          onStep={(delta) => step('teePenalties', delta)}
          canInc={!atBudget}
          theme={theme}
          s={s}
        />
      )}
      {g.penalties && (
        <ShotCounterRow
          label={tl('shots.detail.otherPenalties')}
          value={d.otherPenalties}
          onStep={(delta) => step('otherPenalties', delta)}
          canInc={!atBudget}
          theme={theme}
          s={s}
          isLast={lastVisibleRow === 'otherPenalties'}
        />
      )}
      {g.shortGame && (
        <ShotCounterRow
          label={tl('shots.detail.sandShots')}
          value={d.sandShots}
          onStep={(delta) => step('sandShots', delta)}
          canInc={!atBudget}
          theme={theme}
          s={s}
          isLast={lastVisibleRow === 'sandShots'}
          explainer={
            <ShotDetailExplainer
              rowKey="sandShots"
              title={tl('shots.explain.sandShotsTitle')}
              body={tl('shots.explain.sandShotsBody')}
            />
          }
        />
      )}

      {g.teeShot && !isPar3 && (
        <LieChipRow
          label={tl('shots.detail.teeClub')}
          a11yPrefix={tl('shots.detail.teeClub')}
          options={TEE_CLUBS}
          labels={teeClubLabels}
          effectiveValue={teeClub}
          onSelect={(key) => onChange(teeClubPatch(key))}
          theme={theme}
          s={s}
          stacked
          explainer={
            <ShotDetailExplainer
              rowKey="teeClub"
              title={tl('shots.explain.teeClubTitle')}
              body={tl('shots.explain.teeClubBody')}
            />
          }
        />
      )}
      {g.teeShot && !isPar3 && (
        <View style={[s.shotRow, driveChip && s.shotRowNoRule]}>
          <Text style={s.shotRowLabel}>{teeClubLabels[teeClub]}</Text>
          <View style={s.driveBtns}>
            {DRIVE_ORDER.map((key) => {
              const meta = driveMeta[key];
              const active = d.drive === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[s.driveCircle, active && s.driveCircleActive]}
                  onPress={() => onDriveTap(key)}
                  activeOpacity={0.7}
                  hitSlop={5}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={tl('shots.teeShot.a11y', { club: teeClubLabels[teeClub], direction: meta.label })}
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
      {driveChip && (
        <ReasonChip
          summary={summaryOf('drive', d, handedness)}
          onPress={() => setSheet('drive')}
          readOnly={readOnly}
          align="right"
          ruled
          theme={theme}
          s={s}
        />
      )}
      {g.teeShot && !isPar3 && driveMissed && (
        <LieChipRow
          label={tl('shots.detail.driveFinished')}
          a11yPrefix={tl('shots.detail.driveLie')}
          options={DRIVE_MISS_LIES}
          labels={lieLabels}
          effectiveValue={d.driveLie ?? 'rough'}
          onSelect={(key) => onChange({ driveLie: key })}
          theme={theme}
          s={s}
          stacked
          explainer={
            <ShotDetailExplainer
              rowKey="driveLie"
              title={tl('shots.explain.driveLieTitle')}
              body={tl('shots.explain.driveLieBody')}
            />
          }
        />
      )}
      {g.teeShot && !isPar3 && (
        <BucketSegment
          label={tl('shots.detail.driveDistance')}
          value={d.driveDistBucket}
          buckets={DRIVE_DIST_BUCKETS}
          labels={driveDistLabels}
          onSelect={(key) => onChange({ driveDistBucket: key })}
          theme={theme}
          s={s}
          hint={unitWord(units)}
          isLast={lastVisibleRow === 'driveDistBucket'}
          explainer={
            <ShotDetailExplainer
              rowKey="driveDistBucket"
              title={tl('shots.explain.driveDistanceTitle')}
              body={tl('shots.explain.driveDistanceBody')}
            />
          }
        />
      )}
      {g.approach && (
        <BucketSegment
          label={approachDistanceLabel}
          value={d.approachBucket}
          buckets={APPROACH_BUCKETS}
          labels={approachLabels}
          onSelect={(key) => onChange(approachBucketPatch(key))}
          theme={theme}
          s={s}
          hint={approachShotHint}
          isLast={lastVisibleRow === 'approachBucket'}
          explainer={
            <ShotDetailExplainer
              rowKey="approachBucket"
              title={approachDistanceLabel}
              body={isPar3
                ? tl('shots.explain.par3Body')
                : tl('shots.explain.approachBody')}
            />
          }
        />
      )}
      {showApproachExtras && (
        <ApproachFinishRow
          detail={d}
          onSelect={onFinishTap}
          theme={theme}
          s={s}
          noRule={approachChip || lieChipOn}
        />
      )}
      {lieChipOn && (
        <View style={[s.focusAsk, !approachChip && s.focusAskRuled]}>
          <Text style={s.focusAskLabel}>{tl('shots.focus.thisShot')}</Text>
          <TouchableOpacity
            testID="focus-lie-chip"
            style={[s.focusAskChip, situationList.includes(focusLie) && s.focusAskChipOn]}
            onPress={toggleFocusLie}
            activeOpacity={0.7}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel={tl(`shots.focus.ask.${focusLie}`)}
            accessibilityState={{ selected: situationList.includes(focusLie) }}
          >
            <Feather
              name="check"
              size={14}
              color={situationList.includes(focusLie) ? theme.text.inverse : theme.text.secondary}
            />
            <Text style={[s.focusAskChipText, situationList.includes(focusLie) && { color: theme.text.inverse }]}>
              {tl(`shots.focus.ask.${focusLie}`)}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      {showApproachExtras && approachChip && (
        <ReasonChip
          summary={summaryOf('approach', d, handedness)}
          onPress={() => setSheet('approach')}
          readOnly={readOnly}
          align="left"
          ruled
          theme={theme}
          s={s}
        />
      )}
      {showApproachExtras && (
        <LieChipRow
          label={tl('shots.detail.approachLie')}
          a11yPrefix={tl('shots.detail.approachLieA11y')}
          options={APPROACH_LIES}
          labels={approachLieLabels}
          effectiveValue={d.approachLie ?? defaultApproachLie(d, hole.par)}
          onSelect={(key) => onChange({ approachLie: key })}
          theme={theme}
          s={s}
          stacked
          isLast={lastVisibleRow === 'approachLie'}
          explainer={
            <ShotDetailExplainer
              rowKey="approachLie"
              title={tl('shots.explain.approachLieTitle')}
              body={tl('shots.explain.approachLieBody')}
            />
          }
        />
      )}
      {g.putting && (d.putts ?? 0) >= 1 && (
        <BucketSegment
          label={tl('shots.detail.firstPutt')}
          value={d.firstPuttBucket}
          buckets={FIRST_PUTT_BUCKETS}
          labels={firstPuttLabels}
          onSelect={(key) => onChange({ firstPuttBucket: key })}
          theme={theme}
          s={s}
          hint={unitWord(units)}
          isLast={lastVisibleRow === 'firstPutt'}
          explainer={
            <ShotDetailExplainer
              rowKey="firstPuttBucket"
              title={tl('shots.explain.firstPuttTitle')}
              body={tl('shots.explain.firstPuttBody')}
            />
          }
        />
      )}
      {g.shortGame && missedGIR && (
        <View style={[s.shotRow, s.shotRowLast]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={s.shotRowLabel}>{tl('shots.detail.outcome')}</Text>
            <ShotDetailExplainer
              rowKey="outcome"
              title={tl('shots.explain.upDownTitle')}
              body={tl('shots.explain.upDownBody')}
            />
          </View>
          <View style={s.driveBtns}>
            <TouchableOpacity
              style={[s.outcomeChip, effectiveOutcome === 'up-and-down' && s.outcomeChipActive]}
              onPress={() => onChange(recoveryOutcomePatch(effectiveOutcome, 'up-and-down'))}
              activeOpacity={0.7}
            >
              <Text
                accessibilityState={{ selected: effectiveOutcome === 'up-and-down' }}
                style={[
                  s.outcomeChipLabel,
                  effectiveOutcome === 'up-and-down' && { color: theme.text.inverse },
                ]}
              >{tl('shots.detail.upDown')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.outcomeChip, effectiveOutcome === 'sand-save' && s.outcomeChipActive]}
              onPress={() => onChange(recoveryOutcomePatch(effectiveOutcome, 'sand-save'))}
              activeOpacity={0.7}
            >
              <Text
                accessibilityState={{ selected: effectiveOutcome === 'sand-save' }}
                style={[
                  s.outcomeChipLabel,
                  effectiveOutcome === 'sand-save' && { color: theme.text.inverse },
                ]}
              >{tl('shots.detail.sandSave')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {shortChip && (
        <ReasonChip
          summary={summaryOf('short', d, handedness)}
          onPress={() => setSheet('short')}
          readOnly={readOnly}
          align="right"
          theme={theme}
          s={s}
        />
      )}
      {!readOnly && (
        <MissWhySheet
          visible={sheet != null}
          mode={sheet}
          hole={hole}
          detail={d}
          onChange={onChange}
          onClose={() => setSheet(null)}
          onMuteRound={() => {
            muteRound(roundId);
            setMuted(true);
            setSheet(null);
          }}
          units={units}
          handedness={handedness}
        />
      )}
    </View>
  );
}
