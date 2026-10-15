// Players: one player's game — headline tiles, score mix, where the points
// came from, stroke holes, nines, nemesis, round history and shot detail.
import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useT } from '../../i18n';
import ScoreMixBar from '../mystats/ScoreMixBar';
import { isLowSample } from '../mystats/metricTone';
import { standingsRows, strokeHoleSplit, shotComparison, playerBestRuns } from '../../store/gameStatsView';
import {
  playerRoundHistory, playerAvgStableford, playerAvgPerHole, playerScoreDistribution, parTypeSplit,
  bounceBackRate, frontBackSplit, playerNemesisAndCrushed, shotStats, scramblingStats,
} from '../../store/statsEngine';
import { holeDifficultySplit } from '../../store/personalStats';
import {
  roundSheet, bucketSheet, frontBackSheet, bounceSheet, nemesisSheet, roundTag,
} from './sheets';
import { Chip, SectionTitle, firstName, num, signed, shortName, useStatStyles } from './ui';

const DRIVE_KEYS = ['fairway', 'left', 'right', 'short', 'super'];

function Tile({ value, label, s, tone }) {
  return (
    <View style={s.tile}>
      <Text style={[s.tileValue, tone && { color: tone }]} numberOfLines={1}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
    </View>
  );
}

export default function PlayersTab({ tournament, selectedId, onSelectPlayer, onOpenSheet, onOpenMyStats }) {
  const t = useT();
  const { theme, s } = useStatStyles();
  const players = tournament.players;
  const player = players.find((p) => p.id === selectedId) ?? players[0];
  const pid = player?.id;

  const data = useMemo(() => {
    if (!pid) return null;
    const standing = standingsRows(tournament).rows.find((r) => r.player.id === pid);
    return {
      standing,
      runs: playerBestRuns(tournament, pid),
      history: playerRoundHistory(tournament, pid),
      avgRound: playerAvgStableford(tournament, pid),
      perHole: playerAvgPerHole(tournament, pid),
      dist: playerScoreDistribution(tournament, pid),
      parSplit: parTypeSplit(tournament, pid),
      difficulty: holeDifficultySplit(tournament, pid),
      strokes: strokeHoleSplit(tournament, pid),
      frontBack: frontBackSplit(tournament).find((r) => r.player.id === pid) ?? null,
      bounce: bounceBackRate(tournament).find((r) => r.player.id === pid) ?? null,
      nc: playerNemesisAndCrushed(tournament).find((r) => r.player.id === pid) ?? null,
      shots: shotStats(tournament, pid),
      scrambling: scramblingStats(tournament).find((r) => r.player.id === pid) ?? null,
      comparison: shotComparison(tournament),
    };
  }, [tournament, pid]);

  if (!player) return null;

  const chips = players.length > 1 && (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
      {players.map((p) => (
        <Chip key={p.id} testID={`player-chip-${p.id}`} active={p.id === pid} label={shortName(p, players)} onPress={() => onSelectPlayer(p.id)} />
      ))}
    </ScrollView>
  );

  if (!data.history.length) {
    return (
      <View>
        {chips}
        <Text style={s.empty}>{t('stats.screen.players.noScores', { name: player.name })}</Text>
      </View>
    );
  }

  const { standing, history, dist, parSplit, difficulty, strokes, frontBack, bounce, nc, shots, scrambling, comparison } = data;
  const runParts = [
    data.runs.par > 0 && t('stats.game.player.runPars', { count: data.runs.par }),
    data.runs.birdie > 0 && t('stats.game.player.runBirdies', { count: data.runs.birdie }),
  ].filter(Boolean);
  const hasFull = history.some((r) => r.fullRound);
  const tone = (avg) => theme.scoreColor(avg >= 2 ? 'good' : avg >= 1.5 ? 'neutral' : 'poor');

  const whereRows = [
    { key: 'p3', label: t('stats.data.parType.par3'), b: { ...parSplit.par3, avg: parSplit.par3.avgPoints } },
    { key: 'p4', label: t('stats.data.parType.par4'), b: { ...parSplit.par4, avg: parSplit.par4.avgPoints } },
    { key: 'p5', label: t('stats.data.parType.par5'), b: { ...parSplit.par5, avg: parSplit.par5.avgPoints } },
    { key: 'hard', label: t('stats.game.player.hardThird'), b: { ...difficulty.hard, avg: difficulty.hard.avgPoints } },
    { key: 'easy', label: t('stats.game.player.easyThird'), b: { ...difficulty.easy, avg: difficulty.easy.avgPoints } },
  ].filter((r) => r.b.holes > 0);

  const lowNines = frontBack && frontBack.rounds.length === 1;

  return (
    <View>
      {chips}

      <View style={s.tiles}>
        <Tile
          s={s}
          value={num(standing.total)}
          label={players.length > 1
            ? t('stats.game.player.totalRank', { place: standing.isTie ? `T${standing.place}` : standing.place, count: players.length })
            : t('stats.game.player.total')}
        />
        <Tile
          s={s}
          value={hasFull ? num(data.avgRound, { maxDecimals: 1 }) : '–'}
          label={t('stats.game.player.avgRound', { perHole: num(data.perHole, { decimals: 2 }) })}
        />
        <Tile
          s={s}
          value={signed(standing.vs)}
          label={t('stats.game.player.vsHcp')}
          tone={standing.vs >= 0 ? theme.scoreColor('good') : theme.scoreColor('poor')}
        />
      </View>

      {runParts.length > 0 && (
        <Text style={[s.sub, { marginBottom: 12 }]} testID="best-runs">
          <Text style={s.strong}>{t('stats.game.player.runLabel')}</Text>
          {'  '}
          {runParts.join(' · ')}
        </Text>
      )}

      <View style={s.card}>
        <SectionTitle right={t('stats.game.mix.net')}>{t('stats.game.player.mix')}</SectionTitle>
        <ScoreMixBar distribution={dist} />
      </View>

      {whereRows.length > 0 && (
        <View style={s.card}>
          <SectionTitle right={t('stats.screen.ptsPerHoleUnit')}>{t('stats.game.player.where')}</SectionTitle>
          {whereRows.map((r, i) => (
            <TouchableOpacity
              key={r.key}
              style={[s.row, i === 0 && s.rowFirst]}
              activeOpacity={0.7}
              accessibilityRole="button"
              onPress={() => onOpenSheet(bucketSheet(player, r.label, r.b))}
            >
              <Text style={s.rowLabel} numberOfLines={1}>{r.label}</Text>
              <View style={s.barTrack}>
                <View style={[s.barFill, { width: `${Math.min(100, (r.b.avg / 3) * 100)}%`, backgroundColor: tone(r.b.avg) }]} />
              </View>
              <Text style={s.rowValue}>{num(r.b.avg, { decimals: 2 })}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {strokes.withStroke.holes + strokes.withoutStroke.holes > 0 && (
        <View style={s.card}>
          <SectionTitle>{t('stats.game.player.strokeHoles')}</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[
              { key: 'with', label: t('stats.game.player.withStroke', { count: strokes.withStroke.holes }), b: strokes.withStroke },
              { key: 'without', label: t('stats.game.player.withoutStroke', { count: strokes.withoutStroke.holes }), b: strokes.withoutStroke },
            ].map((x) => (
              <TouchableOpacity
                key={x.key}
                style={[s.tile, { borderWidth: 0, backgroundColor: theme.bg.secondary }]}
                disabled={x.b.holes === 0}
                accessibilityRole="button"
                onPress={() => onOpenSheet(bucketSheet(player, x.label, x.b))}
              >
                <Text style={s.tileValue}>{x.b.avg == null ? '–' : num(x.b.avg, { decimals: 2 })}</Text>
                <Text style={s.tileLabel}>{x.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.note}>{t('stats.game.player.strokeNote')}</Text>
        </View>
      )}

      {(frontBack || bounce) && (
        <View style={s.card}>
          <SectionTitle>{t('stats.game.player.nines')}</SectionTitle>
          {frontBack && (
            <TouchableOpacity style={[s.row, s.rowFirst]} activeOpacity={0.7} accessibilityRole="button" onPress={() => onOpenSheet(frontBackSheet(frontBack))}>
              <View style={s.grow}>
                <Text style={s.strong}>
                  {t('stats.game.player.frontBack', { front: num(frontBack.frontAvg, { decimals: 2 }), back: num(frontBack.backAvg, { decimals: 2 }) })}
                </Text>
                <Text style={s.sub}>{t('stats.screen.ptsPerHoleUnit')}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}
          {bounce && (
            <TouchableOpacity style={[s.row, !frontBack && s.rowFirst]} activeOpacity={0.7} accessibilityRole="button" onPress={() => onOpenSheet(bounceSheet(bounce))}>
              <View style={s.grow}>
                <Text style={s.strong}>{t('stats.game.player.bounce', { rate: num(bounce.rate) })}</Text>
                <Text style={s.sub}>{t('stats.screen.bounce.cardSub', { done: bounce.bounceBacks, total: bounce.opportunities })}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}
          {(lowNines || (bounce && isLowSample(bounce.opportunities))) && (
            <Text style={s.note}>{t('stats.game.player.lowSample')}</Text>
          )}
        </View>
      )}

      {nc && (
        <View style={s.card}>
          <SectionTitle>{t('stats.screen.nc.section')}</SectionTitle>
          {[
            { kind: 'nemesis', e: nc.nemesis, label: t('stats.screen.nc.nemesis'), color: theme.destructive },
            { kind: 'crushed', e: nc.crushed, label: t('stats.screen.nc.crushed'), color: theme.scoreColor('excellent') },
          ].map((x, i) => (
            <TouchableOpacity key={x.kind} style={[s.row, i === 0 && s.rowFirst]} activeOpacity={0.7} accessibilityRole="button" onPress={() => onOpenSheet(nemesisSheet(player, x.e, x.kind))}>
              <View style={s.grow}>
                <Text style={[s.sectionTitle, { color: x.color }]}>{x.label}</Text>
                <Text style={s.strong} numberOfLines={1}>
                  {t('stats.game.player.ncHole', { round: x.e.roundIndex + 1, hole: x.e.holeNumber, course: x.e.courseName })}
                </Text>
              </View>
              <Text style={s.sub}>{t('stats.game.player.ncValue', { strokes: x.e.strokes, par: x.e.par, count: x.e.points })}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={s.card}>
        <SectionTitle>{t('stats.screen.history.section')}</SectionTitle>
        {history.map((r, i) => (
          <TouchableOpacity key={r.roundIndex} style={[s.row, i === 0 && s.rowFirst]} activeOpacity={0.7} accessibilityRole="button" onPress={() => onOpenSheet(roundSheet(tournament, player, r))}>
            <Text style={[s.strong, { color: theme.accent.primary, width: 28 }]}>{roundTag(r.roundIndex)}</Text>
            <View style={s.grow}>
              <Text style={s.strong} numberOfLines={1}>{r.courseName}</Text>
              <Text style={s.sub}>{t('stats.screen.history.sub', { count: r.holesPlayed, avg: num(r.avgPerHole, { decimals: 2 }) })}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.strong}>{t('stats.screen.pts', { n: num(r.points) })}</Text>
              <Text style={s.sub}>{t('stats.screen.str', { n: num(r.strokes) })}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {shots.hasData && (
        <View style={s.card} testID="player-shots">
          <SectionTitle right={t('stats.game.shots.rounds', { count: shots.roundsWithData })}>{t('stats.game.shots.title')}</SectionTitle>
          {shots.putts.holes > 0 && (
            <>
              <Text style={[s.sub, { marginBottom: 6 }]}>{t('stats.screen.shots.putting')}</Text>
              <View style={[s.tiles, { marginBottom: 8 }]}>
                <Tile s={s} value={num(shots.putts.perRound)} label={t('stats.screen.shots.perRound')} />
                <Tile s={s} value={num(shots.putts.perHole)} label={t('stats.screen.shots.perHole')} />
                <Tile s={s} value={num(shots.putts.onePutts)} label={t('stats.screen.shots.onePutts')} />
                <Tile s={s} value={num(shots.putts.threePuttPlus)} label={t('stats.screen.shots.threePutts')} />
              </View>
            </>
          )}
          {shots.drives.recorded > 0 ? (
            <View style={[s.row, s.rowFirst]}>
              <View style={s.grow}>
                <Text style={s.strong}>{t('stats.game.shots.fir', { pct: num(shots.drives.fairwayPct) })}</Text>
                <Text style={s.sub}>
                  {DRIVE_KEYS.filter((k) => shots.drives.distribution[k] > 0)
                    .map((k) => `${t(`stats.screen.drive.${k}`)} ${shots.drives.distribution[k]}`).join(' · ')}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={s.sub}>{t('stats.screen.shots.noDrives')}</Text>
          )}
          {shots.gir.eligible > 0 && (
            <View style={s.row}>
              <Text style={[s.strong, s.grow]}>{t('stats.game.shots.gir', { pct: num(shots.gir.pct) })}</Text>
              <Text style={s.sub}>{t('stats.screen.shots.girHoles', { holes: shots.gir.holes, eligible: shots.gir.eligible })}</Text>
            </View>
          )}
          {scrambling && (
            <View style={s.row}>
              <Text style={[s.strong, s.grow]}>{t('stats.game.shots.scrambling', { pct: num(scrambling.pct) })}</Text>
              <Text style={s.sub}>{t('stats.game.shots.saves', { saves: scrambling.saves, missed: scrambling.missedGir })}</Text>
            </View>
          )}
          <View style={s.row}>
            <Text style={[s.strong, s.grow]}>{t('stats.game.shots.penalties', { count: shots.penalties.total })}</Text>
            <Text style={s.sub}>{t('stats.game.shots.penSplit', { tee: shots.penalties.tee, other: shots.penalties.other })}</Text>
          </View>
          {onOpenMyStats && (
            <TouchableOpacity style={[s.row, { justifyContent: 'flex-end' }]} onPress={onOpenMyStats} accessibilityRole="link">
              <Text style={s.link}>{t('stats.game.shots.career')}</Text>
              <Feather name="arrow-right" size={14} color={theme.accent.primary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {comparison.length >= 2 && (
        <View style={s.card} testID="shot-comparison">
          <SectionTitle>{t('stats.game.shots.compare')}</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={[s.row, s.rowFirst]}>
                <Text style={[s.sectionTitle, { width: 84 }]}>{t('stats.game.shots.player')}</Text>
                {['fir', 'gir', 'putts', 'three', 'pen'].map((k) => (
                  <Text key={k} style={[s.sectionTitle, { width: 56, textAlign: 'right' }]}>{t(`stats.game.shots.col.${k}`)}</Text>
                ))}
              </View>
              {comparison.map((r) => (
                <View key={r.player.id} style={s.row}>
                  <Text style={[s.strong, { width: 84 }]} numberOfLines={1}>{firstName(r.player)}</Text>
                  {[
                    r.firPct == null ? '–' : `${num(r.firPct)}%`,
                    r.girPct == null ? '–' : `${num(r.girPct)}%`,
                    r.puttsPerHole == null ? '–' : num(r.puttsPerHole),
                    r.threePutts == null ? '–' : num(r.threePutts),
                    num(r.penalties),
                  ].map((v, i) => (
                    <Text key={i} style={[s.rowValue, { width: 56 }]}>{v}</Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}
