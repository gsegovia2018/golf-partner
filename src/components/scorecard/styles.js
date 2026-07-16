import { StyleSheet } from 'react-native';

// Shared StyleSheet for the scorecard screen and the scorecard/* components.
export function makeScorecardStyles(theme) {
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    flex: { flex: 1 },

    // Save-failure banner
    saveErrorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: theme.destructive,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    saveErrorText: {
      ...theme.typography.caption,
      color: theme.text.inverse,
      fontWeight: '700',
      flex: 1,
    },
    saveErrorAction: {
      ...theme.typography.caption,
      color: theme.text.inverse,
      fontWeight: '800',
      textDecorationLine: 'underline',
    },
    roundDecisionBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      marginHorizontal: 12,
      marginTop: 8,
      paddingVertical: 11,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.accent.primary + '40',
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.accent.light,
    },
    roundDecisionIconWrap: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.isDark ? theme.accent.primary + '22' : theme.bg.card,
      borderWidth: 1,
      borderColor: theme.accent.primary + '30',
    },
    roundDecisionCopy: {
      flex: 1,
      gap: 2,
    },
    roundDecisionTitle: {
      color: theme.text.primary,
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-Bold',
    },
    roundDecisionMessage: {
      color: theme.text.secondary,
      fontSize: 12,
      lineHeight: 17,
      fontFamily: 'PlusJakartaSans-Medium',
    },
    roundDecisionCloseBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // Header sync/error indicator
    syncDot: {
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // Loading / error states (replace the bare null returns)
    statusCenter: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: 32,
    },
    statusTitle: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 18,
      color: theme.text.primary,
      textAlign: 'center',
    },
    statusSubtitle: {
      fontFamily: 'PlusJakartaSans-Regular',
      fontSize: 13,
      color: theme.text.muted,
      textAlign: 'center',
    },
    statusRetryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.accent.primary,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 22,
      marginTop: 6,
    },
    statusRetryText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.inverse,
      fontSize: 14,
    },

    // Round-complete celebration overlay (shown before the round summary)
    roundCompleteRoot: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    roundCompleteScrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    roundCompleteCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: theme.accent.primary,
      paddingVertical: 28,
      paddingHorizontal: 36,
      alignItems: 'center',
      gap: 6,
    },
    roundCompleteIconWrap: {
      width: 56,
      height: 56,
      borderRadius: 28,
      borderWidth: 2,
      borderColor: theme.accent.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
    },
    roundCompleteEyebrow: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 11,
      letterSpacing: 2,
      color: theme.accent.primary,
    },
    roundCompleteTitle: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 24,
      color: theme.text.primary,
    },

    // Header
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 10,
      backgroundColor: theme.bg.primary,
      borderBottomWidth: 1,
      borderBottomColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    cameraBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    notesHeaderBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    notesHeaderDot: {
      position: 'absolute',
      top: 5,
      right: 5,
      width: 7,
      height: 7,
      borderRadius: 999,
      backgroundColor: theme.accent.primary,
      borderWidth: 1,
      borderColor: theme.bg.primary,
    },
    headerTitle: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 17,
      color: theme.text.primary,
      letterSpacing: -0.3,
    },

    // Compact scorecard view switcher.
    viewSwitchBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },

    // "Edit round" pill — header affordance that unlocks a finished round.
    editRoundBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.accent.light,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.accent.primary + '40',
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    editRoundBtnText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.accent.primary,
      fontSize: 12,
    },

    // Hole view header card
    holeHeaderCard: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: theme.bg.card,
      borderBottomWidth: 1,
      borderBottomColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingHorizontal: 20,
      paddingVertical: 14,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    holeHeaderLeft: { gap: 2, flex: 1, minWidth: 0 },
    holeHeaderRightWrap: { flexShrink: 0 },
    holeHeaderRound: {
      color: theme.text.muted,
      fontSize: 11,
      fontFamily: 'PlusJakartaSans-SemiBold',
      letterSpacing: 0.5,
    },
    holeNumberRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    holeNumberLabel: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
    },
    holeNumber: {
      color: theme.text.primary,
      fontSize: 44,
      fontFamily: 'PlayfairDisplay-Black',
      lineHeight: 48,
      letterSpacing: -1,
    },
    holeHeaderRight: { flexDirection: 'row', gap: 20 },
    holeMetaItem: { alignItems: 'center', gap: 4 },
    holeMetaLabel: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
    },
    holeMetaValue: {
      color: theme.text.primary,
      fontSize: 22,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },

    // Hole navigation
    holeNav: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: theme.bg.primary,
      gap: 8,
    },
    holeNavBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: theme.bg.card,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    holeNavBtnDisabled: { opacity: 0.3 },
    holeNavBtnText: {
      color: theme.accent.primary,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 13,
    },
    holeNavBtnTextDisabled: { color: theme.text.muted },

    // Player cards (must fit 4 + 2 pair labels with no inner scroll)
    playerCardsContent: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, gap: 10 },
    pairLabel: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.8,
      marginBottom: 4,
      marginLeft: 2,
      textTransform: 'uppercase',
    },
    playerCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingVertical: 12,
      paddingHorizontal: 14,
      overflow: 'hidden',
      ...(theme.isDark ? {} : theme.shadow.card),
    },

    // Full-scorecard celebration overlay
    celebrationRoot: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
      elevation: 50,
    },
    celebrationScrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: '#000',
    },
    celebrationCard: {
      minWidth: 240,
      paddingVertical: 22,
      paddingHorizontal: 28,
      borderRadius: 22,
      borderWidth: 1.5,
      backgroundColor: '#003d27', // Augusta deep green
      alignItems: 'center',
      shadowOpacity: 0.55,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 8 },
      elevation: 18,
    },
    celebrationRing: {
      position: 'absolute',
      width: 260,
      height: 260,
      borderRadius: 130,
      borderWidth: 2,
      left: '50%',
      top: '50%',
      marginLeft: -130,
      marginTop: -130,
    },
    celebrationIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
      backgroundColor: 'rgba(255,255,255,0.05)',
    },
    celebrationEyebrow: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 10,
      letterSpacing: 3,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    celebrationLabelBig: {
      color: '#ffffff',
      fontSize: 34,
      fontFamily: 'PlayfairDisplay-Black',
      letterSpacing: 2,
      textAlign: 'center',
      marginBottom: 8,
    },
    celebrationSubtitle: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-Medium',
      letterSpacing: 0.6,
      textAlign: 'center',
    },

    // Pair winner badge (above totals strip / match panel)
    winnerBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: theme.isDark ? 'rgba(255,215,0,0.14)' : 'rgba(255,215,0,0.18)',
      borderWidth: 1,
      borderColor: 'rgba(255,215,0,0.45)',
      marginBottom: 8,
    },
    winnerBadgeText: {
      color: theme.isDark ? '#ffd700' : '#8a6d00',
      fontSize: 10,
      letterSpacing: 1.5,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      textTransform: 'uppercase',
    },
    matchPanelNameWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    pickupBtn: {
      width: 30,
      height: 30,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pickupBtnActive: {
      borderColor: theme.accent.primary,
      backgroundColor: theme.accent.primary,
    },
    stepBtn: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scoreDisplay: { width: 52, alignItems: 'center' },
    scoreDisplayNum: {
      color: theme.text.primary,
      fontSize: 26,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      lineHeight: 28,
    },
    scoreDisplayNumEmpty: {
      color: theme.text.muted,
      fontSize: 26,
      lineHeight: 28,
    },
    scoreDisplayPts: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      marginTop: 1,
    },

    // Bottom bar (hole nav + actions row)
    bottomBar: {
      backgroundColor: theme.bg.primary,
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    bottomActionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 12,
    },
    notesPillBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
    },
    notesPillBtnText: {
      color: theme.text.muted,
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-SemiBold',
    },
    notesPillBtnTextActive: { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-Bold' },
    quickFinishBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.semantic.masters.red,
      backgroundColor: theme.semantic.masters.red,
    },
    quickFinishBtnText: {
      color: theme.text.inverse,
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-Bold',
    },

    // Notes modal (bottom sheet)
    notesModalKav: { flex: 1, justifyContent: 'flex-end' },
    notesBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    notesSheet: {
      backgroundColor: theme.bg.primary,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 10,
      paddingBottom: 24,
      paddingHorizontal: 16,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: theme.border.default,
    },
    notesHandle: {
      alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
      backgroundColor: theme.border.default, marginBottom: 12,
    },
    notesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    notesTitle: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 16,
    },
    notesCloseBtn: {
      width: 32, height: 32, borderRadius: 16,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
    },
    // Official leaderboard sheet (Task 17).
    officialLbList: { maxHeight: 360 },
    officialLbRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.border.default,
    },
    officialLbRank: {
      width: 28,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 15,
      color: theme.text.secondary,
    },
    officialLbName: {
      flex: 1,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 15,
      color: theme.text.primary,
    },
    officialLbThru: {
      fontFamily: 'PlusJakartaSans-Regular',
      fontSize: 13,
      color: theme.text.muted,
      marginRight: 14,
    },
    officialLbGross: {
      minWidth: 36,
      textAlign: 'right',
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 16,
      color: theme.text.primary,
    },
    // Note input used in the notes bottom sheet (one per hole / round field).
    notesModalInputCompact: {
      minHeight: 96,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.card,
      color: theme.text.primary,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border.default,
      padding: 14,
      fontSize: 14,
      fontFamily: 'PlusJakartaSans-Regular',
      textAlignVertical: 'top',
    },
    notesFieldLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.secondary,
      fontSize: 12,
      marginBottom: 6,
    },
    notesFieldLabelSpaced: { marginTop: 14 },

    // Horizontal pager — flexes to fill between fixed top card and bottom bar
    pagerWrap: { flex: 1 },


    // Go-to-hole picker (centered modal with 18-hole grid)
    holePickerSheet: {
      alignSelf: 'center',
      backgroundColor: theme.bg.primary,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border.default,
      paddingVertical: 20,
      paddingHorizontal: 20,
      marginHorizontal: 24,
      marginVertical: 'auto',
      gap: 16,
    },
    holePickerGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'center',
    },
    holePickerBtn: {
      width: 48, height: 48, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      borderWidth: 1, borderColor: theme.border.default,
    },
    holePickerBtnActive: {
      backgroundColor: theme.accent.primary,
      borderColor: theme.accent.primary,
    },
    holePickerBtnDone: {
      borderColor: theme.accent.primary,
    },
    holePickerBtnText: {
      color: theme.text.primary,
      fontSize: 16,
      fontFamily: 'PlusJakartaSans-Bold',
    },
    holePickerBtnTextActive: {
      color: theme.text.inverse,
    },
    holePickerNoteDot: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 6,
      height: 6,
      borderRadius: 3,
    },

    // Round totals strip
    totalsStrip: {
      backgroundColor: theme.bg.card,
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingHorizontal: 18,
      paddingVertical: 12,
    },
    totalStripLabel: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
      marginBottom: 8,
      textTransform: 'uppercase',
    },
    sindicatoStatus: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.secondary,
      fontSize: 11,
      textAlign: 'center',
      marginTop: 6,
    },
    totalStripRow: { flexDirection: 'row', justifyContent: 'space-around' },
    totalStripPlayer: { alignItems: 'center', gap: 2 },
    totalStripName: {
      color: theme.text.secondary,
      fontSize: 11,
      fontFamily: 'PlusJakartaSans-SemiBold',
    },
    totalStripPts: {
      color: theme.accent.primary,
      fontSize: 18,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },
    totalStripStr: {
      color: theme.text.muted,
      fontSize: 11,
      fontFamily: 'PlusJakartaSans-Regular',
    },

    // Solo hero card (shown on HolePage when players.length === 1)
    soloHeroCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 20,
      gap: 18,
      shadowColor: '#000',
      shadowOpacity: theme.isDark ? 0.3 : 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    // Amber treatment for a hero card whose score is in conflict.
    soloHeroCardConflict: {
      borderColor: '#c77a0a',
      borderWidth: 1.5,
      backgroundColor: 'rgba(199,122,10,0.10)',
    },
    soloConflictHint: {
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: '#c77a0a',
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: 999,
    },
    soloConflictHintText: {
      color: '#ffffff',
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 13,
    },

    /* ── Shot detail panel ── */
    // "Which player are you?" prompt — a centered modal. Shown for a joined
    // game where the app can't infer which roster slot is the signed-in user.
    mePickerBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 28,
    },
    mePickerCard: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: theme.bg.card,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingVertical: 28,
      paddingHorizontal: 24,
      alignItems: 'center',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    mePickerIcon: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: theme.accent.light,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    mePickerTitle: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 23,
      color: theme.text.primary,
      textAlign: 'center',
      letterSpacing: -0.3,
    },
    mePickerSubtitle: {
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 13,
      color: theme.text.secondary,
      textAlign: 'center',
      lineHeight: 19,
      marginTop: 8,
      marginBottom: 22,
    },
    mePickerChips: { width: '100%', gap: 10 },
    mePickerChip: {
      width: '100%',
      paddingVertical: 15,
      paddingHorizontal: 16,
      borderRadius: 14,
      backgroundColor: theme.accent.light,
      borderWidth: 1,
      borderColor: theme.accent.primary + '40',
      alignItems: 'center',
    },
    mePickerChipText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.accent.primary,
      fontSize: 15,
    },
    mePickerSkip: {
      marginTop: 18,
      paddingVertical: 8,
      paddingHorizontal: 20,
    },
    mePickerSkipText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
      fontSize: 14,
    },
    // Inset section WITHIN the score card (not a standalone card): a top
    // hairline divides it from the strokes section above, no own
    // background / border / shadow / outer margin.
    shotPanel: {
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingTop: 6,
      paddingBottom: 2,
    },
    shotPanelLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
      fontSize: 12,
      letterSpacing: 0.3,
      marginBottom: 4,
    },
    shotBudgetCaption: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
      fontSize: 11,
      marginBottom: 8,
    },
    shotRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.border.subtle ?? theme.border.default,
    },
    shotRowLast: { borderBottomWidth: 0 },
    shotRowLabel: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 16,
    },
    shotCounter: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    shotCounterBtn: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      borderWidth: 1,
      borderColor: theme.border.default,
      alignItems: 'center',
      justifyContent: 'center',
    },
    shotCounterBtnDim: { opacity: 0.4 },
    shotCounterValue: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 18,
      minWidth: 20,
      textAlign: 'center',
    },
    driveBtns: { flexDirection: 'row', gap: 8, flex: 1, flexWrap: 'wrap', justifyContent: 'flex-end' },
    // Stacked variant: label on its own line, chips below hugging the right edge.
    shotRowStacked: {
      flexDirection: 'column',
      alignItems: 'stretch',
      justifyContent: 'flex-start',
      gap: 8,
    },
    // flex: 0 collapses to basis 0% on react-native-web; size by content instead.
    driveBtnsStacked: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
    driveCircle: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: theme.bg.secondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    driveCircleActive: { backgroundColor: theme.accent.primary },
    outcomeChip: {
      paddingHorizontal: 12, paddingVertical: 6,
      borderRadius: 16, marginRight: 8,
      borderWidth: 1, borderColor: theme.border.default,
    },
    outcomeChipActive: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    outcomeChipLabel: { fontSize: 13, fontWeight: '600', color: theme.text.secondary },
    bucketCircle: { width: 56, height: 32, borderRadius: 16, paddingHorizontal: 4 },
    bucketRow: {
      flexDirection: 'column',
      alignItems: 'stretch',
      justifyContent: 'flex-start',
      gap: 8,
    },
    bucketLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    bucketBtns: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    soloHeroHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    soloHeroNameWrap: { flexShrink: 1 },
    soloHeroNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    soloHeroName: {
      color: theme.text.primary,
      fontSize: 18,
      fontFamily: 'PlusJakartaSans-Bold',
      flexShrink: 1,
    },
    soloHeroHcp: {
      color: theme.text.muted,
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-Regular',
      marginTop: 2,
    },
    soloScoreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    },
    soloScoreRowReadOnly: {
      justifyContent: 'center',
    },
    soloStepBtn: {
      width: 56, height: 56, borderRadius: 28,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    soloScoreDisplay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    soloScoreNum: {
      color: theme.text.primary,
      fontSize: 64,
      fontFamily: 'PlayfairDisplay-Bold',
      lineHeight: 70,
      letterSpacing: -1,
    },
    soloScoreLabel: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
      marginTop: 4,
    },
    soloPtsBadge: {
      alignSelf: 'center',
      paddingHorizontal: 18,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1.5,
    },
    soloPtsText: {
      fontSize: 14,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      letterSpacing: 0.3,
    },
    soloStatsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingTop: 14,
    },
    soloStatItem: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
    },
    soloStatDivider: {
      width: 1,
      alignSelf: 'stretch',
      backgroundColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    soloStatLabel: {
      color: theme.text.muted,
      fontSize: 9,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
    },
    soloStatValue: {
      color: theme.text.primary,
      fontSize: 22,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },

    // Solo totals ribbon (under the pager, replaces totalsStrip when solo)
    soloRibbon: {
      backgroundColor: theme.bg.card,
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingHorizontal: 18,
      paddingVertical: 12,
    },
    soloRibbonHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    soloRibbonName: {
      flex: 1,
      color: theme.text.primary,
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-Bold',
    },
    soloRibbonLabel: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },
    soloRibbonRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
    },
    soloRibbonItem: {
      alignItems: 'center',
      gap: 2,
    },
    soloRibbonItemLabel: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
    },
    soloRibbonStrokes: {
      color: theme.text.primary,
      fontSize: 20,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },
    soloRibbonPts: {
      color: theme.accent.primary,
      fontSize: 20,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },
    soloRibbonVsPar: {
      fontSize: 20,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },

    // Match panel (hole-by-hole best ball)
    matchPanel: {
      backgroundColor: theme.bg.card,
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingHorizontal: 18,
      paddingVertical: 12,
    },
    matchPanelHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    matchPanelNameCol: { flex: 1 },
    matchPanelColLabel: {
      width: 56,
      textAlign: 'center',
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },
    matchPanelDataRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
    matchPanelName: {
      flex: 1,
      color: theme.text.secondary,
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-SemiBold',
    },
    matchPanelStat: {
      width: 56,
      textAlign: 'center',
      color: theme.text.secondary,
      fontSize: 20,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },
    matchPanelStatRound: { color: theme.text.primary },

    // Save / next button (now sits inside bottomActionsRow)
    saveBtn: {
      flex: 1,
      backgroundColor: theme.accent.primary,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
      ...(theme.isDark ? {} : theme.shadow.accent),
    },
    saveBtnText: {
      color: theme.text.inverse,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 16,
    },
    // Official-mode attest button when blocked (discrepancies / in flight).
    saveBtnDisabled: { opacity: 0.4 },
    // Hint shown under the bottom bar in official mode (Task 16): attested
    // confirmation, discrepancy block, or an attest error message.
    attestHint: {
      marginTop: 8,
      textAlign: 'center',
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 12,
    },

    // Solo scorecard — classic two-up (front nine + back nine blocks)
    soloGridContent: { padding: 14, paddingTop: 10, paddingBottom: 24 },
    soloGridHeaderBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 12,
    },
    soloGridHeaderTitle: {
      color: theme.accent.primary,
      fontSize: 16,
      fontFamily: 'PlayfairDisplay-Bold',
      letterSpacing: -0.3,
    },
    soloBoard: {
      gap: 14,
    },
    soloNinesStack: {
      gap: 14,
    },
    soloNinesRow: {
      flexDirection: 'row',
      gap: 16,
    },
    soloNineFlex: {
      flex: 1,
    },
    soloNineBlock: {
      backgroundColor: theme.bg.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingHorizontal: 2,
      paddingVertical: 6,
      overflow: 'hidden',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    soloNineLabel: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 2,
      paddingHorizontal: 8,
      paddingBottom: 6,
    },
    soloNineHeaderRow: {
      flexDirection: 'row',
      backgroundColor: theme.accent.primary,
      marginHorizontal: 4,
      marginBottom: 3,
      borderRadius: 6,
      paddingVertical: 7,
      alignItems: 'center',
    },
    soloNineHeaderText: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 11,
      color: 'rgba(255,255,255,0.95)',
      letterSpacing: 0.3,
      textAlign: 'center',
    },
    soloNineHeaderLabel: {
      textAlign: 'left',
      paddingLeft: 6,
    },
    soloNineHeaderAgg: {
      fontSize: 10,
      letterSpacing: 0.8,
    },
    soloNineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      marginHorizontal: 4,
    },
    soloNineRowSi: {
      paddingVertical: 4,
    },
    soloNineRowYou: {
      backgroundColor: theme.isDark ? 'rgba(79,174,138,0.08)' : 'rgba(0,103,71,0.045)',
      borderRadius: 6,
      paddingVertical: 8,
      marginVertical: 2,
    },
    soloNineCell: {
      // Width applied explicitly per column (labelW / holeW / aggW) so header
      // and body rows share the same column geometry. flexShrink: 1 makes
      // <View> cells shrink the same way <Text> cells do under RN-Web (which
      // defaults View to flex-shrink: 0, Text to 1) — otherwise the
      // View-wrapped stroke cells stay at full declared width while the
      // Text-based PAR/SI/PTS cells shrink, leaving stroke digits offset
      // from the PTS digits below them when the row overflows its block.
      flexShrink: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 0,
    },
    soloNineLabelCell: {
      alignItems: 'flex-start',
      paddingLeft: 6,
    },
    soloNineAggDivider: {
      borderLeftWidth: 1,
      borderLeftColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    soloNineYouCell: {
      position: 'relative',
    },
    // Glowing halo on the digit box a live player is about to fill — only
    // used by the read-only summary (highlightCurrentHole), same accent-glow
    // recipe as the Home scoreboard's HOLE badge.
    soloNineDigitBoxCurrent: {
      backgroundColor: theme.accent.light,
      borderColor: theme.accent.primary,
      borderRadius: 8,
      borderWidth: 1.5,
      elevation: 4,
      shadowColor: theme.accent.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.5,
      shadowRadius: 6,
    },
    soloNineRowLabel: {
      color: theme.text.secondary,
      fontSize: 11,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    soloNineSiLabel: {
      color: theme.text.muted,
    },
    soloNineYouLabel: {
      color: theme.accent.primary,
    },
    soloNineParText: {
      color: theme.text.primary,
      fontSize: 14,
      fontFamily: 'PlusJakartaSans-SemiBold',
      textAlign: 'center',
    },
    soloNineSiText: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Regular',
      letterSpacing: 0.3,
      textAlign: 'center',
    },
    soloNinePtsText: {
      fontSize: 14,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      textAlign: 'center',
    },
    // Scored cells carry no box chrome — the digit (plus its result chip)
    // reads like a printed scorecard. Empty cells keep a faint plate as the
    // "tap to type" affordance; it disappears once a score lands.
    // Playfair's default figures are old-style (3/4/5/7/9 descend ~3px below
    // the vertical centre), which reads as digits floating low inside the
    // result chips — lining + tabular numerals keep every digit in the same
    // cap-height box, and the small bottom padding optically centres that box.
    soloNineStrokeInput: {
      color: theme.text.primary,
      width: '92%',
      height: 30,
      textAlign: 'center',
      fontSize: 16,
      fontFamily: 'PlayfairDisplay-Bold',
      fontVariant: ['lining-nums', 'tabular-nums'],
      padding: 0,
      paddingBottom: 2,
      backgroundColor: 'transparent',
      borderRadius: 6,
      // Paint the digit above the absolutely-positioned result chip — on web
      // a static input would otherwise render underneath it (invisible on the
      // solid eagle chip).
      position: 'relative',
      zIndex: 1,
    },
    soloNineStrokeInputEmpty: {
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)',
    },
    // View-only twin of soloNineStrokeInput. Renders as <Text>, so it drops
    // the input-only bits (height/padding/background/border) and relies on
    // the parent cell's flex centering — keeping the digits centered in
    // both axes without inheriting a TextInput's readonly browser styles.
    soloNineStrokeText: {
      color: theme.text.primary,
      textAlign: 'center',
      fontSize: 16,
      fontFamily: 'PlayfairDisplay-Bold',
      fontVariant: ['lining-nums', 'tabular-nums'],
      // Same stacking fix as soloNineStrokeInput for the view-only twin.
      position: 'relative',
      zIndex: 1,
    },
    // The 30px box that keeps the stroke digit and its result chip
    // concentric; the pip lane stacks below it inside the cell.
    soloNineDigitBox: {
      alignSelf: 'stretch',
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Handicap "strokes received" pips in their own lane under the digit box,
    // so they sit clearly below the result chip and can never overlap it.
    // Rendered for every cell (empty when no strokes) to keep row heights
    // uniform.
    soloNineExtraDots: {
      height: 7,
      alignSelf: 'stretch',
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 3,
    },
    soloNineExtraDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
    },

    // Strokes/Points display toggle — a compact two-cell segmented control
    // that sits above both nines. Mirrors bucketSegTrack styling.
    soloModeToggleRow: {
      flexDirection: 'row',
      alignSelf: 'center',
      backgroundColor: theme.bg.secondary,
      borderRadius: 10,
      padding: 3,
    },
    soloModeToggleBtn: {
      paddingVertical: 6,
      paddingHorizontal: 20,
      borderRadius: 8,
    },
    soloModeToggleBtnActive: {
      backgroundColor: theme.accent.primary,
    },
    soloModeToggleText: {
      color: theme.text.secondary,
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 0.3,
    },
    soloModeToggleTextActive: {
      color: theme.text.inverse,
    },

    // Score-result chip drawn behind each stroke digit (strokes mode only) —
    // the golf-scorecard convention as a soft fill: circle = under par,
    // square = over par; fill colour carries severity, and the eagle/double
    // tier adds a thin solid border (set inline). The wrapper fills the cell
    // and centres the chip concentric with the digit, so it never shifts
    // column geometry, and the chip is small enough to leave the bottom edge
    // free for the handicap pips. Fill colour is applied inline per result.
    soloNineShapeWrap: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    soloNineShape: {
      width: 22,
      height: 22,
    },
    soloNineShapeCircle: {
      borderRadius: 11,
    },
    soloNineShapeSquare: {
      borderRadius: 5,
    },
    soloNineAggText: {
      color: theme.text.secondary,
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-Bold',
      textAlign: 'center',
    },
    soloNineAggStrokesTotal: {
      color: theme.text.primary,
      fontSize: 17,
      fontFamily: 'PlayfairDisplay-Bold',
      textAlign: 'center',
    },
    soloNineAggPtsTotal: {
      color: theme.accent.primary,
      fontSize: 17,
      fontFamily: 'PlayfairDisplay-Bold',
      textAlign: 'center',
    },

    // Round-total bar (bottom of solo scorecard)
    soloTotalBar: {
      flexDirection: 'row',
      backgroundColor: theme.bg.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingVertical: 14,
      paddingHorizontal: 8,
      alignItems: 'center',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    soloTotalCol: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
    },
    soloTotalDivider: {
      width: 1,
      height: 32,
      backgroundColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    soloTotalLabel: {
      color: theme.text.muted,
      fontSize: 9,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.4,
    },
    soloTotalNumber: {
      color: theme.text.primary,
      fontSize: 22,
      fontFamily: 'PlayfairDisplay-Bold',
    },

    // Per-player separator inside a block (between player N and player N+1 rows)
    soloNinePlayerSeparator: {
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? theme.glass?.border : theme.border.subtle,
      marginTop: 2,
    },

    // Multi-player total card (replaces solo total bar when >1 player)
    multiTotalCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingVertical: 10,
      paddingHorizontal: 14,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    multiTotalLabel: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.4,
    },
    multiTotalColHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingTop: 4,
      paddingBottom: 2,
    },
    multiTotalColHeaderLabel: {
      color: theme.text.muted,
      fontSize: 9,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.2,
      flex: 1,
    },
    multiTotalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: theme.isDark ? theme.glass?.border : theme.border.default,
      marginBottom: 2,
    },
    multiTotalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      gap: 8,
    },
    multiTotalName: {
      flex: 1,
      color: theme.text.primary,
      fontSize: 14,
      fontFamily: 'PlusJakartaSans-SemiBold',
    },
    multiTotalLeader: {
      color: theme.accent.primary,
      fontFamily: 'PlusJakartaSans-Bold',
    },
    multiTotalStr: {
      width: 48,
      textAlign: 'right',
      color: theme.text.secondary,
      fontSize: 14,
      fontFamily: 'PlayfairDisplay-Bold',
    },
    multiTotalVsPar: {
      width: 40,
      textAlign: 'right',
      color: theme.text.muted,
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-Regular',
    },
    multiTotalPts: {
      width: 46,
      textAlign: 'right',
      color: theme.text.primary,
      fontSize: 18,
      fontFamily: 'PlayfairDisplay-Bold',
    },

    // Live match
    liveMatch: {
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.accent.light,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 16,
      margin: 16,
      gap: 10,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    liveMatchTitle: {
      color: theme.accent.primary,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 12,
      marginBottom: 2,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    liveName: {
      flex: 1,
      color: theme.text.secondary,
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-Medium',
    },
    liveNameRight: { textAlign: 'right' },
    liveWin: {
      color: theme.accent.primary,
      fontFamily: 'PlusJakartaSans-Bold',
    },
    liveScore: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 22,
      width: 32,
      textAlign: 'center',
    },
    liveDash: {
      color: theme.text.muted,
      fontSize: 18,
      fontFamily: 'PlusJakartaSans-Regular',
    },

    teeBadge: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11,
      color: theme.accent.primary, backgroundColor: theme.accent.light,
      borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
    },

    // Team chip on the unified PlayerCard — small pill showing "PAIR A" /
    // "PAIR B" in the team colour on a low-alpha tinted background. The
    // colour is applied inline so one style serves both teams.
    playerTeamChip: {
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    playerTeamChipText: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 10,
      letterSpacing: 1,
    },

    // Segmented-control distance-bucket picker (BucketSegment)
    bucketSegBlock: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border.subtle ?? theme.border.default },
    bucketSegLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    bucketSegHint: { marginLeft: 'auto', color: theme.text.muted, fontSize: 11, fontFamily: 'PlusJakartaSans-SemiBold' },
    bucketSegTrack: { flexDirection: 'row', backgroundColor: theme.bg.secondary, borderRadius: 10, padding: 3 },
    bucketSegCell: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
    bucketSegCellActive: { backgroundColor: theme.accent.primary },
    bucketSegCellText: { color: theme.text.secondary, fontSize: 12, fontFamily: 'PlusJakartaSans-Bold' },
    bucketSegCellTextActive: { color: theme.text.inverse },

    // ShotDetailSection — collapsible wrapper around ShotDetailPanel
    shotSection: { marginTop: 10, borderTopWidth: 1, borderTopColor: theme.border.subtle ?? theme.border.default },
    shotSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
    shotSectionTitle: { color: theme.text.secondary, fontSize: 13, fontFamily: 'PlusJakartaSans-Bold' },

    // Unified round summary panel (RoundSummary) — one card replaces the four
    // mode-specific panels (MatchPanel / SindicatoPanel / SoloTotalsRibbon /
    // StablefordWinnerBanner). Matches the visual weight of totalsStrip /
    // matchPanel so the pinned panel height stays consistent.
    summaryCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingHorizontal: 13,
      paddingVertical: 11,
    },
    summaryEyebrow: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginBottom: 6,
    },
    // pairs variant — column-header row + two pair rows
    summaryColHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    summaryColLabel: {
      width: 52,
      textAlign: 'center',
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 5,
      paddingHorizontal: 4,
      borderRadius: 8,
    },
    summaryRowWinner: {
      backgroundColor: 'rgba(232,196,95,0.12)',
    },
    summaryNameWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    summaryName: {
      flex: 1,
      color: theme.text.primary,
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-Bold',
    },
    summaryCol: {
      width: 52,
      textAlign: 'center',
      color: theme.text.primary,
      fontSize: 17,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },
    // players variant — a row of per-player chips
    summaryChipRow: {
      flexDirection: 'row',
      gap: 8,
    },
    summaryChip: {
      flex: 1,
      alignItems: 'center',
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: 'transparent',
      paddingVertical: 7,
      paddingHorizontal: 6,
    },
    summaryChipLeader: {
      backgroundColor: theme.accent.primary + '22',
      borderColor: theme.accent.primary,
    },
    summaryChipNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      maxWidth: '100%',
    },
    summaryChipName: {
      color: theme.text.muted,
      fontSize: 11,
      fontFamily: 'PlusJakartaSans-SemiBold',
    },
    summaryChipValue: {
      color: theme.text.primary,
      fontSize: 20,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      marginTop: 1,
    },
    // solo variant — three stat columns
    summarySolo: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    summarySoloItem: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    summarySoloDivider: {
      width: 1,
      height: 28,
      backgroundColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    summarySoloLabel: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },
    summarySoloValue: {
      color: theme.text.primary,
      fontSize: 20,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },
    // status line below the body
    summaryStatus: {
      color: theme.text.muted,
      fontSize: 11,
      fontFamily: 'PlusJakartaSans-SemiBold',
      textAlign: 'center',
      marginTop: 7,
    },
    summaryStatusWinner: {
      color: '#e8c45f',
    },
  });
}
