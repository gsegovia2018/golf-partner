import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Line as SvgLine } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatNumber } from '../../i18n';
import { semantic } from '../../theme/tokens';
import SectionCard from '../mystats/SectionCard';
import StatTile from '../mystats/StatTile';
import ScoreMixBar from '../mystats/ScoreMixBar';
import PressableScale from '../ui/PressableScale';
import { scalePoints } from '../mystats/chartGeometry';

// Deep-green hero surface — same cream-on-green treatment as FormHero/CoachHero.
const GREEN = '#00553c';
const CREAM = '#f3efe6';
const CREAM_70 = 'rgba(243,239,230,0.7)';
const CREAM_80 = 'rgba(243,239,230,0.8)';
const GOLD = semantic.winner.dark;

const fmt1 = (v) => (v == null ? '—' : formatNumber(v, { decimals: 1 }));
const fmtSigned1 = (v, t) => {
  if (v == null) return null;
  if (v === 0) return t('stats.player.summary.flat');
  return v < 0 ? `▼ ${formatNumber(Math.abs(v), { decimals: 1 })}` : `▲ ${formatNumber(v, { decimals: 1 })}`;
};

const CHIP_KEYS = ['hot', 'up', 'steady', 'down'];

// strengths/weaknesses labels come from personalStats.rankStrengths (a closed set).
const CELL_KEY = {
  'Par 3s': 'par3',
  'Par 4s': 'par4',
  'Par 5s': 'par5',
  'Hard holes': 'hard',
  'Mid holes': 'mid',
  'Easy holes': 'easy',
  'Opening 3 holes': 'opening',
  'Closing 3 holes': 'closing',
  'Front nine': 'front',
  'Back nine': 'back',
  'Tee shot on the fairway': 'fairway',
  'Tee shot missing the fairway': 'missedFairway',
  'After a tee penalty': 'teePenalty',
};
const cellLabel = (label, t) => (CELL_KEY[label] ? t(`stats.player.cell.${CELL_KEY[label]}`) : label);

// friendVerdict returns a descriptor whose params may be nested descriptors
// (level / trait / form) and raw numbers; render it in the active language.
function renderVerdict(msg, t) {
  const params = {};
  Object.entries(msg.params ?? {}).forEach(([k, v]) => {
    if (v && typeof v === 'object') params[k] = renderVerdict(v, t);
    else params[k] = typeof v === 'number' ? formatNumber(v) : v;
  });
  return t(msg.key, params);
}

// Sparkline for the last-10 differentials with a dashed line at the current
// app index and filled dots for rounds at/better than it (lower is better).
function FormSparkline({ series, index }) {
  const t = useT();
  const [width, setWidth] = React.useState(0);
  const height = 92;
  const padX = 16;
  const padTop = 18;
  const padBottom = 18;

  const values = series.map((p) => p.value);
  const withIndex = index == null ? values : [...values, index];
  const scaled = width > 0 ? scalePoints(withIndex, { width, height, padX, padTop, padBottom }) : [];
  const points = index == null ? scaled : scaled.slice(0, values.length);
  const indexY = index == null ? null : scaled[scaled.length - 1]?.y;

  if (!values.some((v) => v != null)) {
    return (
      <View style={sparkStyles.empty}>
        <Text style={sparkStyles.emptyText}>{t('stats.player.summary.notEnoughRounds')}</Text>
      </View>
    );
  }

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {indexY != null && (
            <SvgLine
              x1={padX / 2} y1={indexY} x2={width - padX / 2} y2={indexY}
              stroke={CREAM_70} strokeWidth={1.5} strokeDasharray="4,4"
            />
          )}
          <Polyline
            points={points.filter((p) => p.y != null).map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={CREAM}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((p, i) => {
            if (p.y == null) return null;
            const onOrBetter = index != null && p.value <= index;
            return (
              <Circle
                key={`sp-${i}`}
                cx={p.x} cy={p.y} r={3.4}
                fill={onOrBetter ? GOLD : GREEN}
                stroke={onOrBetter ? GOLD : CREAM}
                strokeWidth={1.5}
              />
            );
          })}
        </Svg>
      )}
    </View>
  );
}

const sparkStyles = StyleSheet.create({
  empty: { paddingVertical: 20, alignItems: 'center' },
  emptyText: { color: CREAM_70, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, fontStyle: 'italic' },
});

// Summary tab: hero verdict + headline numbers, form trend, strengths/pain
// points, net score mix, home course, career bests, and a head-to-head card
// linking into the Together tab. All numbers come from `summary`/`h2h` — no
// domain maths lives here.
export default function SummaryTab({ summary, verdict, h2h, name, onInfo, onGoTogether }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const t = useT();

  const move3m = fmtSigned1(summary.index?.move3m, t);
  const chipKey = summary.form?.chip ?? 'steady';
  // Reuses the app's existing better/worse tokens (accent = improving,
  // destructive = declining) rather than inventing new hero-surface colors.
  const chipColor = chipKey === 'hot' ? GOLD
    : chipKey === 'up' ? theme.accent.primary
      : chipKey === 'down' ? theme.destructive
        : CREAM_70;
  const chip = {
    label: t(`stats.player.summary.chip.${CHIP_KEYS.includes(chipKey) ? chipKey : 'steady'}`),
    color: chipColor,
  };
  const winShare = h2h && h2h.n > 0 ? h2h.wins / h2h.n : 0;

  return (
    <View style={s.wrap}>
      {/* Hero */}
      <View style={s.hero}>
        {verdict ? <Text style={s.verdict}>{renderVerdict(verdict, t)}</Text> : null}
        <View style={s.heroRow}>
          <PressableScale style={s.heroStat} onPress={() => onInfo?.('scoreDifferential')} disabled={!onInfo}>
            <Text style={s.heroValue}>{fmt1(summary.recentDiff?.value)}</Text>
            <Text style={s.heroLabel}>{t('stats.player.summary.avgDiff', { count: summary.recentDiff?.count ?? 0 })}</Text>
          </PressableScale>
          <PressableScale style={s.heroStat} onPress={() => onInfo?.('handicapIndex')} disabled={!onInfo}>
            <Text style={s.heroValue}>{fmt1(summary.index?.value)}</Text>
            <Text style={s.heroLabel}>{t('stats.player.summary.appIndex')}</Text>
            {move3m ? <Text style={s.heroSub}>{t('stats.player.summary.move3m', { move: move3m })}</Text> : null}
          </PressableScale>
          <PressableScale style={s.heroStat} onPress={() => onInfo?.('scoreDifferential')} disabled={!onInfo}>
            <Text style={s.heroValue}>{fmt1(summary.bestDiff?.value)}</Text>
            <Text style={s.heroLabel}>{t('stats.player.summary.bestDiff')}</Text>
            {summary.bestDiff?.courseName ? (
              <Text style={s.heroSub} numberOfLines={1}>{summary.bestDiff.courseName}</Text>
            ) : null}
          </PressableScale>
        </View>
      </View>

      {/* Form */}
      <View style={s.formCard}>
        <View style={s.formHead}>
          <Text style={s.formKicker}>{t('stats.player.summary.form')}</Text>
          <View style={[s.chip, { backgroundColor: `${chip.color}26` }]}>
            <Text style={[s.chipText, { color: chip.color }]}>{chip.label}</Text>
          </View>
        </View>
        <Text style={s.formValue}>
          {fmt1(summary.form?.recent)}
          <Text style={s.formSuffix}>{` ${t('stats.player.summary.diffUnit')}`}</Text>
        </Text>
        <FormSparkline series={summary.series ?? []} index={summary.index?.value} />
        <Text style={s.formMeta}>{t('stats.player.summary.formMeta')}</Text>
      </View>

      {(summary.strengths?.length > 0 || summary.weaknesses?.length > 0) && (
        <SectionCard title={t('stats.player.summary.strengthsTitle')} infoKey="strengths" onInfo={onInfo}>
          <View style={s.swRow}>
            <View style={s.swCol}>
              <Text style={s.swColTitle}>{t('stats.player.summary.strengths')}</Text>
              {(summary.strengths ?? []).length === 0 ? (
                <Text style={s.swEmpty}>{t('stats.player.summary.notEnoughSample')}</Text>
              ) : summary.strengths.map((item) => (
                <View key={item.label} style={s.swRowItem}>
                  <Text style={s.swLabel} numberOfLines={1}>{cellLabel(item.label, t)}</Text>
                  <Text style={[s.swValue, { color: theme.accent.primary }]}>{formatNumber(item.avgPoints, { decimals: 2 })}</Text>
                </View>
              ))}
            </View>
            <View style={s.swCol}>
              <Text style={s.swColTitle}>{t('stats.player.summary.watchOuts')}</Text>
              {(summary.weaknesses ?? []).length === 0 ? (
                <Text style={s.swEmpty}>{t('stats.player.summary.notEnoughSample')}</Text>
              ) : summary.weaknesses.map((item) => (
                <View key={item.label} style={s.swRowItem}>
                  <Text style={s.swLabel} numberOfLines={1}>{cellLabel(item.label, t)}</Text>
                  <Text style={[s.swValue, { color: theme.destructive }]}>{formatNumber(item.avgPoints, { decimals: 2 })}</Text>
                </View>
              ))}
            </View>
          </View>
        </SectionCard>
      )}

      {summary.scoreMix?.total > 0 && (
        <SectionCard title={t('stats.player.summary.scoreMix')} infoKey="scoreMix" onInfo={onInfo}>
          <ScoreMixBar distribution={summary.scoreMix} />
        </SectionCard>
      )}

      {summary.homeCourse && (
        <SectionCard title={t('stats.player.summary.homeCourse')} titleVariant="heading">
          <Text style={s.homeCourseName} numberOfLines={1}>{summary.homeCourse.courseName}</Text>
          <View style={s.homeCourseRow}>
            <View style={s.homeCourseStat}>
              <Text style={s.homeCourseValue}>{summary.homeCourse.rounds}</Text>
              <Text style={s.homeCourseLabel}>{t('stats.player.summary.rounds')}</Text>
            </View>
            <View style={s.homeCourseStat}>
              <Text style={s.homeCourseValue}>{formatNumber(summary.homeCourse.avgPoints)}</Text>
              <Text style={s.homeCourseLabel}>{t('stats.player.summary.avgPts')}</Text>
            </View>
            <View style={s.homeCourseStat}>
              <Text style={s.homeCourseValue}>{summary.homeCourse.bestPoints}</Text>
              <Text style={s.homeCourseLabel}>{t('stats.player.summary.bestPts')}</Text>
            </View>
            <View style={s.homeCourseStat}>
              <Text style={s.homeCourseValue}>{fmt1(summary.homeCourse.avgDifferential)}</Text>
              <Text style={s.homeCourseLabel}>{t('stats.player.summary.avgDiffShort')}</Text>
            </View>
          </View>
        </SectionCard>
      )}

      <SectionCard title={t('stats.player.summary.bests')} titleVariant="heading">
        <View style={s.bestsGrid}>
          <StatTile value={fmt1(summary.bestDiff?.value)} caption={t('stats.player.summary.bestDifferential')} />
          <StatTile value={summary.bestRound?.points ?? '—'} caption={t('stats.player.summary.bestRound')} />
          <StatTile value={summary.milestones?.longestParStreak ?? 0} caption={t('stats.player.summary.bestParStreak')} />
          <StatTile value={summary.milestones?.bestNine ?? '—'} caption={t('stats.player.summary.bestNine')} />
        </View>
      </SectionCard>

      <PressableScale onPress={onGoTogether} disabled={!onGoTogether}>
        <SectionCard title={t('stats.player.summary.vs', { name })} titleVariant="heading">
          {h2h && h2h.n > 0 ? (
            <>
              <View style={s.h2hRow}>
                <View style={s.h2hCell}>
                  <Text style={s.h2hValue}>{h2h.wins}</Text>
                  <Text style={s.h2hLabel}>{t('stats.player.summary.wins')}</Text>
                </View>
                <View style={s.h2hCell}>
                  <Text style={s.h2hValue}>{h2h.ties}</Text>
                  <Text style={s.h2hLabel}>{t('stats.player.summary.ties')}</Text>
                </View>
                <View style={s.h2hCell}>
                  <Text style={s.h2hValue}>{h2h.losses}</Text>
                  <Text style={s.h2hLabel}>{t('stats.player.summary.losses')}</Text>
                </View>
              </View>
              <View style={s.winShareTrack}>
                <View style={[s.winShareFill, { width: `${Math.round(winShare * 100)}%` }]} />
              </View>
              <View style={s.last5Row}>
                {(h2h.last5 ?? []).map((r, i) => (
                  <Text
                    key={`h2h-${i}`}
                    style={[
                      s.last5Glyph,
                      { color: r === 'W' ? theme.accent.primary : r === 'L' ? theme.destructive : theme.text.muted },
                    ]}
                  >
                    {t(`stats.player.summary.glyph.${r}`)}
                  </Text>
                ))}
              </View>
            </>
          ) : (
            <Text style={s.swEmpty}>{t('stats.player.summary.noShared')}</Text>
          )}
        </SectionCard>
      </PressableScale>

      <Text style={s.footer}>
        {t('stats.player.footer', { count: summary.roundCount ?? 0 })}
      </Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },

    hero: {
      backgroundColor: GREEN, borderRadius: 16, padding: theme.spacing.lg, gap: theme.spacing.md,
    },
    verdict: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 19, lineHeight: 25, color: CREAM },
    heroRow: { flexDirection: 'row', gap: theme.spacing.sm },
    heroStat: { flex: 1, gap: 2 },
    heroValue: { fontFamily: 'PlayfairDisplay-Black', fontSize: 26, color: GOLD, fontVariant: ['tabular-nums'] },
    heroLabel: {
      fontSize: 9.5, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1, textTransform: 'uppercase', color: CREAM_70,
    },
    heroSub: { fontSize: 10.5, fontFamily: 'PlusJakartaSans-SemiBold', color: CREAM_80 },

    formCard: { backgroundColor: GREEN, borderRadius: 16, padding: theme.spacing.lg, gap: theme.spacing.sm },
    formHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    formKicker: {
      fontSize: 10, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1.4, textTransform: 'uppercase', color: CREAM_70,
    },
    chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
    chipText: { fontSize: 10.5, fontFamily: 'PlusJakartaSans-Bold' },
    formValue: { fontFamily: 'PlayfairDisplay-Black', fontSize: 32, color: CREAM, fontVariant: ['tabular-nums'] },
    formSuffix: { fontSize: 13, fontFamily: 'PlusJakartaSans-SemiBold', color: CREAM_70 },
    formMeta: { fontSize: 10.5, fontFamily: 'PlusJakartaSans-SemiBold', color: CREAM_80 },

    swRow: { flexDirection: 'row', gap: theme.spacing.lg },
    swCol: { flex: 1, gap: 6 },
    swColTitle: {
      fontSize: 9.5, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1, textTransform: 'uppercase', color: theme.text.muted,
    },
    swRowItem: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
    swLabel: { flex: 1, fontSize: 12, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.primary },
    swValue: { fontSize: 12, fontFamily: 'PlusJakartaSans-ExtraBold', fontVariant: ['tabular-nums'] },
    swEmpty: { fontSize: 11.5, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontStyle: 'italic' },

    homeCourseName: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
    homeCourseRow: { flexDirection: 'row', gap: theme.spacing.md },
    homeCourseStat: { flex: 1, alignItems: 'center' },
    homeCourseValue: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary },
    homeCourseLabel: {
      fontSize: 9, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1, textTransform: 'uppercase', color: theme.text.muted, marginTop: 2,
    },

    bestsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },

    h2hRow: { flexDirection: 'row', gap: 8 },
    h2hCell: {
      flex: 1, backgroundColor: theme.bg.secondary, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    },
    h2hValue: { fontFamily: 'PlayfairDisplay-Black', fontSize: 24, color: theme.text.primary },
    h2hLabel: {
      fontSize: 9, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1, textTransform: 'uppercase', color: theme.text.muted, marginTop: 3,
    },
    winShareTrack: {
      height: 8, borderRadius: 4, backgroundColor: theme.bg.secondary, overflow: 'hidden', marginTop: theme.spacing.sm,
    },
    winShareFill: { height: '100%', backgroundColor: theme.accent.primary, borderRadius: 4 },
    last5Row: { flexDirection: 'row', gap: 4, marginTop: theme.spacing.sm },
    last5Glyph: { fontSize: 11, fontFamily: 'PlusJakartaSans-ExtraBold' },

    footer: {
      fontSize: 11, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, textAlign: 'center', paddingHorizontal: theme.spacing.md,
    },
  });
}
