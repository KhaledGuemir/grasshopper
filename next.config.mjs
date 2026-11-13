/** @type {import('next').NextConfig} */
const nextConfig = {
  // The game bootstraps a single WebGL context and global event listeners in
  // one imperative module. Double-mounting under StrictMode would start the
  // world twice, so keep it single-mounted like the original single-page app.
  reactStrictMode: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
