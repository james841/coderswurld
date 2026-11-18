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
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "white",
              color: "#1d3a8a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
              fontWeight: 800,
            }}
          >
            CW
          </div>
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
