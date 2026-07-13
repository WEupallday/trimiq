/** @type {import("next").NextConfig} */

// Security headers served on every response. CSP is intentionally
// pragmatic: Next.js needs inline scripts for hydration; everything else
// is locked to same-origin. blob: is required for in-app video previews.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      // wikimedia: public media CDN used by the admin benchmark workflow.
      "connect-src 'self' https://upload.wikimedia.org https://commons.wikimedia.org",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join("; "),
  },
];

const nextConfig = {
  // Don't advertise the framework.
  poweredByHeader: false,
  // Keep the bundled ffmpeg/ffprobe binaries loadable at runtime by telling
  // Next.js not to bundle these packages into the server build.
  experimental: {
    serverComponentsExternalPackages: ["ffmpeg-static", "ffprobe-static", "@prisma/client", "bcryptjs"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
