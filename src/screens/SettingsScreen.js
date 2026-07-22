import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Platform, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PressableScale from '../components/ui/PressableScale';
import Reveal from '../components/ui/Reveal';
import { useTheme } from '../theme/ThemeContext';
import { useAppSettings } from '../hooks/useAppSettings';
import { updateAppSettings } from '../store/settingsStore';
import { resetTour } from '../store/tourStore';
import { haptic } from '../lib/haptics';

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

// Stagger step between section reveals on mount.
const REVEAL_STEP = 40;

function SwitchRow({ testID, label, hint, value, onChange, disabled, first, theme, s }) {
  return (
    <View style={[s.prefRow, !first && s.prefRowDivider]}>
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

function Section({ title, hint, delay, s, children }) {
  return (
    <Reveal delay={delay}>
      <Text style={s.sectionLabel}>{title}</Text>
      {hint ? <Text style={s.sectionHint}>{hint}</Text> : null}
      <View style={s.groupCard}>{children}</View>
    </Reveal>
  );
}

export default function SettingsScreen({ navigation }) {
  const { theme, themePref, setThemeMode } = useTheme();
  const s = makeStyles(theme);
  const appSettings = useAppSettings();
  const setKey = useCallback((patch) => {
    haptic('selection');
    updateAppSettings(patch).catch(() => {});
  }, []);

  // OS-level notification permission: when it's denied, the toggles below
  // silently do nothing — surface that with a link to system settings.
  const [pushBlocked, setPushBlocked] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    let mounted = true;
    (async () => {
      try {
        const Notifications = require('expo-notifications');
        const { status } = await Notifications.getPermissionsAsync();
        if (mounted && status === 'denied') setPushBlocked(true);
      } catch { /* best-effort — assume granted */ }
    })();
    return () => { mounted = false; };
  }, []);

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
        <Section title="ON THE COURSE" delay={0} s={s}>
          <SwitchRow testID="setting-gpsEnabled" label="GPS distances" first
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
        </Section>

        <Section title="SCORE VISIBILITY" delay={REVEAL_STEP} s={s}>
          <SwitchRow testID="setting-noSpoilers" label="No-spoilers mode" first
            hint="Hide running points and leaderboards until the round is finished."
            value={appSettings.noSpoilers} onChange={(v) => setKey({ noSpoilers: v })} theme={theme} s={s} />
          <SwitchRow testID="setting-showRunningScore" label="Show running points"
            hint={appSettings.noSpoilers ? 'Off while no-spoilers mode is on.' : 'Total Stableford points under every scorecard name.'}
            value={appSettings.showRunningScore && !appSettings.noSpoilers}
            disabled={appSettings.noSpoilers}
            onChange={(v) => setKey({ showRunningScore: v })} theme={theme} s={s} />
        </Section>

        <Section title="STATS TRACKING" delay={REVEAL_STEP * 2}
          hint="Turn off what you don't want to log — the scorecard hides those inputs." s={s}>
          {STAT_GROUP_ROWS.map(({ key, label, loss }, i) => (
            <SwitchRow key={key} testID={`setting-statGroups.${key}`} label={label} hint={loss} first={i === 0}
              value={appSettings.statGroups[key]}
              onChange={(v) => setKey({ statGroups: { [key]: v } })} theme={theme} s={s} />
          ))}
        </Section>

        <Reveal delay={REVEAL_STEP * 3}>
          <Text style={s.sectionLabel}>DISPLAY</Text>
          <View style={s.segmentRow}>
            {[['meters', 'Meters'], ['yards', 'Yards']].map(([value, label]) => (
              <PressableScale key={value}
                style={[s.segment, appSettings.units === value && s.segmentActive]}
                onPress={() => setKey({ units: value })}
                accessibilityRole="button" accessibilityState={{ selected: appSettings.units === value }}>
                <Text style={[s.segmentText, appSettings.units === value && s.segmentTextActive]}>{label}</Text>
              </PressableScale>
            ))}
          </View>
          <Text style={s.unitsHint}>
            {appSettings.units === 'yards' ? 'e.g. 148 yds ≈ 135 m' : 'e.g. 135 m ≈ 148 yds'}
          </Text>
          <View style={s.appearanceRow}>
            {THEME_OPTIONS.map((opt) => {
              const active = themePref === opt.value;
              return (
                <PressableScale
                  key={opt.value}
                  style={[s.appearanceTile, active && s.appearanceTileActive]}
                  onPress={() => { haptic('selection'); setThemeMode(opt.value); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Feather
                    name={opt.icon}
                    size={18}
                    color={active ? theme.accent.primary : theme.text.muted}
                  />
                  <Text style={[s.appearanceLabel, active && s.appearanceLabelActive]}>
                    {opt.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
          <PressableScale
            testID="setting-replayTour"
            style={s.replayRow}
            onPress={async () => { haptic('selection'); await resetTour(); }}
            accessibilityRole="button"
            accessibilityLabel="Replay app tour"
          >
            <Feather name="refresh-ccw" size={16} color={theme.accent.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.replayLabel}>Replay app tour</Text>
              <Text style={s.fieldHint}>The spotlights show again on Home and the scorecard.</Text>
            </View>
          </PressableScale>
        </Reveal>

        <Section title="NOTIFICATIONS" delay={REVEAL_STEP * 4} s={s}>
          {pushBlocked ? (
            <PressableScale
              style={s.prefRow}
              onPress={() => { Linking.openSettings().catch(() => {}); }}
              accessibilityRole="button"
              accessibilityLabel="Notifications are blocked — open system settings"
            >
              <Feather name="alert-triangle" size={16} color={theme.destructive} />
              <View style={{ flex: 1 }}>
                <Text style={[s.prefLabel, { color: theme.destructive }]}>Notifications are blocked</Text>
                <Text style={s.fieldHint}>The system is blocking this app&apos;s notifications, so the toggles below have no effect. Tap to open system settings.</Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.text.muted} />
            </PressableScale>
          ) : null}
          <SwitchRow testID="setting-notifications.scores" label="Score updates" first={!pushBlocked}
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
        </Section>

        <Reveal delay={REVEAL_STEP * 5}>
          <Text style={s.aboutText}>
            Golf Partner v{Constants?.expoConfig?.version ?? '?'}
            {Platform.OS !== 'web' && Constants?.nativeBuildVersion ? ` (${Constants.nativeBuildVersion})` : ''}
          </Text>
        </Reveal>
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
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted, fontSize: 10,
    letterSpacing: 1.4, textTransform: 'uppercase',
    marginTop: 20, marginBottom: 10,
  },
  sectionHint: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 11, marginTop: -4, marginBottom: 10,
  },
  fieldHint: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 11, marginTop: 4,
  },

  groupCard: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    paddingHorizontal: 14,
  },
  prefRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13,
  },
  prefRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.subtle,
  },
  prefLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14,
  },

  segmentRow: {
    flexDirection: 'row', gap: 10, marginBottom: 6,
  },
  unitsHint: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 11, marginBottom: 10, textAlign: 'center',
  },
  aboutText: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted,
    fontSize: 11, textAlign: 'center', marginTop: 28,
  },
  segment: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, borderWidth: 1.5, borderColor: theme.border.default,
    backgroundColor: theme.bg.card,
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
  },
  appearanceTileActive: {
    borderColor: theme.accent.primary,
    backgroundColor: theme.accent.light,
  },
  appearanceLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 14,
  },
  appearanceLabelActive: {
    color: theme.accent.primary,
    fontFamily: 'PlusJakartaSans-Bold',
  },

  replayRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 14, minHeight: 44,
  },
  replayLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.primary,
  },
});
