import Link from "next/link";
import { ArrowUpRight, FolderOpen, PackagePlus, ScanBarcode, Truck } from "lucide-react";

import { Stagger, StaggerItem } from "@/components/motion";

/**
 * The row of big coloured tiles at the top of the dashboard.
 *
 * Colour follows the product's one rule: red is the till, orange is an action,
 * blue is structure, white is everything else. So the tiles are not decorated
 * at random — "Sell" is the only red thing on the page, and the eye finds it
 * first, which is exactly the order of importance.
 *
 * A tile only appears if the person can actually do that thing. A dashboard
 * with a dead button teaches people not to trust the buttons.
 */

interface Action {
  href: string;
  title: string;
  hint: string;
  icon: typeof ScanBarcode;
  /** Tile, icon chip, hint text. */
  tone: [string, string, string];
}

export function QuickActions({
  canSell,
  canAddProduct,
  canReceive,
  canFileReceipt,
}: {
  canSell: boolean;
  canAddProduct: boolean;
  canReceive: boolean;
  canFileReceipt: boolean;
}) {
  const actions: Action[] = [];

  if (canSell) {
    actions.push({
      href: "/pos",
      title: "Sell at till",
      hint: "Scan, take payment, print",
      icon: ScanBarcode,
      tone: ["texture-waves bg-sell-600 text-white hover:bg-sell-700", "bg-white/15 text-white", "text-white/80"],
    });
  }
  if (canAddProduct) {
    actions.push({
      href: "/products/add",
      title: "Add product",
      hint: "New item, price and barcode",
      icon: PackagePlus,
      tone: ["texture-waves bg-navy-700 text-white hover:bg-navy-800", "bg-white/15 text-white", "text-white/80"],
    });
  }
  if (canReceive) {
    actions.push({
      href: "/purchases/new",
      title: "Receive goods",
      hint: "Stock in from a supplier",
      icon: Truck,
      tone: ["texture-waves bg-brand-700 text-white hover:bg-brand-800", "bg-white/15 text-white", "text-white/85"],
    });
  }
  if (canFileReceipt) {
    actions.push({
      href: "/receipts?new=1",
      title: "File a receipt",
      hint: "Snap a vendor's receipt",
      icon: FolderOpen,
      tone: [
        "texture-waves-ink border border-hairline bg-surface text-ink-950 hover:border-navy-200",
        "bg-navy-50 text-navy-700",
        "text-ink-500",
      ],
    });
  }

  if (actions.length === 0) return null;

  return (
    <Stagger className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" gap={0.06}>
      {actions.map(({ href, title, hint, icon: Icon, tone }) => (
        <StaggerItem key={href} lift>
          <Link
            href={href}
            className={`group flex h-full flex-col rounded-2xl p-4 shadow-[var(--shadow-card)] transition-colors ${tone[0]}`}
          >
            <span className="flex items-start justify-between">
              <span className={`grid size-10 place-items-center rounded-xl ${tone[1]}`}>
                <Icon className="size-5" />
              </span>
              <ArrowUpRight className="size-4 opacity-60 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
            </span>
            <span className="mt-4 text-base font-bold leading-tight">{title}</span>
            <span className={`mt-0.5 text-xs leading-snug ${tone[2]}`}>{hint}</span>
          </Link>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
