import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import IconButton from '../IconButton';

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

describe('IconButton', () => {
  it('fires onPress via accessibility role/label', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <IconButton icon="menu" onPress={onPress} accessibilityLabel="Open menu" />
    );
    fireEvent.press(getByLabelText('Open menu'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('defaults accessibilityRole to button', () => {
    const { getByLabelText } = render(
      <IconButton icon="menu" onPress={() => {}} accessibilityLabel="Open menu" />
    );
    expect(getByLabelText('Open menu').props.accessibilityRole).toBe('button');
  });

  it('renders the Feather glyph with the given icon name by default', () => {
    const { UNSAFE_getByProps } = render(<IconButton icon="bell" onPress={() => {}} />);
    expect(UNSAFE_getByProps({ name: 'bell' })).toBeTruthy();
  });

  it('renders a notification dot when dot is true', () => {
    const { getByTestId } = render(
      <IconButton icon="bell" onPress={() => {}} dot dotColor="#ff0000" />
    );
    expect(getByTestId('icon-button-dot')).toBeTruthy();
  });

  it('does not render a dot when dot is false/omitted', () => {
    const { queryByTestId } = render(
      <IconButton icon="bell" onPress={() => {}} />
    );
    expect(queryByTestId('icon-button-dot')).toBeNull();
  });

  it('renders children instead of the Feather glyph when children is provided', () => {
    const { getByTestId, UNSAFE_queryByProps } = render(
      <IconButton onPress={() => {}} accessibilityLabel="Sync status">
        <Text testID="custom-child">custom</Text>
      </IconButton>
    );
    expect(getByTestId('custom-child')).toBeTruthy();
    expect(UNSAFE_queryByProps({ name: 'bell' })).toBeNull();
  });

  it('does not fire onPress when disabled', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <IconButton icon="menu" onPress={onPress} disabled accessibilityLabel="Open menu" />
    );
    fireEvent.press(getByLabelText('Open menu'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
