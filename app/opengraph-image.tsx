import { ImageResponse } from "next/og";

/**
 * The picture shown when the site is shared on WhatsApp, Facebook, X or
 * LinkedIn, and in some Google results. Drawn from code in the brand colours,
 * so it never goes stale or needs a designer.
 */
export const alt = "Coderswurld Inventory: inventory and POS for Nigerian supermarkets and pharmacies";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#1d3a8a",
          color: "white",
          padding: "64px 72px",
          position: "relative",
          fontFamily: "sans-serif",
        }}
      >
        {/* Orange sun, as on the landing page */}
        <div
          style={{
            position: "absolute",
            right: -120,
            top: -160,
            width: 520,
            height: 520,
            borderRadius: 9999,
            background: "#ea580c",
            display: "flex",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="64" height="64" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="15" fill="#172554" />
            <rect x="1" y="1" width="62" height="62" rx="14" fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="2" />
            <path
              d="M11 19v-5a3 3 0 0 1 3-3h5M45 11h5a3 3 0 0 1 3 3v5M53 45v5a3 3 0 0 1-3 3h-5M19 53h-5a3 3 0 0 1-3-3v-5"
              stroke="#ffffff"
              strokeOpacity="0.5"
              strokeWidth="2.6"
              strokeLinecap="round"
              fill="none"
            />
            <path d="M41.9 23.6A13 13 0 1 0 41.9 40.4" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" fill="none" />
            <path d="M29 32h23" stroke="#f97316" strokeWidth="3.6" strokeLinecap="round" />
          </svg>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>
            Coderswurld<span style={{ color: "#fdba74", marginLeft: 10 }}>Inventory</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 860 }}>
          <div style={{ display: "flex", fontSize: 68, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1 }}>
            Inventory and POS for supermarkets and pharmacies
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#c7d2fe" }}>
            Sell faster, know your stock, see your profit every day.
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 24 }}>
          {["Works offline", "Barcode scanning", "Expiry tracking", "Built for Nigeria"].map((t) => (
            <div
              key={t}
              style={{
                display: "flex",
                padding: "10px 20px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.25)",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
