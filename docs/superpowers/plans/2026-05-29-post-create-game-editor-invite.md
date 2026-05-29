# Post-Create Game Editor Invite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an editor invite QR after a casual game is created only when an unlinked other player needs a way to join.

**Architecture:** Keep the setup wizard creation flow unchanged until `saveTournament` succeeds. Add one pure helper in `setupWizard.js` for the invite condition, let `SetupScreen` create/reuse the editor invite code before continuing to the normal post-create destination, and keep the QR sheet in a focused reusable component.

**Tech Stack:** Expo React Native, React Navigation, Supabase invite helpers, `react-native-qrcode-svg`, Jest.

---

### Task 1: Invite Condition Helper

**Files:**
- Modify: `src/screens/setupWizard.js`
- Test: `src/screens/__tests__/setupWizard.test.js`

- [ ] **Step 1: Write the failing test**

Add tests that expect a multiplayer game with an unlinked other player to return true, and solo games, tournaments, and games where every other player has `user_id` to return false.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/screens/__tests__/setupWizard.test.js --runInBand`

Expected: FAIL because `shouldOfferPostCreateEditorInvite` still uses player count instead of roster identity.

- [ ] **Step 3: Write minimal implementation**

Export `shouldOfferPostCreateEditorInvite(kind, players, currentUserId)` from `setupWizard.js`, returning true only for casual games with more than one player and at least one non-current-user player whose `user_id` is empty.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/screens/__tests__/setupWizard.test.js --runInBand`

Expected: PASS.

### Task 2: Post-Create Invite Modal

**Files:**
- Create: `src/components/PostCreateInviteModal.js`
- Modify: `src/screens/SetupScreen.js`
- Create: `supabase/migrations/20260529000000_participant_editor_invites.sql`

- [ ] **Step 1: Import invite dependencies**

Add `Share`, plus `generateInviteCode`, `buildJoinLink`, `shouldOfferPostCreateEditorInvite`, and `PostCreateInviteModal`.

- [ ] **Step 2: Add modal state**

Track `{ visible, loading, link, error }` state for the post-create invite sheet.

- [ ] **Step 3: Generate the editor invite after save**

After `saveTournament(tournament)`, call `generateInviteCode(tournament.id)` when `shouldOfferPostCreateEditorInvite(kind, players, user?.id)` is true. Build the join link with the current web origin on web and the production fallback elsewhere. Keep the creator on the final setup step while the sheet is visible, then run the existing navigation reset/replace when the sheet closes.

- [ ] **Step 4: Grant editor access to app-linked participants**

Create a Supabase migration that replaces `notify_participant_added()` so app-linked non-creator participants in casual games receive an `editor` row in `tournament_members` before the existing `added_to_game` notification is created.

- [ ] **Step 5: Render the QR sheet**

Render `PostCreateInviteModal` with QR, selectable link text, `Share link`, and `Skip`. If loading, show an activity indicator. If generation fails, show an error and keep the sheet dismissible.

- [ ] **Step 6: Verify**

Run: `npm test -- src/screens/__tests__/setupWizard.test.js --runInBand`

Run: `npm run lint`
