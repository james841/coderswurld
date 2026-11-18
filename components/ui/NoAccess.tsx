import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";

/**
 * What a page renders when the user doesn't hold the permission for it.
 *
 * NOT an error, and not a 403 page. A sub-admin who follows a bookmark into
 * Reports after their main admin narrowed their access has done nothing wrong,
 * and a screen that treats them as an intruder teaches them to distrust the
 * app. It names who can lift the restriction, because the answer is always
 * "your main admin" and they are standing somewhere in the same building.
 *
 * Pages use this instead of throwing `PermissionError`. Throwing belongs in API
 * routes, where the caller is code; here the caller is a person.
 */
export function NoAccess({
  what,
  homeHref = "/dashboard",
}: {
  /** The thing they can't see, in their words: "the reports", "staff accounts". */
  what: string;
  /**
   * Where the way out goes. Pass null when there is nowhere sensible to send
   * them — an account with almost nothing granted would otherwise bounce
   * between two of these panels, each offering a link to the other.
   */
  homeHref?: string | null;
}) {
  return (
    <div className="card card-pad mx-auto mt-6 max-w-md text-center">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-ink-50">
        <Lock className="size-5 text-ink-400" />
      </div>
      <h1 className="text-base font-bold text-ink-950">Not part of your access</h1>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-600">
        Your account can&apos;t open {what}. If you need it for your work, your
        main admin can switch it on for you in seconds — they don&apos;t have to
        call anyone.
      </p>
      {homeHref ? (
        <Link href={homeHref} className="btn btn-outline btn-sm mt-4">
          <ArrowLeft className="size-4" />
          Back to where you were
        </Link>
      ) : null}
    </div>
  );
}
