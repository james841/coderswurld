import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";

import { ProvisionForm } from "../../../ProvisionForm";

export const metadata: Metadata = { title: "Add a business" };

/**
 * Provisioning without a request behind it.
 *
 * Plenty of customers never touch the landing page: the operator meets a shop
 * owner, shows them the till on a phone, and takes a transfer on the spot. The
 * alternative to this screen is filing a fake request to yourself first, and an
 * operator who has to do that will instead reach for the database.
 *
 * Same form, same endpoint, no `leadId` — nothing else differs.
 */
export default function NewOrganizationPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/platform/organizations"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 transition-colors hover:text-brand-700"
      >
        <ArrowLeft className="size-4" />
        All businesses
      </Link>

      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-950">Add a business</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          For customers who signed up in person or over the phone. This creates
          the account, its first shop and the main admin login in one step.
        </p>
      </header>

      <p className="flex items-start gap-2 rounded-xl border border-ink-200 bg-ink-50 px-3 py-2.5 text-sm text-ink-700">
        <Info className="mt-0.5 size-4 shrink-0 text-ink-400" />
        If this business filled in the form on the website, provision them from{" "}
        <Link href="/platform/leads" className="font-semibold text-brand-700 underline">
          their request
        </Link>{" "}
        instead — it keeps the paperwork attached to the account.
      </p>

      <section className="card card-pad">
        <ProvisionForm
          defaults={{
            organizationName: "",
            businessType: "SUPERMARKET",
            email: "",
            phone: "",
            whatsapp: "",
            state: "",
            city: "",
            address: "",
            plan: "STARTER",
            quotedKobo: 0,
            adminName: "",
            adminPhone: "",
          }}
        />
      </section>
    </div>
  );
}
