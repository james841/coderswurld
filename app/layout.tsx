import type { Metadata, Viewport } from "next";
import { siteUrl } from "@/lib/site";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MotionProvider } from "@/components/motion";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Coderswurld Inventory — Inventory & POS for Nigerian shops",
    template: "%s · Coderswurld Inventory",
  },
  description:
    "Sell faster, know your stock, and see your profit every day. Inventory management and point of sale built for supermarkets, mini marts and pharmacies in Nigeria. One yearly payment, no monthly fees.",
  applicationName: "Coderswurld Inventory",
  keywords: [
    "inventory management software Nigeria",
    "POS software Nigeria",
    "supermarket software",
    "pharmacy software Nigeria",
    "pharmacy inventory software",
    "mini mart point of sale",
    "stock management",
    "barcode POS Nigeria",
  ],
  metadataBase: new URL(siteUrl()),
  alternates: { canonical: "/" },
  // Google Search Console: paste the "HTML tag" code's content value into
  // GOOGLE_SITE_VERIFICATION on Vercel. (Or verify by DNS and leave it empty.)
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
  twitter: {
    card: "summary_large_image",
    title: "Inventory & POS built for Nigerian shops",
    description:
      "Sell faster, know your stock, see your profit every day. Made for supermarkets, mini marts and pharmacies.",
  },
  openGraph: {
    type: "website",
    locale: "en_NG",
    url: "/",
    siteName: "Coderswurld Inventory",
    title: "Inventory & POS built for Nigerian shops",
    description:
      "Sell faster, know your stock, see your profit every day. One yearly payment — no monthly fees.",
  },
  robots: { index: true, follow: true },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Coderswurld", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // A cashier must not be able to pinch-zoom the till out of alignment
  // mid-transaction, but locking zoom entirely fails accessibility. 5x is the
  // accepted compromise.
  maximumScale: 5,
  themeColor: "#1d4ed8",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
