// A shared swing (/s/<token>; plan docs/superpowers/plans/2026-10-31-swing-share.md, design A):
// the owner's Results screen, read-only, fed from the link's files, with who shared it on top
// and "Create account" under it. Anyone with the link, signed out included.
//
// Rendered like LeagueBoardPublicScreen: bare and pre-session from App.js's `!session` branch
// with `token` and `onAuth(mode)` props, or as the routed `SwingShared` screen
// (route.params.token) for a signed-in visitor, who gets a back button and no sign-up card.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Linking,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import PressableScale from '../components/ui/PressableScale';
import { PrimaryButton, SecondaryButton } from '../components/ui/Buttons';
import { swingType, Overline } from '../components/swing/swingStyles';
import { SwingResultsView, PlayerHost } from './SwingResultsScreen';
import { useTheme } from '../theme/ThemeContext';
import { useT, formatDate } from '../i18n';
import { SWING_STRINGS } from '../swing/strings';
import { normClub } from '../swing/checks';
import { getPublicSwing } from '../store/swingShareStore';
import { shareOrigin } from '../lib/shareOrigin';

const P = () => SWING_STRINGS.share.public;

/** "Íñigo's driver · 29 oct": the owner's own name for the swing, else club · date. */
export function sharedSwingTitle(meta) {
  if (meta?.title) return meta.title;
  const club = SWING_STRINGS.club[normClub(meta?.club)];
  const at = meta?.recorded_at ?? meta?.shared_at;
  return at ? `${club} · ${formatDate(new Date(at), 'day')}` : club;
}

export default function SwingSharedScreen(props) {
  useT();
  const token = props.token ?? props.route?.params?.token;
  const { onAuth, navigation } = props;
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const ty = useMemo(() => swingType(theme), [theme]);
  const [data, setData] = useState(undefined); // undefined = loading, null = link closed
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setError(false);
    setData(undefined);
    try {
      const d = await getPublicSwing(token);
      if (alive.current) setData(d ?? null);
    } catch {
      if (alive.current) setError(true);
    }
  }, [token]);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);

  const onBack = navigation
    ? () => (navigation.canGoBack?.() ? navigation.goBack() : navigation.navigate('Main'))
    : null;

  const cta = onAuth ? (
    <View style={s.card} testID="swing-shared-cta">
      <Overline>{P().ctaOver}</Overline>
      <Text style={[ty.heading, s.ctaTitle]} accessibilityRole="header">{P().ctaTitle}</Text>
      <Text style={ty.body}>{P().ctaBody}</Text>
      <PrimaryButton style={s.ctaBtn} label={P().createAccount} onPress={() => onAuth('signup')} accessibilityLabel={P().createAccount} testID="swing-shared-signup" />
      <View style={s.signInRow}>
        <Text style={ty.body}>{P().haveAccount}</Text>
        <PressableScale onPress={() => onAuth('signin')} accessibilityRole="button" accessibilityLabel={P().signIn} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} testID="swing-shared-signin">
          <Text style={s.link}>{P().signIn}</Text>
        </PressableScale>
      </View>
    </View>
  ) : null;
  const footer = (
    <PressableScale onPress={() => Linking.openURL(shareOrigin()).catch(() => {})} accessibilityRole="link" style={s.footer}>
      <Text style={[ty.body, s.footerText]}>{`${P().footer} · `}<Text style={s.link}>{shareOrigin().replace(/^https?:\/\//, '')}</Text></Text>
    </PressableScale>
  );

  if (error || data === null) {
    const off = !error;
    return (
      <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={s.stateWrap}>
          <View style={s.stateIcon}><Feather name={off ? 'link' : 'wifi-off'} size={26} color={theme.text.muted} /></View>
          <Text style={[ty.title, s.center]} accessibilityRole="header">{off ? P().offTitle : P().errorTitle}</Text>
          <Text style={[ty.body, s.center]}>{off ? P().offText : P().errorText}</Text>
          {off ? null : <SecondaryButton style={s.retry} label={P().retry} onPress={load} accessibilityLabel={P().retry} testID="swing-shared-retry" />}
          {cta}
          {onBack ? <SecondaryButton style={s.retry} label={SWING_STRINGS.results.back} onPress={onBack} /> : null}
          {footer}
        </ScrollView>
      </ScreenContainer>
    );
  }

  const meta = data?.meta;
  const top = meta ? (
    <View style={s.who} testID="swing-shared-who">
      <View style={s.avatar}><Text style={s.avatarText}>{(meta.sharer ?? '·').charAt(0).toUpperCase()}</Text></View>
      <Text style={[ty.label, s.flex]} numberOfLines={2}>{P().sharedBy(meta.sharer)}</Text>
    </View>
  ) : null;

  return (
    <>
      <SwingResultsView
        readOnly
        phase={data ? 'ready' : 'loading'}
        title={data ? sharedSwingTitle(meta) : ''}
        analysis={data?.analysis ?? null}
        pose={data?.pose ?? null}
        stillFor={(f) => data?.stillUrl(f) ?? null}
        onBack={onBack}
        onPlay={() => setPlaying(true)}
        topSlot={top}
        bottomSlot={data ? <View style={s.bottom}>{cta}{footer}</View> : null}
      />
      {data ? <PlayerHost visible={playing} uri={data.videoUrl} onClose={() => setPlaying(false)} /> : null}
    </>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  flex: { flex: 1 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 2 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.accent.light, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 13, color: theme.accent.primary },
  bottom: { gap: 4, marginTop: 8 },
  card: {
    backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border.default, padding: 16, gap: 6, marginTop: 8,
  },
  ctaTitle: { marginTop: 2 },
  ctaBtn: { marginTop: 10 },
  signInRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 8, minHeight: 44 },
  link: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary },
  footer: { alignItems: 'center', paddingVertical: 14, minHeight: 44 },
  footerText: { textAlign: 'center', fontSize: 11, lineHeight: 15 },
  stateWrap: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 56, paddingBottom: 28, gap: 8, maxWidth: 480, width: '100%', alignSelf: 'center' },
  stateIcon: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: theme.bg.secondary, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 8,
  },
  center: { textAlign: 'center' },
  retry: { marginTop: 10 },
});
