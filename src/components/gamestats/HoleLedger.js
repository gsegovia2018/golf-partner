// One player's round hole by hole (single-round Players tab), split like the
// scorecard: holes 1–9 with an Out total on top, 10–18 with In below (a
// 9-hole round is one block). Rows: hole · par · strokes or points · and,
// when the player logged shots, putts · tee shot · green. Fixed label and
// total columns with nine equal cells, so it fits a 360 dp phone without
// scrolling sideways. No legend: every cell carries an accessibilityLabel.
// Data: roundLedger / ledgerBestRun / cellLevel in store/gameStatsView.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import { cellLevel, ledgerBestRun } from '../../store/gameStatsView';
import { heatColors, signed } from './ui';

const LABEL_W = 42;
const TOTAL_W = 30;
const CELL_H = 22;
const GLYPH = { fairway: '↑', super: '★', left: '←', right: '→', short: '↓' };
const GOOD_DRIVE = new Set(['fairway', 'super']);

function Nine({ nine, mode, showShots, s, theme, t }) {
  const isPoints = mode === 'points';
  const row = (key, label, cells, total, totalStyle) => (
    <View style={s.row} key={key}>
      <Text style={s.label} numberOfLines={1}>{label}</Text>
      {cells}
      <View style={[s.total, totalStyle]}><Text style={s.totalText} numberOfLines={1} adjustsFontSizeToFit>{total ?? '–'}</Text></View>
    </View>
  );
  const cell = (c, child, extra) => (
    <View key={c.number} style={[s.cell, extra?.style]} accessibilityLabel={extra?.a11y} accessible={!!extra?.a11y}>
      {child}
    </View>
  );

  return (
    <View style={s.nine} testID={`ledger-${nine.key}`}>
      {row('h', t('stats.game.ledger.hole'),
        nine.cells.map((c) => cell(c, <Text style={s.dim}>{c.number}</Text>)),
        t(`stats.game.ledger.${nine.key}`), s.totalHead)}
      {row('p', t('stats.game.ledger.par'),
        nine.cells.map((c) => cell(c, <Text style={s.dim}>{c.par}</Text>)),
        nine.par)}
      {row('s', t(isPoints ? 'stats.game.ledger.points' : 'stats.game.ledger.strokes'),
        nine.cells.map((c) => {
          if (c.strokes == null) {
            return cell(c, null, { style: s.empty, a11y: t('stats.game.card.notPlayed') });
          }
          const { bg, fg } = heatColors(theme, cellLevel(mode, c));
          return cell(c, (
            <Text style={[s.value, { color: fg }]} testID={`ledger-cell-${c.number}`}>{isPoints ? c.points : c.strokes}</Text>
          ), {
            style: { backgroundColor: bg },
            a11y: isPoints
              ? t('stats.game.ledger.a11y.points', { hole: c.number, count: c.points })
              : t('stats.game.ledger.a11y.strokes', { hole: c.number, count: c.strokes, result: t(`stats.game.ledger.result.${c.gross}`) }),
          });
        }),
        isPoints ? nine.points : nine.strokes)}
      {showShots && row('pu', t('stats.game.ledger.putts'),
        nine.cells.map((c) => cell(c, c.putts == null ? null : (
          <Text style={[s.plain, {
            color: c.putts >= 3 ? theme.destructive : c.putts === 1 ? theme.scoreColor('excellent') : theme.text.primary,
          }]}
          >{c.putts}</Text>
        ), c.putts == null ? null : { a11y: t('stats.game.ledger.a11y.putts', { hole: c.number, count: c.putts }) })),
        nine.putts)}
      {showShots && row('t', t('stats.game.ledger.tee'),
        nine.cells.map((c) => {
          const pen = c.penalties > 0;
          const a11y = c.drive
            ? t(pen ? 'stats.game.ledger.a11y.teePenalty' : 'stats.game.ledger.a11y.tee', { hole: c.number, drive: t(`stats.game.ledger.drive.${c.drive}`) })
            : pen ? t('stats.game.ledger.a11y.penalty', { hole: c.number }) : null;
          return cell(c, (
            <>
              {c.drive
                ? <Text style={[s.plain, { color: GOOD_DRIVE.has(c.drive) ? theme.scoreColor('excellent') : theme.destructive }]}>{GLYPH[c.drive]}</Text>
                : <Text style={s.dim}>·</Text>}
              {pen && <View style={[s.penalty, { backgroundColor: theme.destructive }]} testID={`ledger-penalty-${c.number}`} />}
            </>
          ), { a11y });
        }),
        nine.fairways.of > 0 ? `${nine.fairways.hit}/${nine.fairways.of}` : null)}
      {showShots && row('g', t('stats.game.ledger.green'),
        nine.cells.map((c) => cell(c, c.gir == null ? null : (
          <View
            testID={`ledger-gir-${c.number}`}
            style={[s.gir, c.gir ? { backgroundColor: theme.accent.primary } : { borderWidth: 1.5, borderColor: theme.text.muted }]}
          />
        ), c.gir == null ? null : { a11y: t(c.gir ? 'stats.game.ledger.a11y.gir' : 'stats.game.ledger.a11y.girMissed', { hole: c.number }) })),
        nine.gir.of > 0 ? nine.gir.hit : null)}
    </View>
  );
}

export default function HoleLedger({ ledger, mode }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const run = useMemo(() => ledgerBestRun(ledger, mode), [ledger, mode]);
  if (!ledger) return null;
  const { total } = ledger;
  const toPar = total.toPar === 0 ? t('stats.game.standings.even') : signed(total.toPar ?? 0);
  const parts = mode === 'points'
    ? [t('stats.game.ledger.pointsN', { count: total.points ?? 0 }), t('stats.game.ledger.strokesN', { count: total.strokes ?? 0 })]
    : [t('stats.game.ledger.strokesN', { count: total.strokes ?? 0 }), toPar];
  if (ledger.hasShots && total.putts != null) parts.push(t('stats.game.ledger.puttsN', { count: total.putts }));

  return (
    <View testID="hole-ledger">
      {ledger.nines.map((nine) => (
        <Nine key={nine.key} nine={nine} mode={mode} showShots={ledger.hasShots} s={s} theme={theme} t={t} />
      ))}
      <View style={s.totalLine}>
        <Text style={s.totalLabel}>{t('stats.game.ledger.total')}</Text>
        <Text style={s.totalValue} testID="ledger-total">{parts.join(' · ')}</Text>
      </View>
      {run && (
        <Text style={s.run} testID="ledger-run">
          <Text style={[s.runLabel, { color: theme.isDark ? theme.semantic.winner.dark : theme.semantic.winner.light }]}>{t('stats.game.ledger.runLabel')}</Text>
          {': '}
          {t(mode === 'points' ? 'stats.game.ledger.runPoints' : 'stats.game.ledger.runStrokes', { count: run.length, from: run.from, to: run.to })}
        </Text>
      )}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    nine: { marginBottom: 10 },
    row: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
    label: { width: LABEL_W, fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, color: theme.text.secondary },
    cell: {
      flex: 1, height: CELL_H, marginHorizontal: 1, borderRadius: 5, alignItems: 'center', justifyContent: 'center',
    },
    empty: { borderWidth: 1, borderStyle: 'dashed', borderColor: theme.border.default },
    dim: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, fontVariant: ['tabular-nums'] },
    value: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, fontVariant: ['tabular-nums'] },
    plain: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, fontVariant: ['tabular-nums'] },
    total: {
      width: TOTAL_W, height: CELL_H, marginLeft: 2, borderRadius: 5, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.bg.secondary,
    },
    totalHead: { backgroundColor: 'transparent' },
    totalText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: theme.text.primary, fontVariant: ['tabular-nums'] },
    // Tee penalty: a solid red dot pinned to the cell's top-right corner.
    penalty: { position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: 3 },
    gir: { width: 10, height: 10, borderRadius: 5 },
    totalLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginTop: 2 },
    totalLabel: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.text.secondary },
    totalValue: {
      flexShrink: 1, textAlign: 'right', fontFamily: 'PlusJakartaSans-Bold', fontSize: 12,
      color: theme.text.primary, fontVariant: ['tabular-nums'],
    },
    run: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, lineHeight: 17, color: theme.text.secondary, marginTop: 8 },
    runLabel: { fontFamily: 'PlusJakartaSans-Bold' },
  });
}
