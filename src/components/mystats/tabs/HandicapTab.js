import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeContext';
import PressableScale from '../../ui/PressableScale';
import Reveal from '../../ui/Reveal';
import SectionCard from '../SectionCard';
import IndexHistoryChart from '../IndexHistoryChart';
import {
  computeHandicapIndex, handicapIndexSeries, monthlyIndexSeries, nextRoundOutlook,
  MIN_DIFFERENTIALS,
} from '../../../store/handicapIndex';
import { upsertProfile } from '../../../store/profileStore';

// "12 May" — short date for a ledger row.
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// "9 May ’26" — date with year, for the personal-low fact.
function fmtDateYr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${day} ’${String(d.getFullYear()).slice(-2)}`;
}

// "Apr ’25" — month labels for the chart axis and the plate header.
function fmtMonthYr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-GB', { month: 'short' })} ’${String(d.getFullYear()).slice(-2)}`;
}

const fmt1 = (n) => n.toFixed(1);
const round1 = (n) => Math.round(n * 10) / 10;

const reasonLabel = (row) => (
  row.reason === 'nine-holes' ? '9-hole round' : 'no slope/rating'
);

const LEDGER_VISIBLE = 12;

// Memoised — see the note in CoachTab.
function HandicapTab({
  myRounds, profileHandicap, onInfo, onApplied, excludedKeys, onToggleExcluded,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const result = useMemo(
    () => computeHandicapIndex(myRounds, { excludedKeys }),
    [myRounds, excludedKeys],
  );
  const series = useMemo(
    () => handicapIndexSeries(myRounds, { excludedKeys }),
    [myRounds, excludedKeys],
  );
  const monthly = useMemo(() => monthlyIndexSeries(series), [series]);
  const outlook = useMemo(
    () => nextRoundOutlook(myRounds, { excludedKeys }),
    [myRounds, excludedKeys],
  );

  const [chartMode, setChartMode] = useState('round');
  const [showAll, setShowAll] = useState(false);
  const [applyState, setApplyState] = useState('idle'); // idle | saving | done | error

  const gold = theme.isDark ? theme.semantic.winner.dark : theme.semantic.winner.light;
  const goldText = theme.isDark ? theme.semantic.winner.soft : theme.semantic.winner.light;

  // The index each round produced, and its movement vs the round before —
  // keyed by round so ledger rows can print "→ 19.8 ▼".
  const afterByKey = useMemo(() => {
    const map = new Map();
    series.forEach((p, i) => {
      map.set(p.key, {
        after: p.value,
        mv: i > 0 ? round1(p.value - series[i - 1].value) : null,
      });
    });
    return map;
  }, [series]);

  // First round that set the current personal low — gets the gold flag.
  const lowKey = useMemo(() => {
    if (!outlook) return null;
    return series.find((p) => p.value === outlook.low)?.key ?? null;
  }, [series, outlook]);

  const estLabel = useMemo(() => {
    let min = null;
    (myRounds ?? []).forEach((r) => {
      const d = r?.tournamentDate;
      if (d && (min == null || String(d) < String(min))) min = d;
    });
    return min ? fmtMonthYr(min) : null;
  }, [myRounds]);

  // Net change over the last five qualifying rounds + per-round form strip.
  const last5 = useMemo(() => {
    if (series.length < 6) return null;
    const lastIdx = series.length - 1;
    const moves = [];
    for (let i = lastIdx - 4; i <= lastIdx; i += 1) {
      moves.push(Math.sign(round1(series[i].value - series[i - 1].value)));
    }
    return { net: round1(series[lastIdx].value - series[lastIdx - 5].value), moves };
  }, [series]);

  // Index now vs the index carried into 1 January; before any qualifying
  // round this year, fall back to a rolling 12 months.
  const yearFact = useMemo(() => {
    if (series.length < 2) return null;
    const last = series[series.length - 1];
    const jan1 = `${new Date().getFullYear()}-01-01`;
    const prev = [...series].reverse().find((p) => p.date && String(p.date) < jan1);
    const hasThisYear = series.some((p) => p.date && String(p.date) >= jan1);
    if (prev && hasThisYear) {
      return { label: 'This year', delta: round1(last.value - prev.value), from: prev.value };
    }
    const cutoff = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const base = [...series].reverse().find((p) => p.date && String(p.date) <= cutoff);
    if (base) {
      return { label: 'Last 12 months', delta: round1(last.value - base.value), from: base.value };
    }
    return null;
  }, [series]);

  const roundChart = useMemo(() => series.map((p) => ({
    value: p.value,
    label: fmtMonthYr(p.date),
    detail: [p.courseName, fmtDate(p.date)].filter(Boolean).join(' · '),
    isLow: lowKey != null && p.key === lowKey,
  })), [series, lowKey]);
  const monthChart = useMemo(() => monthly.map((m) => {
    const label = fmtMonthYr(`${m.ym}-15`);
    return {
      value: m.value,
      played: m.played,
      label,
      detail: m.played ? label : `${label} · no qualifying rounds`,
    };
  }), [monthly]);

  // Newest-first merged list: the included last-20 window, every excluded
  // round (so it can be re-added), and every ineligible round (so the
  // eligible/total counts are self-explanatory) — except unfinished partials,
  // which will never qualify and only add noise here.
  const rows = useMemo(() => {
    const merged = [
      ...result.differentials.map((d) => ({ ...d, type: 'included' })),
      ...result.excluded.map((d) => ({ ...d, type: 'excluded' })),
      ...result.ineligible
        .filter((d) => d.reason !== 'partial')
        .map((d) => ({ ...d, type: 'ineligible' })),
    ];
    return merged.sort((a, b) => (
      String(b.date ?? '').localeCompare(String(a.date ?? ''))
        || String(b.key ?? '').localeCompare(String(a.key ?? ''))
    ));
  }, [result]);
  const visibleRows = showAll ? rows : rows.slice(0, LEDGER_VISIBLE);

  // Profile writes clamp at 0 — the profile validator rejects plus (negative)
  // indexes. The plate still displays the true value.
  const applyValue = result.index == null ? null : Math.max(0, result.index);
  const isPlus = result.index != null && result.index < 0;

  const onApply = async () => {
    if (applyValue == null || applyState === 'saving') return;
    setApplyState('saving');
    try {
      await upsertProfile({ handicap: applyValue });
      setApplyState('done');
      onApplied?.(applyValue);
    } catch (_) {
      setApplyState('error');
    }
  };

  const toggleLabel = (d) => {
    const roundName = `${d.courseName ?? 'round'} ${fmtDate(d.date)}`.trim();
    return d.type === 'excluded'
      ? `Include ${roundName} in handicap`
      : `Exclude ${roundName} from handicap`;
  };

  // "▼ 0.5" in green / "▲ 0.2" in red / "— 0.0" muted; shape + color together.
  const deltaText = (delta, style) => (
    <Text style={[
      style,
      delta < 0 && { color: theme.accent.primary },
      delta > 0 && { color: theme.destructive },
      delta === 0 && { color: theme.text.muted },
    ]}
    >
      {delta < 0 ? `▼ ${fmt1(-delta)}` : delta > 0 ? `▲ ${fmt1(delta)}` : '— 0.0'}
    </Text>
  );

  const mvGlyph = (mv) => {
    if (mv == null) return null;
    if (mv < 0) return <Text style={[s.mv, { color: theme.accent.primary }]}>{'▼ '}</Text>;
    if (mv > 0) return <Text style={[s.mv, { color: theme.destructive }]}>{'▲ '}</Text>;
    return <Text style={[s.mv, { color: theme.text.muted }]}>{'— '}</Text>;
  };

  const infoBtn = onInfo ? (
    <TouchableOpacity
      onPress={() => onInfo('handicapIndex')}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel="What is Handicap Index"
    >
      <Feather name="info" size={14} color={theme.text.muted} />
    </TouchableOpacity>
  ) : null;

  const ledgerCard = rows.length > 0 ? (
    <SectionCard title="Score differentials" infoKey="handicapIndex" onInfo={onInfo}>
      <View style={s.lHead}>
        <Text style={[s.lHeadText, s.colDate]}>Date</Text>
        <Text style={[s.lHeadText, s.colCourse]}>Course</Text>
        <Text style={[s.lHeadText, s.colDiff]}>Diff</Text>
        <Text style={[s.lHeadText, s.colAfter]}>{'→ Index'}</Text>
        {onToggleExcluded ? <View style={s.colAct} /> : null}
      </View>
      {visibleRows.map((d) => {
        if (d.type === 'ineligible') {
          return (
            <View key={d.key} style={[s.lRow, s.lRowDim]}>
              <Text style={[s.lDate, s.colDate]}>{fmtDate(d.date)}</Text>
              <View style={s.colCourse}>
                <Text style={s.lCourseMuted} numberOfLines={1}>{d.courseName}</Text>
                <Text style={s.lWhy}>{`doesn’t qualify — ${reasonLabel(d)}`}</Text>
              </View>
              <Text style={[s.lDiff, s.colDiff]}>{'—'}</Text>
              <Text style={[s.lAfter, s.colAfter]}>{'—'}</Text>
              {onToggleExcluded ? <View style={s.colAct} /> : null}
            </View>
          );
        }
        if (d.type === 'excluded') {
          return (
            <View key={d.key} style={[s.lRow, s.lRowDim]}>
              <Text style={[s.lDate, s.colDate]}>{fmtDate(d.date)}</Text>
              <View style={s.colCourse}>
                <Text style={s.lCourseStruck} numberOfLines={1}>{d.courseName}</Text>
              </View>
              <Text style={[s.lDiff, s.colDiff]}>{fmt1(d.differential)}</Text>
              <View style={[s.colAfter, s.lReaddWrap]}>
                {onToggleExcluded ? (
                  <PressableScale
                    onPress={() => onToggleExcluded(d.key)}
                    activeScale={0.9}
                    accessibilityRole="button"
                    accessibilityLabel={toggleLabel(d)}
                    style={s.readd}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={s.readdText}>Re-add</Text>
                  </PressableScale>
                ) : <Text style={s.lAfter}>{'—'}</Text>}
              </View>
              {onToggleExcluded ? <View style={s.colAct} /> : null}
            </View>
          );
        }
        const walk = afterByKey.get(d.key);
        return (
          <View key={d.key} style={s.lRow}>
            <Text style={[s.lDate, s.colDate]}>{fmtDate(d.date)}</Text>
            <View style={s.colCourse}>
              <Text style={s.lCourse} numberOfLines={1}>{d.courseName}</Text>
              {d.key === lowKey && (
                <Text style={[s.lWhy, { color: goldText }]}>{'★ personal low'}</Text>
              )}
            </View>
            <View style={[s.colDiff, s.lDiffWrap]}>
              {d.counting && <View style={[s.goldDot, { backgroundColor: gold }]} />}
              <Text style={[s.lDiff, d.counting && s.lDiffCounting]}>{fmt1(d.differential)}</Text>
            </View>
            <Text style={[s.lAfter, s.colAfter]}>
              {walk ? (
                <>
                  {mvGlyph(walk.mv)}
                  <Text style={s.lAfterVal}>{fmt1(walk.after)}</Text>
                </>
              ) : '—'}
            </Text>
            {onToggleExcluded ? (
              <View style={s.colAct}>
                <PressableScale
                  onPress={() => onToggleExcluded(d.key)}
                  activeScale={0.9}
                  accessibilityRole="button"
                  accessibilityLabel={toggleLabel(d)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Feather name="check-circle" size={16} color={theme.text.muted} />
                </PressableScale>
              </View>
            ) : null}
          </View>
        );
      })}
      {rows.length > LEDGER_VISIBLE && !showAll && (
        <PressableScale onPress={() => setShowAll(true)} accessibilityRole="button">
          <Text style={s.moreText}>{`Show ${rows.length - LEDGER_VISIBLE} earlier rounds`}</Text>
        </PressableScale>
      )}
      <Text style={s.legend}>
        <Text style={{ color: gold }}>{'●'}</Text>
        {' gold — counts toward your index today'}
        {onToggleExcluded ? ' · struck — excluded' : ''}
      </Text>
    </SectionCard>
  ) : null;

  if (result.index == null) {
    const missing = Math.max(0, MIN_DIFFERENTIALS - result.windowCount);
    const emptyHero = (
      <View style={s.plate}>
        <View style={s.plateTitleWrap}>
          <Text style={s.emptyTitle}>Not enough qualifying rounds yet</Text>
          {infoBtn}
        </View>
        <Text style={s.note}>
          {`You need ${MIN_DIFFERENTIALS} qualifying rounds to calculate an index — ${missing} more to go. `}
          {'A round qualifies when it is a complete 18-hole round (no scrambles) on a tee with a slope and course rating.'}
        </Text>
        {result.excludedCount > 0 && (
          <Text style={s.note}>
            {`${result.excludedCount} excluded round${result.excludedCount === 1 ? ' is' : 's are'} not counted — add them back below.`}
          </Text>
        )}
      </View>
    );
    const emptyCards = [
      { key: 'hero', node: emptyHero },
      ledgerCard && { key: 'ledger', node: ledgerCard },
    ].filter(Boolean);
    return (
      <View style={s.wrap}>
        {emptyCards.map((card, i) => (
          <Reveal key={card.key} delay={i * 40}>{card.node}</Reveal>
        ))}
      </View>
    );
  }

  const lowNow = series.length > 0 && series[series.length - 1].value === outlook.low;
  const lastPosted = result.differentials.length > 0
    ? result.differentials[result.differentials.length - 1].differential
    : null;

  const plateCard = (
    <View style={s.plate}>
      <View style={s.plateTop}>
        <View style={s.plateTitleWrap}>
          <Text style={s.plateTitle}>Season Ledger</Text>
          {infoBtn}
        </View>
        <Text style={s.plateEst}>
          {estLabel
            ? `est. ${estLabel} · ${result.totalCount} rounds recorded`
            : `${result.totalCount} rounds recorded`}
        </Text>
      </View>

      <View style={s.plateMain}>
        <View style={s.plateIdx}>
          <Text style={s.plateVal}>{fmt1(result.index)}</Text>
          <View style={[s.goldRule, { backgroundColor: goldText }]} />
          <Text style={s.plateCap}>{`best ${result.usedCount} of last ${result.windowCount}`}</Text>
        </View>
        <View style={s.plateFacts}>
          <View style={s.pfact}>
            <Text style={s.pfactK}>Personal low</Text>
            <Text style={[s.pfactV, { color: goldText }]}>
              {`${fmt1(outlook.low)} · ${lowNow ? 'now' : fmtDateYr(outlook.lowDate)}`}
            </Text>
          </View>
          {last5 && (
            <View style={s.pfact}>
              <Text style={s.pfactK}>Last 5 rounds</Text>
              <Text style={s.pfactV}>
                <Text style={s.strip}>
                  {last5.moves.map((m, i) => (
                    <Text
                      key={`m-${i}`}
                      style={{ color: m < 0 ? theme.accent.primary : m > 0 ? theme.destructive : theme.text.muted }}
                    >
                      {m < 0 ? '▼' : m > 0 ? '▲' : '–'}
                    </Text>
                  ))}
                </Text>
                {'  '}
                {deltaText(last5.net, s.pfactV)}
              </Text>
            </View>
          )}
          {yearFact && (
            <View style={[s.pfact, s.pfactLast]}>
              <Text style={s.pfactK}>{yearFact.label}</Text>
              <Text style={s.pfactV}>
                {deltaText(yearFact.delta, s.pfactV)}
                <Text style={s.pfactFrom}>{` · from ${fmt1(yearFact.from)}`}</Text>
              </Text>
            </View>
          )}
        </View>
      </View>

      {isPlus && (
        <Text style={s.note}>A negative index means you play better than scratch.</Text>
      )}

      {series.length >= 2 && (
        <>
          <View style={s.chartRow}>
            <Text style={s.chartTitle}>Index history</Text>
            <View style={s.seg}>
              {[['round', 'By round'], ['month', 'By month']].map(([mode, label]) => {
                const on = chartMode === mode;
                return (
                  <PressableScale
                    key={mode}
                    onPress={() => setChartMode(mode)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[s.segBtn, on && s.segBtnOn]}
                  >
                    <Text style={[s.segText, on && s.segTextOn]}>{label}</Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>
          <IndexHistoryChart
            data={chartMode === 'round' ? roundChart : monthChart}
            mode={chartMode}
            lowLabel={lowNow ? null : `low ${fmt1(outlook.low)} · ${fmtDate(outlook.lowDate)}`}
          />
          <Text style={s.chartCap}>
            {chartMode === 'round'
              ? 'Recomputed after every qualifying round · oldest → newest'
              : 'End-of-month index · dashes bridge months without a qualifying round'}
          </Text>
        </>
      )}

      <PressableScale
        style={[s.applyBtn, applyState === 'saving' && s.applyBtnDisabled]}
        onPress={onApply}
        disabled={applyState === 'saving'}
        accessibilityRole="button"
      >
        <Text style={s.applyText}>
          {applyState === 'done'
            ? 'Saved to profile ✓'
            : `Set ${fmt1(applyValue)} as my handicap`}
        </Text>
      </PressableScale>
      {applyState === 'error' && (
        <Text style={s.errorText}>{'Could not save — try again.'}</Text>
      )}
      <Text style={s.profileNote}>
        {profileHandicap != null
          ? `Profile today: ${profileHandicap} — saving updates it to ${fmt1(applyValue)}`
          : 'No handicap on your profile yet.'}
      </Text>
    </View>
  );

  const nextFacts = [];
  if (outlook.dropThreshold != null) {
    nextFacts.push({
      key: 'drop',
      icon: 'target',
      text: (
        <Text style={s.factText}>
          {'Beat a differential of '}
          <Text style={s.factStrong}>{fmt1(outlook.dropThreshold)}</Text>
          {' and your index drops'}
          {outlook.dropGross != null
            ? (
              <>
                {' — that’s about '}
                <Text style={s.factStrong}>{`${outlook.dropGross} gross`}</Text>
                {` at ${outlook.dropCourse}`}
              </>
            )
            : null}
          .
        </Text>
      ),
    });
  }
  if (outlook.newLowReachable && outlook.newLowThreshold != null) {
    nextFacts.push({
      key: 'low',
      icon: 'flag',
      text: (
        <Text style={s.factText}>
          {'A '}
          <Text style={s.factStrong}>{`${fmt1(outlook.newLowThreshold)} or better`}</Text>
          {' sets a new personal low: '}
          <Text style={[s.factStrong, { color: theme.accent.primary }]}>{fmt1(outlook.newLowIndex)}</Text>
          {'.'}
          {lastPosted != null && lastPosted <= outlook.newLowThreshold
            ? ` You posted ${fmt1(lastPosted)} last time.`
            : ''}
        </Text>
      ),
    });
  }
  if (!outlook.canRise) {
    nextFacts.push({
      key: 'safe',
      icon: 'shield',
      text: (
        <Text style={s.factText}>
          {'No downside this week — a bad round '}
          <Text style={s.factStrong}>{'can’t raise'}</Text>
          {' your index.'}
        </Text>
      ),
    });
  } else if (outlook.riseAt != null) {
    nextFacts.push({
      key: 'risk',
      icon: 'shield',
      text: (
        <Text style={s.factText}>
          {outlook.leaving?.counting
            ? `Your ${fmt1(outlook.leaving.differential)} at ${outlook.leaving.courseName} leaves the 20-round window — at `
            : 'At '}
          <Text style={s.factStrong}>{`${fmt1(outlook.riseAt)} or worse`}</Text>
          {' your index rises, to '}
          <Text style={s.factStrong}>{fmt1(outlook.worstCase)}</Text>
          {' at worst.'}
        </Text>
      ),
    });
  }

  const nextCard = nextFacts.length > 0 ? (
    <SectionCard title="Your next round" titleVariant="heading">
      {nextFacts.map((f) => (
        <View key={f.key} style={s.fact}>
          <View style={s.factIcon}>
            <Feather name={f.icon} size={16} color={theme.accent.primary} />
          </View>
          {f.text}
        </View>
      ))}
    </SectionCard>
  ) : null;

  const cards = [
    { key: 'plate', node: plateCard },
    nextCard && { key: 'next', node: nextCard },
    ledgerCard && { key: 'ledger', node: ledgerCard },
  ].filter(Boolean);

  return (
    <View style={s.wrap}>
      {cards.map((card, i) => (
        <Reveal key={card.key} delay={i * 40}>{card.node}</Reveal>
      ))}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },

    // ---- Season Ledger plate ----
    plate: {
      backgroundColor: theme.bg.card,
      borderWidth: 1,
      borderColor: theme.border.default,
      borderRadius: 16,
      padding: theme.spacing.lg,
    },
    plateTop: {
      flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
      borderBottomWidth: 1, borderBottomColor: theme.border.default,
      paddingBottom: theme.spacing.sm + 2,
    },
    plateTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    plateTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 16, color: theme.text.primary },
    plateEst: { fontSize: 10.5, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary },
    plateMain: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      gap: theme.spacing.lg, paddingTop: theme.spacing.md + 2,
    },
    plateIdx: { flexShrink: 0 },
    plateVal: {
      fontFamily: 'PlayfairDisplay-Black', fontSize: 54, lineHeight: 58,
      color: theme.text.primary, fontVariant: ['tabular-nums'],
    },
    goldRule: { height: 2, opacity: 0.85, marginTop: theme.spacing.sm },
    plateCap: { fontSize: 10.5, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, marginTop: theme.spacing.xs + 2 },
    // Right-anchored and width-capped: on wide screens the facts hug the
    // card's right edge instead of stretching their labels toward the numeral.
    plateFacts: { flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: 340 },
    pfact: {
      flexDirection: 'row', alignItems: 'baseline', justifyContent: 'flex-end', gap: 10,
      paddingVertical: 7,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.default,
    },
    pfactLast: { borderBottomWidth: 0 },
    pfactK: { fontSize: 10.5, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary },
    pfactV: {
      fontSize: 13, fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary,
      fontVariant: ['tabular-nums'],
    },
    pfactFrom: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12 },
    strip: { fontSize: 9, letterSpacing: 2 },

    // ---- chart ----
    chartRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginTop: theme.spacing.lg, marginBottom: theme.spacing.md,
    },
    chartTitle: { fontSize: 12.5, fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary },
    seg: {
      flexDirection: 'row', backgroundColor: theme.bg.secondary,
      borderRadius: theme.radius.full, padding: 3,
    },
    segBtn: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: theme.radius.full },
    segBtnOn: { backgroundColor: theme.accent.primary },
    segText: { fontSize: 11, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary },
    segTextOn: { color: theme.text.inverse },
    chartCap: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '600', marginTop: theme.spacing.xs + 2 },

    // ---- apply ----
    applyBtn: {
      marginTop: theme.spacing.lg, paddingVertical: theme.spacing.sm + 2,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary,
      alignItems: 'center',
    },
    applyBtnDisabled: { opacity: 0.6 },
    applyText: { fontSize: 14, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse },
    errorText: { fontSize: 12, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, textAlign: 'center', marginTop: theme.spacing.xs },
    profileNote: { fontSize: 10.5, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, textAlign: 'center', marginTop: theme.spacing.sm },
    note: { fontSize: 12, lineHeight: 17, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, marginTop: theme.spacing.xs },
    emptyTitle: { fontSize: 15, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary },

    // ---- next round ----
    fact: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md, marginTop: theme.spacing.xs },
    factIcon: {
      width: 34, height: 34, borderRadius: theme.radius.md,
      backgroundColor: theme.accent.light, alignItems: 'center', justifyContent: 'center',
    },
    factText: { flex: 1, ...theme.typography.body, color: theme.text.primary },
    factStrong: { fontFamily: 'PlusJakartaSans-ExtraBold' },

    // ---- ledger ----
    lHead: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingBottom: 6, marginTop: theme.spacing.xs,
      borderBottomWidth: 1, borderBottomColor: theme.border.default,
    },
    lHeadText: {
      fontSize: 9.5, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1,
      textTransform: 'uppercase', color: theme.text.muted,
    },
    colDate: { width: 46 },
    colCourse: { flex: 1, minWidth: 0 },
    colDiff: { width: 52, textAlign: 'right' },
    colAfter: { width: 66, textAlign: 'right' },
    colAct: { width: 24, alignItems: 'flex-end' },
    lRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingVertical: theme.spacing.sm + 1,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.subtle,
    },
    lRowDim: { opacity: 0.55 },
    lDate: { fontSize: 10.5, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontVariant: ['tabular-nums'] },
    lCourse: { fontSize: 13, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary },
    lCourseMuted: { fontSize: 13, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted },
    lCourseStruck: {
      fontSize: 13, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted,
      textDecorationLine: 'line-through',
    },
    lWhy: { fontSize: 10, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted },
    lDiffWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
    goldDot: { width: 6, height: 6, borderRadius: 3 },
    lDiff: {
      fontSize: 13, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary,
      fontVariant: ['tabular-nums'],
    },
    lDiffCounting: { color: theme.text.primary },
    lAfter: { fontSize: 12, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontVariant: ['tabular-nums'] },
    lAfterVal: { color: theme.text.primary, fontSize: 12.5 },
    lReaddWrap: { alignItems: 'flex-end' },
    readd: {
      borderWidth: 1, borderColor: theme.border.default, borderRadius: theme.radius.full,
      paddingVertical: 3, paddingHorizontal: 9,
    },
    readdText: { fontSize: 10.5, fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary },
    mv: { fontSize: 10, fontFamily: 'PlusJakartaSans-ExtraBold' },
    moreText: {
      textAlign: 'center', paddingTop: theme.spacing.md, paddingBottom: theme.spacing.xs,
      fontSize: 12, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary,
    },
    legend: {
      textAlign: 'center', marginTop: theme.spacing.sm,
      fontSize: 10, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted,
    },
  });
}

export default React.memo(HandicapTab);
