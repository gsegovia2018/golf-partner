import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, ScrollView, RefreshControl, View, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

const PULL_THRESHOLD = 70;
const MAX_PULL = 120;

// Cross-platform pull-to-refresh ScrollView.
// Native: standard RefreshControl.
// Web: custom touch-driven pull on the underlying DOM node, with a spinner that
// pushes content down — matches the typical mobile-app pull-to-refresh feel.
export default function PullToRefresh({
  refreshing,
  onRefresh,
  style,
  contentContainerStyle,
  children,
  ...rest
}) {
  const { theme } = useTheme();
  const scrollRef = useRef(null);
  const startY = useRef(null);
  const pulling = useRef(false);
  const currentDistance = useRef(0);
  const pullAnim = useRef(new Animated.Value(0)).current;
  const [armed, setArmed] = useState(false);
  const refreshingRef = useRef(refreshing);

  useEffect(() => { refreshingRef.current = refreshing; }, [refreshing]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (refreshing) {
      Animated.timing(pullAnim, { toValue: PULL_THRESHOLD, duration: 150, useNativeDriver: false }).start();
    } else {
      Animated.timing(pullAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start(() => {
        setArmed(false);
        currentDistance.current = 0;
      });
    }
  }, [refreshing, pullAnim]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = scrollRef.current?.getScrollableNode?.();
    if (!node) return;

    const onTouchStart = (e) => {
      if (refreshingRef.current) return;
      if (node.scrollTop <= 0 && e.touches.length === 1) {
        startY.current = e.touches[0].clientY;
        pulling.current = true;
      }
    };

    const onTouchMove = (e) => {
      if (!pulling.current || startY.current === null || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || node.scrollTop > 0) {
        if (currentDistance.current > 0) {
          currentDistance.current = 0;
          pullAnim.setValue(0);
          setArmed(false);
        }
        return;
      }
      const damped = Math.min(dy * 0.5, MAX_PULL);
      currentDistance.current = damped;
      pullAnim.setValue(damped);
      setArmed(damped >= PULL_THRESHOLD);
      if (e.cancelable) e.preventDefault();
    };

    const finishGesture = async () => {
      if (!pulling.current) return;
      pulling.current = false;
      startY.current = null;
      const finalDistance = currentDistance.current;
      if (finalDistance >= PULL_THRESHOLD && onRefresh && !refreshingRef.current) {
        Animated.timing(pullAnim, { toValue: PULL_THRESHOLD, duration: 120, useNativeDriver: false }).start();
        try { await onRefresh(); } catch { /* ignore */ }
        if (!refreshingRef.current) {
          Animated.timing(pullAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start(() => {
            setArmed(false);
            currentDistance.current = 0;
          });
        }
      } else {
        Animated.timing(pullAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start(() => {
          setArmed(false);
          currentDistance.current = 0;
        });
      }
    };

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', finishGesture);
    node.addEventListener('touchcancel', finishGesture);
    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', finishGesture);
      node.removeEventListener('touchcancel', finishGesture);
    };
  }, [onRefresh, pullAnim]);

  const webOverscrollStyle = Platform.OS === 'web' ? { overscrollBehaviorY: 'contain' } : null;

  return (
    <ScrollView
      ref={scrollRef}
      style={[style, webOverscrollStyle]}
      contentContainerStyle={contentContainerStyle}
      refreshControl={
        Platform.OS !== 'web'
          ? <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.accent.primary}
              colors={[theme.accent.primary]}
            />
          : undefined
      }
      {...rest}
    >
      {Platform.OS === 'web' && (
        <Animated.View
          pointerEvents="none"
          style={{
            height: pullAnim,
            alignItems: 'center',
            justifyContent: 'flex-end',
            overflow: 'hidden',
          }}
        >
          <View style={{ height: PULL_THRESHOLD, alignItems: 'center', justifyContent: 'center' }}>
            {refreshing ? (
              <ActivityIndicator color={theme.accent.primary} />
            ) : (
              <Animated.View
                style={{
                  opacity: pullAnim.interpolate({
                    inputRange: [0, PULL_THRESHOLD],
                    outputRange: [0, 1],
                    extrapolate: 'clamp',
                  }),
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  borderWidth: 2,
                  borderColor: theme.accent.primary,
                  borderTopColor: 'transparent',
                }}
              />
            )}
          </View>
        </Animated.View>
      )}
      {children}
    </ScrollView>
  );
}
