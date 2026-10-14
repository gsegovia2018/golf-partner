import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '../BottomSheet';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import { useT, formatNumber } from '../../i18n';

const CONFLICT = semantic.conflict.base;
const DEFAULT_STROKES = 4; // par-ish fallback when no candidate carries a value

const keyOf = (row) => `${row.playerId}:${row.hole}`;
const valueLabel = (v, tl) => (v == null ? tl('scorecard.conflict.noScore') : formatNumber(v));

// Compact relative time for a candidate's edit timestamp.
function relTime(ts, tl) {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return tl('scorecard.conflict.justNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return tl('scorecard.conflict.minAgo', { count: formatNumber(min) });
  const hr = Math.floor(min / 60);
  if (hr < 24) return tl('scorecard.conflict.hAgo', { count: formatNumber(hr) });
  return tl('scorecard.conflict.dAgo', { count: formatNumber(Math.floor(hr / 24)) });
}

// The one score-conflict surface: a wizard that settles one disagreement at a
// time. Replaces the three older sheets (mid-round prompt, finish-time summary,
// single-cell resolver) — each caller supplies rows and its primary action.
//
// Rows are derived live by the parent, so a row vanishes on the next render as
// soon as it is resolved — by this phone or by any other. The cursor therefore
// never indexes into `rows`; it pins the row on screen by key and falls back to
// the first unskipped row once that key is gone.
//
// Props:
//   visible, onClose
//   rows          — [{ playerId, hole, par?, playerName, currentValue,
//                      candidates: [{ value, ts, authorId, authorName }],
//                      blankAuthors: [name] }]
//   localAuthorIds — author ids written by this phone; they render as "You"
//   onPick        — (playerId, hole, value) resolve the current row
//   primaryLabel, onPrimary — primary action
//   allowPrimaryWhilePending — render the primary action even with rows left
//                              (the mid-round "Continue anyway" escape hatch);
//                              when false the primary only appears once done
//   secondaryLabel, onSecondary — optional ghost action, done state only
//   doneSubtitle  — optional override for the done-state summary line
export default function ConflictWizardSheet({
  visible, onClose, rows, localAuthorIds, onPick,
  primaryLabel, onPrimary, allowPrimaryWhilePending = false,
  secondaryLabel, onSecondary, doneSubtitle,
}) {
  // Tolerate a missing ThemeProvider (some render tests mount sheets without
  // one) — matches BottomSheet.js.
  const { theme } = useTheme() || {};
  const tl = useT();
  const s = makeStyles(theme);

  const list = useMemo(() => (Array.isArray(rows) ? rows : []), [rows]);
  const localIds = useMemo(
    () => new Set((Array.isArray(localAuthorIds) ? localAuthorIds : []).filter(Boolean)),
    [localAuthorIds],
  );

  const [skippedKeys, setSkippedKeys] = useState(() => new Set());
  const [cursorKey, setCursorKey] = useState(null);
  const [settledCount, setSettledCount] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState(DEFAULT_STROKES);

  const remaining = list.filter((r) => !skippedKeys.has(keyOf(r)));
  const current = remaining.find((r) => keyOf(r) === cursorKey) ?? remaining[0] ?? null;
  const currentKey = current ? keyOf(current) : null;

  const keySig = list.map(keyOf).join('|');
  const seenKeysRef = useRef(new Set());

  // Reset the session whenever the sheet opens; re-baseline the key set in the
  // same pass so the settled counter never charges for rows that were already
  // gone before this session started.
  useEffect(() => {
    if (!visible) return;
    setSkippedKeys(new Set());
    setCursorKey(null);
    setSettledCount(0);
    setManualOpen(false);
    seenKeysRef.current = new Set(keySig ? keySig.split('|') : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // A key that was in `rows` and no longer is has been settled — by this phone
  // or another one. Counting disappearances (rather than picks) keeps the
  // progress total stable when a peer resolves a row we never touched.
  useEffect(() => {
    const now = new Set(keySig ? keySig.split('|') : []);
    const prev = seenKeysRef.current;
    seenKeysRef.current = now;
    const gone = [...prev].filter((k) => !now.has(k));
    if (!gone.length) return;
    setSettledCount((c) => c + gone.length);
    setSkippedKeys((prevSkipped) => {
      if (!gone.some((k) => prevSkipped.has(k))) return prevSkipped;
      const next = new Set(prevSkipped);
      for (const k of gone) next.delete(k);
      return next;
    });
  }, [keySig]);

  // Pin the cursor to whatever row is on screen, so a row arriving at the front
  // of `rows` mid-decision cannot swap the question under the user's thumb.
  useEffect(() => {
    if (currentKey && currentKey !== cursorKey) setCursorKey(currentKey);
  }, [currentKey, cursorKey]);

  // Seed the manual stepper from the row on screen and collapse it again on
  // every row change.
  useEffect(() => {
    setManualOpen(false);
    const row = list.find((r) => keyOf(r) === currentKey);
    const seed = (row?.candidates ?? []).find((c) => c.value != null)?.value
      ?? row?.currentValue ?? DEFAULT_STROKES;
    setManual(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  const total = Math.max(1, settledCount + list.length);

  const pick = (value) => {
    if (!current) return;
    onPick?.(current.playerId, current.hole, value);
  };

  const stepManual = (delta) => setManual((m) => Math.max(1, Math.min(15, m + delta)));

  const skipCurrent = () => {
    if (!currentKey) return;
    setSkippedKeys((prev) => new Set(prev).add(currentKey));
  };

  const primaryButton = (
    <TouchableOpacity
      style={s.primary}
      onPress={() => onPrimary?.()}
      activeOpacity={0.8}
      accessibilityLabel={primaryLabel}
    >
      <Text style={s.primaryText}>{primaryLabel}</Text>
    </TouchableOpacity>
  );

  const foot = <Text style={s.foot}>{tl('scorecard.conflict.foot')}</Text>;

  // Nothing left to ask: either everything is settled, or the rows that remain
  // were all deferred with "Decide later".
  if (!current) {
    const undecided = list.length;
    return (
      <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
        <View style={s.handle} />
        <View style={s.done}>
          <View style={[s.doneIcon, undecided > 0 && s.doneIconPending]}>
            <Feather
              name={undecided > 0 ? 'clock' : 'check'}
              size={28}
              color={undecided > 0 ? CONFLICT : theme?.accent?.primary}
            />
          </View>
          <Text style={s.doneTitle}>{undecided > 0 ? tl('scorecard.conflict.leftForLater') : tl('scorecard.conflict.allAgreed')}</Text>
          <Text style={s.doneSub}>
            {undecided > 0
              ? tl('scorecard.conflict.undecided', { count: formatNumber(undecided) })
              : (doneSubtitle ?? (settledCount > 0
                ? tl('scorecard.conflict.settledAll', { count: formatNumber(settledCount) })
                : tl('scorecard.conflict.allSettled')))}
          </Text>
          {(undecided === 0 || allowPrimaryWhilePending) && primaryButton}
          {undecided > 0 && (
            <TouchableOpacity
              style={s.ghost}
              // Rewind the cursor too, so "review again" restarts at the first
              // deferred row rather than resuming at the last one skipped.
              onPress={() => { setSkippedKeys(new Set()); setCursorKey(null); }}
              activeOpacity={0.8}
              accessibilityLabel={tl('scorecard.conflict.reviewAgain')}
            >
              <Text style={s.ghostText}>{tl('scorecard.conflict.reviewAgain')}</Text>
            </TouchableOpacity>
          )}
          {undecided === 0 && secondaryLabel != null && (
            <TouchableOpacity
              style={s.ghost}
              onPress={() => onSecondary?.()}
              activeOpacity={0.8}
              accessibilityLabel={secondaryLabel}
            >
              <Text style={s.ghostText}>{secondaryLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
        {foot}
      </BottomSheet>
    );
  }

  const { playerName, hole, par } = current;
  const subject = playerName || tl('scorecard.conflict.playerFallback');

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <View style={s.handle} />

      <View style={s.top}>
        <Text style={s.count}>{tl('scorecard.conflict.progress', { current: formatNumber(settledCount + 1), total: formatNumber(total) })}</Text>
        <View style={s.segments}>
          {Array.from({ length: total }, (_, i) => (
            <View
              key={i}
              style={[
                s.segment,
                i < settledCount && s.segmentDone,
                i === settledCount && s.segmentNow,
              ]}
            />
          ))}
        </View>
        <TouchableOpacity
          style={s.close}
          onPress={() => onClose?.()}
          accessibilityLabel={tl('scorecard.conflict.close')}
        >
          <Feather name="x" size={18} color={theme?.text?.secondary} />
        </TouchableOpacity>
      </View>

      <View style={s.band}>
        <View style={s.bandHole}>
          <Text style={s.bandHoleText}>{hole}</Text>
        </View>
        <View style={s.bandWho}>
          <Text style={s.bandWhoTitle}>{tl('scorecard.conflict.scoreOf', { name: subject })}</Text>
          <Text style={s.bandWhoSub}>
            {par != null
              ? tl('scorecard.conflict.holeParDisagree', { hole: formatNumber(hole), par: formatNumber(par) })
              : tl('scorecard.conflict.holeDisagree', { hole: formatNumber(hole) })}
          </Text>
        </View>
        <View style={s.bandAvatar}>
          <Text style={s.bandAvatarText}>{subject.charAt(0)}</Text>
        </View>
      </View>

      <View style={s.cards}>
        {(current.candidates ?? []).map((c, i) => {
          const isYou = localIds.has(c.authorId) || c.authorName === 'You';
          const name = isYou ? tl('scorecard.conflict.you') : (c.authorName ?? tl('scorecard.conflict.anotherPhone'));
          const when = relTime(c.ts, tl);
          return (
            <TouchableOpacity
              key={`${String(c.value)}-${c.ts}-${i}`}
              style={s.card}
              onPress={() => pick(c.value)}
              activeOpacity={0.8}
              accessibilityLabel={
                c.value == null
                  ? tl('scorecard.conflict.useNone', { subject, hole: formatNumber(hole) })
                  : tl('scorecard.conflict.useFor', { count: formatNumber(c.value), subject, hole: formatNumber(hole) })
              }
            >
              <View style={s.author}>
                <View style={[s.authorAvatar, isYou && s.authorAvatarYou]}>
                  <Text style={[s.authorAvatarText, isYou && s.authorAvatarTextYou]}>
                    {isYou ? tl('scorecard.conflict.youInitial') : name.charAt(0)}
                  </Text>
                </View>
                <Text style={s.authorName} numberOfLines={1}>
                  {isYou ? tl('scorecard.conflict.youWrote') : tl('scorecard.conflict.wrote', { name })}
                </Text>
              </View>
              <Text style={[s.cardValue, c.value == null && s.cardValueNone]}>
                {valueLabel(c.value, tl)}
              </Text>
              {when !== '' && <Text style={s.cardWhen}>{when}</Text>}
              <View style={s.keep}>
                <Text style={s.keepText}>{tl('scorecard.conflict.keep')}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {Array.isArray(current.blankAuthors) && current.blankAuthors.length > 0 && (
        <Text style={s.blankNote}>{tl('scorecard.conflict.blankNote', { names: current.blankAuthors.join(', ') })}</Text>
      )}

      <View style={s.manualRow}>
        {manualOpen ? (
          <>
            <Text style={s.manualLabel}>{tl('scorecard.conflict.different')}</Text>
            <View style={s.stepper}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => stepManual(-1)}
                accessibilityLabel={tl('scorecard.conflict.decrease', { subject })}
              >
                <Feather name="minus" size={14} color={theme?.text?.primary} />
              </TouchableOpacity>
              <Text style={s.stepValue}>{manual}</Text>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => stepManual(1)}
                accessibilityLabel={tl('scorecard.conflict.increase', { subject })}
              >
                <Feather name="plus" size={14} color={theme?.text?.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={s.pill}
                onPress={() => pick(manual)}
                activeOpacity={0.8}
                accessibilityLabel={tl('scorecard.conflict.useStrokes', { count: formatNumber(manual) })}
              >
                <Text style={s.pillText}>{tl('scorecard.conflict.useShort', { count: formatNumber(manual) })}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={s.manualLabel}>{tl('scorecard.conflict.neither')}</Text>
            <TouchableOpacity
              style={s.pill}
              onPress={() => setManualOpen(true)}
              activeOpacity={0.8}
              accessibilityLabel={tl('scorecard.conflict.enterOther')}
            >
              <Text style={s.pillText}>{tl('scorecard.conflict.enterOther')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <TouchableOpacity
        style={s.ghost}
        onPress={skipCurrent}
        activeOpacity={0.8}
        accessibilityLabel={tl('scorecard.conflict.decideLater')}
      >
        <Text style={s.ghostText}>{tl('scorecard.conflict.decideLater')}</Text>
      </TouchableOpacity>
      {allowPrimaryWhilePending && primaryButton}
      {foot}
    </BottomSheet>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sheet: {
    backgroundColor: theme?.bg?.primary,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 20,
    width: '100%', maxWidth: 560, alignSelf: 'center',
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: theme?.border?.default, marginBottom: 12,
  },

  /* Progress header */
  top: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  count: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme?.text?.secondary },
  segments: { flexDirection: 'row', gap: 5, flex: 1, marginHorizontal: 14 },
  segment: { height: 4, borderRadius: 2, flex: 1, backgroundColor: theme?.border?.default },
  segmentDone: { backgroundColor: theme?.accent?.primary },
  segmentNow: { backgroundColor: CONFLICT },
  close: { padding: 4 },

  /* Amber hole band. The soft fills are the one conflict token at low alpha —
     same derivation as the conflicted hero card in scorecard/styles.js, so no
     second amber enters the palette. */
  band: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: CONFLICT + '1a',
    borderWidth: 1, borderColor: CONFLICT + '40',
    borderRadius: 14, padding: 12, marginBottom: 14,
  },
  bandHole: {
    width: 52, height: 52, borderRadius: 12,
    backgroundColor: theme?.bg?.card,
    borderWidth: 1, borderColor: CONFLICT + '40',
    alignItems: 'center', justifyContent: 'center',
  },
  bandHoleText: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 24, color: CONFLICT },
  bandWho: { flex: 1, minWidth: 0 },
  bandWhoTitle: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, color: theme?.text?.primary },
  bandWhoSub: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme?.text?.secondary,
    marginTop: 2,
  },
  bandAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: CONFLICT + '26',
    alignItems: 'center', justifyContent: 'center',
  },
  bandAvatarText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, color: CONFLICT },

  /* Candidate cards */
  cards: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  card: {
    flexGrow: 1, flexBasis: 0, minWidth: 130,
    backgroundColor: theme?.bg?.card,
    borderRadius: 16, borderWidth: 1.5, borderColor: theme?.border?.default,
    paddingTop: 14, paddingBottom: 12, paddingHorizontal: 12,
    alignItems: 'center',
  },
  author: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  authorAvatar: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: theme?.accent?.light,
    alignItems: 'center', justifyContent: 'center',
  },
  authorAvatarYou: { backgroundColor: theme?.accent?.primary },
  authorAvatarText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10, color: theme?.accent?.primary },
  authorAvatarTextYou: { color: theme?.text?.inverse },
  authorName: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme?.text?.primary,
    flexShrink: 1,
  },
  cardValue: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 40, lineHeight: 44,
    color: theme?.text?.primary,
  },
  cardValueNone: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 22, color: theme?.text?.muted },
  cardWhen: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme?.text?.muted, marginTop: 6,
  },
  keep: {
    marginTop: 12, alignSelf: 'stretch', alignItems: 'center',
    backgroundColor: theme?.accent?.light, borderRadius: 999, paddingVertical: 7,
  },
  keepText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: theme?.accent?.primary },

  blankNote: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme?.text?.muted, marginTop: 10,
  },

  /* Manual entry */
  manualRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: theme?.border?.default,
  },
  manualLabel: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme?.text?.secondary },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: theme?.bg?.secondary,
    borderWidth: 1, borderColor: theme?.border?.default,
    alignItems: 'center', justifyContent: 'center',
  },
  stepValue: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 18, color: theme?.text?.primary,
    minWidth: 22, textAlign: 'center',
  },
  pill: {
    backgroundColor: theme?.accent?.light, borderRadius: 999,
    paddingHorizontal: 13, paddingVertical: 8,
  },
  pillText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: theme?.accent?.primary },

  /* Actions */
  ghost: {
    marginTop: 12, backgroundColor: theme?.bg?.card,
    borderRadius: 14, paddingVertical: 13, alignItems: 'center',
    borderWidth: 1.5, borderColor: theme?.border?.default,
    alignSelf: 'stretch',
  },
  ghostText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme?.text?.primary },
  primary: {
    marginTop: 12, backgroundColor: theme?.accent?.primary,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    alignSelf: 'stretch',
  },
  primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, color: theme?.text?.inverse },
  foot: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme?.text?.muted,
    textAlign: 'center', marginTop: 10,
  },

  /* Done / undecided state */
  done: {
    alignItems: 'center', alignSelf: 'stretch',
    paddingTop: 26, paddingHorizontal: 10, paddingBottom: 6,
  },
  doneIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: theme?.accent?.light,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  doneIconPending: { backgroundColor: CONFLICT + '1a' },
  doneTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 21, color: theme?.text?.primary },
  doneSub: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: theme?.text?.secondary,
    textAlign: 'center', marginTop: 8, marginBottom: 8,
  },
});
