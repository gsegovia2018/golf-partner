import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

const SECTION_TITLES = {
  Front: 'Front nine',
  Back: 'Back nine',
};

const TOTAL_LABELS = {
  Front: 'Out',
  Back: 'In',
};

function displayScore(value) {
  return value == null ? '·' : String(value);
}

function sectionTitle(label) {
  return SECTION_TITLES[label] ?? `${label || 'Scorecard'} nine`;
}

function totalLabel(label) {
  return TOTAL_LABELS[label] ?? 'Tot';
}

export default function RoundScorecardTables({ sections }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const visibleSections = Array.isArray(sections) ? sections.filter(Boolean) : [];

  if (visibleSections.length === 0) {
    return (
      <View style={s.emptyBox}>
        <Text style={s.emptyText}>No scorecard data for this round</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      {visibleSections.map((section) => {
        const holes = Array.isArray(section.holes) ? section.holes : [];
        const playerRows = Array.isArray(section.playerRows) ? section.playerRows : [];

        return (
          <View key={section.label || holes.map((hole) => hole?.number).join('-')} style={s.section}>
            <Text style={s.sectionTitle}>{sectionTitle(section.label)}</Text>
            <View style={s.table}>
              <View style={s.nameColumn}>
                <View style={[s.cell, s.headerCell, s.nameCell]}>
                  <Text style={s.headerText}>Hole</Text>
                </View>
                <View style={[s.cell, s.nameCell]}>
                  <Text style={s.labelText}>Par</Text>
                </View>
                {playerRows.map((row) => (
                  <View key={row.playerId || row.name} style={[s.cell, s.nameCell]}>
                    <Text style={s.playerName} numberOfLines={1}>{row.name}</Text>
                  </View>
                ))}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  <View style={s.row}>
                    {holes.map((hole, index) => (
                      <View key={hole?.number ?? index} style={[s.cell, s.headerCell, s.scoreCell]}>
                        <Text style={s.headerText}>{hole?.number}</Text>
                      </View>
                    ))}
                    <View style={[s.cell, s.headerCell, s.totalCell]}>
                      <Text style={s.headerText}>{totalLabel(section.label)}</Text>
                    </View>
                  </View>
                  <View style={s.row}>
                    {holes.map((hole, index) => (
                      <View key={hole?.number ?? index} style={[s.cell, s.scoreCell]}>
                        <Text style={s.parText}>{hole?.par ?? '·'}</Text>
                      </View>
                    ))}
                    <View style={[s.cell, s.totalCell]}>
                      <Text style={s.totalText}>{section.parTotal ?? '·'}</Text>
                    </View>
                  </View>
                  {playerRows.map((row) => (
                    <View key={row.playerId || row.name} style={s.row}>
                      {holes.map((hole, index) => (
                        <View key={hole?.number ?? index} style={[s.cell, s.scoreCell]}>
                          <Text style={s.scoreText}>{displayScore(row.scores?.[index])}</Text>
                        </View>
                      ))}
                      <View style={[s.cell, s.totalCell]}>
                        <Text style={s.totalText}>{row.total ?? '·'}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: {
      gap: 16,
    },
    section: {
      gap: 8,
    },
    sectionTitle: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 15,
    },
    table: {
      borderWidth: 1,
      borderColor: theme.border.default,
      borderRadius: 8,
      flexDirection: 'row',
      overflow: 'hidden',
      backgroundColor: theme.bg.card,
    },
    nameColumn: {
      borderRightWidth: 1,
      borderRightColor: theme.border.default,
    },
    row: {
      flexDirection: 'row',
    },
    cell: {
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: theme.border.default,
      height: 38,
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    headerCell: {
      backgroundColor: theme.bg.secondary,
    },
    nameCell: {
      alignItems: 'flex-start',
      width: 104,
    },
    scoreCell: {
      width: 42,
    },
    totalCell: {
      backgroundColor: theme.bg.secondary,
      width: 48,
    },
    headerText: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 12,
    },
    labelText: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 12,
    },
    parText: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 13,
    },
    playerName: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 13,
      maxWidth: 92,
    },
    scoreText: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 14,
    },
    totalText: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 14,
    },
    emptyBox: {
      borderWidth: 1,
      borderColor: theme.border.default,
      borderRadius: 8,
      padding: 16,
      backgroundColor: theme.bg.card,
    },
    emptyText: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 13,
      textAlign: 'center',
    },
  });
}
