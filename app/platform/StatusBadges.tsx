import {
  Ban,
  CheckCircle2,
  Clock,
  FileText,
  Hourglass,
  Mail,
  Rocket,
  Sparkles,
  Wallet,
  XCircle,
} from "lucide-react";

/**
 * Status pills, defined once.
 *
 * Colour carries meaning here, which is the one place the black/white/orange
 * rule bends: green means "money is in", red means "stopped", amber means
 * "waiting on someone". An operator scanning forty rows reads the colour before
 * the word, and making them all orange would throw that away.
 */

const LEAD_STYLES: Record<
  string,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  NEW: { label: "New", className: "badge-brand", icon: Sparkles },
  CONTACTED: { label: "Contacted", className: "badge-info", icon: Mail },
  INVOICED: { label: "Invoiced", className: "badge-warn", icon: FileText },
  PAID: { label: "Paid", className: "badge-good", icon: Wallet },
  PROVISIONED: { label: "Live", className: "badge-good", icon: Rocket },
  REJECTED: { label: "Rejected", className: "badge-neutral", icon: XCircle },
};

export function LeadStatusBadge({ status }: { status: string }) {
  const style = LEAD_STYLES[status] ?? {
    label: status,
    className: "badge-neutral",
    icon: Clock,
  };
  const Icon = style.icon;
  return (
    <span className={`badge ${style.className}`}>
      <Icon className="size-3" />
      {style.label}
    </span>
  );
}

const ORG_STYLES: Record<
  string,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  ACTIVE: { label: "Active", className: "badge-good", icon: CheckCircle2 },
  PENDING: { label: "Pending", className: "badge-warn", icon: Hourglass },
  SUSPENDED: { label: "Suspended", className: "badge-bad", icon: Ban },
  EXPIRED: { label: "Expired", className: "badge-bad", icon: Clock },
};

export function OrgStatusBadge({ status }: { status: string }) {
  const style = ORG_STYLES[status] ?? {
    label: status,
    className: "badge-neutral",
    icon: Clock,
  };
  const Icon = style.icon;
  return (
    <span className={`badge ${style.className}`}>
      <Icon className="size-3" />
      {style.label}
    </span>
  );
}

export function PlanBadge({ plan }: { plan: string }) {
  const label = plan.charAt(0) + plan.slice(1).toLowerCase();
  return <span className="badge badge-neutral">{label}</span>;
}
