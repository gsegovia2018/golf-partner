import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { useTheme } from '../theme/ThemeContext';
import { useAppSettings } from '../hooks/useAppSettings';
import { updateAppSettings } from '../store/settingsStore';

const STAT_GROUP_ROWS = [
  { key: 'putting', label: 'Putting', loss: 'Off: no putting stats, no GIR, no strokes gained putting' },
  { key: 'teeShot', label: 'Tee shot', loss: 'Off: no fairways hit, no driving distance, no SG off the tee' },
  { key: 'approach', label: 'Approach', loss: 'Off: no approach breakdown, no SG approach' },
  { key: 'shortGame', label: 'Short game', loss: 'Off: no sand saves or up-and-downs, reduced SG around the green' },
  { key: 'penalties', label: 'Penalties', loss: 'Off: no penalty stats, no SG penalties' },
];

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'smartphone' },
];

function SwitchRow({ testID, label, hint, value, onChange, disabled, theme, s }) {
  return (
    <View style={s.prefRow}>
      <View style={{ flex: 1 }}>
        <Text style={[s.prefLabel, disabled && { color: theme.text.muted }]}>{label}</Text>
        {hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
      </View>
      <Switch
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: theme.border.default, true: theme.accent.primary }}
        thumbColor={Platform.OS === 'android' ? theme.bg.card : undefined}
      />
    </View>
  );
}

export default function SettingsScreen({ navigation }) {
  const { theme, themePref, setThemeMode } = useTheme();
  const s = makeStyles(theme);
  const appSettings = useAppSettings();
  const setKey = useCallback((patch) => { updateAppSettings(patch).catch(() => {}); }, []);

  function handleBack() {
    navigation.goBack();
  }

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton
          icon="chevron-left"
          accessibilityLabel="Back"
          onPress={handleBack}
        />
        <Text style={s.headerTitle}>Settings</Text>
        <View style={s.backBtn} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        <Text style={s.sectionLabel}>ROUND & GPS</Text>
        <SwitchRow testID="setting-gpsEnabled" label="GPS distances"
          hint="Live distances from your position. Off: distances measure from the tee and the app never asks for your location."
          value={appSettings.gpsEnabled} onChange={(v) => setKey({ gpsEnabled: v })} theme={theme} s={s} />
        <SwitchRow testID="setting-keepAwake" label="Keep screen awake"
          hint="Stops the screen sleeping while the scorecard is open."
          value={appSettings.keepAwake} onChange={(v) => setKey({ keepAwake: v })} theme={theme} s={s} />
        <SwitchRow testID="setting-autoAdvanceHole" label="Auto-advance hole"
          hint="Flip to the next hole once every player has a score."
          value={appSettings.autoAdvanceHole} onChange={(v) => setKey({ autoAdvanceHole: v })} theme={theme} s={s} />
        <SwitchRow testID="setting-haptics" label="Haptic feedback"
          hint="Vibrate on score entry."
          value={appSettings.haptics} onChange={(v) => setKey({ haptics: v })} theme={theme} s={s} />
        <SwitchRow testID="setting-noSpoilers" label="No-spoilers mode"
          hint="Hide running points and leaderboards until the round is finished."
          value={appSettings.noSpoilers} onChange={(v) => setKey({ noSpoilers: v })} theme={theme} s={s} />
        <SwitchRow testID="setting-showRunningScore" label="Show running points"
          hint={appSettings.noSpoilers ? 'Off while no-spoilers mode is on.' : 'Total Stableford points under every scorecard name.'}
          value={appSettings.showRunningScore && !appSettings.noSpoilers}
          disabled={appSettings.noSpoilers}
          onChange={(v) => setKey({ showRunningScore: v })} theme={theme} s={s} />

        <Text style={s.sectionLabel}>STATS TRACKING</Text>
        <Text style={s.fieldHint}>Turn off what you don&apos;t want to log — the scorecard hides those inputs.</Text>
        {STAT_GROUP_ROWS.map(({ key, label, loss }) => (
          <SwitchRow key={key} testID={`setting-statGroups.${key}`} label={label} hint={loss}
            value={appSettings.statGroups[key]}
            onChange={(v) => setKey({ statGroups: { [key]: v } })} theme={theme} s={s} />
        ))}

        <Text style={s.sectionLabel}>DISPLAY</Text>
        <View style={s.segmentRow}>
          {[['meters', 'Meters'], ['yards', 'Yards']].map(([value, label]) => (
            <TouchableOpacity key={value}
              style={[s.segment, appSettings.units === value && s.segmentActive]}
              onPress={() => setKey({ units: value })}
              accessibilityRole="button" accessibilityState={{ selected: appSettings.units === value }}>
              <Text style={[s.segmentText, appSettings.units === value && s.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={s.appearanceRow}>
          {THEME_OPTIONS.map((opt) => {
            const active = themePref === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[s.appearanceTile, active && s.appearanceTileActive]}
                onPress={() => setThemeMode(opt.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                activeOpacity={0.7}
              >
                <Feather
                  name={opt.icon}
                  size={18}
                  color={active ? theme.accent.primary : theme.text.muted}
                />
                <Text style={[s.appearanceLabel, active && s.appearanceLabelActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={s.sectionLabel}>NOTIFICATIONS</Text>
        <SwitchRow testID="setting-notifications.scores" label="Score updates"
          hint="When a friend finishes a round."
          value={appSettings.notifications.scores}
          onChange={(v) => setKey({ notifications: { scores: v } })} theme={theme} s={s} />
        <SwitchRow testID="setting-notifications.invites" label="Invites & friends"
          hint="Friend requests and being added to games."
          value={appSettings.notifications.invites}
          onChange={(v) => setKey({ notifications: { invites: v } })} theme={theme} s={s} />
        <SwitchRow testID="setting-notifications.media" label="Photos & reactions"
          hint="Comments and reactions on rounds."
          value={appSettings.notifications.media}
          onChange={(v) => setKey({ notifications: { media: v } })} theme={theme} s={s} />
      </ScrollView>
    </ScreenContainer>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },

  sectionLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 11,
    marginBottom: 12, marginTop: 16, letterSpacing: 1.8, textTransform: 'uppercase',
  },
  fieldHint: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 11, marginTop: 6,
  },

  prefRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: theme.border.default, padding: 14,
    ...(theme.isDark ? {} : theme.shadow.card),
    marginBottom: 10,
  },
  prefLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14,
  },

  segmentRow: {
    flexDirection: 'row', gap: 10, marginBottom: 10,
  },
  segment: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, borderWidth: 1.5, borderColor: theme.border.default,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  segmentActive: { borderColor: theme.accent.primary, backgroundColor: theme.accent.light },
  segmentText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 13 },
  segmentTextActive: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },

  appearanceRow: { flexDirection: 'row', gap: 10 },
  appearanceTile: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.bg.card,
    borderRadius: 14, borderWidth: 1, borderColor: theme.border.default,
    paddingVertical: 14,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  appearanceTileActive: {
    borderColor: theme.accent.primary,
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.light,
  },
  appearanceLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 14,
  },
  appearanceLabelActive: {
    color: theme.accent.primary,
    fontFamily: 'PlusJakartaSans-Bold',
  },
});
