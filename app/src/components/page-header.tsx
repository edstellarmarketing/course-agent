import { cn } from "@/lib/utils";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-4 border-b border-gray-100 bg-white px-8 py-6",
        className,
      )}
    >
      <div>
        {eyebrow && (
          <div className="mb-1 font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-orange">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-2xl font-semibold text-navy-deep">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-gray-500">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
