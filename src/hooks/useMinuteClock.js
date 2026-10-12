import { useEffect, useState } from 'react';

// The current time, re-read every minute. One interval per mounted caller,
// cleared on unmount. For countdowns that only show minutes.
export function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  return now;
}
