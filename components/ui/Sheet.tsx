"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

import { EASE, m } from "@/components/motion";

/**
 * The one dialog shape used across the back office: a sheet that slides up from
 * the bottom on a phone and sits centred on a desktop.
 *
 * Header and footer stay put; only the body scrolls. That keeps the Save button
 * on screen however long the form is, which matters most on a small phone with
 * the keyboard open.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  size = "md",
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  size?: "md" | "lg" | "xl";
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const width = size === "xl" ? "max-w-4xl" : size === "lg" ? "max-w-2xl" : "max-w-lg";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <m.div
        className={`flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl ${width}`}
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.26, ease: EASE }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-hairline p-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink-950">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-icon shrink-0 text-ink-500 hover:text-ink-900"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <div className="border-t border-hairline p-4">{footer}</div> : null}
      </m.div>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink-800">{label}</span>
        {hint && !error ? <span className="text-xs text-ink-400">{hint}</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs font-medium text-bad-700">{error}</span> : null}
    </label>
  );
}

/**
 * An on/off setting with its explanation beside it. The whole row is the click
 * target, not just the 40px switch — on a touchscreen till that is the
 * difference between one tap and three.
 */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-4 py-3 ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-900">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-sm leading-relaxed text-ink-500">{description}</span>
        ) : null}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="h-6 w-11 rounded-full bg-ink-300 transition-colors peer-checked:bg-navy-700 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-navy-600" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-[var(--shadow-card)] transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
