'use client';

import { useEffect, useState } from 'react';

/**
 * Autocomplete fires on every keystroke; the API should not. 250ms is the sweet
 * spot — below it you're spamming the server, above it the field feels laggy.
 */
export function useDebounce(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
