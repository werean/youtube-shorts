import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: number;
}

export function Progress({ label, value, className, ...rest }: ProgressProps) {
  const safeValue = Math.max(0, Math.min(100, value));

  return (
    <div className={cn("space-y-2", className)} {...rest}>
      <div className="flex items-center justify-between text-body-sm text-text-2">
        <span>{label}</span>
        <span>{safeValue}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-[2px] bg-bg-3">
        <div
          className="h-full bg-accent transition-[width] duration-[400ms] ease-linear"
          style={{ width: `${safeValue}%` }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={safeValue}
          aria-label={label}
        />
      </div>
    </div>
  );
}
