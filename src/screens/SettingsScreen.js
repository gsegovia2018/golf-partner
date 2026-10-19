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
import { updateAppSettings, MISS_REASONS_MODES } from '../store/settingsStore';
import { resetTour } from '../store/tourStore';
import { haptic } from '../lib/haptics';
import { useT, useLanguagePref, setLanguagePref, formatNumber } from '../i18n';

// label and loss are catalogue keys, resolved at render (see docs/i18n.md).
const STAT_GROUP_ROWS = [
  { key: 'putting', label: 'settings.statGroups.putting.label', loss: 'settings.statGroups.putting.loss' },
  { key: 'teeShot', label: 'settings.statGroups.teeShot.label', loss: 'settings.statGroups.teeShot.loss' },
  { key: 'approach', label: 'settings.statGroups.approach.label', loss: 'settings.statGroups.approach.loss' },
  { key: 'shortGame', label: 'settings.statGroups.shortGame.label', loss: 'settings.statGroups.shortGame.loss' },
  { key: 'penalties', label: 'settings.statGroups.penalties.label', loss: 'settings.statGroups.penalties.loss' },
];

const THEME_OPTIONS = [
  { value: 'light', label: 'settings.theme.light', icon: 'sun' },
  { value: 'dark', label: 'settings.theme.dark', icon: 'moon' },
  { value: 'system', label: 'settings.theme.system', icon: 'smartphone' },
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
  const t = useT();
  const languagePref = useLanguagePref();
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
          accessibilityLabel={t('common.back')}
          onPress={handleBack}
        />
        <Text style={s.headerTitle}>{t('settings.title')}</Text>
        <View style={s.backBtn} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        <Section title={t('settings.section.course')} delay={0} s={s}>
          <SwitchRow testID="setting-gpsEnabled" label={t('settings.gps.label')} first
            hint={t('settings.gps.hint')}
            value={appSettings.gpsEnabled} onChange={(v) => setKey({ gpsEnabled: v })} theme={theme} s={s} />
          {/* GPS trail experiment: only the Android round tracker records it. */}
          {Platform.OS === 'android' ? (
            <SwitchRow testID="setting-recordGpsTrail" label={t('settings.recordGpsTrail.label')}
              hint={t('settings.recordGpsTrail.hint')}
              value={appSettings.recordGpsTrail} onChange={(v) => setKey({ recordGpsTrail: v })} theme={theme} s={s} />
          ) : null}
          <SwitchRow testID="setting-shotMeasuring" label={t('settings.shotMeasuring.label')}
            hint={t('settings.shotMeasuring.hint')}
            value={appSettings.shotMeasuring !== 'off'}
            onChange={(v) => setKey({ shotMeasuring: v ? 'on' : 'off' })} theme={theme} s={s} />
          <SwitchRow testID="setting-showLastShot" label={t('settings.showLastShot.label')}
            hint={t('settings.showLastShot.hint')}
            value={appSettings.showLastShot} onChange={(v) => setKey({ showLastShot: v })} theme={theme} s={s} />
          <SwitchRow testID="setting-keepAwake" label={t('settings.keepAwake.label')}
            hint={t('settings.keepAwake.hint')}
            value={appSettings.keepAwake} onChange={(v) => setKey({ keepAwake: v })} theme={theme} s={s} />
          <SwitchRow testID="setting-autoAdvanceHole" label={t('settings.autoAdvance.label')}
            hint={t('settings.autoAdvance.hint')}
            value={appSettings.autoAdvanceHole} onChange={(v) => setKey({ autoAdvanceHole: v })} theme={theme} s={s} />
          <SwitchRow testID="setting-haptics" label={t('settings.haptics.label')}
            hint={t('settings.haptics.hint')}
            value={appSettings.haptics} onChange={(v) => setKey({ haptics: v })} theme={theme} s={s} />
        </Section>

        <Section title={t('settings.section.scores')} delay={REVEAL_STEP} s={s}>
          <SwitchRow testID="setting-noSpoilers" label={t('settings.noSpoilers.label')} first
            hint={t('settings.noSpoilers.hint')}
            value={appSettings.noSpoilers} onChange={(v) => setKey({ noSpoilers: v })} theme={theme} s={s} />
          <SwitchRow testID="setting-showRunningScore" label={t('settings.showRunningScore.label')}
            hint={appSettings.noSpoilers ? t('settings.showRunningScore.off') : t('settings.showRunningScore.hint')}
            value={appSettings.showRunningScore && !appSettings.noSpoilers}
            disabled={appSettings.noSpoilers}
            onChange={(v) => setKey({ showRunningScore: v })} theme={theme} s={s} />
        </Section>

        <Section title={t('settings.section.stats')} delay={REVEAL_STEP * 2}
          hint={t('settings.section.statsHint')} s={s}>
          {STAT_GROUP_ROWS.map(({ key, label, loss }, i) => (
            <SwitchRow key={key} testID={`setting-statGroups.${key}`} label={t(label)} hint={t(loss)} first={i === 0}
              value={appSettings.statGroups[key]}
              onChange={(v) => setKey({ statGroups: { [key]: v } })} theme={theme} s={s} />
          ))}
          <View testID="setting-missReasons">
            <Text style={s.sectionLabel}>{t('settings.missReasons.label')}</Text>
            <View style={s.segmentRow}>
              {MISS_REASONS_MODES.map((value) => (
                <PressableScale key={value} testID={`setting-missReasons-${value}`}
                  style={[s.segment, appSettings.missReasons === value && s.segmentActive]}
                  onPress={() => setKey({ missReasons: value })}
                  accessibilityRole="button" accessibilityState={{ selected: appSettings.missReasons === value }}>
                  <Text style={[s.segmentText, appSettings.missReasons === value && s.segmentTextActive]}>
                    {t(`settings.missReasons.${value}`)}
                  </Text>
                </PressableScale>
              ))}
            </View>
            <Text style={s.unitsHint}>{t(`settings.missReasons.hint.${appSettings.missReasons}`)}</Text>
          </View>
          <SwitchRow testID="setting-aimTips" label={t('settings.aimTips.label')}
            hint={t('settings.aimTips.hint')}
            value={appSettings.aimTips} onChange={(v) => setKey({ aimTips: v })} theme={theme} s={s} />
        </Section>

        <Reveal delay={REVEAL_STEP * 3}>
          <Text style={s.sectionLabel}>{t('settings.section.display')}</Text>
          <View style={s.segmentRow}>
            {[['meters', 'settings.units.meters'], ['yards', 'settings.units.yards']].map(([value, label]) => (
              <PressableScale key={value}
                style={[s.segment, appSettings.units === value && s.segmentActive]}
                onPress={() => setKey({ units: value })}
                accessibilityRole="button" accessibilityState={{ selected: appSettings.units === value }}>
                <Text style={[s.segmentText, appSettings.units === value && s.segmentTextActive]}>{t(label)}</Text>
              </PressableScale>
            ))}
          </View>
          <Text style={s.unitsHint}>
            {appSettings.units === 'yards'
              ? t('settings.units.exampleYards', { yards: formatNumber(148), meters: formatNumber(135) })
              : t('settings.units.exampleMeters', { meters: formatNumber(135), yards: formatNumber(148) })}
          </Text>
          <Text style={s.sectionLabel}>{t('settings.language.title')}</Text>
          <View style={s.segmentRow}>
            {['system', 'es', 'en'].map((value) => (
              <PressableScale key={value} testID={`setting-language-${value}`}
                style={[s.segment, languagePref === value && s.segmentActive]}
                onPress={() => setLanguagePref(value)}
                accessibilityRole="button" accessibilityState={{ selected: languagePref === value }}>
                <Text style={[s.segmentText, languagePref === value && s.segmentTextActive]}>
                  {t(`settings.language.${value}`)}
                </Text>
              </PressableScale>
            ))}
          </View>
          <Text style={s.sectionLabel}>{t('settings.theme.title')}</Text>
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
                    {t(opt.label)}
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
            accessibilityLabel={t('settings.replayTour.label')}
          >
            <Feather name="refresh-ccw" size={16} color={theme.accent.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.replayLabel}>{t('settings.replayTour.label')}</Text>
              <Text style={s.fieldHint}>{t('settings.replayTour.hint')}</Text>
            </View>
          </PressableScale>
        </Reveal>

        <Section title={t('settings.section.notifications')} delay={REVEAL_STEP * 4} s={s}>
          {pushBlocked ? (
            <PressableScale
              style={s.prefRow}
              onPress={() => { Linking.openSettings().catch(() => {}); }}
              accessibilityRole="button"
              accessibilityLabel={t('settings.pushBlocked.a11y')}
            >
              <Feather name="alert-triangle" size={16} color={theme.destructive} />
              <View style={{ flex: 1 }}>
                <Text style={[s.prefLabel, { color: theme.destructive }]}>{t('settings.pushBlocked.title')}</Text>
                <Text style={s.fieldHint}>{t('settings.pushBlocked.hint')}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.text.muted} />
            </PressableScale>
          ) : null}
          <SwitchRow testID="setting-notifications.scores" label={t('settings.notify.scores.label')} first={!pushBlocked}
            hint={t('settings.notify.scores.hint')}
            value={appSettings.notifications.scores}
            onChange={(v) => setKey({ notifications: { scores: v } })} theme={theme} s={s} />
          <SwitchRow testID="setting-notifications.invites" label={t('settings.notify.invites.label')}
            hint={t('settings.notify.invites.hint')}
            value={appSettings.notifications.invites}
            onChange={(v) => setKey({ notifications: { invites: v } })} theme={theme} s={s} />
          <SwitchRow testID="setting-notifications.media" label={t('settings.notify.media.label')}
            hint={t('settings.notify.media.hint')}
            value={appSettings.notifications.media}
            onChange={(v) => setKey({ notifications: { media: v } })} theme={theme} s={s} />
        </Section>

        <Section title={t('settings.section.privacy')} delay={REVEAL_STEP * 5} s={s}>
          <SwitchRow testID="setting-usageStats" label={t('settings.usageStats.label')} first
            hint={t('settings.usageStats.hint')}
            value={appSettings.usageStats} onChange={(v) => setKey({ usageStats: v })} theme={theme} s={s} />
        </Section>

        <Reveal delay={REVEAL_STEP * 6}>
          <Text style={s.aboutText}>
            {t('settings.about.version', { version: Constants?.expoConfig?.version ?? '?' })}
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
