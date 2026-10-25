import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { afterTabSettles } from './tabSettle';

// useFocusEffect, run after the tab bar's slide (see tabSettle). `effect` is
// memoised by the caller (useCallback), as useFocusEffect expects; its
// cleanup still runs on blur.
export function useSettledFocusEffect(effect) {
  useFocusEffect(useCallback(() => {
    let cleanup;
    let blurred = false;
    const cancel = afterTabSettles(() => { if (!blurred) cleanup = effect(); });
    return () => {
      blurred = true;
      cancel();
      if (typeof cleanup === 'function') cleanup();
    };
  }, [effect]));
}
