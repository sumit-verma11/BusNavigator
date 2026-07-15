'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function Providers({ children }) {
  // Created in state, not at module scope: a module-level client would be shared
  // across requests on the server and leak one user's data into another's render.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Exponential backoff — a struggling API must not be hammered by every
            // client at once when a Delhi commute peaks.
            retry: (failureCount, error) =>
              error?.status >= 400 && error?.status < 500 ? false : failureCount < 2,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
            refetchOnWindowFocus: true, // pulling the phone out of a pocket = refresh
            staleTime: 30_000,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
