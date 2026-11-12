/** @type {import('next').NextConfig} */
const nextConfig = {
  // The game bootstraps a single WebGL context and global event listeners in
  // one imperative module. Double-mounting under StrictMode would start the
  // world twice, so keep it single-mounted like the original single-page app.
  reactStrictMode: false,
};

export default nextConfig;
