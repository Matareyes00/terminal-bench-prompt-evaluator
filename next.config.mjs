/** @type {import('next').NextConfig} */
const nextConfig = {
  // The check layer is plain TypeScript shared with the CLI, which runs under
  // `node --experimental-strip-types` and therefore needs explicit `.ts`
  // import specifiers. Keep them; tsconfig allows them.
  experimental: {},
};

export default nextConfig;
