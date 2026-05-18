import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CONTENT_MAX_WIDTH } from '../theme/responsive';

// Drop-in replacement for `SafeAreaView` in screen roots.
//
// The outer SafeAreaView stays full-bleed so the app background fills the side
// gutters on wide windows. The inner column caps content at CONTENT_MAX_WIDTH
// and centers it. On phones the window is narrower than the cap, so the inner
// column is simply full width -- a visual no-op.
//
// All props except `style`/`children` (e.g. `edges`) are forwarded to the
// SafeAreaView. `style` is applied to the outer SafeAreaView so screen-level
// `flex:1` + `backgroundColor` keep working unchanged.
export default function ScreenContainer({ style, children, ...rest }) {
  return (
    <SafeAreaView style={[styles.fill, style]} {...rest}>
      <View style={styles.column}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
});
