import React from 'react';
import {
  Image, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

function coverForStory(story) {
  return story?.mediaList?.find((m) => m.thumbUrl || m.url) ?? null;
}

function initialsForLabel(label) {
  const words = String(label || '').trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((word) => word[0]).join('');
  return initials.toUpperCase() || '?';
}

export default function RoundStoriesRail({ stories = [], onPressStory }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  if (!stories.length) return null;

  return (
    <ScrollView
      testID="round-stories-rail"
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.rail}
    >
      {stories.map((story) => {
        const cover = coverForStory(story);
        const countLabel = story.viewed ? 'seen' : story.countLabel;
        return (
          <TouchableOpacity
            key={story.key}
            style={s.item}
            onPress={() => onPressStory?.(story)}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel={`Open ${story.roundLabel} story, ${countLabel}`}
          >
            <View style={[s.ring, story.viewed && s.ringViewed]}>
              <View style={s.thumbWrap}>
                {cover ? (
                  <Image
                    source={{ uri: cover.thumbUrl || cover.url }}
                    style={s.thumb}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={s.fallbackText}>{initialsForLabel(story.roundLabel)}</Text>
                )}
              </View>
            </View>
            <Text style={s.label} numberOfLines={1}>{story.roundLabel}</Text>
            <Text style={s.count} numberOfLines={1}>{countLabel}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    rail: {
      paddingHorizontal: 16,
      paddingBottom: 12,
      gap: 10,
    },
    item: {
      width: 76,
      alignItems: 'center',
    },
    ring: {
      width: 62,
      height: 62,
      borderRadius: 31,
      borderWidth: 2,
      borderColor: theme.accent.primary,
      padding: 3,
      backgroundColor: theme.bg.primary,
      marginBottom: 6,
    },
    ringViewed: {
      borderColor: theme.border.default,
    },
    thumbWrap: {
      flex: 1,
      borderRadius: 27,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.bg.secondary,
      borderWidth: 2,
      borderColor: theme.bg.card,
    },
    thumb: {
      width: '100%',
      height: '100%',
    },
    fallbackText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.accent.primary,
      fontSize: 12,
    },
    label: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.primary,
      fontSize: 10,
      maxWidth: 72,
    },
    count: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
      fontSize: 9,
      marginTop: 1,
      maxWidth: 72,
    },
  });
}
