/**
 * The design system lives here, once. No component may invent a colour, a spacing
 * value, or a font size — if it isn't a token, it doesn't ship. That rule is what
 * keeps a solo-built app from drifting into forty shades of grey.
 */
export default {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    // Deliberately REPLACING Tailwind's palette, not extending it: leaving the
    // default colours in place is an open invitation to `bg-blue-400` one-offs.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#ffffff',

      // Surfaces
      canvas: 'var(--color-canvas)',
      surface: 'var(--color-surface)',
      raised: 'var(--color-raised)',
      border: 'var(--color-border)',

      // Text
      ink: 'var(--color-ink)',
      muted: 'var(--color-muted)',
      subtle: 'var(--color-subtle)',
      inverse: 'var(--color-inverse)',

      // Brand
      brand: {
        DEFAULT: 'var(--color-brand)',
        hover: 'var(--color-brand-hover)',
        subtle: 'var(--color-brand-subtle)',
      },

      // Semantic — the states this app actually has. `stale` is a first-class
      // colour because "realtime feed is down, showing timetable" is a real,
      // frequent state, not an edge case.
      success: { DEFAULT: 'var(--color-success)', subtle: 'var(--color-success-subtle)' },
      warning: { DEFAULT: 'var(--color-warning)', subtle: 'var(--color-warning-subtle)' },
      danger: { DEFAULT: 'var(--color-danger)', subtle: 'var(--color-danger-subtle)' },
      stale: { DEFAULT: 'var(--color-stale)', subtle: 'var(--color-stale-subtle)' },
      live: { DEFAULT: 'var(--color-live)', subtle: 'var(--color-live-subtle)' },
    },

    // NOTE: spacing is deliberately NOT replaced.
    //
    // An earlier version of this file overrode `spacing` with a short "fixed scale".
    // That silently broke every utility whose step wasn't in the list — h-11 (the
    // 44px touch target), h-80/h-96 (the map container) and max-h-64 all resolved to
    // 0px, which gave the map no height and left the page with nothing to scroll.
    //
    // Tailwind's default spacing IS a fixed 4px scale; it just has more steps. The
    // discipline we actually want (no arbitrary values like `h-[73px]`) is enforced
    // by review, not by deleting the steps the framework's own utilities depend on.

    // A fixed type scale. Six sizes is enough for any app this size.
    fontSize: {
      caption: ['0.75rem', { lineHeight: '1rem' }],
      small: ['0.875rem', { lineHeight: '1.25rem' }],
      body: ['1rem', { lineHeight: '1.5rem' }],
      lead: ['1.125rem', { lineHeight: '1.75rem' }],
      title: ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.01em' }],
      display: ['2rem', { lineHeight: '2.5rem', letterSpacing: '-0.02em' }],
    },

    borderRadius: {
      none: '0',
      sm: '0.25rem',
      md: '0.5rem',
      lg: '0.75rem',
      full: '9999px',
    },

    extend: {
      fontFamily: {
        // System stack: zero network requests, zero layout shift, instant first paint.
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 4px 12px rgb(0 0 0 / 0.06)',
        sheet: '0 -4px 24px rgb(0 0 0 / 0.12)',
      },
      keyframes: {
        pulse: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.45' } },
      },
      animation: {
        // Respect prefers-reduced-motion — handled in globals.css.
        pulse: 'pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
