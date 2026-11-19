"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { confirmAction } from "@/components/ChangeConfirm";

export function WriteOffButton({ batchId, label }: { batchId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    const ok = await confirmAction({
      title: "Remove this batch from stock?",
      body: `${label} will be taken out of stock as expired. This can't be undone.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/stock/batches/${batchId}/write-off`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Could not remove it. Try again.");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove it.");
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={go} disabled={busy} className="btn btn-sm btn-outline text-sell-700">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        Remove
      </button>
      {error ? <span className="text-xs text-sell-700">{error}</span> : null}
    </span>
  );
}
