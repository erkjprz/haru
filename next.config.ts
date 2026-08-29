import type { NextConfig } from "next";

// A stable identifier for this exact build, baked into the client bundle at build time, so
// ServiceWorkerRegister can tell whether the server is still running the same deploy the
// currently-loaded bundle came from. Vercel sets VERCEL_GIT_COMMIT_SHA for every deploy;
// falling back to the build timestamp covers local dev, where that variable doesn't exist but
// a fresh value per `next build` is still wanted.
const buildId = process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now());

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Clickjacking protection: frame-ancestors is the modern
          // mechanism, X-Frame-Options covers browsers that don't honor it.
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }
        ]
      }
    ];
  }
};

export default nextConfig;
