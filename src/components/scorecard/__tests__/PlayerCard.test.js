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
      (style) => style.flexDirection === 'row' && style.gap === 12
    );

    expect(scoreRowStyle.justifyContent).toBe('center');
  });
});

describe('PlayerCard ghost preview', () => {
  test('peer-entered value with no own entry renders as a ghost with attribution', () => {
    const { getByText, getByLabelText, queryByText } = renderPlayerCard({
      strokes: null,
      points: null,
      canEdit: true,
      ghost: { value: 4, authorName: 'Alice' },
    });

    expect(getByText('4')).toBeTruthy();
    expect(getByText('by Alice')).toBeTruthy();
    expect(getByLabelText(
      'Hole 1, Marco: 4 entered by Alice, not verified by you — tap to accept',
    )).toBeTruthy();
    // No points badge for a ghost — it isn't this scorer's verified entry.
    expect(queryByText(/point/)).toBeNull();
  });

  test('tapping an editable ghost accepts the peer value as this scorer\'s entry', () => {
    const onSetScore = jest.fn();
    const { getByText, getByLabelText } = renderPlayerCard({
      strokes: null,
      points: null,
      canEdit: true,
      ghost: { value: 4, authorName: 'Alice' },
      onSetScore,
    });

    expect(getByText('TAP TO ACCEPT')).toBeTruthy();
    fireEvent.press(getByLabelText(
      'Hole 1, Marco: 4 entered by Alice, not verified by you — tap to accept',
    ));

    // Same write path as typing the number in, so autoSave stamps it under
    // this author and the two cards record that they agree.
    expect(onSetScore).toHaveBeenCalledWith('p1', 1, '4');
  });

  test('a read-only ghost stays a preview — no tap-to-accept', () => {
    const onSetScore = jest.fn();
    const { getByText, getByLabelText } = renderPlayerCard({
      strokes: null,
      points: null,
      canEdit: false,
      ghost: { value: 4, authorName: 'Alice' },
      onSetScore,
    });

    expect(getByText('NOT VERIFIED')).toBeTruthy();
    fireEvent.press(getByLabelText('Hole 1, Marco: 4 entered by Alice, not verified by you'));
    expect(onSetScore).not.toHaveBeenCalled();
  });

  test('own entry present → normal rendering, no ghost even if a ghost value is passed', () => {
    const { getByText, queryByText, getByLabelText } = renderPlayerCard({
      strokes: 5,
      points: 2,
      canEdit: true,
      ghost: { value: 4, authorName: 'Alice' },
    });

    expect(getByText('5')).toBeTruthy();
    expect(queryByText('by Alice')).toBeNull();
    expect(queryByText('4')).toBeNull();
    expect(getByLabelText('Strokes on hole 1 — long-press to clear')).toBeTruthy();
  });

  test('no data at all → empty state unchanged', () => {
    const { getByText, queryByText, getByLabelText } = renderPlayerCard({
      strokes: null,
      points: null,
      canEdit: true,
      ghost: null,
    });

    expect(getByText('—')).toBeTruthy();
    expect(getByText('STROKES')).toBeTruthy();
    expect(queryByText(/^by /)).toBeNull();
    expect(getByLabelText('Strokes on hole 1')).toBeTruthy();
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
