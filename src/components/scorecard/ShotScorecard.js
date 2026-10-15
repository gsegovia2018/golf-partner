// The read-only scorecard of a played round, with shots. Holes 1–9 with an
// Out total on top, 10–18 with In below (a 9-hole round is one block); Hole
// and Par rows, then a score row per player: gross strokes tinted by the
// result against par, or points (`mode`). Small dots at the foot of a score
// cell are the handicap strokes received there.
//
// Several players: a player who logged shots gets a chevron on their name;
// tapping it opens putts · tee shot · green rows under their score (mine
// starts open). One player (`card.solo`): that player's ledger with the shot
// rows always shown and a totals line under it.
//
// Fixed label and total columns with nine equal cells, so it fits a 360 dp
// phone without scrolling sideways. No legend: every cell has an
// accessibilityLabel. Data: scorecardModel in store/scorecardView.
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatNumber } from '../../i18n';
import { cellLevel, ledgerBestRun } from '../../store/gameStatsView';
import { initialExpanded, toggleExpanded } from '../../store/scorecardView';
import { heatColors, signed } from '../gamestats/ui';

const LABEL_W = 42;
const TOTAL_W = 30;
const CELL_H = 22;
const SCORE_H = 24;
const GLYPH = { fairway: '↑', super: '★', left: '←', right: '→', short: '↓' };
const GOOD_DRIVE = new Set(['fairway', 'super']);

function Row({ s, label, cells, total, totalStyle, style, height = CELL_H, tint, totalTestID }) {
  return (
    <View style={[s.row, style]}>
      {typeof label === 'string' ? <Text style={s.label} numberOfLines={1}>{label}</Text> : label}
      {cells.map((c) => (
        <View
          key={c.key}
          style={[s.cell, { height }, tint && s.tint, c.style]}
          accessible={!!c.a11y}
          accessibilityLabel={c.a11y}
        >
          {c.child}
        </View>
      ))}
      <View style={[s.total, { height }, totalStyle]}>
        <Text style={s.totalText} numberOfLines={1} adjustsFontSizeToFit testID={totalTestID}>{total ?? '–'}</Text>
      </View>
    </View>
  );
}

// putts · tee shot · green for one row over one nine.
function shotRows({ row, nine, s, theme, t, sub, idp }) {
  const label = (key) => {
    const text = t(`stats.game.ledger.${key}`);
    return sub ? <Text style={[s.label, s.subLabel]} numberOfLines={1}>{text.toLocaleLowerCase()}</Text> : text;
  };
  const who = (text) => (sub ? t('stats.game.ledger.a11y.who', { name: row.player.name ?? row.label, text }) : text);
  return [
    <Row
      key="pu"
      s={s}
      tint={sub}
      label={label('putts')}
      cells={nine.cells.map((c) => ({
        key: c.number,
        a11y: c.putts == null ? undefined : who(t('stats.game.ledger.a11y.putts', { hole: c.number, count: c.putts })),
        child: c.putts == null ? null : (
          <Text style={[s.plain, {
            color: c.putts >= 3 ? theme.destructive : c.putts === 1 ? theme.scoreColor('excellent') : theme.text.primary,
          }]}
          >{c.putts}</Text>
        ),
      }))}
      total={nine.putts}
    />,
    <Row
      key="t"
      s={s}
      tint={sub}
      label={label('tee')}
      cells={nine.cells.map((c) => {
        const pen = c.penalties > 0;
        const a11y = c.drive
          ? t(pen ? 'stats.game.ledger.a11y.teePenalty' : 'stats.game.ledger.a11y.tee', { hole: c.number, drive: t(`stats.game.ledger.drive.${c.drive}`) })
          : pen ? t('stats.game.ledger.a11y.penalty', { hole: c.number }) : null;
        return {
          key: c.number,
          a11y: a11y ? who(a11y) : undefined,
          child: (
            <>
              {c.drive
                ? <Text style={[s.plain, { color: GOOD_DRIVE.has(c.drive) ? theme.scoreColor('excellent') : theme.destructive }]}>{GLYPH[c.drive]}</Text>
                : <Text style={s.dim}>·</Text>}
              {pen && <View style={[s.penalty, { backgroundColor: theme.destructive }]} testID={`${idp}-penalty-${c.number}`} />}
            </>
          ),
        };
      })}
      total={nine.fairways.of > 0 ? `${nine.fairways.hit}/${nine.fairways.of}` : null}
    />,
    <Row
      key="g"
      s={s}
      tint={sub}
      label={label('green')}
      cells={nine.cells.map((c) => ({
        key: c.number,
        a11y: c.gir == null ? undefined : who(t(c.gir ? 'stats.game.ledger.a11y.gir' : 'stats.game.ledger.a11y.girMissed', { hole: c.number })),
        child: c.gir == null ? null : (
          <View
            testID={`${idp}-gir-${c.number}`}
            style={[s.gir, c.gir ? { backgroundColor: theme.accent.primary } : { borderWidth: 1.5, borderColor: theme.text.muted }]}
          />
        ),
      }))}
      total={nine.gir.of > 0 ? nine.gir.hit : null}
    />,
  ];
}

function NameButton({ row, open, onToggle, s, theme, t }) {
  if (!row.canExpand) {
    return <Text style={[s.label, s.name, s.nameIdle]} numberOfLines={1} testID={`card-name-${row.id}`}>{row.label}</Text>;
  }
  return (
    <Pressable
      testID={`card-name-${row.id}`}
      onPress={() => onToggle(row.id)}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={t(open ? 'stats.game.ledger.a11y.hideShots' : 'stats.game.ledger.a11y.showShots', { name: row.player.name ?? row.label })}
      style={s.nameBtn}
    >
      <Text style={[s.name, s.nameText]} numberOfLines={1}>{row.label}</Text>
      <Feather
        name="chevron-right"
        size={12}
        color={theme.accent.primary}
        style={open ? s.chevOpen : null}
      />
    </Pressable>
  );
}

function scoreCells({ row, nine, mode, card, s, theme, t, idp }) {
  const isPoints = mode === 'points';
  return nine.cells.map((c) => {
    if (c.strokes == null) {
      return { key: c.number, style: s.empty, a11y: t('stats.game.card.notPlayed') };
    }
    const level = isPoints && !card.pointsTinted ? null : cellLevel(mode, c);
    const { bg, fg } = level == null ? { bg: 'transparent', fg: theme.text.primary } : heatColors(theme, level);
    const value = isPoints ? formatNumber(c.points ?? 0) : c.strokes;
    const base = isPoints
      ? t('stats.game.ledger.a11y.points', { hole: c.number, count: c.points ?? 0 })
      : t('stats.game.ledger.a11y.strokes', { hole: c.number, count: c.strokes, result: t(`stats.game.ledger.result.${c.gross}`) });
    const withStrokes = c.extra > 0 ? `${base}, ${t('stats.game.ledger.a11y.hcpStrokes', { count: c.extra })}` : base;
    // Dots read on every tint; on the solid accent cell they take its text colour.
    const dot = level === 4 ? fg : theme.accent.primary;
    return {
      key: c.number,
      style: { backgroundColor: bg },
      a11y: card.solo ? withStrokes : t('stats.game.ledger.a11y.who', { name: row.player.name ?? row.label, text: withStrokes }),
      child: (
        <>
          <Text style={[s.value, { color: fg }]} testID={`${idp}-cell-${c.number}`} numberOfLines={1}>{value}</Text>
          {c.extra > 0 && (
            <View style={s.dots} pointerEvents="none">
              {Array.from({ length: Math.min(c.extra, 2) }).map((_, i) => (
                <View key={i} style={[s.dot, { backgroundColor: dot }]} testID={`${idp}-hcp-${c.number}`} />
              ))}
            </View>
          )}
        </>
      ),
    };
  });
}

export default function ShotScorecard({ card, mode = 'strokes' }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [expanded, setExpanded] = useState(() => initialExpanded(card));
  const soloRow = card?.solo ? card.rows[0] : null;
  const run = useMemo(() => (soloRow ? ledgerBestRun(soloRow, mode) : null), [soloRow, mode]);
  if (!card || card.rows.length === 0) return null;
  const isPoints = mode === 'points';
  const onToggle = (id) => setExpanded((cur) => toggleExpanded(card, cur, id));

  const totalOf = (block) => {
    const v = isPoints ? block.points : block.strokes;
    return v == null ? null : formatNumber(v);
  };

  let totalLine = null;
  if (soloRow) {
    const { total } = soloRow;
    const toPar = total.toPar === 0 ? t('stats.game.standings.even') : signed(total.toPar ?? 0);
    const parts = isPoints
      ? [t('stats.game.ledger.pointsN', { count: total.points ?? 0 }), t('stats.game.ledger.strokesN', { count: total.strokes ?? 0 })]
      : [t('stats.game.ledger.strokesN', { count: total.strokes ?? 0 }), toPar];
    if (soloRow.hasShots && total.putts != null) parts.push(t('stats.game.ledger.puttsN', { count: total.putts }));
    totalLine = parts.join(' · ');
  }

  return (
    <View testID={card.solo ? 'hole-ledger' : 'shot-scorecard'}>
      {card.nines.map((head, ni) => (
        <View key={head.key} style={s.nine} testID={`ledger-${head.key}`}>
          <Row
            s={s}
            label={t('stats.game.ledger.hole')}
            cells={head.holes.map((h) => ({ key: h.number, child: <Text style={s.dim}>{h.number}</Text> }))}
            total={t(`stats.game.ledger.${head.key}`)}
            totalStyle={s.totalHead}
          />
          <Row
            s={s}
            label={t('stats.game.ledger.par')}
            cells={head.holes.map((h) => ({ key: h.number, child: <Text style={s.dim}>{h.par}</Text> }))}
            total={head.par}
          />
          {card.rows.map((row) => {
            const nine = row.nines[ni];
            const idp = card.solo ? 'ledger' : `card-${row.id}`;
            const open = card.solo ? row.hasShots : row.canExpand && expanded.includes(row.id);
            const label = card.solo
              ? t(isPoints ? 'stats.game.ledger.points' : 'stats.game.ledger.strokes')
              : <NameButton row={row} open={open} onToggle={onToggle} s={s} theme={theme} t={t} />;
            return (
              <View key={row.id} style={!card.solo && s.player}>
                <Row
                  s={s}
                  height={SCORE_H}
                  label={label}
                  cells={scoreCells({ row, nine, mode, card, s, theme, t, idp })}
                  total={totalOf(nine)}
                  totalTestID={`${idp}-total-${head.key}`}
                />
                {open && shotRows({ row, nine, s, theme, t, sub: !card.solo, idp })}
              </View>
            );
          })}
        </View>
      ))}
      {totalLine && (
        <View style={s.totalLine}>
          <Text style={s.totalLabel}>{t('stats.game.ledger.total')}</Text>
          <Text style={s.totalValue} testID="ledger-total">{totalLine}</Text>
        </View>
      )}
      {run && (
        <Text style={s.run} testID="ledger-run">
          <Text style={[s.runLabel, { color: theme.isDark ? theme.semantic.winner.dark : theme.semantic.winner.light }]}>{t('stats.game.ledger.runLabel')}</Text>
          {': '}
          {t(isPoints ? 'stats.game.ledger.runPoints' : 'stats.game.ledger.runStrokes', { count: run.length, from: run.from, to: run.to })}
        </Text>
      )}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    nine: { marginBottom: 10 },
    row: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
    player: { marginTop: 2 },
    label: { width: LABEL_W, fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, color: theme.text.secondary },
    subLabel: { paddingLeft: 8, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9, color: theme.text.muted },
    name: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 0.6 },
    nameIdle: { color: theme.text.secondary },
    nameBtn: { width: LABEL_W, minHeight: SCORE_H, flexDirection: 'row', alignItems: 'center', gap: 1 },
    nameText: { color: theme.text.primary },
    chevOpen: { transform: [{ rotate: '90deg' }] },
    cell: {
      flex: 1, marginHorizontal: 1, borderRadius: 5, alignItems: 'center', justifyContent: 'center',
    },
    tint: { backgroundColor: theme.accent.light },
    empty: { borderWidth: 1, borderStyle: 'dashed', borderColor: theme.border.default },
    dim: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, fontVariant: ['tabular-nums'] },
    value: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, fontVariant: ['tabular-nums'], marginBottom: 2 },
    plain: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, fontVariant: ['tabular-nums'] },
    total: {
      width: TOTAL_W, marginLeft: 2, borderRadius: 5, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.bg.secondary,
    },
    totalHead: { backgroundColor: 'transparent' },
    totalText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: theme.text.primary, fontVariant: ['tabular-nums'] },
    // Handicap strokes: up to two tiny dots along the foot of the score cell.
    dots: { position: 'absolute', bottom: 2, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 2 },
    dot: { width: 3, height: 3, borderRadius: 1.5 },
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
