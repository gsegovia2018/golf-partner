import { useEffect, useState } from 'react';
import { loadFocus } from '../store/coachFocus';
import { focusTarget } from '../store/focusTarget';

// The committed coach focus as the round asks about it (round focus loop plan
// §5.2): a FocusTarget or null. Loaded once per user. `setState` never runs
// for a null result on a null state, so a golfer with no focus costs no extra
// render.
export function useFocusTarget(userId) {
  const [target, setTarget] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.resolve(loadFocus(userId))
      .then((focus) => {
        if (!live) return;
        const next = focusTarget(focus);
        setTarget((prev) => (prev === null && next === null ? prev : next));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [userId]);
  return target;
}
