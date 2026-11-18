"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";

import { forgetOfflineUser } from "@/components/OfflineReady";

/**
 * Sign out. Used on the locked screen and in the app shell.
 *
 * `router.refresh()` after the redirect matters: without it the Server
 * Component cache can serve the previous user's rendered dashboard for a
 * moment. On a shared till that is a real leak, not a cosmetic one.
 */
export function SignOutButton({
  className = "btn btn-outline",
  label = "Sign out",
  showIcon = true,
}: {
  className?: string;
  label?: string;
  showIcon?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      // Even if the request failed we still want to leave the authenticated
      // area; the cookie may well have been cleared before the socket dropped.
    }
    // The offline copy of the till carries this person's name and shop.
    await forgetOfflineUser();
    router.replace("/signin");
    router.refresh();
  }

  return (
    <button type="button" onClick={signOut} disabled={busy} className={className}>
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : showIcon ? (
        <LogOut className="size-4" />
      ) : null}
      {label}
    </button>
  );
}
