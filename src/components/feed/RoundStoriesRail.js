import React from 'react';
import {
  Image, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

function coverForStory(story) {
  return story?.mediaList?.find((m) => m.thumbUrl || m.url) ?? null;
}

function coverResizeMode(media) {
  return media?.kind === 'video' ? 'contain' : 'cover';
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
      style={s.scroller}
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
            <View
              testID={`round-story-ring-${story.key}`}
              style={[s.ring, story.viewed && s.ringViewed]}
            >
              <View style={s.thumbWrap}>
                {cover ? (
                  <Image
                    testID={`round-story-cover-${story.key}`}
                    source={{ uri: cover.thumbUrl || cover.url }}
                    style={s.thumb}
                    resizeMode={coverResizeMode(cover)}
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
    scroller: {
      minHeight: 118,
      maxHeight: 118,
    },
    rail: {
      minHeight: 118,
      paddingHorizontal: 16,
      paddingTop: 4,
      paddingBottom: 14,
      gap: 12,
      alignItems: 'flex-start',
    },
    item: {
      width: 82,
      minHeight: 100,
      alignItems: 'center',
    },
    ring: {
      width: 68,
      height: 68,
      borderRadius: 34,
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
      borderRadius: 30,
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
      fontSize: 13,
    },
    label: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.primary,
      fontSize: 11,
      maxWidth: 78,
    },
    count: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
      fontSize: 9,
      marginTop: 1,
      maxWidth: 78,
    },
  });
}
