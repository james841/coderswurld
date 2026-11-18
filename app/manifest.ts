import type { MetadataRoute } from "next";

/**
 * The web app manifest — what makes "Install app" appear in the browser, and
 * what the installed app looks like on a desktop or a phone's home screen.
 *
 * It opens straight on the till. That is the screen a shop needs within a
 * second of clicking the icon, and it is the one screen that also works with no
 * internet. Anyone without till access is redirected to the dashboard.
 */
export default function manifest(): MetadataRoute.Manifest {
  const extra = {
    // Clicking the app icon again focuses the open window instead of a second one.
    launch_handler: { client_mode: "focus-existing" },
  };
  return {
    ...(extra as object),
    name: "Coderswurld Inventory",
    short_name: "Coderswurld",
    description: "Inventory and point of sale that keeps selling when the internet goes down.",
    id: "/",
    // Owners land on the dashboard, cashiers at the till (see app/launch).
    start_url: "/launch",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#1d4ed8",
    categories: ["business", "productivity", "finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Desktop Chrome and Edge show these in a richer install window.
    screenshots: [
      { src: "/screenshots/till-wide.webp", sizes: "1280x800", type: "image/webp", form_factor: "wide", label: "Sell at the till" },
      { src: "/screenshots/dashboard-wide.webp", sizes: "1280x800", type: "image/webp", form_factor: "wide", label: "See the whole shop" },
    ],
    shortcuts: [
      { name: "Sell at till", url: "/pos" },
      { name: "Dashboard", url: "/dashboard" },
      { name: "What to reorder", url: "/purchases/reorder" },
      { name: "Expiry", url: "/stock/expiry" },
      { name: "File a supplier receipt", url: "/receipts?new=1" },
    ],
  };
}
