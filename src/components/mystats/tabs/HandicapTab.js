import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeContext';
import { useT, getLanguage, formatNumber, formatDate } from '../../../i18n';
import PressableScale from '../../ui/PressableScale';
import Reveal from '../../ui/Reveal';
import SectionCard from '../SectionCard';
import IndexHistoryChart from '../IndexHistoryChart';
import {
  computeHandicapIndex, handicapIndexSeries, monthlyIndexSeries, nextRoundOutlook,
  MIN_DIFFERENTIALS,
} from '../../../store/handicapIndex';
import { upsertProfile } from '../../../store/profileStore';

// "12 May" / "12 may" — short date for a ledger row.
function fmtDate(iso, lang) {
  if (!iso) return '';
  return formatDate(iso, 'day', lang);
}

// "9 May ’26" — date with year, for the personal-low fact.
function fmtDateYr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatDate(iso, 'day')} ’${String(d.getFullYear()).slice(-2)}`;
}

// "Apr ’25" — month labels for the chart axis and the plate header.
function fmtMonthYr(iso, lang) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const month = formatDate(iso, 'day', lang).split(' ').pop();
  return `${month} ’${String(d.getFullYear()).slice(-2)}`;
}

const fmt1 = (n) => formatNumber(n, { decimals: 1 });
const round1 = (n) => Math.round(n * 10) / 10;

// Renders a whole translated sentence with **bold** and ^^accent bold^^ runs,
// so the emphasis stays inside one catalogue string per sentence.
function rich(text, strongStyle, accentStyle) {
  return text.split(/(\*\*.+?\*\*|\^\^.+?\^\^)/).filter(Boolean).map((part, i) => {
    if (part.startsWith('**')) return <Text key={i} style={strongStyle}>{part.slice(2, -2)}</Text>;
    if (part.startsWith('^^')) return <Text key={i} style={[strongStyle, accentStyle]}>{part.slice(2, -2)}</Text>;
    return part;
  });
}

const LEDGER_VISIBLE = 12;

// Memoised — see the note in CoachTab.
function HandicapTab({
  myRounds, profileHandicap, onInfo, onApplied, excludedKeys, onToggleExcluded, readOnly = false,
}) {
  const t = useT();
  const lang = getLanguage(); // memo key for the date labels below
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
    return min ? fmtMonthYr(min, lang) : null;
  }, [myRounds, lang]);

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
      return { labelKey: 'stats.tab.handicap.thisYear', delta: round1(last.value - prev.value), from: prev.value };
    }
    const cutoff = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const base = [...series].reverse().find((p) => p.date && String(p.date) <= cutoff);
    if (base) {
      return { labelKey: 'stats.tab.handicap.last12Months', delta: round1(last.value - base.value), from: base.value };
    }
    return null;
  }, [series]);

  const roundChart = useMemo(() => series.map((p) => ({
    value: p.value,
    label: fmtMonthYr(p.date, lang),
    detail: [p.courseName, fmtDate(p.date, lang)].filter(Boolean).join(' · '),
    isLow: lowKey != null && p.key === lowKey,
  })), [series, lowKey, lang]);
  const monthChart = useMemo(() => monthly.map((m) => {
    const label = fmtMonthYr(`${m.ym}-15`, lang);
    return {
      value: m.value,
      played: m.played,
      label,
      detail: m.played ? label : t('stats.tab.handicap.noQualifying', { label }),
    };
  }), [monthly, t, lang]);

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
    const roundName = `${d.courseName ?? t('stats.tab.handicap.roundWord')} ${fmtDate(d.date)}`.trim();
    return d.type === 'excluded'
      ? t('stats.tab.handicap.include', { name: roundName })
      : t('stats.tab.handicap.exclude', { name: roundName });
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
      {delta < 0 ? `▼ ${fmt1(-delta)}` : delta > 0 ? `▲ ${fmt1(delta)}` : `— ${fmt1(0)}`}
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
      accessibilityLabel={t('stats.tab.handicap.whatIsIndex')}
    >
      <Feather name="info" size={14} color={theme.text.muted} />
    </TouchableOpacity>
  ) : null;

  const ledgerCard = rows.length > 0 ? (
    <SectionCard title={t('stats.tab.handicap.differentials')} infoKey="handicapIndex" onInfo={onInfo}>
      <View style={s.lHead}>
        <Text style={[s.lHeadText, s.colDate]}>{t('stats.tab.handicap.colDate')}</Text>
        <Text style={[s.lHeadText, s.colCourse]}>{t('stats.tab.handicap.colCourse')}</Text>
        <Text style={[s.lHeadText, s.colDiff]}>{t('stats.tab.handicap.colDiff')}</Text>
        <Text style={[s.lHeadText, s.colAfter]}>{t('stats.tab.handicap.colIndex')}</Text>
        {onToggleExcluded ? <View style={s.colAct} /> : null}
      </View>
      {visibleRows.map((d) => {
        if (d.type === 'ineligible') {
          return (
            <View key={d.key} style={[s.lRow, s.lRowDim]}>
              <Text style={[s.lDate, s.colDate]}>{fmtDate(d.date)}</Text>
              <View style={s.colCourse}>
                <Text style={s.lCourseMuted} numberOfLines={1}>{d.courseName}</Text>
                <Text style={s.lWhy}>{d.reason === 'nine-holes' ? t('stats.tab.handicap.notQualifyNine') : t('stats.tab.handicap.notQualifyRating')}</Text>
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
                    <Text style={s.readdText}>{t('stats.tab.handicap.readd')}</Text>
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
                <Text style={[s.lWhy, { color: goldText }]}>{t('stats.tab.handicap.personalLowFlag')}</Text>
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
          <Text style={s.moreText}>{t('stats.tab.handicap.showEarlier', { count: rows.length - LEDGER_VISIBLE })}</Text>
        </PressableScale>
      )}
      <Text style={s.legend}>
        <Text style={{ color: gold }}>{'●'}</Text>
        {` ${onToggleExcluded ? t('stats.tab.handicap.legendExcluded') : t('stats.tab.handicap.legend')}`}
      </Text>
    </SectionCard>
  ) : null;

  if (result.index == null) {
    const missing = Math.max(0, MIN_DIFFERENTIALS - result.windowCount);
    const emptyHero = (
      <View style={s.plate}>
        <View style={s.plateTitleWrap}>
          <Text style={s.emptyTitle}>{t('stats.tab.handicap.notEnough')}</Text>
          {infoBtn}
        </View>
        <Text style={s.note}>
          {`${t('stats.tab.handicap.needRounds', { min: MIN_DIFFERENTIALS, missing })} ${t('stats.tab.handicap.qualifyRule')}`}
        </Text>
        {result.excludedCount > 0 && (
          <Text style={s.note}>
            {t('stats.tab.handicap.excludedNotCounted', { count: result.excludedCount })}
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
          <Text style={s.plateTitle}>{t('stats.tab.handicap.seasonLedger')}</Text>
          {infoBtn}
        </View>
        <Text style={s.plateEst}>
          {estLabel
            ? t('stats.tab.handicap.estRecorded', { est: estLabel, count: result.totalCount })
            : t('stats.tab.handicap.recorded', { count: result.totalCount })}
        </Text>
      </View>

      <View style={s.plateMain}>
        <View style={s.plateIdx}>
          <Text style={s.plateVal}>{fmt1(result.index)}</Text>
          <View style={[s.goldRule, { backgroundColor: goldText }]} />
          <Text style={s.plateCap}>{t('stats.tab.handicap.bestOfLast', { used: result.usedCount, window: result.windowCount })}</Text>
        </View>
        <View style={s.plateFacts}>
          <View style={s.pfact}>
            <Text style={s.pfactK}>{t('stats.tab.handicap.personalLow')}</Text>
            <Text style={[s.pfactV, { color: goldText }]}>
              {lowNow
                ? t('stats.tab.handicap.lowNow', { value: fmt1(outlook.low) })
                : `${fmt1(outlook.low)} · ${fmtDateYr(outlook.lowDate)}`}
            </Text>
          </View>
          {last5 && (
            <View style={s.pfact}>
              <Text style={s.pfactK}>{t('stats.tab.handicap.last5')}</Text>
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
              <Text style={s.pfactK}>{t(yearFact.labelKey)}</Text>
              <Text style={s.pfactV}>
                {deltaText(yearFact.delta, s.pfactV)}
                <Text style={s.pfactFrom}>{` · ${t('stats.tab.handicap.from', { value: fmt1(yearFact.from) })}`}</Text>
              </Text>
            </View>
          )}
        </View>
      </View>

      {isPlus && (
        <Text style={s.note}>{t('stats.tab.handicap.plusNote')}</Text>
      )}

      {series.length >= 2 && (
        <>
          <View style={s.chartRow}>
            <Text style={s.chartTitle}>{t('stats.tab.handicap.indexHistory')}</Text>
            <View style={s.seg}>
              {[['round', t('stats.tab.handicap.byRound')], ['month', t('stats.tab.handicap.byMonth')]].map(([mode, label]) => {
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
            lowLabel={lowNow ? null : t('stats.tab.handicap.lowLabel', { value: fmt1(outlook.low), date: fmtDate(outlook.lowDate) })}
          />
          <Text style={s.chartCap}>
            {chartMode === 'round'
              ? t('stats.tab.handicap.chartCapRound')
              : t('stats.tab.handicap.chartCapMonth')}
          </Text>
        </>
      )}

      {!readOnly && (
        <>
          <PressableScale
            style={[s.applyBtn, applyState === 'saving' && s.applyBtnDisabled]}
            onPress={onApply}
            disabled={applyState === 'saving'}
            accessibilityRole="button"
          >
            <Text style={s.applyText}>
              {applyState === 'done'
                ? t('stats.tab.handicap.savedToProfile')
                : t('stats.tab.handicap.setAsMine', { value: fmt1(applyValue) })}
            </Text>
          </PressableScale>
          {applyState === 'error' && (
            <Text style={s.errorText}>{t('stats.tab.handicap.saveFailed')}</Text>
          )}
          <Text style={s.profileNote}>
            {profileHandicap != null
              ? t('stats.tab.handicap.profileToday', { current: formatNumber(profileHandicap), next: fmt1(applyValue) })
              : t('stats.tab.handicap.noProfileHandicap')}
          </Text>
        </>
      )}
    </View>
  );

  const nextFacts = [];
  if (outlook.dropThreshold != null) {
    nextFacts.push({
      key: 'drop',
      icon: 'target',
      text: (
        <Text style={s.factText}>
          {rich(
            outlook.dropGross != null
              ? t('stats.tab.handicap.dropGross', {
                value: fmt1(outlook.dropThreshold), gross: outlook.dropGross, course: outlook.dropCourse,
              })
              : t('stats.tab.handicap.drop', { value: fmt1(outlook.dropThreshold) }),
            s.factStrong,
          )}
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
          {rich(
            t('stats.tab.handicap.newLow', { value: fmt1(outlook.newLowThreshold), index: fmt1(outlook.newLowIndex) }),
            s.factStrong,
            { color: theme.accent.primary },
          )}
          {lastPosted != null && lastPosted <= outlook.newLowThreshold
            ? ` ${t('stats.tab.handicap.posted', { value: fmt1(lastPosted) })}`
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
          {rich(t('stats.tab.handicap.safe'), s.factStrong)}
        </Text>
      ),
    });
  } else if (outlook.riseAt != null) {
    nextFacts.push({
      key: 'risk',
      icon: 'shield',
      text: (
        <Text style={s.factText}>
          {rich(
            outlook.leaving?.counting
              ? t('stats.tab.handicap.riskLeaving', {
                diff: fmt1(outlook.leaving.differential),
                course: outlook.leaving.courseName,
                riseAt: fmt1(outlook.riseAt),
                worst: fmt1(outlook.worstCase),
              })
              : t('stats.tab.handicap.risk', { riseAt: fmt1(outlook.riseAt), worst: fmt1(outlook.worstCase) }),
            s.factStrong,
          )}
        </Text>
      ),
    });
  }

  const nextCard = nextFacts.length > 0 && !readOnly ? (
    <SectionCard title={t('stats.tab.handicap.nextRound')} titleVariant="heading">
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
