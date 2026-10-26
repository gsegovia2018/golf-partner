import { StyleSheet } from 'react-native';
import { semantic } from '../../theme/tokens';

// Shared by every Home view (list, game, no-active) and their sheets.
export const makeStyles = (t) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: t.bg.primary },
  scrollView: { flex: 1 },
  content: { padding: 20, paddingTop: 16, paddingBottom: 100 },

  // Header — list header (serif "Golf Partner" title).
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: t.bg.primary },
  headerActions: { flexDirection: 'row', gap: 8, flexShrink: 0 },
  headerDate: {
    fontFamily: 'PlusJakartaSans-Bold', color: t.text.secondary, fontSize: 10,
    letterSpacing: 1.4, textTransform: 'uppercase',
  },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 26, lineHeight: 32, color: t.text.primary, letterSpacing: -0.3 },

  // Tournament-detail header — matches the scorecard header exactly (same
  // paddings, same PlusJakartaSans-Bold 17 title).
  tournamentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, backgroundColor: t.bg.primary },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, paddingRight: 8 },
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: t.text.primary, letterSpacing: -0.3, flexShrink: 1 },

  // Buttons
  primaryBtn: {
    backgroundColor: t.isDark ? t.accent.light : t.accent.primary,
    borderRadius: 14, padding: 14, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8, marginTop: 12,
    borderWidth: t.isDark ? 1 : 0,
    borderColor: t.isDark ? t.accent.primary + '33' : 'transparent',
    ...(t.isDark ? {} : t.shadow.accent),
  },
  primaryBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: t.isDark ? t.accent.primary : t.text.inverse,
    fontSize: 14,
    textAlign: 'center',
  },
  secondaryBtn: {
    backgroundColor: t.isDark ? t.bg.secondary : t.bg.primary,
    borderRadius: 14, padding: 14, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8, marginTop: 12,
    borderWidth: 1, borderColor: t.border.default,
  },
  secondaryBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: t.accent.primary, fontSize: 14,
    textAlign: 'center',
  },

  // Start tiles (Game / Tournament)
  startHeading: {
    fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary,
    fontSize: 15, marginBottom: 10,
  },
  startTilesRow: { flexDirection: 'row', gap: 10 },
  startTile: {
    flex: 1, alignItems: 'stretch', gap: 10,
    backgroundColor: t.bg.card,
    borderRadius: 14, borderWidth: 1, borderColor: t.border.default,
    padding: 14,
  },
  startTileFeatured: {
    backgroundColor: t.accent.primary,
    borderColor: t.accent.primary,
  },
  startTileTitle: {
    fontFamily: 'PlayfairDisplay-Bold', color: t.text.primary, fontSize: 21,
    letterSpacing: -0.3,
  },
  startTileTitleFeatured: { color: t.text.inverse },
  startTileSub: {
    fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 12,
    marginTop: 2,
  },
  startTileSubFeatured: { color: t.text.inverse, opacity: 0.82 },
  startTileCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    marginTop: 'auto', minHeight: 36,
    backgroundColor: t.accent.light,
    borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10,
  },
  startTileCtaFeatured: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  startTileCtaText: {
    fontFamily: 'PlusJakartaSans-ExtraBold', color: t.accent.primary, fontSize: 13,
    textAlign: 'center',
  },

  // Inline reload error card
  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: t.isDark ? t.bg.card : t.bg.card,
    borderRadius: 14, borderWidth: 1, borderColor: t.destructive + '55',
    padding: 14, marginTop: 12,
  },
  errorCardTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 14,
  },
  errorCardText: {
    fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 12,
    marginTop: 1,
  },
  errorRetryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10,
    backgroundColor: t.accent.light,
  },
  errorRetryText: {
    fontFamily: 'PlusJakartaSans-Bold', color: t.accent.primary, fontSize: 12,
  },

  // Tournament list
  sectionLabel: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: t.text.secondary, fontSize: 10, letterSpacing: 1.4,
    marginBottom: 10, marginTop: 22, textTransform: 'uppercase',
  },
  finishedLink: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.isDark ? t.bg.card : t.bg.card,
    borderRadius: 16, borderWidth: t.isDark ? 1 : 0,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 16, marginTop: 16,
    ...(t.isDark ? {} : t.shadow.card),
  },
  finishedLinkText: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.primary, fontSize: 14,
  },
  tournamentCard: {
    backgroundColor: t.bg.card,
    borderRadius: 14, borderWidth: 1,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center',
  },
  tournamentCardLeft: { flex: 1 },
  tournamentCardLeftWithDelete: { paddingRight: 36 },
  tournamentCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  tournamentCardName: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 15, flexShrink: 1 },
  tournamentCardMeta: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 12, marginBottom: 2 },
  tournamentCardRound: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 12 },
  tournamentCardRight: { paddingLeft: 12 },
  statusBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20,
    backgroundColor: semantic.rank.gold + '26',
  },
  statusBadgeText: { fontFamily: 'PlusJakartaSans-SemiBold', color: semantic.rank.gold, fontSize: 9, letterSpacing: 0.5 },
  statusBadgeFinished: { backgroundColor: t.bg.secondary },
  statusBadgeTextFinished: { color: t.text.muted },
  stateMark: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stateDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.accent.primary },
  stateDotFinished: { backgroundColor: t.text.muted },
  stateMarkText: { fontFamily: 'PlusJakartaSans-Bold', color: t.accent.primary, fontSize: 11 },
  stateMarkTextFinished: { color: t.text.secondary },

  staleBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 14,
    backgroundColor: 'rgba(199, 122, 10, 0.12)',
    borderRadius: 8, marginBottom: 10, marginTop: 4,
  },
  staleBannerText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 13, color: '#c77a0a',
  },
  tournamentCardDisabled: { opacity: 0.5 },
  offlineBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 2, paddingHorizontal: 6, borderRadius: 6,
    backgroundColor: 'rgba(199, 122, 10, 0.15)',
  },
  offlineBadgeText: {
    fontSize: 10, fontFamily: 'PlusJakartaSans-SemiBold', color: '#c77a0a',
  },
  staleEmpty: {
    alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 12,
  },
  staleEmptyText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 14, color: t.text.muted, textAlign: 'center',
  },

  // Home list empty / caught-up row
  listEmpty: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 20 },
  listEmptyTitle: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 14 },
  listEmptyText: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.secondary, fontSize: 13, lineHeight: 18, marginTop: 1 },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 18 },
  emptySubtitle: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 14, textAlign: 'center' },

  // Card title row with inline toggle
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8 },
  cardTitleLeft: { flexDirection: 'row', alignItems: 'baseline', flex: 1, minWidth: 0 },
  inlineToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 11 },
  modeLabelActive: { color: t.text.primary },

  // Cards
  card: {
    backgroundColor: t.isDark ? t.bg.card : t.bg.card,
    borderRadius: 20, borderWidth: t.isDark ? 1 : 0,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 16, marginBottom: 16,
    ...(t.isDark ? {} : t.shadow.card),
  },
  cardTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10, color: t.accent.primary,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  cardTitleCourse: {
    flex: 1,
    fontFamily: 'PlayfairDisplay-Bold',
    fontSize: 14,
    color: t.text.primary,
    letterSpacing: -0.2,
  },

  // Round navigation
  roundNavHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  roundNavBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: t.isDark ? t.bg.secondary : t.bg.secondary,
    borderWidth: 1, borderColor: t.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  roundNavBtnDisabled: { opacity: 0.3 },
  roundNavCenter: { flex: 1, alignItems: 'center' },
  roundNavCourse: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 12, marginTop: 2 },

  // Tabs
  tabBar: { marginBottom: 14 },
  tab: {
    paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20,
    borderWidth: 1, borderColor: t.border.default,
    marginRight: 8, backgroundColor: t.bg.secondary,
  },
  tabActive: { backgroundColor: t.accent.primary, borderColor: t.accent.primary },
  tabText: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.muted, fontSize: 12 },
  tabTextActive: { color: t.text.inverse },
  tabRoundTitle: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 12, flex: 1, textAlign: 'center' },
  pagerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  pagerArrow: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  },
  pagerArrowHidden: { opacity: 0 },
  roundEditBtn: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: t.isDark ? t.bg.secondary : t.bg.secondary,
    borderWidth: 1, borderColor: t.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  roundPagerWrap: {},
  emptyRoundHint: {
    fontFamily: 'PlusJakartaSans-Regular',
    color: t.text.muted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
  pairsPreviewHint: {
    fontFamily: 'PlusJakartaSans-Regular',
    color: t.text.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 4,
  },

  // Masters leaderboard
  mastersToggleLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: 'rgba(255,255,255,0.4)', fontSize: 11 },
  mastersToggleLabelActive: { color: 'rgba(255,255,255,0.9)' },
  // Overall/R1/R2/… scope chip strip in the leaderboard card header.
  mastersChipRow: { flexGrow: 0 },
  mastersChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  mastersChipActive: { backgroundColor: 'rgba(255,255,255,0.9)' },
  mastersChipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  mastersChipTextActive: { color: t.bg.deep },
  mastersRoundSub: {
    fontFamily: 'PlusJakartaSans-Medium',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    letterSpacing: 0.5,
    marginTop: 2,
  },

  // Pair blocks
  pairBlock: {
    borderRadius: 12,
    backgroundColor: t.isDark ? t.bg.secondary : t.bg.secondary,
    borderWidth: 1, borderColor: t.border.default,
    padding: 12, marginBottom: 8,
  },
  winnerBlock: {
    backgroundColor: t.isDark ? 'rgba(52,211,153,0.06)' : '#e8f5ee',
    borderColor: t.accent.primary + '44',
  },
  winnerBadge: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: t.accent.primary, fontSize: 9, marginBottom: 8,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  pairHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  pairNames: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 14, flex: 1 },
  pairPoints: { fontFamily: 'PlusJakartaSans-ExtraBold', color: t.accent.primary, fontSize: 20 },
  pairMember: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 12, paddingTop: 3 },

  // Single-round game overview (course hero + per-player stat cards)
  gameHeroCard: {
    backgroundColor: t.bg.card,
    borderRadius: 20,
    borderWidth: t.isDark ? 1 : 0,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 16,
    marginBottom: 16,
    ...(t.isDark ? {} : t.shadow.card),
  },
  gameHeroHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 14 },
  gameHeroCourse: {
    fontFamily: 'PlayfairDisplay-Bold',
    fontSize: 22,
    lineHeight: 26,
    color: t.text.primary,
    letterSpacing: -0.4,
    marginTop: 6,
  },
  gameHeroMeta: {
    fontFamily: 'PlusJakartaSans-Medium',
    color: t.text.muted,
    fontSize: 12,
    marginTop: 4,
    letterSpacing: 0.2,
  },
  gameProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  gameProgressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  gameProgressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: t.accent.primary,
  },
  gameProgressText: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: t.text.secondary,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  gamePlayerPoints: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    color: t.accent.primary,
    fontSize: 28,
    lineHeight: 30,
  },
  gamePlayerPointsLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: t.text.muted,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: -2,
  },
  gameStatValueGood: { color: t.accent.primary },
  gameStatValueWarn: { color: t.text.secondary },
  // Round action row (Scorecard + Next Round side-by-side)
  roundActionsRow: { flexDirection: 'row', gap: 10 },
  roundActionBtn: { flex: 1, marginTop: 0 },
  tournamentBottomBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: t.bg.primary,
    borderTopWidth: 1,
    borderTopColor: t.isDark ? t.glass?.border : t.border.default,
  },

  // Delete (tournament list cards)
  tournamentCardWrapper: { position: 'relative' },
  deleteCardBtn: { position: 'absolute', top: 0, bottom: 8, right: 36, justifyContent: 'center' },

  // Settings modal (bottom sheet)
  modalBackdrop: {
    flex: 1, backgroundColor: semantic.scrim, justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: t.bg.primary,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 10, paddingBottom: 32, paddingHorizontal: 16,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: t.border.default,
  },
  modalHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: t.border.default, marginBottom: 12,
  },
  modalTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10, color: t.accent.primary, marginBottom: 8,
    letterSpacing: 1.5, textTransform: 'uppercase', paddingHorizontal: 4,
  },
  modalSubtle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 11, color: t.text.muted, marginTop: 2,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  menuItemText: {
    flex: 1, fontFamily: 'PlusJakartaSans-SemiBold',
    color: t.text.primary, fontSize: 14,
  },
  // Title stacked over a modalSubtle line — no flex: 1, which collapses it
  // to zero height inside the column wrapper on web.
  menuItemTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: t.text.primary, fontSize: 14,
  },
  menuItemDestructive: { borderBottomWidth: 0 },

  // Viewer badge
  viewerBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  viewerBadgeText: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.secondary, fontSize: 11 },

  // Invite modal
  inviteSubtitle: {
    fontFamily: 'PlusJakartaSans-Regular', color: t.text.secondary,
    fontSize: 13, paddingHorizontal: 4, marginBottom: 16,
  },
  inviteCodeBox: {
    backgroundColor: t.isDark ? t.bg.secondary : t.bg.secondary,
    borderRadius: 16, borderWidth: 1, borderColor: t.border.default,
    padding: 20, alignItems: 'center', marginBottom: 16,
  },
  inviteCode: {
    fontFamily: 'PlusJakartaSans-ExtraBold', color: t.accent.primary,
    fontSize: 36, letterSpacing: 10,
  },
  inviteRoleRow: {
    flexDirection: 'row', gap: 8, marginBottom: 12, paddingHorizontal: 4,
  },
  inviteRoleBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: t.border.default,
    alignItems: 'center', backgroundColor: t.bg.secondary,
  },
  inviteRoleBtnActive: {
    backgroundColor: t.accent.primary, borderColor: t.accent.primary,
  },
  inviteRoleText: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: t.text.muted,
  },
  inviteRoleTextActive: { color: t.text.inverse },

  // Invite QR code
  inviteQrBox: { alignItems: 'center', marginBottom: 16 },
  inviteQrInner: {
    backgroundColor: '#ffffff', padding: 14, borderRadius: 16,
    borderWidth: 1, borderColor: t.border.default,
  },
  inviteQrHint: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted,
    fontSize: 11, marginTop: 8, letterSpacing: 0.3,
  },

  // Empty-state CTA buttons
  emptyStateBtn: { alignSelf: 'stretch', width: '100%', maxWidth: 320 },

  // Themed confirmation modal
  confirmBackdrop: {
    flex: 1, backgroundColor: semantic.scrim,
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  confirmCard: {
    width: '100%', maxWidth: 360,
    // Opaque in dark: the dark bg.card tint is see-through over the scrim.
    backgroundColor: t.isDark ? t.bg.primary : t.bg.card,
    borderRadius: 20, padding: 22,
    borderWidth: 1, borderColor: t.border.default,
    ...(t.isDark ? {} : t.shadow.elevated),
  },
  confirmTitle: {
    fontFamily: 'PlayfairDisplay-Bold', fontSize: 19, color: t.text.primary,
    marginBottom: 6,
  },
  confirmMessage: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: t.text.secondary,
    lineHeight: 20, marginBottom: 20,
  },
  confirmActions: { flexDirection: 'row', gap: 10 },
  confirmBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmBtnCancel: {
    backgroundColor: t.bg.secondary,
    borderWidth: 1, borderColor: t.border.default,
  },
  confirmBtnCancelText: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: t.text.primary,
  },
  confirmBtnPrimary: {
    backgroundColor: t.isDark ? t.accent.light : t.accent.primary,
    borderWidth: t.isDark ? 1 : 0,
    borderColor: t.isDark ? t.accent.primary + '33' : 'transparent',
  },
  confirmBtnPrimaryText: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14,
    color: t.isDark ? t.accent.primary : t.text.inverse,
  },
  confirmBtnDestructive: { backgroundColor: t.destructive },
  confirmBtnDestructiveText: { color: t.isDark ? t.text.inverse : '#ffffff' },
});
