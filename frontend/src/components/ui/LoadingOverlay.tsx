import type { HTMLAttributes } from "react";
import { Spinner } from "./Spinner";

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
    <div
      className={`ui-loading-overlay ${className}`.trim()}
      role="status"
      aria-live="polite"
      {...rest}
    >
      <Spinner size={spinnerSize} label={label} />
      {label ? <p className="ui-loading-overlay__label">{label}</p> : null}
    </div>
  );
}
