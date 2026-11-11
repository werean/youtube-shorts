import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../../lib/utils";

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  variant?: "surface" | "raised" | "sunken" | "frosted";
  intensity?: "low" | "medium" | "high";
  glow?: boolean;
}

export function GlassPanel({
  children,
  className,
  variant = "surface",
  intensity = "medium",
  glow = false,
  ...props
}: GlassPanelProps) {
  const blurClass =
    intensity === "low"
      ? "backdrop-blur-sm"
      : intensity === "high"
        ? "backdrop-blur-2xl"
        : "backdrop-blur-md";

  const variantClass = {
    surface:
      "bg-white/[0.03] border-white/[0.08] text-text-1 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
    raised:
      "bg-white/[0.05] border-white/[0.12] text-text-1 shadow-[0_12px_40px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.12)]",
    sunken:
      "bg-black/30 border-white/[0.05] text-text-1 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]",
    frosted:
      "bg-[#121216]/80 border-white/[0.09] text-text-1 shadow-[0_8px_32px_rgba(0,0,0,0.35),inset_0_1px_0_0_rgba(255,255,255,0.08)]",
  }[variant];

  const glowClass = glow
    ? "ring-1 ring-white/20 shadow-[0_0_25px_rgba(255,255,255,0.08)]"
    : "";

  return (
    <div
      className={cn(
        "relative rounded-xl border transition-colors",
        blurClass,
        variantClass,
        glowClass,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
