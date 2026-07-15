import clsx from 'clsx';

export function Card({ as: Tag = 'div', interactive = false, className, children, ...props }) {
  return (
    <Tag
      className={clsx(
        'rounded-lg border border-border bg-surface p-4',
        interactive && [
          'w-full text-left transition-colors duration-100',
          'hover:bg-canvas active:bg-canvas', // instant press feedback
          'cursor-pointer',
        ],
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** The route number, in the operator's own colour when the feed provides one. */
export function RouteBadge({ shortName, color }) {
  const bg = color ? `#${color}` : undefined;
  return (
    <span
      className={clsx(
        'inline-flex h-10 min-w-10 items-center justify-center rounded-md px-2',
        'font-mono text-small font-semibold',
        !bg && 'bg-brand-subtle text-brand',
      )}
      style={bg ? { backgroundColor: bg, color: '#fff' } : undefined}
    >
      {shortName ?? '—'}
    </span>
  );
}
