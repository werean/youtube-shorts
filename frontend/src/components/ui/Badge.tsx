import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "outline";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-bg-3 text-text-2 border-[0.5px] border-border-1",
  success: "bg-success-bg text-success border-[0.5px] border-success/30",
  warning: "bg-warning-bg text-warning border-[0.5px] border-warning/30",
  danger: "bg-danger-bg text-danger border-[0.5px] border-danger/30",
  outline: "bg-transparent text-text-2 border-[0.5px] border-border-2",
};

export function Badge({ variant = "default", className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[5px] px-2 py-[2px] text-label font-medium uppercase",
        variantStyles[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
