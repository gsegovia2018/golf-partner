import React, { useMemo } from 'react';
import {
  ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
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

function scorecardKey(row) {
  return row.playerId || row.name;
}

function buildOverview(sections) {
  const labels = sections.map((section) => ({
    key: section.label || 'Section',
    label: totalLabel(section.label),
  }));
  const byPlayer = new Map();

  sections.forEach((section) => {
    const sectionKey = section.label || 'Section';
    const playerRows = Array.isArray(section.playerRows) ? section.playerRows : [];
    playerRows.forEach((row) => {
      const key = scorecardKey(row);
      if (!key) return;
      const existing = byPlayer.get(key) ?? {
        key,
        name: row.name || 'Player',
        sections: {},
        total: 0,
      };
      const total = Number(row.total) || 0;
      existing.sections[sectionKey] = total;
      existing.total += total;
      byPlayer.set(key, existing);
    });
  });

  return {
    labels,
    rows: [...byPlayer.values()],
  };
}

export default function RoundScorecardTables({ sections }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const visibleSections = useMemo(
    () => (Array.isArray(sections) ? sections.filter(Boolean) : []),
    [sections],
  );
  const { width } = useWindowDimensions();
  const maxHoleCount = useMemo(() => visibleSections.reduce((max, section) => (
    Math.max(max, Array.isArray(section?.holes) ? section.holes.length : 0)
  ), 9), [visibleSections]);
  const layout = useMemo(() => {
    const viewportWidth = Number(width) || 390;
    const compact = viewportWidth < 430;
    const available = Math.max(286, viewportWidth - (compact ? 30 : 40));
    const nameWidth = compact ? 68 : 88;
    const totalWidth = compact ? 36 : 42;
    const rawScoreWidth = Math.floor(
      (available - nameWidth - totalWidth - 2) / Math.max(1, maxHoleCount),
    );
    return {
      compact,
      nameWidth,
      totalWidth,
      scoreWidth: compact
        ? Math.max(22, Math.min(36, rawScoreWidth))
        : 36,
    };
  }, [maxHoleCount, width]);
  const overview = useMemo(() => buildOverview(visibleSections), [visibleSections]);

  if (visibleSections.length === 0) {
    return (
      <View style={s.emptyBox}>
        <Text style={s.emptyText}>No scorecard data for this round</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      {overview.rows.length > 0 ? (
        <View style={s.overviewCard}>
          <View style={s.overviewHeader}>
            <Text style={s.overviewTitle}>Round total</Text>
            <Text style={s.overviewMeta}>Strokes</Text>
          </View>
          <View style={s.overviewTable}>
            <View style={s.overviewRow}>
              <Text style={[s.overviewName, s.overviewHeadText]}>Player</Text>
              {overview.labels.map((label) => (
                <Text key={label.key} style={[s.overviewCell, s.overviewHeadText]}>
                  {label.label}
                </Text>
              ))}
              <Text style={[s.overviewCell, s.overviewTotal, s.overviewHeadText]}>Total</Text>
            </View>
            {overview.rows.map((row) => (
              <View key={row.key} style={s.overviewRow}>
                <Text style={s.overviewName} numberOfLines={1}>{row.name}</Text>
                {overview.labels.map((label) => (
                  <Text key={label.key} style={s.overviewCell}>
                    {row.sections[label.key] ?? '·'}
                  </Text>
                ))}
                <Text style={[s.overviewCell, s.overviewTotal]}>{row.total}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {visibleSections.map((section) => {
        const holes = Array.isArray(section.holes) ? section.holes : [];
        const playerRows = Array.isArray(section.playerRows) ? section.playerRows : [];

        return (
          <View key={section.label || holes.map((hole) => hole?.number).join('-')} style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>{sectionTitle(section.label)}</Text>
              <Text style={s.sectionMeta}>Par {section.parTotal ?? '·'}</Text>
            </View>
            <View style={s.table}>
              <View style={s.nameColumn}>
                <View style={[s.cell, s.headerCell, s.nameCell, { width: layout.nameWidth }]}>
                  <Text style={s.headerText}>Hole</Text>
                </View>
                <View style={[s.cell, s.nameCell, { width: layout.nameWidth }]}>
                  <Text style={s.labelText}>Par</Text>
                </View>
                {playerRows.map((row) => (
                  <View key={row.playerId || row.name} style={[s.cell, s.nameCell, { width: layout.nameWidth }]}>
                    <Text
                      style={[s.playerName, { maxWidth: layout.nameWidth - 10 }]}
                      numberOfLines={1}
                    >
                      {row.name}
                    </Text>
                  </View>
                ))}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={s.scoreScroller}
              >
                <View>
                  <View style={s.row}>
                    {holes.map((hole, index) => (
                      <View
                        key={hole?.number ?? index}
                        style={[
                          s.cell,
                          s.headerCell,
                          s.scoreCell,
                          { width: layout.scoreWidth },
                        ]}
                      >
                        <Text style={s.headerText}>{hole?.number}</Text>
                      </View>
                    ))}
                    <View
                      style={[
                        s.cell,
                        s.headerCell,
                        s.totalCell,
                        { width: layout.totalWidth },
                      ]}
                    >
                      <Text style={s.headerText}>{totalLabel(section.label)}</Text>
                    </View>
                  </View>
                  <View style={s.row}>
                    {holes.map((hole, index) => (
                      <View
                        key={hole?.number ?? index}
                        style={[s.cell, s.scoreCell, { width: layout.scoreWidth }]}
                      >
                        <Text style={s.parText}>{hole?.par ?? '·'}</Text>
                      </View>
                    ))}
                    <View style={[s.cell, s.totalCell, { width: layout.totalWidth }]}>
                      <Text style={s.totalText}>{section.parTotal ?? '·'}</Text>
                    </View>
                  </View>
                  {playerRows.map((row) => (
                    <View key={row.playerId || row.name} style={s.row}>
                      {holes.map((hole, index) => (
                        <View
                          key={hole?.number ?? index}
                          style={[s.cell, s.scoreCell, { width: layout.scoreWidth }]}
                        >
                          <Text style={[s.scoreText, layout.compact && s.scoreTextCompact]}>
                            {displayScore(row.scores?.[index])}
                          </Text>
                        </View>
                      ))}
                      <View style={[s.cell, s.totalCell, { width: layout.totalWidth }]}>
                        <Text style={[s.totalText, layout.compact && s.totalTextCompact]}>
                          {row.total ?? '·'}
                        </Text>
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
      gap: 14,
    },
    overviewCard: {
      backgroundColor: theme.bg.card,
      borderColor: theme.border.default,
      borderRadius: 8,
      borderWidth: 1,
      overflow: 'hidden',
    },
    overviewHeader: {
      alignItems: 'center',
      backgroundColor: theme.bg.secondary,
      borderBottomColor: theme.border.default,
      borderBottomWidth: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    overviewTitle: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 13,
    },
    overviewMeta: {
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 11,
    },
    overviewTable: {
      paddingVertical: 2,
    },
    overviewRow: {
      alignItems: 'center',
      flexDirection: 'row',
      minHeight: 32,
      paddingHorizontal: 10,
    },
    overviewName: {
      color: theme.text.primary,
      flex: 1,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 12,
      minWidth: 0,
    },
    overviewCell: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 12,
      textAlign: 'right',
      width: 42,
    },
    overviewTotal: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },
    overviewHeadText: {
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 10,
      textTransform: 'uppercase',
    },
    section: {
      gap: 7,
    },
    sectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    sectionTitle: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 14,
    },
    sectionMeta: {
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 11,
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
    scoreScroller: {
      flex: 1,
    },
    row: {
      flexDirection: 'row',
    },
    cell: {
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: theme.border.default,
      height: 34,
      justifyContent: 'center',
      paddingHorizontal: 5,
    },
    headerCell: {
      backgroundColor: theme.bg.secondary,
    },
    nameCell: {
      alignItems: 'flex-start',
    },
    scoreCell: {},
    totalCell: {
      backgroundColor: theme.bg.secondary,
    },
    headerText: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 11,
    },
    labelText: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 11,
    },
    parText: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 12,
    },
    playerName: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 12,
    },
    scoreText: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 13,
    },
    scoreTextCompact: {
      fontSize: 12,
    },
    totalText: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 13,
    },
    totalTextCompact: {
      fontSize: 12,
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
