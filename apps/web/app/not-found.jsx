import Link from 'next/link';

/**
 * A 404 is not an error — nothing failed, the address just doesn't exist. So it gets
 * a way onward (back to the planner), not a "try again" that would only 404 twice.
 *
 * Stays a server component: there is nothing interactive here, and shipping JS to
 * render a dead end is JS the user paid for and got nothing from.
 */
export const metadata = { title: 'Page not found — BusNavigator' };

export default function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <span aria-hidden="true" className="text-display">
        🗺️
      </span>
      <h1 className="text-title font-semibold text-ink">No such stop</h1>
      <p className="max-w-sm text-body text-muted">
        That page doesn&apos;t exist. Let&apos;s get you back to finding a bus.
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex h-11 items-center justify-center rounded-md bg-brand px-5 text-body font-medium text-inverse hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        Plan a journey
      </Link>
    </main>
  );
}
