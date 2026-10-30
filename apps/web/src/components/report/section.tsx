import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Section({
  id,
  title,
  description,
  aside,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-32 border-t pt-10", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-[22px] leading-tight font-bold tracking-[-0.015em]">
            {title}
          </h2>
          {description && <p className="mt-1.5 max-w-[68ch] text-[15px] text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}
