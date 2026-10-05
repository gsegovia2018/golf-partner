import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Alert, Platform, Share, Clipboard, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import WizardProgress from '../components/setup/WizardProgress';
import WizardNav from '../components/setup/WizardNav';
import PostCreateInviteModal from '../components/PostCreateInviteModal';
import DateField from '../components/DateField';
import { wizardSteps, isStepValid } from './setupWizard';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { loadProfile } from '../store/profileStore';
import { listFriends, getCachedFriends } from '../store/friendStore';
import { createLeague } from '../store/leagueStore';
import { DEFAULT_POINTS_TABLE } from '../store/leagueStandings';
import {
  DEFAULT_HANDICAP_CAP, defaultSeason, parseIsoDate, parsePointsTable, formatPointsTable,
  parseFeeCents, defaultMemberHandicap, parseMemberHandicap, buildCreateArgs, leagueJoinLink,
} from '../store/leagueDraft';
import { formatEuros } from '../store/leagueView';
import { shareOrigin } from '../lib/shareOrigin';

function showError(message) {
  const msg = message || 'Something went wrong';
  if (Platform.OS === 'web') window.alert(msg);
  else Alert.alert('Error', msg);
}

const fmtDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${names[Number(m[2]) - 1]} ${m[1]}`;
};

// Create-a-league wizard: name and season, rules, members, review. Online
// only (createLeague is an RPC). Plan: docs/superpowers/plans/2026-10-04-league.md.
export default function LeagueCreateScreen({ navigation }) {
  const { theme } = useTheme();
  const { user } = useAuth();
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
  const [profile, setProfile] = useState(null);
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  // userId -> handicap text, for each friend picked.
  const [picked, setPicked] = useState({});
  const [myHcpText, setMyHcpText] = useState('');
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
  const memberCount = 1 + Object.keys(picked).length;

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
      ];
      const result = await createLeague(buildCreateArgs({
        name, seasonStart: startIso, seasonEnd: endIso, pointsTable, cap: effectiveCap,
        feeCents: feeCents ?? 0, members,
      }));
      if (mountedRef.current) setCreated(result);
    } catch (e) {
      creatingRef.current = false;
      showError(e?.message || "Couldn't create the league. Please try again.");
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
      await Share.share({ message: `Join "${name.trim()}" on Golf Partner:\n${link}` });
    } catch (err) {
      showError(err?.message ?? 'Could not share the invite link');
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
      <Text style={s.stepOverline}>LEAGUE</Text>
      <Text style={s.stepPrompt}>What's the league called?</Text>
      <Text style={s.stepSubtitle}>Members see this name on the board, in the feed and in emails.</Text>
      <Text style={s.fieldLabel}>League name</Text>
      {input({ placeholder: 'El Club del Mulligan', value: name, onChangeText: setName, autoFocus: false })}
      <Text style={s.fieldLabel}>Season starts</Text>
      <DateField label="Season starts" value={seasonStart} onChange={setSeasonStart} />
      <Text style={s.fieldLabel}>Season ends</Text>
      <DateField label="Season ends" value={seasonEnd} onChange={setSeasonEnd} min={startIso || undefined} />
      {startIso && endIso && startIso > endIso && (
        <Text style={s.errorText}>The season must end after it starts.</Text>
      )}
    </>
  );

  const ruleRow = (icon, title, sub, last) => (
    <View style={[s.ruleRow, !last && s.rowDivider]}>
      <Feather name={icon} size={16} color={theme.accent.primary} style={s.ruleIcon} />
      <View style={{ flex: 1 }}>
        <Text style={s.ruleTitle}>{title}</Text>
        <Text style={s.ruleSub}>{sub}</Text>
      </View>
    </View>
  );

  const renderRulesStep = () => (
    <>
      <Text style={s.stepOverline}>RULES</Text>
      <Text style={s.stepPrompt}>How does it work?</Text>
      <Text style={s.stepSubtitle}>Set up like your group's rules.</Text>
      <View style={s.card}>
        {ruleRow('calendar', 'One card a month', '18 holes, any course. Declare before the first shot.')}
        {ruleRow('target', 'Net Stableford', `Each member's league handicap, max ${effectiveCap}`, true)}
      </View>

      <Text style={s.fieldLabel}>Points table (1st, 2nd, 3rd…)</Text>
      {input({ value: pointsText, onChangeText: setPointsText, autoCapitalize: 'none', keyboardType: 'numbers-and-punctuation' })}
      <Text style={s.hint}>Ties share the summed points equally. No card scores 0.</Text>
      {!pointsTable && <Text style={s.errorText}>Enter whole numbers separated by commas.</Text>}

      <Text style={s.fieldLabel}>Handicap cap</Text>
      {input({ value: capText, onChangeText: setCapText, keyboardType: 'decimal-pad' })}
      {!(Number.isFinite(cap) && cap >= 0 && cap <= 54) && (
        <Text style={s.errorText}>The cap must be between 0 and 54.</Text>
      )}

      <Text style={s.fieldLabel}>Entry fee (€)</Text>
      {input({ placeholder: '0', value: feeText, onChangeText: setFeeText, keyboardType: 'decimal-pad' })}
      <Text style={s.hint}>Tracking only: the admin marks who has paid. Nothing is charged in the app.</Text>
      {feeCents == null && <Text style={s.errorText}>Enter an amount like 30 or 12,50.</Text>}
    </>
  );

  const renderMembersStep = () => (
    <>
      <Text style={s.stepOverline}>MEMBERS</Text>
      <Text style={s.stepPrompt}>Who's playing?</Text>
      <Text style={s.stepSubtitle}>
        {`Set each league handicap (max ${effectiveCap}). Members can propose a change when they join. Others can join later from the invite link.`}
      </Text>

      <View style={s.memberCard}>
        <View style={{ flex: 1 }}>
          <Text style={s.memberName}>{`You${profile?.displayName ? ` (${profile.displayName})` : ''}`}</Text>
          <Text style={s.memberSub}>Admin</Text>
        </View>
        <TextInput
          style={s.hcpInput}
          value={myHcpText}
          onChangeText={setMyHcpText}
          placeholder="HCP"
          placeholderTextColor={theme.text.muted}
          keyboardType="decimal-pad"
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          accessibilityLabel="Your league handicap"
        />
      </View>

      {friendsLoading && <ActivityIndicator color={theme.accent.primary} style={{ marginVertical: 12 }} />}
      {!friendsLoading && friends.length === 0 && (
        <View style={s.emptyHint}>
          <Feather name="users" size={14} color={theme.text.muted} style={{ marginRight: 8 }} />
          <Text style={s.emptyHintText}>No friends yet. Create the league and share the invite link.</Text>
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
              <View style={[s.check, on && s.checkOn]}>
                {on && <Feather name="check" size={12} color={theme.text.inverse} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.memberName} numberOfLines={1}>{f.displayName}</Text>
                <Text style={s.memberSub}>{f.handicap != null ? `Profile HCP ${f.handicap}` : 'From your friends'}</Text>
              </View>
            </TouchableOpacity>
            {on && (
              <TextInput
                style={s.hcpInput}
                value={picked[f.userId]}
                onChangeText={(text) => setPicked((prev) => ({ ...prev, [f.userId]: text }))}
                placeholder="HCP"
                placeholderTextColor={theme.text.muted}
                keyboardType="decimal-pad"
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                accessibilityLabel={`${f.displayName} league handicap`}
              />
            )}
          </View>
        );
      })}
    </>
  );

  const renderReviewStep = () => (
    <>
      <View style={s.hero}>
        <Text style={s.heroOverline}>REVIEW & CONFIRM</Text>
        <TextInput
          style={s.heroName}
          value={name}
          onChangeText={setName}
          placeholder="League name"
          placeholderTextColor="rgba(255,255,255,0.5)"
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          selectionColor="#ffffff"
        />
        <View style={s.chipRow}>
          <View style={s.chip}><Text style={s.chipText}>{`${memberCount} member${memberCount === 1 ? '' : 's'}`}</Text></View>
          <View style={s.chip}><Text style={s.chipText}>Net Stableford</Text></View>
        </View>
      </View>

      <Text style={s.stepOverline}>TAP TO EDIT</Text>
      <View style={s.card}>
        <TouchableOpacity style={[s.reviewRow, s.rowDivider]} onPress={() => goToStep('name')}>
          <Feather name="calendar" size={14} color={theme.text.primary} style={s.reviewIcon} />
          <View style={{ flex: 1 }}>
            <Text style={s.ruleTitle}>Season</Text>
            <Text style={s.ruleSub}>{`${fmtDate(startIso)} – ${fmtDate(endIso)}`}</Text>
          </View>
          <Feather name="chevron-right" size={18} color={theme.text.muted} />
        </TouchableOpacity>
        <TouchableOpacity style={[s.reviewRow, s.rowDivider]} onPress={() => goToStep('rules')}>
          <Feather name="list" size={14} color={theme.text.primary} style={s.reviewIcon} />
          <View style={{ flex: 1 }}>
            <Text style={s.ruleTitle}>Rules</Text>
            <Text style={s.ruleSub} numberOfLines={2}>
              {`One card a month · cap ${effectiveCap} · ${feeCents ? `entry ${formatEuros(feeCents)}` : 'no entry fee'} · ${formatPointsTable(pointsTable)}`}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={theme.text.muted} />
        </TouchableOpacity>
        <TouchableOpacity style={s.reviewRow} onPress={() => goToStep('members')}>
          <Feather name="users" size={14} color={theme.text.primary} style={s.reviewIcon} />
          <View style={{ flex: 1 }}>
            <Text style={s.ruleTitle}>Members</Text>
            <Text style={s.ruleSub}>
              {memberCount === 1 ? 'Just you for now' : `You and ${memberCount - 1} friend${memberCount === 2 ? '' : 's'}`}
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
          <View style={s.hero}>
            <Text style={s.heroOverline}>LEAGUE CREATED</Text>
            <Text style={[s.heroName, { paddingVertical: 4 }]}>{name.trim()}</Text>
            <View style={s.chipRow}>
              <View style={s.chip}><Text style={s.chipText}>{`${memberCount} member${memberCount === 1 ? '' : 's'}`}</Text></View>
              <View style={s.chip}><Text style={s.chipText}>{`${fmtDate(startIso)} – ${fmtDate(endIso)}`}</Text></View>
              <View style={s.chip}><Text style={s.chipText}>Net Stableford</Text></View>
            </View>
          </View>

          <Text style={s.stepOverline}>INVITE CODE</Text>
          <View style={s.codeBox}>
            <Text style={s.code} selectable>{created.inviteCode}</Text>
          </View>
          <Text style={s.hint}>
            Friends join from the link or with Join with code. Show them the QR if they are next to you.
          </Text>

          <TouchableOpacity style={s.secondaryBtn} onPress={copyLink} activeOpacity={0.8}>
            <Feather name={copied ? 'check' : 'link'} size={16} color={theme.accent.primary} style={{ marginRight: 8 }} />
            <Text style={s.secondaryText}>{copied ? 'Copied' : 'Copy link'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} onPress={() => setShowQr(true)} activeOpacity={0.8}>
            <Feather name="grid" size={16} color={theme.accent.primary} style={{ marginRight: 8 }} />
            <Text style={s.secondaryText}>Show QR</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.primaryBtn} onPress={shareLink} activeOpacity={0.8}>
            <Feather name="share-2" size={16} color={theme.text.inverse} style={{ marginRight: 8 }} />
            <Text style={s.primaryText}>Share invite</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.linkBtn}
            onPress={() => navigation.replace('LeagueBoard', { leagueId: created.id })}
            activeOpacity={0.7}
          >
            <Text style={s.linkText}>Open the league</Text>
          </TouchableOpacity>
        </ScrollView>

        <PostCreateInviteModal
          visible={showQr}
          loading={false}
          link={link}
          error={null}
          onRequestClose={() => setShowQr(false)}
          onShare={shareLink}
          title="Invite to the league"
          subtitle="Show this QR to friends, or share the link. They see the league and its rules, then join."
        />
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
        nextLabel={isLastStep ? 'Create league' : 'Next'}
        onBack={handleBack}
        onNext={handleNext}
      />
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  const cardBorder = theme.isDark ? theme.glass?.border : theme.border.default;
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
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
      color: theme.text.primary, borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
      padding: 14, marginBottom: 8, fontSize: 15, fontFamily: 'PlusJakartaSans-Medium',
    },
    hint: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, lineHeight: 17, marginBottom: 8,
    },
    errorText: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 12, marginBottom: 8,
    },

    card: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      overflow: 'hidden', marginBottom: 12, ...(theme.isDark ? {} : theme.shadow.card),
    },
    rowDivider: { borderBottomWidth: 1, borderBottomColor: theme.border.subtle },
    ruleRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
    ruleIcon: { marginRight: 12 },
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
    check: {
      width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: theme.border.default,
      alignItems: 'center', justifyContent: 'center', marginRight: 12,
    },
    checkOn: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    hcpInput: {
      width: 64, textAlign: 'center', color: theme.text.primary, borderRadius: 10, borderWidth: 1,
      borderColor: theme.border.default, backgroundColor: theme.bg.secondary, paddingVertical: 8,
      fontSize: 14, fontFamily: 'PlusJakartaSans-Bold', marginLeft: 8,
    },
    emptyHint: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bg.secondary, borderRadius: 12,
      borderWidth: 1, borderColor: theme.border.default, borderStyle: 'dashed', padding: 14, marginBottom: 8,
    },
    emptyHintText: { flex: 1, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 13 },

    // Same deep-green hero as the official wizard's review step; theme.bg.deep
    // is dark in both themes, so white text keeps its contrast.
    hero: { backgroundColor: theme.bg.deep, borderRadius: 20, padding: 20, marginBottom: 20 },
    heroOverline: {
      fontFamily: 'PlusJakartaSans-Bold', color: 'rgba(255,255,255,0.55)', fontSize: 10, letterSpacing: 1.6,
    },
    heroName: {
      fontFamily: 'PlayfairDisplay-Bold', color: '#ffffff', fontSize: 24, letterSpacing: -0.3,
      marginTop: 6, paddingVertical: 4,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    chip: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
    chipText: { fontFamily: 'PlusJakartaSans-Bold', color: '#ffffff', fontSize: 11 },

    codeBox: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      paddingVertical: 18, alignItems: 'center', marginBottom: 10,
    },
    code: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 32, letterSpacing: 3 },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.primary, borderRadius: 14, paddingVertical: 14, marginTop: 4,
    },
    primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },
    secondaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14,
      borderWidth: 1, borderColor: theme.border.default, paddingVertical: 14, marginBottom: 10,
    },
    secondaryText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
    linkBtn: { alignItems: 'center', paddingVertical: 16 },
    linkText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
  });
}
