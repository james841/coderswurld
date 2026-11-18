"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, MessageCircle, PackageCheck } from "lucide-react";

/**
 * Send the order to the supplier on WhatsApp (or copy it), and, once the goods
 * arrive, open "Record goods received" already filled in.
 */
export function SupplierOrderActions({
  shopName,
  supplierName,
  supplierPhone,
  lines,
  receiveHref,
}: {
  shopName: string;
  supplierName: string | null;
  supplierPhone: string | null;
  lines: { name: string; qty: number; unit: string }[];
  receiveHref: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const text = [
    `Hello${supplierName ? ` ${supplierName}` : ""}, this is ${shopName}.`,
    "Please supply the following:",
    "",
    ...lines.map((l, i) => `${i + 1}. ${l.name} - ${l.qty} ${l.unit}`),
    "",
    "Kindly confirm the price and when you can deliver. Thank you.",
  ].join("\n");

  const number = toNumber(supplierPhone);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: nothing else to do.
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {number ? (
        <a
          href={`https://wa.me/${number}?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm btn-outline"
        >
          <MessageCircle className="size-4" />
          Send order on WhatsApp
        </a>
      ) : null}
      <button type="button" onClick={copy} className="btn btn-sm btn-outline">
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy order"}
      </button>
      {receiveHref ? (
        <Link href={receiveHref} className="btn btn-sm btn-primary">
          <PackageCheck className="size-4" />
          Goods arrived
        </Link>
      ) : null}
    </div>
  );
}

function toNumber(input: string | null): string | null {
  if (!input) return null;
  const d = input.replace(/\D/g, "");
  if (d.startsWith("234")) return d.length === 13 ? d : null;
  if (d.startsWith("0")) return d.length === 11 ? `234${d.slice(1)}` : null;
  if (d.length === 10) return `234${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}
