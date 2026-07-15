'use client';

import clsx from 'clsx';

/**
 * A native <select> on purpose.
 *
 * A custom dropdown would need: keyboard navigation, type-ahead, focus trapping,
 * ARIA listbox semantics, touch scrolling, and a mobile-safe popup — all of which
 * the platform already does correctly, for free, in every locale and with every
 * assistive technology. The region picker is not where to spend that budget.
 */
export function Select({ label, hint, error, className, children, ...props }) {
  const id = props.id ?? props.name;

  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      {label && (
        <label htmlFor={id} className="text-small font-medium text-ink">
          {label}
        </label>
      )}
      <select
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={clsx(
          'h-11 w-full rounded-md border bg-surface px-3 text-body text-ink',
          'appearance-none bg-[length:12px] bg-[right_1rem_center] bg-no-repeat',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error ? 'border-danger' : 'border-border',
        )}
        style={{
          // Inline SVG chevron as a data URI — no icon library, no network request.
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath fill='%235a6472' d='M1 1l5 5 5-5'/%3E%3C/svg%3E\")",
        }}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p id={`${id}-error`} className="text-caption text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-caption text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
