/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root — there's a stray package-lock.json one level up
  // (in photobooth-phase1/) that Next.js would otherwise guess as the root.
  turbopack: {
    root: import.meta.dirname,
  },
  // Next.js dev mode blocks cross-origin requests to dev-only assets/HMR
  // by default — only the origin the server started on (localhost) works
  // out of the box. That silently breaks any page opened from another
  // device on the LAN (e.g. a phone scanning a QR code pointed at this
  // machine's IP): the HTML loads, but hydration/HMR/client JS never
  // actually runs. This machine's current LAN IP needs to be listed here;
  // it'll need updating if the IP changes (different network, DHCP lease).
  allowedDevOrigins: ['192.168.0.101'],
};

export default nextConfig;
