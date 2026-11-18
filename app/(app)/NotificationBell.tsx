"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCheck,
  CloudOff,
  Loader2,
  PackageX,
  Wallet,
} from "lucide-react";

/**
 * The notification bell.
 *
 * WHY THIS DOESN'T FETCH ON MOUNT
 * -------------------------------
 * The unread count arrives as a prop, rendered by the server alongside the page
 * the user asked for. Fetching it again on mount would add a request to every
 * single navigation in the app to learn a number the server already knew — and
 * "no unnecessary egress" is a requirement here, not a preference. The list
 * itself is fetched the first time the panel is opened, and never before.
 *
 * WHY THE POLL IS SLOW
 * --------------------
 * Notifications come from a periodic sweep (expiry, low stock), not from live
 * events. Polling faster than the sweep produces identical responses and
 * nothing else. Two minutes, and only while the tab is actually visible — a
 * shop laptop left open on this page overnight should cost nothing.
 */

const POLL_MS = 120_000;

interface Item {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  linkHref: string | null;
  count: number;
  isRead: boolean;
  createdAt: string;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  EXPIRY_SOON: CalendarClock,
  EXPIRED: CalendarClock,
  LOW_STOCK: PackageX,
  OUT_OF_STOCK: PackageX,
  DEBT_DUE: Wallet,
  SUBSCRIPTION_EXPIRING: AlertTriangle,
  SYNC_FAILED: CloudOff,
};

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { unread: number; items: Item[] };
      setUnread(body.unread);
      setItems(body.items);
    } catch {
      // Offline, or the server is down. The bell keeps showing the last count it
      // knew rather than flashing an error into the topbar of every page.
    }
  }, []);

  // Poll only while visible, and catch up when the tab comes back.
  useEffect(() => {
    function tick() {
      if (document.visibilityState === "visible") void load();
    }
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  // Close on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    // Fetch the list the first time it's actually needed.
    if (next && items === null) void load();
  }

  /**
   * Marking read is optimistic, unlike every control in the platform console.
   * The difference is what a wrong guess costs: a read receipt that didn't
   * persist is a badge that reappears in two minutes, whereas making the user
   * watch a spinner before the page they clicked starts loading is a cost they
   * pay every single time.
   */
  async function openItem(item: Item) {
    setOpen(false);
    if (!item.isRead) {
      setItems((current) =>
        current?.map((row) => (row.id === item.id ? { ...row, isRead: true } : row)) ?? null,
      );
      setUnread((n) => Math.max(0, n - 1));
      void fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      }).catch(() => undefined);
    }
    if (item.linkHref) router.push(item.linkHref);
  }

  async function clearAll() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setItems((current) => current?.map((row) => ({ ...row, isRead: true })) ?? null);
      setUnread(0);
    } catch {
      // Leave the badge alone — better a stale count than a false "all clear".
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Alerts — ${unread} unread` : "Alerts"}
        aria-expanded={open}
        className="btn btn-icon relative text-ink-600 hover:bg-ink-100 hover:text-ink-950"
      >
        <Bell className="size-[1.125rem]" />
        {unread > 0 ? (
          <span className="tabular absolute -right-0.5 -top-0.5 grid min-w-[1.125rem] place-items-center rounded-full bg-brand-700 px-1 text-[0.625rem] font-bold leading-[1.125rem] text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="animate-slide-up absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-hairline bg-surface shadow-[var(--shadow-overlay)]">
          <header className="flex items-center justify-between gap-2 border-b border-hairline px-3.5 py-2.5">
            <h2 className="text-sm font-bold text-ink-950">Alerts</h2>
            {unread > 0 ? (
              <button
                type="button"
                onClick={clearAll}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCheck className="size-3.5" />
                )}
                Mark all read
              </button>
            ) : null}
          </header>

          {items === null ? (
            <div className="grid place-items-center py-8">
              <Loader2 className="size-5 animate-spin text-ink-300" />
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-semibold text-ink-900">Nothing needs you.</p>
              <p className="mt-1 text-xs text-ink-500">
                Expiry and low-stock warnings appear here as soon as they matter.
              </p>
            </div>
          ) : (
            <ul className="max-h-[26rem] divide-y divide-hairline overflow-y-auto">
              {items.map((item) => {
                const Icon = ICONS[item.type] ?? Bell;
                const tone =
                  item.severity === "CRITICAL"
                    ? "bg-bad-50 text-bad-700"
                    : item.severity === "WARNING"
                      ? "bg-warn-50 text-warn-700"
                      : "bg-info-50 text-info-700";
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void openItem(item)}
                      className={`flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-brand-50 ${
                        item.isRead ? "" : "bg-ink-50"
                      }`}
                    >
                      <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${tone}`}>
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-ink-950">
                            {item.title}
                          </span>
                          {item.isRead ? null : (
                            <span className="size-1.5 shrink-0 rounded-full bg-brand-700" aria-hidden />
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-ink-600">
                          {item.body}
                        </span>
                        <span className="mt-1 block text-[0.6875rem] text-ink-400">
                          {timeAgo(item.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Local relative time. `lib/dates.ts` is `server-only` — deliberately, because
 * day boundaries must be computed against the organization's timezone and not
 * the browser's. None of that applies to "how long ago", so this stays here
 * rather than weakening that boundary.
 */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}
