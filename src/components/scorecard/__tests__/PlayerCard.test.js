import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { PlayerCard } from '../PlayerCard';

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => {
    const { light, semantic, typography, fonts, spacing, radius } = jest.requireActual('../../../theme/tokens');
    return {
      theme: {
        ...light,
        semantic,
        masters: semantic.masters,
        destructive: semantic.destructive.light,
        pairA: semantic.pair.a.light,
        pairB: semantic.pair.b.light,
        scoreColor: (level) => semantic.score[level].light,
        typography,
        fonts,
        spacing,
        radius,
        mode: 'light',
        isDark: false,
      },
    };
  },
}));

function renderPlayerCard(overrides = {}) {
  const props = {
    player: { id: 'p1', name: 'Marco' },
    hole: { number: 1, par: 4, strokeIndex: 8 },
    strokes: 5,
    points: 2,
    handicap: 12,
    extraShots: 1,
    pickup: 8,
    isPickup: false,
    team: null,
    isMe: false,
    canEdit: false,
    showRunning: false,
    totals: { pts: 2, str: 5, parPlayed: 4 },
    getScoreAnim: () => new Animated.Value(1),
    onStep: () => {},
    onSetScore: () => {},
    onSetShot: () => {},
    ...overrides,
  };

  return render(<PlayerCard {...props} />);
}

function findStyledAncestor(node, predicate) {
  let current = node.parent;
  while (current) {
    const style = StyleSheet.flatten(current.props.style);
    if (style && predicate(style)) return style;
    current = current.parent;
  }
  return null;
}

describe('PlayerCard layout', () => {
  test('centers the read-only stroke display over the points badge', () => {
    const { getByLabelText } = renderPlayerCard();

    const scorePressable = getByLabelText('Strokes on hole 1');
    const scoreRowStyle = findStyledAncestor(
      scorePressable,
      (style) => style.flexDirection === 'row' && style.gap === 16
    );

    expect(scoreRowStyle.justifyContent).toBe('center');
  });
});

describe('PlayerCard pickup toggle', () => {
  test('toggling pickup off clears the hole instead of recording a par', () => {
    const onSetScore = jest.fn();
    const { getByLabelText } = renderPlayerCard({
      canEdit: true,
      isPickup: true,
      pickup: 8,
      strokes: 8,
      hole: { number: 1, par: 4, strokeIndex: 8 },
      onSetScore,
    });

    fireEvent.press(getByLabelText('Picked up at 8 strokes — tap to clear'));

    expect(onSetScore).toHaveBeenCalledWith('p1', 1, null);
  });
});
