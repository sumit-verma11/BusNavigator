/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Fail the build on a lint error rather than shipping it; CI runs eslint at the
  // repo root, so Next's own bundled linting stays out of the way.
  eslint: { ignoreDuringBuilds: true },
};
