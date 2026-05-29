# Post-Create Game Editor Invite Design

## Goal

After a multiplayer game is created, show the creator an editor invite QR only when at least one other player does not have an app-linked account.

## Scope

- Applies only to casual single-round games created from `SetupScreen`.
- Shows only after the game has been successfully saved, because editor invite codes require an existing tournament/game id.
- Shows only when the created game has more than one player and at least one other roster player has no `user_id`.
- App-linked roster players already appear in `tournament_participants` after save. The participant trigger grants editor membership, sends the existing `added_to_game` notification, and makes the game visible when they open the app.
- Uses the existing casual invite flow: `generateInviteCode(game.id)` creates or reuses the editor code, and `buildJoinLink(origin, editorCode)` builds the shared `/join-tournament/<CODE>` URL.
- Invited players join as editors and use the existing claim-player flow.

## Out Of Scope

- No QR inside setup before creation.
- No viewer invite option in this post-create surface.
- No changes to official tournament invites.
- No changes to how player slots are claimed.

## UX

When the creator taps `Start Game`, the app saves the game first. For multiplayer games with unlinked other players, an invite sheet appears in the final setup step before continuing to the normal post-create game destination. This keeps the QR visible because `SetupScreen` is removed from the stack once the scorecard route is reset.

The invite sheet contains:

- Title: `Invite players`
- Helper copy explaining that the QR is for players who do not have the app yet.
- QR code for the editor join link.
- Text link, selectable where supported.
- `Share link` action using the native share sheet.
- `Skip` / close action that continues to the same destination `Start Game` used before this feature.

Solo games and games where all other players are app-linked do not show the invite sheet.

## Error Handling

The game creation path remains authoritative. If the game saves but invite generation fails, the created game remains available and the app shows a non-blocking error telling the user the invite link could not be created. The existing invite surfaces can still generate the link later.

## Testing

- Add a pure setup wizard helper to decide whether the post-create invite should be offered.
- Cover game/tournament, solo/multiplayer, app-linked, and unlinked-player cases in `src/screens/__tests__/setupWizard.test.js`.
- Run the focused setup wizard test and lint or the full relevant test suite if practical.
