/**
 * What a screen shows before anything has happened yet.
 *
 * An empty table with headers reads as a failure. An empty state should say
 * what goes here and offer the one action that fills it — a new shop's first
 * hour is spent on these screens, and each one is a chance to tell them what to
 * do next instead of leaving them to guess.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card card-pad text-center">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-ink-50">
        <Icon className="size-5 text-ink-400" />
      </div>
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-500">{body}</p>
      {action ? <div className="mt-4 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}
