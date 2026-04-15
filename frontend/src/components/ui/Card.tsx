import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

export type CardVariant = "default" | "flat";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  header?: ReactNode;
  body?: ReactNode;
  footer?: ReactNode;
  active?: boolean;
}

export function Card({
  variant = "default",
  header,
  body,
  footer,
  active = false,
  className,
  children,
  ...rest
}: CardProps) {
  const background = variant === "flat" ? "bg-bg-0" : "bg-bg-2";

  return (
    <section
      className={cn(
        "rounded-lg border-[0.5px] border-border-1 p-4 ds-transition-color",
        background,
        active ? "border border-border-3" : "",
        className,
      )}
      {...rest}
    >
      {header ? <header className="mb-3">{header}</header> : null}
      <div className="space-y-0">{body ?? children}</div>
      {footer ? <footer className="mt-3">{footer}</footer> : null}
    </section>
  );
}
