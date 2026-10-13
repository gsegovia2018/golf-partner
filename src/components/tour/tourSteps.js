// Tour copy — spec: docs/superpowers/specs/2026-07-22-onboarding-design.md.
// `title` and `body` are catalogue keys (tour.*), translated by CoachMarks at
// render. Target `key`s resolve against the tour target registry; a key nothing
// registered for is skipped at runtime.

export const HOME_TOUR_STEPS = [
  { key: 'tab-play', title: 'tour.play.title', body: 'tour.play.body' },
  { key: 'tab-stats', title: 'tour.stats.title', body: 'tour.stats.body' },
  { key: 'tab-feed', title: 'tour.feed.title', body: 'tour.feed.body' },
  { key: 'tab-profile', title: 'tour.profile.title', body: 'tour.profile.body' },
];

export const SCORECARD_TOUR_STEPS = [
  { key: 'score-entry', title: 'tour.score.title', body: 'tour.score.body' },
  { key: 'hole-distances', title: 'tour.distances.title', body: 'tour.distances.body' },
  { key: 'hole-nav', title: 'tour.nav.title', body: 'tour.nav.body' },
];
