// Rivals: the head-to-head grid (net hole wins) and, with real team rounds,
// match play results, pair cards and partner splits.
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useT } from '../../i18n';
import { withAlpha } from '../../theme/alpha';
import { h2hGrid, matchPlayRounds } from '../../store/gameStatsView';
import { headToHead, pairPerformance, pairCarryRatio } from '../../store/statsEngine';
import { playerPartnerSplits } from '../../store/tournamentStore';
import { duelSheet, pairCardSheet, splitsSheet, roundTag } from './sheets';
import { resultText } from './RoundsTab';
import { Chip, SectionTitle, firstName, num, signed, shortName, useStatStyles } from './ui';

const NAME_W = 76;
const CELL_W = 56;
const CELL_H = 46;

export default function RivalsTab({ tournament, pairsTournament, fixedTeams, defaultPlayerId, onOpenSheet }) {
  const t = useT();
  const { theme, s } = useStatStyles();
  const players = tournament.players;
  const grid = useMemo(() => h2hGrid(tournament), [tournament]);
  const matches = useMemo(() => matchPlayRounds(tournament), [tournament]);
  const maxAbs = Math.max(1, ...grid.flat().filter(Boolean).map((c) => Math.abs(c.net)));

  const teams = useMemo(() => {
    if (!pairsTournament) return null;
    const carry = pairCarryRatio(pairsTournament);
    const key = (ids) => [...ids].sort().join('|');
    const carryBy = new Map(carry.map((c) => [key(c.members.map((m) => m.id)), c]));
    return {
      cards: pairPerformance(pairsTournament).map((p) => ({
        ...p, key: key(p.players.map((x) => x.id)), carry: carryBy.get(key(p.players.map((x) => x.id))) ?? null,
      })),
    };
  }, [pairsTournament]);

  const [splitId, setSplitId] = useState(defaultPlayerId ?? players[0]?.id);
  const splitPlayer = players.find((p) => p.id === splitId) ?? players[0];
  const splits = useMemo(
    () => (pairsTournament && !fixedTeams && splitPlayer ? playerPartnerSplits(pairsTournament, splitPlayer.id) : null),
    [pairsTournament, fixedTeams, splitPlayer],
  );

  const cellBg = (net) => {
    if (net === 0) return theme.bg.secondary;
    const hex = net > 0 ? theme.scoreColor('excellent') : theme.scoreColor('poor');
    return withAlpha(hex, 0.12 + 0.3 * Math.min(1, Math.abs(net) / maxAbs));
  };
  const openDuel = (i, j) => {
    const p1 = players[i];
    const p2 = players[j];
    onOpenSheet(duelSheet(p1, p2, headToHead(tournament, p1.id, p2.id)));
  };

  return (
    <View>
      <View style={s.card}>
        <SectionTitle>{t('stats.game.rivals.h2h')}</SectionTitle>
        <Text style={[s.sub, { marginBottom: 10 }]}>{t('stats.game.rivals.h2hHint')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View testID="h2h-grid">
            <View style={{ flexDirection: 'row' }}>
              <View style={{ width: NAME_W }} />
              {players.map((p) => (
                // No section-title letter spacing: at 1.5 neighbouring names ran
                // into each other ("MarcosMolden"). Same short names and size as
                // the scorecard heatmap's heads, kept inside the cell.
                <Text
                  key={p.id}
                  testID={`h2h-head-${p.id}`}
                  style={[s.sectionTitle, { width: CELL_W, paddingHorizontal: 2, textAlign: 'center', textTransform: 'none', fontSize: 11, letterSpacing: 0 }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {shortName(p, players)}
                </Text>
              ))}
            </View>
            {players.map((row, i) => (
              <View key={row.id} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <Text style={[s.strong, { width: NAME_W, fontSize: 13 }]} numberOfLines={1}>{shortName(row, players)}</Text>
                {players.map((col, j) => {
                  const cell = grid[i][j];
                  if (i === j || !cell) {
                    return (
                      <View key={col.id} style={{ width: CELL_W, height: CELL_H, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={s.sub}>–</Text>
                      </View>
                    );
                  }
                  const color = cell.net > 0 ? theme.scoreColor('excellent') : cell.net < 0 ? theme.scoreColor('poor') : theme.text.secondary;
                  return (
                    <TouchableOpacity
                      key={col.id}
                      testID={`h2h-cell-${row.id}-${col.id}`}
                      onPress={() => openDuel(i, j)}
                      accessibilityRole="button"
                      accessibilityLabel={t('stats.game.rivals.cellA11y', {
                        a: firstName(row), b: firstName(col), w: cell.wins, l: cell.losses, tie: cell.ties,
                      })}
                      style={{ width: CELL_W - 4, height: CELL_H, marginHorizontal: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: cellBg(cell.net) }}
                    >
                      <Text style={[s.strong, { color, fontSize: 15 }]}>{signed(cell.net)}</Text>
                      <Text style={[s.legendText, { color: theme.text.secondary }]}>{`${cell.wins}-${cell.losses}-${cell.ties}`}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
        <Text style={s.note}>{t('stats.game.rivals.h2hLegend')}</Text>
      </View>

      {matches.length > 0 && (
        <View style={s.card} testID="match-play-results">
          <SectionTitle>{t('stats.screen.matchPlay.section')}</SectionTitle>
          {matches.map((m, i) => (
            <View key={m.roundIndex} style={[s.row, i === 0 && s.rowFirst]}>
              <Text style={[s.strong, { color: theme.accent.primary, width: 28 }]}>{roundTag(m.roundIndex)}</Text>
              <View style={s.grow}>
                <Text style={s.strong}>{resultText(m.result, t)}</Text>
                <Text style={s.sub} numberOfLines={1}>{m.courseName}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {teams && teams.cards.length > 0 && (
        <View style={s.card}>
          <SectionTitle>{t('stats.screen.pairs.section')}</SectionTitle>
          {teams.cards.map((card, i) => {
            const shareA = card.carry ? Math.round(card.carry.shares[0].share * 100) : null;
            return (
              <TouchableOpacity key={card.key} testID={`pair-card-${card.key}`} style={[s.row, i === 0 && s.rowFirst, { flexDirection: 'column', alignItems: 'stretch' }]} activeOpacity={0.7} accessibilityRole="button" onPress={() => onOpenSheet(pairCardSheet(card))}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[s.strong, s.grow]} numberOfLines={1}>
                    {t('stats.screen.join.two', { a: firstName(card.players[0]), b: firstName(card.players[1]) })}
                  </Text>
                  <Text style={s.stat} testID={`pair-avg-${card.key}`}>{num(card.avgPoints, { maxDecimals: 1 })}</Text>
                  <Feather name="chevron-right" size={16} color={theme.text.muted} />
                </View>
                {/* The figure is both partners' Stableford added up, whatever the mode. */}
                <Text style={s.sub}>{t('stats.game.rivals.pairSub', { count: card.rounds })}</Text>
                {shareA != null && (
                  <View style={{ marginTop: 6 }}>
                    <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
                      <View style={{ flex: Math.max(shareA, 1), backgroundColor: theme.pairA }} />
                      <View style={{ flex: Math.max(100 - shareA, 1), backgroundColor: theme.pairB }} />
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                      <Text style={s.legendText}>{`${firstName(card.carry.shares[0].player)} ${shareA}%`}</Text>
                      <Text style={s.legendText}>{`${100 - shareA}% ${firstName(card.carry.shares[1].player)}`}</Text>
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {splits && (
        <View style={s.card}>
          <SectionTitle right={t('stats.screen.splits.baseline', { n: num(splits.baseline) })}>
            {t('stats.game.rivals.splits')}
          </SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
            {players.map((p) => (
              <Chip key={p.id} active={p.id === splitPlayer.id} label={shortName(p, players)} onPress={() => setSplitId(p.id)} />
            ))}
          </ScrollView>
          {splits.partners.length === 0 ? (
            <Text style={s.sub}>{t('stats.screen.splits.empty', { name: firstName(splitPlayer) })}</Text>
          ) : splits.partners.map((row, i) => (
            <TouchableOpacity key={row.partner.id} style={[s.row, i === 0 && s.rowFirst]} activeOpacity={0.7} accessibilityRole="button" onPress={() => onOpenSheet(splitsSheet(splitPlayer, row, splits.baseline))}>
              <View style={s.grow}>
                <Text style={s.strong} numberOfLines={1}>{row.partner.name ?? '—'}</Text>
                <Text style={s.sub}>{t('stats.screen.pairs.rounds', { count: row.rounds })}</Text>
              </View>
              <Text style={s.strong}>{t('stats.screen.pts', { n: num(row.avgPlayerPoints) })}</Text>
              <Text style={[s.rowValue, {
                color: row.delta >= 2 ? theme.scoreColor('excellent') : row.delta <= -2 ? theme.scoreColor('poor') : theme.text.secondary,
              }]}
              >{signed(row.delta)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}
