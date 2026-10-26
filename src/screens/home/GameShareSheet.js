import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Share } from 'react-native';
import { Feather } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import BottomSheet from '../../components/BottomSheet';
import { shareLeaderboard } from '../../components/ShareableCard';
import {
  generateInviteCode, buildJoinLink,
  buildBoardLink, enableBoardSharing, rotateBoardToken, disableBoardSharing,
} from '../../store/tournamentStore';
import { isOnline } from '../../lib/connectivity';
import { useT } from '../../i18n';
import { showError, currentOrigin } from './homeShared';

// The game's share hub: editor invite code, the public live board for
// viewers, and the leaderboard image. `open()` is the header's share button.
export function useGameShare({ tournament, isOwner, reload, confirm }) {
  const tx = useT();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCodes, setInviteCodes] = useState({ editor: '', viewer: '' });
  const [inviteRoleState, setInviteRoleState] = useState('editor');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [boardShareBusy, setBoardShareBusy] = useState(false);

  async function handleInvite() {
    if (!tournament) return;
    setInviteLoading(true);
    setShowInvite(true);
    try {
      const { editorCode, viewerCode } = await generateInviteCode(tournament.id);
      setInviteCodes({ editor: editorCode, viewer: viewerCode });
    } catch (err) {
      setShowInvite(false);
      showError(err.message);
    } finally {
      setInviteLoading(false);
    }
  }

  // Owner-only live board sharing: enable/rotate/disable all wrap the
  // set_share_token RPC (tournamentStore.js) — online-only, not queued. A
  // pre-flight isOnline() check gives a friendly message instead of letting
  // the RPC fail with a raw network error; a non-owner never sees these
  // actions (gated on isOwner in the Share sheet's Viewer mode), so the
  // 42501 branch below is just a defensive plain-language fallback.
  function boardSharingErrorMessage(err) {
    if (!isOnline()) return tx('home.board.offline');
    const msg = err?.message ?? '';
    if (msg.includes('not authorized') || err?.code === '42501') {
      return tx('home.board.ownerOnly');
    }
    return msg || tx('home.board.updateFailed');
  }

  function shareBoardLink(token) {
    const url = buildBoardLink(currentOrigin(), token);
    // Blank line before the URL keeps WhatsApp from wrapping the text into
    // the middle of the link and breaking the tap target — same format as
    // the invite-link share above.
    Share.share({ message: tx('home.board.shareMessage', { url }) });
  }

  // Auto-enable path: triggered by changeInviteRole when the owner switches
  // the Share sheet into Viewer mode with no board token yet. Unlike the old
  // "Share live board" settings row this does not open the OS share sheet —
  // it just turns the link on; the sheet's own "Share link" row does that
  // once the QR/link section renders. reload() pulls the freshly patched
  // tournament.shareToken back into this screen's state so the sheet swaps
  // out of the busy spinner without waiting on the background store-change
  // subscription.
  async function handleShareBoard() {
    if (!tournament || boardShareBusy) return;
    if (!isOnline()) { showError(boardSharingErrorMessage()); return; }
    setBoardShareBusy(true);
    try {
      await enableBoardSharing(tournament.id);
      await reload();
    } catch (err) {
      showError(boardSharingErrorMessage(err));
    } finally {
      setBoardShareBusy(false);
    }
  }

  async function handleRotateBoardLink() {
    if (!tournament || boardShareBusy) return;
    const confirmed = await confirm({
      title: tx('home.board.newLinkTitle'),
      message: tx('home.board.newLinkMessage'),
      confirmLabel: tx('home.board.newLinkTitle'),
    });
    if (!confirmed) return;
    if (!isOnline()) { showError(boardSharingErrorMessage()); return; }
    setBoardShareBusy(true);
    try {
      const token = await rotateBoardToken(tournament.id);
      await reload();
      shareBoardLink(token);
    } catch (err) {
      showError(boardSharingErrorMessage(err));
    } finally {
      setBoardShareBusy(false);
    }
  }

  async function handleStopSharingBoard() {
    if (!tournament || boardShareBusy) return;
    const confirmed = await confirm({
      title: tx('home.board.stopTitle'),
      message: tx('home.board.stopMessage'),
      confirmLabel: tx('home.board.stopTitle'),
      destructive: true,
    });
    if (!confirmed) return;
    if (!isOnline()) { showError(boardSharingErrorMessage()); return; }
    setBoardShareBusy(true);
    try {
      await disableBoardSharing(tournament.id);
      await reload();
    } catch (err) {
      showError(boardSharingErrorMessage(err));
    } finally {
      setBoardShareBusy(false);
    }
  }

  // The editor and viewer codes are distinct and fixed; switching to Editor
  // just shows its code — no server round-trip. Switching to Viewer now
  // shows the public live board instead of the old viewer join-code flow:
  // if the owner hasn't shared a board link yet, turn one on automatically
  // (moved-and-adapted from the old settings-sheet "Share live board" row).
  function changeInviteRole(next) {
    setInviteRoleState(next);
    if (next === 'viewer' && isOwner && !tournament?.shareToken) {
      handleShareBoard();
    }
  }

  return {
    visible: showInvite,
    open: handleInvite,
    close: () => setShowInvite(false),
    role: inviteRoleState,
    changeRole: changeInviteRole,
    inviteCode: inviteCodes[inviteRoleState] ?? '',
    inviteLoading,
    boardShareBusy,
    shareBoardLink,
    rotateBoardLink: handleRotateBoardLink,
    stopSharingBoard: handleStopSharingBoard,
  };
}

export default function GameShareSheet({ share, tournament, isOwner, theme, s, leaderboardEntries, leaderboardRef }) {
  const tx = useT();
  const { role: inviteRoleState, inviteCode, inviteLoading, boardShareBusy } = share;
  return (
    <BottomSheet visible={share.visible} onClose={share.close} sheetStyle={s.modalSheet}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>{tx('home.share.title')}</Text>
          <Text style={s.inviteSubtitle}>
            {(() => {
              const isGameNoun = tournament.kind === 'game';
              if (inviteRoleState === 'editor') {
                return tx(isGameNoun ? 'home.share.editorGame' : 'home.share.editorTournament');
              }
              // Viewer mode: the public live board when the owner has shared
              // one, otherwise the legacy viewer join-code flow.
              if (tournament.shareToken) {
                return tx('home.share.viewerBoard');
              }
              if (isOwner && boardShareBusy) {
                return tx('home.share.viewerBusy');
              }
              return tx(isGameNoun ? 'home.share.viewerGame' : 'home.share.viewerTournament');
            })()}
          </Text>

          {inviteRoleState === 'viewer' && tournament.shareToken ? (
            <View style={s.inviteQrBox}>
              <View style={s.inviteQrInner}>
                <QRCode
                  value={buildBoardLink(currentOrigin(), tournament.shareToken)}
                  size={148}
                  backgroundColor="#ffffff"
                  color="#000000"
                />
              </View>
              <Text style={s.inviteQrHint}>{tx('home.share.scanWatch')}</Text>
            </View>
          ) : inviteRoleState === 'viewer' && isOwner && boardShareBusy ? (
            <ActivityIndicator color={theme.accent.primary} style={{ marginVertical: 24 }} />
          ) : (
            <>
              {inviteLoading
                ? <ActivityIndicator color={theme.accent.primary} style={{ marginVertical: 24 }} />
                : (
                  <>
                    <View style={s.inviteCodeBox}>
                      <Text style={s.inviteCode}>{inviteCode}</Text>
                    </View>
                    {!!inviteCode && (() => {
                      // QR encodes the same payload as "Share link": the
                      // path-based join-tournament link.
                      const qrValue = buildJoinLink(currentOrigin(), inviteCode);
                      return (
                        <View style={s.inviteQrBox}>
                          <View style={s.inviteQrInner}>
                            <QRCode
                              value={qrValue}
                              size={148}
                              backgroundColor="#ffffff"
                              color="#000000"
                            />
                          </View>
                          <Text style={s.inviteQrHint}>{tx('home.share.scanJoin')}</Text>
                        </View>
                      );
                    })()}
                  </>
                )}
              {inviteRoleState === 'viewer' && !isOwner && (
                <Text style={s.modalSubtle}>{tx('home.share.ownerHint')}</Text>
              )}
            </>
          )}

          <View style={s.inviteRoleRow}>
            <TouchableOpacity
              style={[s.inviteRoleBtn, inviteRoleState === 'editor' && s.inviteRoleBtnActive]}
              onPress={() => share.changeRole('editor')}
              activeOpacity={0.7}
              disabled={!inviteCode}
            >
              <Text style={[s.inviteRoleText, inviteRoleState === 'editor' && s.inviteRoleTextActive]}>
                {tx('home.share.editor')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.inviteRoleBtn, inviteRoleState === 'viewer' && s.inviteRoleBtnActive]}
              onPress={() => share.changeRole('viewer')}
              activeOpacity={0.7}
              disabled={!inviteCode}
            >
              <Text style={[s.inviteRoleText, inviteRoleState === 'viewer' && s.inviteRoleTextActive]}>
                {tx('home.share.viewer')}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={s.menuItem}
            onPress={() => {
              if (inviteRoleState === 'viewer' && tournament.shareToken) {
                share.shareBoardLink(tournament.shareToken);
                return;
              }
              // Blank line before the URL keeps WhatsApp from wrapping the
              // text into the middle of the link and breaking the tap target.
              const message = tx('home.share.inviteMessage', { link: buildJoinLink(currentOrigin(), inviteCode) });
              Share.share({ message });
            }}
            activeOpacity={0.7}
            disabled={inviteRoleState === 'viewer' && tournament.shareToken ? false : !inviteCode}
          >
            <Feather name="share-2" size={14} color={theme.text.primary} />
            <Text style={s.menuItemText}>{tx('home.share.shareLink')}</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>

          {inviteRoleState === 'viewer' && isOwner && !!tournament.shareToken && (
            <>
              <TouchableOpacity
                style={s.menuItem}
                onPress={share.rotateBoardLink}
                activeOpacity={0.7}
                disabled={boardShareBusy}
              >
                <Feather name="refresh-cw" size={14} color={theme.text.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={s.menuItemTitle}>{tx('home.share.newLink')}</Text>
                  <Text style={s.modalSubtle}>{tx('home.share.newLinkHint')}</Text>
                </View>
                {boardShareBusy
                  ? <ActivityIndicator size="small" color={theme.text.muted} />
                  : <Feather name="chevron-right" size={16} color={theme.text.muted} />}
              </TouchableOpacity>
              <TouchableOpacity
                style={s.menuItem}
                onPress={share.stopSharingBoard}
                activeOpacity={0.7}
                disabled={boardShareBusy}
              >
                <Feather name="x-circle" size={14} color={theme.destructive} />
                <Text style={[s.menuItemText, { color: theme.destructive }]}>{tx('home.share.stop')}</Text>
                {boardShareBusy && <ActivityIndicator size="small" color={theme.text.muted} />}
              </TouchableOpacity>
            </>
          )}

          {tournament.players.length > 1 && (
            <TouchableOpacity
              style={[s.menuItem, { borderBottomWidth: 0 }]}
              onPress={() => { share.close(); shareLeaderboard({ tournamentName: tournament.name, leaderboard: leaderboardEntries, theme, viewRef: leaderboardRef }); }}
              activeOpacity={0.7}
            >
              <Feather name="share-2" size={14} color={theme.text.primary} />
              <Text style={s.menuItemText}>{tx('home.share.leaderboardImage')}</Text>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}
    </BottomSheet>
  );
}
