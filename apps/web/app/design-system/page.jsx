'use client';

import { useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { Card, RouteBadge } from '../../components/ui/Card.jsx';
import { Select } from '../../components/ui/Select.jsx';
import {
  ListSkeleton,
  Empty,
  ErrorState,
  StaleBanner,
  LiveBadge,
} from '../../components/ui/states.jsx';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary.jsx';

/**
 * A living style guide. Every component ships with its four states visible side by
 * side, so "we forgot the empty state" is caught here rather than in production by
 * someone standing in the rain at a bus stop.
 */
export default function DesignSystemPage() {
  const [loading, setLoading] = useState(false);

  return (
    <main id="main" className="mx-auto flex max-w-2xl flex-col gap-10 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-display font-semibold">Design system</h1>
        <p className="text-muted">
          Tokens in <code className="font-mono text-small">tailwind.config.js</code>, values in{' '}
          <code className="font-mono text-small">globals.css</code>. Components may not invent
          colours or spacing.
        </p>
      </header>

      <Section title="Buttons" note="Min 44px touch target. Press feedback under 100ms.">
        <div className="flex flex-wrap gap-3">
          <Button>Find my bus</Button>
          <Button variant="secondary">Change region</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="danger">Clear</Button>
          <Button disabled>Disabled</Button>
          <Button
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1200);
            }}
          >
            {loading ? 'Searching' : 'Click to load'}
          </Button>
        </div>
      </Section>

      <Section title="Route cards" note="Operator colour when the feed provides one.">
        <div className="flex flex-col gap-3">
          <Card interactive as="button" className="flex items-center gap-4">
            <RouteBadge shortName="764" color="E11E5A" />
            <div className="flex flex-1 flex-col items-start">
              <p className="font-medium">Nehru Place → Anand Vihar ISBT</p>
              <p className="text-small text-muted">Next: 06:00, 06:20 · 12 stops</p>
            </div>
            <LiveBadge count={3} />
          </Card>
          <Card interactive as="button" className="flex items-center gap-4">
            <RouteBadge shortName="500" />
            <div className="flex flex-1 flex-col items-start">
              <p className="font-medium">Anand Vihar ISBT → Nehru Place</p>
              {/* The "last bus has gone" state — route exists, nothing left today. */}
              <p className="text-small text-muted">No more buses today</p>
            </div>
          </Card>
        </div>
      </Section>

      <Section
        title="Region picker"
        note="Native select: keyboard, type-ahead and mobile for free."
      >
        <Select label="Region" name="region" hint="More cities after Delhi ships.">
          <option value="delhi">Delhi — New Delhi</option>
        </Select>
      </Section>

      <Section
        title="The four states"
        note="Every data-dependent screen renders exactly one of these. Never a blank div."
      >
        <div className="flex flex-col gap-6">
          <Labelled label="1 · Loading">
            <ListSkeleton rows={2} />
          </Labelled>

          <Labelled label="2 · Empty">
            <Empty
              title="No direct buses"
              message="No single bus runs between these stops. Try a nearby stop instead."
              action={
                <Button variant="secondary" size="sm">
                  Pick another stop
                </Button>
              }
            />
          </Labelled>

          <Labelled label="3 · Error">
            <ErrorState
              message="We couldn't load nearby stops. Check your connection."
              onRetry={() => {}}
            />
          </Labelled>

          <Labelled label="4 · Stale — the one people forget">
            <StaleBanner />
          </Labelled>
        </div>
      </Section>

      <Section
        title="The fifth state: a render that threw"
        note="The four states above assume the code ran. This is what a crash looks like — scoped to the thing that broke, so the rest of the page survives."
      >
        <div className="flex flex-col gap-6">
          <Labelled label="Boundary — click to throw for real">
            {/* Deliberately a LIVE boundary, not a screenshot of one: a mocked-up
                fallback would keep looking fine long after the real one had rotted. */}
            <ErrorBoundary name="design-system-demo">
              <Exploder />
            </ErrorBoundary>
          </Labelled>
        </div>
      </Section>
    </main>
  );
}

/** Throws during render — the only honest way to demo a boundary. */
function Exploder() {
  const [boom, setBoom] = useState(false);
  if (boom) throw new Error('Demo: a component threw during render.');

  return (
    <Card className="flex items-center justify-between gap-4">
      <p className="text-small text-muted">A perfectly healthy component.</p>
      <Button variant="danger" size="sm" onClick={() => setBoom(true)}>
        Break it
      </Button>
    </Card>
  );
}

function Section({ title, note, children }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-title font-semibold">{title}</h2>
        {note && <p className="text-small text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Labelled({ label, children }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption font-medium uppercase tracking-wide text-subtle">{label}</p>
      {children}
    </div>
  );
}
