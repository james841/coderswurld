import type { Metadata } from "next";

import { OfflineView } from "./OfflineView";

export const metadata: Metadata = {
  title: "Offline view",
  robots: { index: false, follow: false },
};

/**
 * The Offline view: products, stock and this computer's recent sales, read
 * from the copy saved on this device. The page itself holds no shop data (it
 * is the same for everyone and is saved for offline use); everything shown
 * comes from this computer's own storage, and only while someone is signed in
 * here.
 */
export default function OfflinePage() {
  return <OfflineView />;
}
