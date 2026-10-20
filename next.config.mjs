/** @type {import('next').NextConfig} */

// No proxy.ts (opennextjs-netlify issue #3575), so headers live here and in
// netlify.toml. Without a per-request nonce the app's own inline bootstrap
// scripts need 'unsafe-inline'; external script origins are still pinned.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseWs = supabaseUrl.replace(/^http/, "ws");
const dev = process.env.NODE_ENV === "development";

const csp = (extra = {}) => {
  const d = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    "img-src": ["'self'", "data:", "blob:", supabaseUrl],
    "connect-src": ["'self'", supabaseUrl, supabaseWs],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "manifest-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    ...extra,
  };
  return Object.entries(d)
    .map(([k, v]) => `${k} ${v.filter(Boolean).join(" ")}`)
    .join("; ");
};

const TURNSTILE = "https://challenges.cloudflare.com";

const nextConfig = {
  // Dev only: lets several builders use their own hostnames (auth.localhost, contacts.localhost, ...)
  // so their browser cookie jars, and therefore their test sign-ins, do not collide.
  allowedDevOrigins: ["*.localhost"],

  // Parallel work (several dev servers at once) needs separate build output.
  // Unset in production and on Netlify, where the default .next is required.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),

  // The HQ import pages (partners, and contractors under /hq/partners) read a bundled seed file at request time. Next only packages files it
  // can see being imported, so name it for Netlify (without this the "Load the research leads" / "Load the maintenance prospects file"
  // button works locally but not once deployed).
  outputFileTracingIncludes: { "/hq/growth/import": ["./hq/seed/**/*"], "/hq/partners/import": ["./hq/seed/**/*"] },

  // Node-only (fontkit, yoga); must stay out of the Turbopack server bundle.
  serverExternalPackages: ["@react-pdf/renderer"],

  // hq.plantedproperty.com.au is the staff address for Planted HQ. Its front page is the HQ sign-in/home,
  // not the public website; every other path (/hq/..., /mcp, /.well-known/...) is served as normal.
  // HQ lives at hq.plantedproperty.com.au. Anyone who reaches /hq on the plain Netlify address is sent there.
  // Only the exact production Netlify host: deploy-preview hosts (xxxx--plantedhq.netlify.app) are untouched.
  async redirects() {
    return [
      {
        source: "/hq/:path*",
        has: [{ type: "host", value: "plantedhq.netlify.app" }],
        destination: "https://hq.plantedproperty.com.au/hq/:path*",
        permanent: false,
      },
      {
        source: "/mcp",
        has: [{ type: "host", value: "plantedhq.netlify.app" }],
        destination: "https://hq.plantedproperty.com.au/mcp",
        permanent: false,
      },
    ];
  },

  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", has: [{ type: "host", value: "hq.plantedproperty.com.au" }], destination: "/hq" },
      ],
    };
  },

  async headers() {
    return [
      // The staff host's front page is HQ: never indexed, never cached.
      {
        source: "/",
        has: [{ type: "host", value: "hq.plantedproperty.com.au" }],
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        source: "/(.*)",
        headers: [{ key: "Content-Security-Policy", value: csp() }],
      },
      ...[
        // The three routes that may show a Turnstile widget: app sign-in, and the
        // two public enquiry forms. Each needs the script and its challenge iframe.
        // Without this the widget is silently blocked, so it must stay in step with
        // wherever NEXT_PUBLIC_TURNSTILE_SITE_KEY is used.
        "/app",
        "/hq/sign-in",
        "/rental-appraisal",
        "/contact",
      ].map((source) => ({
        source,
        headers: [
          {
            key: "Content-Security-Policy",
            value: csp({
              "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), TURNSTILE],
              "frame-src": [TURNSTILE],
              "connect-src": ["'self'", supabaseUrl, supabaseWs, TURNSTILE],
            }),
          },
        ],
      })),
      {
        // The connected-app consent page posts to its decision route, which answers with a 303 to
        // the app's registered return address (ChatGPT, Claude, or a desktop app on this machine).
        // Browsers apply form-action to that redirect, so this one page allows https and loopback
        // http as form targets. The route itself re-checks the address before redirecting.
        source: "/hq/oauth/consent",
        headers: [
          {
            key: "Content-Security-Policy",
            value: csp({ "form-action": ["'self'", "https:", "http://localhost:*", "http://127.0.0.1:*", "http://[::1]:*"] }),
          },
        ],
      },
      {
        // Planted HQ's MCP endpoint and its OAuth metadata: API responses carrying HQ data
        // (or describing how to get it). Never cached anywhere, never indexed (mirrored in netlify.toml).
        source: "/mcp",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/.well-known/oauth-protected-resource/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        // Guest stay page: never cached, never indexed, never leaks its URL (mirrored in netlify.toml).
        source: "/stay/:token*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // The parked Tidewell app. robots.txt already disallows it, but a header
        // also covers crawlers that reach a URL directly (mirrored in netlify.toml).
        source: "/app/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        // Planted HQ: private staff portal. Never indexed, never cached by shared caches.
        source: "/hq/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
