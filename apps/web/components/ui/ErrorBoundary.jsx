'use client';

import { Component } from 'react';
import { ErrorState } from './states.jsx';
import { captureException } from '../../lib/monitoring.js';

/**
 * THE FIFTH STATE — the one the other four can't cover.
 *
 * `ErrorState` handles a *failed request*: the code worked, the answer was bad. This
 * handles a *failed render*: the code itself threw, and React has torn the subtree
 * down. Without a boundary, React 19 unmounts the ENTIRE app on any such throw — one
 * bad shape geometry or a phone without WebGL would leave a blank white screen where
 * the timetable used to be.
 *
 * This is a class because it has to be: `getDerivedStateFromError` has no hook
 * equivalent, and still doesn't in React 19. It's the one sanctioned class in the app.
 *
 * Scope boundaries TIGHTLY around the thing that can break (see MapContainer). A
 * boundary around the whole page turns a broken map into a broken app, which is
 * precisely the outcome it exists to prevent.
 */
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // A render that threw is never expected — this is exactly what the tracker is for.
    captureException(error, {
      componentStack: info?.componentStack,
      boundary: this.props.name ?? 'unnamed',
    });
  }

  componentDidUpdate(prevProps) {
    // Without this, a boundary that has caught once stays broken forever: the user
    // picks a different route, the map could render perfectly well now, and they'd
    // still be staring at the fallback. Re-arm whenever the inputs change.
    const { resetKeys } = this.props;
    if (!this.state.error || !resetKeys) return;

    const prev = prevProps.resetKeys ?? [];
    if (resetKeys.length !== prev.length || resetKeys.some((k, i) => !Object.is(k, prev[i]))) {
      this.reset();
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // A render function, so each caller decides what "degraded" looks like in its
    // own slot — a dead map is a placeholder in a box, not a full-page error page.
    const { fallback } = this.props;
    if (typeof fallback === 'function') return fallback({ error, reset: this.reset });
    if (fallback) return fallback;

    return (
      <ErrorState
        title="Something broke on this screen"
        message="This part of the page failed to load. The rest of the app still works."
        onRetry={this.reset}
      />
    );
  }
}
