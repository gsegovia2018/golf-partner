import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatNumber } from '../../i18n';
import { msg as makeMsg } from '../../store/statsMsg';
import { issueMsg } from '../../store/coachCausePair';
import { MIN_VERDICT_ROUNDS } from '../../store/coachFocus';
import BottomSheet from '../BottomSheet';
import IconButton from '../ui/IconButton';
import PressableScale from '../ui/PressableScale';
import SheetHandle from '../ui/SheetHandle';
import { EvidenceChip } from './CoachBits';
import { formatConfidence } from './CoachInsightRow';
import { renderMsg, renderDatedMsg, metricValueText } from './msg';

const areaMsg = (category) => makeMsg(`stats.my.coach.plan.area.${category}`);
const causeText = (c) => `${renderMsg(c.lead)} ${renderMsg(c.msg)}`;

// Everything the verdict card keeps off its surface: the cause and what else it
// could be, the evidence behind it, the swing, the Check and when it is re-read,
// and what the coach does once a focus is pinned. A tie shows both leaks.
// `week` is store/coachWeek.js buildCoachWeek's result.
export default function WhySheet({
  visible, onClose, week, untracked = null, showExplain = false,
  swingSupport, onRecordSwing, onOpenSwing, onInfo,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const chains = week?.chains ?? [];
  if (!chains.length) return null;
  const tie = week.kind === 'tie';
  const [first] = chains;
  const hcp = first.leak.benchmark?.targetHandicap;
  const vs = hcp > 0 ? t('stats.my.coach.ui.vs.target', { hcp: formatNumber(hcp) }) : t('stats.my.coach.ui.vs.scratch');
  const area = renderMsg(areaMsg(first.leak.category));
  const kicker = first.leak.bucket
    ? t('stats.my.coach.ui.kicker.bucket', { area, bucket: first.leak.bucket })
    : t('stats.my.coach.ui.kicker', { area });
  const title = tie ? t('stats.my.coach.ui.tie.title') : renderMsg(issueMsg(first.leak, first.causes?.primary));
  const meta = tie ? null : `${kicker} · ${formatNumber(first.leak.strokesPerRound, { decimals: 1 })} ${t('stats.my.coach.ui.leak.perRound', { vs })}`;
  const metric = !tie && first.check?.label ? renderMsg(first.check.label) : null;

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <SheetHandle style={s.handle} />
      <View style={s.header}>
        <View style={s.headCopy}>
          <Text style={s.title} testID="why-sheet-title">{title}</Text>
          {meta ? <Text style={s.meta}>{meta}</Text> : null}
        </View>
        <IconButton icon="x" onPress={onClose} accessibilityLabel={t('stats.my.coach.ui.drill.close')} style={s.close} />
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {tie ? (
          <Text style={s.line2}>{t('stats.my.coach.ui.tie.reason', {
            a: renderMsg(areaMsg(chains[0].leak.category)),
            sa: formatNumber(Math.abs(chains[0].leak.strokesPerRound), { decimals: 1 }),
            b: renderMsg(areaMsg(chains[1].leak.category)),
            sb: formatNumber(Math.abs(chains[1].leak.strokesPerRound), { decimals: 1 }),
          })}</Text>
        ) : null}
        {chains.map((chain, i) => (
          <View key={chain.leak.id} style={s.chain} testID={`why-chain-${i + 1}`}>
            {tie ? (
              <Text style={s.chainTitle}>{t('stats.my.coach.ui.tie.leak', { n: i + 1, area: renderMsg(areaMsg(chain.leak.category)) })}</Text>
            ) : null}
            <ChainWhy
              chain={chain}
              untracked={i === 0 ? untracked : null}
              s={s}
              t={t}
              theme={theme}
              swingSupport={swingSupport}
              onRecordSwing={onRecordSwing}
              onOpenSwing={onOpenSwing}
              onInfo={onInfo}
            />
          </View>
        ))}
        {showExplain ? (
          <Text style={s.line2} testID="focus-explain">
            {metric
              ? t('stats.my.coach.ui.focus.explain', { metric: metric.charAt(0).toLocaleLowerCase() + metric.slice(1), rounds: MIN_VERDICT_ROUNDS })
              : t('stats.my.coach.ui.focus.explain.generic', { rounds: MIN_VERDICT_ROUNDS })}
          </Text>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

function ChainWhy({ chain, untracked, s, t, theme, swingSupport, onRecordSwing, onOpenSwing, onInfo }) {
  const { leak, causes, swingLink, check, isFocus } = chain;
  const cause = causes?.primary ?? null;
  const also = causes?.alsoPossible?.[0] ?? null;
  const chips = [
    formatConfidence(leak.confidence),
    t('stats.my.count.rounds', { count: leak.sample.rounds }),
    t('stats.my.count.holes', { count: leak.sample.holes }),
  ];
  return (
    <>
      {untracked ? (
        <Text style={s.line2} testID="untracked-note">{t('stats.my.coach.ui.leak.untracked', {
          untracked: formatNumber(untracked.residual, { decimals: 1 }),
          gap: formatNumber(untracked.gap, { decimals: 1 }),
        })}</Text>
      ) : null}
      <Text style={s.section}>{t('stats.my.coach.ui.step.why')}</Text>
      {cause ? <Text style={s.line1}>{causeText(cause)}</Text> : <Text style={s.line1}>{t('stats.my.coach.ui.why.none')}</Text>}
      {also ? <Text style={s.line2}>{causeText(also)}</Text> : null}

      <Text style={s.section}>{t('stats.my.coach.ui.sheet.evidence')}</Text>
      <View style={s.chips}>{chips.map((c) => <EvidenceChip key={c} label={c} />)}</View>

      <SwingLine
        link={swingLink} s={s} t={t} theme={theme} support={swingSupport}
        onRecordSwing={onRecordSwing} onOpenSwing={onOpenSwing} onInfo={onInfo}
      />

      <Text style={s.section}>{t('stats.my.coach.ui.step.check')}</Text>
      <CheckLines check={check} isFocus={isFocus} s={s} t={t} />
    </>
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
  } else if (check.benchmark != null && check.hcp === 0) {
    line = t('stats.my.coach.ui.check.line.bench.scratch', {
      metric, value, bench: metricValueText(check.unit, check.benchmark),
    });
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

// The swing box, all six link states. Web (and a binary that cannot analyse)
// never gets the record button: it gets a plain line instead.
function SwingLine({ link, s, t, theme, support, onRecordSwing, onOpenSwing, onInfo }) {
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

function makeStyles(theme) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: theme.bg.primary,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      maxHeight: '85%',
      paddingBottom: 32,
      borderTopWidth: 1,
      borderColor: theme.border.default,
    },
    handle: { marginTop: 10 },
    header: {
      flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.md,
      paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12,
      borderBottomWidth: 1, borderBottomColor: theme.border.subtle,
    },
    headCopy: { flex: 1, minWidth: 0, gap: 2 },
    title: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 17 },
    meta: { ...theme.typography.caption, color: theme.text.muted },
    close: { width: 44, height: 44 },
    scroll: { flexGrow: 0 },
    scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 6 },
    chain: { gap: 6 },
    chainTitle: { ...theme.typography.heading, color: theme.text.primary, marginTop: theme.spacing.sm },
    section: { ...theme.typography.overline, color: theme.info, marginTop: 8 },
    line1: { ...theme.typography.body, color: theme.text.primary },
    line2: { ...theme.typography.caption, color: theme.text.secondary, flexShrink: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
    swingBox: {
      gap: 6,
      marginTop: theme.spacing.sm,
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
  });
}
