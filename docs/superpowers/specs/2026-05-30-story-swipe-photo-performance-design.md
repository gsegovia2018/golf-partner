# Story Swipe and Photo Performance Design

## Goal

Make the shared stories viewer feel natural and responsive in both Feed and Gallery:
swiping right-to-left advances, swiping left-to-right goes back, and adjacent photos
are warmed before the user reaches them.

## Context

`src/components/MemoriesStoriesViewer.js` is the single fullscreen stories
viewer used by `FeedScreen` and `GalleryScreen`. Feed only chooses the story
sequence and start index; Gallery does the same for tournament memories. The
viewer owns tap zones, long-press pause, swipe-down dismiss, horizontal story
swipes, progress, photo rendering, and video rendering.

Current horizontal release handling maps `dx > 0` to `advance()` and `dx < 0`
to `back()`. In React Native gesture coordinates, a right-to-left drag has a
negative `dx`, so the current mapping is reversed from the expected stories
gesture.

Current photo rendering loads only the active full-size photo. The rail and
feed cards use thumbnails, but the fullscreen viewer waits until a photo
becomes active before loading its full URL. Fast swipes can therefore show a
spinner between photos.

## Design

The shared viewer should treat horizontal swipes this way:

- `dx < -STORY_SWIPE_DISTANCE`: advance to the next item.
- `dx > STORY_SWIPE_DISTANCE`: go back to the previous item.
- Downward swipes keep dismissing the viewer.
- Tap zones and long-press pause remain unchanged.

For photo performance, the viewer should:

- Use `expo-image`'s `Image.prefetch` for the active, previous, and next photo
  URLs whenever the visible story index changes.
- Skip videos for this prefetch pass.
- Use each item's `thumbUrl` as the `ExpoImage` placeholder when available.
- Set `cachePolicy="memory-disk"` and `priority="high"` for the active photo.
- Keep video loading and playback unchanged.

## Boundaries

This does not change feed grouping, story ordering, upload compression, storage
paths, video playback, or gallery lightbox behavior. It only updates the shared
stories viewer.

## Testing

Add focused tests around pure helpers exported from `MemoriesStoriesViewer.js`:

- A left swipe returns the next-story action.
- A right swipe returns the previous-story action.
- A short or vertical drag does not return a story navigation action.
- Photo prefetch URLs include active, previous, and next photos, de-duped.
- Video URLs are not included in photo prefetch URLs.

Run the focused story viewer tests, then lint the edited files.
