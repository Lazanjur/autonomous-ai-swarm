import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type ButtonProps = {
  href?: string;
  children: ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "ghost";
};

const variants = {
  primary: "bg-ink text-white hover:bg-ink/90",
  secondary: "bg-white/80 text-ink ring-1 ring-black/10 hover:bg-white",
  ghost: "bg-transparent text-ink hover:bg-black/5"
};

export function Button({
  href,
  children,
  className,
  variant = "primary"
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-medium transition";

  if (href) {
    return (
      <Link href={href} className={cn(base, variants[variant], className)}>
        {children}
      </Link>
    );
  }

  return <button className={cn(base, variants[variant], className)}>{children}</button>;
}
