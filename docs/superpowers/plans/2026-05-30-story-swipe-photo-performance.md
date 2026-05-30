# Story Swipe and Photo Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix shared stories navigation so right-to-left advances, and reduce photo lag by prefetching adjacent photos.

**Architecture:** Keep behavior in `MemoriesStoriesViewer.js`, but expose small pure helpers for deterministic tests. Use `expo-image`'s existing cache and prefetch APIs rather than introducing new image infrastructure.

**Tech Stack:** Expo SDK 54, React Native 0.81, React 19, `expo-image`, Jest with `jest-expo`.

---

## File Structure

- Modify `src/components/MemoriesStoriesViewer.js`: gesture helper, prefetch helper, shared viewer wiring.
- Create `src/components/__tests__/MemoriesStoriesViewer.test.js`: focused tests for swipe semantics and photo prefetch URL selection.

## Task 1: Shared Viewer Helpers

**Files:**
- Create: `src/components/__tests__/MemoriesStoriesViewer.test.js`
- Modify: `src/components/MemoriesStoriesViewer.js`

- [ ] **Step 1: Write failing tests**

Create tests that import `storySwipeAction` and `photoPrefetchUrls`.

Expected assertions:

```js
expect(storySwipeAction({ dx: -80, dy: 0 })).toBe('next');
expect(storySwipeAction({ dx: 80, dy: 0 })).toBe('previous');
expect(storySwipeAction({ dx: -20, dy: 0 })).toBeNull();
expect(storySwipeAction({ dx: -80, dy: 90 })).toBeNull();
expect(photoPrefetchUrls(items, 1)).toEqual([
  'https://example.com/1.jpg',
  'https://example.com/2.jpg',
  'https://example.com/3.jpg',
]);
```

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
npx jest src/components/__tests__/MemoriesStoriesViewer.test.js --runInBand
```

Expected: FAIL because the helpers are not exported yet.

- [ ] **Step 3: Add the pure helpers**

Export `storySwipeAction(gesture)` from `MemoriesStoriesViewer.js`. It should return `'next'`, `'previous'`, or `null`.

Export `photoPrefetchUrls(items, index)` from `MemoriesStoriesViewer.js`. It should inspect `index - 1`, `index`, and `index + 1`, include only `kind === 'photo'` entries, prefer `url`, and de-dupe URLs.

- [ ] **Step 4: Verify helper tests pass**

Run:

```bash
npx jest src/components/__tests__/MemoriesStoriesViewer.test.js --runInBand
```

Expected: PASS.

## Task 2: Wire Helpers Into the Viewer

**Files:**
- Modify: `src/components/MemoriesStoriesViewer.js`
- Modify: `src/components/__tests__/MemoriesStoriesViewer.test.js`

- [ ] **Step 1: Use `storySwipeAction` in pan release**

Replace the inline horizontal direction branch with the helper. `'next'` calls
`advance()`, `'previous'` calls `back()`, and `null` springs the view back.

- [ ] **Step 2: Add adjacent photo prefetching**

Import `Image` from `expo-image` as `ExpoImage`. In a `useEffect`, call
`ExpoImage.prefetch(photoPrefetchUrls(items, index), { cachePolicy: 'memory-disk' })`
when the viewer is visible and the URL list is non-empty. Ignore prefetch errors.

- [ ] **Step 3: Improve active photo rendering**

For active photo items, pass `placeholder={current.thumbUrl ? { uri: current.thumbUrl } : undefined}`,
`placeholderContentFit="contain"`, `cachePolicy="memory-disk"`, `priority="high"`,
and `recyclingKey={current.id || current.url}` to the existing `ExpoImage`.

- [ ] **Step 4: Verify focused tests and lint**

Run:

```bash
npx jest src/components/__tests__/MemoriesStoriesViewer.test.js --runInBand
npm run lint -- src/components/MemoriesStoriesViewer.js src/components/__tests__/MemoriesStoriesViewer.test.js
```

Expected: both commands exit 0.

## Self-Review

- The plan covers every design requirement: swipe direction, preserving vertical dismiss, prefetching adjacent photos, thumbnail placeholders, and unchanged video behavior.
- No placeholder task text remains.
- Helper names and expected return values are consistent across both tasks.
