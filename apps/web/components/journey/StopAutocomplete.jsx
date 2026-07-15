'use client';

import { useId, useRef, useState } from 'react';
import clsx from 'clsx';
import { useStopSearch } from '../../lib/queries.js';
import { useDebounce } from '../../hooks/useDebounce.js';

/**
 * An ARIA combobox, built to the pattern rather than approximated:
 * arrow keys move through options, Enter picks, Escape closes, and
 * aria-activedescendant tells a screen reader which option is focused without
 * moving DOM focus out of the input.
 *
 * This is the app's primary input. Getting it wrong makes the whole thing unusable
 * for anyone on a keyboard or a screen reader — and it's the one place a custom
 * widget is genuinely warranted, because no native element does async suggestions.
 */
export function StopAutocomplete({ label, region, value, onSelect, placeholder, action }) {
  const inputId = useId();
  const listId = `${inputId}-listbox`;

  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const blurTimer = useRef(null);

  const query = useDebounce(text, 250);
  const { data: options = [], isFetching } = useStopSearch({ region, q: query });

  const commit = (stop) => {
    onSelect(stop);
    setText('');
    setOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (event) => {
    if (!open || options.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
        break;
      case 'Enter':
        if (activeIndex >= 0) {
          event.preventDefault();
          commit(options[activeIndex]);
        }
        break;
      case 'Escape':
        setOpen(false);
        setActiveIndex(-1);
        break;
      default:
        break;
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-small font-medium text-ink">
        {label}
      </label>

      {/* A stop already chosen: show it as a removable chip rather than leaving the
          user to wonder whether their selection stuck. */}
      {value ? (
        <div className="flex items-center gap-2 rounded-md border border-brand bg-brand-subtle px-3 py-2">
          <span className="flex-1 truncate text-body text-ink">{value.name}</span>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="rounded-sm px-2 py-1 text-small font-medium text-brand hover:bg-surface"
            aria-label={`Clear ${label.toLowerCase()}: ${value.name}`}
          >
            Change
          </button>
        </div>
      ) : (
        <div className="relative">
          <div className="flex gap-2">
            <input
              id={inputId}
              type="text"
              role="combobox"
              autoComplete="off"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
              value={text}
              placeholder={placeholder}
              onChange={(e) => {
                setText(e.target.value);
                setOpen(true);
                setActiveIndex(-1);
              }}
              onFocus={() => text.length >= 2 && setOpen(true)}
              onBlur={() => {
                // Let a click on an option land before the list unmounts.
                blurTimer.current = setTimeout(() => setOpen(false), 120);
              }}
              onKeyDown={onKeyDown}
              className="h-11 w-full rounded-md border border-border bg-surface px-3 text-body text-ink placeholder:text-subtle"
            />
            {action}
          </div>

          {open && (
            <ul
              id={listId}
              role="listbox"
              aria-label={`${label} suggestions`}
              className="absolute z-10 mt-2 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-raised shadow-card"
            >
              {isFetching && options.length === 0 && (
                <li className="px-3 py-3 text-small text-muted">Searching…</li>
              )}

              {/* An empty result must SAY it's empty. A silently blank dropdown reads
                  as a broken app, not as "no matches". */}
              {!isFetching && query.length >= 2 && options.length === 0 && (
                <li className="px-3 py-3 text-small text-muted">No stop matches “{query}”.</li>
              )}

              {options.map((stop, i) => (
                // In an aria-activedescendant combobox, options are intentionally NOT
                // focusable: keyboard interaction lives on the input (arrows/Enter/Escape,
                // see onKeyDown) and focus never leaves it. Key handlers here would break
                // the pattern, not improve it — this click handler is for pointer users.
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                <li
                  key={stop.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => e.preventDefault()} // don't blur the input
                  onClick={() => {
                    clearTimeout(blurTimer.current);
                    commit(stop);
                  }}
                  className={clsx(
                    'cursor-pointer px-3 py-3 text-body',
                    i === activeIndex ? 'bg-brand-subtle text-brand' : 'text-ink',
                  )}
                >
                  {stop.name}
                  {stop.code && <span className="ml-2 text-caption text-subtle">{stop.code}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
