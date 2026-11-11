import type { ButtonHTMLAttributes } from "react";
import { GlassButton, type GlassButtonVariant } from "../ui/glass/GlassButton";

type AppButtonVariant = "default" | "primary" | "secondary" | "accent" | "ghost" | "danger";

interface AppButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AppButtonVariant;
  fullWidth?: boolean;
}

const mapVariant = (v?: AppButtonVariant): GlassButtonVariant => {
  if (v === "primary" || v === "accent") return "primary";
  if (v === "danger") return "danger";
  if (v === "ghost") return "ghost";
  return "glass";
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
  return (
    <GlassButton
      type={type}
      variant={mapVariant(variant)}
      fullWidth={fullWidth}
      className={className}
      style={style}
      {...rest}
    >
      {children}
    </GlassButton>
  );
}

