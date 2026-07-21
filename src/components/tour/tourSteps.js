// Fixed tour copy — spec: docs/superpowers/specs/2026-07-22-onboarding-design.md.
// Keys resolve against the tour target registry; a key nothing registered
// for is skipped at runtime.

export const HOME_TOUR_STEPS = [
  { key: 'tab-play', title: 'Everything starts here', body: 'Tap the flag to start a round or a weekend tournament — pairs and scoring are set up for you.' },
  { key: 'tab-stats', title: 'Your game, measured', body: 'Handicap evolution, strokes gained and a coach that tells you what to fix first.' },
  { key: 'tab-feed', title: "The group's memories", body: 'Photos and moments from every round land here.' },
  { key: 'tab-profile', title: 'Your player card', body: 'Avatar, handicap, friends — and Settings, where you can tune the defaults.' },
];

export const SCORECARD_TOUR_STEPS = [
  { key: 'score-entry', title: 'Score the hole', body: 'Tap your strokes — points are worked out for you, extra handicap shots included.' },
  { key: 'hole-distances', title: 'Distances & the map', body: 'Live GPS distances to front, middle and back — tap them any time to fly over the hole.' },
  { key: 'hole-nav', title: 'Move through the round', body: 'This button carries you to the next hole; the running points keep the match in view.' },
];
