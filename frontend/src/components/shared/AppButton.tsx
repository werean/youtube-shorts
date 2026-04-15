import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { cn } from "../../lib/utils";

type AppButtonVariant = "default" | "primary" | "secondary" | "accent" | "ghost";

interface AppButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AppButtonVariant;
  fullWidth?: boolean;
}

const variantClass: Record<AppButtonVariant, string> = {
  default: "",
  primary: "primary",
  secondary: "secondary",
  accent: "accent",
  ghost: "ghost",
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
