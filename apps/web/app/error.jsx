'use client';

import { useEffect } from 'react';
import { Button } from '../components/ui/Button.jsx';
import { captureException } from '../lib/monitoring.js';

/**
 * The route-level boundary. Next calls this when anything in the page subtree throws
 * and no tighter boundary (e.g. the map's) caught it first.
 *
 * `reset()` re-renders the segment rather than reloading the document, so a transient
 * failure — one bad API response, a race on a stale query — costs a tap, not a cold
 * start on 4G. Reload is offered as the second, heavier option.
 */
export default function Error({ error, reset }) {
  useEffect(() => {
    // `error.digest` is the server-side correlation id: in production Next strips the
    // message from the client bundle, so the digest is the ONLY way to tie what the
    // user saw to what the server logged.
    captureException(error, { digest: error?.digest, boundary: 'route' });
  }, [error]);

  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <span aria-hidden="true" className="text-display">
        🚏
      </span>
      <h1 className="text-title font-semibold text-ink">This screen didn&apos;t load</h1>
      <p className="max-w-sm text-body text-muted">
        Something went wrong on our side, not yours. Trying again usually fixes it.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      </div>

      {error?.digest && (
        // Not decoration: this is what someone quotes in a bug report, and what we
        // grep the logs for. Monospace because it will be read aloud or retyped.
        <p className="pt-2 font-mono text-caption text-subtle">Reference: {error.digest}</p>
      )}
    </main>
  );
}
