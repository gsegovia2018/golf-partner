import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { GridView } from '../GridView';

// Regression test for a bug where NineBlock never received `round`, so its
// holePoints() call omitted round — for pairsmatchplay (which needs
// round.pairs to compute duel points via pairsMatchDuelPts), every per-hole
// Pts cell rendered '·' even for a fully-scored hole, even though the
// round-total summary (which does receive round) showed correct numbers.
describe('GridView pairsmatchplay per-hole points', () => {
  test('renders duel points (not the placeholder dot) for a fully-scored hole', async () => {
    const pairs = [
      [{ id: 'p1', name: 'Ann Lee', handicap: 0 }, { id: 'p2', name: 'Bob Ray', handicap: 0 }],
      [{ id: 'p3', name: 'Cam Fox', handicap: 0 }, { id: 'p4', name: 'Dan Oak', handicap: 0 }],
    ];
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1 }],
      pairs,
      playerHandicaps: {},
    };
    // p1 birdie (3) beats p3 par (4) -> p1 duel win (1), p3 loses (0);
    // p2 and p4 tie at par (4) -> 0.5 each.
    const scores = { p1: { 1: 3 }, p3: { 1: 4 }, p2: { 1: 4 }, p4: { 1: 4 } };

    const { findAllByText, queryAllByText } = render(
      <ThemeProvider>
        <GridView
          round={round}
          roundIndex={0}
          players={pairs.flat()}
          scores={scores}
          isBestBall={false}
          bbResult={null}
          settings={{ scoringMode: 'pairsmatchplay' }}
          onSetScore={() => {}}
          editable={() => false}
          refreshing={false}
          onRefresh={() => {}}
          meId="p1"
        />
      </ThemeProvider>
    );

    // The per-hole Pts row should show the duel points computed from
    // round.pairs, not the unscored placeholder.
    expect((await findAllByText('1')).length).toBeGreaterThan(0);
    expect((await findAllByText('0')).length).toBeGreaterThan(0);
    expect((await findAllByText('0.5')).length).toBeGreaterThan(0);

    // Sanity: this reproduces the bug precisely — before the fix every Pts
    // cell fell back to '·' despite the hole being fully scored.
    expect(queryAllByText('·').length).toBe(0);
  });
});
