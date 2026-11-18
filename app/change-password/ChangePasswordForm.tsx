"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Eye, EyeOff, Loader2 } from "lucide-react";

/**
 * The password-change form — used both for the forced change after a temp
 * password and for a voluntary one.
 *
 * On success it calls `router.refresh()` before navigating. The session cookie
 * doesn't change, but `mustChangePassword` does, and that flag is read by the
 * app shell's layout on the server. Without the refresh, the cached render of
 * the dashboard still thinks this user is gated and bounces them straight back
 * here — a loop that looks exactly like "the form didn't work".
 */

const MIN_LENGTH = 8;

export function ChangePasswordForm({
  redirectTo,
  forced,
}: {
  redirectTo: string;
  forced: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [show, setShow] = useState(false);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const longEnough = next.length >= MIN_LENGTH;
  const matches = confirm.length > 0 && next === confirm;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setFields({});

    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: form.get("currentPassword"),
          newPassword: form.get("newPassword"),
          confirmPassword: form.get("confirmPassword"),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "We couldn't change your password. Please try again.");
        if (body.fields && typeof body.fields === "object") setFields(body.fields);
        setBusy(false);
        return;
      }

      // `busy` stays true through the navigation so a second click can't fire a
      // second change mid-redirect.
      router.replace(redirectTo);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div>
        <label className="label" htmlFor="currentPassword">
          {forced ? "Temporary password" : "Current password"}
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          autoFocus
          placeholder={forced ? "The one from your email" : "••••••••"}
          className="input h-12 rounded-xl"
          aria-invalid={fields.currentPassword ? true : undefined}
        />
        {fields.currentPassword ? (
          <p className="error-text">{fields.currentPassword}</p>
        ) : null}
      </div>

      <div className="border-t border-hairline pt-4">
        <div className="flex items-baseline justify-between">
          <label className="label" htmlFor="newPassword">
            New password
          </label>
          <button
            type="button"
            onClick={() => setShow((value) => !value)}
            className="mb-1.5 inline-flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-ink-800"
          >
            {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {show ? "Hide" : "Show"}
          </button>
        </div>
        <input
          id="newPassword"
          name="newPassword"
          type={show ? "text" : "password"}
          required
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          placeholder="At least 8 characters"
          className="input h-12 rounded-xl"
          aria-invalid={fields.newPassword ? true : undefined}
        />
        {fields.newPassword ? (
          <p className="error-text">{fields.newPassword}</p>
        ) : (
          <p className={`hint flex items-center gap-1.5 ${longEnough ? "text-good-700" : ""}`}>
            {longEnough ? <Check className="size-3.5" /> : null}
            At least {MIN_LENGTH} characters. Something you&apos;ll remember without
            writing it down.
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="confirmPassword">
          Type it again
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type={show ? "text" : "password"}
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder="Confirm your new password"
          className="input h-12 rounded-xl"
          aria-invalid={fields.confirmPassword ? true : undefined}
        />
        {fields.confirmPassword ? (
          <p className="error-text">{fields.confirmPassword}</p>
        ) : matches ? (
          <p className="hint flex items-center gap-1.5 text-good-700">
            <Check className="size-3.5" />
            Both match.
          </p>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-bad-100 bg-bad-50 p-3 text-sm text-bad-700"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || !longEnough || !matches}
        className="btn btn-navy btn-lg h-12 w-full rounded-full text-base shadow-[0_10px_24px_-10px_rgb(29_78_216/0.7)]"
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Saving…
          </>
        ) : forced ? (
          "Save and continue"
        ) : (
          "Change password"
        )}
      </button>
    </form>
  );
}
