"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

/**
 * "Install app": puts Coderswurld on the computer's desktop and Start menu
 * (Chrome and Edge on Windows and Mac) or the phone's home screen. Once
 * installed it opens in its own window, without the browser bar.
 *
 * The browser offers installation through a `beforeinstallprompt` event that
 * can fire before React mounts, so it is caught at module load and kept.
 * The button only shows when the browser has actually offered it, and never
 * inside the installed app itself.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button instead of the mini-bar
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export function InstallAppButton({ tone = "light" }: { tone?: "light" | "dark" }) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: window-controls-overlay)").matches;
    const update = () => setAvailable(Boolean(deferred) && !standalone);
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  if (!available) return null;

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    listeners.forEach((l) => l());
  }

  return (
    <button
      type="button"
      onClick={install}
      title="Install Coderswurld on this computer. It opens in its own window and works offline at the till."
      className={
        tone === "dark"
          ? "hidden h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm font-semibold text-white transition hover:bg-white/20 md:inline-flex"
          : "btn btn-outline btn-sm hidden md:inline-flex"
      }
    >
      <Download className="size-4" aria-hidden />
      Install app
    </button>
  );
}
