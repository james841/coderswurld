import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't advertise the framework.
  poweredByHeader: false,

  // exceljs is a heavy Node-only library used solely by the Excel import route
  // handler. Keeping it external stops the bundler from trying to trace it into
  // the app bundle (it pulls in node streams and zlib).
  // pdfkit and docx build the stock records; pdfkit reads its own font files
  // from disk, so it must stay a real node module rather than be bundled.
  serverExternalPackages: ["exceljs", "pdfkit", "docx"],

  // The stock PDF embeds this font (it has the ₦ sign). Ship it with the route.
  outputFileTracingIncludes: {
    "/api/stock/export": ["./assets/fonts/**"],
  },

  images: {
    // Product images are optional and already compressed client-side to
    // ~70KB WebP before upload, so the built-in optimizer has little left to do.
    // A long TTL keeps it from re-processing the same file all day.
    minimumCacheTTL: 60 * 60 * 24 * 30,
    formats: ["image/webp"],
    // Product tiles never render larger than ~320px on any breakpoint;
    // shipping a 1080w candidate in every srcset is wasted bytes.
    imageSizes: [32, 48, 64, 96, 128, 256],
    deviceSizes: [320, 480, 640, 828, 1080, 1200],
    localPatterns: [{ pathname: "/uploads/**" }, { pathname: "/brand/**" }],
  },

  // Next 16 removed build-time ESLint integration (and `next lint`), so there is
  // no `eslint` config key any more. Linting is a separate `eslint .` step —
  // which is the right shape anyway: a lint warning should never block a till
  // from being deployed during trading hours.

  async headers() {
    return [
      {
        // Uploaded product images are content-addressed (hashed filenames),
        // so they can be cached immutably and forever.
        source: "/uploads/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // The service worker must never be served stale: a shop stuck on an old
        // worker cannot be fixed by deploying a new one. The browser re-checks
        // this file on every visit and swaps in a new version by itself.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      // Signed-in areas never belong in search results, even if a link to one
      // leaks. robots.txt asks crawlers to stay out; this header makes sure.
      ...[
        "/api", "/dashboard", "/products", "/stock", "/suppliers", "/purchases", "/receipts",
        "/sales", "/customers", "/expenses", "/reports", "/staff", "/settings", "/receipt-design",
        "/hardware", "/pos", "/platform", "/launch", "/locked", "/change-password", "/pay",
      ].map((prefix) => ({
        source: `${prefix}/:path*`,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
