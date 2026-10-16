import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatNumber } from '../../i18n';
import { msg as makeMsg } from '../../store/statsMsg';
import PressableScale from '../ui/PressableScale';
import SectionCard from './SectionCard';
import { GoldBadge, EvidenceChip, DrillLine } from './CoachBits';
import { formatConfidence } from './CoachInsightRow';
import { renderMsg, renderDatedMsg, metricValueText, msgText } from './msg';

const MIN_ROUNDS = 3;
const MIN_HOLES = 10;
const FIX_DRILLS_SHOWN = 3;
const areaMsg = (category) => makeMsg(`stats.my.coach.plan.area.${category}`);

// The Leak → Why → Fix → Check rail for the top leak (design B, spec §6/§12).
// `week` is store/coachWeek.js buildCoachWeek's result; `diagnosis` is
// stats.coachDiagnosis, read for the states that have no chain yet.
export default function DiagnosisCard({
  week, diagnosis, roundCount = 0, focusActive = false, onCommitFocus, onInfo,
  swingSupport = { supported: false, reason: 'web' }, onRecordSwing, onOpenSwing,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!week) return null;
  const { kind, chains } = week;
  const hasChain = chains.length > 0;
  const tie = kind === 'tie';
  const cardTitle = t('stats.my.coach.ui.diag.title');

  const chainProps = { s, theme, t, swingSupport, onRecordSwing, onOpenSwing, onInfo };
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

  if (hasChain) {
    const badge = kind === 'focus' ? t('stats.my.coach.ui.badge.focus') : t('stats.my.coach.group.fixFirst');
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
            <Text style={s.title}>{t('stats.my.coach.ui.tie.title')}</Text>
            <Text style={s.reason}>{t('stats.my.coach.ui.tie.reason', {
              a: renderMsg(areaMsg(chains[0].leak.category)),
              sa: formatNumber(Math.abs(chains[0].leak.strokesPerRound), { decimals: 1 }),
              b: renderMsg(areaMsg(chains[1].leak.category)),
              sb: formatNumber(Math.abs(chains[1].leak.strokesPerRound), { decimals: 1 }),
            })}</Text>
            {chains.map((chain, i) => (
              <View key={chain.leak.id} style={s.tieBlock} testID={`diagnosis-chain-${i + 1}`}>
                <Text style={s.kicker}>{t('stats.my.coach.ui.tie.leak', { n: i + 1, area: renderMsg(areaMsg(chain.leak.category)) })}</Text>
                <Chain chain={chain} {...chainProps} />
              </View>
            ))}
            {!focusActive && onCommitFocus ? <View style={s.btnRow}>{chains.map((c) => focusButton(c, true))}</View> : null}
          </>
        ) : (
          <>
            <Text style={s.kicker}>{kickerText(t, chains[0].leak)}</Text>
            <Chain chain={chains[0]} {...chainProps} />
            {!focusActive && onCommitFocus ? <View style={s.btnRow}>{focusButton(chains[0], false)}</View> : null}
          </>
        )}
      </SectionCard>
    );
  }

  return (
    <SectionCard title={cardTitle} infoKey="coachDiagnosis" onInfo={onInfo} testID="diagnosis-card">
      <Empty kind={kind} diagnosis={diagnosis} roundCount={roundCount} s={s} t={t} />
    </SectionCard>
  );
}

function kickerText(t, leak) {
  const area = renderMsg(areaMsg(leak.category));
  return leak.bucket
    ? t('stats.my.coach.ui.kicker.bucket', { area, bucket: leak.bucket })
    : t('stats.my.coach.ui.kicker', { area });
}

function Step({ s, label, children, last }) {
  return (
    <View style={s.step}>
      <View style={s.rail}>
        <View style={s.dot} />
        {last ? null : <View style={s.line} />}
      </View>
      <View style={s.stepBody}>
        <Text style={s.stepKey}>{label}</Text>
        {children}
      </View>
    </View>
  );
}

function Chain({ chain, s, t, swingSupport, onRecordSwing, onOpenSwing, onInfo }) {
  const { leak, causes, swingLink, check, drills, courseTask, tip, isFocus } = chain;
  // At most 3 drills; the swing drill keeps its seat (it is the link to the recording).
  const swingDrills = drills.filter((d) => d.source === 'swing').slice(0, 1);
  const shownDrills = [...drills.filter((d) => d.source !== 'swing').slice(0, FIX_DRILLS_SHOWN - swingDrills.length), ...swingDrills];
  const hcp = leak.benchmark?.targetHandicap;
  const area = renderMsg(areaMsg(leak.category));
  const vs = hcp > 0 ? t('stats.my.coach.ui.vs.target', { hcp: formatNumber(hcp) }) : t('stats.my.coach.ui.vs.scratch');
  const symptom = t(leak.bucket ? 'stats.my.coach.ui.symptom.bucket' : 'stats.my.coach.ui.symptom', {
    area,
    strokes: formatNumber(Math.abs(leak.strokesPerRound), { decimals: 1 }),
    vs,
    bucket: leak.bucket,
    rounds: t('stats.my.count.rounds', { count: leak.sample.rounds }),
  });
  const chips = [
    formatConfidence(leak.confidence),
    t('stats.my.count.rounds', { count: leak.sample.rounds }),
    t('stats.my.count.holes', { count: leak.sample.holes }),
  ];
  const cause = causes?.primary ?? null;
  const also = causes?.alsoPossible?.[0] ?? null;
  const causeText = (c) => `${renderMsg(c.lead)} ${renderMsg(c.msg)}`;

  return (
    <View style={s.chain}>
      <Step s={s} label={t('stats.my.coach.ui.step.leak')}>
        <View style={s.bigRow}>
          <Text style={s.big}>{formatNumber(leak.strokesPerRound, { decimals: 1 })}</Text>
          <Text style={s.bigUnit}>{t('stats.my.coach.ui.leak.perRound', { vs })}</Text>
        </View>
        <Text style={s.line1}>{symptom}</Text>
        <View style={s.chips}>{chips.map((c) => <EvidenceChip key={c} label={c} />)}</View>
      </Step>

      <Step s={s} label={t('stats.my.coach.ui.step.why')}>
        {cause ? <Text style={s.line1}>{causeText(cause)}</Text> : <Text style={s.line1}>{t('stats.my.coach.ui.why.none')}</Text>}
        {also ? <Text style={s.line2}>{causeText(also)}</Text> : null}
        <SwingLine
          link={swingLink} s={s} t={t} support={swingSupport}
          onRecordSwing={onRecordSwing} onOpenSwing={onOpenSwing} onInfo={onInfo}
        />
      </Step>

      <Step s={s} label={t('stats.my.coach.ui.step.fix')}>
        {drills.length ? shownDrills.map((d) => (
          <View key={`${d.drillId}-${d.role}`} style={s.fixRow}><DrillLine drill={d} /></View>
        )) : <Text style={s.line2}>{t('stats.my.coach.ui.fix.none')}</Text>}
        {drills.length > shownDrills.length ? (
          <Text style={s.line2} testID="fix-more">{t('stats.my.coach.ui.fix.more', { count: drills.length - shownDrills.length })}</Text>
        ) : null}
        {courseTask ? (
          <View style={s.fixRow}>
            <Text style={s.drillKey}>{t('stats.my.coach.ui.fix.course')}</Text>
            <Text style={s.line1}>{renderMsg(courseTask)}</Text>
          </View>
        ) : null}
        {tip ? (
          <View style={s.fixRow} testID="chain-tip">
            <Text style={s.tipTitle}>
              {msgText(tip.titleMsg, tip.title)}
              <Text style={s.tag}>{`  ${t('stats.my.tip.payoff', { value: formatNumber(tip.payoffPointsPerRound) })}`}</Text>
            </Text>
            <Text style={s.line2}>{msgText(tip.reasonMsg, tip.reason)}</Text>
          </View>
        ) : null}
      </Step>

      <Step s={s} label={t('stats.my.coach.ui.step.check')} last>
        <CheckLines check={check} isFocus={isFocus} s={s} t={t} />
      </Step>
    </View>
  );
}

function CheckLines({ check, isFocus, s, t }) {
  if (!check) return null;
  const metric = renderMsg(check.label);
  const value = metricValueText(check.unit, check.value);
  let line;
  if (check.value == null) line = t('stats.my.coach.ui.check.noValue', { metric });
  else if (isFocus && check.baseline != null) {
    line = t('stats.my.coach.ui.check.line.base', { metric, value, baseline: metricValueText(check.unit, check.baseline) });
  } else if (check.benchmark != null && check.hcp > 0) {
    line = t('stats.my.coach.ui.check.line.bench', {
      metric, value, hcp: formatNumber(check.hcp), bench: metricValueText(check.unit, check.benchmark),
    });
  } else line = t('stats.my.coach.ui.check.line', { metric, value });
  return (
    <>
      <Text style={s.line1}>{line}</Text>
      <Text style={s.line2}>{t('stats.my.coach.ui.check.when', { rounds: check.minRounds, settles: check.settlesAt })}</Text>
    </>
  );
}

// The swing line, all six link states. Web (and a binary that cannot analyse)
// never gets the record button: it gets a plain line instead.
function SwingLine({ link, s, t, support, onRecordSwing, onOpenSwing, onInfo }) {
  const { theme } = useTheme();
  if (!link || link.state === 'notSwing') return null;
  const text = link.msg ? renderDatedMsg(link.msg) : null;
  const note = link.secondSignal && link.note ? renderDatedMsg(link.note) : null;
  const club = link.clubNeeded ?? link.cta?.club ?? null;
  const clubText = club ? renderMsg(makeMsg(`swing.club.${club}`)).toLowerCase() : '';
  const wantsRecord = link.state === 'none' || link.state === 'stale' || link.state === 'wrongClub';

  let action = null;
  if (link.state === 'linked' && link.swing?.id && onOpenSwing) {
    action = (
      <PressableScale
        onPress={() => onOpenSwing(link.swing.id)}
        accessibilityRole="button"
        accessibilityLabel={t('stats.my.coach.ui.swing.open')}
        style={s.linkBtn}
      >
        <Feather name="external-link" size={14} color={theme.info} />
        <Text style={s.linkBtnText}>{t('stats.my.coach.ui.swing.open')}</Text>
      </PressableScale>
    );
  } else if (wantsRecord) {
    if (support?.supported) {
      const label = link.cta?.msg ? renderMsg(link.cta.msg) : t('stats.my.coach.ui.swing.web', { club: clubText });
      action = onRecordSwing ? (
        <PressableScale
          onPress={onRecordSwing}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={s.recordBtn}
        >
          <Feather name="video" size={14} color={theme.text.inverse} />
          <Text style={s.recordBtnText}>{label}</Text>
        </PressableScale>
      ) : null;
    } else {
      action = (
        <View style={s.plainLine} testID="swing-unavailable">
          <Feather name="smartphone" size={14} color={theme.text.muted} />
          <Text style={s.line2}>
            {support?.reason === 'update'
              ? t('stats.my.coach.ui.swing.update')
              : t('stats.my.coach.ui.swing.web', { club: clubText })}
          </Text>
        </View>
      );
    }
  }

  // On an unsupported device the cause sentence of `none` is the plain line
  // above, so the store's "no swing recorded" text would only repeat it.
  const showText = !(link.state === 'none' && !support?.supported);
  return (
    <View style={s.swingBox} testID="swing-line">
      <View style={s.swingHead}>
        <Text style={s.swingKey}>{t('stats.my.coach.ui.swing.title')}</Text>
        {onInfo ? (
          <PressableScale
            onPress={() => onInfo('swingLink')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('stats.my.whatIs', { name: t('stats.my.coach.ui.swing.title') })}
          >
            <Feather name="info" size={13} color={theme.text.muted} />
          </PressableScale>
        ) : null}
      </View>
      {showText && text ? <Text style={s.line1}>{text}</Text> : null}
      {note ? <Text style={s.line2}>{note}</Text> : null}
      {action}
    </View>
  );
}

function Empty({ kind, diagnosis, roundCount, s, t }) {
  if (kind === 'few') {
    return (
      <>
        <Text style={s.title}>{t('stats.my.coach.ui.few.title')}</Text>
        <Step s={s} label={t('stats.my.coach.ui.step.leak')}>
          <Text style={s.line1}>{t('stats.my.coach.ui.few.leak', { rounds: MIN_ROUNDS, holes: MIN_HOLES })}</Text>
          {(diagnosis?.insufficient ?? []).map((c) => {
            const needs = t('stats.my.coach.ui.few.needs', {
              what: [
                c.needs?.rounds > 0 ? t('stats.my.coach.ui.few.moreRounds', { count: c.needs.rounds }) : null,
                c.needs?.holes > 0 ? t('stats.my.coach.ui.few.moreHoles', { count: c.needs.holes }) : null,
              ].filter(Boolean).join(', '),
            });
            return (
              <View key={c.id} style={s.fewRow} testID={`insufficient-${c.category}`}>
                <View style={s.fewCopy}>
                  <Text style={s.drillKey}>{renderMsg(areaMsg(c.category))}</Text>
                  <Text style={s.line2}>{needs}</Text>
                </View>
                <EvidenceChip label={t('stats.my.coach.ui.few.chip')} />
              </View>
            );
          })}
        </Step>
        <Step s={s} label={t('stats.my.coach.ui.step.fix')} last>
          <Text style={s.line1}>{t('stats.my.coach.ui.few.fix')}</Text>
        </Step>
      </>
    );
  }
  if (kind === 'noDetail') {
    return (
      <>
        <Text style={s.title}>{t('stats.my.coach.ui.nodetail.title')}</Text>
        <Step s={s} label={t('stats.my.coach.ui.step.leak')}>
          <Text style={s.line1}>{t('stats.my.coach.ui.nodetail.leak', { rounds: t('stats.my.count.rounds', { count: roundCount }) })}</Text>
        </Step>
        <Step s={s} label={t('stats.my.coach.ui.step.fix')} last>
          <Text style={s.line1}>{t('stats.my.coach.ui.nodetail.fix')}</Text>
        </Step>
      </>
    );
  }
  if (kind === 'candidate' && diagnosis?.candidate) {
    const c = diagnosis.candidate;
    return (
      <>
        <Text style={s.title}>{t('stats.my.coach.ui.candidate.title')}</Text>
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
      <Text style={s.title}>{t('stats.my.coach.ui.noLeak.title')}</Text>
      <Text style={s.reason}>{t('stats.my.coach.ui.noLeak.leak')}</Text>
    </>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
    reason: { ...theme.typography.subhead, color: theme.text.secondary },
    kicker: { ...theme.typography.overline, color: theme.text.muted },
    tieBlock: {
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.md,
      marginTop: theme.spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.default,
    },
    chain: { gap: 0 },
    step: { flexDirection: 'row', gap: theme.spacing.md },
    rail: { width: 10, alignItems: 'center', paddingTop: 5 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.info },
    line: { flex: 1, width: 1, backgroundColor: theme.border.default, marginTop: 3 },
    stepBody: { flex: 1, minWidth: 0, gap: 6, paddingBottom: theme.spacing.lg },
    stepKey: { ...theme.typography.overline, color: theme.info },
    bigRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
    big: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 28, lineHeight: 32, color: theme.text.primary },
    bigUnit: { ...theme.typography.caption, color: theme.text.secondary, flexShrink: 1 },
    line1: { ...theme.typography.body, color: theme.text.primary },
    line2: { ...theme.typography.caption, color: theme.text.secondary, flexShrink: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
    fixRow: { gap: 2 },
    drillKey: { ...theme.typography.subhead, color: theme.text.primary, fontWeight: '800' },
    tipTitle: { ...theme.typography.body, color: theme.text.primary, fontWeight: '700' },
    tag: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '700' },
    swingBox: {
      gap: 6,
      padding: theme.spacing.md,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
    },
    swingHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    swingKey: { ...theme.typography.overline, color: theme.text.muted },
    plainLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
    linkBtnText: { ...theme.typography.subhead, color: theme.info, fontWeight: '800' },
    recordBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 44,
      paddingHorizontal: 14, borderRadius: 999, backgroundColor: theme.accent.primary,
    },
    recordBtnText: { fontSize: 12.5, fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse },
    fewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, paddingVertical: 2 },
    fewCopy: { flex: 1, minWidth: 0 },
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
