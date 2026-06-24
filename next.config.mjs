/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the bundled ffmpeg/ffprobe binaries loadable at runtime by telling
  // Next.js not to bundle these packages into the server build.
  experimental: {
    serverComponentsExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  },
};

export default nextConfig;
