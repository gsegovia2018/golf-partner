import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '../../components/BottomSheet';
import StakesSheet from '../../components/StakesSheet';
import { scoringModeUsesTeams, isScrambleMode } from '../../components/scoringModes';
import { ScoringModeSheet, TeamsSettingsFields, BestBallValueFields } from '../../components/ScoringModePicker';
import { mutate } from '../../store/mutate';
import { reopenGame } from '../../store/reopenGame';
import { roundEndedAt } from '../../store/finishStamp';
import { roundScoringMode, buildTeamsForMode, roundBestBallValues } from '../../store/scoring';
import { useT } from '../../i18n';
import { showError, pairsPreviewText } from './homeShared';

// The game view's menus: the gear (game / tournament settings), the Round N
// sheet, and what they open — scoring mode, team settings, point values and
// stakes. GameView owns which of gear / Round N / stakes is open (its header,
// pager and settle-up card open them); the rest live here.
export default function GameSheets({
  navigation, viewMode, tournament, onTournamentChange, reload, confirmDelete,
  selectedRound, isGame, isViewer, isOwner, canHaveStakes, teamSettingsMode,
  showSettings, setShowSettings, showRoundEdit, setShowRoundEdit, showStakes, setShowStakes,
  theme, s,
}) {
  const tx = useT();
  const [showTeamSettings, setShowTeamSettings] = useState(false);
  const [showPointValues, setShowPointValues] = useState(false);
  // Strings — BestBallValueFields edits through TextInputs.
  const [pointValuesDraft, setPointValuesDraft] = useState(null);
  // Per-round "Scoring Mode" picker, opened from the Round N sheet.
  const [showRoundModeSheet, setShowRoundModeSheet] = useState(false);

  // Gear menu: every entry closes the menu and runs once it has gone, so
  // pages, sheets and actions all open the same way, never under the menu.
  const settingsActionRef = useRef(null);
  const fromSettings = (fn) => { settingsActionRef.current = fn; setShowSettings(false); };
  const runSettingsAction = () => {
    const fn = settingsActionRef.current;
    settingsActionRef.current = null;
    fn?.();
  };
  // The Round N sheet closes and runs its entry at once (it is a plain fade).
  const fromRoundSheet = (fn) => { setShowRoundEdit(false); fn(); };

  // Persist a per-round scoring-mode override from the Round N sheet's
  // "Scoring Mode" item. Rebuilds that round's pairs for the new mode (same
  // approach as the tournament-wide picker) and dispatches the dedicated
  // round.setScoringMode mutation rather than a whole-tournament write — this
  // is a single round's override, not a tournament-wide reset.
  async function saveRoundScoringMode(key) {
    const r = tournament.rounds?.[selectedRound];
    if (!r) return;
    try {
      const pairs = buildTeamsForMode(key, tournament.players);
      await mutate(tournament, {
        type: 'round.setScoringMode', roundId: r.id, scoringMode: key, pairs,
      });
      await reload();
      setShowRoundModeSheet(false);
    } catch (err) {
      showError(err?.message ?? tx('home.error.updateScoringMode'));
    }
  }

  // Persist the selected round's best/worst point values (round override).
  async function savePointValues() {
    const r = tournament.rounds?.[selectedRound];
    if (!r || !pointValuesDraft) return;
    try {
      await mutate(tournament, {
        type: 'round.setBestBallValues',
        roundId: r.id,
        bestBallValue: parseInt(pointValuesDraft.bestBallValue, 10) || 1,
        worstBallValue: parseInt(pointValuesDraft.worstBallValue, 10) || 1,
      });
      await reload();
      setShowPointValues(false);
    } catch (err) {
      showError(err?.message ?? tx('home.error.updatePointValues'));
    }
  }

  // Side-bet stakes (store/sideBets.js), replaced whole; null = no stakes.
  async function saveStakes(stakes) {
    try {
      await mutate(tournament, { type: 'tournament.setStakes', stakes });
      await reload();
      setShowStakes(false);
    } catch (err) {
      showError(err?.message ?? tx('stakes.error.save'));
    }
  }

  // Persist the gear sheet's team toggles. Tournament-wide by design —
  // fixedTeams/manualTeams shape how EVERY round builds its pairs. No eager
  // pair rebuilds: pairsForNextRound applies fixedTeams lazily at reveal.
  async function saveTeamSettings(next) {
    try {
      await mutate(tournament, {
        type: 'tournament.setTeamSettings',
        fixedTeams: Boolean(next.fixedTeams),
        manualTeams: Boolean(next.manualTeams),
      });
      await reload();
    } catch (err) {
      showError(err?.message ?? tx('home.error.updateTeamSettings'));
    }
  }

  // Archive or reopen the active tournament. Marking finished moves it off
  // the Home list onto the Finished screen; reopening clears the flag.
  async function setTournamentFinished(t, finished) {
    try {
      const updated = finished
        ? await mutate(t, { type: 'tournament.setFinished', finishedAt: new Date().toISOString() })
        : await reopenGame(t);
      onTournamentChange(updated);
      if (finished) {
        if (viewMode === 'tournament' && navigation.canGoBack()) navigation.goBack();
        else navigation.navigate('Main', { screen: 'Home', params: { viewMode: 'list' } });
      }
    } catch (err) {
      showError(err?.message ?? tx('home.error.updateTournament'));
    }
  }

  // Edit/Reveal Teams menu item — shared by the round-options sheet and the
  // tournament-settings sheet so the two stay in lockstep. Returns null for
  // individual / match-play modes, where every "pair" is a single player and
  // there is nothing to team up. `run` dismisses the host sheet.
  function renderTeamsMenuItem(run) {
    const r = tournament.rounds[selectedRound];
    // Teams exist only in a team scoring mode that the current roster can
    // actually support — so an unknown/legacy mode, or a game stuck on a
    // team mode with too few players, never wrongly shows team UI. Reads the
    // ROUND's effective mode (it may override the tournament default).
    if (!scoringModeUsesTeams(roundScoringMode(tournament, r), tournament.players.length)) return null;
    const alreadyRevealed = r?.revealed || selectedRound <= tournament.currentRound;
    // Editing pairs only makes sense for the standard two-team split. Modes
    // like scramble4 can produce a single team (everyone on one team), and
    // EditTeamsScreen only initializes when there are exactly two pairs —
    // with any other shape it renders null (a blank screen). Since there's
    // nothing to edit for a single team anyway, just hide the entry point.
    if (alreadyRevealed && r?.pairs?.length !== 2) return null;
    return alreadyRevealed ? (
      <TouchableOpacity
        style={s.menuItem}
        onPress={() => run(() => navigation.navigate('EditTeams', { roundIndex: selectedRound, tournamentId: tournament.id }))}
        activeOpacity={0.7}
      >
        <Feather name="users" size={14} color={theme.text.primary} />
        <Text style={s.menuItemText}>{tx('home.menu.editTeams')}</Text>
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </TouchableOpacity>
    ) : (
      <TouchableOpacity
        style={s.menuItem}
        onPress={() => run(() => navigation.navigate('NextRound', { revealOnly: true, roundIndex: selectedRound }))}
        activeOpacity={0.7}
      >
        <Feather name="eye" size={14} color={theme.text.primary} />
        <Text style={s.menuItemText}>{tx('home.menu.revealTeams')}</Text>
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </TouchableOpacity>
    );
  }

  // Point values are only meaningful for a Best Ball round. Rendered in the
  // per-round sheet (multi-round) and the gear sheet (single-round).
  function renderPointValuesMenuItem(run) {
    const r = tournament.rounds[selectedRound];
    if (isViewer || roundScoringMode(tournament, r) !== 'bestball') return null;
    const vals = roundBestBallValues(tournament, r);
    return (
      <TouchableOpacity
        style={s.menuItem}
        onPress={() => run(() => {
          setPointValuesDraft({
            bestBallValue: String(vals.bestBallValue),
            worstBallValue: String(vals.worstBallValue),
          });
          setShowPointValues(true);
        })}
        activeOpacity={0.7}
      >
        <Feather name="hash" size={14} color={theme.text.primary} />
        <Text style={s.menuItemText}>{tx('home.menu.pointValues')}</Text>
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </TouchableOpacity>
    );
  }

  function renderFinishItem() {
    const isGameKind = tournament.kind === 'game';
    // A game also ends when every player tapped Finish (no archive stamp).
    if (tournament.finishedAt || (isGameKind && roundEndedAt(tournament, tournament.rounds?.[0]) != null)) {
      return (
        <TouchableOpacity
          style={s.menuItem}
          onPress={() => fromSettings(() => setTournamentFinished(tournament, false))}
          activeOpacity={0.7}
        >
          <Feather name="rotate-ccw" size={14} color={theme.text.primary} />
          <Text style={s.menuItemText}>{tx(isGameKind ? 'home.settings.reopenGame' : 'home.settings.reopenTournament')}</Text>
          <Feather name="chevron-right" size={16} color={theme.text.muted} />
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity
        style={s.menuItem}
        onPress={() => fromSettings(() => setTournamentFinished(tournament, true))}
        activeOpacity={0.7}
      >
        <Feather name="flag" size={14} color={theme.text.primary} />
        <Text style={s.menuItemText}>{tx(isGameKind ? 'home.settings.finishGame' : 'home.settings.finishTournament')}</Text>
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </TouchableOpacity>
    );
  }

  return (
    <>
      <Modal statusBarTranslucent hardwareAccelerated
        visible={showRoundEdit}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRoundEdit(false)}
      >
        <Pressable style={s.modalBackdrop} onPress={() => setShowRoundEdit(false)}>
          <Pressable style={s.modalSheet} onPress={() => {}}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>{tx('home.round.sheetTitle', { n: selectedRound + 1 })}</Text>

            {/* Per-round sheet (multi-round only). Round-scoped actions live
                here; tournament-wide settings live in the gear menu. */}
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => setShowRoundModeSheet(true)}
              activeOpacity={0.7}
            >
              <Feather name="target" size={14} color={theme.text.primary} />
              <Text style={s.menuItemText}>{tx('home.round.scoringMode')}</Text>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
            {renderPointValuesMenuItem(fromRoundSheet)}
            {renderTeamsMenuItem(fromRoundSheet)}
          </Pressable>
        </Pressable>
      </Modal>

      <ScoringModeSheet
        visible={showRoundModeSheet}
        value={roundScoringMode(tournament, tournament.rounds?.[selectedRound])}
        playerCount={tournament.players.length}
        onSelect={saveRoundScoringMode}
        onClose={() => setShowRoundModeSheet(false)}
      />

      <BottomSheet visible={showSettings} onClose={() => setShowSettings(false)} onClosed={runSettingsAction} rise sheetStyle={s.modalSheet}>
        <View style={s.modalHandle} />
        <Text style={s.modalTitle}>{tx(tournament.kind === 'game' ? 'home.settings.titleGame' : 'home.settings.titleTournament')}</Text>

        {/* Teams are round-scoped. Single-round tournaments have no separate
            per-round sheet, so teams surface here; multi-round keeps them in
            the per-round (•••) sheet instead. */}
        {!isViewer && tournament.rounds.length === 1
          && renderTeamsMenuItem(fromSettings)}

        <TouchableOpacity
          style={s.menuItem}
          onPress={() => fromSettings(() => navigation.navigate('Stats', { tournamentId: tournament.id }))}
          activeOpacity={0.7}
        >
          <Feather name="bar-chart-2" size={14} color={theme.text.primary} />
          <Text style={s.menuItemText}>{tx('home.settings.statistics')}</Text>
          <Feather name="chevron-right" size={16} color={theme.text.muted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={s.menuItem}
          onPress={() => fromSettings(() => navigation.navigate('Players', {
            tournamentId: tournament.id,
            tournamentName: tournament.name,
          }))}
          activeOpacity={0.7}
        >
          <Feather name="users" size={14} color={theme.text.primary} />
          <Text style={s.menuItemText}>{tx('home.list.menuPlayers')}</Text>
          <Feather name="chevron-right" size={16} color={theme.text.muted} />
        </TouchableOpacity>

        {/* Scoring mode is round-scoped. Single-round games have no
            per-round sheet, so the round-scoped picker surfaces here;
            multi-round tournaments edit each round from its own sheet. */}
        {!isViewer && tournament.rounds.length === 1 && (
          <TouchableOpacity
            style={s.menuItem}
            onPress={() => fromSettings(() => setShowRoundModeSheet(true))}
            activeOpacity={0.7}
          >
            <Feather name="target" size={14} color={theme.text.primary} />
            <Text style={s.menuItemText}>{tx('home.round.scoringMode')}</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>
        )}

        {tournament.rounds.length === 1 && renderPointValuesMenuItem(fromSettings)}

        {!isViewer && canHaveStakes && (
          <TouchableOpacity
            style={s.menuItem}
            onPress={() => fromSettings(() => setShowStakes(true))}
            activeOpacity={0.7}
            testID="menu-stakes"
          >
            <Feather name="credit-card" size={14} color={theme.text.primary} />
            <Text style={s.menuItemText}>{tx('stakes.menu')}</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>
        )}

        {!isViewer && teamSettingsMode && (
          <TouchableOpacity
            style={s.menuItem}
            onPress={() => fromSettings(() => setShowTeamSettings(true))}
            activeOpacity={0.7}
          >
            <Feather name="users" size={14} color={theme.text.primary} />
            <Text style={s.menuItemText}>{tx('home.settings.teamSettings')}</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>
        )}

        {!isViewer && (
          <TouchableOpacity
            style={s.menuItem}
            onPress={() => fromSettings(() => navigation.navigate('EditTournament', {
              tournamentId: tournament.id,
              tournamentName: tournament.name,
            }))}
            activeOpacity={0.7}
          >
            <Feather name="edit-3" size={14} color={theme.text.primary} />
            <Text style={s.menuItemText}>{tx(tournament.rounds.length === 1 ? 'home.settings.editRound' : 'home.settings.editTournament')}</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>
        )}

        {!isViewer && renderFinishItem()}

        {isOwner && (
          <TouchableOpacity
            style={[s.menuItem, s.menuItemDestructive]}
            onPress={() => fromSettings(() => confirmDelete(tournament))}
            activeOpacity={0.7}
          >
            <Feather name="trash-2" size={14} color={theme.destructive} />
            <Text style={[s.menuItemText, { color: theme.destructive }]}>{tx(tournament.kind === 'game' ? 'home.delete.gameTitle' : 'home.delete.tournamentTitle')}</Text>
          </TouchableOpacity>
        )}
      </BottomSheet>

      <BottomSheet visible={showTeamSettings} onClose={() => setShowTeamSettings(false)} sheetStyle={s.modalSheet}>
        <View style={s.modalHandle} />
        <Text style={s.modalTitle}>{tx('home.settings.teamSettings')}</Text>
        <TeamsSettingsFields
          value={teamSettingsMode}
          playerCount={tournament.players.length}
          hideFixedTeams={isGame}
          settings={{
            fixedTeams: Boolean(tournament.settings?.fixedTeams),
            manualTeams: Boolean(tournament.settings?.manualTeams),
          }}
          onSettingsChange={saveTeamSettings}
        />
        {Boolean(tournament.settings?.fixedTeams) && tournament.rounds[0]?.pairs?.length === 2 && (
          <TouchableOpacity
            style={s.menuItem}
            onPress={() => { setShowTeamSettings(false); navigation.navigate('EditTeams', { roundIndex: 0, tournamentId: tournament.id }); }}
            activeOpacity={0.7}
          >
            <Feather name="edit-2" size={14} color={theme.text.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.menuItemTitle}>{tx('home.settings.editPairs')}</Text>
              <Text style={s.modalSubtle}>{pairsPreviewText(tournament)}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>
        )}
      </BottomSheet>

      <BottomSheet visible={showPointValues} onClose={() => setShowPointValues(false)} sheetStyle={s.modalSheet}>
        <View style={s.modalHandle} />
        <Text style={s.modalTitle}>{tx('home.pointValues.title', { n: selectedRound + 1 })}</Text>
        {pointValuesDraft && (
          <>
            <BestBallValueFields settings={pointValuesDraft} onSettingsChange={setPointValuesDraft} />
            <TouchableOpacity
              style={[s.menuItem, { borderBottomWidth: 0, justifyContent: 'center' }]}
              onPress={savePointValues}
              activeOpacity={0.7}
            >
              <Feather name="check" size={14} color={theme.text.primary} />
              <Text style={s.menuItemText}>{tx('home.pointValues.save')}</Text>
            </TouchableOpacity>
          </>
        )}
      </BottomSheet>

      {canHaveStakes && (
        <StakesSheet
          visible={showStakes}
          value={tournament.settings?.stakes}
          playerCount={tournament.players.length}
          noSkins={tournament.rounds.every((r) => isScrambleMode(roundScoringMode(tournament, r)))}
          onSave={saveStakes}
          onClose={() => setShowStakes(false)}
        />
      )}
    </>
  );
}
