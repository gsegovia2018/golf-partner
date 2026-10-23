import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { duration } from '../../theme/motion';

// One whole number with optional text around it: "34", "+3", "34 pts".
const INT = /^(\D*?)([+-]?)(\d+)(\D*)$/;

// Text that counts to a new whole number instead of jumping ("31" → "34",
// "31 pts" → "34 pts"). Anything else ("10 h 59 m", "4.5", "—", a unit that
// changed) shows as is, and so does the first value: only a change counts.
// `scope` names what the number measures (a metric, a round): when it changes
// the new value simply shows, because counting from Gross to Net is meaningless.
export default function CountUpText({ children, scope, ms = duration.moment, ...rest }) {
  const reduced = useReducedMotion();
  const text = children == null ? children : String(children);
  const [shown, setShown] = useState(text);
  const last = useRef(text);
  const lastScope = useRef(scope);

  useEffect(() => {
    const from = INT.exec(last.current ?? '');
    const to = INT.exec(text ?? '');
    last.current = text;
    const sameScope = lastScope.current === scope;
    lastScope.current = scope;
    if (reduced || !sameScope || !from || !to || from[1] !== to[1] || from[4] !== to[4]) {
      setShown(text);
      return undefined;
    }
    const a = Number(from[2] + from[3]);
    const b = Number(to[2] + to[3]);
    if (a === b) { setShown(text); return undefined; }
    const [, pre, signed, , post] = to;
    const t0 = Date.now();
    let raf;
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      const v = Math.round(a + (b - a) * (1 - (1 - k) ** 3));
      setShown(k < 1 ? `${pre}${signed === '+' && v > 0 ? '+' : ''}${v}${post}` : text);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, scope, ms, reduced]);

  return <Text {...rest}>{shown}</Text>;
}
