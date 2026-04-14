import type { HTMLAttributes, ReactNode } from "react";

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function VisuallyHidden({ children, className = "", ...rest }: VisuallyHiddenProps) {
  return (
    <span className={`ui-visually-hidden ${className}`.trim()} {...rest}>
      {children}
    </span>
  );
}
