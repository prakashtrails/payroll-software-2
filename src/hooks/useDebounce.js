import { useState, useEffect } from 'react';

/**
 * Delays updating the returned value until `delay` ms have passed
 * since the last change to `value`.  Use this on search inputs to
 * avoid firing a DB query on every keystroke.
 *
 * @param {*}      value - The value to debounce (e.g. a search string)
 * @param {number} delay - Debounce window in ms (default 350)
 */
export function useDebounce(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
