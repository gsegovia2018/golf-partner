import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Share, Clipboard, Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import { buttonStyles } from '../components/ui/Buttons';
import WizardProgress from '../components/setup/WizardProgress';
import WizardNav from '../components/setup/WizardNav';
import PostCreateInviteModal from '../components/PostCreateInviteModal';
import DateField from '../components/DateField';
import { wizardSteps, isStepValid } from './setupWizard';
import { useTheme } from '../theme/ThemeContext';
import { onDeep, semantic } from '../theme/tokens';
import { useAuth } from '../context/AuthContext';
import { loadProfile } from '../store/profileStore';
import { listFriends, getCachedFriends } from '../store/friendStore';
import { createLeague } from '../store/leagueStore';
import { DEFAULT_POINTS_TABLE } from '../store/leagueStandings';
import {
  DEFAULT_HANDICAP_CAP, DEFAULT_PARTICIPATION_POINTS, defaultSeason, parseIsoDate, parsePointsTable, formatPointsTable,
  parseFeeCents, defaultMemberHandicap, parseMemberHandicap, buildCreateArgs, leagueJoinLink,
  seasonMonthKeys, stepFeeText, DEFAULT_LEAGUE_FORMAT,
} from '../store/leagueDraft';
import { formatEuros, stepParticipation } from '../store/leagueView';
import Stepper from '../components/ui/Stepper';
import LeagueFormatField from '../components/league/LeagueFormatField';
import PointsTableChart from '../components/league/PointsTableChart';
import LeagueHero from '../components/league/LeagueHero';
import { useT, formatNumber, formatDate } from '../i18n';
import { shareOrigin } from '../lib/shareOrigin';
import { NAME_MAX } from '../components/league/GuestIdentityFields';
import { leagueErrorText } from '../lib/leagueErrorText';
import { useConfirmSheet } from '../components/league/ConfirmSheet';

const fmtDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return `${formatDate(iso, 'day')} ${m[1]}`;
};

// Create-a-league wizard: name and season, rules, members, review. Online
// only (createLeague is an RPC). Plan: docs/superpowers/plans/2026-10-04-league.md.
export default function LeagueCreateScreen({ navigation }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const t = useT();
  const { ask, sheet: confirmSheet } = useConfirmSheet();
  const showError = (message) => ask({ title: t('league.create.errorTitle'), message: message || t('league.create.errorGeneric') });
  const s = makeStyles(theme);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const steps = useMemo(() => wizardSteps('league', 0), []);
  const season = useMemo(() => defaultSeason(), []);

  const [name, setName] = useState('');
  const [seasonStart, setSeasonStart] = useState(season.seasonStart);
  const [seasonEnd, setSeasonEnd] = useState(season.seasonEnd);
  const [pointsText, setPointsText] = useState(formatPointsTable(DEFAULT_POINTS_TABLE));
  const [capText, setCapText] = useState(String(DEFAULT_HANDICAP_CAP));
  const [feeText, setFeeText] = useState('');
  // Sent to create_league. The wizard offers Stableford only until
  // MEDAL_FORMATS_ENABLED (leagueDraft).
  const [format, setFormat] = useState(DEFAULT_LEAGUE_FORMAT);
  const [addOpen, setAddOpen] = useState(false);
  const [participationPoints, setParticipationPoints] = useState(DEFAULT_PARTICIPATION_POINTS);
  const [profile, setProfile] = useState(null);
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  // userId -> handicap text, for each friend picked.
  const [picked, setPicked] = useState({});
  const [myHcpText, setMyHcpText] = useState('');
  // People not in the app yet: reserved spots they claim from the invite link.
  const [invitees, setInvitees] = useState([]); // [{ key, name, hcpText }]
  const [newName, setNewName] = useState('');
  const nextKeyRef = useRef(0);
  const [rawStep, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  // Set once the RPC succeeds: swaps the wizard for the done view, so a
  // second tap on "Create" can never insert a second league.
  const [created, setCreated] = useState(null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const creatingRef = useRef(false);

  const step = Math.max(0, Math.min(rawStep, steps.length - 1));
  const stepKey = steps[step];

  const cap = Number(capText.replace(',', '.'));
  const pointsTable = parsePointsTable(pointsText);
  const feeCents = parseFeeCents(feeText);
  const startIso = parseIsoDate(seasonStart);
  const endIso = parseIsoDate(seasonEnd);
  const seasonMonths = seasonMonthKeys(startIso, endIso).map((k) => formatDate(`${k}-01`, 'monthName'));

  useEffect(() => {
    let cancelled = false;
    loadProfile().then((p) => {
      if (cancelled || !p) return;
      setProfile(p);
      setMyHcpText((prev) => prev || String(defaultMemberHandicap(p.handicap, DEFAULT_HANDICAP_CAP) ?? ''));
    }).catch(() => {});
    listFriends(user?.id)
      .catch(() => getCachedFriends())
      .then((list) => { if (!cancelled) setFriends(list ?? []); })
      .finally(() => { if (!cancelled) setFriendsLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

  function togglePicked(friend) {
    setPicked((prev) => {
      if (prev[friend.userId] != null) {
        const next = { ...prev };
        delete next[friend.userId];
        return next;
      }
      const hcp = defaultMemberHandicap(friend.handicap, Number.isFinite(cap) ? cap : DEFAULT_HANDICAP_CAP);
      return { ...prev, [friend.userId]: hcp == null ? '' : String(hcp) };
    });
  }

  const effectiveCap = Number.isFinite(cap) ? cap : DEFAULT_HANDICAP_CAP;
  const memberCount = 1 + Object.keys(picked).length + invitees.length;
  const friendCount = Object.keys(picked).length;

  function addInvitee() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    nextKeyRef.current += 1;
    setInvitees((prev) => [...prev, { key: nextKeyRef.current, name: trimmed, hcpText: '' }]);
    setNewName('');
  }

  async function handleCreate() {
    if (busy || creatingRef.current || created) return;
    creatingRef.current = true;
    setBusy(true);
    try {
      const members = [
        { userId: user?.id, handicap: parseMemberHandicap(myHcpText, effectiveCap) },
        ...Object.entries(picked).map(([userId, text]) => ({
          userId, handicap: parseMemberHandicap(text, effectiveCap),
        })),
        ...invitees.map((i) => ({ name: i.name, handicap: parseMemberHandicap(i.hcpText, effectiveCap) })),
      ];
      const result = await createLeague(buildCreateArgs({
        name, seasonStart: startIso, seasonEnd: endIso, pointsTable, cap: effectiveCap,
        feeCents: feeCents ?? 0, participationPoints, members, format,
      }));
      if (mountedRef.current) setCreated(result);
    } catch (e) {
      creatingRef.current = false;
      showError(leagueErrorText(e) || t('league.create.createFailed'));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  function handleBack() {
    if (step === 0) navigation.goBack();
    else setStep((p) => p - 1);
  }

  function handleNext() {
    if (stepKey === 'review') handleCreate();
    else setStep((p) => Math.min(p + 1, steps.length - 1));
  }

  function goToStep(key) {
    const idx = steps.indexOf(key);
    if (idx >= 0) setStep(idx);
  }

  const isLastStep = stepKey === 'review';
  const draftValid = isStepValid('name', {
    league: { name, seasonStart: startIso || '', seasonEnd: endIso || '' },
  }) && isStepValid('rules', { league: { pointsTable, cap } }) && feeCents != null;
  const nextEnabled = (isLastStep
    ? draftValid
    : isStepValid(stepKey, {
      league: { name, seasonStart: startIso || '', seasonEnd: endIso || '', pointsTable, cap },
    }) && (stepKey !== 'rules' || feeCents != null))
    && !busy;

  const link = created ? leagueJoinLink(shareOrigin(), created.inviteCode) : null;

  async function shareLink() {
    if (!link) return;
    try {
      await Share.share({ message: t('league.create.shareMessage', { name: name.trim(), link }) });
    } catch (err) {
      showError(err?.message ?? t('league.create.shareFailed'));
    }
  }

  function copyLink() {
    if (!link) return;
    Clipboard.setString(link);
    setCopied(true);
    setTimeout(() => { if (mountedRef.current) setCopied(false); }, 2000);
  }

  // ---- Step bodies --------------------------------------------------------

  const input = (props) => (
    <TextInput
      style={s.input}
      placeholderTextColor={theme.text.muted}
      keyboardAppearance={theme.isDark ? 'dark' : 'light'}
      selectionColor={theme.accent.primary}
      {...props}
    />
  );

  const renderNameStep = () => (
    <>
      <Text style={s.stepOverline}>{t('league.create.overlineLeague')}</Text>
      <Text style={s.stepPrompt}>{t('league.create.namePrompt')}</Text>
      <Text style={s.stepSubtitle}>{t('league.create.nameSubtitle')}</Text>
      <Text style={s.fieldLabel}>{t('league.create.leagueName')}</Text>
      {input({ placeholder: t('league.create.leagueNamePh'), value: name, onChangeText: setName, autoFocus: false })}
      <Text style={s.fieldLabel}>{t('league.create.seasonStarts')}</Text>
      <DateField label={t('league.create.seasonStarts')} value={seasonStart} onChange={setSeasonStart} quickDates={false} />
      <Text style={s.fieldLabel}>{t('league.create.seasonEnds')}</Text>
      <DateField label={t('league.create.seasonEnds')} value={seasonEnd} onChange={setSeasonEnd} quickDates={false} min={startIso || undefined} />
      {startIso && endIso && startIso > endIso && (
        <Text style={s.errorText}>{t('league.create.seasonOrder')}</Text>
      )}
      {seasonMonths.length > 0 && (
        <Text style={s.hint}>
          {t('league.create.seasonMonths', { count: seasonMonths.length, months: seasonMonths.join(', ') })}
        </Text>
      )}
    </>
  );

  const capValue = Number.isFinite(cap) ? cap : DEFAULT_HANDICAP_CAP;

  const renderRulesStep = () => (
    <>
      <Text style={s.stepOverline}>{t('league.create.overlineRules')}</Text>
      <Text style={s.stepPrompt}>{t('league.create.rulesPrompt')}</Text>
      <Text style={s.stepSubtitle}>{t('league.create.rulesSubtitle')}</Text>

      <Text style={s.fieldLabel}>{t('league.create.format')}</Text>
      <LeagueFormatField value={format} onChange={setFormat} />

      <Text style={[s.fieldLabel, { marginTop: 18 }]}>{t('league.create.seasonScoring')}</Text>
      <View style={s.card}>
        <PointsTableChart
          table={pointsTable ?? []}
          onChange={(table) => setPointsText(table ? formatPointsTable(table) : '')}
        />

        <View style={[s.settingRow, s.rowDivider]}>
          <View style={s.settingText}>
            <Text style={s.ruleTitle}>{t('league.rules.playing')}</Text>
            <Text style={s.ruleSub}>{t('league.create.playingSub')}</Text>
          </View>
          <Stepper
            valueLabel={String(participationPoints)}
            valueA11y={t('league.rules.playingValue', { points: participationPoints })}
            onStep={(d) => setParticipationPoints(stepParticipation(participationPoints, d))}
            canDecrease={participationPoints > 0}
            decreaseLabel={t('league.rules.playingFewer')}
            increaseLabel={t('league.rules.playingMore')}
          />
        </View>

        <View style={[s.settingRow, s.rowDivider]}>
          <View style={s.settingText}>
            <Text style={s.ruleTitle}>{t('league.create.handicapCap')}</Text>
          </View>
          <Stepper
            valueLabel={formatNumber(capValue)}
            valueA11y={t('league.create.capValueA11y', { cap: formatNumber(capValue) })}
            onStep={(d) => setCapText(String(Math.min(54, Math.max(0, capValue + d))))}
            canDecrease={capValue > 0}
            canIncrease={capValue < 54}
            decreaseLabel={t('league.create.capLower')}
            increaseLabel={t('league.create.capRaise')}
          />
        </View>

        <View style={s.settingRow}>
          <View style={s.settingText}>
            <Text style={s.ruleTitle}>{t('league.create.entryFeeLabel')}</Text>
            <Text style={s.ruleSub}>{t('league.create.feeSub')}</Text>
          </View>
          <Stepper
            valueLabel={feeCents ? formatEuros(feeCents) : t('league.create.feeFree')}
            valueA11y={t('league.create.feeValueA11y', { fee: feeCents ? formatEuros(feeCents) : t('league.create.feeFree') })}
            onStep={(d) => {
              const next = stepFeeText(feeText, d);
              if (next != null) setFeeText(next);
            }}
            canDecrease={!!feeCents}
            decreaseLabel={t('league.create.feeLower')}
            increaseLabel={t('league.create.feeRaise')}
          />
        </View>
      </View>
    </>
  );

  const avatar = (name, url) => (
    <View style={s.avatar}>
      {url
        ? <Image source={{ uri: url }} style={s.avatarImg} />
        : <Text style={s.avatarText}>{(name ?? '?').slice(0, 2).toUpperCase()}</Text>}
    </View>
  );

  const hcpField = (value, onChangeText, a11y) => (
    <TextInput
      style={s.hcpInput}
      value={value}
      onChangeText={onChangeText}
      placeholder={t('league.create.hcpPh')}
      placeholderTextColor={theme.text.muted}
      keyboardType="decimal-pad"
      keyboardAppearance={theme.isDark ? 'dark' : 'light'}
      accessibilityLabel={a11y}
    />
  );

  const renderMembersStep = () => (
    <>
      <Text style={s.stepOverline}>{t('league.create.overlineMembers')}</Text>
      <Text style={s.stepPrompt}>{t('league.create.membersPrompt')}</Text>
      <Text style={s.stepSubtitle}>
        {t('league.create.membersSubtitle', { cap: formatNumber(effectiveCap) })}
      </Text>

      <View style={s.memberCard}>
        {avatar(profile?.displayName, profile?.avatarUrl)}
        <View style={{ flex: 1 }}>
          <Text style={s.memberName}>{profile?.displayName ? t('league.create.youNamed', { name: profile.displayName }) : t('league.create.you')}</Text>
          <Text style={s.memberSub}>{t('league.create.admin')}</Text>
        </View>
        {hcpField(myHcpText, setMyHcpText, t('league.create.yourHcpA11y'))}
      </View>

      {friendsLoading && [0, 1, 2].map((i) => (
        <View key={i} style={s.memberCard} testID="friend-skeleton">
          <View style={[s.avatar, s.skeleton]} />
          <View style={{ flex: 1 }}>
            <View style={[s.skeleton, { width: '45%', height: 12, borderRadius: 6 }]} />
            <View style={[s.skeleton, { width: '30%', height: 10, borderRadius: 5, marginTop: 6 }]} />
          </View>
        </View>
      ))}
      {!friendsLoading && friends.length === 0 && (
        <View style={s.emptyHint}>
          <Feather name="users" size={14} color={theme.text.muted} style={{ marginRight: 8 }} />
          <Text style={s.emptyHintText}>{t('league.create.noFriends')}</Text>
        </View>
      )}
      {friends.map((f) => {
        const on = picked[f.userId] != null;
        return (
          <View key={f.userId} style={[s.memberCard, on && s.memberCardOn]}>
            <TouchableOpacity
              style={s.memberTap}
              onPress={() => togglePicked(f)}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={f.displayName}
            >
              {avatar(f.displayName, f.avatarUrl)}
              <View style={{ flex: 1 }}>
                <Text style={s.memberName} numberOfLines={1}>{f.displayName}</Text>
                <Text style={s.memberSub}>{f.handicap != null ? t('league.create.profileHcp', { hcp: formatNumber(f.handicap) }) : t('league.create.fromFriends')}</Text>
              </View>
            </TouchableOpacity>
            {on && hcpField(
              picked[f.userId],
              (text) => setPicked((prev) => ({ ...prev, [f.userId]: text })),
              t('league.create.memberHcpA11y', { name: f.displayName }),
            )}
            <TouchableOpacity
              style={s.checkSlot}
              onPress={() => togglePicked(f)}
              accessible={false}
              importantForAccessibility="no"
            >
              <View style={[s.check, on && s.checkOn]}>
                {on && <Feather name="check" size={12} color={theme.text.inverse} />}
              </View>
            </TouchableOpacity>
          </View>
        );
      })}

      {invitees.length > 0 && (
        <Text style={[s.stepOverline, { marginTop: 14 }]}>{t('league.create.notInApp')}</Text>
      )}
      {invitees.map((i) => (
        <View key={i.key} style={s.memberCard}>
          <View style={[s.avatar, s.avatarInvitee]}>
            <Feather name="link" size={15} color={theme.accent.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.memberName} numberOfLines={1}>{i.name}</Text>
            <Text style={s.memberSub}>{t('league.create.joinsFromLink')}</Text>
          </View>
          {hcpField(
            i.hcpText,
            (text) => setInvitees((prev) => prev.map((p) => (p.key === i.key ? { ...p, hcpText: text } : p))),
            t('league.create.memberHcpA11y', { name: i.name }),
          )}
          <TouchableOpacity
            style={s.removeBtn}
            onPress={() => setInvitees((prev) => prev.filter((p) => p.key !== i.key))}
            accessibilityRole="button"
            accessibilityLabel={t('league.create.removeA11y', { name: i.name })}
          >
            <Feather name="x" size={18} color={theme.text.muted} />
          </TouchableOpacity>
        </View>
      ))}
      {!addOpen ? (
        <TouchableOpacity
          style={s.addTile}
          onPress={() => setAddOpen(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Feather name="plus" size={16} color={theme.accent.primary} />
          <Text style={s.addTileText}>{t('league.create.addSomeone')}</Text>
        </TouchableOpacity>
      ) : (
        <View style={s.addRow}>
          <TextInput
            style={[s.input, s.addInput]}
            value={newName}
            onChangeText={setNewName}
            onSubmitEditing={addInvitee}
            placeholder={t('league.create.newNamePh')}
            placeholderTextColor={theme.text.muted}
            autoCapitalize="words"
            autoFocus
            returnKeyType="done"
            maxLength={NAME_MAX}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            accessibilityLabel={t('league.create.newNameA11y')}
          />
          <TouchableOpacity
            style={[s.addBtn, !newName.trim() && { opacity: 0.5 }]}
            onPress={addInvitee}
            disabled={!newName.trim()}
            accessibilityRole="button"
            accessibilityLabel={t('league.create.addA11y')}
          >
            <Feather name="plus" size={20} color={theme.text.inverse} />
          </TouchableOpacity>
        </View>
      )}
    </>
  );

  const renderReviewStep = () => (
    <>
      <View style={s.hero}>
        <Text style={s.heroOverline}>{t('league.create.reviewOverline')}</Text>
        <TextInput
          style={s.heroName}
          value={name}
          onChangeText={setName}
          placeholder={t('league.create.leagueName')}
          placeholderTextColor={onDeep.faint}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          selectionColor={onDeep.primary}
        />
        <View style={s.chipRow}>
          <View style={s.chip}><Text style={s.chipText}>{t('league.join.members', { count: memberCount })}</Text></View>
          <View style={s.chip}><Text style={s.chipText}>{`${fmtDate(startIso)} – ${fmtDate(endIso)}`}</Text></View>
          <View style={s.chip}><Text style={s.chipText}>{t('league.create.netStableford')}</Text></View>
        </View>
      </View>

      <Text style={s.stepOverline}>{t('league.create.tapToEdit')}</Text>
      <View style={s.card}>
        <TouchableOpacity style={[s.reviewRow, s.rowDivider]} onPress={() => goToStep('name')}>
          <Feather name="calendar" size={14} color={theme.text.primary} style={s.reviewIcon} />
          <View style={{ flex: 1 }}>
            <Text style={s.ruleTitle}>{t('league.create.season')}</Text>
            <Text style={s.ruleSub}>{`${fmtDate(startIso)} – ${fmtDate(endIso)}`}</Text>
          </View>
          <Feather name="chevron-right" size={18} color={theme.text.muted} />
        </TouchableOpacity>
        <TouchableOpacity style={[s.reviewRow, s.rowDivider]} onPress={() => goToStep('rules')}>
          <Feather name="list" size={14} color={theme.text.primary} style={s.reviewIcon} />
          <View style={{ flex: 1 }}>
            <Text style={s.ruleTitle}>{t('league.create.rules')}</Text>
            <Text style={s.ruleSub} numberOfLines={2}>
              {t('league.create.rulesSummary', {
                cap: formatNumber(effectiveCap),
                fee: feeCents ? t('league.join.entryFee', { fee: formatEuros(feeCents) }) : t('league.join.noEntryFee'),
                table: formatPointsTable(pointsTable),
              })}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={theme.text.muted} />
        </TouchableOpacity>
        <TouchableOpacity style={s.reviewRow} onPress={() => goToStep('members')}>
          <Feather name="users" size={14} color={theme.text.primary} style={s.reviewIcon} />
          <View style={{ flex: 1 }}>
            <Text style={s.ruleTitle}>{t('league.create.membersRow')}</Text>
            <Text style={s.ruleSub}>
              {friendCount === 0
                ? (invitees.length > 0 ? t('league.create.you') : t('league.create.justYou'))
                : t('league.create.youAndFriends', { count: friendCount })}
              {invitees.length > 0 && ` · ${t('league.create.notInAppYet', { count: invitees.length })}`}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={theme.text.muted} />
        </TouchableOpacity>
      </View>
    </>
  );

  // ---- Done ---------------------------------------------------------------

  if (created) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={s.content}>
          <LeagueHero
            nameSize={24}
            overline={t('league.create.created')}
            name={name.trim()}
            chips={[
              t('league.join.members', { count: memberCount }),
              `${fmtDate(startIso)} – ${fmtDate(endIso)}`,
              t('league.create.netStableford'),
            ]}
          />

          <Text style={s.stepOverline}>{t('league.create.inviteCode')}</Text>
          <View style={s.codeBox}>
            <Text style={s.code} selectable>{created.inviteCode}</Text>
          </View>
          <Text style={s.hint}>
            {t('league.create.inviteHint')}
          </Text>

          <TouchableOpacity style={s.secondaryBtn} onPress={copyLink} activeOpacity={0.8}>
            <Feather name={copied ? 'check' : 'link'} size={16} color={theme.accent.primary} style={{ marginRight: 8 }} />
            <Text style={s.secondaryText}>{copied ? t('league.create.copied') : t('league.create.copyLink')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} onPress={() => setShowQr(true)} activeOpacity={0.8}>
            <Feather name="grid" size={16} color={theme.accent.primary} style={{ marginRight: 8 }} />
            <Text style={s.secondaryText}>{t('league.create.showQr')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.primaryBtn} onPress={shareLink} activeOpacity={0.8}>
            <Feather name="share-2" size={16} color={theme.text.inverse} style={{ marginRight: 8 }} />
            <Text style={s.primaryText}>{t('league.create.shareInvite')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.linkBtn}
            onPress={() => navigation.replace('LeagueBoard', { leagueId: created.id })}
            activeOpacity={0.7}
          >
            <Text style={s.linkText}>{t('league.create.openLeague')}</Text>
          </TouchableOpacity>
        </ScrollView>

        <PostCreateInviteModal
          visible={showQr}
          loading={false}
          link={link}
          error={null}
          onRequestClose={() => setShowQr(false)}
          onShare={shareLink}
          title={t('league.create.qrTitle')}
          subtitle={t('league.create.qrSubtitle')}
        />
        {confirmSheet}
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <WizardProgress step={step} totalSteps={steps.length} onBack={handleBack} />

      <ScrollView style={s.scrollView} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {stepKey === 'name' && renderNameStep()}
        {stepKey === 'rules' && renderRulesStep()}
        {stepKey === 'members' && renderMembersStep()}
        {stepKey === 'review' && renderReviewStep()}
      </ScrollView>

      <WizardNav
        isFirstStep={step === 0}
        isLastStep={isLastStep}
        nextEnabled={nextEnabled}
        nextLabel={isLastStep ? t('league.create.createLeague') : t('common.next')}
        onBack={handleBack}
        onNext={handleNext}
      />
      {confirmSheet}
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  const cardBorder = theme.isDark ? theme.glass?.border : theme.border.default;
  const btn = buttonStyles(theme);
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    scrollView: { flex: 1 },
    content: { padding: 20, paddingBottom: 40 },

    stepOverline: {
      fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 11,
      letterSpacing: 1.8, textTransform: 'uppercase', marginBottom: 6,
    },
    stepPrompt: {
      fontFamily: 'PlayfairDisplay-Bold', fontSize: 26, color: theme.text.primary, letterSpacing: -0.3,
    },
    stepSubtitle: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13,
      marginTop: 6, marginBottom: 18,
    },
    fieldLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12,
      marginBottom: 6, marginTop: 8,
    },
    input: {
      backgroundColor: theme.bg.card, color: theme.text.primary, borderRadius: 12, borderWidth: 1,
      borderColor: cardBorder, padding: 13, marginBottom: 8, fontSize: 15, fontFamily: 'PlusJakartaSans-Bold',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    hint: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17, marginBottom: 8,
    },
    errorText: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 12, marginBottom: 8,
    },

    card: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      overflow: 'hidden', marginBottom: 12, ...(theme.isDark ? {} : theme.shadow.card),
    },
    rowDivider: { borderBottomWidth: 1, borderBottomColor: theme.border.subtle },
    settingRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
    settingText: { flex: 1 },
    ruleTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14 },
    ruleSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 2 },
    reviewRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
    reviewIcon: { marginRight: 12 },

    memberCard: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bg.card, borderRadius: 16,
      borderWidth: 1, borderColor: cardBorder, padding: 14, marginBottom: 8,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    memberCardOn: { borderColor: theme.accent.primary },
    memberTap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    memberName: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15 },
    memberSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 2 },
    checkSlot: { paddingLeft: 12, paddingVertical: 4 },
    check: {
      width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: theme.border.default,
      alignItems: 'center', justifyContent: 'center',
    },
    avatar: {
      width: 34, height: 34, borderRadius: 17, marginRight: 12, overflow: 'hidden',
      backgroundColor: theme.isDark ? theme.bg.secondary : '#006747', alignItems: 'center', justifyContent: 'center',
    },
    avatarImg: { width: '100%', height: '100%' },
    avatarText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: semantic.winner.dark, fontSize: 13 },
    avatarInvitee: {
      backgroundColor: 'transparent', borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.accent.primary,
    },
    skeleton: { backgroundColor: theme.bg.secondary },
    addTile: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52,
      backgroundColor: theme.accent.light, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed',
      borderColor: theme.accent.primary + '40', marginTop: 4,
    },
    addTileText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },
    checkOn: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    hcpInput: {
      width: 64, textAlign: 'center', color: theme.text.primary, borderRadius: 10, borderWidth: 1,
      borderColor: theme.border.default, backgroundColor: theme.bg.secondary, paddingVertical: 8,
      fontSize: 14, fontFamily: 'PlusJakartaSans-Bold', marginLeft: 8,
    },
    removeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
    addRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    addInput: { flex: 1 },
    addBtn: {
      width: 48, height: 48, borderRadius: 10, backgroundColor: theme.accent.primary,
      alignItems: 'center', justifyContent: 'center',
    },
    emptyHint: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bg.secondary, borderRadius: 12,
      borderWidth: 1, borderColor: theme.border.default, borderStyle: 'dashed', padding: 14, marginBottom: 8,
    },
    emptyHintText: { flex: 1, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13 },

    // Same deep-green hero as the official wizard's review step; theme.bg.deep
    // is dark in both themes, so white text keeps its contrast.
    hero: { backgroundColor: theme.bg.deep, borderRadius: 20, padding: 20, marginBottom: 20 },
    heroOverline: {
      fontFamily: 'PlusJakartaSans-Bold', color: onDeep.faint, fontSize: 10, letterSpacing: 1.6,
    },
    heroName: {
      fontFamily: 'PlayfairDisplay-Bold', color: onDeep.primary, fontSize: 24, letterSpacing: -0.3,
      marginTop: 6, paddingVertical: 4,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    chip: { backgroundColor: onDeep.chip, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
    chipText: { fontFamily: 'PlusJakartaSans-Bold', color: onDeep.primary, fontSize: 11 },

    codeBox: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      paddingVertical: 18, alignItems: 'center', marginBottom: 10,
    },
    code: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 32, letterSpacing: 3 },
    primaryBtn: { ...btn.primaryBtn, marginTop: 4 },
    primaryText: btn.primaryText,
    secondaryBtn: { ...btn.secondaryBtn, marginBottom: 10 },
    secondaryText: btn.secondaryTextAccent,
    linkBtn: { alignItems: 'center', paddingVertical: 16 },
    linkText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
  });
}
