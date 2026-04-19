import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

const CIRCLE = 56;
const CELL = 66;

export default function MemoriesRoundRow({ entries, onOpenRound }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.row}
    >
      {entries.map((entry) => {
        const empty = !entry || entry.items.length === 0;
        return (
          <TouchableOpacity
            key={entry.roundId}
            style={[s.cell, empty && s.cellDim]}
            activeOpacity={empty ? 1 : 0.7}
            onPress={() => { if (!empty) onOpenRound(entry); }}
            disabled={empty}
            accessibilityLabel={`Ronda ${entry.roundIndex + 1}${empty ? ', sin recuerdos' : ''}`}
          >
            <View style={s.avatar}>
              {!empty && entry.cover?.thumbUrl ? (
                <>
                  <Image source={{ uri: entry.cover.thumbUrl }} style={StyleSheet.absoluteFillObject} />
                  <View style={[StyleSheet.absoluteFillObject, s.scrim]} pointerEvents="none" />
                </>
              ) : null}
              <Text style={[s.label, empty && s.labelEmpty]}>R{entry.roundIndex + 1}</Text>
            </View>
            <Text style={[s.course, empty && s.courseEmpty]} numberOfLines={1}>
              {entry.courseName || (empty ? 'Sin fotos' : '')}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  row: { paddingHorizontal: 12, paddingVertical: 4, alignItems: 'center' },
  cell: { alignItems: 'center', width: CELL, marginRight: 10 },
  cellDim: { opacity: 0.55 },
  avatar: {
    width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2,
    overflow: 'hidden', backgroundColor: theme.bg.secondary,
    alignItems: 'center', justifyContent: 'center',
  },
  scrim: { backgroundColor: 'rgba(0,0,0,0.22)' },
  label: {
    fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 },
  },
  labelEmpty: { color: theme.text.muted, textShadowRadius: 0 },
  course: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 10,
    color: theme.text.primary, marginTop: 4, textAlign: 'center',
    maxWidth: CELL,
  },
  courseEmpty: { color: theme.text.muted },
});
