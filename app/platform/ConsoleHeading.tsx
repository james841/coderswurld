/**
 * The heading every console page starts with: an icon tile in the console's
 * navy, a bold title and one line saying what the page is for. One component,
 * so the section reads as one product.
 */
export function ConsoleHeading({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <span className="texture-waves grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-800 text-white shadow-sm">
        <Icon className="size-[1.375rem]" />
      </span>
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-950">{title}</h1>
        {children ? <p className="mt-0.5 text-sm text-ink-600">{children}</p> : null}
      </div>
    </div>
  );
}
