import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatNumber, formatDate } from '../../i18n';
import { msg as makeMsg } from '../../store/statsMsg';
import { issueMsg, causePair } from '../../store/coachCausePair';
import PressableScale from '../ui/PressableScale';
import SectionCard from './SectionCard';
import { GoldBadge, DoRow, CausePair } from './CoachBits';
import WhySheet from './WhySheet';
import { renderMsg } from './msg';
import { useAppSettings } from '../../hooks/useAppSettings';

const areaMsg = (category) => makeMsg(`stats.my.coach.plan.area.${category}`);

// The verdict card (design B, "a verdict, not a rail"): the issue as a headline,
// what it costs, two bars that show it, the one drill to start with and a row
// that opens the reasoning. `week` is store/coachWeek.js buildCoachWeek's
// result; `diagnosis` is stats.coachDiagnosis, read for the states that have
// no chain yet.
export default function DiagnosisCard({
  week, diagnosis, roundCount = 0, focusActive = false, onCommitFocus, onInfo,
  swingSupport = { supported: false, reason: 'web' }, onRecordSwing, onOpenSwing,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [whyOpen, setWhyOpen] = useState(false);
  const { missReasons } = useAppSettings();
  if (!week) return null;
  const { kind, chains, untracked } = week;
  const hasChain = chains.length > 0;
  const tie = kind === 'tie';
  const cardTitle = t('stats.my.coach.ui.diag.title');

  const focusButton = (chain, outline) => {
    const { leak, causes, swingLink } = chain;
    const label = outline
      ? t('stats.my.coach.ui.focus.tie', { area: renderMsg(areaMsg(leak.category)) })
      : t('stats.my.coach.hero.makeFocus');
    return (
      <PressableScale
        key={leak.id}
        onPress={() => onCommitFocus({
          leak,
          bucket: leak.bucket ?? undefined,
          cause: causes?.primary ?? undefined,
          swingId: swingLink?.state === 'linked' ? swingLink.swing?.id : undefined,
        })}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[s.focusBtn, outline && s.focusBtnOutline]}
      >
        <Feather name="target" size={14} color={outline ? theme.accent.primary : theme.text.inverse} />
        <Text style={[s.focusBtnText, outline && s.focusBtnTextOutline]}>{label}</Text>
      </PressableScale>
    );
  };

  const canCommit = !focusActive && !!onCommitFocus;
  const whyLabel = t('stats.my.coach.ui.step.why');
  const whyRow = (
    <PressableScale
      onPress={() => setWhyOpen(true)}
      accessibilityRole="button"
      accessibilityLabel={whyLabel}
      style={s.whyRow}
      testID="why-row"
    >
      <Feather name="info" size={14} color={theme.text.muted} />
      <Text style={s.whyText}>{whyLabel}</Text>
      <Feather name="chevron-right" size={14} color={theme.text.muted} />
    </PressableScale>
  );
  const stat = (leak) => (
    <View style={s.statRow}>
      <Text style={s.stat}>{formatNumber(leak.strokesPerRound, { decimals: 1 })}</Text>
      <Text style={s.statUnit}>{t('stats.my.coach.ui.stat.perRound')}</Text>
    </View>
  );
  // Nudge to tag misses while the diagnosis still reads the outcomes only; moot
  // once the golfer has switched miss reasons off.
  const coverage = (chain) => (chain.coverage && missReasons !== 'off' ? (
    <Text style={s.coverage} testID="coverage-hint">
      {t('stats.my.coach.ui.coverage', { tagged: chain.coverage.tagged, needed: chain.coverage.needed })}
    </Text>
  ) : null);
  const doRow = (chain) => {
    const drill = chain.drills.find((d) => d.source !== 'swing') ?? chain.drills[0];
    return drill ? <DoRow drill={drill} /> : null;
  };

  if (hasChain) {
    const badge = kind === 'focus' ? t('stats.my.coach.ui.badge.focus') : t('stats.my.coach.group.fixFirst');
    const [chain] = chains;
    return (
      <SectionCard
        title={cardTitle}
        infoKey="coachDiagnosis"
        onInfo={onInfo}
        right={<GoldBadge label={badge} testID="diagnosis-badge" />}
        testID="diagnosis-card"
      >
        {tie ? (
          <>
            <Text style={s.headline}>{t('stats.my.coach.ui.tie.title')}</Text>
            {chains.map((c, i) => (
              <View key={c.leak.id} style={s.tieBlock} testID={`diagnosis-chain-${i + 1}`}>
                <Text style={s.issue}>{renderMsg(issueMsg(c.leak, c.causes?.primary))}</Text>
                {stat(c.leak)}
                {coverage(c)}
                {doRow(c)}
              </View>
            ))}
            {whyRow}
            {canCommit ? <View style={s.btnRow}>{chains.map((c) => focusButton(c, true))}</View> : null}
          </>
        ) : (
          <>
            <Text style={s.headline}>{renderMsg(issueMsg(chain.leak, chain.causes?.primary))}</Text>
            {stat(chain.leak)}
            <CausePair pair={causePair({ cause: chain.causes?.primary, check: chain.check, isFocus: chain.isFocus })} />
            {coverage(chain)}
            <SwingRow link={chain.swingLink} s={s} t={t} theme={theme} onOpenSwing={onOpenSwing} />
            <View style={s.rule} />
            {doRow(chain)}
            {whyRow}
            {canCommit ? <View style={s.btnRow}>{focusButton(chain, false)}</View> : null}
          </>
        )}
        <WhySheet
          visible={whyOpen}
          onClose={() => setWhyOpen(false)}
          week={week}
          untracked={untracked}
          showExplain={canCommit}
          swingSupport={swingSupport}
          onRecordSwing={onRecordSwing}
          onOpenSwing={onOpenSwing}
          onInfo={onInfo}
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard title={cardTitle} infoKey="coachDiagnosis" onInfo={onInfo} testID="diagnosis-card">
      <Empty kind={kind} diagnosis={diagnosis} roundCount={roundCount} s={s} t={t} />
    </SectionCard>
  );
}

// "Swing: Over the top · driver, 4 Oct · Open": only when a recent swing shows
// the fault behind this leak. Every other state (record one, too old, wrong
// club, web) lives in the sheet.
function SwingRow({ link, s, t, theme, onOpenSwing }) {
  if (link?.state !== 'linked' || !link.fault) return null;
  const text = t('stats.my.coach.ui.swing.line', {
    fault: renderMsg(makeMsg(`swing.fault.${link.fault}`)),
    club: renderMsg(makeMsg(`swing.club.${link.swing.club}`)).toLowerCase(),
    date: formatDate(String(link.swing.createdAt).slice(0, 10), 'day'),
  });
  return (
    <View style={s.swingRow} testID="swing-row">
      <Feather name="video" size={14} color={theme.text.muted} />
      <Text style={s.swingText}>{text}</Text>
      {link.swing.id && onOpenSwing ? (
        <PressableScale
          onPress={() => onOpenSwing(link.swing.id)}
          accessibilityRole="button"
          accessibilityLabel={t('stats.my.coach.ui.swing.open')}
          style={s.swingOpen}
        >
          <Text style={s.swingOpenText}>{t('stats.my.coach.ui.swing.openShort')}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

function Empty({ kind, diagnosis, roundCount, s, t }) {
  if (kind === 'few') {
    return (
      <>
        <Text style={s.headline}>{t('stats.my.coach.ui.few.title')}</Text>
        {(diagnosis?.insufficient ?? []).map((c) => {
          const needs = t('stats.my.coach.ui.few.needs', {
            what: [
              c.needs?.rounds > 0 ? t('stats.my.coach.ui.few.moreRounds', { count: c.needs.rounds }) : null,
              c.needs?.holes > 0 ? t('stats.my.coach.ui.few.moreHoles', { count: c.needs.holes }) : null,
            ].filter(Boolean).join(', '),
          });
          return (
            <View key={c.id} style={s.fewRow} testID={`insufficient-${c.category}`}>
              <Text style={s.fewArea}>{renderMsg(areaMsg(c.category))}</Text>
              <Text style={s.fewNeeds}>{needs}</Text>
            </View>
          );
        })}
        <Text style={s.reason}>{t('stats.my.coach.ui.few.log')}</Text>
      </>
    );
  }
  if (kind === 'noDetail') {
    return (
      <>
        <Text style={s.headline}>{t('stats.my.coach.ui.nodetail.title')}</Text>
        <Text style={s.reason}>{t('stats.my.coach.ui.nodetail.leak', { rounds: t('stats.my.count.rounds', { count: roundCount }) })}</Text>
        <Text style={s.reason}>{t('stats.my.coach.ui.nodetail.fix')}</Text>
      </>
    );
  }
  if (kind === 'candidate' && diagnosis?.candidate) {
    const c = diagnosis.candidate;
    return (
      <>
        <Text style={s.headline}>{t('stats.my.coach.ui.candidate.title')}</Text>
        <Text style={s.reason}>{t('stats.my.coach.ui.candidate.leak', {
          area: renderMsg(areaMsg(c.category)),
          strokes: formatNumber(Math.abs(c.strokesPerRound), { decimals: 1 }),
          holes: t('stats.my.count.holes', { count: c.sample.holes }),
        })}</Text>
      </>
    );
  }
  return (
    <>
      <Text style={s.headline}>{t('stats.my.coach.ui.noLeak.title')}</Text>
      <Text style={s.reason}>{t('stats.my.coach.ui.noLeak.leak')}</Text>
    </>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    headline: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 28, color: theme.text.primary },
    issue: { ...theme.typography.heading, color: theme.text.primary },
    reason: { ...theme.typography.subhead, color: theme.text.secondary },
    statRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
    stat: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 17, lineHeight: 22, color: theme.text.primary },
    statUnit: { ...theme.typography.subhead, color: theme.text.secondary },
    tieBlock: {
      gap: theme.spacing.xs,
      paddingTop: theme.spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.default,
    },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border.default },
    coverage: { ...theme.typography.caption, color: theme.text.secondary },
    swingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
    swingText: { ...theme.typography.subhead, flex: 1, minWidth: 0, color: theme.text.secondary },
    swingOpen: { minHeight: 44, justifyContent: 'center' },
    swingOpenText: { ...theme.typography.caption, color: theme.info, fontWeight: '800' },
    whyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
    whyText: { ...theme.typography.subhead, flex: 1, color: theme.text.secondary, fontWeight: '700' },
    fewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, minHeight: 36 },
    fewArea: { ...theme.typography.subhead, color: theme.text.primary, fontWeight: '800' },
    fewNeeds: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
    btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    focusBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44,
      paddingHorizontal: 14, borderRadius: 999, backgroundColor: theme.accent.primary,
    },
    focusBtnOutline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: theme.accent.primary },
    focusBtnText: { fontSize: 12.5, fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse },
    focusBtnTextOutline: { color: theme.accent.primary },
  });
}
