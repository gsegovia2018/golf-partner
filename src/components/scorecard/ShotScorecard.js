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
//
// `tone="deep"` draws it on the deep-green hero (the Home cards): text,
// accent and fills come from the onDeep set and the score tints from deepHeat.
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { onDeep } from '../../theme/tokens';
import { withAlpha } from '../../theme/alpha';
import { useT, formatNumber } from '../../i18n';
import { cellLevel, ledgerBestRun } from '../../store/gameStatsView';
import { initialExpanded, toggleExpanded } from '../../store/scorecardView';
import { heatColors, signed } from '../gamestats/ui';
import { renderMsg } from '../mystats/msg';

const LABEL_W = 42;
const TOTAL_W = 30;
const CELL_H = 22;
const SCORE_H = 24;
const GLYPH = { fairway: '↑', super: '★', left: '←', right: '→', short: '↓' };
const GOOD_DRIVE = new Set(['fairway', 'super']);

// On bg.deep: cream text, mint for good, salmon for poor; every pair passes 4.5:1.
const CREAM = '#f3efe6';
const DEEP_GOOD = '#9be3c2';
const DEEP_POOR = '#ffb4a8';
function onDeepTheme(theme) {
  return {
    ...theme,
    isDark: true,
    text: { ...theme.text, primary: CREAM, secondary: onDeep.soft, muted: onDeep.faint, inverse: theme.bg.deep },
    accent: { ...theme.accent, primary: CREAM, light: onDeep.chip },
    bg: { ...theme.bg, secondary: onDeep.fill },
    border: { ...theme.border, default: onDeep.borderStrong },
    destructive: DEEP_POOR,
    scoreColor: (level) => (level === 'excellent' || level === 'good' ? DEEP_GOOD : level === 'poor' ? DEEP_POOR : CREAM),
  };
}
// heatColors' scale for the deep surface: 0 salmon wash, 1 faint, 2 chip, 3 mint, 4+ gold.
function deepHeat(level) {
  if (level == null) return { bg: 'transparent', fg: onDeep.faint };
  if (level <= 0) return { bg: withAlpha(DEEP_POOR, 0.18), fg: DEEP_POOR };
  if (level === 1) return { bg: onDeep.fill, fg: onDeep.soft };
  if (level === 2) return { bg: onDeep.chip, fg: CREAM };
  if (level === 3) return { bg: DEEP_GOOD, fg: '#00553c' };
  return { bg: '#ffe08a', fg: '#00553c' };
}

function Row({ s, label, cells, total, totalStyle, style, height = CELL_H, tint, totalTestID, labelStyle }) {
  return (
    <View style={[s.row, style]}>
      {typeof label === 'string' ? <Text style={[s.label, labelStyle]} numberOfLines={1}>{label}</Text> : label}
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
  const whyColor = theme.isDark ? theme.semantic.winner.dark : theme.semantic.winner.light;
  const girLabel = (c) => {
    const base = t(c.gir ? 'stats.game.ledger.a11y.gir' : 'stats.game.ledger.a11y.girMissed', { hole: c.number });
    if (!c.why?.length) return base;
    return `${base}, ${t('stats.game.ledger.a11y.why', { summary: c.why.map(renderMsg).join(' · ') })}`;
  };
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
        a11y: c.gir == null
          ? (c.why?.length ? who(t('stats.game.ledger.a11y.why', { summary: c.why.map(renderMsg).join(' · ') })) : undefined)
          : who(girLabel(c)),
        // A reason can be logged without putts (no green mark): the dot then stands alone.
        child: c.gir == null && !c.why?.length ? null : (
          <>
            {c.gir != null && (
              <View
                testID={`${idp}-gir-${c.number}`}
                style={[s.gir, c.gir ? { backgroundColor: theme.accent.primary } : { borderWidth: 1.5, borderColor: theme.text.muted }]}
              />
            )}
            {c.why?.length > 0 && (
              <View style={[s.why, { backgroundColor: whyColor }]} testID={`${idp}-why-${c.number}`} pointerEvents="none" />
            )}
          </>
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

function scoreCells({ row, nine, mode, card, s, theme, t, idp, heat }) {
  const isPoints = mode === 'points';
  return nine.cells.map((c) => {
    if (c.strokes == null) {
      return { key: c.number, style: s.empty, a11y: t('stats.game.card.notPlayed') };
    }
    const level = isPoints && !card.pointsTinted ? null : cellLevel(mode, c);
    const { bg, fg } = level == null ? { bg: 'transparent', fg: theme.text.primary } : heat(level);
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

// Optional, for the Home cards: `currentHole` rings that hole's column,
// `labelOf(row)` and `labelWidth` replace the three-letter row label,
// `pointsRow` adds a points row under a solo ledger's strokes, `tone="deep"`
// draws it on the deep-green hero, `summary={false}` drops the totals line
// and best run under a solo ledger. `groups` puts rows under a header row
// per pair: [{ key, label, color, holes: { [number]: points | null }, total, ids }].
export default function ShotScorecard({
  card, mode = 'strokes', currentHole = null, labelOf = null, labelWidth = null, pointsRow = false,
  tone = null, summary = true, groups = null,
}) {
  const { theme: base } = useTheme();
  const deep = tone === 'deep';
  const theme = useMemo(() => (deep ? onDeepTheme(base) : base), [base, deep]);
  const heat = useMemo(() => (deep ? deepHeat : (level) => heatColors(theme, level)), [deep, theme]);
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
  const wide = labelWidth ? { width: labelWidth } : null;
  const ring = (number) => (number === currentHole ? s.current : null);

  let totalLine = null;
  if (soloRow && summary) {
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
            cells={head.holes.map((h) => ({ key: h.number, style: ring(h.number), child: <Text style={[s.dim, h.number === currentHole && s.currentText]}>{h.number}</Text> }))}
            total={t(`stats.game.ledger.${head.key}`)}
            totalStyle={s.totalHead}
            labelStyle={wide}
          />
          <Row
            s={s}
            label={t('stats.game.ledger.par')}
            cells={head.holes.map((h) => ({ key: h.number, child: <Text style={s.dim}>{h.par}</Text> }))}
            total={head.par}
            labelStyle={wide}
          />
          {(() => {
            const renderRow = (row) => {
              const nine = row.nines[ni];
              const idp = card.solo ? 'ledger' : `card-${row.id}`;
              const open = card.solo ? row.hasShots : row.canExpand && expanded.includes(row.id);
              const label = card.solo
                ? t(isPoints ? 'stats.game.ledger.points' : 'stats.game.ledger.strokes')
                : labelOf
                  ? <Text style={[s.label, s.name, s.nameText, wide, groups && s.memberLabel, row.isMe && s.meLabel]} numberOfLines={1} testID={`card-name-${row.id}`}>{labelOf(row)}</Text>
                  : <NameButton row={row} open={open} onToggle={onToggle} s={s} theme={theme} t={t} />;

              return (
                <View key={row.id} style={!card.solo && s.player}>
                  <Row
                    s={s}
                    height={SCORE_H}
                    label={label}
                    cells={scoreCells({ row, nine, mode, card, s, theme, t, idp, heat }).map((c) => (c.key === currentHole ? { ...c, style: [c.style, s.currentCell] } : c))}
                    total={totalOf(nine)}
                    totalTestID={`${idp}-total-${head.key}`}
                    style={row.isMe && labelOf ? s.meRow : null}
                    labelStyle={wide}
                  />
                  {pointsRow && card.solo && (
                    <Row
                      s={s}
                      label={t('stats.game.ledger.points')}
                      labelStyle={wide}
                      cells={nine.cells.map((c) => ({
                        key: c.number,
                        a11y: c.points == null ? undefined : t('stats.game.ledger.a11y.points', { hole: c.number, count: c.points }),
                        child: c.points == null ? null : <Text style={[s.plain, { color: c.points >= 3 ? theme.scoreColor('excellent') : c.points === 0 ? theme.destructive : theme.text.primary }]}>{c.points}</Text>,
                      }))}
                      total={nine.points == null ? null : formatNumber(nine.points)}
                    />
                  )}
                  {open && shotRows({ row, nine, s, theme, t, sub: !card.solo, idp })}
                </View>
              );
            };
            if (!groups) return card.rows.map(renderRow);
            const byId = new Map(card.rows.map((r) => [r.id, r]));
            return groups.map((g) => (
              <View key={g.key} style={s.group} testID={`card-group-${g.key}`}>
                <Row
                  s={s}
                  height={SCORE_H}
                  style={s.groupRow}
                  labelStyle={wide}
                  label={(
                    <View style={[s.groupLabel, wide]}>
                      <View style={[s.groupDot, { backgroundColor: g.color }]} />
                      <Text style={s.groupName} numberOfLines={1}>{g.label}</Text>
                    </View>
                  )}
                  cells={head.holes.map((h) => {
                    const v = g.holes?.[h.number];
                    const ringed = h.number === currentHole ? s.currentCell : null;
                    if (v == null) return { key: h.number, style: [s.empty, ringed] };
                    return {
                      key: h.number,
                      style: [{ backgroundColor: v > 0 ? withAlpha(g.color, 0.35) : 'transparent' }, ringed],
                      a11y: t('stats.game.ledger.a11y.who', { name: g.label, text: t('stats.game.ledger.a11y.points', { hole: h.number, count: v }) }),
                      child: <Text style={[s.value, { color: v > 0 ? theme.text.primary : theme.text.muted }]}>{formatNumber(v)}</Text>,
                    };
                  })}
                  total={g.nineTotals?.[head.key] != null ? formatNumber(g.nineTotals[head.key]) : null}
                  totalTestID={`card-group-${g.key}-total-${head.key}`}
                />
                {g.ids.map((id) => byId.get(id)).filter(Boolean).map(renderRow)}
              </View>
            ));
          })()}
        </View>
      ))}
      {totalLine && (
        <View style={s.totalLine}>
          <Text style={s.totalLabel}>{t('stats.game.ledger.total')}</Text>
          <Text style={s.totalValue} testID="ledger-total">{totalLine}</Text>
        </View>
      )}
      {run && summary && (
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
    current: { borderWidth: 1.5, borderColor: theme.accent.primary },
    currentText: { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-ExtraBold' },
    currentCell: { borderWidth: 1.5, borderColor: theme.accent.primary, borderStyle: 'solid' },
    meRow: { backgroundColor: theme.accent.light, borderRadius: 6 },
    group: { marginTop: 6 },
    groupRow: { backgroundColor: theme.bg.secondary, borderRadius: 6 },
    groupLabel: { width: LABEL_W, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 4 },
    groupDot: { width: 7, height: 7, borderRadius: 4 },
    groupName: { flexShrink: 1, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: theme.text.primary },
    memberLabel: { paddingLeft: 12 },
    meLabel: { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-ExtraBold' },
    totalText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: theme.text.primary, fontVariant: ['tabular-nums'] },
    // Handicap strokes: up to two tiny dots along the foot of the score cell.
    dots: { position: 'absolute', bottom: 2, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 2 },
    dot: { width: 3, height: 3, borderRadius: 1.5 },
    // Tee penalty: a solid red dot pinned to the cell's top-right corner.
    penalty: { position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: 3 },
    // Miss reason tagged: a gold dot in the cell's top-right corner, like the penalty one.
    why: { position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: 3 },
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
