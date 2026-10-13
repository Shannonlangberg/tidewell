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
  // Node-only (fontkit, yoga); must stay out of the Turbopack server bundle.
  serverExternalPackages: ["@react-pdf/renderer"],

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [{ key: "Content-Security-Policy", value: csp() }],
      },
      {
        // Sign-in only: the Turnstile widget (script plus its challenge iframe).
        source: "/app",
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
    ];
  },
};

export default nextConfig;
