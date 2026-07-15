import clsx from 'clsx';

const variants = {
  primary: 'bg-brand text-inverse hover:bg-brand-hover active:bg-brand-hover',
  secondary: 'bg-surface text-ink border border-border hover:bg-canvas active:bg-canvas',
  ghost: 'bg-transparent text-brand hover:bg-brand-subtle active:bg-brand-subtle',
  danger: 'bg-danger text-inverse hover:opacity-90 active:opacity-90',
};

const sizes = {
  // 44px min height on md/lg: the platform minimum for a reliable thumb target.
  sm: 'h-8 px-3 text-small rounded-sm gap-2',
  md: 'h-11 px-4 text-body rounded-md gap-2',
  lg: 'h-12 px-5 text-lead rounded-md gap-2 w-full',
};

/**
 * Every press gets visible feedback immediately (`active:` + `transition-none` on
 * the press itself). A button that looks inert for 300ms is what makes an app feel
 * like a prototype.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className,
  children,
  ...props
}) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center font-medium select-none',
        'transition-colors duration-100',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}
