"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";

/**
 * The sign-in form.
 *
 * Two details that matter more than they look:
 *
 *   • `router.replace`, not `push` — sign-in must not sit in the back stack.
 *     A cashier hitting Back after logging in should not land on a login screen
 *     with their credentials still in the form.
 *
 *   • The redirect target comes from the server, which knows the user's role.
 *     A cashier goes straight to the till.
 */

interface OrgChoice {
  id: string;
  name: string;
}

export function SignInForm({ next }: { next?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [organizations, setOrganizations] = useState<OrgChoice[] | null>(null);
  const [organizationId, setOrganizationId] = useState<string>("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login: form.get("login"),
          password: form.get("password"),
          ...(organizationId ? { organizationId } : {}),
        }),
      });
      const body = await response.json();

      if (response.status === 409 && Array.isArray(body.organizations)) {
        setOrganizations(body.organizations);
        setOrganizationId(body.organizations[0]?.id ?? "");
        setError(body.error ?? null);
        setBusy(false);
        return;
      }

      if (!response.ok) {
        setError(body.error ?? "We couldn't sign you in. Please try again.");
        setBusy(false);
        return;
      }

      // Keep `busy` true through the navigation — the button stays disabled so a
      // second click can't fire a second sign-in mid-redirect.
      const destination = next || body.redirectTo || "/dashboard";
      router.replace(destination);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {organizations ? (
        <div>
          <label className="label" htmlFor="organizationId">
            Which business?
          </label>
          <select
            id="organizationId"
            className="select h-12 rounded-xl"
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="login">
          Email or your name
        </label>
        <input
          id="login"
          name="login"
          type="text"
          required
          autoComplete="username"
          autoCapitalize="words"
          autoFocus
          spellCheck={false}
          placeholder="you@yourshop.com or Blessing Adeyemi"
          className="input h-12 rounded-xl"
        />
        <p className="mt-1.5 text-xs text-ink-500">
          No email? Type your name exactly as your manager added it.
        </p>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <label className="label" htmlFor="password">
            Password
          </label>
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="mb-1.5 inline-flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-ink-800"
          >
            {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <input
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className="input h-12 rounded-xl"
        />
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

      <button type="submit" disabled={busy} className="btn btn-navy btn-lg h-12 w-full rounded-full text-base shadow-[0_10px_24px_-10px_rgb(29_78_216/0.7)]">
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </button>
    </form>
  );
}
