import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { cn } from "../../lib/utils";

type AppButtonVariant = "default" | "primary" | "secondary" | "accent" | "ghost";

interface AppButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AppButtonVariant;
  fullWidth?: boolean;
}

const variantClass: Record<AppButtonVariant, string> = {
  default: "app-btn app-btn--default",
  primary: "primary app-btn app-btn--primary",
  secondary: "secondary app-btn app-btn--secondary",
  accent: "accent app-btn app-btn--accent",
  ghost: "ghost app-btn app-btn--ghost",
};

export function AppButton({
  variant = "default",
  fullWidth = false,
  className,
  style,
  children,
  type = "button",
  ...rest
}: AppButtonProps) {
  const mergedStyle: CSSProperties = {
    ...(fullWidth ? { width: "100%" } : {}),
    ...(style || {}),
  };

  return (
    <button
      type={type}
      className={cn(variantClass[variant], className)}
      style={mergedStyle}
      {...rest}
    >
      {children}
    </button>
  );
}
