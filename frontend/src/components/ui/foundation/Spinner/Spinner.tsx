import type { HTMLAttributes } from "react";
import { cn } from "../../shared/classNames";
import { VisuallyHidden } from "../VisuallyHidden/VisuallyHidden";

export type SpinnerSize = "sm" | "md" | "lg" | number;

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  label?: string;
}

function toPixels(size: SpinnerSize): number {
  if (typeof size === "number") {
    return Math.max(10, size);
  }

  switch (size) {
    case "sm":
      return 14;
    case "lg":
      return 24;
    case "md":
    default:
      return 18;
  }
}

export function Spinner({
  size = "md",
  label = "Carregando",
  className = "",
  ...rest
}: SpinnerProps) {
  const px = toPixels(size);

  return (
    <span className={cn("ui-spinner-root", className)} role="status" aria-live="polite" {...rest}>
      <span className="ui-spinner" style={{ width: px, height: px }} aria-hidden="true" />
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
