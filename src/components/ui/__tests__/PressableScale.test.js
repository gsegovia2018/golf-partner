import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import PressableScale from '../PressableScale';

describe('PressableScale', () => {
  it('renders children and fires onPress', () => {
    const onPress = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <PressableScale onPress={onPress} accessibilityLabel="tap me">
          <Text>Tap</Text>
        </PressableScale>
      );
    });
    const pressable = tree.root.findByProps({ accessibilityLabel: 'tap me' });
    act(() => { pressable.props.onPress?.(); });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
