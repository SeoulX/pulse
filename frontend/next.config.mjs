/** @type {import('next').NextConfig} */
// API proxy lives at src/app/api/[...path]/route.ts (runtime handler that
// reads PULSE_API_INTERNAL_URL fresh on every request). next.config.mjs
// rewrites would bake the destination URL into the routes manifest at build
// time, which means the runtime configMap can't override it — that's why
// we don't use rewrites here anymore.
const nextConfig = {
  output: "standalone",
};

export default nextConfig;
