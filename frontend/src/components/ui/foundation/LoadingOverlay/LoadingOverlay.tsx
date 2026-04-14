import type { HTMLAttributes } from "react";
import { cn } from "../../shared/classNames";
import { Spinner } from "../Spinner/Spinner";

export interface LoadingOverlayProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  label?: string;
  spinnerSize?: number | "sm" | "md" | "lg";
}

export function LoadingOverlay({
  open,
  label = "Carregando...",
  spinnerSize = "md",
  className = "",
  ...rest
}: LoadingOverlayProps) {
  if (!open) {
    return null;
  }

  return (
    <div className={cn("ui-loading-overlay", className)} role="status" aria-live="polite" {...rest}>
      <Spinner size={spinnerSize} label={label} />
      {label ? <p className="ui-loading-overlay__label">{label}</p> : null}
    </div>
  );
}
