'use client';

import { useEffect } from 'react';
import './globals.css';
import { captureException } from '../lib/monitoring.js';

/**
 * The last line of defence: this fires only when the ROOT LAYOUT itself throws, which
 * `app/error.jsx` cannot catch because it renders *inside* that layout.
 *
 * Next replaces the entire document here, so this file must ship its own <html> and
 * <body> — and it must import globals.css itself, because the layout that normally
 * pulls the stylesheet in is precisely the thing that just died.
 *
 * Deliberately plain: the fewer tokens, providers and components this path touches,
 * the smaller the chance that the error screen is broken by the same bug it's
 * reporting. It cannot assume the design system loaded.
 */
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    captureException(error, { digest: error?.digest, boundary: 'global' });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-6 text-center">
          <span aria-hidden="true" className="text-display">
            🚌
          </span>
          <h1 className="text-title font-semibold text-ink">BusNavigator is having a moment</h1>
          <p className="max-w-sm text-body text-muted">
            The app failed to start. This is a bug on our end — please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-2 inline-flex h-11 items-center justify-center rounded-md bg-brand px-5 text-body font-medium text-inverse hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Try again
          </button>
          {error?.digest && (
            <p className="pt-2 font-mono text-caption text-subtle">Reference: {error.digest}</p>
          )}
        </main>
      </body>
    </html>
  );
}
