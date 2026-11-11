import React, { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../../lib/utils";

export type GlassCardVariant = "default" | "active";
export type GlassCardGlow = "emerald" | "white" | "none";

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Visual variant: default frosted plate or active highlighted item */
  variant?: GlassCardVariant;
  /** Glow tint when active or hovered */
  glowColor?: GlassCardGlow;
  /** Whether the card illuminates and elevates smoothly on hover */
  hoverable?: boolean;
  /** Optional top header slot */
  header?: ReactNode;
  /** Optional bottom footer slot */
  footer?: ReactNode;
}

const glowStyles: Record<GlassCardGlow, string> = {
  emerald: "shadow-[0_0_24px_-4px_rgba(16,185,129,0.25),inset_0_1px_0_0_rgba(255,255,255,0.2)] border-emerald-500/40",
  white: "shadow-[0_0_24px_-4px_rgba(255,255,255,0.18),inset_0_1px_0_0_rgba(255,255,255,0.25)] border-white/30",
  none: "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18)] border-white/20",
};

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(function GlassCard(
  {
    variant = "default",
    glowColor = "white",
    hoverable = false,
    header,
    footer,
    className,
    children,
    ...rest
  },
  ref,
) {
  const isActive = variant === "active";

  return (
    <div
      ref={ref}
      className={cn(
        // Base glass plate
        "relative rounded-xl md:rounded-2xl transition-all duration-200 ease-out",
        "backdrop-blur-[24px] saturate-[170%]",
        // Default styling
        !isActive && [
          "bg-white/[0.04] border border-white/[0.08]",
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10),0_8px_24px_-4px_rgba(0,0,0,0.4)]",
          hoverable && "hover:bg-white/[0.07] hover:border-white/[0.16] hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_12px_32px_-4px_rgba(0,0,0,0.5)] cursor-pointer",
        ],
        // Active styling (highlighted / selected state)
        isActive && [
          "bg-white/[0.08] border",
          glowStyles[glowColor],
        ],
        className,
      )}
      {...rest}
    >
      {header && (
        <div className="border-b border-white/[0.06] px-4 py-3 text-xs font-medium text-zinc-300">
          {header}
        </div>
      )}
      <div className="p-4">{children}</div>
      {footer && (
        <div className="border-t border-white/[0.06] px-4 py-3 bg-white/[0.01]">
          {footer}
        </div>
      )}
    </div>
  );
});
