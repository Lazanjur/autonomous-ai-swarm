import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-black/10 bg-white/75 px-3 py-1 text-xs uppercase tracking-[0.18em] text-black/70",
        className
      )}
    >
      {children}
    </span>
  );
}
