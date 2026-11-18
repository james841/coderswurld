"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  CalendarClock,
  ChevronDown,
  FolderOpen,
  LayoutDashboard,
  Menu,
  Moon,
  Package,
  PackagePlus,
  ReceiptText,
  ScanLine,
  Settings,
  ShoppingCart,
  Sun,
  TrendingUp,
  Truck,
  Usb,
  UserCog,
  Users,
  Wallet,
  X,
} from "lucide-react";

import { AnimatePresence } from "motion/react";

import { Logo } from "@/components/Logo";
import { EASE, m } from "@/components/motion";
import { InstallAppButton } from "@/components/InstallAppButton";
import { OfflineReady } from "@/components/OfflineReady";
import { SignOutButton } from "@/components/SignOutButton";
import { PERMISSIONS, ROLE_LABELS, type Permission, type Role } from "@/lib/constants";
import { hasPermission } from "@/lib/permissions";
import { NotificationBell } from "./NotificationBell";

/**
 * The shell every admin page sits in.
 *
 * WHY THE NAV IS FILTERED HERE AND NOT ON THE SERVER
 * --------------------------------------------------
 * `lib/permissions.ts` and `lib/constants.ts` carry no `server-only` marker,
 * deliberately, so the same filter runs in the browser. The alternative is
 * building the list on the server and passing it down — but icons are
 * components, and components don't cross that boundary. The cost of doing it
 * here is nothing: the permission list is already in the session and the pages
 * behind every link guard themselves.
 *
 * A link the user can't follow is worse than a missing link. A sub-admin whose
 * main admin didn't grant Reports should not see Reports and discover the
 * restriction by being told no — they should see an app that fits them.
 *
 * WHY THE SHELL IS A CLIENT COMPONENT BUT THE PAGES AREN'T
 * --------------------------------------------------------
 * `children` is a slot. The layout renders each page on the server and hands
 * the finished output here, so the sidebar's open/closed state and the bell's
 * poll timer survive navigation while the pages themselves stay server-rendered
 * with no loading spinner on first paint.
 */

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: Permission;
  /** Also show to these roles even without the permission. */
  roles?: string[];
}

interface NavGroup {
  /** Groups are unlabelled when the items speak for themselves. */
  label: string | null;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: null,
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        permission: PERMISSIONS.DASHBOARD_VIEW,
      },
    ],
  },
  {
    label: "Inventory",
    items: [
      { href: "/products", label: "Products", icon: Package, permission: PERMISSIONS.PRODUCTS_VIEW },
      { href: "/stock", label: "Stock", icon: Boxes, permission: PERMISSIONS.STOCK_VIEW },
      { href: "/stock/expiry", label: "Expiry", icon: CalendarClock, permission: PERMISSIONS.STOCK_VIEW },
      { href: "/suppliers", label: "Suppliers", icon: Truck, permission: PERMISSIONS.SUPPLIERS_VIEW },
      {
        href: "/purchases",
        label: "Purchases",
        icon: ShoppingCart,
        permission: PERMISSIONS.PURCHASES_VIEW,
      },
      { href: "/purchases/reorder", label: "What to reorder", icon: PackagePlus, permission: PERMISSIONS.PURCHASES_VIEW },
      // The paper that came with the goods. It rides on the purchasing grant:
      // anyone who may see what was bought may see the receipt for it.
      {
        href: "/receipts",
        label: "Receipts",
        icon: FolderOpen,
        permission: PERMISSIONS.PURCHASES_VIEW,
      },
    ],
  },
  {
    label: "Selling",
    items: [
      { href: "/sales", label: "Sales", icon: ReceiptText, permission: PERMISSIONS.SALES_VIEW },
      { href: "/customers", label: "Customers", icon: Users, permission: PERMISSIONS.CUSTOMERS_VIEW },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/expenses", label: "Expenses", icon: Wallet, permission: PERMISSIONS.EXPENSES_VIEW },
      { href: "/reports", label: "Reports", icon: TrendingUp, permission: PERMISSIONS.REPORTS_VIEW },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/staff", label: "Staff", icon: UserCog, permission: PERMISSIONS.USERS_VIEW },
      { href: "/hardware", label: "Printer and scanner", icon: Usb, permission: PERMISSIONS.POS_SELL, roles: ["MAIN_ADMIN", "SUB_ADMIN", "MANAGER"] },
      {
        href: "/receipt-design",
        label: "Receipt design",
        icon: ReceiptText,
        permission: PERMISSIONS.SETTINGS_MANAGE,
        roles: ["MAIN_ADMIN", "SUB_ADMIN", "MANAGER"],
      },
      { href: "/settings", label: "Settings", icon: Settings, permission: PERMISSIONS.SETTINGS_VIEW },
    ],
  },
];

export interface ShellUser {
  name: string;
  /**
   * A plain string, matching the column. Roles are stored as text rather than a
   * Postgres enum, so the type that reaches here is whatever the row holds —
   * pretending otherwise just moves the surprise to runtime.
   */
  role: string;
  permissions: Permission[];
}

/** Falls back to the raw value rather than rendering "undefined" at someone. */
function roleLabel(role: string): string {
  return ROLE_LABELS[role as Role] ?? role;
}

/**
 * Matches `/products` and `/products/add`, never `/products-archive`. Same rule
 * the proxy uses for its prefixes — a nav item that highlights on the wrong page
 * is a small lie about where you are.
 */
function isActive(pathname: string, href: string): boolean {
  if (!(pathname === href || pathname.startsWith(`${href}/`))) return false;
  // A more specific menu item wins: on /stock/expiry, "Expiry" lights up, not "Stock".
  return !ALL_HREFS.some(
    (other) => other.length > href.length && other.startsWith(`${href}/`) && (pathname === other || pathname.startsWith(`${other}/`)),
  );
}

const ALL_HREFS = NAV.flatMap((g) => g.items.map((i) => i.href));

export function AppShell({
  user,
  orgName,
  branchName,
  unreadNotifications,
  initialTheme = "light",
  children,
}: {
  user: ShellUser;
  orgName: string;
  branchName: string | null;
  unreadNotifications: number;
  initialTheme?: "light" | "dark";
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Light or dark blue. Saved in a cookie (not localStorage) so the server can
  // send the page already in the right theme: no white flash on load.
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.cookie = `cw-theme=${next}; path=/; max-age=31536000; samesite=lax`;
  }
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer when the route changes — on a phone the new page is behind
  // the drawer you just tapped through.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const canSell = hasPermission(user, PERMISSIONS.POS_SELL);
  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => hasPermission(user, item.permission) || Boolean(item.roles?.includes(user.role)),
    ),
  })).filter((group) => group.items.length > 0);

  const sidebar = (
    <div className="flex h-full flex-col border-r border-hairline bg-surface">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-hairline px-4">
        <Logo href="/dashboard" size="sm" />
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          className="btn btn-icon text-ink-500 hover:bg-ink-100 hover:text-ink-950 lg:hidden"
          aria-label="Close menu"
        >
          <X className="size-5" />
        </button>
      </div>

      {/*
        The till gets its own block above the nav, not a row inside it. Everything
        else in this sidebar is somebody looking something up; this is the thing
        that takes money. It also leaves the shell entirely — /pos renders
        full-screen with no sidebar, because a cashier with a queue in front of
        them does not need navigation.
      */}
      {canSell ? (
        <div className="shrink-0 px-3 pt-3">
          <Link
            href="/pos"
            className="texture-waves flex items-center gap-2.5 rounded-xl bg-sell-600 px-3 py-3 text-sm font-bold text-white transition-colors hover:bg-sell-700"
          >
            <ScanLine className="size-[1.125rem] shrink-0" />
            Sell at till
            <span className="ml-auto text-[0.6875rem] font-semibold uppercase tracking-wide text-white/80">
              Open
            </span>
          </Link>
        </div>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {groups.map((group) => (
          <div key={group.label ?? "main"} className="mb-4 last:mb-0">
            {group.label ? (
              <p className="mb-1.5 px-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-400">
                {group.label}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                        active
                          ? "bg-navy-700 text-white"
                          : "text-ink-600 hover:bg-navy-50 hover:text-navy-800"
                      }`}
                    >
                      <item.icon className="size-[1.125rem] shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Who you are, and the way out. */}
      <div className="shrink-0 border-t border-hairline p-3">
        <div className="mb-2 px-1">
          <p className="truncate text-sm font-semibold text-ink-950">{user.name}</p>
          <p className="truncate text-xs text-ink-500">{roleLabel(user.role)}</p>
        </div>
        <SignOutButton
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-50 hover:text-ink-950"
          label="Sign out"
        />
      </div>
    </div>
  );

  return (
    <div data-theme={theme} className="min-h-dvh bg-canvas text-ink-900 transition-colors duration-300">
      {/* Saves the till for offline use in the background, for anyone who sells. */}
      <OfflineReady warmTill={canSell} />
      {/* Desktop: a column that doesn't scroll with the page. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">{sidebar}</aside>

      {/* Mobile: the same markup in a drawer. */}
      {/*
        AnimatePresence keeps the drawer mounted for the moment it takes to
        slide back out, so closing is as smooth as opening instead of a blink.
      */}
      <AnimatePresence>
        {drawerOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <m.button
              type="button"
              aria-label="Close menu"
              onClick={() => setDrawerOpen(false)}
              className="absolute inset-0 bg-ink-950/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            />
            <m.aside
              className="absolute inset-y-0 left-0 w-64 shadow-[var(--shadow-overlay)]"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.28, ease: EASE }}
            >
              {sidebar}
            </m.aside>
          </div>
        ) : null}
      </AnimatePresence>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-hairline bg-surface px-3 sm:px-4">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="btn btn-icon text-ink-600 hover:bg-ink-100 hover:text-ink-950 lg:hidden"
            aria-label="Open menu"
            aria-expanded={drawerOpen}
          >
            <Menu className="size-5" />
          </button>

          {/*
            The shop name sits in the topbar rather than the sidebar on purpose:
            a manager with two branches needs to know which one they're looking
            at before they read a single number, and the sidebar is the part
            that's hidden on a phone.
          */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink-950">{orgName}</p>
            {branchName ? (
              <p className="truncate text-xs text-ink-500">{branchName}</p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="btn btn-icon text-ink-600 hover:bg-ink-100 hover:text-ink-950"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>

          <InstallAppButton />

          <NotificationBell initialUnread={unreadNotifications} />

          {canSell ? (
            <Link href="/pos" className="btn btn-sell btn-sm hidden sm:inline-flex">
              <ScanLine className="size-4" />
              Till
            </Link>
          ) : null}

          <details className="relative hidden sm:block">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-ink-700 hover:bg-ink-100">
              <span className="grid size-7 place-items-center rounded-full bg-navy-700 text-xs font-bold text-white">
                {initials(user.name)}
              </span>
              <ChevronDown className="size-4 text-ink-400" />
            </summary>
            <div className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl border border-hairline bg-surface shadow-[var(--shadow-overlay)]">
              <div className="border-b border-hairline px-3 py-2.5">
                <p className="truncate text-sm font-semibold text-ink-950">{user.name}</p>
                <p className="truncate text-xs text-ink-500">{roleLabel(user.role)}</p>
              </div>
              <Link
                href="/change-password"
                className="block px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
              >
                Change password
              </Link>
              <div className="border-t border-hairline p-2">
                <SignOutButton className="btn btn-outline btn-sm w-full" />
              </div>
            </div>
          </details>
        </header>

        <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-4 sm:py-6">{children}</main>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
