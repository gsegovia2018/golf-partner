// The scorecard screen's chrome: header, status screens, banners, the notes
// and official-leaderboard sheets and the round-complete overlay. Presentational
// only; every value and handler comes from ScorecardScreen, which also passes
// its memoised styles `s` and `theme`.
import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import IconButton from '../ui/IconButton';
import BottomSheet from '../BottomSheet';
import { useT, tr, formatNumber } from '../../i18n';

// Loading / load-failed screen: never a blank screen, always a working back
// button. `error` shows the retry state; otherwise a spinner.
export function ScorecardStatus({ s, theme, onBack, error, onRetry }) {
  const tl = useT();
  return (
    <>
      <View style={s.header}>
        <IconButton icon="chevron-left" onPress={onBack} accessibilityLabel={tl('common.back')} />
        <Text style={s.headerTitle}>{tl('scorecard.screen.title')}</Text>
        <View style={{ width: 36 }} />
      </View>
      {error ? (
        <View style={s.statusCenter}>
          <Feather name="alert-circle" size={44} color={theme.text.muted} />
          <Text style={s.statusTitle}>{tl('scorecard.screen.loadErrorTitle')}</Text>
          <Text style={s.statusSubtitle}>
            {tl('scorecard.screen.loadErrorBody')}
          </Text>
          <TouchableOpacity style={s.statusRetryBtn} onPress={onRetry} activeOpacity={0.8}>
            <Feather name="rotate-ccw" size={14} color={theme.text.inverse} />
            <Text style={s.statusRetryText}>{tl('scorecard.screen.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.statusCenter}>
          <ActivityIndicator color={theme.accent.primary} />
          <Text style={s.statusSubtitle}>{tl('scorecard.screen.loading')}</Text>
        </View>
      )}
    </>
  );
}

// Header with compact scorecard view switch.
export function ScorecardHeader({
  s, theme, onBack, syncStatus, saveError, onOpenSync,
  showEditRound, onEditRound, view, onToggleView,
  showLeaderboard, onOpenLeaderboard,
  showNotesControls, hasCurrentNotes, onOpenNotes,
  showFlagFinder, onOpenFlagFinder, leagueLayer, onAttachMemory,
}) {
  const tl = useT();
  const viewSwitchLabel = view === 'hole'
    ? tl('scorecard.screen.viewFull')
    : tl('scorecard.screen.viewHoles');
  const viewSwitchIcon = view === 'hole' ? 'grid' : 'circle';
  return (
    <View style={s.header}>
      <IconButton icon="chevron-left" onPress={onBack} accessibilityLabel={tl('common.back')} />
      <Text style={s.headerTitle}>{tl('scorecard.screen.title')}</Text>
      <View style={s.headerRight}>
        <IconButton
          onPress={onOpenSync}
          accessibilityLabel={tl('scorecard.screen.syncStatus')}
        >
          <SyncIndicator status={syncStatus} saveError={saveError} theme={theme} s={s} />
        </IconButton>
        {showEditRound && (
          <TouchableOpacity
            onPress={onEditRound}
            style={s.editRoundBtn}
            accessibilityRole="button"
            accessibilityLabel={tl('scorecard.screen.editRound')}
          >
            <Feather name="edit-2" size={14} color={theme.accent.primary} style={{ marginRight: 4 }} />
            <Text style={s.editRoundBtnText}>{tl('scorecard.screen.editRound')}</Text>
          </TouchableOpacity>
        )}
        <IconButton
          icon={viewSwitchIcon}
          onPress={onToggleView}
          accessibilityLabel={viewSwitchLabel}
        />
        {showLeaderboard && (
          <IconButton
            icon="award"
            onPress={onOpenLeaderboard}
            accessibilityLabel={tl('scorecard.screen.officialBoard')}
          />
        )}
        {showNotesControls && (
          <IconButton
            icon={hasCurrentNotes ? 'edit-3' : 'edit-2'}
            onPress={onOpenNotes}
            dot={hasCurrentNotes}
            accessibilityLabel={hasCurrentNotes ? tl('scorecard.screen.openNotes') : tl('scorecard.screen.addNotes')}
          />
        )}
        {showFlagFinder && (
          <IconButton
            icon="flag"
            onPress={onOpenFlagFinder}
            accessibilityLabel={tl('scorecard.screen.findFlag')}
          />
        )}
        {leagueLayer.canCountMine && (
          <IconButton
            icon="award"
            onPress={leagueLayer.countMine}
            accessibilityLabel={tl('league.header.countMine', { league: leagueLayer.optIn.league.name })}
          />
        )}
        <IconButton
          icon="camera"
          onPress={onAttachMemory}
          accessibilityLabel={tl('scorecard.screen.attachMemory')}
        />
      </View>
    </View>
  );
}

// Compact header sync/error indicator. Reflects the store's sync status and
// flips to an explicit error dot when a local save fails.
function SyncIndicator({ status, saveError, theme, s }) {
  const tl = useT();
  if (saveError || status === 'error') {
    return (
      <View style={s.syncDot} accessibilityLabel={tl('scorecard.screen.syncError')}>
        <Feather name="alert-circle" size={14} color={theme.destructive} />
      </View>
    );
  }
  if (status === 'syncing') {
    return (
      <View style={s.syncDot} accessibilityLabel={tl('scorecard.screen.syncing')}>
        <ActivityIndicator size="small" color={theme.text.muted} />
      </View>
    );
  }
  if (status === 'pending') {
    return (
      <View style={s.syncDot} accessibilityLabel={tl('scorecard.screen.syncPending')}>
        <Feather name="cloud" size={14} color={theme.text.muted} />
      </View>
    );
  }
  return (
    <View style={s.syncDot} accessibilityLabel={tl('scorecard.screen.synced')}>
      <Feather name="check-circle" size={14} color={theme.accent.primary} />
    </View>
  );
}

export function SaveErrorBanner({ s, theme, onRetry, onDismiss }) {
  const tl = useT();
  return (
    <View style={s.saveErrorBanner}>
      <Feather name="alert-triangle" size={14} color={theme.text.inverse} />
      <Text style={s.saveErrorText}>
        {tl('scorecard.screen.saveErrorBody')}
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        accessibilityLabel={tl('scorecard.screen.retrySaving')}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={s.saveErrorAction}>{tl('scorecard.screen.retry')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onDismiss}
        accessibilityLabel={tl('scorecard.screen.dismiss')}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Feather name="x" size={14} color={theme.text.inverse} />
      </TouchableOpacity>
    </View>
  );
}

// `notice` is a roundDecisionNoticeForPair descriptor (rendered with tr).
export function RoundDecisionBanner({ s, theme, notice, onDismiss }) {
  const tl = useT();
  return (
    <View
      style={s.roundDecisionBanner}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={s.roundDecisionIconWrap}>
        <Feather name="award" size={17} color={theme.accent.primary} />
      </View>
      <View style={s.roundDecisionCopy}>
        <Text style={s.roundDecisionTitle}>{tr(notice.title)}</Text>
        <Text style={s.roundDecisionMessage}>{tr(notice.message)}</Text>
      </View>
      <TouchableOpacity
        onPress={onDismiss}
        style={s.roundDecisionCloseBtn}
        accessibilityRole="button"
        accessibilityLabel={tl('scorecard.screen.dismissRoundDecided')}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Feather name="x" size={16} color={theme.text.secondary} />
      </TouchableOpacity>
    </View>
  );
}

// Notes modal — per-hole note + shared round note.
export function NotesSheet({
  s, theme, visible, onClose, currentHole, holeNote, roundNote, onHoleNote, onRoundNote,
}) {
  const tl = useT();
  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.notesSheet}>
      <View style={s.notesHandle} />
      <View style={s.notesHeader}>
        <Text style={s.notesTitle}>{tl('scorecard.screen.notes')}</Text>
        <IconButton icon="x" onPress={onClose} />
      </View>
      <Text style={s.notesFieldLabel}>{tl('scorecard.screen.notesHole', { hole: formatNumber(currentHole) })}</Text>
      <TextInput
        style={s.notesModalInputCompact}
        placeholder={tl('scorecard.screen.notesHolePlaceholder', { hole: formatNumber(currentHole) })}
        placeholderTextColor={theme.text.muted}
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        selectionColor={theme.accent.primary}
        multiline
        value={holeNote}
        onChangeText={onHoleNote}
      />
      <Text style={[s.notesFieldLabel, s.notesFieldLabelSpaced]}>{tl('scorecard.screen.roundLabel')}</Text>
      <TextInput
        style={s.notesModalInputCompact}
        placeholder={tl('scorecard.screen.roundPlaceholder')}
        placeholderTextColor={theme.text.muted}
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        selectionColor={theme.accent.primary}
        multiline
        value={roundNote}
        onChangeText={onRoundNote}
      />
    </BottomSheet>
  );
}

export function RoundCompleteOverlay({ s, theme }) {
  const tl = useT();
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={s.roundCompleteRoot}
    >
      <View style={s.roundCompleteScrim} />
      <View style={s.roundCompleteCard}>
        <View style={s.roundCompleteIconWrap}>
          <Feather name="flag" size={26} color={theme.accent.primary} />
        </View>
        <Text style={s.roundCompleteEyebrow}>{tl('scorecard.screen.roundComplete')}</Text>
        <Text style={s.roundCompleteTitle}>{tl('scorecard.screen.niceRound')}</Text>
      </View>
    </View>
  );
}

// Official leaderboard (Task 17). Official-only; built from the flat
// members / scores lists via buildLeaderboard, ranked by NET Stableford
// points (Task 7). Holes still in discrepancy are excluded from both gross
// and points, and flag the row below.
export function OfficialLeaderboardSheet({ s, visible, onClose, rows }) {
  const tl = useT();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      sheetStyle={s.notesSheet}
    >
      <View style={s.notesHandle} />
      <View style={s.notesHeader}>
        <Text style={s.notesTitle}>{tl('scorecard.screen.leaderboard')}</Text>
        <IconButton
          icon="x"
          onPress={onClose}
          accessibilityLabel={tl('scorecard.screen.closeLeaderboard')}
        />
      </View>
      {rows.length === 0 ? (
        <Text style={s.statusSubtitle}>{tl('scorecard.screen.noScores')}</Text>
      ) : (
        <ScrollView style={s.officialLbList}>
          {rows.map((row, i) => (
            <View key={row.rosterId} style={s.officialLbRow}>
              <Text style={s.officialLbRank}>{i + 1}</Text>
              <Text style={s.officialLbName} numberOfLines={1}>
                {row.name}
                {row.discrepancy ? ' ⚠' : ''}
              </Text>
              <Text style={s.officialLbThru}>
                {row.thru > 0 ? tl('scorecard.screen.thruGross', { thru: formatNumber(row.thru), gross: formatNumber(row.gross) }) : '—'}
              </Text>
              <Text style={s.officialLbGross}>{tl('scorecard.screen.pts', { points: formatNumber(row.points) })}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </BottomSheet>
  );
}
