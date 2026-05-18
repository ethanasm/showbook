import type { NextConfig } from "next";

// Baseline security headers applied to every response.
//
// CSP scope (2026-05-17): we tighten every directive except `script-src`
// and `style-src`. Next.js 15 still emits inline framework scripts (RSC
// payloads, route prefetches) and runtime styles (`<style>` tags from
// CSS modules and dnd-kit) that would require a per-request nonce or a
// strict-dynamic hash chain to lock down. That migration is its own PR
// — it needs middleware-side nonce generation, a `headers()`-bridged
// nonce in the root layout, a report-only rollout, and an
// `/api/csp-report` collector. Until then, the directives below still
// block third-party script injection, lock down where the page can
// exfiltrate to, and forbid framing / form retargeting.
const isDev = process.env.NODE_ENV !== "production";

// Next.js dev server uses a WebSocket for HMR; the prod build doesn't,
// so we only widen `connect-src` to include ws/wss in dev.
const devConnect = isDev ? " ws: wss:" : "";

const cspDirectives = [
  "default-src 'self'",
  // Inline scripts remain permitted; Next 15's RSC + prefetch streams
  // require it. `https:` covers next/script `strategy="beforeInteractive"`
  // and the LangFuse / Spotify analytics shims if/when they ship.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  // Leaflet, dnd-kit, and Next.js itself inject inline styles. Tightening
  // requires the same nonce work as script-src.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  // Audio sources: Spotify previews (`p.scdn.co`), Apple Music artwork
  // CDN (`mzstatic.com`), and Apple's iTunes preview origin
  // (`audio-ssl.itunes.apple.com`) — the latter is the fallback URL
  // returned by `searchTrackPreview` for the ~all tracks Spotify
  // stopped serving previews for in Nov 2024. Without this entry the
  // browser silently rejects the `<audio>` load with a CSP violation
  // and the row flips to "no preview available".
  "media-src 'self' data: https://*.scdn.co https://*.mzstatic.com https://*.itunes.apple.com",
  "font-src 'self' data:",
  // tRPC + NextAuth talk to self; Spotify / setlist.fm / Ticketmaster /
  // Resend / Groq are addressed server-side, so the browser only needs
  // self + Spotify Web Playback for the in-app preview player. The dev
  // server's HMR socket is added via `devConnect` above.
  `connect-src 'self' https://api.spotify.com https://accounts.spotify.com${devConnect}`,
  "frame-src 'self' https://accounts.google.com https://accounts.spotify.com",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "base-uri 'self'",
  "object-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: cspDirectives },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "s1.ticketm.net" },
      // Spotify artist images (saved to performers.imageUrl on Spotify import).
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "mosaic.scdn.co" },
      // Apple Music artwork.
      { protocol: "https", hostname: "**.mzstatic.com" },
    ],
  },
  transpilePackages: [
    "@showbook/db",
    "@showbook/api",
    "@showbook/shared",
    "@showbook/jobs",
    "@showbook/emails",
    "@showbook/observability",
  ],
  serverExternalPackages: [
    "sharp",
    "pg-boss",
    "playwright",
    "playwright-core",
    "chromium-bidi",
    "@showbook/scrapers",
    "pino",
    "pino-pretty",
    "thread-stream",
    "@axiomhq/pino",
    "langfuse",
    // unpdf is a Node-only PDF parser used inside dynamic imports in
    // server routes; bundling it triggers `import.meta` and worker
    // resolution warnings, so we externalize it and load from
    // node_modules at runtime.
    "unpdf",
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push(
        "sharp",
        "playwright",
        "playwright-core",
        "chromium-bidi",
        "pino",
        "pino-pretty",
        "thread-stream",
        "@axiomhq/pino",
        "unpdf",
      );
    }
    return config;
  },
};

export default nextConfig;
