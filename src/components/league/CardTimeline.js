// The card's timeline: a stepper of its last three events, with "Show all N
// events" for the rest. Each row is icon + tone + words (never colour alone), a
// who-and-how chip (QR / PARTNER / PHOTO / OFFICIAL), the time and the detail.
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import { useT, tr } from '../../i18n';
import { describeCardEvent, visibleEvents } from '../../store/leagueTimeline';
import { stamp } from './stamp';

export default function CardTimeline({ events, loading, error, onRetry, meId, monthKey, members }) {
  const { theme } = useTheme();
  const t = useT();
  const l = useMemo(() => makeStyles(theme), [theme]);
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(
    () => (events ?? []).map((ev) => describeCardEvent(ev, { meId, fmt: stamp, someone: t('league.timeline.someone'), monthKey, members })),
    [events, meId, monthKey, members, t],
  );
  const { shown, hidden } = visibleEvents(rows, expanded);
  const tone = (name) => {
    if (name === 'good') return theme.accent.primary;
    if (name === 'warn') return theme.isDark ? semantic.warning.dark : semantic.warning.light;
    if (name === 'bad') return theme.destructive;
    return theme.text.secondary;
  };

  return (
    <View style={l.wrap}>
      <Text style={l.label} accessibilityRole="header">{t('league.timeline.title')}</Text>
      {error && !rows.length ? (
        <View style={l.box}>
          <Text style={l.failText} accessibilityRole="alert">{t('league.timeline.loadError')}</Text>
          <TouchableOpacity onPress={onRetry} accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={l.retry}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : loading && !rows.length ? (
        <View style={l.box} testID="timeline-skeleton" accessibilityLabel={t('league.timeline.title')}>
          <View style={[l.sk, { width: '80%' }]} />
          <View style={[l.sk, { width: '60%' }]} />
          <View style={[l.sk, { width: '70%' }]} />
        </View>
      ) : (
        <View style={l.box}>
          {shown.map((r, i) => {
            const color = tone(r.tone);
            const title = tr(r.title);
            const meta = [stamp(r.at), r.detail ? tr(r.detail) : null].filter(Boolean).join(' · ');
            return (
              <View
                key={r.id ?? i}
                style={l.item}
                accessible
                accessibilityLabel={[title, r.how ? tr(r.how) : null, meta, r.note].filter(Boolean).join(', ')}
              >
                <View style={l.rail}>
                  <View style={[l.dot, { borderColor: color }]}>
                    <Feather name={r.icon} size={13} color={color} />
                  </View>
                  {i < shown.length - 1 && <View style={l.line} />}
                </View>
                <View style={l.body}>
                  <View style={l.titleRow}>
                    <Text style={l.title}>{title}</Text>
                    {!!r.how && <View style={l.chip}><Text style={l.chipText}>{tr(r.how)}</Text></View>}
                  </View>
                  {!!meta && <Text style={l.meta}>{meta}</Text>}
                  {!!r.note && <Text style={l.quote}>{`“${r.note}”`}</Text>}
                </View>
              </View>
            );
          })}
          {(hidden > 0 || expanded) && (events ?? []).length > 3 && (
            <TouchableOpacity
              onPress={() => setExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              style={l.more}
            >
              <Text style={l.moreText}>
                {expanded ? t('league.timeline.showLess') : t('league.timeline.showAll', { count: (events ?? []).length })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function makeStyles(theme) {
  const border = theme.isDark ? theme.glass?.border : theme.border.default;
  return StyleSheet.create({
    wrap: { marginTop: 14 },
    label: {
      fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 12, letterSpacing: 0.4,
      textTransform: 'uppercase', marginBottom: 8,
    },
    box: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: border, padding: 14,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    item: { flexDirection: 'row', gap: 12 },
    rail: { alignItems: 'center', width: 26 },
    dot: {
      width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.bg.card,
    },
    line: { width: 2, flex: 1, minHeight: 10, backgroundColor: theme.bg.secondary, marginVertical: 2 },
    body: { flex: 1, minWidth: 0, paddingBottom: 14 },
    titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8 },
    title: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14, lineHeight: 19, flexShrink: 1 },
    chip: { backgroundColor: theme.bg.secondary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    chipText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.secondary, fontSize: 10, letterSpacing: 0.6 },
    meta: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 1 },
    quote: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.primary, fontSize: 13, lineHeight: 18, marginTop: 6,
      fontStyle: 'italic',
    },
    more: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
    moreText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
    sk: { height: 14, borderRadius: 7, backgroundColor: theme.bg.secondary, marginVertical: 8 },
    failText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 13 },
    retry: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14, paddingVertical: 8 },
  });
}
