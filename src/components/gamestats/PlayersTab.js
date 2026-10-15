// Players: one player's game — headline tiles, shot summary, the hole-by-hole
// ledger (one-round games), score mix, tee shots, putts, where the points
// came from, bounce-back, nemesis, round history (several rounds) and the
// comparison with the rest of the group. `singleIndex` is the round of a
// one-round game (null otherwise): then nothing reads "per round".
import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useT } from '../../i18n';
import ScoreMixBar from '../mystats/ScoreMixBar';
import FairwayFan from '../mystats/FairwayFan';
import { isLowSample } from '../mystats/metricTone';
import {
  standingsRows, playerBestRuns, roundLedger, scoreMix, scoringSplits, puttBuckets, shotComparePlots,
} from '../../store/gameStatsView';
import {
  playerRoundHistory, playerAvgStableford, playerAvgPerHole, bounceBackRate, playerNemesisAndCrushed,
  shotStats, scramblingStats,
} from '../../store/statsEngine';
import { roundSheet, bounceSheet, nemesisSheet, roundTag } from './sheets';
import HoleLedger from './HoleLedger';
import { Ring, DotRow, PuttHistogram, DivergingBars, ComparePlot } from './charts';
import { Chip, ModeToggle, SectionTitle, firstName, num, signed, shortName, useStatStyles } from './ui';

function Tile({ value, label, s, tone }) {
  return (
    <View style={s.tile}>
      <Text style={[s.tileValue, tone && { color: tone }]} numberOfLines={1}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
    </View>
  );
}

function StripItem({ children, label, s }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <View style={{ height: 58, justifyContent: 'center' }}>{children}</View>
      <Text style={[s.legendText, { fontSize: 11, textAlign: 'center' }]}>{label}</Text>
    </View>
  );
}

export default function PlayersTab({
  tournament, selectedId, onSelectPlayer, onOpenSheet, onOpenMyStats, singleIndex = null, mode, onModeChange,
}) {
  const t = useT();
  const { theme, s } = useStatStyles();
  const single = singleIndex != null;
  const players = tournament.players;
  const player = players.find((p) => p.id === selectedId) ?? players[0];
  const pid = player?.id;

  const data = useMemo(() => {
    if (!pid) return null;
    return {
      standing: standingsRows(tournament).rows.find((r) => r.player.id === pid),
      runs: playerBestRuns(tournament, pid),
      history: playerRoundHistory(tournament, pid),
      avgRound: playerAvgStableford(tournament, pid),
      perHole: playerAvgPerHole(tournament, pid),
      ledger: single ? roundLedger(tournament, singleIndex, pid) : null,
      splits: scoringSplits(tournament, pid),
      bounce: bounceBackRate(tournament).find((r) => r.player.id === pid) ?? null,
      nc: playerNemesisAndCrushed(tournament).find((r) => r.player.id === pid) ?? null,
      shots: shotStats(tournament, pid),
      putts: puttBuckets(tournament, pid),
      scrambling: scramblingStats(tournament).find((r) => r.player.id === pid) ?? null,
      plots: shotComparePlots(tournament),
    };
  }, [tournament, pid, single, singleIndex]);
  const dist = useMemo(() => (pid ? scoreMix(tournament, pid, mode) : null), [tournament, pid, mode]);

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

  const { standing, history, ledger, splits, bounce, nc, shots, putts, scrambling, plots } = data;
  const sheetOpts = { single };
  const rankLabel = players.length > 1
    ? t('stats.game.player.totalRank', { place: standing.isTie ? `T${standing.place}` : standing.place, count: players.length })
    : t('stats.game.player.total');
  const hasFull = history.some((r) => r.fullRound);
  const runParts = [
    data.runs.par > 0 && t('stats.game.player.runPars', { count: data.runs.par }),
    data.runs.birdie > 0 && t('stats.game.player.runBirdies', { count: data.runs.birdie }),
  ].filter(Boolean);
  const pct = (k, n) => (n > 0 ? Math.round((k / n) * 100) : 0);
  const modeToggle = (id) => <ModeToggle value={mode} onChange={onModeChange} testID={id} />;

  const toPar = ledger?.total.toPar;
  const tiles = single ? (
    <View style={s.tiles}>
      <Tile s={s} value={num(standing.total)} label={rankLabel} />
      <Tile
        s={s}
        value={ledger.total.strokes == null ? '–' : num(ledger.total.strokes)}
        label={t('stats.game.player.strokesToPar', { vs: toPar === 0 ? t('stats.game.standings.even') : signed(toPar ?? 0) })}
      />
      <Tile s={s} value={signed(standing.vs)} label={t('stats.game.player.vsHcp')} tone={standing.vs >= 0 ? theme.scoreColor('good') : theme.scoreColor('poor')} />
    </View>
  ) : (
    <View style={s.tiles}>
      <Tile s={s} value={num(standing.total)} label={rankLabel} />
      <Tile
        s={s}
        value={hasFull ? num(data.avgRound, { maxDecimals: 1 }) : '–'}
        label={t('stats.game.player.avgRound', { perHole: num(data.perHole, { decimals: 2 }) })}
      />
      <Tile s={s} value={signed(standing.vs)} label={t('stats.game.player.vsHcp')} tone={standing.vs >= 0 ? theme.scoreColor('good') : theme.scoreColor('poor')} />
    </View>
  );

  const drives = shots.drives;
  const strip = shots.hasData && (drives.recorded > 0 || shots.gir.eligible > 0 || putts.holes > 0) && (
    <View style={[s.card, { flexDirection: 'row', gap: 6, paddingHorizontal: 10 }]} testID="player-shots">
      {drives.recorded > 0 && (
        <StripItem s={s} label={t('stats.game.shots.fairways')}>
          <Ring ratio={drives.fairwaysHit / drives.recorded} center={`${drives.fairwaysHit}/${drives.recorded}`} accessibilityLabel={t('stats.game.shots.firA11y', { k: drives.fairwaysHit, n: drives.recorded })} />
        </StripItem>
      )}
      {shots.gir.eligible > 0 && (
        <StripItem s={s} label={t('stats.game.shots.greens')}>
          <Ring ratio={shots.gir.holes / shots.gir.eligible} center={`${shots.gir.holes}/${shots.gir.eligible}`} accessibilityLabel={t('stats.game.shots.girA11y', { k: shots.gir.holes, n: shots.gir.eligible })} />
        </StripItem>
      )}
      {putts.holes > 0 && (
        <StripItem s={s} label={t('stats.game.shots.puttsPerHole', { n: num(putts.total / putts.holes, { decimals: 1 }) })}>
          <Text style={[s.stat, { fontSize: 20 }]}>{num(putts.total)}</Text>
        </StripItem>
      )}
      {scrambling && (
        <StripItem s={s} label={t('stats.game.shots.scramblingLabel')}>
          <Ring ratio={scrambling.saves / scrambling.missedGir} center={`${scrambling.saves}/${scrambling.missedGir}`} accessibilityLabel={t('stats.game.shots.scrA11y', { k: scrambling.saves, n: scrambling.missedGir })} />
        </StripItem>
      )}
    </View>
  );

  const puttBars = [
    putts.zero > 0 && { key: 'zero', label: t('stats.game.shots.putts0'), count: putts.zero, tone: 'good' },
    { key: 'one', label: t('stats.game.shots.putts1'), count: putts.one, tone: 'good' },
    { key: 'two', label: t('stats.game.shots.putts2'), count: putts.two, tone: 'neutral' },
    { key: 'three', label: t('stats.game.shots.putts3'), count: putts.three, tone: 'poor' },
  ].filter(Boolean);

  const splitLabel = (key) => ({
    par3: t('stats.data.parType.par3'),
    par4: t('stats.data.parType.par4'),
    par5: t('stats.data.parType.par5'),
    front: t('stats.game.where.front'),
    back: t('stats.game.where.back'),
    withStroke: t('stats.game.where.withStroke'),
    withoutStroke: t('stats.game.where.withoutStroke'),
  })[key];
  const whereGroups = splits.map((g) => ({
    key: g.key,
    label: t(`stats.game.where.group.${g.key}`),
    items: g.items.map((it) => ({ key: it.key, label: splitLabel(it.key), value: it.avg, text: num(it.avg, { decimals: 2 }) })),
  }));

  const penaltyLine = (single ? shots.penalties.other > 0 : shots.penalties.total > 0) && (
    <Text style={[s.sub, { marginBottom: 12 }]} testID="player-penalties">
      {`${t('stats.game.shots.penalties', { count: shots.penalties.total })} · ${t('stats.game.shots.penSplit', { tee: shots.penalties.tee, other: shots.penalties.other })}`}
    </Text>
  );

  const fmtPlot = (key, v) => (key === 'putts' ? num(v, { decimals: 1 }) : `${num(v)}%`);

  return (
    <View>
      {chips}
      {tiles}

      {!single && runParts.length > 0 && (
        <Text style={[s.sub, { marginBottom: 12 }]} testID="best-runs">
          <Text style={s.strong}>{t('stats.game.player.runLabel')}</Text>
          {'  '}
          {runParts.join(' · ')}
        </Text>
      )}

      {strip}

      {ledger && (
        <View style={[s.card, { paddingHorizontal: 10 }]}>
          <View style={{ paddingHorizontal: 4 }}>
            <SectionTitle right={modeToggle('ledger-mode')}>{t('stats.game.ledger.title')}</SectionTitle>
          </View>
          <HoleLedger ledger={ledger} mode={mode} />
        </View>
      )}

      <View style={s.card} testID="player-mix">
        <SectionTitle right={modeToggle('player-mix-mode')}>{t('stats.game.player.mix')}</SectionTitle>
        <ScoreMixBar distribution={dist} />
      </View>

      {drives.recorded > 0 && (
        <View style={s.card} testID="player-drives">
          <SectionTitle right={t('stats.game.shots.drivesSub', { count: drives.recorded })}>{t('stats.game.shots.drives')}</SectionTitle>
          <FairwayFan drives={drives} />
          <Text style={[s.sub, { marginTop: 6 }]}>
            {t('stats.game.shots.fanCaption', {
              k: drives.distribution.fairway + drives.distribution.super, n: drives.recorded,
              sup: drives.distribution.super, short: drives.distribution.short,
            })}
          </Text>
        </View>
      )}

      {putts.holes > 0 && (
        <View style={s.card} testID="player-putts">
          <SectionTitle right={t('stats.game.shots.puttsSub', { count: putts.holes, total: num(putts.total), n: num(putts.total / putts.holes, { decimals: 1 }) })}>
            {t('stats.game.shots.putts')}
          </SectionTitle>
          <PuttHistogram
            bars={puttBars}
            accessibilityLabel={puttBars.map((b) => `${b.label}: ${b.count}`).join(', ')}
          />
        </View>
      )}

      {penaltyLine}

      {whereGroups.length > 0 && (
        <View style={s.card}>
          <SectionTitle right={t('stats.screen.ptsPerHoleUnit')}>{t('stats.game.player.where')}</SectionTitle>
          <DivergingBars
            groups={whereGroups}
            caption={t('stats.game.where.caption')}
            accessibilityLabel={whereGroups.flatMap((g) => g.items.map((it) => `${it.label} ${it.text}`)).join(', ')}
          />
        </View>
      )}

      {bounce && (
        <TouchableOpacity style={s.card} activeOpacity={0.7} accessibilityRole="button" testID="player-bounce" onPress={() => onOpenSheet(bounceSheet(bounce, sheetOpts))}>
          <SectionTitle right={t('stats.game.player.bounceSub')}>{t('stats.game.player.bounceTitle')}</SectionTitle>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
            <Text style={[s.stat, { fontSize: 22 }]}>{bounce.bounceBacks}</Text>
            <Text style={s.sub}>{t('stats.game.player.kOfN', { n: bounce.opportunities, pct: pct(bounce.bounceBacks, bounce.opportunities) })}</Text>
            <View style={s.grow} />
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </View>
          <DotRow k={bounce.bounceBacks} n={bounce.opportunities} accessibilityLabel={t('stats.game.player.dotsA11y', { k: bounce.bounceBacks, n: bounce.opportunities })} />
          {isLowSample(bounce.opportunities) && <Text style={s.note}>{t('stats.game.player.lowSample')}</Text>}
        </TouchableOpacity>
      )}

      {scrambling && (
        <View style={s.card} testID="player-scrambling">
          <SectionTitle right={t('stats.game.shots.scramblingSub')}>{t('stats.game.shots.scramblingLabel')}</SectionTitle>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
            <Text style={[s.stat, { fontSize: 22 }]}>{scrambling.saves}</Text>
            <Text style={s.sub}>{t('stats.game.player.kOfN', { n: scrambling.missedGir, pct: pct(scrambling.saves, scrambling.missedGir) })}</Text>
          </View>
          <DotRow k={scrambling.saves} n={scrambling.missedGir} accessibilityLabel={t('stats.game.player.dotsA11y', { k: scrambling.saves, n: scrambling.missedGir })} />
        </View>
      )}

      {nc && (
        <View style={s.card}>
          <SectionTitle>{t('stats.screen.nc.section')}</SectionTitle>
          {[
            { kind: 'nemesis', e: nc.nemesis, label: t('stats.screen.nc.nemesis'), color: theme.destructive },
            { kind: 'crushed', e: nc.crushed, label: t('stats.screen.nc.crushed'), color: theme.scoreColor('excellent') },
          ].map((x, i) => (
            <TouchableOpacity key={x.kind} style={[s.row, i === 0 && s.rowFirst]} activeOpacity={0.7} accessibilityRole="button" onPress={() => onOpenSheet(nemesisSheet(player, x.e, x.kind, sheetOpts))}>
              <View style={s.grow}>
                <Text style={[s.sectionTitle, { color: x.color }]}>{x.label}</Text>
                <Text style={s.strong} numberOfLines={1}>
                  {single
                    ? t('stats.game.player.ncHoleSingle', { hole: x.e.holeNumber, par: x.e.par })
                    : t('stats.game.player.ncHole', { round: x.e.roundIndex + 1, hole: x.e.holeNumber, course: x.e.courseName })}
                </Text>
              </View>
              <Text style={s.sub}>
                {single
                  ? t('stats.game.player.ncValueSingle', { strokes: x.e.strokes, count: x.e.points })
                  : t('stats.game.player.ncValue', { strokes: x.e.strokes, par: x.e.par, count: x.e.points })}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!single && (
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
      )}

      {plots.length > 0 && shots.hasData && (
        <View style={s.card} testID="shot-comparison">
          <SectionTitle right={t('stats.game.compare.sub')}>{t('stats.game.compare.title')}</SectionTitle>
          {plots.map((m) => (
            <View key={m.key} style={{ marginTop: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={[s.strong, { fontSize: 12 }]}>{t(`stats.game.compare.${m.key}`)}</Text>
                <Text style={[s.sub, { fontSize: 11 }]}>{t(`stats.game.compare.${m.key}Unit`)}</Text>
              </View>
              <ComparePlot
                testID={`compare-${m.key}`}
                values={m.values.map((v) => ({ ...v, text: fmtPlot(m.key, v.value) }))}
                max={m.max}
                selectedId={pid}
                accessibilityLabel={`${t(`stats.game.compare.${m.key}`)}: ${m.values.map((v) => `${firstName(v.player)} ${fmtPlot(m.key, v.value)}`).join(', ')}`}
              />
            </View>
          ))}
        </View>
      )}

      {single && !shots.hasData && (
        <Text style={[s.sub, { marginBottom: 12 }]} testID="no-shots-note">{t('stats.game.shots.none', { name: firstName(player) })}</Text>
      )}

      {shots.hasData && onOpenMyStats && (
        <TouchableOpacity style={[s.row, s.rowFirst, { justifyContent: 'flex-end' }]} onPress={onOpenMyStats} accessibilityRole="link">
          <Text style={s.link}>{t('stats.game.shots.career')}</Text>
          <Feather name="arrow-right" size={14} color={theme.accent.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}
