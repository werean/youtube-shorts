import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../shared/classNames";

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function VisuallyHidden({ children, className = "", ...rest }: VisuallyHiddenProps) {
  return (
    <span className={cn("ui-visually-hidden", className)} {...rest}>
      {children}
    </span>
  );
}


