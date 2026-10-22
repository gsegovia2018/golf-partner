import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, useWindowDimensions,
  Switch, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useT } from '../i18n';

import { useTheme } from '../theme/ThemeContext';
import BottomSheet from './BottomSheet';
import IconButton from './ui/IconButton';
import {
  SCORING_MODES,
  isScoringModeAllowed,
  fallbackScoringMode,
  scoringModeCategories,
  getScoringMode,
  scoringModeUsesTeams,
} from './scoringModes';

// Re-export the pure helpers so existing call sites
// (`import { isScoringModeAllowed } from '../components/ScoringModePicker'`)
// keep working now that the data/logic lives in scoringModes.js.
export { SCORING_MODES, isScoringModeAllowed, fallbackScoringMode };

// The note shown when the player count forced a mode change: the two mode
// definitions, rendered with t() at render time. Null when either is unknown.
function fallbackNotice(prevKey, nextKey) {
  const prev = SCORING_MODES.find((m) => m.key === prevKey);
  const next = SCORING_MODES.find((m) => m.key === nextKey);
  return prev && next ? { prev, next } : null;
}

// Category sections are derived from static data — compute once.
const MODE_SECTIONS = scoringModeCategories();

// --- Bottom-sheet mode list ----------------------------------------------

export function ScoringModeSheet({ visible, value, playerCount, onSelect, onClose }) {
  const t = useT();
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.round(height * 0.7);

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{t('setup.scoringMode.choose')}</Text>
            <IconButton icon="x" onPress={onClose} accessibilityLabel={t('setup.scoringMode.close')} />
          </View>

          <ScrollView style={{ maxHeight: sheetMaxHeight }} showsVerticalScrollIndicator={false}>
            {MODE_SECTIONS.map((section) => (
              <View key={section.category}>
                <Text style={s.sectionHeader}>{t(section.categoryKey)}</Text>
                {section.modes.map((mode) => {
                  const allowed = mode.isAllowed(playerCount);
                  const active = value === mode.key;
                  return (
                    <TouchableOpacity
                      key={mode.key}
                      style={[s.row, !allowed && s.rowDisabled]}
                      activeOpacity={allowed ? 0.7 : 1}
                      onPress={() => { if (allowed) onSelect(mode.key); }}
                      accessibilityState={{ disabled: !allowed, selected: active }}
                    >
                      <Feather
                        name={mode.icon}
                        size={20}
                        color={allowed ? theme.accent.primary : theme.text.muted}
                      />
                      <View style={s.rowText}>
                        <Text style={[s.rowLabel, !allowed && s.rowLabelDisabled]}>
                          {t(mode.labelKey)}
                        </Text>
                        {allowed ? (
                          <Text style={s.rowSubtitle}>{t(mode.subtitleKey)}</Text>
                        ) : (
                          <View style={s.reqPill}>
                            <Text style={s.reqPillText}>{t(mode.requirementKey)}</Text>
                          </View>
                        )}
                      </View>
                      {active && (
                        <Feather name="check" size={14} color={theme.accent.primary} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </ScrollView>
    </BottomSheet>
  );
}

// --- Same-teams / manual-vs-random controls -------------------------------
// Shared by the compact field below (single-round setup, post-creation
// "Scoring Mode" sheet) and the dedicated 'teams' wizard step for multi-round
// setups (SetupScreen.js) — same visuals, same settings, one definition.
// `hideFixedTeams` drops the "same teams every round" switch where there is
// only one round to apply it to (a casual game, a single-round setup).
export function TeamsSettingsFields({
  value, playerCount, settings, onSettingsChange, hideFixedTeams,
}) {
  const t = useT();
  const { theme } = useTheme();
  const s = makeStyles(theme);
  if (!settings || !onSettingsChange || !scoringModeUsesTeams(value, playerCount)) return null;

  return (
    <>
      {!hideFixedTeams && (
        <View style={s.fixedTeamsRow}>
          <View style={s.fixedTeamsText}>
            <Text style={s.fixedTeamsLabel}>{t('setup.scoringMode.sameTeams')}</Text>
            <Text style={s.fixedTeamsHint}>{t('setup.scoringMode.sameTeamsHint')}</Text>
          </View>
          <Switch
            value={Boolean(settings.fixedTeams)}
            onValueChange={(v) => onSettingsChange({ ...settings, fixedTeams: v })}
            trackColor={{ false: theme.border.default, true: theme.accent.primary }}
            thumbColor={Platform.OS === 'android' ? theme.bg.card : undefined}
          />
        </View>
      )}

      {value !== 'scramble4' && (
        <View style={s.teamsRow}>
          <Text style={s.teamsLabel}>{t('setup.scoringMode.teams')}</Text>
          <View style={s.segmentGroup}>
            <TouchableOpacity
              style={[s.segmentBtn, !settings.manualTeams && s.segmentBtnActive]}
              onPress={() => onSettingsChange({ ...settings, manualTeams: false })}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: !settings.manualTeams }}
            >
              <Text style={[s.segmentBtnText, !settings.manualTeams && s.segmentBtnTextActive]}>
                {t('setup.scoringMode.randomDraw')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.segmentBtn, Boolean(settings.manualTeams) && s.segmentBtnActive]}
              onPress={() => onSettingsChange({ ...settings, manualTeams: true })}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: Boolean(settings.manualTeams) }}
            >
              <Text style={[s.segmentBtnText, Boolean(settings.manualTeams) && s.segmentBtnTextActive]}>
                {t('setup.scoringMode.chooseMyself')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );
}

// The Best Ball / Worst Ball "pts / hole" inputs. Shared by ScoringModeField
// (tournament defaults at setup) and HomeScreen's per-round Point Values
// sheet. `settings` holds the two values as strings (TextInput-backed).
export function BestBallValueFields({ settings, onSettingsChange }) {
  const t = useT();
  const { theme } = useTheme();
  const s = makeStyles(theme);
  return (
    <View style={s.valueRow}>
      <View style={s.valueBlock}>
        <Text style={s.valueLabel}>{t('home.roundMode.bestball')}</Text>
        <TextInput
          style={s.valueInput}
          keyboardType="numeric"
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          selectionColor={theme.accent.primary}
          maxLength={2}
          value={String(settings.bestBallValue)}
          onChangeText={(v) => onSettingsChange({ ...settings, bestBallValue: v })}
        />
        <Text style={s.valueSuffix}>{t('setup.scoringMode.ptsPerHole')}</Text>
      </View>
      <View style={s.valueBlock}>
        <Text style={s.valueLabel}>{t('game.picker.worstBall')}</Text>
        <TextInput
          style={s.valueInput}
          keyboardType="numeric"
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          selectionColor={theme.accent.primary}
          maxLength={2}
          value={String(settings.worstBallValue)}
          onChangeText={(v) => onSettingsChange({ ...settings, worstBallValue: v })}
        />
        <Text style={s.valueSuffix}>{t('setup.scoringMode.ptsPerHole')}</Text>
      </View>
    </View>
  );
}

// --- Compact field shown on the setup screens ----------------------------

export default function ScoringModeField({
  value, onChange, playerCount, settings, onSettingsChange, hideTeamsControls, hideFixedTeams,
}) {
  const t = useT();
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState(null);

  // prevValueRef tracks the last value we rendered. userPickedRef is set when
  // the change came from a sheet tap — so we can tell an intentional pick
  // apart from the parent's auto-fallback and only surface the latter.
  const prevValueRef = useRef(value);
  const userPickedRef = useRef(false);

  useEffect(() => {
    if (value === prevValueRef.current) return;
    if (userPickedRef.current) {
      userPickedRef.current = false;
    } else {
      setNotice(fallbackNotice(prevValueRef.current, value));
    }
    prevValueRef.current = value;
  }, [value]);

  const current = getScoringMode(value);

  function handleSelect(key) {
    userPickedRef.current = true;
    setNotice(null);
    setSheetOpen(false);
    onChange(key);
  }

  function openSheet() {
    setNotice(null);
    setSheetOpen(true);
  }

  return (
    <View>
      <TouchableOpacity
        style={s.field}
        onPress={openSheet}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={t('setup.scoringMode.fieldLabel', { mode: t(current.labelKey) })}
        accessibilityHint={t('setup.scoringMode.fieldHint')}
      >
        <Feather name={current.icon} size={20} color={theme.accent.primary} />
        <View style={s.fieldText}>
          <Text style={s.fieldLabel}>{t(current.labelKey)}</Text>
          <Text style={s.fieldSubtitle}>{t(current.subtitleKey)}</Text>
        </View>
        <Feather name="chevron-down" size={20} color={theme.text.muted} />
      </TouchableOpacity>

      {notice && (
        <View style={s.notice}>
          <Feather name="info" size={14} color={theme.accent.primary} />
          <Text style={s.noticeText}>
            {t('setup.scoringMode.fallbackNotice', {
              prev: t(notice.prev.labelKey),
              reason: t(notice.prev.needKey),
              next: t(notice.next.labelKey),
            })}
          </Text>
          <TouchableOpacity onPress={() => setNotice(null)} accessibilityLabel={t('setup.scoringMode.dismiss')} accessibilityRole="button">
            <Feather name="x" size={14} color={theme.text.muted} />
          </TouchableOpacity>
        </View>
      )}

      {value === 'bestball' && settings && onSettingsChange && (
        <BestBallValueFields settings={settings} onSettingsChange={onSettingsChange} />
      )}

      {!hideTeamsControls && (
        <TeamsSettingsFields
          value={value}
          playerCount={playerCount}
          settings={settings}
          onSettingsChange={onSettingsChange}
          hideFixedTeams={hideFixedTeams}
        />
      )}

      <ScoringModeSheet
        visible={sheetOpen}
        value={value}
        playerCount={playerCount}
        onSelect={handleSelect}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  /* Compact field */
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border.default,
    padding: 14,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  fieldText: { flex: 1 },
  fieldLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15,
  },
  fieldSubtitle: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, marginTop: 2,
  },

  /* Fallback notice */
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.accent.light,
    borderRadius: 10, borderWidth: 1, borderColor: theme.accent.primary + '40',
    padding: 10, marginTop: 8,
  },
  noticeText: {
    flex: 1, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12,
  },

  /* Bottom sheet */
  sheet: {
    backgroundColor: theme.bg.primary, padding: 20,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32,
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4,
  },
  sheetTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  sectionHeader: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 11,
    letterSpacing: 1.8, textTransform: 'uppercase', marginTop: 16, marginBottom: 6,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: theme.border.subtle,
  },
  rowDisabled: { opacity: 0.55 },
  rowText: { flex: 1 },
  rowLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 15,
  },
  rowLabelDisabled: { color: theme.text.muted },
  rowSubtitle: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, marginTop: 2,
  },
  reqPill: {
    alignSelf: 'flex-start', marginTop: 4,
    backgroundColor: theme.bg.secondary,
    borderRadius: 6, borderWidth: 1, borderColor: theme.border.default,
    paddingVertical: 2, paddingHorizontal: 8,
  },
  reqPillText: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 11,
  },

  /* Best/Worst ball value inputs (unchanged from the previous picker) */
  valueRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  valueBlock: {
    flex: 1, backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16, alignItems: 'center', gap: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  valueLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 12, letterSpacing: 0.5,
  },
  valueInput: {
    backgroundColor: theme.isDark ? theme.bg.primary : theme.bg.secondary,
    color: theme.text.primary, borderRadius: 8, borderWidth: 1,
    borderColor: theme.border.default,
    width: 56, textAlign: 'center', fontSize: 22,
    fontFamily: 'PlusJakartaSans-ExtraBold', padding: 8,
  },
  valueSuffix: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 11 },

  /* Fixed teams toggle */
  fixedTeamsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderRadius: 12, borderWidth: 1, borderColor: theme.border.default,
    padding: 14, marginTop: 10,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  fixedTeamsText: { flex: 1 },
  fixedTeamsLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14,
  },
  fixedTeamsHint: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, marginTop: 2,
  },

  /* Manual teams segmented choice */
  teamsRow: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderRadius: 12, borderWidth: 1, borderColor: theme.border.default,
    padding: 14, marginTop: 10,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  teamsLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14, marginBottom: 10,
  },
  segmentGroup: {
    flexDirection: 'row', backgroundColor: theme.bg.secondary,
    borderRadius: 10, borderWidth: 1, borderColor: theme.border.default, padding: 3, gap: 3,
  },
  segmentBtn: {
    flex: 1, borderRadius: 8, paddingVertical: 9, alignItems: 'center', justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: theme.accent.primary,
  },
  segmentBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 13,
    textAlign: 'center',
  },
  segmentBtnTextActive: {
    color: theme.isDark ? theme.text.primary : theme.text.inverse,
  },
});

// The compact field + sheet styles, shared with the league format field so the
// two pickers cannot drift apart.
export { makeStyles as scoringPickerStyles };
