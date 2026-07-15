import './globals.css';
import { Providers } from '../lib/providers.jsx';

export const metadata = {
  title: 'BusNavigator — Delhi bus routes & live tracking',
  description:
    'Find your bus in Delhi: nearby stops, direct routes between any two stops, and live bus positions.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // The map has its own zoom; the PAGE must still be pinch-zoomable. Locking user
  // scaling is an accessibility failure, not a design choice.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1117' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {/* Keyboard users must be able to skip past the map to the content. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-ink"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
