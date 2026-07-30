/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root — there's a stray package-lock.json one level up
  // (in photobooth-phase1/) that Next.js would otherwise guess as the root.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
