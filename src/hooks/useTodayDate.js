import { useEffect, useRef, useState } from 'react';
import { getLocalDateString } from '@/lib/helpers';

/**
 * Today's local date (YYYY-MM-DD), auto-advancing at local midnight without
 * needing a page reload — so anything keyed off "is it a holiday today"
 * (the Home dashboard's holiday banner, the post-login celebration) rolls
 * over to the next day on its own for a tab left open overnight, instead of
 * staying pinned to whatever day the component happened to mount on.
 */
export function useTodayDate() {
  const [today, setToday] = useState(() => getLocalDateString());
  const timeoutRef = useRef(null);

  useEffect(() => {
    const scheduleNext = () => {
      const now = new Date();
      // A few seconds past midnight, not exactly on it, so we're never racing the clock tick.
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      const ms = nextMidnight.getTime() - now.getTime();
      timeoutRef.current = setTimeout(() => {
        setToday(getLocalDateString());
        scheduleNext();
      }, ms);
    };
    scheduleNext();
    return () => clearTimeout(timeoutRef.current);
  }, []);

  return today;
}
