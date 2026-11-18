"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText, FileType2, Loader2 } from "lucide-react";

/**
 * "Download stock record": pick the counter (supermarket, pharmacy or both),
 * the branch, then Excel, PDF or Word. The file is built on the server and
 * downloads straight away.
 */
export function ExportStockButton({
  departmentsEnabled,
  branches,
  selectedBranchId,
  pinnedBranch,
  categories,
}: {
  /** Categories that have products, with the counters they appear under. */
  categories: { id: string; name: string; departments: string[] }[];
  departmentsEnabled: boolean;
  branches: { id: string; name: string }[];
  selectedBranchId: string;
  pinnedBranch: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [department, setDepartment] = useState<"ALL" | "SUPERMARKET" | "PHARMACY">("ALL");
  const [branch, setBranch] = useState(selectedBranchId);
  const [category, setCategory] = useState("all");
  const shownCategories = categories.filter((c) => department === "ALL" || c.departments.includes(department));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  async function download(format: "xlsx" | "pdf" | "docx") {
    setBusy(format);
    setError(null);
    try {
      const qs = new URLSearchParams({ format, department, branch, category });
      const res = await fetch(`/api/stock/export?${qs}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Could not make the file. Try again.");
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `stock.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not make the file.");
    } finally {
      setBusy(null);
    }
  }

  const FORMATS = [
    { id: "xlsx", label: "Excel", hint: "To sort, filter or edit", icon: FileSpreadsheet, tone: "text-good-700 bg-good-50" },
    { id: "pdf", label: "PDF", hint: "To print or send", icon: FileText, tone: "text-sell-700 bg-sell-50" },
    { id: "docx", label: "Word", hint: "To add notes before printing", icon: FileType2, tone: "text-navy-700 bg-navy-50" },
  ] as const;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="btn btn-outline btn-sm">
        <Download className="size-4" />
        Download stock record
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-2xl border border-hairline bg-white p-4 shadow-[var(--shadow-raised)]">
          {departmentsEnabled ? (
            <fieldset>
              <legend className="text-xs font-bold uppercase tracking-wide text-ink-500">Which counter</legend>
              <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-xl bg-canvas p-1">
                {(
                  [
                    ["ALL", "Both"],
                    ["SUPERMARKET", "Supermarket"],
                    ["PHARMACY", "Pharmacy"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setDepartment(id);
                      setCategory("all");
                    }}
                    aria-pressed={department === id}
                    className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${
                      department === id ? "bg-white text-ink-950 shadow-sm" : "text-ink-600 hover:text-ink-950"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <label className="mt-3 block">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-500">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="select mt-1.5">
              <option value="all">All categories, grouped</option>
              {shownCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} only
                </option>
              ))}
            </select>
          </label>

          {!pinnedBranch && branches.length > 1 ? (
            <label className="mt-3 block">
              <span className="text-xs font-bold uppercase tracking-wide text-ink-500">Branch</span>
              <select value={branch} onChange={(e) => setBranch(e.target.value)} className="select mt-1.5">
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
                <option value="all">All branches added together</option>
              </select>
            </label>
          ) : null}

          <p className="mt-3 text-xs font-bold uppercase tracking-wide text-ink-500">Download as</p>
          <div className="mt-1.5 space-y-1.5">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                disabled={busy !== null}
                onClick={() => download(f.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-hairline px-3 py-2 text-left transition-colors hover:border-navy-200 hover:bg-navy-50 disabled:opacity-60"
              >
                <span className={`grid size-8 place-items-center rounded-lg ${f.tone}`}>
                  {busy === f.id ? <Loader2 className="size-4 animate-spin" /> : <f.icon className="size-4" />}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink-900">{f.label}</span>
                  <span className="block text-xs text-ink-500">{f.hint}</span>
                </span>
              </button>
            ))}
          </div>
          {error ? <p className="mt-2 text-xs font-medium text-sell-700">{error}</p> : null}
          <p className="mt-3 text-[11px] leading-snug text-ink-500">
            Products are grouped by counter, then category, with a total for each. Shows quantity on hand, reorder level,
            prices, stock value and nearest expiry.
          </p>
        </div>
      ) : null}
    </div>
  );
}
