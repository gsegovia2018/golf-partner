# Per-User App Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A synced per-user settings system (GPS toggle, stat-group tracking toggles, units, haptics, theme system option, keep-awake, no-spoilers, auto-advance, notification mutes) stored in a `settings` JSONB column on `profiles`, surfaced in a new SettingsScreen.

**Architecture:** `src/store/settingsStore.js` is the single source of truth: defaults in code, AsyncStorage mirror (`@golf_settings`) for instant/offline load, write-through upsert to `profiles.settings` with a dirty flag for offline retry. Components read reactively via a `useAppSettings()` hook (`useSyncExternalStore`, same pattern as `courseGeometryStore`). Spec: `docs/superpowers/specs/2026-07-20-user-settings-design.md`.

**Tech Stack:** Expo SDK 54 / React Native 0.81 / React 19, Supabase (Postgres + Edge Functions), Jest (jest-expo) + @testing-library/react-native.

## Global Constraints

- All distances are STORED in meters forever; `units` is display-only conversion (1 m = 1.09361 yd).
- Effective settings are always `merge(DEFAULT_APP_SETTINGS, stored)` — missing keys fall back to defaults; never write defaults for keys the user hasn't touched except through normal updates.
- Theme stays device-local (`@golf_theme_mode` via ThemeContext) — it is NOT part of the synced settings blob.
- The store variable name `settings` is already taken in `ScorecardScreen.js` (tournament settings). App-level settings must always be referenced as `appSettings` / `useAppSettings()` in screens.
- `npm test` and `npm run lint` must pass at every commit.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `profiles.settings` column + profileStore passthrough

**Files:**
- Create: `supabase/migrations/20260720000100_profile_settings.sql`
- Modify: `src/store/profileStore.js:22` (select), `:26-37` (return), `:55-104` (upsert)
- Test: `src/store/__tests__/profileStore.test.js` (append a new describe block)

**Interfaces:**
- Produces: `loadProfile()` result gains `settings` (object, `{}` when null); `upsertProfile({ settings })` writes the `settings` column when the key is provided.

- [ ] **Step 1: Write the migration**

```sql
-- 20260720000100_profile_settings.sql
-- Per-user app settings blob (see docs/superpowers/specs/2026-07-20-user-settings-design.md).
-- Defaults live in client code; missing keys fall back there, so '{}' is a
-- complete valid value and no backfill is needed.
alter table public.profiles
  add column if not exists settings jsonb not null default '{}'::jsonb;
```

- [ ] **Step 2: Write failing tests**

Append to `src/store/__tests__/profileStore.test.js` (reuse the existing `getChain()` supabase mock and auth stubbing pattern already in the file — copy the arrange steps from the existing `target_handicap` describe):

```js
describe('profileStore — settings blob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c' } } });
  });

  it('loadProfile returns settings, defaulting to {}', async () => {
    const chain = getChain();
    chain.maybeSingle.mockResolvedValue({ data: { user_id: 'u1', settings: null }, error: null });
    const p = await loadProfile();
    expect(p.settings).toEqual({});
    // the select must actually request the column
    expect(chain.select).toHaveBeenCalledWith(expect.stringContaining('settings'));
  });

  it('upsertProfile writes settings only when provided', async () => {
    const chain = getChain();
    chain.maybeSingle.mockResolvedValue({ data: { user_id: 'u1' }, error: null });
    chain.update.mockReturnValue(chain);
    chain.eq.mockResolvedValue({ error: null });
    await upsertProfile({ settings: { gpsEnabled: false } });
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ settings: { gpsEnabled: false } }),
    );
    jest.clearAllMocks();
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    chain.maybeSingle.mockResolvedValue({ data: { user_id: 'u1' }, error: null });
    chain.eq.mockResolvedValue({ error: null });
    await upsertProfile({ displayName: 'X' });
    expect(chain.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ settings: expect.anything() }),
    );
  });
});
```

Adjust the mock arrange lines to exactly match how the existing describe blocks in that file stub `maybeSingle`/`update`/`eq` — follow the file's own conventions if they differ from the above.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/profileStore.test.js -t "settings blob"`
Expected: FAIL (`p.settings` undefined; update called without settings).

- [ ] **Step 4: Implement**

In `loadProfile()` add `settings` to the select string:

```js
.select('user_id, username, display_name, handicap, target_handicap, avatar_color, avatar_url, gender, settings, updated_at')
```

and to the returned object:

```js
settings: data?.settings ?? {},
```

In `upsertProfile(fields)`, after the `username` block:

```js
// Whole-blob write: settingsStore always sends the full merged object, so
// replacing (not merging) the column is correct.
if (fields.settings !== undefined) {
  row.settings = fields.settings ?? {};
}
```

- [ ] **Step 5: Run tests, lint**

Run: `npx jest src/store/__tests__/profileStore.test.js && npm run lint`
Expected: PASS.

- [ ] **Step 6: Apply migration to prod**

The live DB can drift from repo migrations; use the Supabase Management API token in `.env` (memory: `supabase-schema-drift`) to run the `alter table` on prod, then verify:

```sql
select column_name, data_type from information_schema.columns
 where table_name = 'profiles' and column_name = 'settings';
```

Expected: one row, `jsonb`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260720000100_profile_settings.sql src/store/profileStore.js src/store/__tests__/profileStore.test.js
git commit -m "feat(settings): profiles.settings jsonb column + profileStore passthrough"
```

---

### Task 2: settingsStore + useAppSettings hook + app-start hydration

**Files:**
- Create: `src/store/settingsStore.js`, `src/hooks/useAppSettings.js`
- Modify: `App.js:160-162` (hydrate alongside `registerPushToken`)
- Test: `src/store/__tests__/settingsStore.test.js`

**Interfaces:**
- Consumes: `loadProfile()` / `upsertProfile({ settings })` from Task 1.
- Produces (used by every later task):
  - `DEFAULT_APP_SETTINGS` (shape below)
  - `getAppSettings(): object` — synchronous, always fully-merged
  - `subscribeAppSettings(cb): unsubscribe`
  - `updateAppSettings(patch): Promise<void>` — one-level deep merge for `statGroups`/`notifications`
  - `hydrateAppSettings(): Promise<void>`
  - `useAppSettings(): object` (hook, from `src/hooks/useAppSettings.js`)

- [ ] **Step 1: Write failing tests**

`src/store/__tests__/settingsStore.test.js`:

```js
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_APP_SETTINGS, getAppSettings, updateAppSettings,
  hydrateAppSettings, subscribeAppSettings, __resetAppSettingsForTests,
  SETTINGS_KEY, SETTINGS_DIRTY_KEY,
} from '../settingsStore';
import * as profileStore from '../profileStore';

jest.mock('../profileStore', () => ({
  loadProfile: jest.fn(),
  upsertProfile: jest.fn(),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  __resetAppSettingsForTests();
});

test('defaults are complete and getAppSettings starts at defaults', () => {
  expect(getAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  expect(DEFAULT_APP_SETTINGS.gpsEnabled).toBe(true);
  expect(DEFAULT_APP_SETTINGS.statGroups).toEqual({
    putting: true, teeShot: true, approach: true, shortGame: true, penalties: true,
  });
  expect(DEFAULT_APP_SETTINGS.units).toBe('meters');
});

test('updateAppSettings deep-merges nested groups and notifies subscribers', async () => {
  profileStore.upsertProfile.mockResolvedValue();
  const spy = jest.fn();
  subscribeAppSettings(spy);
  await updateAppSettings({ statGroups: { putting: false } });
  expect(getAppSettings().statGroups.putting).toBe(false);
  expect(getAppSettings().statGroups.teeShot).toBe(true); // sibling preserved
  expect(spy).toHaveBeenCalled();
  expect(profileStore.upsertProfile).toHaveBeenCalledWith({ settings: getAppSettings() });
});

test('failed server write sets dirty flag; hydrate re-pushes it', async () => {
  profileStore.upsertProfile.mockRejectedValueOnce(new Error('offline'));
  await updateAppSettings({ haptics: false });
  expect(await AsyncStorage.getItem(SETTINGS_DIRTY_KEY)).toBe('1');
  profileStore.upsertProfile.mockResolvedValue();
  profileStore.loadProfile.mockResolvedValue({ userId: 'u1', settings: {} });
  await hydrateAppSettings();
  expect(profileStore.upsertProfile).toHaveBeenCalledWith({ settings: expect.objectContaining({ haptics: false }) });
  expect(await AsyncStorage.getItem(SETTINGS_DIRTY_KEY)).toBeNull();
});

test('hydrate adopts server settings over local mirror when not dirty', async () => {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ haptics: false }));
  profileStore.loadProfile.mockResolvedValue({ userId: 'u1', settings: { haptics: true, units: 'yards' } });
  await hydrateAppSettings();
  expect(getAppSettings().haptics).toBe(true);
  expect(getAppSettings().units).toBe('yards');
});

test('empty server blob: local (incl. legacy running-score import) is pushed up', async () => {
  await AsyncStorage.setItem('@scorecard_show_running_score', '0'); // legacy key
  profileStore.loadProfile.mockResolvedValue({ userId: 'u1', settings: {} });
  profileStore.upsertProfile.mockResolvedValue();
  await hydrateAppSettings();
  expect(getAppSettings().showRunningScore).toBe(false);
  expect(profileStore.upsertProfile).toHaveBeenCalledWith({ settings: expect.objectContaining({ showRunningScore: false }) });
});

test('hydrate survives signed-out (loadProfile null) and network errors', async () => {
  profileStore.loadProfile.mockResolvedValueOnce(null);
  await expect(hydrateAppSettings()).resolves.toBeUndefined();
  profileStore.loadProfile.mockRejectedValueOnce(new Error('net'));
  await expect(hydrateAppSettings()).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/settingsStore.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/store/settingsStore.js`**

```js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadProfile, upsertProfile } from './profileStore';

// Per-user app settings (spec: docs/superpowers/specs/2026-07-20-user-settings-design.md).
// Synced via profiles.settings; mirrored to AsyncStorage so the app has them
// instantly offline. Defaults live here — a missing key always means default,
// so old blobs and old app versions never break.

export const SETTINGS_KEY = '@golf_settings';
export const SETTINGS_DIRTY_KEY = '@golf_settings_dirty';
const LEGACY_RUNNING_SCORE_KEY = '@scorecard_show_running_score';

export const DEFAULT_APP_SETTINGS = {
  gpsEnabled: true,
  keepAwake: true,
  autoAdvanceHole: false,
  haptics: true,
  noSpoilers: false,
  showRunningScore: true,
  statGroups: { putting: true, teeShot: true, approach: true, shortGame: true, penalties: true },
  units: 'meters', // 'meters' | 'yards' — display-only, storage is always meters
  notifications: { scores: true, invites: true, media: true },
};

// One level deep: object-valued keys (statGroups, notifications) merge
// key-wise; everything else replaces.
export function mergeAppSettings(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...base[k], ...v } : v;
  }
  return out;
}

let current = DEFAULT_APP_SETTINGS;
const listeners = new Set();

export function getAppSettings() { return current; }
export function subscribeAppSettings(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function set(next) { current = next; listeners.forEach((cb) => cb()); }

export function __resetAppSettingsForTests() { current = DEFAULT_APP_SETTINGS; listeners.clear(); }

async function pushToServer() {
  try {
    await upsertProfile({ settings: current });
    await AsyncStorage.removeItem(SETTINGS_DIRTY_KEY);
  } catch {
    await AsyncStorage.setItem(SETTINGS_DIRTY_KEY, '1');
  }
}

// Write-through: UI state and the local mirror update immediately; the
// server write is best-effort with a dirty flag replayed on next hydrate.
export async function updateAppSettings(patch) {
  set(mergeAppSettings(current, patch));
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  await pushToServer();
}

// Call at app start and whenever the auth session appears. Local mirror
// first (instant), then reconcile with the server: dirty or first-ever blob
// pushes local up, otherwise the server copy wins.
export async function hydrateAppSettings() {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw != null) {
      set(mergeAppSettings(DEFAULT_APP_SETTINGS, JSON.parse(raw)));
    } else {
      // First run of the settings system on this device: import the one
      // legacy pref that predates it.
      const legacy = await AsyncStorage.getItem(LEGACY_RUNNING_SCORE_KEY);
      if (legacy != null) set(mergeAppSettings(current, { showRunningScore: legacy === '1' }));
    }
  } catch { /* corrupted mirror — stay on defaults */ }

  try {
    const profile = await loadProfile();
    if (!profile) return;
    const server = profile.settings ?? {};
    const dirty = await AsyncStorage.getItem(SETTINGS_DIRTY_KEY);
    if (dirty === '1' || Object.keys(server).length === 0) {
      await pushToServer();
    } else {
      set(mergeAppSettings(DEFAULT_APP_SETTINGS, server));
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
    }
  } catch { /* offline — local copy stands */ }
}
```

- [ ] **Step 4: Implement `src/hooks/useAppSettings.js`**

```js
import { useSyncExternalStore } from 'react';
import { subscribeAppSettings, getAppSettings } from '../store/settingsStore';

// Reactive app-level settings. Named "app" settings to avoid colliding with
// tournament `settings` already used across screens.
export function useAppSettings() {
  return useSyncExternalStore(subscribeAppSettings, getAppSettings, getAppSettings);
}
```

- [ ] **Step 5: Wire hydration in App.js**

At `App.js:160-162` the session effect currently reads:

```js
useEffect(() => {
  if (session) registerPushToken();
}, [session]);
```

Change to (import `hydrateAppSettings` from `./src/store/settingsStore` next to the other store imports around line 69):

```js
useEffect(() => {
  // Local mirror loads even signed-out; server reconcile happens once a
  // session exists (hydrateAppSettings no-ops server-side without a user).
  hydrateAppSettings();
  if (session) registerPushToken();
}, [session]);
```

- [ ] **Step 6: Run tests + lint**

Run: `npx jest src/store/__tests__/settingsStore.test.js && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/store/settingsStore.js src/hooks/useAppSettings.js src/store/__tests__/settingsStore.test.js App.js
git commit -m "feat(settings): settingsStore with AsyncStorage mirror, server sync, useAppSettings hook"
```

---

### Task 3: ThemeContext `system` mode

**Files:**
- Modify: `src/theme/ThemeContext.js`, `app.json` (`"userInterfaceStyle"`)
- Test: `src/theme/__tests__/ThemeContext.test.js` (new)

**Interfaces:**
- Produces: `useTheme()` additionally returns `themePref` (`'light' | 'dark' | 'system'`) and `setThemeMode(pref)`. `mode` keeps meaning the RESOLVED mode (`'light' | 'dark'`) so every existing consumer is untouched. `toggle` is kept as-is (still used by ProfileScreen until Task 4 removes it).

- [ ] **Step 1: Write failing test**

`src/theme/__tests__/ThemeContext.test.js`:

```js
import React from 'react';
import { Text } from 'react-native';
import { render, screen, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider, useTheme } from '../ThemeContext';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true, default: jest.fn(() => 'dark'),
}));

function Probe() {
  const { mode, themePref, setThemeMode } = useTheme();
  Probe.api = { setThemeMode };
  return <Text testID="probe">{`${themePref}:${mode}`}</Text>;
}

beforeEach(() => AsyncStorage.clear());

test('defaults to system and resolves via OS scheme', async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('system:dark'));
});

test('explicit pref overrides system and persists', async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => screen.getByTestId('probe'));
  await act(async () => { Probe.api.setThemeMode('light'); });
  expect(screen.getByTestId('probe')).toHaveTextContent('light:light');
  expect(await AsyncStorage.getItem('@golf_theme_mode')).toBe('light');
});

test('stored legacy value still respected', async () => {
  await AsyncStorage.setItem('@golf_theme_mode', 'dark');
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('dark:dark'));
});
```

If the `useColorScheme` deep-path mock fails under jest-expo, mock it via `jest.spyOn(require('react-native'), 'useColorScheme')` instead — match whatever pattern other tests in the repo use for RN hooks.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/theme/__tests__/ThemeContext.test.js`
Expected: FAIL — `themePref` undefined.

- [ ] **Step 3: Implement**

Rework `ThemeProvider` state (keep every derived value and export exactly as today):

```js
import { useColorScheme } from 'react-native';
// ...
const [pref, setPref] = useState('system'); // 'light' | 'dark' | 'system'
const [ready, setReady] = useState(false);
const systemScheme = useColorScheme();

useEffect(() => {
  AsyncStorage.getItem(STORAGE_KEY).then(saved => {
    if (saved === 'light' || saved === 'dark' || saved === 'system') setPref(saved);
    setReady(true);
  });
}, []);

const mode = pref === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : pref;

const setThemeMode = (next) => {
  if (next !== 'light' && next !== 'dark' && next !== 'system') return;
  setPref(next);
  AsyncStorage.setItem(STORAGE_KEY, next);
};

const toggle = () => setThemeMode(mode === 'light' ? 'dark' : 'light');
```

Provider value becomes `{ theme, mode, themePref: pref, setThemeMode, toggle, ready }`. In `app.json`, change `"userInterfaceStyle": "light"` to `"userInterfaceStyle": "automatic"` (otherwise native `useColorScheme` is pinned to light and System is a no-op).

- [ ] **Step 4: Run tests + full suite + lint**

Run: `npx jest src/theme && npm test && npm run lint`
Expected: PASS (full suite guards the untouched `mode` consumers). Note: memory `jest-scans-nested-worktrees` — ignore failures coming from `.claude/worktrees`/`.worktrees` copies.

- [ ] **Step 5: Commit**

```bash
git add src/theme/ThemeContext.js src/theme/__tests__/ThemeContext.test.js app.json
git commit -m "feat(theme): follow-system option with persisted light/dark/system pref"
```

---

### Task 4: SettingsScreen + navigation + ProfileScreen slim-down

**Files:**
- Create: `src/screens/SettingsScreen.js`
- Modify: `App.js:277` area (register screen), `src/screens/ProfileScreen.js` (remove APPEARANCE + PREFERENCES sections, add Settings link row)
- Test: `src/screens/__tests__/SettingsScreen.test.js`

**Interfaces:**
- Consumes: `useAppSettings()`, `updateAppSettings(patch)` (Task 2); `useTheme().themePref/setThemeMode` (Task 3).
- Produces: route name `Settings`.

- [ ] **Step 1: Write failing test**

`src/screens/__tests__/SettingsScreen.test.js` (follow the render/mocking conventions of an existing screen test such as `EditTournamentScreen.test.js` — theme provider wrapper, navigation stub):

```js
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SettingsScreen from '../SettingsScreen';
import { getAppSettings, __resetAppSettingsForTests } from '../../store/settingsStore';

jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn().mockResolvedValue(null),
  upsertProfile: jest.fn().mockResolvedValue(),
}));

const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const renderScreen = () => render(
  <ThemeProvider><SettingsScreen navigation={navigation} /></ThemeProvider>,
);

beforeEach(() => __resetAppSettingsForTests());

test('renders the four sections', async () => {
  renderScreen();
  await waitFor(() => screen.getByText('ROUND & GPS'));
  expect(screen.getByText('STATS TRACKING')).toBeTruthy();
  expect(screen.getByText('DISPLAY')).toBeTruthy();
  expect(screen.getByText('NOTIFICATIONS')).toBeTruthy();
});

test('GPS toggle updates the store', async () => {
  renderScreen();
  const sw = await screen.findByTestId('setting-gpsEnabled');
  fireEvent(sw, 'valueChange', false);
  await waitFor(() => expect(getAppSettings().gpsEnabled).toBe(false));
});

test('stat group rows show what is lost', async () => {
  renderScreen();
  await screen.findByText(/no putting stats, no GIR/i);
  const sw = screen.getByTestId('setting-statGroups.putting');
  fireEvent(sw, 'valueChange', false);
  await waitFor(() => expect(getAppSettings().statGroups.putting).toBe(false));
});

test('units segment switches to yards', async () => {
  renderScreen();
  fireEvent.press(await screen.findByText('Yards'));
  await waitFor(() => expect(getAppSettings().units).toBe('yards'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/__tests__/SettingsScreen.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SettingsScreen`**

Structure (styles: copy `sectionLabel`, `prefRow`, `prefLabel`, `fieldHint`, `linkRow`, header styles from `ProfileScreen.js` `makeStyles`; reuse `ScreenContainer` and back-button header like ProfileScreen):

```js
import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import { useTheme } from '../theme/ThemeContext';
import { useAppSettings } from '../hooks/useAppSettings';
import { updateAppSettings } from '../store/settingsStore';

const STAT_GROUP_ROWS = [
  { key: 'putting', label: 'Putting', loss: 'Off: no putting stats, no GIR, no strokes gained putting' },
  { key: 'teeShot', label: 'Tee shot', loss: 'Off: no fairways hit, no driving distance, no SG off the tee' },
  { key: 'approach', label: 'Approach', loss: 'Off: no approach breakdown, no SG approach' },
  { key: 'shortGame', label: 'Short game', loss: 'Off: no sand saves or up-and-downs, reduced SG around the green' },
  { key: 'penalties', label: 'Penalties', loss: 'Off: no penalty stats, no SG penalties' },
];

function SwitchRow({ testID, label, hint, value, onChange, disabled, theme, s }) {
  return (
    <View style={s.prefRow}>
      <View style={{ flex: 1 }}>
        <Text style={[s.prefLabel, disabled && { color: theme.text.muted }]}>{label}</Text>
        {hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: theme.border.default, true: theme.accent.primary }}
        thumbColor={Platform.OS === 'android' ? theme.bg.card : undefined}
      />
    </View>
  );
}

export default function SettingsScreen({ navigation }) {
  const { theme, themePref, setThemeMode } = useTheme();
  const s = makeStyles(theme);
  const appSettings = useAppSettings();
  const setKey = useCallback((patch) => { updateAppSettings(patch); }, []);

  return (
    <ScreenContainer>
      {/* header: back chevron + "Settings" title, same as ProfileScreen header */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        <Text style={s.sectionLabel}>ROUND & GPS</Text>
        <SwitchRow testID="setting-gpsEnabled" label="GPS distances"
          hint="Live distances from your position. Off: distances measure from the tee and the app never asks for your location."
          value={appSettings.gpsEnabled} onChange={(v) => setKey({ gpsEnabled: v })} theme={theme} s={s} />
        <SwitchRow testID="setting-keepAwake" label="Keep screen awake"
          hint="Stops the screen sleeping while the scorecard is open."
          value={appSettings.keepAwake} onChange={(v) => setKey({ keepAwake: v })} theme={theme} s={s} />
        <SwitchRow testID="setting-autoAdvanceHole" label="Auto-advance hole"
          hint="Flip to the next hole once every player has a score."
          value={appSettings.autoAdvanceHole} onChange={(v) => setKey({ autoAdvanceHole: v })} theme={theme} s={s} />
        <SwitchRow testID="setting-haptics" label="Haptic feedback"
          hint="Vibrate on score entry."
          value={appSettings.haptics} onChange={(v) => setKey({ haptics: v })} theme={theme} s={s} />
        <SwitchRow testID="setting-noSpoilers" label="No-spoilers mode"
          hint="Hide running points and leaderboards until the round is finished."
          value={appSettings.noSpoilers} onChange={(v) => setKey({ noSpoilers: v })} theme={theme} s={s} />
        <SwitchRow testID="setting-showRunningScore" label="Show running points"
          hint={appSettings.noSpoilers ? 'Off while no-spoilers mode is on.' : 'Total Stableford points under every scorecard name.'}
          value={appSettings.showRunningScore && !appSettings.noSpoilers}
          disabled={appSettings.noSpoilers}
          onChange={(v) => setKey({ showRunningScore: v })} theme={theme} s={s} />

        <Text style={s.sectionLabel}>STATS TRACKING</Text>
        <Text style={s.fieldHint}>Turn off what you don't want to log — the scorecard hides those inputs.</Text>
        {STAT_GROUP_ROWS.map(({ key, label, loss }) => (
          <SwitchRow key={key} testID={`setting-statGroups.${key}`} label={label} hint={loss}
            value={appSettings.statGroups[key]}
            onChange={(v) => setKey({ statGroups: { [key]: v } })} theme={theme} s={s} />
        ))}

        <Text style={s.sectionLabel}>DISPLAY</Text>
        {/* Units: two-segment control */}
        <View style={s.segmentRow}>
          {[['meters', 'Meters'], ['yards', 'Yards']].map(([value, label]) => (
            <TouchableOpacity key={value}
              style={[s.segment, appSettings.units === value && s.segmentActive]}
              onPress={() => setKey({ units: value })}
              accessibilityRole="button" accessibilityState={{ selected: appSettings.units === value }}>
              <Text style={[s.segmentText, appSettings.units === value && s.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {/* Theme: three tiles — port the appearanceRow/appearanceTile styles from ProfileScreen,
            options light/dark/system with icons sun/moon/smartphone, active = themePref === value,
            onPress={() => setThemeMode(value)} */}

        <Text style={s.sectionLabel}>NOTIFICATIONS</Text>
        <SwitchRow testID="setting-notifications.scores" label="Score updates"
          hint="When a friend finishes a round."
          value={appSettings.notifications.scores}
          onChange={(v) => setKey({ notifications: { scores: v } })} theme={theme} s={s} />
        <SwitchRow testID="setting-notifications.invites" label="Invites & friends"
          hint="Friend requests and being added to games."
          value={appSettings.notifications.invites}
          onChange={(v) => setKey({ notifications: { invites: v } })} theme={theme} s={s} />
        <SwitchRow testID="setting-notifications.media" label="Photos & reactions"
          hint="Comments and reactions on rounds."
          value={appSettings.notifications.media}
          onChange={(v) => setKey({ notifications: { media: v } })} theme={theme} s={s} />
      </ScrollView>
    </ScreenContainer>
  );
}
```

(`makeStyles`: copy the referenced style objects from ProfileScreen verbatim; add `segmentRow`/`segment`/`segmentActive`/`segmentText`/`segmentTextActive` modeled on the `genderPill` styles.)

- [ ] **Step 4: Register route + ProfileScreen changes**

In `App.js` add below the `Profile` registration at line 277:

```js
<Stack.Screen name="Settings" component={SettingsScreen} />
```

(import `SettingsScreen from './src/screens/SettingsScreen'` next to the ProfileScreen import at line 64).

In `ProfileScreen.js`:
- Delete the APPEARANCE section (lines 386-412) and PREFERENCES section (lines 414-429), the `showRunning` state (line 35), `toggleShowRunning` (59-64), the `getShowRunningScore` load in `load()` (line 41/49 — revert to `const p = await loadProfile()`), and the `prefs` import (line 15). Keep `toggle` unused → also drop `toggle`/`mode` from the `useTheme()` destructure (line 19) if nothing else uses them.
- Above the SOCIAL section (line 431) add:

```js
<Text style={s.sectionLabel}>APP</Text>
<TouchableOpacity style={s.linkRow} onPress={() => navigation.navigate('Settings')} activeOpacity={0.7}>
  <Feather name="settings" size={18} color={theme.accent.primary} />
  <Text style={s.linkRowText}>Settings</Text>
  <Feather name="chevron-right" size={18} color={theme.text.muted} />
</TouchableOpacity>
```

- [ ] **Step 5: Run tests + lint**

Run: `npx jest src/screens/__tests__/SettingsScreen.test.js && npm test && npm run lint`
Expected: PASS (full suite catches ProfileScreen test fallout if any).

- [ ] **Step 6: Commit**

```bash
git add src/screens/SettingsScreen.js src/screens/__tests__/SettingsScreen.test.js src/screens/ProfileScreen.js App.js
git commit -m "feat(settings): dedicated Settings screen; Profile keeps identity only"
```

---

### Task 5: GPS toggle → tee-distance mode

**Files:**
- Modify: `src/hooks/useGpsDistances.js`
- Test: `src/hooks/__tests__/useGpsDistances.test.js` (new)

**Interfaces:**
- Consumes: `subscribeAppSettings`/`getAppSettings` (Task 2).
- Produces: unchanged hook shape `{ available, distances, source, accuracy, position }`; with `gpsEnabled: false` it never requests permission, `source` is `'tee'` whenever the hole has a tee, and `position` is `null` (so `HoleFlyover` draws no player dot — it already receives `position` from this hook's consumer). `HoleDistanceBlock` needs NO changes — the FROM TEE variant shipped in fa2db8e.

- [ ] **Step 1: Write failing test**

`src/hooks/__tests__/useGpsDistances.test.js`:

```js
import React from 'react';
import { Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useGpsDistances } from '../useGpsDistances';
import { updateAppSettings, __resetAppSettingsForTests } from '../../store/settingsStore';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue(null),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  Accuracy: { High: 4 },
}));
jest.mock('../../lib/geo', () => ({
  findCourseGeometry: jest.fn(() => ({ holes: {} })),
  subscribeCourseGeometry: jest.fn(() => () => {}),
  getCourseGeometryVersion: jest.fn(() => 1),
}));
jest.mock('../../lib/flyoverModel', () => ({
  resolveScorecardDistances: jest.fn(({ fix }) => (fix
    ? { distances: { center: 120 }, source: 'gps' }
    : { distances: { center: 340, front: 330, back: 350 }, source: 'tee' })),
}));
jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn().mockResolvedValue(null),
  upsertProfile: jest.fn().mockResolvedValue(),
}));

function Probe({ course = 'C', hole = 1 }) {
  const gps = useGpsDistances(course, hole);
  return <Text testID="out">{JSON.stringify({ a: gps.available, s: gps.source, p: gps.position })}</Text>;
}

beforeEach(() => { jest.clearAllMocks(); __resetAppSettingsForTests(); });

test('gpsEnabled=false: no permission request, tee source, null position', async () => {
  await updateAppSettings({ gpsEnabled: false });
  render(<Probe />);
  await waitFor(() => {
    expect(JSON.parse(screen.getByTestId('out').props.children))
      .toEqual({ a: true, s: 'tee', p: null });
  });
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
});

test('gpsEnabled=true keeps requesting permission (default path)', async () => {
  render(<Probe />);
  await waitFor(() => expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/hooks/__tests__/useGpsDistances.test.js`
Expected: FAIL — permission requested even with gpsEnabled false.

- [ ] **Step 3: Implement**

In `useGpsDistances.js`:

```js
import { subscribeAppSettings, getAppSettings } from '../store/settingsStore';
// inside the hook, next to the geometry subscription:
const appSettings = useSyncExternalStore(subscribeAppSettings, getAppSettings, getAppSettings);
const gpsEnabled = appSettings.gpsEnabled !== false;
```

Gate the watch effect (line 31): `if (!hasGeometry || !gpsEnabled) return undefined;` and add `gpsEnabled` to its dep array. Resolution (line 82):

```js
const resolved = useMemo(() => {
  if (!geometry) return { distances: null, source: 'gps' };
  return resolveScorecardDistances({
    courseName, holeNumber,
    fix: gpsEnabled ? (fix?.pos ?? null) : null, // disabled = pretend no fix → tee path
  });
}, [geometry, fix, courseName, holeNumber, gpsEnabled]);
```

Return block:

```js
available: !!geometry && (gpsEnabled ? (!denied || resolved.source === 'tee') : resolved.source === 'tee'),
distances: resolved.distances,
source: resolved.source,
accuracy: gpsEnabled ? (fix?.accuracy ?? null) : null,
position: gpsEnabled ? (fix?.pos ?? null) : null,
```

Update the file's header comment to mention the setting (rule 1 of the source-resolution order: disabled → tee).

- [ ] **Step 4: Run tests + lint**

Run: `npx jest src/hooks src/components/scorecard/__tests__/HoleDistanceBlock.test.js && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGpsDistances.js src/hooks/__tests__/useGpsDistances.test.js
git commit -m "feat(settings): GPS toggle — off means tee distances, no permission prompt"
```

---

### Task 6: Stat group toggles in the shot panel

**Files:**
- Modify: `src/components/scorecard/constants.js`, `src/components/scorecard/ShotDetailPanel.js`, `src/components/scorecard/ShotDetailSection.js`
- Test: `src/components/scorecard/__tests__/ShotDetailPanel.test.js` (append)

**Interfaces:**
- Consumes: `useAppSettings()` (Task 2).
- Produces: `ShotDetailPanel` accepts optional prop `statGroups` (`{putting, teeShot, approach, shortGame, penalties}`, missing keys = on). `ShotDetailSection` reads `useAppSettings().statGroups`, passes it down, and returns `null` when every group is off. New export `STAT_GROUP_FIELDS` in constants.

- [ ] **Step 1: Write failing tests**

Append to `ShotDetailPanel.test.js` (reuse the file's existing render helper / hole fixtures):

```js
describe('stat group toggles', () => {
  const hole = { number: 1, par: 4 };

  it('hides putting rows when putting is off', () => {
    render(<ShotDetailPanel hole={hole} detail={{ putts: 2 }} onChange={jest.fn()} strokes={5}
      statGroups={{ putting: false }} />);
    expect(screen.queryByText('Putts')).toBeNull();
    expect(screen.queryByText('First putt')).toBeNull();
    expect(screen.getByText('Tee penalties')).toBeTruthy(); // others untouched
  });

  it('hides tee-shot rows when teeShot is off', () => {
    render(<ShotDetailPanel hole={hole} detail={{}} onChange={jest.fn()} strokes={5}
      statGroups={{ teeShot: false }} />);
    expect(screen.queryByText('Tee club')).toBeNull();
    expect(screen.queryByText('Drive distance')).toBeNull();
  });

  it('hides approach rows when approach is off', () => {
    render(<ShotDetailPanel hole={hole} detail={{ approachBucket: '50-100' }} onChange={jest.fn()} strokes={5}
      statGroups={{ approach: false }} />);
    expect(screen.queryByText('Approach')).toBeNull();
    expect(screen.queryByText('Where did it finish?')).toBeNull();
  });

  it('hides short-game and penalties rows per group', () => {
    render(<ShotDetailPanel hole={hole} detail={{}} onChange={jest.fn()} strokes={5}
      statGroups={{ shortGame: false, penalties: false }} />);
    expect(screen.queryByText('Sand shots')).toBeNull();
    expect(screen.queryByText('Tee penalties')).toBeNull();
    expect(screen.queryByText('Other penalties')).toBeNull();
  });
});
```

And a `ShotDetailSection` test (same file, or the section's own test file if one exists — check first):

```js
it('ShotDetailSection renders nothing when every stat group is off', async () => {
  await updateAppSettings({ statGroups: {
    putting: false, teeShot: false, approach: false, shortGame: false, penalties: false,
  } });
  const { toJSON } = render(
    <ShotDetailSection hole={{ number: 1, par: 4 }} detail={{}} onChange={jest.fn()}
      strokes={4} collapsed={false} onToggle={jest.fn()} />,
  );
  expect(toJSON()).toBeNull();
});
```

(Mock `../../store/profileStore` as in Task 5's test so `updateAppSettings` doesn't hit supabase; reset the store in `beforeEach` with `__resetAppSettingsForTests`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/scorecard/__tests__/ShotDetailPanel.test.js`
Expected: FAIL — rows still render.

- [ ] **Step 3: Implement**

`constants.js` — add after `DEFAULT_SHOT`:

```js
// Which DEFAULT_SHOT fields belong to each configurable tracking group
// (Settings → Stats tracking). Hiding a group hides exactly these inputs.
export const STAT_GROUP_FIELDS = {
  putting: ['putts', 'firstPuttBucket'],
  teeShot: ['teeClub', 'drive', 'driveLie', 'driveDistBucket'],
  approach: ['approachBucket', 'approachResult', 'approachLie'],
  shortGame: ['sandShots', 'recoveryOutcome'],
  penalties: ['teePenalties', 'otherPenalties'],
};
```

`ShotDetailPanel.js` — accept and apply the prop:

```js
export function ShotDetailPanel({ hole, detail, onChange, strokes, statGroups, theme: themeProp, s: sProp }) {
  // ...
  const g = {
    putting: true, teeShot: true, approach: true, shortGame: true, penalties: true,
    ...(statGroups ?? {}),
  };
```

Wrap the rows:
- Putts counter (line 210) and First putt bucket (line 386): `{g.putting && (...)}` — for First putt the existing condition becomes `{g.putting && (d.putts ?? 0) >= 1 && (...)}`.
- Tee penalties + Other penalties counters (218-233): `{g.penalties && (...)}` each.
- Sand shots counter (234-248) and the missed-GIR Outcome row (406): `{g.shortGame && (...)}` (Outcome additionally keeps its `missedGIR` condition).
- Tee club / drive circles / drive lie / drive distance (250-333): change each `{!isPar3 && ...}` to `{g.teeShot && !isPar3 && ...}`.
- Approach bucket / result / lie (334-385): `{g.approach && ...}` (bucket row loses its unconditional render; result/lie keep their `d.approachBucket` conditions).

The stroke budget needs no change — hidden counters stay 0/null so `shotDetailStrokeCount` only counts visible ones.

`ShotDetailSection.js`:

```js
import { useAppSettings } from '../../hooks/useAppSettings';
// inside the component:
const { statGroups } = useAppSettings();
const anyOn = Object.values({ putting: true, teeShot: true, approach: true, shortGame: true, penalties: true, ...statGroups }).some(Boolean);
if (!anyOn) return null;
// pass through:
<ShotDetailPanel hole={hole} detail={detail} onChange={onChange} strokes={strokes} statGroups={statGroups} />
```

- [ ] **Step 4: Run tests + lint**

Run: `npx jest src/components/scorecard && npm run lint`
Expected: PASS (existing ShotDetailPanel tests prove the all-on default is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/constants.js src/components/scorecard/ShotDetailPanel.js src/components/scorecard/ShotDetailSection.js src/components/scorecard/__tests__/ShotDetailPanel.test.js
git commit -m "feat(settings): stat-group toggles hide shot-detail inputs"
```

---

### Task 7: Scorecard behaviors — haptics gate, keep-awake, auto-advance, no-spoilers, running-points migration

**Files:**
- Create: `src/lib/autoAdvance.js`
- Modify: `src/screens/ScorecardScreen.js` (lines 63-67 haptic; 1148-1161 running score; setScore ~1090-1113 and stepScore ~1115-1147; eye toggle 1546; official-leaderboard button 1552; `showRunning` at 1677)
- Test: `src/lib/__tests__/autoAdvance.test.js` (new)

**Interfaces:**
- Consumes: `getAppSettings()`, `updateAppSettings`, `useAppSettings()` (Task 2).
- Produces: `holeComplete(scores, players, holeNumber): boolean` in `src/lib/autoAdvance.js`.

- [ ] **Step 1: Install expo-keep-awake**

Run: `npx expo install expo-keep-awake`
Expected: dependency added to package.json at the SDK-54-pinned version.

- [ ] **Step 2: Write failing test for the pure helper**

`src/lib/__tests__/autoAdvance.test.js`:

```js
import { holeComplete } from '../autoAdvance';

const players = [{ id: 'a' }, { id: 'b' }];

test('true only when every player has a score on the hole', () => {
  expect(holeComplete({ a: { 1: 5 }, b: { 1: 4 } }, players, 1)).toBe(true);
  expect(holeComplete({ a: { 1: 5 }, b: {} }, players, 1)).toBe(false);
  expect(holeComplete({ a: { 1: 5 } }, players, 1)).toBe(false);
  expect(holeComplete({ a: { 1: 0 }, b: { 1: 4 } }, players, 1)).toBe(false); // 0 = no score
});

test('empty inputs are never complete', () => {
  expect(holeComplete({}, [], 1)).toBe(false);
  expect(holeComplete(null, players, 1)).toBe(false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/autoAdvance.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/lib/autoAdvance.js`**

```js
// True when every player has a positive stroke count recorded for the hole.
// Pure — drives the optional auto-advance-hole setting on the scorecard.
export function holeComplete(scores, players, holeNumber) {
  if (!scores || !players?.length) return false;
  return players.every((p) => {
    const v = scores[p.id]?.[holeNumber];
    return typeof v === 'number' && v > 0;
  });
}
```

- [ ] **Step 5: Wire ScorecardScreen**

Imports: `import { holeComplete } from '../lib/autoAdvance';`, `import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';`, `import { getAppSettings, updateAppSettings } from '../store/settingsStore';`, `import { useAppSettings } from '../hooks/useAppSettings';` — and DELETE the prefs import at line 14.

1. **Haptics** (module-level `haptic`, line 63):

```js
const haptic = (style = 'light') => {
  if (Platform.OS === 'web') return;
  if (getAppSettings().haptics === false) return;
  // ...unchanged impact/notification calls
};
```

2. **Settings in the component** (near the `showRunning` state, line 1148):

```js
const appSettings = useAppSettings();
```

Replace the `showRunning` state + prefs effect + `toggleRunning` (lines 1148-1161) with:

```js
const showRunning = appSettings.showRunningScore && !appSettings.noSpoilers;
const toggleRunning = useCallback(() => {
  updateAppSettings({ showRunningScore: !getAppSettings().showRunningScore }).catch(() => {});
}, []);
```

3. **Keep awake** (new effect next to the other mount effects):

```js
useEffect(() => {
  if (!appSettings.keepAwake) return undefined;
  activateKeepAwakeAsync('scorecard').catch(() => {});
  return () => { try { deactivateKeepAwake('scorecard'); } catch { /* not held */ } };
}, [appSettings.keepAwake]);
```

4. **Auto-advance**: add refs near `currentHole` (line 266):

```js
const currentHoleRef = useRef(1);
useEffect(() => { currentHoleRef.current = currentHole; }, [currentHole]);
const autoAdvanceTimer = useRef(null);
useEffect(() => () => { if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current); }, []);

// Schedule after each score write; a follow-up tap on the same hole resets
// the timer so quick +/- adjustments land before the page flips.
const maybeAutoAdvance = useCallback((nextScores, holeNumber) => {
  if (autoAdvanceTimer.current) { clearTimeout(autoAdvanceTimer.current); autoAdvanceTimer.current = null; }
  if (!getAppSettings().autoAdvanceHole) return;
  if (holeNumber !== currentHoleRef.current) return;
  const maxHole = round?.holes?.length ?? 18;
  if (holeNumber >= maxHole) return;
  if (!holeComplete(nextScores, players, holeNumber)) return;
  autoAdvanceTimer.current = setTimeout(() => {
    if (currentHoleRef.current === holeNumber) goToNextHole();
  }, 1200);
}, [round, players, goToNextHole]);
```

Call `maybeAutoAdvance(next, holeNumber);` as the last line of BOTH `setScore` (after the celebration block ending ~line 1112) and `stepScore` (after its celebration block ending ~line 1146), using each callback's local `next` scores object and `holeNumber`. Add `maybeAutoAdvance` to both dep arrays. Also clear any pending timer inside `goToHole` (line 1198) so manual navigation cancels a scheduled advance.

5. **No-spoilers**: `showRunning` above already forces running points off. Additionally hide the eye toggle (line 1546 block) and the official leaderboard button (line 1552 block) behind `{!appSettings.noSpoilers && (...)}`.

- [ ] **Step 6: Run tests + lint**

Run: `npx jest src/lib/__tests__/autoAdvance.test.js src/screens/__tests__/ScorecardScreen.test.js && npm test && npm run lint`
Expected: PASS. If ScorecardScreen.test.js stubs prefs' `getShowRunningScore`, update those stubs to seed `settingsStore` instead (`__resetAppSettingsForTests` + `updateAppSettings`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/autoAdvance.js src/lib/__tests__/autoAdvance.test.js src/screens/ScorecardScreen.js package.json package-lock.json
git commit -m "feat(settings): haptics gate, keep-awake, auto-advance hole, no-spoilers on scorecard"
```

---

### Task 8: Units — meters/yards display

**Files:**
- Create: `src/lib/units.js`
- Modify: `src/components/scorecard/constants.js` (yard label maps), `src/components/scorecard/HoleDistanceBlock.js`, `src/components/scorecard/ShotDetailPanel.js` (hints + label maps), `src/components/scorecard/HoleFlyover.js` (pass `units` into map data), `src/lib/holeMapHtml.js:58,177,208-210`, `src/components/mystats/tabs/ShotsTab.js:458,461-462,474-478`
- Test: `src/lib/__tests__/units.test.js` (new)

**Interfaces:**
- Consumes: `useAppSettings().units` (Task 2).
- Produces: `formatDistance(meters, units): string` (rounded number as string, `'—'` for null), `unitSuffix(units): 'm'|'yd'`, `unitWord(units): 'metres'|'yards'`, `M_TO_YD = 1.09361` from `src/lib/units.js`.

- [ ] **Step 1: Write failing test**

`src/lib/__tests__/units.test.js`:

```js
import { formatDistance, unitSuffix, unitWord, M_TO_YD } from '../units';

test('meters pass through rounded', () => {
  expect(formatDistance(151.4, 'meters')).toBe('151');
  expect(formatDistance(null, 'meters')).toBe('—');
});

test('yards convert at 1.09361', () => {
  expect(formatDistance(100, 'yards')).toBe('109');
  expect(formatDistance(150, 'yards')).toBe('164');
});

test('suffix and word', () => {
  expect(unitSuffix('meters')).toBe('m');
  expect(unitSuffix('yards')).toBe('yd');
  expect(unitWord('yards')).toBe('yards');
  expect(unitWord('meters')).toBe('metres');
  expect(M_TO_YD).toBeCloseTo(1.09361);
});
```

- [ ] **Step 2: Run test to verify it fails, then implement `src/lib/units.js`**

```js
// Display-side unit conversion. Distances are STORED in meters everywhere;
// only rendering converts (Settings → Display → Units).
export const M_TO_YD = 1.09361;

export function formatDistance(meters, units) {
  if (meters == null || Number.isNaN(meters)) return '—';
  return String(Math.round(units === 'yards' ? meters * M_TO_YD : meters));
}

export function unitSuffix(units) { return units === 'yards' ? 'yd' : 'm'; }
export function unitWord(units) { return units === 'yards' ? 'yards' : 'metres'; }
```

Run: `npx jest src/lib/__tests__/units.test.js` → PASS.

- [ ] **Step 3: Yard label maps in `constants.js`**

```js
// Yard-equivalent display labels for the meter-defined buckets (storage keys
// never change). Rounded to friendly 5s.
export const DRIVE_DIST_LABELS_YD = {
  '0-150': '<165', '150-180': '165-195', '180-210': '195-230',
  '210-240': '230-260', '240+': '260+',
};
export const APPROACH_LABELS_YD = {
  '0-50': '0-55', '50-100': '55-110', '100-150': '110-165',
  '150-200': '165-220', '200+': '220+',
};
export const FIRST_PUTT_LABELS_YD = {
  '0-1': '0-1', '1-2': '1-2', '2-3': '2-3', '3-6': '3-7', '6+': '7+',
};
```

- [ ] **Step 4: Apply in components**

`HoleDistanceBlock.js`: `const { units } = useAppSettings();` — replace every `fmt(x)` with `formatDistance(x, units)` (delete local `fmt`), and both hard-coded `m` unit texts (lines 39, 58) with `{unitSuffix(units)}`. Off-course km line stays metric.

`ShotDetailPanel.js`: `const { units } = useAppSettings();` (hook is fine here — panel already calls `useTheme`). `approachShotHint` (line 178) becomes `unitWord(units)`; the two other `hint="metres"` (lines 324, 395) become `hint={unitWord(units)}`; pick label maps:

```js
const driveDistLabels = units === 'yards' ? DRIVE_DIST_LABELS_YD : DRIVE_DIST_LABELS;
const approachLabels = units === 'yards' ? APPROACH_LABELS_YD : APPROACH_LABELS;
const firstPuttLabels = units === 'yards' ? FIRST_PUTT_LABELS_YD : FIRST_PUTT_LABELS;
```

and use them in the three `BucketSegment` `labels=` props.

`HoleFlyover.js`: where the `data` object for `buildHoleMapHtml`/`HoleMapView` is assembled (line 43-45 `useMemo`), add `units: getAppSettings().units` (import from settingsStore; a re-render on change is not needed mid-sheet — it applies on next open).

`holeMapHtml.js`: next to `round` (line 58) add:

```js
const M2YD = 1.09361;
```

and inside the script where the injected `data` object is in scope, define `const U = data.units === 'yards' ? 'yd' : 'm';` and `const disp = (x) => round(data.units === 'yards' ? x * M2YD : x);` (mirror however `round` is made available to that scope — this file is a template-string HTML document; follow its existing structure). Replace `round(d)+' m'` (line 177) with `disp(d)+' '+U`, and in the HUD rows (lines 208-210) `round(d(g.b))`/`round(d(g.c))`/`round(d(g.f))` with `disp(...)` and the `<span class="u">m</span>` with `'<span class="u">'+U+'</span>'`. Run `npx jest src/lib/__tests__/holeMapHtml.test.js` and update its fixtures if they assert the literal `m` strings.

`ShotsTab.js`: the component (line 23) adds `const { units } = useAppSettings();` and threads `units` into the row-builder function containing lines 455-482. Replace:

```js
value: `~${formatDistance(driveDistance.avgDistance, units)} ${unitSuffix(units)}`,
// secondary target line:
`target ~${formatDistance(Math.round(shotBenchmark.driverDistance * YD_TO_M), units)} ${unitSuffix(units)}`,
```

(both the populated and the `—` placeholder row's target text). The `toneFromComparison` inputs stay in meters — only display strings convert. Other stats copy stays metric in v1 (follow-up).

- [ ] **Step 5: Run full suite + lint**

Run: `npm test && npm run lint`
Expected: PASS (fix any snapshot/label assertions that referenced "metres"/"m" defaults — defaults are unchanged, so fallout should be zero; investigate any failure rather than blanket-updating).

- [ ] **Step 6: Commit**

```bash
git add src/lib/units.js src/lib/__tests__/units.test.js src/components/scorecard/constants.js src/components/scorecard/HoleDistanceBlock.js src/components/scorecard/ShotDetailPanel.js src/components/scorecard/HoleFlyover.js src/lib/holeMapHtml.js src/components/mystats/tabs/ShotsTab.js
git commit -m "feat(settings): meters/yards display units across scorecard, hole map, driver distance"
```

---

### Task 9: Notification category mutes in send-push + prefs cleanup + runtime verify

**Files:**
- Modify: `supabase/functions/send-push/index.ts`, `src/lib/prefs.js` (delete running-score functions)
- Test: manual deploy verification (the edge function has no test harness; the client side is covered by Task 2's settings tests)

**Interfaces:**
- Consumes: `profiles.settings.notifications` blob written by Tasks 1-2.

- [ ] **Step 1: Category gate in `index.ts`**

After the `RENDERERS` map (line 71) add:

```ts
// Notification category per type — matches the three Settings toggles
// (profiles.settings.notifications.{scores,invites,media}). Absent key or
// absent settings = deliver (defaults are ON client-side too).
const CATEGORY_BY_TYPE: Record<string, 'scores' | 'invites' | 'media'> = {
  friend_request: 'invites',
  friend_accepted: 'invites',
  added_to_game: 'invites',
  round_finished: 'scores',
  feed_reaction: 'media',
  feed_comment: 'media',
};
```

Inside the handler, move the `createClient(...)` block (lines 93-96) to just BEFORE the `render` lookup (line 89), then insert after `const { title, body, deepLink } = render(...)`:

```ts
const category = CATEGORY_BY_TYPE[note.type];
if (category) {
  const { data: prof } = await supabase
    .from('profiles')
    .select('settings')
    .eq('user_id', note.user_id)
    .maybeSingle();
  const muted = (prof?.settings as Record<string, Record<string, boolean>> | null)
    ?.notifications?.[category] === false;
  if (muted) return new Response('muted', { status: 200 });
}
```

- [ ] **Step 2: Delete legacy running-score prefs**

In `src/lib/prefs.js` remove `SHOW_RUNNING_SCORE_KEY`, `getShowRunningScore`, `setShowRunningScore` (lines 3-14) — keep the shot-detail-collapsed pair. Verify nothing imports them anymore:

Run: `grep -rn "getShowRunningScore\|setShowRunningScore" src/ App.js`
Expected: no matches (settingsStore references the raw legacy key string, not these functions).

- [ ] **Step 3: Full suite + lint**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 4: Deploy the edge function**

Run: `supabase functions deploy send-push` (or via the Management API token in `.env` if the CLI isn't linked). If neither is available in this environment, STOP and tell the user the function is code-complete but needs `supabase functions deploy send-push` — do not silently skip.

- [ ] **Step 5: Runtime verification (verify skill)**

Use the `verify` skill (Expo web + Playwright MCP):
1. Profile → Settings opens; all four sections render.
2. Toggle "GPS distances" off → open a scorecard on a course with geometry → header shows FROM TEE and no browser location prompt fires.
3. Toggle Putting + Tee shot off → scorecard shot detail hides Putts/First putt/Tee club/Drive rows.
4. Switch units to Yards → header hero + shot-detail hints show yd/yards.
5. Enable No-spoilers → running points chips and the eye toggle disappear on the scorecard.
6. Reload the app → all changed settings persist.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/send-push/index.ts src/lib/prefs.js
git commit -m "feat(settings): per-category push mutes in send-push; drop legacy running-score pref"
```

---

## Self-Review Notes

- Spec coverage: §1 storage → Tasks 1-2; §2 catalog → Tasks 2/4; §3 GPS → Task 5; §4 stat groups → Tasks 4 (loss copy) + 6; §5 screen → Task 4; §6 wiring → Tasks 3 (theme), 7 (haptics/keep-awake/auto-advance/no-spoilers), 8 (units), 9 (notifications); §7 testing → per-task tests + Task 9 verify.
- Deliberate scope notes: no-spoilers v1 covers the scorecard surfaces (running points, eye toggle, official leaderboard button); the HomeScreen tournament board is reachable only by deliberate navigation and is a follow-up. Units v1 covers scorecard header, shot-detail labels, hole map HUD, and the Driver-distance stat row; remaining stats copy stays metric as a follow-up. Both were accepted as YAGNI cuts.
- Android note: expo-keep-awake and the GPS-toggle permission behavior need the next EAS build to reach devices; web gets everything on deploy.
