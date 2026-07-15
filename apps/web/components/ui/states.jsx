import clsx from 'clsx';
import { Button } from './Button.jsx';

/**
 * THE FOUR STATES.
 *
 * Every data-dependent surface in this app renders exactly one of these, never a
 * blank div and never a spinner-forever. They live together in one file on purpose:
 * if you're building a screen and you can only name three of them, you've forgotten
 * one — and the one people forget is `Stale`.
 *
 *   <Skeleton/>   loading   — the shape of what's coming, not a spinner
 *   <Empty/>      success, no results — says what to do next
 *   <ErrorState/> failed    — always offers a retry
 *   <StaleBanner/> degraded — data is real but old; SAY SO rather than lying
 */

export function Skeleton({ className }) {
  return (
    <div
      className={clsx('animate-pulse rounded-md bg-border', className)}
      aria-hidden="true" // screen readers get aria-busy on the container instead
    />
  );
}

/** Skeleton shaped like the stop/route rows it stands in for — not a generic grey box. */
export function ListSkeleton({ rows = 4 }) {
  return (
    <ul className="flex flex-col gap-3" aria-busy="true" aria-live="polite" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <li
          key={i}
          className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4"
        >
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Empty({ title, message, action, icon = '🚏' }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-surface/50 p-8 text-center">
      <span aria-hidden="true" className="text-2xl opacity-70">
        {icon}
      </span>
      <p className="text-lead font-medium text-ink">{title}</p>
      {message && <p className="max-w-sm text-small text-muted">{message}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-danger/30 bg-danger-subtle p-8 text-center"
    >
      <p className="text-lead font-medium text-danger">{title}</p>
      {message && <p className="max-w-sm text-small text-muted">{message}</p>}
      {/* An error state without a way out is a dead end. */}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * The honest state. The realtime feed is down, so we're showing the timetable —
 * the user gets useful data AND the truth about how fresh it is. Silently drawing
 * stale buses on a map is the single worst thing this app could do.
 */
export function StaleBanner({ message = 'Live tracking is unavailable — showing the timetable.' }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md border border-stale bg-stale-subtle px-4 py-3"
    >
      <span aria-hidden="true" className="mt-1 h-2 w-2 shrink-0 rounded-full bg-stale" />
      <p className="text-small text-ink">{message}</p>
    </div>
  );
}

/** The inverse: positions are live. A quiet, non-shouty confirmation. */
export function LiveBadge({ count }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-live-subtle px-3 py-1 text-caption font-medium text-live">
      <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-live" />
      {count == null ? 'Live' : `${count} live`}
    </span>
  );
}
